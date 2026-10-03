import { at, reflect, roundHalfAway, step, sweep } from '@ricochet/geom';
import type { Box, Face, Fraction } from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena } from '@ricochet/protocol';
import type { ShellBody, TankBody } from './world.js';

/** How a flight ended, if it did. */
export type Fate =
  | { readonly kind: 'flying' }
  | { readonly kind: 'wall' }
  | { readonly kind: 'spent' }
  | { readonly kind: 'tank'; readonly tank: number };

const less = (a: Fraction, b: Fraction) => a.num * b.den < b.num * a.den;
const same = (a: Fraction, b: Fraction) => a.num * b.den === b.num * a.den;

/** The first wall a move meets: when, which faces, and the point of contact — snapped exactly onto
 * the grown face, so the shell starts its next move touching the wall, never inside it. */
function firstWall(
  x: number,
  y: number,
  dx: number,
  dy: number,
  walls: readonly Box[],
): { t: Fraction; face: Face; x: number; y: number } | null {
  const r = RULES.shellRadius;
  let t: Fraction | null = null;
  let faces = new Set<Face>();
  let px = 0;
  let py = 0;
  for (const w of walls) {
    const c = sweep(x, y, dx, dy, r, w);
    if (!c) continue;
    if (t && less(t, c.t)) continue;
    if (!t || less(c.t, t)) {
      t = c.t;
      faces = new Set();
      px = at(x, dx, c.t);
      py = at(y, dy, c.t);
    }
    faces.add(c.face);
    // Snap each axis the shell met onto that face, exactly.
    if (c.face !== 'y') px = dx > 0 ? w.x0 - r : w.x1 + r;
    if (c.face !== 'x') py = dy > 0 ? w.y0 - r : w.y1 + r;
  }
  if (!t) return null;
  const face: Face =
    faces.has('corner') || (faces.has('x') && faces.has('y'))
      ? 'corner'
      : faces.has('x')
        ? 'x'
        : 'y';
  return { t, face, x: px, y: py };
}

/**
 * Whether a shell moving from `(x0, y0)` to `(x1, y1)` passes within reach of a tank, and how far
 * along: the closest approach, as an exact fraction. Integers throughout — the squared distance at
 * the closest point compared by cross-multiplication, no root.
 */
function nearTank(x0: number, y0: number, x1: number, y1: number, t: TankBody): Fraction | null {
  const reach = RULES.tankRadius + RULES.shellRadius;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const cx = t.x - x0;
  const cy = t.y - y0;
  const len2 = dx * dx + dy * dy;
  const c2 = cx * cx + cy * cy;
  if (len2 === 0) return c2 < reach * reach ? { num: 0, den: 1 } : null;
  const dot = cx * dx + cy * dy;
  if (dot <= 0) return c2 < reach * reach ? { num: 0, den: 1 } : null;
  if (dot >= len2) {
    const ex = t.x - x1;
    const ey = t.y - y1;
    return ex * ex + ey * ey < reach * reach ? { num: 1, den: 1 } : null;
  }
  // distance² at the closest point = c2 − dot² / len2 < reach²
  return c2 * len2 - dot * dot < reach * reach * len2 ? { num: dot, den: len2 } : null;
}

/**
 * A shell flown `distance` eighths along its direction: off a wall once, dead on its second, and —
 * when `tanks` are given — dead on the first tank it passes within reach of, its owner excepted
 * until it has bounced. The client flies the shells it holds with no tanks (it is told of hits);
 * the server with every live one.
 */
export function fly(
  shell: ShellBody,
  distance: number,
  arena: Arena,
  tanks: readonly TankBody[] | null,
): { shell: ShellBody; fate: Fate } {
  let s = shell;
  let remaining = distance;
  for (let leg = 0; leg < 2 && remaining > 0; leg++) {
    const [dx, dy] = step(s.dir, remaining);
    const wall = firstWall(s.x, s.y, dx, dy, arena.walls);
    const ex = wall ? wall.x : s.x + dx;
    const ey = wall ? wall.y : s.y + dy;

    if (tanks) {
      let hit: TankBody | null = null;
      let when: Fraction | null = null;
      for (const t of tanks) {
        if (!t.alive || (t.id === s.owner && !s.bounced)) continue;
        const f = nearTank(s.x, s.y, ex, ey, t);
        if (f && (!when || less(f, when) || (same(f, when) && hit && t.id < hit.id))) {
          hit = t;
          when = f;
        }
      }
      if (hit) return { shell: s, fate: { kind: 'tank', tank: hit.id } };
    }

    if (!wall) return { shell: { ...s, x: ex, y: ey }, fate: { kind: 'flying' } };
    if (s.bounced) return { shell: { ...s, x: ex, y: ey }, fate: { kind: 'wall' } };
    remaining -= roundHalfAway((remaining * wall.t.num) / wall.t.den);
    s = { ...s, x: ex, y: ey, dir: reflect(s.dir, wall.face), bounced: true };
  }
  return { shell: s, fate: { kind: 'flying' } };
}

/** One tick of a shell's life: a tick's flight, a tick older, dead at the end of its life. */
export function flyTick(
  shell: ShellBody,
  arena: Arena,
  tanks: readonly TankBody[] | null,
): { shell: ShellBody; fate: Fate } {
  const r = fly(shell, RULES.shellSpeed, arena, tanks);
  if (r.fate.kind !== 'flying') return r;
  const aged = { ...r.shell, age: r.shell.age + 1 };
  return {
    shell: aged,
    fate: aged.age >= RULES.shellLife ? { kind: 'spent' } : { kind: 'flying' },
  };
}

/**
 * A shell's flight with no tanks in the world — what a client does with the shells it is sent
 * (docs/protocol.md § 5.3). `null` once the shell is gone: its second wall, or the end of its life.
 */
export function stepShell(shell: ShellBody, arena: Arena): ShellBody | null {
  const r = flyTick(shell, arena, null);
  return r.fate.kind === 'flying' ? r.shell : null;
}
