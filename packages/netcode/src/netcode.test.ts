import { RULES } from '@ricochet/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from './__fixtures__/net.js';
import type { Judged, Run, Scenario } from './__fixtures__/net.js';

/**
 * ROADMAP C0's done-when, in virtual time: a client on a 150 ± 40 ms link to a server stepping the
 * real `sim`, driving a scripted route among five tanks that wander and shoot. Every reconciliation
 * is judged against the tick the server actually stepped: where no other tank could have blocked
 * the own tank, the prediction must be the server's to the bit.
 */

const MINUTES = 10;
/** 150 ms of round trip, each way 75 ± 20 — so the round trip is 150 ± 40. */
const LINK = { rtt: 150, jitter: 20, others: 5 };

/** A run, made once before a describe's tests — ten virtual minutes are a second or two of work. */
function ran(s: Scenario): () => Run {
  let r: Run | null = null;
  beforeAll(() => {
    r = run(s);
  }, 60_000);
  return () => {
    if (!r) throw new Error('the run has not been made');
    return r;
  };
}

const of = (r: Run, touch: Judged['touch']) => r.judged.filter((j) => j.touch === touch);
const exact = (js: readonly Judged[]) => js.filter((j) => j.error === 0).length;
const withinUnit = (js: readonly Judged[]) => js.filter((j) => j.error <= 8).length;

/** Each input applied at most once, in order: the server's record of what it applied rises. */
const rising = (xs: readonly number[]) => xs.every((x, i) => i === 0 || x > (xs[i - 1] ?? 0));

describe('ROADMAP C0 done-when: 10 minutes at 150 ± 40 ms', () => {
  const get = ran({ ...LINK, seconds: MINUTES * 60, seed: 1 });

  it('stays live and plays the whole route', () => {
    const r = get();
    expect(r.client.state.kind).toBe('live');
    // One input a tick, every tick but the first second's handshake and sync.
    expect(r.server.applied.length).toBeGreaterThan(MINUTES * 60 * 30 - 60);
    expect(r.server.dropped).toBe(0);
    expect(rising(r.server.applied)).toBe(true);
  });

  it('agrees with the server to the bit after every reconciliation no other tank touched', () => {
    const r = get();
    const apart = of(r, 'apart');
    expect(apart.length).toBeGreaterThan(15_000);
    expect(exact(apart)).toBe(apart.length);
  });

  it('within one unit in 99 % of the ticks another tank was close enough to block it', () => {
    const r = get();
    const contact = of(r, 'contact');
    expect(contact.length).toBeGreaterThan(100); // the route met the others: the number means something
    expect(withinUnit(contact) / contact.length).toBeGreaterThanOrEqual(0.99);
  });

  it('draws a respawn where the server put it, at once', () => {
    const r = get();
    const respawns = of(r, 'respawn');
    expect(respawns.length).toBeGreaterThan(5);
    expect(respawns.every((j) => j.rec.snapped)).toBe(true);
  });

  it('never draws the others from a snapshot it does not have', () => {
    const r = get();
    expect(r.frames).toBeGreaterThan(MINUTES * 60 * 60 - 120);
    expect(r.frameProblems).toEqual([]);
  });

  it('draws the others about 100 ms behind', () => {
    const r = get();
    const { delayMs } = r.client.stats();
    expect(delayMs).toBeGreaterThanOrEqual(66);
    expect(delayMs).toBeLessThan(150);
  });
});

describe('a link that stalls', () => {
  // Two one-second stalls, both ways at once — TCP holds everything back, then delivers it in a burst.
  const get = ran({
    ...LINK,
    seconds: 60,
    seed: 2,
    stalls: [
      [20_000, 21_000],
      [40_000, 41_000],
    ],
  });

  it('applies every input once at most, in order, and stays live', () => {
    const r = get();
    expect(r.client.state.kind).toBe('live');
    expect(rising(r.server.applied)).toBe(true);
    // What a full queue dropped is all that is missing (protocol § 4.2).
    const last = r.server.applied.at(-1) ?? 0;
    expect(r.server.applied.length + r.server.dropped).toBeGreaterThanOrEqual(last - 10);
  });

  it('holds the others at most a tick past the newest snapshot, and catches up after', () => {
    const r = get();
    expect(r.frameProblems).toEqual([]);
    const afterStall = r.snapshotTicks.filter((t) => t > 45 * 30);
    expect(afterStall.length).toBeGreaterThan(0);
  });

  it('is exact again within three seconds of each stall', () => {
    const r = get();
    const settled = of(r, 'apart').filter((j) => {
      const s = (j.rec.tick * 1000) / 30;
      return !(s >= 20_000 && s < 24_000) && !(s >= 40_000 && s < 44_000);
    });
    expect(settled.length).toBeGreaterThan(1000);
    expect(exact(settled)).toBe(settled.length);
  });

  it('works off the burst it queued, then sends at the server’s rate again', () => {
    const r = get();
    // The last ten seconds: the queue on the server back to what the link needs.
    expect(r.client.stats().unacked).toBeLessThanOrEqual(8);
  });
});

describe('a client clock that drifts 50 ms a minute', () => {
  for (const sign of [1, -1]) {
    it(`${sign > 0 ? 'fast' : 'slow'}: tracks the server's tick within one, sends at its rate, stays exact`, () => {
      const r = run({ ...LINK, seconds: MINUTES * 60, seed: 3, drift: (sign * 50) / 60_000 });
      expect(Math.max(...r.clockErrors.map(Math.abs))).toBeLessThan(1);
      // 50 ms a minute is 15 ticks in ten: on its own clock the client would have overrun the
      // server's queue or starved it.
      expect(r.server.dropped).toBe(0);
      const apart = of(r, 'apart');
      expect(exact(apart)).toBe(apart.length);
      expect(r.frameProblems).toEqual([]);
    }, 60_000);
  }
});

describe('protocol D15 — a tick with no input stands the tank still', () => {
  // Inputs held 120 ms on the way up, every ten seconds: the server's queue runs dry for a tick or
  // two each time, and then the held inputs arrive together, within what the queue keeps.
  const hiccups = Array.from({ length: 11 }, (_, i): [number, number] => [
    5000 + i * 10_000,
    5120 + i * 10_000,
  ]);
  const late = (rule: 'stand' | 'hold') => {
    const r = run({ ...LINK, jitter: 0, seconds: 120, seed: 5, upStalls: hiccups, late: rule });
    const first = r.server.applied[0] ?? 0;
    const ticks = [...r.server.truth.values()];
    const from = ticks.findIndex((t) => t.applied === first);
    const starved = ticks.slice(from).filter((t) => t.applied === 0).length;
    const apart = of(r, 'apart');
    return { starved, dropped: r.server.dropped, wrong: apart.length - exact(apart) };
  };

  it('keeps the prediction exact through a late input', () => {
    const stand = late('stand');
    expect(stand.starved).toBeGreaterThan(11);
    expect(stand.dropped).toBe(0);
    expect(stand.wrong).toBe(0);
  }, 60_000);

  it('where holding the stick (D14) mispredicts the tick after it', () => {
    const hold = late('hold');
    expect(hold.dropped).toBe(0);
    // A wrong prediction for most of the eleven (8 on this seed): the tick after a dry one, the
    // server's tank is a held stick ahead of where the client's replay puts it.
    expect(hold.wrong).toBeGreaterThanOrEqual(5);
  }, 60_000);
});

describe('ROADMAP C2 — the own shots and the server’s hits, the same 10 minutes', () => {
  const get = ran({ ...LINK, seconds: MINUTES * 60, seed: 1 });

  it('draws a hit only where the server sent one, and every one it sent', () => {
    const r = get();
    const struck = new Set<string>();
    for (const t of r.server.truth.values())
      for (const h of t.hits) struck.add(`${h.shell}:${h.victim}`);
    const drawn = r.effects.flatMap((e) => (e.effect.kind === 'hit' ? [e.effect] : []));
    expect(drawn.length).toBeGreaterThan(100);
    expect(drawn.filter((h) => !struck.has(`${h.shell}:${h.victim}`))).toEqual([]);
    // Each hit the client was sent, drawn once — but those still ahead of the drawn time at the end.
    expect(new Set(drawn.map((h) => `${h.shell}:${h.victim}`)).size).toBe(drawn.length);
    expect(drawn.length).toBeGreaterThanOrEqual(r.hitEvents.length - 1);
  });

  it('fires its own shots at once and has the server adopt them, fizzling only what it refused', () => {
    const r = get();
    const s = r.client.stats().shots;
    expect(s.predicted).toBeGreaterThan(600); // a trigger every half second, less dead or shielded
    expect(s.adopted / s.predicted).toBeGreaterThan(0.85); // the rest died at once, into a wall
    expect(s.unforeseen).toBeLessThanOrEqual(s.predicted / 100);
    const refused = new Set(r.server.refused.map((f) => f.seq));
    const fizzled = r.effects.flatMap((e) => (e.effect.kind === 'fizzle' ? [e.effect.seq] : []));
    expect(fizzled.length).toBeLessThanOrEqual(s.predicted / 100);
    expect(fizzled.filter((seq) => !refused.has(seq))).toEqual([]);
    // The step from the predicted shell to the server's, at adoption: under 8 units on average.
    expect(s.stepMean).toBeLessThan(64);
  });
});

describe('protocol D16 — a shell is fast-forwarded by its input’s wait in the queue too', () => {
  it('meets its predicted shell where ADR-0002 alone would leave it a tick or two behind', () => {
    const step = (queued: boolean) =>
      run({ ...LINK, seconds: 120, seed: 4, queued }).client.stats().shots.stepMean;
    const alone = step(false);
    const both = step(true);
    expect(alone).toBeGreaterThan(RULES.shellSpeed / 2); // over half a tick's flight: 10 units
    expect(both).toBeLessThan(alone / 2);
  }, 60_000);
});
