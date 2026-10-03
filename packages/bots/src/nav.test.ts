import { circleOverlapsBox } from '@ricochet/geom';
import { ARENA_0, RULES } from '@ricochet/protocol';
import type { Point } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { FAR, GRID, cellAt, clearPath, fieldTo, gridOf, waypoint } from './nav.js';

const grid = gridOf(ARENA_0);
const inWall = (x: number, y: number) =>
  ARENA_0.walls.some((w) => circleOverlapsBox(x, y, RULES.tankRadius, w));

describe('the grid', () => {
  it('is built once per arena', () => {
    expect(gridOf(ARENA_0)).toBe(grid);
  });

  it('opens every spawn and crate spot', () => {
    for (const p of [...ARENA_0.spawns, ...ARENA_0.crates]) {
      expect(grid.open[cellAt(p.x, p.y)], `(${p.x / 8}, ${p.y / 8})`).toBe(1);
    }
  });

  it('reaches every open cell from every other — arena 0 is one piece', () => {
    const field = fieldTo(grid, cellAt(ARENA_0.spawns[0]?.x ?? 0, ARENA_0.spawns[0]?.y ?? 0));
    let unreached = 0;
    for (let c = 0; c < GRID * GRID; c++) if (grid.open[c] === 1 && field[c] === FAR) unreached++;
    expect(unreached).toBe(0);
  });

  it('shares a field between bots going to the same cell', () => {
    expect(fieldTo(grid, 1000)).toBe(fieldTo(grid, 1000));
  });
});

describe('waypoints', () => {
  /** A point driven straight at each waypoint in tank-sized steps, until it is in the goal's cell. */
  function drive(from: Point, to: Point): { arrived: boolean; ticks: number; touched: boolean } {
    const field = fieldTo(grid, cellAt(to.x, to.y));
    let p = from;
    let touched = false;
    for (let tick = 0; tick < 3000; tick++) {
      const w = waypoint(grid, field, p.x, p.y);
      if (!w) return { arrived: true, ticks: tick, touched };
      const dx = w.x - p.x;
      const dy = w.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const k = len <= RULES.tankSpeed ? 1 : RULES.tankSpeed / len;
      p = { x: Math.round(p.x + dx * k), y: Math.round(p.y + dy * k) };
      touched ||= inWall(p.x, p.y);
    }
    return { arrived: false, ticks: 3000, touched };
  }

  it('lead from every spawn to every crate and every other spawn, never through a wall', () => {
    const points = [...ARENA_0.spawns, ...ARENA_0.crates];
    for (const a of ARENA_0.spawns) {
      for (const b of points) {
        if (a === b) continue;
        const r = drive(a, b);
        const route = `(${a.x / 8}, ${a.y / 8}) → (${b.x / 8}, ${b.y / 8})`;
        expect(r.arrived, `${route} never arrived`).toBe(true);
        expect(r.touched, `${route} touched a wall`).toBe(false);
      }
    }
  });

  it('cut straight across open floor rather than tracing the grid', () => {
    const a = ARENA_0.spawns[0] ?? { x: 0, y: 0 };
    const w = waypoint(grid, fieldTo(grid, cellAt(8192, 2304)), a.x, a.y);
    expect(w).not.toBeNull();
    expect(Math.abs((w?.x ?? 0) - a.x) + Math.abs((w?.y ?? 0) - a.y)).toBeGreaterThan(4 * 256);
    expect(clearPath(ARENA_0, a.x, a.y, w?.x ?? 0, w?.y ?? 0)).toBe(true);
  });

  it('is null in the goal’s own cell', () => {
    const c = ARENA_0.crates[0] ?? { x: 0, y: 0 };
    expect(waypoint(grid, fieldTo(grid, cellAt(c.x, c.y)), c.x, c.y)).toBeNull();
  });
});
