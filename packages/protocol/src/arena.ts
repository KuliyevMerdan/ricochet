import { ARENA_EIGHTHS, eighths } from '@ricochet/geom';
import type { Box } from '@ricochet/geom';

/** A point in eighths. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * An arena: its walls, where tanks spawn and where crates appear — docs/protocol.md § 8.2. Part of
 * the contract, beside `RULES`, because the bots path round these walls and may not import `sim`.
 */
export interface Arena {
  readonly id: number;
  /** Every wall, the four that close the arena's edges first. In eighths. */
  readonly walls: readonly Box[];
  readonly spawns: readonly Point[];
  /** `crateSpots` of them; the snapshot's `crates` bit `i` is spot `i`. */
  readonly crates: readonly Point[];
}

const A = ARENA_EIGHTHS;
const C = 1024; // the centre, in units

/** A box written in units. */
const box = (x0: number, y0: number, x1: number, y1: number): Box => ({
  x0: eighths(x0),
  y0: eighths(y0),
  x1: eighths(x1),
  y1: eighths(y1),
});

/** A quarter turn clockwise about the centre, in units: (x, y) → (2C − y, x). */
const turnBox = (b: Box): Box => ({
  x0: eighths(2 * C) - b.y1,
  y0: b.x0,
  x1: eighths(2 * C) - b.y0,
  y1: b.x1,
});
const turnPoint = (p: Point): Point => ({ x: eighths(2 * C) - p.y, y: p.x });

/** Four copies of a piece of the top-left quadrant, one per quadrant, clockwise. */
function fourWays<T>(item: T, turn: (t: T) => T): T[] {
  const out = [item];
  for (let i = 0; i < 3; i++) out.push(turn(out[out.length - 1] ?? item));
  return out;
}

/** The edges: boxes outside the arena whose inner faces are its sides. */
const EDGES: readonly Box[] = [
  { x0: -A, y0: -A, x1: 0, y1: 2 * A }, // left
  { x0: -A, y0: -A, x1: 2 * A, y1: 0 }, // top
  { x0: A, y0: -A, x1: 2 * A, y1: 2 * A }, // right
  { x0: -A, y0: A, x1: 2 * A, y1: 2 * A }, // bottom
];

/** The top-left quadrant's walls, in units — the arena is these turned four ways, and a pillar. */
const QUADRANT: readonly Box[] = [
  box(256, 512, 768, 544), // a long bar across the quadrant
  box(512, 192, 544, 384), // a short post above it
  box(320, 800, 416, 896), // a block of cover on the way to the centre
  box(704, 704, 832, 736), // a lip in front of the pillar
];

/**
 * Arena 0 — four-fold symmetric, so no spawn is better than another: a long bar, a post, a block
 * and a lip per quadrant, a pillar in the middle. Spawns at the corners and the middles of the
 * sides; a crate in each quadrant's pocket above its bar.
 */
export const ARENA_0: Arena = {
  id: 0,
  walls: [
    ...EDGES,
    box(C - 64, C - 64, C + 64, C + 64),
    ...QUADRANT.flatMap((b) => fourWays(b, turnBox)),
  ],
  spawns: [
    ...fourWays({ x: eighths(160), y: eighths(160) }, turnPoint),
    ...fourWays({ x: eighths(C), y: eighths(288) }, turnPoint),
  ],
  crates: fourWays({ x: eighths(448), y: eighths(448) }, turnPoint),
};

export const ARENAS: readonly Arena[] = [ARENA_0];
