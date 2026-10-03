import { DIRECTIONS, at, reflect, step, sweep, wrapDir } from '@ricochet/geom';
import type { Face, Fraction } from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena, Point } from '@ricochet/protocol';

/**
 * How a bot shoots: where its target will be when a shell gets there, and which direction — straight,
 * or off one wall — puts a shell there. A bot is pure but not exact (CLAUDE.md § Purity and
 * exactness): what it computes is an input, not a world, and an input may be computed any way at all.
 * It flies its candidate shells with `geom`, the way the server will, so a bank shot it takes is one
 * that would land on the walls as they are.
 */

/** How far a shell goes in its life: the muzzle at once, then a tick's flight per tick. */
export const RANGE = RULES.muzzle + RULES.shellLife * RULES.shellSpeed;
/** A shell ends in a tank whose centre it passes within this of. */
const REACH = RULES.tankRadius + RULES.shellRadius;
/** What a bot counts as a hit when it plans a shot: well inside the reach, to allow for its guess. */
const AIM_REACH = (REACH * 3) / 4;
/** How clear of its own tank a bot wants its ricochet to pass. */
const SELF_CLEARANCE = REACH + 2 * RULES.tankSpeed;

/** The direction of a vector, to the nearest of the 1,024. */
export function dirTo(dx: number, dy: number): number {
  return wrapDir(Math.round((Math.atan2(dy, dx) * DIRECTIONS) / (2 * Math.PI)));
}

/** One straight stretch of a shell's flight, and how far the shell had flown when it began it. */
export interface Leg {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly from: number;
}

const less = (a: Fraction, b: Fraction) => a.num * b.den < b.num * a.den;

/**
 * A shell's path from `(x, y)` along `dir` for `distance` eighths, as the server flies it with no
 * tanks: straight to its first wall, off it once by `geom.reflect`, and on to its second — at most
 * two legs.
 */
export function trace(arena: Arena, x: number, y: number, dir: number, distance: number): Leg[] {
  const legs: Leg[] = [];
  const r = RULES.shellRadius;
  let px = x;
  let py = y;
  let d = dir;
  let remaining = distance;
  let flown = 0;
  for (let leg = 0; leg < 2 && remaining > 0; leg++) {
    const [dx, dy] = step(d, remaining);
    let t: Fraction | null = null;
    let faces = new Set<Face>();
    let ex = px + dx;
    let ey = py + dy;
    for (const w of arena.walls) {
      const c = sweep(px, py, dx, dy, r, w);
      if (!c || (t && less(t, c.t))) continue;
      if (!t || less(c.t, t)) {
        t = c.t;
        faces = new Set();
        ex = at(px, dx, c.t);
        ey = at(py, dy, c.t);
      }
      faces.add(c.face);
      if (c.face !== 'y') ex = dx > 0 ? w.x0 - r : w.x1 + r;
      if (c.face !== 'x') ey = dy > 0 ? w.y0 - r : w.y1 + r;
    }
    legs.push({ x0: px, y0: py, x1: ex, y1: ey, from: flown });
    if (!t) break;
    const length = Math.sqrt((ex - px) * (ex - px) + (ey - py) * (ey - py));
    flown += length;
    remaining -= Math.round((remaining * t.num) / t.den);
    const face: Face =
      faces.has('corner') || (faces.has('x') && faces.has('y'))
        ? 'corner'
        : faces.has('x')
          ? 'x'
          : 'y';
    d = reflect(d, face);
    px = ex;
    py = ey;
  }
  return legs;
}

/** The closest a leg comes to a point: the squared distance, and how far the shell had flown there. */
export function closest(leg: Leg, p: Point): { readonly d2: number; readonly along: number } {
  const dx = leg.x1 - leg.x0;
  const dy = leg.y1 - leg.y0;
  const len2 = dx * dx + dy * dy;
  const u =
    len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - leg.x0) * dx + (p.y - leg.y0) * dy) / len2));
  const cx = leg.x0 + u * dx - p.x;
  const cy = leg.y0 + u * dy - p.y;
  return { d2: cx * cx + cy * cy, along: leg.from + u * Math.sqrt(len2) };
}

/**
 * Where a tank at `p`, moving `v` eighths a tick, will be when a shell that flies `path` eighths to
 * it gets there. In the tick a bot fires, every tank drives before the shell is born (protocol
 * § 8.1), the shell covers the muzzle at once and then `shellSpeed` a tick — so a target `k` ticks
 * of flight away has driven `k + 1` ticks by then.
 */
export function ahead(p: Point, v: Point, path: number): Point {
  const k = Math.max(0, (path - RULES.muzzle) / RULES.shellSpeed);
  return { x: p.x + v.x * (k + 1), y: p.y + v.y * (k + 1) };
}

/** A line a shell's centre may reflect about — a wall's face pushed out by a shell's radius. */
interface Mirror {
  readonly axis: 'x' | 'y';
  readonly at: number;
  /** Which side of the line the shooter and the target must both be on. */
  readonly side: -1 | 1;
}

const mirrored = (m: Mirror, p: Point): Point =>
  m.axis === 'x' ? { x: 2 * m.at - p.x, y: p.y } : { x: p.x, y: 2 * m.at - p.y };

const onSide = (m: Mirror, p: Point) => ((m.axis === 'x' ? p.x : p.y) - m.at) * m.side > 0;

const mirrorsOf = new WeakMap<Arena, readonly Mirror[]>();

/** Every face of every wall, as the line a shell's centre meets it on. */
function mirrors(arena: Arena): readonly Mirror[] {
  const known = mirrorsOf.get(arena);
  if (known) return known;
  const r = RULES.shellRadius;
  const all = arena.walls.flatMap((w): Mirror[] => [
    { axis: 'x', at: w.x0 - r, side: -1 },
    { axis: 'x', at: w.x1 + r, side: 1 },
    { axis: 'y', at: w.y0 - r, side: -1 },
    { axis: 'y', at: w.y1 + r, side: 1 },
  ]);
  mirrorsOf.set(arena, all);
  return all;
}

/** A shot a bot can take: the direction to aim, and whether it goes off a wall. */
export interface Shot {
  readonly dir: number;
  readonly bank: boolean;
}

/**
 * A shot from `me` at a tank at `target` moving `v` a tick — straight if a straight shell would
 * reach it, else (with `bank`) off the one wall face whose reflection does, nearest first. Each
 * candidate is aimed at the target's position when the shell arrives, then flown by `trace` and
 * kept only if it passes well within reach on the leg it was aimed for — and, off a wall, clear of
 * the bot's own tank, which a shell that has bounced can hit. `null` when no shot lands.
 */
export function shotAt(
  arena: Arena,
  me: Point,
  target: Point,
  v: Point,
  bank: boolean,
): Shot | null {
  const direct = aimed(arena, me, target, v, null);
  if (direct !== null) return { dir: direct, bank: false };
  if (!bank) return null;

  const options: { dir: number; path: number }[] = [];
  for (const m of mirrors(arena)) {
    if (!onSide(m, me) || !onSide(m, target)) continue;
    const image = mirrored(m, target);
    const path = Math.sqrt((image.x - me.x) ** 2 + (image.y - me.y) ** 2);
    if (path > RANGE) continue;
    const dir = aimed(arena, me, target, v, m);
    if (dir !== null) options.push({ dir, path });
  }
  options.sort((a, b) => a.path - b.path);
  const best = options[0];
  return best ? { dir: best.dir, bank: true } : null;
}

/** The direction that lands a shell on the target by `m`'s reflection (or straight), or `null`. */
function aimed(arena: Arena, me: Point, target: Point, v: Point, m: Mirror | null): number | null {
  const image = (p: Point) => (m ? mirrored(m, p) : p);
  let p = target;
  for (let i = 0; i < 2; i++) {
    const im = image(p);
    p = ahead(target, v, Math.sqrt((im.x - me.x) ** 2 + (im.y - me.y) ** 2));
  }
  const im = image(p);
  const dir = dirTo(im.x - me.x, im.y - me.y);
  const legs = trace(arena, me.x, me.y, dir, RANGE);
  const want = m ? 1 : 0;
  // A shell aimed straight must not first fly into a wall and come back; one aimed off a wall must
  // reach that wall before it passes the target.
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg) continue;
    const c = closest(leg, p);
    if (c.d2 < AIM_REACH * AIM_REACH) {
      if (i !== want) return null;
      if (m) {
        const f = clip(leg, c.along);
        const upTo = {
          ...leg,
          x1: leg.x0 + (leg.x1 - leg.x0) * f,
          y1: leg.y0 + (leg.y1 - leg.y0) * f,
        };
        if (closest(upTo, me).d2 < SELF_CLEARANCE * SELF_CLEARANCE) return null;
      }
      return dir;
    }
  }
  return null;
}

/** The fraction of a leg flown by the time the shell has flown `along` in all. */
function clip(leg: Leg, along: number): number {
  const len = Math.sqrt((leg.x1 - leg.x0) ** 2 + (leg.y1 - leg.y0) ** 2);
  return len === 0 ? 0 : Math.min(1, Math.max(0, (along - leg.from) / len));
}
