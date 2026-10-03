import { ARENA_0, RULES } from '@ricochet/protocol';
import type { SelfState, Tank, View } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { dirTo } from './aim.js';
import { SKILLS, createBot, decide } from './decide.js';
import type { Memory, Skill } from './decide.js';

const C = RULES.arena / 2;
const ready: SelfState = { reload: 0, shells: 0, respawn: 0, shield: 0 };

const tank = (id: number, x: number, y: number, over: Partial<Tank> = {}): Tank => ({
  id,
  x,
  y,
  hull: 0,
  turret: 0,
  hp: RULES.hitPoints,
  shield: false,
  alive: true,
  ...over,
});

const viewOf = (tanks: Tank[], over: Partial<View> = {}): View => ({
  tick: 100,
  ack: 0,
  self: ready,
  crates: 0,
  tanks,
  shells: [],
  events: [],
  ...over,
});

const bot = (seed = 1, skill: Skill = SKILLS.hard): Memory => createBot(1, ARENA_0, seed, skill);

/** An enemy in the open, on the arena's centre line, left of the pillar. */
const duel = (over: Partial<View> = {}) => viewOf([tank(1, 2400, C), tank(2, 5600, C)], over);

describe('decide', () => {
  it('fires at a tank in the open when it may, within its skill’s spread of a perfect aim', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { input } = decide(duel(), bot(seed));
      expect(input.fire).toBe(true);
      const off = Math.abs(((input.aim - dirTo(3200, 0) + 1536) % 1024) - 512);
      expect(off).toBeLessThanOrEqual(SKILLS.hard.spread);
    }
  });

  it('holds its fire while reloading, shielded or with every shell in the air — and still aims', () => {
    for (const self of [
      { ...ready, reload: 3 },
      { ...ready, shield: 10 },
      { ...ready, shells: RULES.maxShells },
    ]) {
      const { input } = decide(duel({ self }), bot());
      expect(input.fire).toBe(false);
      expect(input.aim).toBe(0);
    }
  });

  it('stands and holds its fire while dead', () => {
    const v = viewOf([tank(1, 2400, C, { alive: false, hp: 0 }), tank(2, 5600, C)], {
      self: { ...ready, respawn: 40 },
    });
    expect(decide(v, bot()).input).toEqual({ aim: 0, move: null, fire: false });
  });

  it('circles a target it can see rather than driving straight at it', () => {
    const { input } = decide(duel(), bot());
    expect(input.move).not.toBeNull();
    const across = Math.abs((((input.move ?? 0) - 0 + 1536) % 1024) - 512);
    expect(across).toBeGreaterThan(128);
  });

  it('goes for a crate when it is down to its last hit point', () => {
    const crate = ARENA_0.crates[0] ?? { x: 0, y: 0 };
    const me = tank(1, crate.x + 1600, crate.y - 1200, { hp: 1 });
    const v = viewOf([me, tank(2, crate.x + 5000, crate.y - 1200)], { crates: 1 });
    const { input } = decide(v, bot());
    // Down and to the left, toward the crate — not right, toward the enemy.
    expect(input.move ?? 0).toBeGreaterThan(256);
    expect(input.move ?? 0).toBeLessThan(768);
  });

  it('wanders when it sees no one', () => {
    const { input, memory } = decide(viewOf([tank(1, 2400, C)]), bot());
    expect(input.move).not.toBeNull();
    expect(input.fire).toBe(false);
    expect(memory.roam).not.toBeNull();
  });

  it('works loose when a held stick has not moved it for a while', () => {
    let memory = bot();
    const v = viewOf([tank(1, 2400, C)]);
    let unstuck = false;
    for (let i = 0; i < 20; i++) {
      const r = decide({ ...v, tick: 100 + i }, memory);
      memory = r.memory;
      unstuck ||= memory.unstick !== null;
    }
    expect(unstuck).toBe(true);
  });

  it('is pure: the same view and memory give the same input and memory', () => {
    const m = bot(9);
    expect(decide(duel(), m)).toEqual(decide(duel(), m));
  });

  it('only ever sends a direction or none, and an aim', () => {
    let memory = bot(3, SKILLS.normal);
    for (let i = 0; i < 300; i++) {
      const x = 1400 + ((i * 397) % 13000);
      const y = 1400 + ((i * 211) % 13000);
      const v = viewOf([tank(1, x, y), tank(2, 16384 - x, y)], { tick: i });
      const r = decide(v, memory);
      memory = r.memory;
      expect(Number.isInteger(r.input.aim) && r.input.aim >= 0 && r.input.aim < 1024).toBe(true);
      const m = r.input.move;
      expect(m === null || (Number.isInteger(m) && m >= 0 && m < 1024)).toBe(true);
    }
  });
});
