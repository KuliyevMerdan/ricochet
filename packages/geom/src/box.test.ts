import { describe, expect, it } from 'vitest';
import { at, circleOverlapsBox, sweep } from './index.js';
import type { Box, Fraction } from './index.js';

const WALL: Box = { x0: 1000, y0: 1000, x1: 1128, y1: 2000 }; // 16 units thick, 125 long
const R = 48; // a shell: 6 units

describe('circleOverlapsBox', () => {
  it('overlaps through a face and at a corner, and touching does not count', () => {
    expect(circleOverlapsBox(980, 1500, 48, WALL)).toBe(true);
    expect(circleOverlapsBox(952, 1500, 48, WALL)).toBe(false); // touching the face
    expect(circleOverlapsBox(970, 970, 48, WALL)).toBe(true); // 30, 30 from the corner
    expect(circleOverlapsBox(960, 960, 48, WALL)).toBe(false); // 40, 40 — √3200 > 48
    expect(circleOverlapsBox(1064, 1500, 1, WALL)).toBe(true); // the centre inside
  });
});

describe('sweep', () => {
  it('meets a face head on, at the exact moment', () => {
    // From x = 800 rightward by 160: the grown face is at 952, reached at 152/160.
    const hit = sweep(800, 1500, 160, 0, R, WALL);
    expect(hit).toEqual({ t: { num: 152, den: 160 }, face: 'x' });
    expect(at(800, 160, hit?.t ?? { num: 0, den: 1 })).toBe(952);
  });

  it('meets the top face going down', () => {
    expect(sweep(1064, 800, 0, 160, R, WALL)).toEqual({ t: { num: 152, den: 160 }, face: 'y' });
  });

  it('calls a dead-on corner a corner', () => {
    // The grown corner is (952, 952); from (852, 852) diagonally by (160, 160) it is reached at 100/160.
    expect(sweep(852, 852, 160, 160, R, WALL)?.face).toBe('corner');
  });

  it('does not tunnel: a step longer than the wall is thick still meets it', () => {
    const hit = sweep(900, 1500, 400, 0, R, WALL);
    expect(hit?.face).toBe('x');
    expect(hit?.t).toEqual({ num: 52, den: 400 });
  });

  it('misses beside a wall, parallel to it, and short of it', () => {
    expect(sweep(800, 900, 160, 0, R, WALL)).toBeNull(); // passes above the grown top (952)
    expect(sweep(900, 0, 0, 3000, R, WALL)).toBeNull(); // parallel, outside
    expect(sweep(700, 1500, 160, 0, R, WALL)).toBeNull(); // ends at 860, short of 952
  });

  it('touches at the very end of the move', () => {
    const hit = sweep(792, 1500, 160, 0, R, WALL);
    expect(hit?.face).toBe('x');
    expect(hit && hit.t.num / hit.t.den).toBe(1);
  });

  it('reports nothing for a circle that starts inside, or one moving away', () => {
    expect(sweep(1064, 1500, 160, 0, R, WALL)).toBeNull();
    expect(sweep(900, 1500, -160, 0, R, WALL)).toBeNull();
  });
});

/** A small seeded generator — the test's own; geom has no randomness. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exactly: is the point at time `t` of the move within the closed grown box? */
function insideAt(px: number, py: number, dx: number, dy: number, t: Fraction, g: Box): boolean {
  const x = px * t.den + dx * t.num;
  const y = py * t.den + dy * t.num;
  return x >= g.x0 * t.den && x <= g.x1 * t.den && y >= g.y0 * t.den && y <= g.y1 * t.den;
}

function onBoundaryAt(px: number, py: number, dx: number, dy: number, t: Fraction, g: Box) {
  const x = px * t.den + dx * t.num;
  const y = py * t.den + dy * t.num;
  return (
    insideAt(px, py, dx, dy, t, g) &&
    (x === g.x0 * t.den || x === g.x1 * t.den || y === g.y0 * t.den || y === g.y1 * t.den)
  );
}

describe('ROADMAP S1 done-when: a swept shell never passes a wall', () => {
  it('in 10⁶ random shots at every speed up to twice the pinned one', () => {
    const random = mulberry32(20261003);
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    const SAMPLES = 64;
    let hits = 0;
    let failures = 0;

    for (let shot = 0; shot < 1_000_000; shot++) {
      // A wall at least 16 units thick, the arena's thinnest.
      const x0 = int(2000, 3000);
      const y0 = int(2000, 3000);
      const box: Box = { x0, y0, x1: x0 + int(128, 1200), y1: y0 + int(128, 1200) };
      const r = int(1, 64);
      const grown: Box = { x0: box.x0 - r, y0: box.y0 - r, x1: box.x1 + r, y1: box.y1 + r };
      const speed = int(1, 320);
      const angle = random() * 2 * Math.PI; // the test may; geom may not
      const dx = Math.round(Math.cos(angle) * speed);
      const dy = Math.round(Math.sin(angle) * speed);
      const px = int(grown.x0 - 400, grown.x1 + 400);
      const py = int(grown.y0 - 400, grown.y1 + 400);
      if (insideAt(px, py, 0, 0, { num: 0, den: 1 }, grown)) continue; // starts touching or inside

      const hit = sweep(px, py, dx, dy, r, box);
      // The oracle: sample the move; the first sample inside the grown box bounds the contact.
      let firstInside: Fraction | null = null;
      for (let i = 1; i <= SAMPLES; i++) {
        const t = { num: i, den: SAMPLES };
        if (insideAt(px, py, dx, dy, t, grown)) {
          firstInside = t;
          break;
        }
      }
      if (hit) hits++;
      const ok =
        hit === null
          ? firstInside === null
          : onBoundaryAt(px, py, dx, dy, hit.t, grown) &&
            (firstInside === null || hit.t.num * firstInside.den <= firstInside.num * hit.t.den);
      if (!ok) failures++;
    }

    expect(failures).toBe(0);
    expect(hits).toBeGreaterThan(10_000); // the run actually shot at walls
  }, 120_000);
});
