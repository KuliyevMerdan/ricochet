import { encodeUtf8 } from './utf8.js';

/**
 * Every message on the wire — docs/protocol.md § 4–7. A frame is one binary WebSocket message: a
 * type byte, then its fields, little-endian.
 */

/** Bumped on any change to a message's bytes. The first two bytes of `hello` never change. */
export const PROTOCOL_VERSION = 1;

export const CLIENT_MESSAGES = {
  hello: 0x01,
  input: 0x02,
  ping: 0x03,
  lab: 0x04,
  stall: 0x05,
} as const;

export const SERVER_MESSAGES = {
  welcome: 0x81,
  snapshot: 0x82,
  roster: 0x83,
  pong: 0x84,
  error: 0x85,
} as const;

export const EVENT_TYPES = { shot: 1, hit: 2, kill: 3, crate: 4, spawn: 5 } as const;

export const ERROR_CODES = { VERSION: 1, MALFORMED: 2, NAME: 3, RATE: 4, FULL: 5 } as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** A resume token's length in bytes. */
export const TOKEN_BYTES = 16;

/** A name's limits: code points, and its encoding's bytes. */
export const NAME_MAX_CHARS = 16;
export const NAME_MAX_BYTES = 48;

/** The network lab's bounds (docs/protocol.md § 4.8–4.9): latency added to the round trip, ms;
 * jitter on top of it, ms; a stall's length, ms. */
export const LAB_LIMITS = { latencyMs: 1000, jitterMs: 500, stallMs: 5000 } as const;

// ── client → server ──────────────────────────────────────────────────────────────────────────────

export interface Hello {
  readonly type: 'hello';
  readonly version: number;
  /** The token from an earlier `welcome`, to take back that tank within the grace. */
  readonly token: Uint8Array | null;
  readonly name: string;
}

/**
 * One tick's input. A direction and buttons — never a position (CLAUDE.md § Other rules).
 * `move` is the stick's direction, `null` when the tank should stand.
 */
export interface Input {
  readonly type: 'input';
  /** 1, 2, 3 … per connection; acknowledged in every snapshot as `ack`. */
  readonly seq: number;
  readonly aim: number;
  readonly move: number | null;
  readonly fire: boolean;
}

export interface Ping {
  readonly type: 'ping';
  readonly id: number;
}

/**
 * The network lab (C3): the sender's own link made worse, on the server's side of the socket — so
 * the server's own measure of the round trip sees it, as it would a real one. Nobody else's link is
 * touched. Applied only by a server with the lab enabled; another ignores it.
 */
export interface Lab {
  readonly type: 'lab';
  /** Added to the round trip, half each way. */
  readonly latencyMs: number;
  /** Up to this much more on each frame, drawn afresh per frame — never reordering two. */
  readonly jitterMs: number;
}

/** The sender's link frozen both ways for `ms`, then everything it held delivered, in order. */
export interface Stall {
  readonly type: 'stall';
  readonly ms: number;
}

export type ClientMessage = Hello | Input | Ping | Lab | Stall;

// ── server → client ──────────────────────────────────────────────────────────────────────────────

export interface Welcome {
  readonly type: 'welcome';
  readonly version: number;
  /** Your tank's entity id. */
  readonly you: number;
  readonly token: Uint8Array;
  readonly tick: number;
  /** True when the token in `hello` gave you back your tank. */
  readonly resumed: boolean;
  readonly arena: number;
}

/** What only a tank's own player is told about it. */
export interface SelfState {
  /** Ticks until the next shot is allowed; 0 when it is. */
  readonly reload: number;
  /** This tank's shells in the air. */
  readonly shells: number;
  /** Ticks until respawn; 0 while alive. */
  readonly respawn: number;
  /** Ticks of spawn shield left. */
  readonly shield: number;
}

export interface TankState {
  /** The hull's direction. */
  readonly hull: number;
  /** The turret's direction. */
  readonly turret: number;
  readonly hp: number;
  readonly shield: boolean;
  readonly alive: boolean;
}

export interface Tank extends TankState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/**
 * A shell as the wire carries it: **a starting condition, not a position**. It is sent once, when it
 * enters a client's view, with its state at that snapshot's tick; the client flies it on with
 * `sim`'s own step, to the bit, and is told only when it is gone (docs/protocol.md § 5.3).
 */
export interface Shell {
  readonly id: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  readonly bounced: boolean;
  /** Ticks it has flown. */
  readonly age: number;
}

export type GameEvent =
  | { readonly type: 'shot'; readonly shell: number; readonly tank: number; readonly seq: number }
  | { readonly type: 'hit'; readonly shell: number; readonly victim: number; readonly hp: number }
  | { readonly type: 'kill'; readonly killer: number; readonly victim: number }
  | { readonly type: 'crate'; readonly spot: number; readonly tank: number }
  | { readonly type: 'spawn'; readonly tank: number };

/** A tank's position, absolute or as a small step from the baseline's. */
export type TankPos =
  | { readonly kind: 'abs'; readonly x: number; readonly y: number }
  | { readonly kind: 'rel'; readonly dx: number; readonly dy: number };

/** A tank changed (or new) since the baseline: only what changed. */
export interface TankUpdate {
  readonly id: number;
  readonly pos: TankPos | null;
  readonly state: TankState | null;
}

/** A snapshot as it travels: a delta against the previous snapshot on this socket, or against
 * nothing for the first. */
export interface Snapshot {
  readonly type: 'snapshot';
  readonly tick: number;
  /** The last input `seq` the server applied for you; 0 before any. */
  readonly ack: number;
  readonly self: SelfState;
  /** Which crate spots hold a crate, a bit each. */
  readonly crates: number;
  readonly tanks: { readonly removed: readonly number[]; readonly updated: readonly TankUpdate[] };
  readonly shells: { readonly removed: readonly number[]; readonly added: readonly Shell[] };
  readonly events: readonly GameEvent[];
}

export interface RosterEntry {
  readonly id: number;
  readonly bot: boolean;
  readonly score: number;
  readonly name: string;
}

/** The room's players, names and scores — sent whole whenever any of it changes. */
export interface Roster {
  readonly type: 'roster';
  readonly entries: readonly RosterEntry[];
}

export interface Pong {
  readonly type: 'pong';
  readonly id: number;
  /** The tick the server was in when it answered … */
  readonly tick: number;
  /** … and how far into it, in microseconds. */
  readonly offsetUs: number;
}

export interface ErrorMessage {
  readonly type: 'error';
  readonly code: ErrorCode;
}

export type ServerMessage = Welcome | Snapshot | Roster | Pong | ErrorMessage;

/** Code point ranges no name may contain. */
const REFUSED: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/**
 * Whether a name may be shown: 1–16 code points, at most 48 bytes, no leading or trailing space, no
 * control characters, and none of the characters that reorder text around them.
 */
export function validName(name: string): boolean {
  const chars = [...name];
  if (chars.length < 1 || chars.length > NAME_MAX_CHARS) return false;
  if (encodeUtf8(name).length > NAME_MAX_BYTES) return false;
  if (name.trim() !== name) return false;
  // C0 and C1 controls, DEL, line and paragraph separators, and the bidi embeddings, overrides and
  // isolates: a name that flips the scoreboard's text is a name that lies about who killed whom.
  return chars.every(
    (ch) =>
      !REFUSED.some(([lo, hi]) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp >= lo && cp <= hi;
      }),
  );
}
