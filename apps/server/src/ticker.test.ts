import { describe, expect, it } from 'vitest';
import { Ticker, quantile } from './ticker.js';
import type { TickerClock } from './ticker.js';

/** A clock the test moves by hand; sleeps and yields run when it passes their time. */
function fakeClock() {
  let t = 0;
  let queue: Array<{ at: number; fn: () => void; id: number }> = [];
  let ids = 0;
  const clock: TickerClock = {
    now: () => t,
    sleep(ms, fn) {
      const id = ids++;
      queue.push({ at: t + ms, fn, id });
      return () => (queue = queue.filter((q) => q.id !== id));
    },
    yieldThen(fn) {
      // A turn of the event loop takes a little time, as a real one does — else a spin waiting for
      // its deadline would never see the clock move.
      const id = ids++;
      queue.push({ at: t + 0.25, fn, id });
      return () => (queue = queue.filter((q) => q.id !== id));
    },
  };
  /** Run everything due by `until`, advancing time to each item's moment. */
  const advance = (until: number) => {
    for (;;) {
      queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = queue.shift();
      if (!next || next.at > until) {
        if (next) queue.unshift(next);
        t = until;
        return;
      }
      t = Math.max(t, next.at);
      next.fn();
    }
  };
  return { clock, advance, jump: (ms: number) => (t += ms) };
}

describe('Ticker', () => {
  it('runs tick n at start + n · period, however long the ticks take', () => {
    const { clock, advance, jump } = fakeClock();
    const at: number[] = [];
    const ticker = new Ticker(
      () => {
        at.push(clock.now());
        jump(7); // every tick costs 7 ms of work
      },
      clock,
      30,
    );
    ticker.start();
    advance(1000);
    expect(at).toHaveLength(30); // ticks 0 … 29; tick 30 is due at 1000 exactly
    at.forEach((t, n) => {
      expect(t).toBeGreaterThanOrEqual((n * 1000) / 30);
      expect(t).toBeLessThan((n * 1000) / 30 + 0.25 + 1e-9);
    });
    expect(Math.max(...ticker.stats().lateness)).toBeLessThan(0.25 + 1e-9);
  });

  it('catches up a short stall tick by tick, and does not drift after it', () => {
    const { clock, advance, jump } = fakeClock();
    let ticks = 0;
    const ticker = new Ticker(
      () => {
        if (++ticks === 10) jump(100); // one 100 ms tick
      },
      clock,
      30,
    );
    ticker.start();
    advance(500);
    expect(ticks).toBe(Math.floor(500 / (1000 / 30)) + 1);
    expect(ticker.stats().skipped).toBe(0);
  });

  it('rebases after a long pause rather than replaying it', () => {
    const { clock, advance, jump } = fakeClock();
    let ticks = 0;
    const ticker = new Ticker(() => ticks++, clock, 30);
    ticker.start();
    advance(100);
    jump(5000); // the process was paused
    advance(5200);
    expect(ticker.stats().skipped).toBeGreaterThan(100);
    expect(ticks).toBeLessThan(20);
  });

  it('stops', () => {
    const { clock, advance } = fakeClock();
    let ticks = 0;
    const ticker = new Ticker(() => ticks++, clock, 30);
    ticker.start();
    advance(100);
    ticker.stop();
    const at = ticks;
    advance(1000);
    expect(ticks).toBe(at);
  });
});

describe('quantile', () => {
  it('is the nearest rank', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantile(v, 0.99)).toBe(99);
    expect(quantile(v, 0.5)).toBe(50);
    expect(quantile([], 0.99)).toBe(0);
  });
});
