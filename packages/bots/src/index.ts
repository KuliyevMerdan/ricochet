/**
 * @ricochet/bots — `decide(view, memory) → { input, memory }`. A bot sees exactly the view a
 * player's client holds and acts only through the inputs a player sends (CLAUDE.md § Dependency
 * rules: it may not import `sim`): it paths round the walls on a grid built once per arena, aims
 * where its target will be with an error that is its difficulty, and banks a shot off a wall when
 * the straight line is blocked. Pure — its randomness is a seed in its memory.
 */
export { SKILLS, createBot, decide } from './decide.js';
export type { BotInput, Memory, Skill } from './decide.js';
export { RANGE, ahead, dirTo, shotAt, trace } from './aim.js';
export type { Leg, Shot } from './aim.js';
export {
  CELL,
  FAR,
  GRID,
  cellAt,
  cellCentre,
  clearPath,
  fieldTo,
  gridOf,
  waypoint,
} from './nav.js';
export type { Grid } from './nav.js';
