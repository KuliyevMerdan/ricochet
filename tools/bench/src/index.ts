/**
 * @ricochet/bench — rooms of bots stepped headless as fast as they go: the server's tick timed, the
 * bytes each player would be sent counted, full and delta, at 30 Hz and 15, deflated and not.
 * `pnpm bench` runs `main.ts` and writes `docs/bench/results.md`.
 */
export { BotRoom, MIX } from './arena.js';
export { bench, quantiles } from './bench.js';
export type { Bandwidth, BenchOptions, BenchResult, Quantiles } from './bench.js';
