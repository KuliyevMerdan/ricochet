/**
 * @ricochet/geom — integer geometry the client and the server compute to the same bit: the
 * world's grid of eighths, the 1,024-direction table and what is done with it, and circles against
 * axis-aligned boxes, swept so that nothing tunnels. Pure and exact (CLAUDE.md § Purity and
 * exactness): no `Math.sin`, no `**`, no clock.
 */
export { ARENA_EIGHTHS, EIGHTHS_PER_UNIT, clamp, eighths, roundHalfAway } from './units.js';
export {
  DIRECTIONS,
  DIR_SCALE,
  HALF_TURN,
  nearestDir,
  reflect,
  step,
  turnBetween,
  turnToward,
  unit,
  wrapDir,
} from './dir.js';
export type { Face } from './dir.js';
export { at, circleOverlapsBox, sweep } from './box.js';
export type { Box, Contact, Fraction } from './box.js';
export { COS, SIN } from './directions.js';
