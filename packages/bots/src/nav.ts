import { circleOverlapsBox, sweep } from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena, Point } from '@ricochet/protocol';

/**
 * How a bot finds its way: a coarse grid laid over the arena once, and distances over it to
 * wherever the bot is going. A cell is 32 units — a tank is 48 across, the narrowest gap in arena 0
 * is 128 — and open when a tank at its centre clears every wall by 8 units, so a path through open
 * cells is one a tank can drive.
 */
export const CELL = 256;
/** Cells along a side: 64, so 4,096 in all. */
export const GRID = RULES.arena / CELL;
const CLEARANCE = RULES.tankRadius + 64;
/** The distance of a cell nothing reaches. */
export const FAR = 0xffff;
/** Step costs: 2 along an axis, 3 on a diagonal — √2 near enough, in integers. */
const ORTHO = 2;
const DIAG = 3;
/** Distance fields kept per arena, most recently used last. Each is 8 KB. */
const FIELDS_KEPT = 512;
/** A cell has at most eight neighbours. */
const SLOTS = 8;

export interface Grid {
  readonly arena: Arena;
  /** 1 where a tank fits, by cell index `gy · GRID + gx`. */
  readonly open: Uint8Array;
  /** Each cell's open neighbours, `SLOTS` to a cell, −1 past the last; and each step's cost. */
  readonly next: Int32Array;
  readonly cost: Uint8Array;
  /** Distances to a goal cell, by goal — shared by every bot on this arena. */
  readonly fields: Map<number, Uint16Array>;
}

const grids = new WeakMap<Arena, Grid>();

/** The arena's grid, built the first time it is asked for and kept as long as the arena is. */
export function gridOf(arena: Arena): Grid {
  const known = grids.get(arena);
  if (known) return known;
  const open = new Uint8Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = centre(gx);
      const y = centre(gy);
      open[gy * GRID + gx] = arena.walls.every((w) => !circleOverlapsBox(x, y, CLEARANCE, w))
        ? 1
        : 0;
    }
  }
  const next = new Int32Array(GRID * GRID * SLOTS).fill(-1);
  const cost = new Uint8Array(GRID * GRID * SLOTS);
  for (let cell = 0; cell < GRID * GRID; cell++) {
    let k = cell * SLOTS;
    for (const [n, c] of neighbours(open, cell)) {
      next[k] = n;
      cost[k] = c;
      k++;
    }
  }
  const grid: Grid = { arena, open, next, cost, fields: new Map() };
  grids.set(arena, grid);
  return grid;
}

/** A cell's centre along one axis, in eighths. */
export function centre(g: number): number {
  return g * CELL + CELL / 2;
}

/** The cell a point lies in. */
export function cellAt(x: number, y: number): number {
  const gx = Math.min(GRID - 1, Math.max(0, Math.floor(x / CELL)));
  const gy = Math.min(GRID - 1, Math.max(0, Math.floor(y / CELL)));
  return gy * GRID + gx;
}

export function cellCentre(cell: number): Point {
  return { x: centre(cell % GRID), y: centre(Math.floor(cell / GRID)) };
}

/** The open cells next to `cell`, with the cost of the step; no diagonal cuts a closed corner. */
function* neighbours(open: Uint8Array, cell: number): Generator<readonly [number, number]> {
  const gx = cell % GRID;
  const gy = Math.floor(cell / GRID);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < GRID && y < GRID && open[y * GRID + x] === 1;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (at(gx + dx, gy + dy)) yield [(gy + dy) * GRID + gx + dx, ORTHO];
  }
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    if (at(gx + dx, gy + dy) && at(gx + dx, gy) && at(gx, gy + dy)) {
      yield [(gy + dy) * GRID + gx + dx, DIAG];
    }
  }
}

/**
 * Every cell's distance to `goal` over open cells — Dijkstra, the costs being 2 and 3, with a ring
 * of four buckets for a queue. Kept per grid and shared, since bots chasing one tank chase one cell.
 */
export function fieldTo(grid: Grid, goal: number): Uint16Array {
  const known = grid.fields.get(goal);
  if (known) {
    grid.fields.delete(goal);
    grid.fields.set(goal, known);
    return known;
  }
  const dist = new Uint16Array(GRID * GRID).fill(FAR);
  dist[goal] = 0;
  const ring: number[][] = [[goal], [], [], []];
  let queued = 1;
  for (let d = 0; queued > 0; d++) {
    const bucket = ring[d & 3] ?? [];
    for (let i = 0; i < bucket.length; i++) {
      const cell = bucket[i] ?? 0;
      queued--;
      if (dist[cell] !== d) continue; // reached more cheaply since it was queued
      for (let k = cell * SLOTS; k < cell * SLOTS + SLOTS; k++) {
        const n = grid.next[k] ?? -1;
        if (n < 0) break;
        const nd = d + (grid.cost[k] ?? 0);
        if (nd < (dist[n] ?? FAR)) {
          dist[n] = nd;
          ring[nd & 3]?.push(n);
          queued++;
        }
      }
    }
    bucket.length = 0;
  }
  grid.fields.set(goal, dist);
  if (grid.fields.size > FIELDS_KEPT) {
    const oldest = grid.fields.keys().next();
    if (!oldest.done) grid.fields.delete(oldest.value);
  }
  return dist;
}

/** How far clear of a wall a bot keeps the straight lines it drives — 4 units. */
const MARGIN = 32;

/**
 * Whether a tank can drive straight from one point to another without coming within `MARGIN` of a
 * wall — or, of a wall it is already that close to, without meeting it.
 */
export function clearPath(arena: Arena, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return arena.walls.every((w) => {
    const r = circleOverlapsBox(x0, y0, RULES.tankRadius + MARGIN, w)
      ? RULES.tankRadius
      : RULES.tankRadius + MARGIN;
    return sweep(x0, y0, dx, dy, r, w) === null;
  });
}

/** How far ahead along the path a bot looks for a cell it can drive straight to. */
const LOOKAHEAD = 6;

/**
 * Where to drive next on the way to `goal`: the furthest cell down the distance field, within
 * `LOOKAHEAD` steps, that the tank can reach in a straight line — so it cuts across open floor
 * instead of tracing the grid's staircase. A tank standing in a closed cell (flush against a wall)
 * starts from the best open cell beside it. `null` when it is already in the goal's cell, or when
 * nothing open around it leads there.
 */
export function waypoint(grid: Grid, field: Uint16Array, x: number, y: number): Point | null {
  let cell = cellAt(x, y);
  if (field[cell] === 0) return null;
  if (grid.open[cell] !== 1 || field[cell] === FAR) {
    const near = nearestOpen(grid, field, cell, x, y);
    if (near === null) return null;
    cell = near;
  }
  let best = cellCentre(cell);
  for (let i = 0; i < LOOKAHEAD; i++) {
    let next: number | null = null;
    let nextDist = field[cell] ?? FAR;
    for (let k = cell * SLOTS; k < cell * SLOTS + SLOTS; k++) {
      const n = grid.next[k] ?? -1;
      if (n < 0) break;
      const d = field[n] ?? FAR;
      if (d < nextDist) {
        next = n;
        nextDist = d;
      }
    }
    if (next === null) break;
    cell = next;
    const c = cellCentre(cell);
    if (!clearPath(grid.arena, x, y, c.x, c.y)) break;
    best = c;
    if (nextDist === 0) break;
  }
  return best;
}

/** Of the open cells within two of `cell` that a tank at `(x, y)` can drive straight to, the one
 * nearest the goal. */
function nearestOpen(
  grid: Grid,
  field: Uint16Array,
  cell: number,
  x: number,
  y: number,
): number | null {
  const gx = cell % GRID;
  const gy = Math.floor(cell / GRID);
  let best: number | null = null;
  let bestDist = FAR;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const c = ny * GRID + nx;
      const d = field[c] ?? FAR;
      if (grid.open[c] !== 1 || d >= bestDist) continue;
      const p = cellCentre(c);
      if (clearPath(grid.arena, x, y, p.x, p.y)) {
        best = c;
        bestDist = d;
      }
    }
  }
  return best;
}
