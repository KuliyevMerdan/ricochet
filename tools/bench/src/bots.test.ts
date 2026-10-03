import { RULES } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { BotRoom } from './arena.js';

describe('ROADMAP S4: bots play', () => {
  it('in 10 minutes of a bot-only room every bot scores and every bot dies', () => {
    const room = new BotRoom(RULES.botsFillTo, 2026);
    const ids = room.world.tanks.map((t) => t.id);
    const kills = new Map<number, number>(ids.map((id) => [id, 0]));
    const deaths = new Map<number, number>(ids.map((id) => [id, 0]));
    let selfKills = 0;
    for (let i = 0; i < 10 * 60 * RULES.tickHz; i++) {
      for (const e of room.step(room.decide())) {
        if (e.type !== 'kill') continue;
        deaths.set(e.victim, (deaths.get(e.victim) ?? 0) + 1);
        if (e.killer === e.victim) selfKills++;
        else kills.set(e.killer, (kills.get(e.killer) ?? 0) + 1);
      }
    }
    const total = [...deaths.values()].reduce((s, n) => s + n, 0);
    console.log(
      `kills ${[...kills.values()]} · deaths ${[...deaths.values()]} · self ${selfKills}`,
    );
    expect(
      [...kills].filter(([, n]) => n === 0),
      'bots that never scored',
    ).toEqual([]);
    expect(
      [...deaths].filter(([, n]) => n === 0),
      'bots that never died',
    ).toEqual([]);
    // They shoot each other, mostly — a ricochet that comes home is part of the game, not the game.
    expect(selfKills).toBeLessThan(total / 4);
    // And the scores are the kill events.
    for (const t of room.world.tanks) expect(t.score).toBe(kills.get(t.id));
  }, 180_000);
});
