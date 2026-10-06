/**
 * @ricochet/netcode — the client's side of the wire (ROADMAP C0): the socket and the handshake,
 * the server's clock, the own tank predicted through `sim.stepTank` and reconciled with every
 * snapshot, everyone else interpolated behind an adaptive delay, and `frame(now)` for the renderer.
 * No DOM: the socket, timers and clock are handed in, so the page, the load tool and the tests run
 * the same code.
 */
export { Client, createClient } from './client.js';
export type {
  ClientOptions,
  Clock,
  Connect,
  ConnectionState,
  Frame,
  Intent,
  LabFaults,
  Modes,
  NetStats,
  Socket,
  SocketEvents,
  Timers,
} from './client.js';
export { ServerClock, TICK_MS } from './clock.js';
export { Prediction } from './prediction.js';
export type { Offset, Reconciled } from './prediction.js';
export { Timeline } from './timeline.js';
export type { Between } from './timeline.js';
export type { DrawnShell, DrawnTank } from './picture.js';
export { OwnShells } from './own.js';
export type { Effect } from './own.js';
export { Happenings } from './events.js';
export { gunStep } from './prediction.js';
export type { Gun } from './prediction.js';
export type { ShotStats } from './own.js';
export { Replay, pointAt } from './replay.js';
export type { FatalPath, PathPoint, ReplayPicture } from './replay.js';
