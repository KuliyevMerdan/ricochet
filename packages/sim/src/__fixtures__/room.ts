import { createWorld, join, leave, step } from '../index.js';
import type { Command, World } from '../index.js';

/**
 * The seeded room the soak and the determinism checks play: twelve players holding a direction for
 * a while, sweeping their aim and firing a third of the time, one leaving and another arriving now
 * and then. Shared with `e2e/determinism.spec.ts`, which runs it in three browser engines.
 */

/** The test's own seeded stream — the commands are the test's, the world's randomness its own. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Players who hold a direction for a while, sweep their aim, fire a third of the time. */
export function players(seed: number) {
  const random = mulberry32(seed);
  const plans = new Map<number, { move: number | null; aim: number; seq: number }>();
  return (ids: readonly number[]): Map<number, Command> => {
    const out = new Map<number, Command>();
    for (const id of ids) {
      const p = plans.get(id) ?? { move: null, aim: 0, seq: 0 };
      if (random() < 0.05) p.move = random() < 0.15 ? null : Math.floor(random() * 1024);
      p.aim = (p.aim + Math.floor(random() * 61) - 30 + 1024) % 1024;
      p.seq += 1;
      plans.set(id, p);
      out.set(id, {
        move: p.move,
        aim: p.aim,
        fire: random() < 0.33,
        seq: p.seq,
        lead: Math.floor(random() * 4),
      });
    }
    return out;
  };
}

/** A room of 12 for `ticks`, a player leaving and another arriving now and then. */
export function* room(seed: number, ticks: number) {
  const random = mulberry32(seed ^ 0x9e3779b9);
  const play = players(seed);
  let w = createWorld(seed);
  let nextId = 1;
  for (; nextId <= 12; nextId++) w = join(w, nextId).world;
  for (let i = 0; i < ticks; i++) {
    if (random() < 0.002) {
      const gone = w.tanks[Math.floor(random() * w.tanks.length)];
      if (gone) w = join(leave(w, gone.id), nextId++).world;
    }
    const commands = play(w.tanks.map((t) => t.id));
    const before = w;
    const r = step(w, commands);
    w = r.world;
    yield { before, commands, after: w, events: r.events };
  }
}

/** FNV-1a over the world's JSON — plain data, so its JSON is the world. */
export function hash(w: World): string {
  let h = 0x811c9dc5;
  const s = JSON.stringify(w);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** The world after `ticks` of the seeded room. */
export function last(seed: number, ticks: number): World {
  let w: World | null = null;
  for (const { after } of room(seed, ticks)) w = after;
  return w ?? createWorld(seed);
}
