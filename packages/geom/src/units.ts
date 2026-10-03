/**
 * The world's integer grid. One **unit** is the game's length (a tank is 24 units in radius); the
 * world, the simulation and the wire all count in **eighths** of a unit, as integers. Every sum and
 * product in `sim` is then an exact integer well inside 2^53, the same in every engine, and the
 * wire's quantisation is not a rounding step but the world's own resolution.
 */
export const EIGHTHS_PER_UNIT = 8;

/** The arena's side, in eighths: 2,048 units. Coordinates run 0 … ARENA_EIGHTHS − 1 — a u16. */
export const ARENA_EIGHTHS = 2048 * EIGHTHS_PER_UNIT;

/** Units to eighths, for constants written in units. */
export function eighths(units: number): number {
  return units * EIGHTHS_PER_UNIT;
}

/**
 * Round half away from zero. `Math.round` rounds half *up* (−2.5 → −2), which would make a velocity
 * and its mirror image differ by one eighth; this keeps `round(−x) === −round(x)`, and never
 * returns −0.
 */
export function roundHalfAway(x: number): number {
  const r = x < 0 ? -Math.round(-x) : Math.round(x);
  return r === 0 ? 0 : r;
}

/** `value` held to `[lo, hi]`. */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}
