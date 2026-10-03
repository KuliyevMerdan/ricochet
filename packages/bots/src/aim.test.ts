import { DIRECTIONS, wrapDir } from '@ricochet/geom';
import { ARENA_0, RULES } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { RANGE, ahead, closest, dirTo, shotAt, trace } from './aim.js';

const C = RULES.arena / 2;
const REACH = RULES.tankRadius + RULES.shellRadius;

describe('dirTo', () => {
  it('names the axes as geom does: 0 along +x, 256 along +y', () => {
    expect([dirTo(1, 0), dirTo(0, 1), dirTo(-1, 0), dirTo(0, -1)]).toEqual([0, 256, 512, 768]);
  });
});

describe('trace', () => {
  it('flies a shell across open floor in one leg, its whole range', () => {
    const legs = trace(ARENA_0, 1280, 6000, 256, 2000);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ x0: 1280, y0: 6000, x1: 1280, y1: 8000 });
  });

  it('reflects off the first wall and stops at the second', () => {
    // Straight left from beside the left edge: off it, then back the way it came.
    const legs = trace(ARENA_0, 1280, 6000, 512, RANGE);
    expect(legs).toHaveLength(2);
    expect(legs[0]?.x1).toBe(RULES.shellRadius);
    expect(legs[1]?.x1 ?? 0).toBeGreaterThan(1280);
    expect(legs[1]?.from).toBe(1280 - RULES.shellRadius);
  });
});

describe('ahead', () => {
  it('leaves a still target where it is', () => {
    expect(ahead({ x: 100, y: 200 }, { x: 0, y: 0 }, 5000)).toEqual({ x: 100, y: 200 });
  });

  it('moves a target by every tick it drives before the shell arrives, the firing tick included', () => {
    const path = RULES.muzzle + 10 * RULES.shellSpeed;
    expect(ahead({ x: 0, y: 0 }, { x: 59, y: 0 }, path)).toEqual({ x: 59 * 11, y: 0 });
  });
});

describe('shotAt', () => {
  it('shoots straight when nothing stands between', () => {
    const me = { x: 2400, y: C };
    const target = { x: 4800, y: C };
    expect(shotAt(ARENA_0, me, target, { x: 0, y: 0 }, true)).toEqual({ dir: 0, bank: false });
  });

  it('leads a moving target', () => {
    const me = { x: 2400, y: C };
    const shot = shotAt(ARENA_0, me, { x: 4800, y: C }, { x: 0, y: 40 }, true);
    expect(shot?.bank).toBe(false);
    expect(shot?.dir ?? 0).toBeGreaterThan(0);
    expect(shot?.dir ?? DIRECTIONS).toBeLessThan(DIRECTIONS / 8);
  });

  it('banks off a wall when a post is in the way — and only if it may', () => {
    // Either side of the top-left post (512–544 units across), under the arena's top edge.
    const me = { x: 1200, y: 1600 };
    const target = { x: 4800, y: 1600 };
    expect(shotAt(ARENA_0, me, target, { x: 0, y: 0 }, false)).toBeNull();
    const shot = shotAt(ARENA_0, me, target, { x: 0, y: 0 }, true);
    expect(shot?.bank).toBe(true);
    const legs = trace(ARENA_0, me.x, me.y, shot?.dir ?? 0, RANGE);
    expect(legs).toHaveLength(2);
    const near = legs[1] ? closest(legs[1], target) : { d2: Infinity };
    expect(near.d2).toBeLessThan(REACH * REACH);
    // The ricochet clears the shooter on its way to the target.
    expect(legs[0] ? closest(legs[0], target).d2 : 0).toBeGreaterThan(REACH * REACH);
  });

  it('finds no shot out of range', () => {
    const shot = shotAt(
      ARENA_0,
      { x: 1280, y: 1280 },
      { x: 15000, y: 15000 },
      { x: 0, y: 0 },
      true,
    );
    expect(shot).toBeNull();
  });

  it('every shot it finds is a direction', () => {
    for (let i = 0; i < 200; i++) {
      const me = { x: 1300 + ((i * 977) % 13000), y: 1300 + ((i * 541) % 13000) };
      const target = { x: 1300 + ((i * 313) % 13000), y: 1300 + ((i * 709) % 13000) };
      const shot = shotAt(ARENA_0, me, target, { x: 0, y: 0 }, true);
      if (shot) expect(wrapDir(shot.dir)).toBe(shot.dir);
    }
  });
});
