import { SKILLS, createBot, decide } from '@ricochet/bots';
import type { Memory, Skill } from '@ricochet/bots';
import { RULES, diff, encodeServer } from '@ricochet/protocol';
import type { GameEvent, Input, RosterEntry, View } from '@ricochet/protocol';
import { createWorld, join, leave, step, view } from '@ricochet/sim';
import { arenaOf } from '@ricochet/sim';
import type { Command, World } from '@ricochet/sim';

/** What a room needs of a connection: somewhere to send frames, and its measured round trip. */
export interface Peer {
  send(frame: Uint8Array): void;
  /** End the connection — a second socket took this player's tank, or it fell too far behind. */
  close(reason?: string): void;
  /** The socket's round trip as the server measured it, ms — `null` before the first sample. */
  rttMs(): number | null;
  /** Bytes sent and not yet handed to the network — how far behind the client is reading. */
  backlog(): number;
}

export interface Player {
  readonly id: number;
  readonly name: string;
  readonly token: string;
  peer: Peer | null;
  /** A bot's memory; `null` for a person. A bot has no peer and no token, and never drops. */
  bot: Memory | null;
  /** Inputs received and not yet applied, in `seq` order, each with the room's tick when it came —
   * how long it waited is part of its shell's fast-forward (protocol D16). */
  queue: { readonly input: Input; readonly at: number }[];
  /** The newest `seq` received — older or repeated ones are ignored. */
  received: number;
  /** The last `seq` applied — every snapshot's `ack`. */
  ack: number;
  /** The last view sent on this socket — the next snapshot's baseline (protocol § 5.2). */
  sent: View | null;
  /** The room tick the socket dropped at; `null` while connected. */
  goneAt: number | null;
  /** The events of snapshots skipped for a slow socket, for the next one it is sent. */
  carried: GameEvent[];
}

/** What a tick looked like — handed to an observer, for tests and the bench. */
export interface TickRecord {
  readonly room: Room;
  readonly world: World;
  readonly events: readonly GameEvent[];
  /** Every view sent this tick, by player. */
  readonly views: ReadonlyMap<number, View>;
}

export type Observer = (record: TickRecord) => void;

/**
 * A slow socket (ROADMAP P0): past `SKIP_BYTES` unsent its snapshots are skipped, not queued — the
 * next is a delta against the last one sent, so nothing breaks, and the skipped ticks' events ride
 * it (`CARRY_MAX` of them at most). Past `CLOSE_BYTES` the socket is closed and the tank waits out
 * the grace for a better link. A snapshot is ~100 bytes, so the first bound is half a second of a
 * busy room's snapshots held in the server beyond what the network has taken.
 */
export const SKIP_BYTES = 16 * 1024;
export const CLOSE_BYTES = 64 * 1024;
const CARRY_MAX = 64;

/** The bots' names, and the skills they play at — one of each, so a room is a mix, not a mirror. */
const BOTS: readonly (readonly [string, Skill])[] = [
  ['Rook', SKILLS.normal],
  ['Flint', SKILLS.hard],
  ['Rivet', SKILLS.easy],
  ['Ember', SKILLS.normal],
  ['Torque', SKILLS.hard],
  ['Anvil', SKILLS.easy],
  ['Piston', SKILLS.normal],
  ['Havoc', SKILLS.hard],
  ['Brass', SKILLS.easy],
  ['Spark', SKILLS.normal],
  ['Mortar', SKILLS.hard],
  ['Bolt', SKILLS.easy],
];

/**
 * One room: a world, its players, their input queues and their sockets' baselines. It knows nothing
 * of WebSockets — a player's socket is a `Peer` — so the whole of a tick is testable without one.
 */
export class Room {
  world: World;
  readonly players = new Map<number, Player>();
  /** Events between ticks (a spawn on joining) that ride the next tick's snapshot. */
  private pending: GameEvent[] = [];
  /** The last tick's events — what a bot's view carries, as a player's snapshot did. */
  private lastEvents: readonly GameEvent[] = [];
  private nextId = 1;
  /** Ticks in a row with no connected player. */
  idleTicks = 0;

  constructor(
    readonly id: number,
    private readonly seed: number,
    /** The global tick this room's tick 0 is — `world.tick = global − openedAt`. */
    readonly openedAt: number,
    private readonly observe: Observer | null = null,
    /** Bots fill the room to this many tanks and leave as people arrive (`RULES.botsFillTo`). */
    private readonly botsFillTo = 0,
  ) {
    this.world = createWorld(seed);
  }

  get connected(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.peer) n++;
    return n;
  }

  /** People in the room, connected or within their grace — everyone but the bots. */
  get humans(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  get hasSeat(): boolean {
    return this.humans < RULES.roomSize;
  }

  /** A new player's tank, spawned at once if a spawn point is free; a bot leaves to make room. */
  add(name: string, token: string, peer: Peer): Player {
    const player = this.seat(name, token, peer, null);
    this.balance();
    return player;
  }

  private seat(name: string, token: string, peer: Peer | null, bot: Memory | null): Player {
    let id = this.nextId;
    while (this.players.has(id)) id = (id % 0xffff) + 1;
    this.nextId = (id % 0xffff) + 1;
    const r = join(this.world, id);
    this.world = r.world;
    this.pending.push(...r.events);
    const player: Player = {
      id,
      name,
      token,
      peer,
      bot,
      queue: [],
      received: 0,
      ack: 0,
      sent: null,
      goneAt: null,
      carried: [],
    };
    this.players.set(id, player);
    return player;
  }

  /**
   * Bots in or out until they fill the room to `botsFillTo` tanks — never into a seat a person
   * could take. The newest bot leaves first. Whether anyone came or went: the roster changed.
   */
  private balance(): boolean {
    const bots = [...this.players.values()].filter((p) => p.bot);
    const want = Math.max(0, Math.min(this.botsFillTo, RULES.roomSize) - this.humans);
    for (const gone of bots.slice(want).reverse()) {
      this.players.delete(gone.id);
      this.world = leave(this.world, gone.id);
    }
    const names = new Set(bots.slice(0, want).map((p) => p.name));
    let added = 0;
    for (const [name, skill] of BOTS) {
      if (bots.length + added >= want) break;
      if (names.has(name)) continue;
      const p = this.seat(name, '', null, null);
      const seed = (this.seed ^ Math.imul(p.id, 0x9e3779b1)) >>> 0;
      p.bot = createBot(p.id, arenaOf(this.world), seed, skill);
      added++;
    }
    return bots.length !== want;
  }

  /** A socket for a player who dropped within the grace: a fresh baseline, a fresh `seq`. */
  resume(player: Player, peer: Peer): void {
    player.peer = peer;
    player.goneAt = null;
    player.sent = null;
    player.queue = [];
    player.received = 0;
    player.ack = 0;
    player.carried = [];
  }

  /** A socket closed: the tank stays, standing still, for `resumeGrace` ticks. */
  detach(player: Player): void {
    player.peer = null;
    player.goneAt = this.world.tick;
    player.sent = null;
    player.queue = [];
    player.carried = [];
  }

  /**
   * An input from a player's socket. A `seq` at or below the newest received is ignored (a socket
   * delivers in order; a repeat is a client bug, not a reason to apply twice); beyond
   * `inputQueueMax` the oldest is dropped and the client will be corrected.
   */
  input(player: Player, msg: Input): void {
    if (msg.seq <= player.received) return;
    player.received = msg.seq;
    player.queue.push({ input: msg, at: this.world.tick });
    if (player.queue.length > RULES.inputQueueMax) player.queue.shift();
  }

  roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      bot: p.bot !== null,
      score: this.world.tanks.find((t) => t.id === p.id)?.score ?? 0,
      name: p.name,
    }));
  }

  /**
   * Everyone's roster, sent whole. The connection calls it once its `welcome` is out — the roster
   * follows the welcome (protocol § 3) — and the room whenever a score changes or a player goes.
   */
  broadcastRoster(): void {
    const frame = encodeServer({ type: 'roster', entries: this.roster() });
    for (const p of this.players.values()) p.peer?.send(frame);
  }

  /** The command a player's tank runs this tick, and the input it acknowledges. */
  private command(p: Player): Command | null {
    if (p.bot) {
      // A bot is handed the view a player in its seat would hold, and answers with an input.
      const r = decide(view(this.world, p.id, this.lastEvents, 0), p.bot);
      p.bot = r.memory;
      return r.input;
    }
    if (!p.peer) return null;
    const queued = p.queue.shift();
    const next = queued?.input;
    if (!queued || !next) {
      // A late input is not invented (protocol D15): the tank stands this tick. Its client predicted
      // every input it sent and nothing between them, and a tick of standing still is the one tick
      // that changes nothing it predicted — so its prediction stays exact however the link jitters.
      return null;
    }
    p.ack = next.seq;
    // ADR-0002: a shell starts where its shooter's prediction drew it — moved on by half the
    // socket's round trip, which the server measures, and (protocol D16) by the ticks the input
    // waited here, which it counts: it arrived on average half a tick before the next one ran.
    // `sim` caps the sum at `fastForwardMax`.
    const rtt = p.peer.rttMs();
    const waited = this.world.tick + 1 - queued.at - 0.5;
    const lead = rtt === null ? 0 : Math.round(rtt / 2 / (1000 / RULES.tickHz) + waited);
    return { aim: next.aim, move: next.move, fire: next.fire, seq: next.seq, lead };
  }

  /** One tick: step the world, drop the players whose grace ran out, send every snapshot. */
  tick(): void {
    const commands = new Map<number, Command>();
    for (const p of this.players.values()) {
      const c = this.command(p);
      if (c) commands.set(p.id, c);
    }
    const r = step(this.world, commands);
    this.world = r.world;
    const events = [...this.pending, ...r.events];
    this.pending = [];
    this.lastEvents = events;

    let rosterChanged = events.some((e) => e.type === 'kill' && e.killer !== e.victim);
    for (const p of [...this.players.values()]) {
      if (p.goneAt !== null && this.world.tick - p.goneAt >= RULES.resumeGrace) {
        this.players.delete(p.id);
        this.world = leave(this.world, p.id);
        rosterChanged = true;
      }
    }
    if (this.balance()) rosterChanged = true;
    if (rosterChanged) this.broadcastRoster();

    const views = new Map<number, View>();
    for (const p of this.players.values()) {
      if (!p.peer) continue;
      const v = view(this.world, p.id, events, p.ack);
      const backlog = p.peer.backlog();
      if (backlog > CLOSE_BYTES) {
        p.peer.close('too slow');
        this.detach(p);
        continue;
      }
      if (backlog > SKIP_BYTES) {
        p.carried = [...p.carried, ...v.events].slice(-CARRY_MAX);
        continue;
      }
      const sent = p.carried.length > 0 ? { ...v, events: [...p.carried, ...v.events] } : v;
      p.carried = [];
      p.peer.send(encodeServer(diff(p.sent, sent)));
      p.sent = sent;
      views.set(p.id, sent);
    }
    this.idleTicks = views.size === 0 ? this.idleTicks + 1 : 0;
    this.observe?.({ room: this, world: this.world, events, views });
  }
}
