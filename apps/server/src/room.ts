import { RULES, diff, encodeServer } from '@ricochet/protocol';
import type { GameEvent, Input, RosterEntry, View } from '@ricochet/protocol';
import { createWorld, join, leave, step, view } from '@ricochet/sim';
import type { Command, World } from '@ricochet/sim';

/** What a room needs of a connection: somewhere to send frames, and its measured round trip. */
export interface Peer {
  send(frame: Uint8Array): void;
  /** End the connection — a second socket took this player's tank. */
  close(): void;
  /** The socket's round trip as the server measured it, ms — `null` before the first sample. */
  rttMs(): number | null;
}

export interface Player {
  readonly id: number;
  readonly name: string;
  readonly token: string;
  peer: Peer | null;
  /** Inputs received and not yet applied, in `seq` order. */
  queue: Input[];
  /** The newest `seq` received — older or repeated ones are ignored. */
  received: number;
  /** The last input applied: repeated, without its trigger, when the queue runs dry. */
  last: Input | null;
  /** The last `seq` applied — every snapshot's `ack`. */
  ack: number;
  /** The last view sent on this socket — the next snapshot's baseline (protocol § 5.2). */
  sent: View | null;
  /** The room tick the socket dropped at; `null` while connected. */
  goneAt: number | null;
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
 * One room: a world, its players, their input queues and their sockets' baselines. It knows nothing
 * of WebSockets — a player's socket is a `Peer` — so the whole of a tick is testable without one.
 */
export class Room {
  world: World;
  readonly players = new Map<number, Player>();
  /** Events between ticks (a spawn on joining) that ride the next tick's snapshot. */
  private pending: GameEvent[] = [];
  private nextId = 1;
  /** Ticks in a row with no connected player. */
  idleTicks = 0;

  constructor(
    readonly id: number,
    seed: number,
    /** The global tick this room's tick 0 is — `world.tick = global − openedAt`. */
    readonly openedAt: number,
    private readonly observe: Observer | null = null,
  ) {
    this.world = createWorld(seed);
  }

  get connected(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.peer) n++;
    return n;
  }

  get hasSeat(): boolean {
    return this.players.size < RULES.roomSize;
  }

  /** A new player's tank, spawned at once if a spawn point is free. */
  add(name: string, token: string, peer: Peer): Player {
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
      queue: [],
      received: 0,
      last: null,
      ack: 0,
      sent: null,
      goneAt: null,
    };
    this.players.set(id, player);
    return player;
  }

  /** A socket for a player who dropped within the grace: a fresh baseline, a fresh `seq`. */
  resume(player: Player, peer: Peer): void {
    player.peer = peer;
    player.goneAt = null;
    player.sent = null;
    player.queue = [];
    player.received = 0;
    player.last = null;
    player.ack = 0;
  }

  /** A socket closed: the tank stays, standing still, for `resumeGrace` ticks. */
  detach(player: Player): void {
    player.peer = null;
    player.goneAt = this.world.tick;
    player.sent = null;
    player.queue = [];
  }

  /**
   * An input from a player's socket. A `seq` at or below the newest received is ignored (a socket
   * delivers in order; a repeat is a client bug, not a reason to apply twice); beyond
   * `inputQueueMax` the oldest is dropped and the client will be corrected.
   */
  input(player: Player, msg: Input): void {
    if (msg.seq <= player.received) return;
    player.received = msg.seq;
    player.queue.push(msg);
    if (player.queue.length > RULES.inputQueueMax) player.queue.shift();
  }

  roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      bot: false,
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
    if (!p.peer) return null;
    const next = p.queue.shift();
    const rtt = p.peer.rttMs();
    const lead = rtt === null ? 0 : Math.round(rtt / 2 / (1000 / RULES.tickHz));
    if (next) {
      p.last = next;
      p.ack = next.seq;
      return { aim: next.aim, move: next.move, fire: next.fire, seq: next.seq, lead };
    }
    // A late input: hold the stick and the aim where they were, but not the trigger — a shot the
    // client did not ask for this tick is a shell it never predicted.
    return p.last ? { aim: p.last.aim, move: p.last.move, fire: false } : null;
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

    let rosterChanged = events.some((e) => e.type === 'kill' && e.killer !== e.victim);
    for (const p of [...this.players.values()]) {
      if (p.goneAt !== null && this.world.tick - p.goneAt >= RULES.resumeGrace) {
        this.players.delete(p.id);
        this.world = leave(this.world, p.id);
        rosterChanged = true;
      }
    }
    if (rosterChanged) this.broadcastRoster();

    const views = new Map<number, View>();
    for (const p of this.players.values()) {
      if (!p.peer) continue;
      const v = view(this.world, p.id, events, p.ack);
      p.peer.send(encodeServer(diff(p.sent, v)));
      p.sent = v;
      views.set(p.id, v);
    }
    this.idleTicks = views.size === 0 ? this.idleTicks + 1 : 0;
    this.observe?.({ room: this, world: this.world, events, views });
  }
}
