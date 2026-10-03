import { circleOverlapsBox } from '@ricochet/geom';
import type { Box } from '@ricochet/geom';
import { describe, expect, it } from 'vitest';
import { ARENAS, RULES } from './index.js';

describe.each(ARENAS)('arena $id', (arena) => {
  const free = (x: number, y: number, r: number) =>
    arena.walls.every((w) => !circleOverlapsBox(x, y, r, w));

  it('closes its edges', () => {
    const [left, top, right, bottom] = arena.walls;
    expect(left?.x1).toBe(0);
    expect(top?.y1).toBe(0);
    expect(right?.x0).toBe(RULES.arena);
    expect(bottom?.y0).toBe(RULES.arena);
  });

  it('has walls that do not touch one another — no seam for a shell to find', () => {
    const inner = arena.walls.slice(4);
    const apart = (a: Box, b: Box) => a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0;
    for (let i = 0; i < inner.length; i++) {
      for (let j = i + 1; j < inner.length; j++) {
        expect(apart(inner[i] as Box, inner[j] as Box)).toBe(true);
      }
    }
  });

  it('spawns every tank clear of every wall', () => {
    for (const p of arena.spawns) expect(free(p.x, p.y, RULES.tankRadius)).toBe(true);
  });

  it(`has ${RULES.crateSpots} crate spots, each clear of every wall`, () => {
    expect(arena.crates).toHaveLength(RULES.crateSpots);
    for (const p of arena.crates) expect(free(p.x, p.y, RULES.crateRadius)).toBe(true);
  });

  it('lets a tank drive from any spawn to every other spawn and every crate', () => {
    // Tank centres on an 8-unit grid; a cell is open if a tank there touches no wall.
    const STEP = 64;
    const N = RULES.arena / STEP;
    const open = new Uint8Array(N * N);
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        open[gy * N + gx] = free(gx * STEP, gy * STEP, RULES.tankRadius) ? 1 : 0;
      }
    }
    const start = arena.spawns[0] ?? { x: 0, y: 0 };
    const seen = new Uint8Array(N * N);
    const queue = [(start.y / STEP) * N + start.x / STEP];
    seen[queue[0] ?? 0] = 1;
    while (queue.length > 0) {
      const c = queue.pop() ?? 0;
      const x = c % N;
      const y = Math.floor(c / N);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        const n = ny * N + nx;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && open[n] && !seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    for (const p of [...arena.spawns, ...arena.crates]) {
      expect(p.x % STEP, 'a point off the grid').toBe(0);
      expect(seen[(p.y / STEP) * N + p.x / STEP], `(${p.x / 8}, ${p.y / 8}) unreachable`).toBe(1);
    }
  });
});
