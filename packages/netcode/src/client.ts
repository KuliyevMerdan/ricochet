import { wrapDir } from '@ricochet/geom';
import {
  ARENAS,
  PROTOCOL_VERSION,
  RULES,
  apply,
  decodeServer,
  encodeClient,
} from '@ricochet/protocol';
import type {
  Arena,
  ClientMessage,
  ErrorCode,
  Input,
  RosterEntry,
  ServerMessage,
  Snapshot,
  Tank,
  View,
  Welcome,
} from '@ricochet/protocol';
import type { TankBody } from '@ricochet/sim';
import { ServerClock, TICK_MS } from './clock.js';
import { Shells, between, lerpDir, others } from './picture.js';
import type { DrawnShell, DrawnTank } from './picture.js';
import { Prediction } from './prediction.js';
import type { Mover, Offset, Reconciled } from './prediction.js';
import { Timeline } from './timeline.js';

/** What the client needs of a socket: somewhere to send a binary frame, and a way to end it. */
export interface Socket {
  send(frame: Uint8Array): void;
  close(): void;
}

/** What a socket tells the client. A browser's `WebSocket`, `ws` in the load tool and the tests'
 * simulated link all adapt to this. */
export interface SocketEvents {
  open(): void;
  /** A binary frame; a text frame is handed in as `null`, which this protocol never sends. */
  message(frame: Uint8Array | null): void;
  close(): void;
}

/** Opens a socket to the game, reporting to `events`. Called again for every reconnect. */
export type Connect = (events: SocketEvents) => Socket;

/** Milliseconds, monotonic — `performance.now()` in a page. */
export interface Clock {
  now(): number;
}

export interface Timers {
  /** Call `fn` in `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

/** What the player wants this tick: an aim, a stick (`null` to stand), a trigger. */
export interface Intent {
  readonly aim: number;
  readonly move: number | null;
  readonly fire: boolean;
}

/** Where the connection is — a stream of these, one per change (ROADMAP C0). */
export type ConnectionState =
  | { readonly kind: 'connecting'; readonly attempt: number }
  | { readonly kind: 'joining' }
  | { readonly kind: 'live'; readonly you: number; readonly resumed: boolean }
  | { readonly kind: 'reconnecting'; readonly reason: string; readonly inMs: number }
  /** The server and the page disagree about the protocol: a reload, not a retry (§ 7). */
  | { readonly kind: 'outdated'; readonly reason: string }
  /** The server will not take this name (`NAME`): ask for another. */
  | { readonly kind: 'refused'; readonly code: ErrorCode }
  | { readonly kind: 'closed' };

export interface ClientOptions {
  readonly connect: Connect;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly name: string;
  /** Sampled once a client tick: the input that tick sends. */
  readonly intent: () => Intent;
  /** Every reconciliation, as it happens — the overlay's corrections, the tests' oracle. */
  readonly observe?: (r: Reconciled) => void;
}

/** One frame's picture, for the renderer: positions between the ticks, at the display's rate. */
export interface Frame {
  /** The tick the others are drawn at, fractional. */
  readonly tick: number;
  /** The own tank: predicted, plus what is left of the corrections. */
  readonly me: DrawnTank | null;
  readonly others: readonly DrawnTank[];
  readonly shells: readonly DrawnShell[];
  /** A bit per crate spot holding a crate. */
  readonly crates: number;
  /** The correction still being smoothed away on the own tank, eighths — the overlay's number. */
  readonly offset: Offset;
  /** The ticks of the two views the others are drawn between; `to` is `null` past the newest. */
  readonly from: number | null;
  readonly to: number | null;
}

export interface NetStats {
  readonly rttMs: number | null;
  /** How far behind the newest snapshot the others are drawn, ms. */
  readonly delayMs: number;
  readonly unacked: number;
  /** How many ticks ahead of the server's present the inputs are sent. */
  readonly lead: number;
  readonly corrections: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
}

/** Pings sent 100 ms apart after a welcome, to sync the clock quickly; then one every two
 * seconds (protocol § 3). */
const SYNC_PINGS = 5;
const SYNC_PING_MS = 100;
const PING_MS = 2000;
/** More client ticks than this owed at once — a frozen tab, a debugger — are skipped, not sent. */
const CATCH_UP = 4;
/** First-acknowledgement samples the input lead is judged over — five seconds of them, long enough
 * to have seen the link's worst jitter use the slack. */
const LEAD_WINDOW = 5 * RULES.tickHz;
/** Inputs that waited longer than this on the server, ticks, at the least, are waiting for
 * nothing: the client sends one fewer. */
const LEAD_SLACK = 3;
/** Reconnect delays, ms: doubling from the first, to the last. */
const RETRY_FIRST = 250;
const RETRY_MAX = 4000;
const RETRY_FULL = 5000;
const RETRY_RATE = 1000;

const EMPTY: Frame = {
  tick: 0,
  me: null,
  others: [],
  shells: [],
  crates: 0,
  offset: { x: 0, y: 0 },
  from: null,
  to: null,
};

/** The own tank as the prediction holds it, from a view's tank and its own timers. */
function body(t: Tank, v: View): TankBody {
  return {
    ...t,
    reload: v.self.reload,
    shield: v.self.shield,
    respawn: v.self.respawn,
    score: 0,
  };
}

/**
 * A game client with no DOM: the socket, the handshake, the clock, prediction and reconciliation,
 * the interpolation buffer, and `frame(now)` for the renderer (ROADMAP C0). The socket, timers and
 * clock are handed in, so the page, the load tool and the tests run this same code.
 *
 * **Inputs.** A client tick is the server's present plus a lead, ticked by the server's clock: one
 * input a tick, sampled from `intent`, numbered, sent, applied to the own tank and kept. The server
 * takes a socket's inputs one a tick as they come, so the lead is not a schedule the server follows;
 * the stream's rate is what matters, and running it on the server's clock keeps it the server's rate
 * through any drift of the local one. How long inputs wait on the server shows in how long each takes
 * to be acknowledged: if even the quickest of five seconds' worth waited more than `LEAD_SLACK`
 * ticks (after a stall's burst, say), the client drops a tick to shorten the queue. A queue that runs
 * dry deepens itself — the late input is taken a tick later, and every one after it — so only the
 * shortening is the client's to do. A link that stalls stops the inputs once more are
 * unacknowledged than a round trip and a full queue hold.
 */
export class Client {
  private current: ConnectionState = { kind: 'connecting', attempt: 0 };
  private readonly listeners = new Set<(s: ConnectionState) => void>();
  private socket: Socket | null = null;
  /** Bumped per socket: a late event from a socket already given up on is ignored. */
  private generation = 0;
  private attempt = 0;
  private token: Uint8Array | null = null;
  private you = 0;
  private arena: Arena | null = null;
  private view: View | null = null;
  private rosterNow: readonly RosterEntry[] = [];

  private readonly server = new ServerClock();
  private readonly timeline = new Timeline();
  private prediction: Prediction | null = null;
  private shells: Shells | null = null;

  private seq = 0;
  private sentTick: number | null = null;
  private lead: number | null = null;
  private readonly sentAt = new Map<number, number>();
  private acked = 0;
  private waits: number[] = [];

  private pingId = 0;
  private pings = 0;
  private readonly pingSent = new Map<number, number>();

  private tickTimer: (() => void) | null = null;
  private pingTimer: (() => void) | null = null;
  private retryTimer: (() => void) | null = null;

  private corrections = 0;
  private bytesIn = 0;
  private bytesOut = 0;

  constructor(private readonly opts: ClientOptions) {
    this.open();
  }

  get state(): ConnectionState {
    return this.current;
  }

  /** Subscribe to the connection's states; the returned function unsubscribes. */
  onState(listener: (s: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get roster(): readonly RosterEntry[] {
    return this.rosterNow;
  }

  /** The newest view held — what the server last said this client may see. */
  get latest(): View | null {
    return this.view;
  }

  /** The server's present by this client's clock at local time `now`, in ticks; `null` before a
   * pong has been heard. */
  serverTick(now: number): number | null {
    return this.server.synced ? this.server.at(now) : null;
  }

  stats(): NetStats {
    return {
      rttMs: this.server.rtt(),
      delayMs: this.timeline.delay() * TICK_MS,
      unacked: this.prediction?.unacked ?? 0,
      lead: this.lead ?? 0,
      corrections: this.corrections,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
    };
  }

  /** The picture at local time `now`: the own tank predicted, everyone else interpolated. */
  frame(now: number): Frame {
    const view = this.view;
    if (this.current.kind !== 'live' || !view || !this.prediction || !this.shells) return EMPTY;
    const serverNow = this.server.synced ? this.server.at(now) : view.tick;
    const b = this.timeline.sample(serverNow);
    const offset = this.prediction.offset(now);
    return {
      tick: b?.tick ?? view.tick,
      me: this.me(view, serverNow, offset),
      others: b ? others(b, this.you) : [],
      shells: b ? this.shells.draw(b) : [],
      crates: b?.from.crates ?? view.crates,
      offset,
      from: b?.from.tick ?? null,
      to: b?.to?.tick ?? null,
    };
  }

  /** Leave for good. */
  close(): void {
    this.stop();
    this.generation++;
    this.socket?.close();
    this.socket = null;
    this.set({ kind: 'closed' });
  }

  // ── the connection ─────────────────────────────────────────────────────────────────────────────

  private set(s: ConnectionState): void {
    this.current = s;
    for (const l of this.listeners) l(s);
  }

  private open(): void {
    this.retryTimer = null;
    const generation = ++this.generation;
    const mine = (fn: () => void) => () => {
      if (generation === this.generation) fn();
    };
    this.set({ kind: 'connecting', attempt: this.attempt });
    this.socket = this.opts.connect({
      open: mine(() => this.opened()),
      message: (frame) => {
        if (generation === this.generation) this.received(frame);
      },
      close: mine(() => this.retry('the socket closed')),
    });
  }

  private opened(): void {
    this.send({
      type: 'hello',
      version: PROTOCOL_VERSION,
      token: this.token,
      name: this.opts.name,
    });
    this.set({ kind: 'joining' });
  }

  private send(msg: ClientMessage): void {
    const frame = encodeClient(msg);
    this.bytesOut += frame.length;
    this.socket?.send(frame);
  }

  private received(frame: Uint8Array | null): void {
    if (frame === null) return this.outdated('a text frame');
    this.bytesIn += frame.length;
    const d = decodeServer(frame);
    // A frame this page cannot read is deploy skew (protocol § 7): say so, do not retry blindly.
    if (!d.ok) return this.outdated(`an undecodable frame: ${d.reason}`);
    this.handle(d.value);
  }

  private handle(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        return this.welcome(m);
      case 'roster':
        this.rosterNow = m.entries;
        return;
      case 'pong': {
        const sent = this.pingSent.get(m.id);
        if (sent === undefined) return;
        this.pingSent.delete(m.id);
        this.server.sample(sent, this.opts.clock.now(), m.tick, m.offsetUs);
        return;
      }
      case 'snapshot':
        return this.snapshot(m);
      case 'error':
        switch (m.code) {
          case 'VERSION':
          case 'MALFORMED':
            return this.outdated(`the server refused the page: ${m.code}`);
          case 'NAME':
            this.stop();
            this.generation++;
            this.socket?.close();
            return this.set({ kind: 'refused', code: m.code });
          case 'FULL':
            return this.retry('the server is full', RETRY_FULL);
          case 'RATE':
            return this.retry('too many inputs', RETRY_RATE);
        }
    }
  }

  private welcome(m: Welcome): void {
    const arena = ARENAS[m.arena];
    if (m.version !== PROTOCOL_VERSION || !arena) {
      return this.outdated(`the server speaks version ${m.version}, arena ${m.arena}`);
    }
    this.stop();
    if (!m.resumed || this.arena !== arena) this.server.reset();
    this.arena = arena;
    this.you = m.you;
    this.token = m.token;
    this.attempt = 0;
    // A socket starts afresh (protocol § 3): its first snapshot is against nothing, its `seq` from 1.
    this.view = null;
    this.timeline.reset();
    this.prediction = new Prediction(arena);
    this.shells = new Shells(arena);
    this.seq = 0;
    this.sentTick = null;
    this.lead = null;
    this.sentAt.clear();
    this.acked = 0;
    this.waits = [];
    this.pings = 0;
    this.pingSent.clear();
    this.set({ kind: 'live', you: m.you, resumed: m.resumed });
    this.ping();
    this.wake();
  }

  private snapshot(m: Snapshot): void {
    const r = apply(this.view, m);
    // Not a delta of the view held: the client does not guess; a fresh socket starts against
    // nothing (protocol § 5.2).
    if (!r.ok) return this.retry(`a snapshot not of its base: ${r.reason}`, 0);
    const view = r.value;
    this.view = view;
    const now = this.opts.clock.now();
    this.timeline.received(view, this.server.synced ? this.server.at(now) : null);

    const own = view.tanks.find((t) => t.id === this.you);
    if (own && this.prediction) {
      const rec = this.prediction.reconcile(
        body(own, view),
        view.ack,
        view.tick,
        now,
        this.movers(view),
      );
      if (rec.moved > 0) this.corrections++;
      this.opts.observe?.(rec);
    }
    if (view.ack > this.acked) {
      this.firstAck(view.ack, now);
      this.acked = view.ack;
    }
  }

  /** An input acknowledged for the first time: how long it waited on the server, past a round trip. */
  private firstAck(ack: number, now: number): void {
    const sent = this.sentAt.get(ack);
    for (const seq of this.sentAt.keys()) if (seq <= ack) this.sentAt.delete(seq);
    const rtt = this.server.rtt();
    if (sent === undefined || rtt === null || this.lead === null) return;
    this.waits.push((now - sent - rtt) / TICK_MS);
    if (this.waits.length < LEAD_WINDOW) return;
    if (Math.min(...this.waits) > LEAD_SLACK) this.lead--;
    this.waits = [];
  }

  private outdated(reason: string): void {
    this.stop();
    this.generation++;
    this.socket?.close();
    this.socket = null;
    this.set({ kind: 'outdated', reason });
  }

  /** Close this socket and open another after a pause, with the token to take the tank back. */
  private retry(reason: string, inMs?: number): void {
    const k = this.current.kind;
    if (k === 'closed' || k === 'outdated' || k === 'refused') return;
    this.stop();
    this.generation++;
    this.socket?.close();
    this.socket = null;
    const wait = inMs ?? Math.min(RETRY_MAX, RETRY_FIRST * 2 ** this.attempt);
    this.attempt++;
    this.set({ kind: 'reconnecting', reason, inMs: wait });
    this.retryTimer = this.opts.timers.after(wait, () => this.open());
  }

  private stop(): void {
    this.tickTimer?.();
    this.pingTimer?.();
    this.retryTimer?.();
    this.tickTimer = null;
    this.pingTimer = null;
    this.retryTimer = null;
  }

  // ── the clock and the inputs ───────────────────────────────────────────────────────────────────

  private ping(): void {
    const now = this.opts.clock.now();
    this.pingId = (this.pingId + 1) & 0xffff;
    for (const [id, at] of this.pingSent) if (now - at > 10_000) this.pingSent.delete(id);
    this.pingSent.set(this.pingId, now);
    this.send({ type: 'ping', id: this.pingId });
    this.pings++;
    this.pingTimer = this.opts.timers.after(this.pings < SYNC_PINGS ? SYNC_PING_MS : PING_MS, () =>
      this.ping(),
    );
  }

  /**
   * A client tick, or several: one input for each tick the client's clock — the server's present
   * plus the lead — has crossed since the last. Before the clock has a sample and the own tank a
   * snapshot there is nothing to tick against.
   */
  private wake(): void {
    this.tickTimer = null;
    const prediction = this.prediction;
    const rtt = this.server.rtt();
    if (!prediction || !prediction.tank || rtt === null) {
      this.tickTimer = this.opts.timers.after(TICK_MS, () => this.wake());
      return;
    }
    const now = this.opts.clock.now();
    this.lead ??= Math.ceil(rtt / 2 / TICK_MS) + 1;
    const at = this.server.at(now) + this.lead;
    const target = Math.floor(at);
    if (this.sentTick === null || Math.abs(target - this.sentTick) > CATCH_UP) {
      this.sentTick = target - 1;
    }
    // A stalled link: past a round trip of inputs and a full queue on the server, more would only
    // be dropped there (protocol § 4.2). The tank waits for the link.
    const cap = Math.ceil(rtt / TICK_MS) + RULES.inputQueueMax + 2;
    while (this.sentTick < target) {
      this.sentTick++;
      if (prediction.unacked >= cap) continue;
      const want = this.opts.intent();
      const input: Input = {
        type: 'input',
        seq: ++this.seq,
        aim: wrapDir(Math.round(want.aim)),
        move: want.move === null ? null : wrapDir(Math.round(want.move)),
        fire: want.fire,
      };
      this.send(input);
      this.sentAt.set(input.seq, now);
      prediction.push(input);
    }
    const ms = (this.sentTick + 1 - at) * TICK_MS;
    this.tickTimer = this.opts.timers.after(Math.max(1, ms + 0.25), () => this.wake());
  }

  /** The other live tanks in a view, each with the step it took since the view a tick before. */
  private movers(view: View): Mover[] {
    const before = this.timeline.held().at(-2);
    const was = new Map(
      before && before.tick === view.tick - 1 ? before.tanks.map((t) => [t.id, t]) : [],
    );
    return view.tanks
      .filter((t) => t.alive && t.id !== this.you)
      .map((t) => {
        const p = was.get(t.id);
        const vx = p?.alive ? t.x - p.x : 0;
        const vy = p?.alive ? t.y - p.y : 0;
        const driven = vx * vx + vy * vy <= RULES.tankSpeed * RULES.tankSpeed;
        return {
          x: t.x,
          y: t.y,
          vx: driven ? vx : 0,
          vy: driven ? vy : 0,
          ahead: t.id < this.you,
        };
      });
  }

  /** The own tank drawn: between the last two predicted ticks by how far the client's clock is
   * into the newest, plus what is left of the corrections. Its hit points and shield are the
   * server's. */
  private me(view: View, serverNow: number, offset: Offset): DrawnTank | null {
    const own = view.tanks.find((t) => t.id === this.you);
    const tank = this.prediction?.tank;
    const prev = this.prediction?.previous;
    if (!own || !tank || !prev) return own ? { ...own } : null;
    const t =
      this.sentTick === null || this.lead === null
        ? 1
        : Math.max(0, Math.min(1, serverNow + this.lead - this.sentTick));
    const drawn = between({ ...own, ...pose(prev) }, { ...own, ...pose(tank) }, t);
    return {
      ...drawn,
      x: drawn.x + offset.x,
      y: drawn.y + offset.y,
      turret: lerpDir(prev.turret, tank.turret, t),
    };
  }
}

function pose(t: TankBody) {
  return { x: t.x, y: t.y, hull: t.hull, turret: t.turret, alive: t.alive };
}

/** A client, connecting at once. */
export function createClient(opts: ClientOptions): Client {
  return new Client(opts);
}
