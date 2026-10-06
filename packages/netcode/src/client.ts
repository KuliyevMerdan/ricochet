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
  GameEvent,
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
import { Happenings } from './events.js';
import { OwnShells } from './own.js';
import type { Effect, ShotStats } from './own.js';
import { NO_SHOTS } from './own.js';
import { Shells, between, others } from './picture.js';
import type { DrawnShell, DrawnTank } from './picture.js';
import { Prediction } from './prediction.js';
import type { Mover, Offset, Reconciled } from './prediction.js';
import { Replay } from './replay.js';
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

/** The network lab's settings for this client's own link (docs/protocol.md § 3.1). */
export interface LabFaults {
  /** Added to the round trip, ms. */
  readonly latencyMs: number;
  /** Up to this much more on each frame, ms. */
  readonly jitterMs: number;
}

/** How the picture is made: the own tank predicted, the others interpolated — each switchable off
 * in the lab (ROADMAP C3), so the difference is felt rather than explained. */
export interface Modes {
  /** Off: the own tank and its shells drawn as the server's views have them, like everyone else's. */
  readonly predict: boolean;
  /** Off: everyone else drawn where the newest snapshot puts them, a tick at a time. */
  readonly interpolate: boolean;
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
  /** Sampled once a client tick: the input that tick sends. It may consume a press. */
  readonly intent: () => Intent;
  /**
   * The intent now, between ticks, consuming nothing — what the next input will be. The own tank is
   * drawn toward it and a press fires on the frame it lands on, not the next tick. Without it the
   * last input sent stands in.
   */
  readonly peek?: () => Intent;
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
  /** The others' shells at the drawn time; the own, predicted or adopted, in the present — the own
   * under −seq while it was predicted, so a shell keeps its id through its adoption. */
  readonly shells: readonly DrawnShell[];
  /** What to show once, that came due since the last frame (`Effect`). */
  readonly effects: readonly Effect[];
  /** A bit per crate spot holding a crate. */
  readonly crates: number;
  /** The correction still being smoothed away on the own tank, eighths — the overlay's number. */
  readonly offset: Offset;
  /** The ticks of the two views the others are drawn between; `to` is `null` past the newest. */
  readonly from: number | null;
  readonly to: number | null;
  /** Every tank where the newest snapshot puts it — the server ghost (C3): over the own tank the
   * prediction's lead, over the others the interpolation's lag. */
  readonly ghosts: readonly DrawnTank[];
}

export interface NetStats {
  /** The newest pong's round trip, ms. */
  readonly rttMs: number | null;
  /** How unevenly snapshots arrive: the 95th percentile of their lateness past the least, ms. */
  readonly jitterMs: number;
  /** How far behind the newest snapshot the others are drawn, ms. */
  readonly delayMs: number;
  /** How far the newest view held is ahead of the drawn time — the buffer's depth, ms. */
  readonly bufferMs: number;
  /** The newest view's tick; `null` before one. */
  readonly tick: number | null;
  readonly unacked: number;
  /** How many ticks ahead of the server's present the inputs are sent. */
  readonly lead: number;
  readonly corrections: number;
  /** How far the corrections moved the own tank, all told, eighths. */
  readonly corrected: number;
  /** The own shots: predicted, adopted by the server's shell, fizzled, and fired by the server
   * unforeseen; the step at adoption, eighths, mean and worst of the last 100. */
  readonly shots: ShotStats;
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
  effects: [],
  crates: 0,
  offset: { x: 0, y: 0 },
  from: null,
  to: null,
  ghosts: [],
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
  private readonly eventListeners = new Set<(events: readonly GameEvent[], view: View) => void>();
  private socket: Socket | null = null;
  /** Bumped per socket: a late event from a socket already given up on is ignored. */
  private generation = 0;
  private attempt = 0;
  private token: Uint8Array | null = null;
  private ownId = 0;
  private arena: Arena | null = null;
  private view: View | null = null;
  private rosterNow: readonly RosterEntry[] = [];

  private faults: LabFaults = { latencyMs: 0, jitterMs: 0 };
  private drawing: Modes = { predict: true, interpolate: true };

  private readonly server = new ServerClock();
  private readonly timeline = new Timeline();
  private prediction: Prediction | null = null;
  private shells: Shells | null = null;
  private own: OwnShells | null = null;
  private happenings: Happenings | null = null;
  /** Effects that came due between frames — a shot sent, a snapshot's hits — for the next. */
  private effects: Effect[] = [];
  private lastIntent: Intent = { aim: 0, move: null, fire: false };
  private seq = 0;
  private sentTick: number | null = null;
  private lead: number | null = null;
  private readonly sentAt = new Map<number, number>();
  private acked = 0;
  private waits: number[] = [];
  private recentWaits: number[] = [];

  private pingId = 0;
  private pings = 0;
  private readonly pingSent = new Map<number, number>();

  private tickTimer: (() => void) | null = null;
  private pingTimer: (() => void) | null = null;
  private retryTimer: (() => void) | null = null;

  private corrections = 0;
  private corrected = 0;
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

  /** Every snapshot's events as it arrives, with its view — the kill feed, the death screen. */
  onEvents(listener: (events: readonly GameEvent[], view: View) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** The own tank's id once welcomed; 0 before. */
  get you(): number {
    return this.ownId;
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
      rttMs: this.server.latest(),
      jitterMs: this.timeline.jitter() * TICK_MS,
      delayMs: this.timeline.delay() * TICK_MS,
      bufferMs: this.server.synced
        ? this.timeline.ahead(this.server.at(this.opts.clock.now())) * TICK_MS
        : 0,
      tick: this.view?.tick ?? null,
      unacked: this.prediction?.unacked ?? 0,
      lead: this.lead ?? 0,
      corrections: this.corrections,
      corrected: this.corrected,
      shots: this.own?.stats() ?? NO_SHOTS,
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
    };
  }

  /**
   * The picture at local time `now`: the own tank predicted, everyone else interpolated — or, with
   * either switched off (`modes`), the server's views drawn as they come.
   */
  frame(now: number): Frame {
    const view = this.view;
    const { prediction, shells, own, happenings } = this;
    if (this.current.kind !== 'live' || !view || !prediction || !shells || !own || !happenings) {
      return EMPTY;
    }
    const { predict, interpolate } = this.drawing;
    const serverNow = this.server.synced ? this.server.at(now) : view.tick;
    const sampled = this.timeline.sample(serverNow);
    // Interpolation off: everyone where the newest snapshot has them, stepping a tick at a time.
    const b =
      sampled && !interpolate
        ? { ...sampled, tick: view.tick, from: view, to: null, alpha: 0, before: null }
        : sampled;
    const offset = prediction.offset(now);
    const peeked = this.opts.peek?.() ?? null;
    const want = peeked ?? { ...this.lastIntent, fire: false };
    const next = prediction.next(command(want));
    // A press between ticks fires now, as the next input will: the shell that input will carry.
    if (peeked && next?.fires && this.sentTick !== null) {
      own.fire(this.seq + 1, next.after, serverNow, this.ownOut());
    }
    // Prediction off: the own tank is one of the tanks the views hold, drawn as the others are.
    const all = b ? others(b, predict ? this.ownId : 0) : [];
    const me = predict
      ? this.me(view, serverNow, offset, next?.after ?? null, want)
      : (all.find((t) => t.id === this.ownId) ?? null);
    const effects = this.effects;
    this.effects = [];
    const drawn = b ? shells.draw(b, predict ? this.ownId : 0) : [];
    own.draw(serverNow, now, predict ? drawn : [], this.ownOut(effects));
    if (b) happenings.update(this.timeline.held(), b.tick, this.ownId, me, effects, predict);
    return {
      tick: b?.tick ?? view.tick,
      me,
      others: predict ? all : all.filter((t) => t.id !== this.ownId),
      shells: drawn,
      effects,
      crates: b?.from.crates ?? view.crates,
      offset: predict ? offset : { x: 0, y: 0 },
      from: b?.from.tick ?? null,
      to: b?.to?.tick ?? null,
      ghosts: view.tanks.map((t) => ({ ...t })),
    };
  }

  /** Where the own shells' effects go: shown while they are predicted, dropped while the server's
   * views draw them (`Happenings` shows those). */
  private ownOut(into: Effect[] = this.effects): Effect[] {
    return this.drawing.predict ? into : [];
  }

  /** How the picture is made (C3's lab). The prediction runs on underneath either way, so switching
   * it back on is exact at once. */
  get modes(): Modes {
    return this.drawing;
  }

  set modes(m: Modes) {
    this.drawing = { predict: m.predict, interpolate: m.interpolate };
  }

  /** The lab's settings for this client's own link, sent now and after every `welcome` — they live
   * on the server's side of the socket, and a new socket starts clean (docs/protocol.md § 3.1). */
  lab(faults: LabFaults): void {
    const was = this.faults;
    this.faults = { latencyMs: faults.latencyMs, jitterMs: faults.jitterMs };
    if (this.current.kind !== 'live') return;
    this.send({ type: 'lab', ...this.faults });
    // The link just changed: measure it again quickly, as after a welcome.
    if (was.latencyMs !== faults.latencyMs || was.jitterMs !== faults.jitterMs) {
      this.pingTimer?.();
      this.pings = 0;
      this.ping();
    }
  }

  get labFaults(): LabFaults {
    return this.faults;
  }

  /** The lab's stall: this client's own link frozen both ways for `ms`. */
  stall(ms: number): void {
    if (this.current.kind === 'live') this.send({ type: 'stall', ms });
  }

  /** The lab's dropped socket: this end lets go, as a dead link would, and the client reconnects
   * with its token onto the same tank. A close the browser starts is the one a proxy passes on. */
  drop(): void {
    if (this.current.kind === 'live') this.retry('the lab dropped the socket');
  }

  /** The kill replay of the own tank's last death within the views held — the server's truth. */
  replay(): Replay | null {
    return this.arena ? Replay.of(this.timeline.held(), this.ownId, this.arena) : null;
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
    this.ownId = m.you;
    this.token = m.token;
    this.attempt = 0;
    // A socket starts afresh (protocol § 3): its first snapshot is against nothing, its `seq` from 1.
    this.view = null;
    this.timeline.reset();
    this.prediction = new Prediction(arena);
    this.shells = new Shells(arena);
    this.own = new OwnShells(arena);
    this.happenings = new Happenings(arena);
    this.effects = [];
    this.seq = 0;
    this.sentTick = null;
    this.lead = null;
    this.sentAt.clear();
    this.acked = 0;
    this.waits = [];
    this.recentWaits = [];
    this.pings = 0;
    this.pingSent.clear();
    this.set({ kind: 'live', you: m.you, resumed: m.resumed });
    if (this.faults.latencyMs > 0 || this.faults.jitterMs > 0) {
      this.send({ type: 'lab', ...this.faults });
    }
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

    const present = this.server.synced ? this.server.at(now) : view.tick;
    const mine = view.tanks.find((t) => t.id === this.ownId);
    const shots = this.own;
    if (mine && this.prediction && shots) {
      // The own shells first: what they adopt and end decides what the gun may fire.
      shots.snapshot(view, this.ownId, present, now, this.ownOut());
      const rec = this.prediction.reconcile(
        body(mine, view),
        view.ack,
        view.tick,
        now,
        this.movers(view),
        { reload: view.self.reload, shield: view.self.shield },
        // A tick fires (§ 8.1's third step) before the shells in the air fly (its fourth): what
        // counts at the n-th tick is what flew through the one before.
        (n) => shots.aliveAt(view.tick + n - 1),
      );
      for (const seq of rec.unfired) shots.cancel(seq, present, this.ownOut());
      for (const seq of rec.refired) {
        const after = this.prediction.after(seq);
        if (after) shots.fire(seq, after, present, this.ownOut());
      }
      if (rec.moved > 0) this.corrections++;
      if (!rec.snapped) this.corrected += rec.moved;
      this.opts.observe?.(rec);
    }
    if (view.events.length > 0) for (const l of this.eventListeners) l(view.events, view);
    if (view.ack > this.acked) {
      this.firstAck(view.ack, now);
      this.acked = view.ack;
    }
  }

  /** How long an input waits on the server before its tick takes it, ticks — the median of the
   * last second's first acknowledgements, past a round trip. */
  private queueWait(): number {
    const w = [...this.recentWaits].sort((a, b) => a - b);
    return Math.max(0, w[Math.floor(w.length / 2)] ?? 0);
  }

  /** An input acknowledged for the first time: how long it waited on the server, past a round trip. */
  private firstAck(ack: number, now: number): void {
    const sent = this.sentAt.get(ack);
    for (const seq of this.sentAt.keys()) if (seq <= ack) this.sentAt.delete(seq);
    const rtt = this.server.rtt();
    if (sent === undefined || rtt === null || this.lead === null) return;
    const wait = (now - sent - rtt) / TICK_MS;
    this.waits.push(wait);
    this.recentWaits.push(wait);
    if (this.recentWaits.length > RULES.tickHz) this.recentWaits.shift();
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
    // be dropped there (protocol § 4.2). The tank waits for the link. The round trip is the newest
    // as well as the least: a link that just got slower holds more inputs in flight than the least
    // of the last twelve seconds says (C3's lab found the tank stuttering for those twelve).
    const trip = Math.max(rtt, this.server.latest() ?? rtt);
    const cap = Math.ceil(trip / TICK_MS) + RULES.inputQueueMax + 2;
    while (this.sentTick < target) {
      this.sentTick++;
      if (prediction.unacked >= cap) continue;
      const want = this.opts.intent();
      this.lastIntent = want;
      const input: Input = { type: 'input', seq: ++this.seq, ...command(want) };
      this.send(input);
      this.sentAt.set(input.seq, now);
      const fires = prediction.push(input);
      const after = prediction.after(input.seq);
      const present = this.server.at(now);
      if (fires && after) {
        this.own?.fire(input.seq, after, present, this.ownOut());
        const ow = rtt / 2 / TICK_MS;
        this.own?.sent(input.seq, present, ow + this.queueWait(), ow);
      }
      // A shot drawn at the press that this input, sampled since, does not fire.
      if (!fires) this.own?.cancel(input.seq, this.server.at(now), this.ownOut());
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
      .filter((t) => t.alive && t.id !== this.ownId)
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
          ahead: t.id < this.ownId,
        };
      });
  }

  /**
   * The own tank drawn: from the newest predicted tick toward the next — the tank the intent now
   * would make of it — by how far the client's clock is into that tick, plus what is left of the
   * corrections. A key shows on the next frame; when the tick comes and the input carries the same
   * intent, the next tick is where the drawing already was. The turret is the aim now. Hit points
   * and the shield are the server's.
   */
  private me(
    view: View,
    serverNow: number,
    offset: Offset,
    next: TankBody | null,
    want: Intent,
  ): DrawnTank | null {
    const own = view.tanks.find((t) => t.id === this.ownId);
    const tank = this.prediction?.tank;
    if (!own || !tank) return own ? { ...own } : null;
    const t =
      this.sentTick === null || this.lead === null
        ? 0
        : Math.max(0, Math.min(1, serverNow + this.lead - this.sentTick));
    const drawn = between({ ...own, ...pose(tank) }, { ...own, ...pose(next ?? tank) }, t);
    return {
      ...drawn,
      x: drawn.x + offset.x,
      y: drawn.y + offset.y,
      turret: tank.alive ? wrapDir(Math.round(want.aim)) : drawn.turret,
    };
  }
}

/** An intent as the wire carries it: whole directions. */
function command(want: Intent): { aim: number; move: number | null; fire: boolean } {
  return {
    aim: wrapDir(Math.round(want.aim)),
    move: want.move === null ? null : wrapDir(Math.round(want.move)),
    fire: want.fire,
  };
}

function pose(t: TankBody) {
  return { x: t.x, y: t.y, hull: t.hull, turret: t.turret, alive: t.alive };
}

/** A client, connecting at once. */
export function createClient(opts: ClientOptions): Client {
  return new Client(opts);
}
