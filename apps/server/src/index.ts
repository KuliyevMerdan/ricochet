/**
 * @ricochet/server — rooms, the 30 Hz tick, input queues, snapshots with interest and deltas, clock
 * sync, the shell's fast-forward and resume tokens. Fastify for `/health` and `/ready`; `ws` for the
 * game at `/play`. The work is in `Room` and `Lobby`, which know nothing of sockets.
 */
export { createServer } from './app.js';
export type { Server, ServerOptions } from './app.js';
export { readConfig } from './config.js';
export type { Config } from './config.js';
export { Lobby } from './lobby.js';
export { Room } from './room.js';
export type { Observer, Peer, Player, TickRecord } from './room.js';
export { Ticker, quantile } from './ticker.js';
