import type { View } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { Timeline } from './timeline.js';

const view = (tick: number): View => ({
  tick,
  ack: 0,
  self: { reload: 0, shells: 0, respawn: 0, shield: 0 },
  crates: 0,
  tanks: [
    { id: 2, x: 1000 + 10 * tick, y: 1000, hull: 0, turret: 0, hp: 3, shield: false, alive: true },
  ],
  shells: [],
  events: [],
});

/** Snapshots of ticks `from … to`, each arriving `late(tick)` ticks after the server stepped it. */
function feed(t: Timeline, from: number, to: number, late: (tick: number) => number): void {
  for (let k = from; k <= to; k++) t.received(view(k), k + late(k));
}

describe('Timeline', () => {
  it('draws two snapshot intervals behind a link with no jitter', () => {
    const t = new Timeline();
    feed(t, 1, 100, () => 2.5);
    expect(t.delay()).toBe(2);
    // The newest arrived at 102.5 of the server's clock; at 103 the drawn tick is two behind 100.5.
    const b = t.sample(103);
    expect(b?.tick).toBeCloseTo(98.5, 9);
    expect(b?.from.tick).toBe(98);
    // The overlay's numbers: no jitter, and the newest view a tick and a half ahead of the drawn
    // time — a tick, half a tick later, with no frame drawn between.
    expect(t.jitter()).toBe(0);
    expect(t.ahead(103)).toBeCloseTo(1.5, 9);
    expect(t.ahead(103.5)).toBeCloseTo(1, 9);
    expect(b?.to?.tick).toBe(99);
    expect(b?.alpha).toBeCloseTo(0.5, 9);
  });

  it('adds the 95th percentile of the jitter, within bounds', () => {
    const t = new Timeline();
    // Every tenth snapshot two ticks late: under 5 % stays below the line, 10 % does not.
    feed(t, 1, 90, (k) => (k % 10 === 0 ? 4.5 : 2.5));
    expect(t.delay()).toBe(4);
    const wild = new Timeline();
    feed(wild, 1, 90, (k) => (k % 2 === 0 ? 40 : 2));
    expect(wild.delay()).toBe(12);
  });

  it('holds a tick past the newest when the snapshots stop, then follows them without going back', () => {
    const t = new Timeline();
    feed(t, 1, 60, () => 2);
    let drawn = t.sample(62)?.tick ?? 0;
    // A one-second stall: nothing arrives, the server's clock runs on.
    for (let s = 62; s <= 92; s += 0.5) {
      const b = t.sample(s);
      expect(b?.tick).toBeLessThanOrEqual(61);
      expect(b?.tick).toBeGreaterThanOrEqual(drawn);
      drawn = b?.tick ?? drawn;
    }
    expect(drawn).toBe(61);
    expect(t.sample(92)?.to).toBeNull();
    // The burst: thirty snapshots at once, the first thirty ticks late.
    feed(t, 61, 90, (k) => 92 - k);
    for (let s = 92; s <= 150; s += 0.5) {
      const b = t.sample(s);
      expect(b?.tick).toBeGreaterThanOrEqual(drawn);
      drawn = b?.tick ?? drawn;
      if (s % 1 === 0) feed(t, s - 1, s - 1, () => 1);
    }
    expect(drawn).toBeGreaterThan(130);
  });

  it('extrapolates the others at most one tick, along the step before', () => {
    const t = new Timeline();
    feed(t, 1, 10, () => 0);
    const b = t.sample(10.5 + 2);
    expect(b?.to).toBeNull();
    expect(b?.before?.tick).toBe(9);
    expect(b?.tick).toBeLessThanOrEqual(11);
  });

  it('starts again on a view older than the newest — a new socket in another room', () => {
    const t = new Timeline();
    feed(t, 100, 110, () => 2);
    t.received(view(5), 7);
    expect(t.held().map((v) => v.tick)).toEqual([5]);
  });
});
