import { HALF_TURN } from '@ricochet/geom';
import {
  PROTOCOL_VERSION,
  RULES,
  decodeClient,
  decodeServer,
  diff,
  encodeServer,
} from '@ricochet/protocol';
import type { Input, View } from '@ricochet/protocol';
import { createWorld, join, step, view } from '@ricochet/sim';
import type { Command, TankBody, World } from '@ricochet/sim';
import { Client } from '../client.js';
import type { Frame, Intent, SocketEvents } from '../client.js';
import type { Effect } from '../own.js';
import type { Reconciled } from '../prediction.js';

/**
 * A test bench for `netcode` in virtual time: a server stepping the real `sim` at 30 Hz with a
 * `Room`'s input queue (apps/server, which nothing may import), a link that delays, jitters and
 * stalls each direction the way TCP does — in order, never lost, held back and then all at once —
 * and a `Client` on a local clock that may drift from the server's. Every frame the client draws
 * and every reconciliation it makes is checked against what the server actually did.
 */

/** mulberry32 — the test's own seeded randomness. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A queue of things to do at moments of virtual time, ms. */
export class Scheduler {
  now = 0;
  private heap: { at: number; n: number; fn: () => void }[] = [];
  private n = 0;

  at(at: number, fn: () => void): () => void {
    const item = { at: Math.max(at, this.now), n: this.n++, fn };
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const parent = h[p];
      if (!parent || less(parent, item)) break;
      h[i] = parent;
      i = p;
    }
    h[i] = item;
    return () => {
      item.fn = () => {};
    };
  }

  run(until: number): void {
    const h = this.heap;
    for (;;) {
      const top = h[0];
      if (!top || top.at > until) break;
      const last = h.pop();
      if (last && h.length > 0) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          let best = last;
          const hl = h[l];
          const hr = h[r];
          if (hl && less(hl, best)) {
            m = l;
            best = hl;
          }
          if (hr && less(hr, best)) {
            m = r;
            best = hr;
          }
          if (m === i) break;
          h[i] = best;
          i = m;
        }
        h[i] = last;
      }
      this.now = top.at;
      top.fn();
    }
    this.now = until;
  }
}

const less = (a: { at: number; n: number }, b: { at: number; n: number }) =>
  a.at < b.at || (a.at === b.at && a.n < b.n);

export interface LinkShape {
  /** One way, ms. */
  readonly delay: number;
  /** Each frame's delay is `delay` ± up to this, uniformly. */
  readonly jitter: number;
  /** Windows of virtual time, ms, in which nothing gets through; what was held arrives at the end. */
  readonly stalls?: readonly (readonly [number, number])[];
}

/** One direction of a TCP connection: every frame arrives, in order, late by the link's delay and
 * jitter, and a stall holds everything back and then delivers it in a burst. */
export class Link {
  private last = 0;

  constructor(
    private readonly sched: Scheduler,
    private readonly shape: LinkShape,
    private readonly random: () => number,
  ) {}

  send(deliver: () => void): void {
    const sent = this.sched.now;
    let at = sent + this.shape.delay + (2 * this.random() - 1) * this.shape.jitter;
    for (const [s, e] of this.shape.stalls ?? []) if (at >= s && sent < e) at = Math.max(at, e);
    at = Math.max(at, this.last);
    this.last = at;
    this.sched.at(at, deliver);
  }
}

/** The client's tank's id: between the others'. */
const YOU = 50;

/** What happened on one server tick, as far as the checks need. */
export interface TickTruth {
  readonly me: TankBody;
  /** Every other live tank's centre. */
  readonly others: readonly { readonly x: number; readonly y: number }[];
  /** The seq applied for the client this tick, or 0 for none. */
  readonly applied: number;
  /** The tick's hits, every shell's — and every shell in the air after it, by id. */
  readonly hits: readonly { readonly shell: number; readonly victim: number }[];
  readonly shells: readonly { readonly id: number; readonly owner: number }[];
}

/**
 * The server: `sim` stepped every 1000/30 ms of virtual time, one client on the link and `others`
 * tanks driven in the server itself by a random walk. The client's inputs are queued as a `Room`
 * queues them — one a tick in `seq` order, the oldest dropped past `inputQueueMax`, and a tick with
 * none standing the tank still (protocol D15).
 */
export class FakeServer {
  world: World;
  you = 0;
  readonly truth = new Map<number, TickTruth>();
  /** Inputs the queue dropped for being past `inputQueueMax`. */
  dropped = 0;
  /** Triggers the server did not fire, and the gun as it stood. */
  readonly refused: {
    seq: number;
    tick: number;
    reload: number;
    shield: number;
    inAir: number;
    alive: boolean;
  }[] = [];
  /** Seqs applied, in the order they were. */
  readonly applied: number[] = [];
  /** Inputs received and not yet applied, with the tick that had last run when each arrived. */
  private queue: { input: Input; at: number }[] = [];
  private received = 0;
  private ack = 0;
  private sent: View | null = null;
  private send: ((frame: Uint8Array) => void) | null = null;
  private readonly walk = new Map<number, Command>();
  private last: Input | null = null;

  constructor(
    private readonly sched: Scheduler,
    others: number,
    private readonly random: () => number,
    /** What a tick with no input does: stand (protocol D15), or hold the last stick as D14 did. */
    private readonly late: 'stand' | 'hold' = 'stand',
    /** The round trip the server measures, ms — what a shell is fast-forwarded by half of. */
    private readonly rtt = 0,
    /** Whether the fast-forward adds the ticks the input waited in the queue (protocol D16). */
    private readonly queued = true,
  ) {
    // Half the others step before the client's tank in a tick and half after (sim § 8.1 drives in
    // ascending id), so a prediction is judged against both.
    let w = createWorld(7);
    for (let i = 0; i < others; i++) w = join(w, i % 2 === 0 ? 10 + i : 100 + i).world;
    this.world = w;
    // Each tick schedules the next, at its own deadline: tick T is stepped at T · period.
    this.sched.at(1000 / RULES.tickHz, () => this.tick(1));
  }

  /** A socket opened to it; frames for the client go to `send`. */
  accept(send: (frame: Uint8Array) => void): void {
    this.send = send;
  }

  receive(frame: Uint8Array): void {
    const d = decodeClient(frame);
    if (!d.ok) throw new Error(`the client sent a malformed frame: ${d.reason}`);
    const m = d.value;
    if (m.type === 'hello') {
      const r = join(this.world, YOU);
      this.world = r.world;
      this.you = YOU;
      this.out(
        encodeServer({
          type: 'welcome',
          version: PROTOCOL_VERSION,
          you: YOU,
          token: new Uint8Array(16),
          tick: this.world.tick,
          resumed: false,
          arena: 0,
        }),
      );
      this.out(encodeServer({ type: 'roster', entries: [] }));
    } else if (m.type === 'input') {
      if (m.seq <= this.received) return;
      this.received = m.seq;
      this.queue.push({ input: m, at: this.world.tick });
      if (this.queue.length > RULES.inputQueueMax) {
        this.queue.shift();
        this.dropped++;
      }
    } else {
      const since = this.sched.now - this.world.tick * (1000 / RULES.tickHz);
      this.out(
        encodeServer({
          type: 'pong',
          id: m.id,
          tick: this.world.tick,
          offsetUs: Math.min(33_333, Math.max(0, Math.round(since * 1000))),
        }),
      );
    }
  }

  private out(frame: Uint8Array): void {
    this.send?.(frame);
  }

  private tick(k: number): void {
    this.sched.at((k + 1) * (1000 / RULES.tickHz), () => this.tick(k + 1));
    const commands = new Map<number, Command>();
    for (const t of this.world.tanks) {
      if (t.id === this.you) continue;
      let c = this.walk.get(t.id);
      if (!c || this.random() < 1 / 40) {
        c = {
          aim: Math.floor(this.random() * 1024),
          move: this.random() < 0.15 ? null : Math.floor(this.random() * 1024),
          fire: false,
        };
        this.walk.set(t.id, c);
      }
      commands.set(t.id, { ...c, fire: this.random() < 0.05 });
    }
    let applied = 0;
    if (this.you) {
      const q = this.queue.shift();
      const next = q?.input;
      if (q && next) {
        // ADR-0002: half the round trip, and (D16) the time the input waited here, in ticks.
        const waited = this.queued ? this.world.tick + 1 - q.at - 0.5 : 0;
        const lead = Math.round(this.rtt / 2 / (1000 / RULES.tickHz) + waited);
        this.ack = next.seq;
        this.last = next;
        applied = next.seq;
        this.applied.push(next.seq);
        commands.set(this.you, {
          aim: next.aim,
          move: next.move,
          fire: next.fire,
          seq: next.seq,
          lead,
        });
      } else if (this.late === 'hold' && this.last) {
        commands.set(this.you, { aim: this.last.aim, move: this.last.move, fire: false });
      }
    }
    const before = this.world;
    const r = step(this.world, commands);
    this.world = r.world;
    const mine = commands.get(this.you);
    if (
      mine?.fire &&
      mine.seq !== undefined &&
      !r.events.some((e) => e.type === 'shot' && e.seq === mine.seq)
    ) {
      const t = before.tanks.find((x) => x.id === this.you);
      this.refused.push({
        seq: mine.seq,
        tick: this.world.tick,
        reload: Math.max(0, (t?.reload ?? 0) - 1),
        shield: Math.max(0, (t?.shield ?? 0) - 1),
        inAir: before.shells.filter((s) => s.owner === this.you).length,
        alive: t?.alive ?? false,
      });
    }
    const me = this.world.tanks.find((t) => t.id === this.you);
    if (!me) return;
    this.truth.set(this.world.tick, {
      me,
      others: this.world.tanks.filter((t) => t.id !== this.you && t.alive),
      applied,
      hits: r.events.flatMap((e) =>
        e.type === 'hit' ? [{ shell: e.shell, victim: e.victim }] : [],
      ),
      shells: this.world.shells.map((s) => ({ id: s.id, owner: s.owner })),
    });
    const v = view(this.world, this.you, r.events, this.ack);
    this.out(encodeServer(diff(this.sent, v)));
    this.sent = v;
  }
}

export interface Scenario {
  readonly seconds: number;
  /** Round trip, ms, ± `jitter` each way. */
  readonly rtt: number;
  readonly jitter: number;
  readonly stalls?: readonly (readonly [number, number])[];
  /** Stalls on the way up only — the inputs held, the snapshots not. */
  readonly upStalls?: readonly (readonly [number, number])[];
  /** How much faster the client's clock runs than the server's: 50 ms a minute is 50 / 60_000. */
  readonly drift?: number;
  readonly others: number;
  readonly seed: number;
  /** The server's rule for a tick with no input (`FakeServer`). */
  readonly late?: 'stand' | 'hold';
  /** Whether the server's fast-forward adds the input's wait in its queue (protocol D16). */
  readonly queued?: boolean;
}

/**
 * What the server did to the own tank in the tick a prediction is judged on: nothing another tank
 * could have changed (`apart` — hits included: a shell hurts and kills after the driving, § 8.1, so
 * where the tank stands is still the prediction's to know); a tick in which another tank was close
 * enough to block it (`contact`); or a respawn, which puts it somewhere new.
 */
export type Touch = 'apart' | 'contact' | 'respawn';

export interface Judged {
  readonly rec: Reconciled;
  readonly touch: Touch;
  /** The predicted tank against the server's, eighths; a hull or turret off counts as at least 1. */
  readonly error: number;
}

export interface Run {
  readonly client: Client;
  readonly server: FakeServer;
  readonly judged: readonly Judged[];
  /** Frames drawn while live, and the problems found in them. */
  readonly frames: number;
  readonly frameProblems: readonly string[];
  /** The client's estimate of the server's tick against the truth, ticks, sampled once a second
   * after the first five. */
  readonly clockErrors: readonly number[];
  /** Every tick the client was sent, in the order it got them. */
  readonly snapshotTicks: readonly number[];
  /** Every effect the client's frames carried, with the frame's tick, and every hit event its
   * snapshots did. */
  readonly effects: readonly { readonly frame: number; readonly effect: Effect }[];
  readonly hitEvents: readonly {
    readonly tick: number;
    readonly shell: number;
    readonly victim: number;
  }[];
}

/** Within this, eighths, another tank's centre is near enough to block the own tank in a tick: two
 * radii, and a tick of each driving toward the other. */
const REACH = 2 * RULES.tankRadius + 2 * RULES.tankSpeed;

/** A scripted route: the stick swept round the compass and held, now and then let go; the turret
 * turning steadily; a shot every half second. */
export function route(): () => Intent {
  let k = 0;
  const legs = [0, 256, 128, 512, null, 768, 640, 896, 384, null, HALF_TURN + 64, 192];
  return () => {
    k++;
    const leg = legs[Math.floor(k / 40) % legs.length] ?? null;
    return { aim: (k * 9) % 1024, move: leg, fire: k % 15 === 0 };
  };
}

export function run(s: Scenario): Run {
  const sched = new Scheduler();
  const random = rng(s.seed);
  const server = new FakeServer(sched, s.others, rng(s.seed + 1), s.late, s.rtt, s.queued ?? true);
  const half = { delay: s.rtt / 2, jitter: s.jitter, stalls: s.stalls ?? [] };
  const up = new Link(sched, { ...half, stalls: [...half.stalls, ...(s.upStalls ?? [])] }, random);
  const down = new Link(sched, half, random);
  const drift = s.drift ?? 0;
  const skew = 123_456; // the client's clock has its own zero
  const clientNow = () => skew + sched.now * (1 + drift);

  const judged: Judged[] = [];
  const snapshotTicks: number[] = [];
  const received = new Set<number>();
  let newest = -1;

  const client = new Client({
    name: 'route',
    clock: { now: clientNow },
    timers: { after: (ms, fn) => sched.at(sched.now + ms / (1 + drift), fn) },
    intent: route(),
    observe: (rec) => {
      if (!rec.predicted) return;
      const now = server.truth.get(rec.tick);
      const was = server.truth.get(rec.tick - 1);
      if (!now || !was) throw new Error(`no truth for tick ${rec.tick}`);
      const near = (t: TickTruth) =>
        t.others.some((o) => {
          const dx = o.x - t.me.x;
          const dy = o.y - t.me.y;
          return dx * dx + dy * dy < REACH * REACH;
        });
      const touch: Touch =
        !was.me.alive && now.me.alive ? 'respawn' : near(now) || near(was) ? 'contact' : 'apart';
      const p = rec.predicted;
      const q = rec.server;
      const off = Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
      const error = p.hull === q.hull && p.turret === q.turret ? off : Math.max(off, 1);
      judged.push({ rec, touch, error });
    },
    connect: (events: SocketEvents) => {
      up.send(() => {
        server.accept((frame) =>
          down.send(() => {
            const d = decodeServer(frame);
            if (d.ok && d.value.type === 'snapshot') {
              snapshotTicks.push(d.value.tick);
              received.add(d.value.tick);
              newest = Math.max(newest, d.value.tick);
            }
            events.message(frame);
          }),
        );
        down.send(() => events.open());
      });
      return {
        send: (frame) => up.send(() => server.receive(frame)),
        close: () => {},
      };
    },
  });

  const hitEvents: { tick: number; shell: number; victim: number }[] = [];
  client.onEvents((events, view) => {
    for (const e of events) {
      if (e.type === 'hit') hitEvents.push({ tick: view.tick, shell: e.shell, victim: e.victim });
    }
  });
  const effects: { frame: number; effect: Effect }[] = [];
  let frames = 0;
  const frameProblems: string[] = [];
  const draw = (f: Frame) => {
    for (const effect of f.effects) effects.push({ frame: frames, effect });
    if (client.state.kind !== 'live' || f.from === null) return;
    frames++;
    if (!received.has(f.from)) frameProblems.push(`drew from tick ${f.from}, never received`);
    if (f.to !== null && !received.has(f.to)) {
      frameProblems.push(`drew toward tick ${f.to}, never received`);
    }
    if (f.tick > newest + 1) frameProblems.push(`drew tick ${f.tick} with ${newest} the newest`);
  };
  const frameMs = 1000 / 60;
  const clockErrors: number[] = [];
  for (let t = 0; t < s.seconds * 1000; t += frameMs) {
    sched.run(t);
    draw(client.frame(clientNow()));
    if (t > 5000 && Math.floor(t / 1000) !== Math.floor((t - frameMs) / 1000)) {
      // The truth: tick T is stepped at T · period of server time.
      const est = client.serverTick(clientNow());
      if (est !== null) clockErrors.push(est - sched.now / (1000 / RULES.tickHz));
    }
  }
  return {
    client,
    server,
    judged,
    frames,
    frameProblems,
    clockErrors,
    snapshotTicks,
    effects,
    hitEvents,
  };
}
