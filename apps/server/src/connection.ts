import { PROTOCOL_VERSION, RULES, decodeClient, encodeServer } from '@ricochet/protocol';
import type { ErrorCode } from '@ricochet/protocol';
import type { Lobby } from './lobby.js';
import type { Peer, Player, Room } from './room.js';

/** The network lab's hold on a socket (docs/protocol.md § 3.1) — `Link`, on a server with the lab. */
export interface LabControl {
  set(faults: { readonly latencyMs: number; readonly jitterMs: number }): void;
  stall(ms: number): void;
}

/** What a connection needs of its socket. */
export interface Socket extends Peer {
  /** Send an `error` and close. */
  refuse(code: ErrorCode): void;
  /** The socket's lab, or `null` on a server without one — where `lab` and `stall` are ignored. */
  readonly link: LabControl | null;
}

export interface ConnectionClock {
  now(): number;
  /** The global tick that last ran, and how far past its deadline we are, ms. */
  phase(): { tick: number; offsetMs: number };
}

/** Malformed frames a socket may send before it is closed (protocol invariant 3). */
const MALFORMED_LIMIT = 3;
/** Inputs a second, twice the tick rate — past it, `RATE` (protocol § 7). */
const INPUT_RATE_LIMIT = 2 * RULES.tickHz;

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * One socket's side of the protocol: `hello` first, then inputs and pings — and, on a server with
 * the network lab, `lab` and `stall`, which touch only this socket. Frames are decoded before they
 * are believed; a malformed one counts against the socket, three close it; a name the rules refuse
 * is `NAME`, a wrong version `VERSION`, a flood of inputs `RATE`.
 */
export class Connection {
  private room: Room | null = null;
  private player: Player | null = null;
  private malformed = 0;
  private windowStart = 0;
  private inputs = 0;
  private done = false;

  constructor(
    private readonly socket: Socket,
    private readonly lobby: Lobby,
    private readonly clock: ConnectionClock,
  ) {
    this.windowStart = clock.now();
  }

  get welcomed(): boolean {
    return this.player !== null;
  }

  /** A frame arrived; `null` for a text frame, which this protocol never sends. */
  receive(frame: Uint8Array | null): void {
    if (this.done) return;
    const decoded = frame === null ? null : decodeClient(frame);
    if (!decoded || !decoded.ok) {
      const reason = decoded && !decoded.ok ? decoded.reason : 'a text frame';
      if (!this.player && frame?.[0] === 0x01 && /name/.test(reason)) return this.refuse('NAME');
      if (!this.player) return this.refuse('MALFORMED');
      if (++this.malformed >= MALFORMED_LIMIT) this.refuse('MALFORMED');
      return;
    }
    const msg = decoded.value;

    if (!this.player) {
      if (msg.type !== 'hello') return this.refuse('MALFORMED');
      if (msg.version !== PROTOCOL_VERSION) return this.refuse('VERSION');
      const entered = this.lobby.enter(msg, msg.token ? hex(msg.token) : null, this.socket);
      if (!entered.ok) return this.refuse(entered.code);
      this.room = entered.room;
      this.player = entered.player;
      this.socket.send(
        encodeServer({
          type: 'welcome',
          version: PROTOCOL_VERSION,
          you: entered.player.id,
          token: Uint8Array.from(entered.player.token.match(/../g) ?? [], (h) => parseInt(h, 16)),
          tick: entered.room.world.tick,
          resumed: entered.resumed,
          arena: entered.room.world.arena,
        }),
      );
      entered.room.broadcastRoster();
      return;
    }

    switch (msg.type) {
      case 'hello':
        if (++this.malformed >= MALFORMED_LIMIT) this.refuse('MALFORMED');
        return;
      case 'input': {
        const now = this.clock.now();
        if (now - this.windowStart >= 1000) {
          this.windowStart = now;
          this.inputs = 0;
        }
        if (++this.inputs > INPUT_RATE_LIMIT) return this.refuse('RATE');
        this.room?.input(this.player, msg);
        return;
      }
      case 'ping': {
        const { tick, offsetMs } = this.clock.phase();
        const room = this.room;
        const offsetUs = Math.min(
          Math.max(0, Math.round(offsetMs * 1000)),
          Math.ceil(1e6 / RULES.tickHz) - 1,
        );
        this.socket.send(
          encodeServer({
            type: 'pong',
            id: msg.id,
            tick: room ? tick - room.openedAt : tick,
            offsetUs,
          }),
        );
        return;
      }
      case 'lab':
        this.socket.link?.set({ latencyMs: msg.latencyMs, jitterMs: msg.jitterMs });
        return;
      case 'stall':
        this.socket.link?.stall(msg.ms);
        return;
    }
  }

  /** The socket closed, for whatever reason. */
  closed(): void {
    if (this.done) return;
    this.done = true;
    if (this.room && this.player) this.lobby.leave(this.room, this.player, this.socket);
  }

  private refuse(code: ErrorCode): void {
    this.socket.refuse(code);
    this.closed();
  }
}
