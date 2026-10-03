import { RULES } from '@ricochet/protocol';
import type { Hello } from '@ricochet/protocol';
import { Room } from './room.js';
import type { Observer, Peer, Player } from './room.js';

export interface LobbyOptions {
  /** Rooms the server will hold open; past it a newcomer is told `FULL`. */
  readonly maxRooms: number;
  /** A room with no connected player for this many ticks closes — a minute. */
  readonly idleTicks: number;
  /** 16 bytes from a CSPRNG, as hex. */
  token(): string;
  /** A seed for a new room's world. */
  seed(): number;
  /** The global tick that last ran. */
  tick(): number;
  readonly observe?: Observer;
}

export type Entered =
  | { readonly ok: true; readonly room: Room; readonly player: Player; readonly resumed: boolean }
  | { readonly ok: false; readonly code: 'FULL' };

/**
 * Every room on the server, and the tokens that lead back into them. A newcomer goes to the fullest
 * room with a seat — rooms fill rather than scatter one player each — and a new room opens only when
 * none has one.
 */
export class Lobby {
  readonly rooms: Room[] = [];
  private readonly tokens = new Map<string, { room: Room; id: number }>();
  private nextRoom = 1;

  constructor(private readonly opts: LobbyOptions) {}

  enter(hello: Hello, tokenHex: string | null, peer: Peer): Entered {
    if (tokenHex !== null) {
      const found = this.tokens.get(tokenHex);
      const player = found?.room.players.get(found.id);
      if (found && player && this.rooms.includes(found.room)) {
        player.peer?.close();
        found.room.resume(player, peer);
        return { ok: true, room: found.room, player, resumed: true };
      }
      this.tokens.delete(tokenHex);
    }

    let room = this.rooms
      .filter((r) => r.hasSeat)
      .reduce<Room | null>(
        (best, r) => (!best || r.players.size > best.players.size ? r : best),
        null,
      );
    if (!room) {
      if (this.rooms.length >= this.opts.maxRooms) return { ok: false, code: 'FULL' };
      room = new Room(
        this.nextRoom++,
        this.opts.seed(),
        this.opts.tick(),
        this.opts.observe ?? null,
      );
      this.rooms.push(room);
    }
    const token = this.opts.token();
    const player = room.add(hello.name, token, peer);
    this.tokens.set(token, { room, id: player.id });
    return { ok: true, room, player, resumed: false };
  }

  /** A socket closed. Its tank waits out the grace; a superseded socket's close changes nothing. */
  leave(room: Room, player: Player, peer: Peer): void {
    if (player.peer === peer) room.detach(player);
  }

  /** One global tick: every room steps; rooms empty for a minute close, and their tokens with them. */
  tick(): void {
    for (const room of this.rooms) room.tick();
    for (const room of [...this.rooms]) {
      if (room.idleTicks < this.opts.idleTicks) continue;
      this.rooms.splice(this.rooms.indexOf(room), 1);
    }
    for (const [token, { room, id }] of this.tokens) {
      if (!this.rooms.includes(room) || !room.players.has(id)) this.tokens.delete(token);
    }
  }

  players(): number {
    return this.rooms.reduce((n, r) => n + r.players.size, 0);
  }
}

/** A minute of ticks. */
export const IDLE_ROOM_TICKS = 60 * RULES.tickHz;
