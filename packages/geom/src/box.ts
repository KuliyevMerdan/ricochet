import type { Face } from './dir.js';

/** An axis-aligned box in eighths, `x0 < x1`, `y0 < y1`, edges included. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Whether a circle and a box overlap — touching is not overlapping. Integers in, squared distances
 * compared, no root taken.
 */
export function circleOverlapsBox(cx: number, cy: number, r: number, box: Box): boolean {
  const nx = cx < box.x0 ? box.x0 : cx > box.x1 ? box.x1 : cx;
  const ny = cy < box.y0 ? box.y0 : cy > box.y1 ? box.y1 : cy;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** A fraction `num / den` with `den > 0` — a time along a sweep, kept exact. */
export interface Fraction {
  readonly num: number;
  readonly den: number;
}

/** `a < b` for fractions with positive denominators, by cross-multiplication. Exact for integers. */
function less(a: Fraction, b: Fraction): boolean {
  return a.num * b.den < b.num * a.den;
}

function equal(a: Fraction, b: Fraction): boolean {
  return a.num * b.den === b.num * a.den;
}

function frac(num: number, den: number): Fraction {
  return den < 0 ? { num: -num, den: -den } : { num, den };
}

/** Where a sweep first touches a box: the time along it, and the face it met. */
export interface Contact {
  /** In `[0, 1]`, exact. */
  readonly t: Fraction;
  readonly face: Face;
}

/** The interval of `t` in which one coordinate lies within a slab; `null` if never. */
function slab(
  p: number,
  d: number,
  lo: number,
  hi: number,
): { enter: Fraction | null; exit: Fraction | null } | null {
  if (d === 0) return p >= lo && p <= hi ? { enter: null, exit: null } : null;
  const a = frac(lo - p, d);
  const b = frac(hi - p, d);
  return less(b, a) ? { enter: b, exit: a } : { enter: a, exit: b };
}

/**
 * A circle of radius `r` moving from `(px, py)` by `(dx, dy)` in one tick, against a box: the first
 * moment it touches the box, or `null` if it does not within the move. The box is grown by `r` on
 * every side (square corners — a shell grazing a wall's corner bounces as off the face it reached
 * last) and the segment is tested against it by slabs, every time a fraction of integers and every
 * comparison a cross-multiplication — so nothing a fast shell does can step over a thin wall, and
 * the answer is the same in every engine.
 *
 * A circle that already overlaps the grown box at the start returns `null`: a sweep finds entries,
 * and the simulation never lets a shell start inside a wall.
 */
export function sweep(
  px: number,
  py: number,
  dx: number,
  dy: number,
  r: number,
  box: Box,
): Contact | null {
  const sx = slab(px, dx, box.x0 - r, box.x1 + r);
  const sy = slab(py, dy, box.y0 - r, box.y1 + r);
  if (!sx || !sy) return null;

  // The entry is the later of the two slabs' entries; a slab without one (no motion along that
  // axis, already within it) imposes none.
  let enter: Fraction | null = null;
  let face: Face = 'x';
  if (sx.enter && sy.enter) {
    if (equal(sx.enter, sy.enter)) {
      enter = sx.enter;
      face = 'corner';
    } else if (less(sy.enter, sx.enter)) {
      enter = sx.enter;
      face = 'x';
    } else {
      enter = sy.enter;
      face = 'y';
    }
  } else if (sx.enter) {
    enter = sx.enter;
    face = 'x';
  } else if (sy.enter) {
    enter = sy.enter;
    face = 'y';
  }
  if (!enter) return null; // within both slabs throughout: inside from the start

  const zero = { num: 0, den: 1 };
  const one = { num: 1, den: 1 };
  if (less(enter, zero) || less(one, enter)) return null; // entered before the move, or after it

  const exits = [sx.exit, sy.exit].filter((e): e is Fraction => e !== null);
  if (exits.some((exit) => less(exit, enter))) return null; // the slabs never overlap in time
  return { t: enter, face };
}

/** The point at time `t` along a move, rounded half away from zero to whole eighths. */
export function at(p: number, d: number, t: Fraction): number {
  const x = (d * t.num) / t.den;
  return p + (x < 0 ? -Math.round(-x) : Math.round(x));
}
