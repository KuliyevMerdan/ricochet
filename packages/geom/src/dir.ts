import { COS, SIN } from './directions.js';
import { roundHalfAway } from './units.js';

/**
 * Directions are integers: a turn is split into 1,024, direction 0 points along +x and 256 along +y
 * (the screen's down, so angles grow clockwise on screen). A direction is a lookup in a committed
 * table, never a call to `Math.sin` — whose last bit ECMAScript leaves to each engine.
 */
export const DIRECTIONS = 1024;

/** The table's scale: `COS[d]` and `SIN[d]` are the cosine and sine times 2^14. */
export const DIR_SCALE = 1 << 14;

/** Half a turn. */
export const HALF_TURN = DIRECTIONS / 2;

/** Any integer, as a direction in `[0, 1024)`. */
export function wrapDir(d: number): number {
  return ((d % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}

/** The table's entry for `d` — `[cos, sin]` times 2^14. */
export function unit(d: number): readonly [number, number] {
  const i = wrapDir(d);
  return [COS[i] ?? 0, SIN[i] ?? 0];
}

/**
 * One tick's displacement at `speed` eighths per tick in direction `d`, in whole eighths. The
 * product is an integer and the division a power of two, so both are exact; the rounding is half
 * away from zero, so the displacement in a direction's mirror image is this one with a component
 * negated.
 */
export function step(d: number, speed: number): readonly [number, number] {
  const [c, s] = unit(d);
  return [roundHalfAway((c * speed) / DIR_SCALE), roundHalfAway((s * speed) / DIR_SCALE)];
}

/** The signed shortest turn from `from` to `to`, in `(−512, 512]`. */
export function turnBetween(from: number, to: number): number {
  const diff = wrapDir(to - from);
  return diff > HALF_TURN ? diff - DIRECTIONS : diff;
}

/** `from` turned toward `to` by at most `maxStep` directions. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const diff = turnBetween(from, to);
  if (diff > maxStep) return wrapDir(from + maxStep);
  if (diff < -maxStep) return wrapDir(from - maxStep);
  return wrapDir(to);
}

/** Which face of an axis-aligned box a moving point met — and so which component reflects. */
export type Face = 'x' | 'y' | 'corner';

/**
 * `d` reflected off a face: an `x` face (a wall's left or right side) negates the x component, a
 * `y` face the y component, a corner both. Exact on the index, and — because the table is built
 * symmetric — exact on the vector it names.
 */
export function reflect(d: number, face: Face): number {
  switch (face) {
    case 'x':
      return wrapDir(HALF_TURN - d);
    case 'y':
      return wrapDir(-d);
    case 'corner':
      return wrapDir(d + HALF_TURN);
  }
}

/**
 * The direction nearest to the vector `(x, y)`, or `null` for the zero vector — how a client turns a
 * mouse offset or a stick's deflection into a direction without `Math.atan2`. Among the directions
 * pointing the vector's way (a positive dot product), the one with the smallest cross product wins:
 * the cross grows with the sine of the angle between them, steep where the dot is flat, so the
 * table's rounding cannot blur the axes. On a tie, the lower index.
 */
export function nearestDir(x: number, y: number): number | null {
  if (x === 0 && y === 0) return null;
  let best = 0;
  let bestCross = Infinity;
  for (let d = 0; d < DIRECTIONS; d++) {
    const c = COS[d] ?? 0;
    const s = SIN[d] ?? 0;
    if (c * x + s * y <= 0) continue;
    const cross = Math.abs(c * y - s * x);
    if (cross < bestCross) {
      bestCross = cross;
      best = d;
    }
  }
  return best;
}
