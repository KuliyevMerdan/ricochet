import { describe, expect, it } from 'vitest';
import { CLEAN, Lane, Link } from './link.js';
import type { LaneTimers } from './link.js';

/** Virtual time: timers fire in order of their due moment when the test moves the clock. */
function virtual() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: LaneTimers = {
    after(ms, fn) {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return () => due.delete(id);
    },
  };
  const advance = (to: number) => {
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | null = null;
      for (const e of due) if (e[1].at <= to && (!first || e[1].at < first[1].at)) first = e;
      if (!first) break;
      due.delete(first[0]);
      now = Math.max(now, first[1].at);
      first[1].fn();
    }
    now = to;
  };
  return { clock: { now: () => now }, timers, advance, pending: () => due.size };
}

/** A fixed sequence standing in for `Math.random`. */
const seq = (xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length] ?? 0;
};

describe('Lane', () => {
  it('delivers at once on a clean link, with no timer', () => {
    const v = virtual();
    const lane = new Lane(v.clock, v.timers, Math.random);
    const got: number[] = [];
    lane.deliver(CLEAN, 0, () => got.push(1));
    expect(got).toEqual([1]);
    expect(v.pending()).toBe(0);
  });

  it('holds each frame its one-way delay', () => {
    const v = virtual();
    const lane = new Lane(v.clock, v.timers, Math.random);
    const got: number[] = [];
    lane.deliver({ latencyMs: 300, jitterMs: 0 }, 150, () => got.push(v.clock.now()));
    v.advance(149);
    expect(got).toEqual([]);
    v.advance(200);
    expect(got).toEqual([150]);
  });

  it('bunches frames under jitter and never reorders them', () => {
    const v = virtual();
    // The first frame draws the whole jitter, the second none: it waits for the first.
    const lane = new Lane(v.clock, v.timers, seq([1, 0, 0.5]));
    const faults = { latencyMs: 100, jitterMs: 80 };
    const got: [number, number][] = [];
    lane.deliver(faults, 50, () => got.push([1, v.clock.now()]));
    v.advance(10);
    lane.deliver(faults, 50, () => got.push([2, v.clock.now()]));
    v.advance(20);
    lane.deliver(faults, 50, () => got.push([3, v.clock.now()]));
    v.advance(1000);
    expect(got).toEqual([
      [1, 130],
      [2, 130],
      [3, 130],
    ]);
  });

  it('keeps order however late its timer fires', () => {
    const v = virtual();
    const lane = new Lane(v.clock, v.timers, Math.random);
    const faults = { latencyMs: 0, jitterMs: 0 };
    const got: number[] = [];
    lane.stall(100);
    lane.deliver(faults, 0, () => got.push(1));
    // The loop was busy: the clock is past the stall before any timer runs, and a frame comes in.
    v.advance(0);
    lane.deliver(faults, 0, () => got.push(2));
    v.advance(500);
    expect(got).toEqual([1, 2]);
  });

  it('holds everything through a stall, then delivers it in order', () => {
    const v = virtual();
    const lane = new Lane(v.clock, v.timers, Math.random);
    const faults = { latencyMs: 60, jitterMs: 0 };
    const got: [number, number][] = [];
    lane.deliver(faults, 30, () => got.push([1, v.clock.now()]));
    lane.stall(2000);
    for (let i = 2; i <= 4; i++) {
      v.advance(v.clock.now() + 500);
      lane.deliver(faults, 30, () => got.push([i, v.clock.now()]));
    }
    v.advance(1999);
    expect(got).toEqual([]);
    v.advance(2100);
    expect(got.map(([i]) => i)).toEqual([1, 2, 3, 4]);
    expect(got.every(([, at]) => at === 2000)).toBe(true);
    // And after it, the link's own delay again.
    lane.deliver(faults, 30, () => got.push([5, v.clock.now()]));
    v.advance(3000);
    expect(got.at(-1)).toEqual([5, 2130]);
  });

  it('delivers nothing once closed', () => {
    const v = virtual();
    const lane = new Lane(v.clock, v.timers, Math.random);
    const got: number[] = [];
    lane.deliver({ latencyMs: 100, jitterMs: 0 }, 50, () => got.push(1));
    lane.close();
    lane.deliver(CLEAN, 0, () => got.push(2));
    v.advance(1000);
    expect(got).toEqual([]);
    expect(v.pending()).toBe(0);
  });
});

describe('Link', () => {
  it('splits the latency between its two lanes and stalls both', () => {
    const v = virtual();
    const link = new Link(v.clock, v.timers, Math.random);
    link.set({ latencyMs: 300, jitterMs: 0 });
    const got: string[] = [];
    link.toClient(() => got.push(`down ${v.clock.now()}`));
    link.fromClient(() => got.push(`up ${v.clock.now()}`));
    v.advance(1000);
    expect(got).toEqual(['down 150', 'up 150']);
    link.stall(500);
    link.toClient(() => got.push(`down ${v.clock.now()}`));
    link.fromClient(() => got.push(`up ${v.clock.now()}`));
    v.advance(3000);
    expect(got.slice(2)).toEqual(['down 1500', 'up 1500']);
  });
});
