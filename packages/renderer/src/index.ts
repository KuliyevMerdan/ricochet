/**
 * @ricochet/renderer — the arena in Phaser (ROADMAP C1): textures generated at boot into one atlas,
 * the floor and walls, tanks as a hull and a turret tinted per player, shells, crates, the camera on
 * the own tank with a lead toward the aim, the minimap, pooled particles and synthesised sounds. It
 * draws pictures, not messages: no `protocol` (CLAUDE.md § Dependency rules).
 */
export { mountArena } from './mount.js';
export type { ArenaView, MountOptions } from './mount.js';
export type { ArenaPicture, Picture, Point, ShellPicture, TankPicture } from './picture.js';
export { PX, radians } from './picture.js';
export { CameraRig, LEAD, VIEW_HALF, zoomFor } from './view.js';
export { ShellWatch } from './effects.js';
export type { ShellEvents } from './effects.js';
export { TANKS, tint } from './palette.js';
export type { EffectPicture } from './picture.js';
