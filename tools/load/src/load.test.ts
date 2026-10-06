import { ARENA_0 } from '@ricochet/protocol';
import type { View } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import type { PlayerReport } from './player.js';
import { BotDriver, PROFILES, ROOM_MIX } from './policy.js';
import { DOWN_BUDGET, markdown, summarise } from './report.js';

const report = (over: Partial<PlayerReport> = {}): PlayerReport => ({
  profile: 'clean',
  seconds: 600,
  bytesIn: 600 * 2000,
  bytesOut: 600 * 300,
  corrections: 10,
  corrected: 10 * 16,
  drops: [],
  unplanned: [],
  liveSeconds: 600,
  kills: 3,
  deaths: 2,
  ...over,
});

const sample = { at: 30, rooms: 20, players: 240, latenessP99Ms: 0.4, workP99Ms: 1.2 };

describe('summarise — ROADMAP P0’s done-when held to a run', () => {
  it('is met by a run on time, under budget, every drop back where it should be', () => {
    const s = summarise(
      [
        report(),
        report({
          profile: 'dropper',
          drops: [
            { long: false, backMs: 300, resumed: true, sameTank: true },
            { long: true, backMs: 14_000, resumed: false, sameTank: false },
          ],
        }),
      ],
      [sample],
      10,
      1000 / 30,
    );
    expect(s.failures).toEqual([]);
    expect(s.down.mean).toBe(2000);
    expect(s.drops).toMatchObject({ short: 1, resumed: 1, long: 1, rejoined: 1 });
    expect(s.corrections['clean']).toEqual({ perMinute: 1, units: 2, clients: 1 });
    expect(markdown(s, 'a laptop', '2026-10-06')).toContain('**Done when:** met.');
  });

  it('fails a late tick, a client over budget, a short drop on a new tank, a long one resumed', () => {
    const s = summarise(
      [
        report({ bytesIn: 600 * DOWN_BUDGET }),
        report({
          drops: [
            { long: false, backMs: 300, resumed: false, sameTank: false },
            { long: false, backMs: null, resumed: null, sameTank: null },
            { long: true, backMs: 9000, resumed: true, sameTank: true },
          ],
          unplanned: ['outdated'],
        }),
      ],
      [{ ...sample, latenessP99Ms: 20, workP99Ms: 14 }],
      10,
      1000 / 30,
    );
    expect(s.failures).toHaveLength(5);
    expect(markdown(s, 'a laptop', '2026-10-06')).toContain('not met');
  });

  it('fails a run the server was never sampled in', () => {
    expect(summarise([report()], [], 1, 1000 / 30).failures).toContain(
      'the server was never sampled',
    );
  });
});

describe('the load clients', () => {
  it('play by the bots’ policy from the view they hold, and stand with none', () => {
    const d = new BotDriver(ARENA_0, 7);
    expect(d.intent(null, 0)).toEqual({ aim: 0, move: null, fire: false });
    const view: View = {
      tick: 10,
      ack: 0,
      self: { reload: 0, shells: 0, respawn: 0, shield: 0 },
      crates: 0,
      tanks: [
        { id: 3, x: 1280, y: 1280, hull: 0, turret: 0, hp: 3, shield: false, alive: true },
        { id: 4, x: 3000, y: 1280, hull: 512, turret: 512, hp: 3, shield: false, alive: true },
      ],
      shells: [],
      events: [],
    };
    const i = d.intent(view, 3);
    expect(i.aim).toBeGreaterThanOrEqual(0);
    expect(i.aim).toBeLessThan(1024);
    // A new tank is a new bot: a rejoin after the grace plays from a fresh memory.
    expect(() =>
      d.intent({ ...view, tanks: view.tanks.map((t) => ({ ...t, id: t.id + 10 })) }, 13),
    ).not.toThrow();
  });

  it('fill a room of twelve half clean, half on the lab’s faults', () => {
    expect(ROOM_MIX).toHaveLength(12);
    expect(ROOM_MIX.filter((n) => n === 'clean')).toHaveLength(6);
    for (const name of ROOM_MIX) expect(PROFILES[name].name).toBe(name);
  });
});
