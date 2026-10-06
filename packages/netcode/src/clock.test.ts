import { describe, expect, it } from 'vitest';
import { ServerClock, TICK_MS } from './clock.js';

/** A pong answered in tick `tick`, `intoMs` into it, for a ping that took `rtt` ms there and back
 * and came home at local time `at`. */
function pong(c: ServerClock, at: number, rtt: number, tick: number, intoMs = 0): void {
  c.sample(at - rtt, at, tick, Math.round(intoMs * 1000));
}

describe('ServerClock', () => {
  it('takes its first sample as it is: the tick, how far into it, and half the round trip', () => {
    const c = new ServerClock();
    expect(c.synced).toBe(false);
    pong(c, 10_000, 100, 300, 10);
    expect(c.synced).toBe(true);
    expect(c.at(10_000)).toBeCloseTo(300 + 10 / TICK_MS + 50 / TICK_MS, 9);
    expect(c.at(10_000 + TICK_MS)).toBeCloseTo(c.at(10_000) + 1, 9);
    expect(c.rtt()).toBe(100);
  });

  it('believes the sample with the shortest round trip — the one queueing delayed least', () => {
    const c = new ServerClock();
    pong(c, 30 * TICK_MS, 40, 30); // the server 20 ms past tick 30 when this one came home
    const fast = c.at(60 * TICK_MS);
    // A ping that queued 200 ms says the server is seven ticks behind that. It is not believed.
    pong(c, 60 * TICK_MS, 200, 50);
    expect(c.rtt()).toBe(40);
    // The link as it is now is the newest's — what the overlay shows and the input cap allows for.
    expect(c.latest()).toBe(200);
    expect(c.at(60 * TICK_MS)).toBeCloseTo(fast, 9);
    expect(fast).toBeCloseTo(60 + 20 / TICK_MS, 9);
  });

  it('slews toward a new estimate at 5 % of a tick a tick, never jumping', () => {
    const c = new ServerClock();
    pong(c, 0, 20, 0);
    const before = c.at(0);
    // As good a round trip, and newer: the server is two ticks further on than it looked.
    pong(c, 0, 20, 2);
    expect(c.at(0)).toBeCloseTo(before, 9);
    expect(c.at(10 * TICK_MS)).toBeCloseTo(before + 10 + 0.5, 9);
    // Forty ticks at 5 % catch up the two — and from then it runs with the server.
    expect(c.at(40 * TICK_MS)).toBeCloseTo(before + 40 + 2, 9);
    expect(c.at(100 * TICK_MS) - c.at(99 * TICK_MS)).toBeCloseTo(1, 9);
  });

  it('never runs backward while it slews back', () => {
    const c = new ServerClock();
    pong(c, 0, 50, 5, 0);
    pong(c, 1, 10, 0, 0); // five ticks back
    let last = -Infinity;
    for (let t = 1; t < 200 * TICK_MS; t += 7) {
      const now = c.at(t);
      expect(now).toBeGreaterThan(last);
      last = now;
    }
  });

  it('jumps when it is more than ten ticks out — a stall, a resumed room', () => {
    const c = new ServerClock();
    pong(c, 0, 50, 0, 0);
    pong(c, 100, 20, 500, 0);
    expect(c.at(100)).toBeCloseTo(500 + 10 / TICK_MS, 9);
  });

  it('forgets everything on reset', () => {
    const c = new ServerClock();
    pong(c, 0, 50, 0, 0);
    c.reset();
    expect(c.synced).toBe(false);
    expect(c.rtt()).toBeNull();
  });
});
