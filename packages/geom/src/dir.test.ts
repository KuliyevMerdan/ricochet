import { describe, expect, it } from 'vitest';
import {
  COS,
  DIRECTIONS,
  DIR_SCALE,
  SIN,
  nearestDir,
  reflect,
  step,
  turnBetween,
  turnToward,
  wrapDir,
} from './index.js';

const ALL = Array.from({ length: DIRECTIONS }, (_, d) => d);
const c = (d: number) => COS[wrapDir(d)] ?? NaN;
const s = (d: number) => SIN[wrapDir(d)] ?? NaN;

describe('the direction table', () => {
  it('has 1,024 integer entries on each axis', () => {
    expect(COS).toHaveLength(DIRECTIONS);
    expect(SIN).toHaveLength(DIRECTIONS);
    expect([...COS, ...SIN].every(Number.isInteger)).toBe(true);
  });

  it('names the axes exactly', () => {
    expect([c(0), s(0)]).toEqual([DIR_SCALE, 0]);
    expect([c(256), s(256)]).toEqual([0, DIR_SCALE]);
    expect([c(512), s(512)]).toEqual([-DIR_SCALE, 0]);
    expect([c(768), s(768)]).toEqual([0, -DIR_SCALE]);
  });

  it('is exactly symmetric — mirror images are negated components, to the bit', () => {
    for (const d of ALL) {
      expect([c(512 - d), s(512 - d)]).toEqual([-c(d) || 0, s(d)]);
      expect([c(-d), s(-d)]).toEqual([c(d), -s(d) || 0]);
      expect([c(d + 512), s(d + 512)]).toEqual([-c(d) || 0, -s(d) || 0]);
      expect([c(256 - d), s(256 - d)]).toEqual([s(d), c(d)]);
    }
  });

  it('holds every entry to the unit circle within rounding', () => {
    for (const d of ALL) {
      const r2 = c(d) * c(d) + s(d) * s(d);
      expect(r2).toBeGreaterThanOrEqual((DIR_SCALE - 1) ** 2);
      expect(r2).toBeLessThanOrEqual((DIR_SCALE + 1) ** 2);
    }
  });

  it('turns steadily — every step between neighbours is a small positive rotation', () => {
    for (const d of ALL) {
      const cross = c(d) * s(d + 1) - s(d) * c(d + 1);
      expect(cross).toBeGreaterThan(0);
    }
  });
});

describe('step', () => {
  it('moves along the axes exactly', () => {
    expect(step(0, 160)).toEqual([160, 0]);
    expect(step(256, 59)).toEqual([0, 59]);
    expect(step(512, 59)).toEqual([-59, 0]);
  });

  it('gives a mirrored direction the mirrored displacement at every speed up to 320', () => {
    for (let speed = 1; speed <= 320; speed++) {
      for (const d of ALL) {
        const [x, y] = step(d, speed);
        expect(step(reflect(d, 'x'), speed)).toEqual([-x || 0, y]);
        expect(step(reflect(d, 'y'), speed)).toEqual([x, -y || 0]);
        expect(step(reflect(d, 'corner'), speed)).toEqual([-x || 0, -y || 0]);
      }
    }
  }, 30_000);

  it('never returns −0', () => {
    for (const d of ALL) for (const v of step(d, 59)) expect(Object.is(v, -0)).toBe(false);
  });
});

describe('reflect', () => {
  it.each(['x', 'y', 'corner'] as const)('off a %s face, twice, is where it started', (face) => {
    for (const d of ALL) expect(reflect(reflect(d, face), face)).toBe(d);
  });

  it('sends a shell going right back left, and one going down back up', () => {
    expect(reflect(0, 'x')).toBe(512);
    expect(reflect(256, 'y')).toBe(768);
    expect(reflect(128, 'x')).toBe(384);
    expect(reflect(128, 'y')).toBe(896);
  });
});

describe('turning', () => {
  it('takes the short way round', () => {
    expect(turnBetween(10, 1000)).toBe(-34);
    expect(turnBetween(1000, 10)).toBe(34);
    expect(turnBetween(0, 512)).toBe(512);
    expect(turnBetween(512, 0)).toBe(512);
  });

  it('turns by at most the step, and lands exactly when within it', () => {
    expect(turnToward(0, 100, 24)).toBe(24);
    expect(turnToward(0, 1000, 24)).toBe(1000);
    expect(turnToward(10, 1000, 24)).toBe(1010);
    expect(turnToward(0, 900, 24)).toBe(1000);
  });
});

describe('nearestDir', () => {
  it('finds every table entry from its own vector', () => {
    for (const d of ALL) expect(nearestDir(c(d), s(d))).toBe(d);
  });

  it('reads a mouse offset at any length', () => {
    expect(nearestDir(300, 0)).toBe(0);
    expect(nearestDir(0, 0.5)).toBe(256);
    expect(nearestDir(-1, -1)).toBe(640);
  });

  it('has no direction for the zero vector', () => {
    expect(nearestDir(0, 0)).toBeNull();
  });
});
