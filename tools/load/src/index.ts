/**
 * @ricochet/load — headless clients through `netcode`, played by `bots`, over the wire against a
 * running server (ROADMAP P0). `pnpm load` runs ROADMAP P0's done-when (`main.ts`).
 */
export { BotDriver, PROFILES, ROOM_MIX } from './policy.js';
export type { Profile } from './policy.js';
export { LoadPlayer } from './player.js';
export type { DropRecord, PlayerReport } from './player.js';
export { DOWN_BUDGET, markdown, summarise } from './report.js';
export type { ServerSample, Summary } from './report.js';
