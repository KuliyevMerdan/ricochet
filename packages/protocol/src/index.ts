/**
 * @ricochet/protocol — the binary wire (docs/protocol.md): one encoder and one decoder per side
 * over `DataView`, little-endian; malformed input refused as a value, never thrown; snapshots as
 * deltas between views; and the game's numbers, which the bots play by too. Pure.
 */
export {
  CLIENT_MESSAGES,
  ERROR_CODES,
  EVENT_TYPES,
  LAB_LIMITS,
  NAME_MAX_BYTES,
  NAME_MAX_CHARS,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  TOKEN_BYTES,
  validName,
} from './messages.js';
export type {
  ClientMessage,
  ErrorCode,
  ErrorMessage,
  GameEvent,
  Hello,
  Input,
  Lab,
  Ping,
  Pong,
  Roster,
  RosterEntry,
  SelfState,
  ServerMessage,
  Shell,
  Stall,
  Snapshot,
  Tank,
  TankPos,
  TankState,
  TankUpdate,
  Welcome,
} from './messages.js';
export { decodeClient, decodeServer, encodeClient, encodeServer } from './codec.js';
export { apply, diff } from './view.js';
export type { ShellAt, View } from './view.js';
export { RULES } from './rules.js';
export { ARENAS, ARENA_0 } from './arena.js';
export type { Arena, Point } from './arena.js';
export type { Result } from './result.js';
export { decodeUtf8, encodeUtf8 } from './utf8.js';
