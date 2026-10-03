/**
 * @ricochet/sim — the room, one tick at a time: `step(world, commands) → { world, events }` at a
 * fixed 1/30 s. Tanks drive and slide along walls, shells fly and bounce once, hits hurt and kill,
 * the dead respawn shielded, crates heal. Pure and exact (CLAUDE.md § Purity and exactness): the
 * same world and commands give the same world, to the bit, in any engine — which is what lets a
 * client predict its own tank with `stepTank` and fly its shells with `stepShell`. `view` is the one
 * door to the wire.
 */
export { createWorld, join, leave, step } from './step.js';
export type { Stepped } from './step.js';
export { blocked, stepTank } from './tank.js';
export { fly, flyTick, stepShell } from './shell.js';
export type { Fate } from './shell.js';
export { view } from './view.js';
export { arenaOf } from './world.js';
export type { Command, ShellBody, TankBody, World } from './world.js';
