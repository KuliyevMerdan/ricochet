import { describe, expect, it } from 'vitest';
import { bench, quantiles } from './bench.js';

describe('bench', () => {
  it('times the tick and counts the bytes — deltas under whole snapshots, 15 Hz under 30', () => {
    const r = bench({ tanks: 6, seed: 1, warmup: 30, ticks: 300, deflateEvery: 10 });
    expect(r.tick.p50).toBeGreaterThan(0);
    expect(r.tick.p99).toBeGreaterThanOrEqual(r.tick.p50);
    expect(r.step.p99).toBeLessThanOrEqual(r.tick.max);
    expect(r.down.delta.mean).toBeLessThan(r.down.full.mean);
    expect(r.down.delta15.mean).toBeLessThan(r.down.delta.mean);
    expect(r.down.delta.worst).toBeGreaterThanOrEqual(r.down.delta.mean);
    expect(r.deflate.context).toBeLessThan(1);
  }, 60_000);

  it('reads quantiles off the sorted samples', () => {
    const q = quantiles(Array.from({ length: 100 }, (_, i) => 100 - i));
    expect(q).toEqual({ p50: 51, p99: 100, max: 100 });
  });
});
