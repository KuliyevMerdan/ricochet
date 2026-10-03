import { circleOverlapsBox } from '@ricochet/geom';
import { ARENA_0, RULES, apply, decodeServer, diff, encodeServer } from '@ricochet/protocol';
import type { GameEvent, View } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { blocked, createWorld, join, leave, step, stepTank, view } from './index.js';
import type { Command, TankBody, World } from './index.js';

/** The test's own seeded stream — the commands are the test's, the world's randomness its own. */
function mulberry32(seed: number): () => number {
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
function players(seed: number) {
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
function* room(seed: number, ticks: number) {
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

const moveOf = (t: TankBody) => ({ x: t.x, y: t.y, hull: t.hull, turret: t.turret });

/**
 * Every invariant a world must hold after a tick, as a list of what broke — empty when nothing did.
 */
function broken(before: World, after: World, events: readonly GameEvent[]): string[] {
  const out: string[] = [];
  const live = after.tanks.filter((t) => t.alive);
  for (const t of after.tanks) {
    if (t.alive !== t.hp > 0) out.push(`tank ${t.id}: alive ${t.alive} at ${t.hp} hp`);
    if (t.hp < 0 || t.hp > RULES.hitPoints) out.push(`tank ${t.id}: ${t.hp} hp`);
    if (!t.alive && t.respawn < 1) out.push(`tank ${t.id}: dead with no respawn`);
  }
  for (const t of live) {
    if (
      blocked(
        t.x,
        t.y,
        ARENA_0,
        live.filter((o) => o.id !== t.id),
      )
    ) {
      out.push(`tank ${t.id} overlaps a wall or a tank at (${t.x}, ${t.y})`);
    }
  }
  const owned = new Map<number, number>();
  for (const s of after.shells) {
    owned.set(s.owner, (owned.get(s.owner) ?? 0) + 1);
    if (s.x < 0 || s.y < 0 || s.x >= RULES.arena || s.y >= RULES.arena)
      out.push(`shell ${s.id} off the arena`);
    for (const w of ARENA_0.walls) {
      if (circleOverlapsBox(s.x, s.y, RULES.shellRadius, w))
        out.push(`shell ${s.id} inside a wall at (${s.x}, ${s.y})`);
    }
  }
  for (const [owner, n] of owned)
    if (n > RULES.maxShells) out.push(`tank ${owner} has ${n} shells in the air`);

  // The events explain every change of hit points and score — the fold.
  for (const t of after.tanks) {
    const was = before.tanks.find((b) => b.id === t.id);
    if (!was) continue;
    let hp = was.hp;
    let score = was.score;
    for (const e of events) {
      if (e.type === 'hit' && e.victim === t.id) hp = e.hp;
      if (e.type === 'crate' && e.tank === t.id)
        hp = Math.min(RULES.hitPoints, hp + RULES.crateHeal);
      if (e.type === 'spawn' && e.tank === t.id) hp = RULES.hitPoints;
      if (e.type === 'kill' && e.killer === t.id && e.victim !== t.id) score++;
    }
    if (hp !== t.hp) out.push(`tank ${t.id}: ${t.hp} hp, the events say ${hp}`);
    if (score !== t.score) out.push(`tank ${t.id}: score ${t.score}, the events say ${score}`);
  }
  if (after.tick !== before.tick + 1) out.push('the tick did not advance by one');
  return out;
}

describe('ROADMAP S2 done-when', () => {
  it('100,000 random ticks of 12 tanks hold every invariant, and every view crosses the wire', () => {
    const problems: string[] = [];
    const held = new Map<number, View>();
    const sent = new Map<number, View>();
    let kills = 0;
    let bounces = 0;
    let crates = 0;
    let views = 0;

    for (const { before, after, events } of room(1, 100_000)) {
      problems.push(...broken(before, after, events).map((p) => `tick ${after.tick}: ${p}`));
      kills += events.filter((e) => e.type === 'kill').length;
      crates += events.filter((e) => e.type === 'crate').length;
      bounces += after.shells.filter(
        (s) => s.bounced && !before.shells.find((b) => b.id === s.id)?.bounced,
      ).length;
      if (problems.length > 5) break;

      // Every 10th tick, each player's view through diff, the bytes and apply — as S3 will send it.
      if (after.tick % 10 !== 0) continue;
      for (const t of after.tanks) {
        const v = view(after, t.id, events, 0);
        const frame = encodeServer(diff(sent.get(t.id) ?? null, v));
        const decoded = decodeServer(frame);
        const applied =
          decoded.ok && decoded.value.type === 'snapshot'
            ? apply(held.get(t.id) ?? null, decoded.value)
            : null;
        if (!applied?.ok)
          problems.push(`tick ${after.tick}: tank ${t.id}'s view did not cross the wire`);
        else held.set(t.id, applied.value);
        sent.set(t.id, v);
        views++;
      }
      for (const id of [...sent.keys()])
        if (!after.tanks.some((t) => t.id === id)) {
          sent.delete(id);
          held.delete(id);
        }
    }

    expect(problems).toEqual([]);
    // The run was a game, not a parade: tanks died, shells bounced, crates were taken.
    expect(kills).toBeGreaterThan(1000);
    expect(bounces).toBeGreaterThan(10_000);
    expect(crates).toBeGreaterThan(50);
    expect(views).toBeGreaterThan(100_000);
  }, 300_000);

  it('replaying a tank’s inputs through stepTank reproduces the server’s tank whenever no other tank touched it', () => {
    let windows = 0;
    let replayed = 0;
    let touched = 0;
    let mismatches = 0;
    // A prediction per tank: its state as the client would have it, replaying from the last
    // snapshot every 10 ticks, and only through ticks no other tank touched.
    const predicted = new Map<number, TankBody>();

    for (const { before, commands, after } of room(2, 30_000)) {
      for (const t of after.tanks) {
        const was = before.tanks.find((b) => b.id === t.id);
        const c = commands.get(t.id);
        if (!was || !c || !was.alive || !t.alive) {
          predicted.delete(t.id);
          continue;
        }
        // "No other tank touched it", conservatively: none was within reach of it at either end of
        // the tick. Two tanks closer than two radii and three ticks' driving might have met —
        // including one that respawned this tick and drove off its spawn point.
        const reach = 2 * RULES.tankRadius + 3 * RULES.tankSpeed;
        const near = [...before.tanks, ...after.tanks].some(
          (o) =>
            o.id !== t.id &&
            (o.alive || after.tanks.some((a) => a.id === o.id && a.alive)) &&
            (o.x - was.x) ** 2 + (o.y - was.y) ** 2 < reach * reach,
        );
        if (near) {
          touched++;
          predicted.delete(t.id);
          continue;
        }
        if (after.tick % 10 === 0 || !predicted.has(t.id)) {
          predicted.set(t.id, t); // a snapshot: the prediction starts again from the server's word
          windows++;
          continue;
        }
        const p = stepTank(predicted.get(t.id) ?? was, c, ARENA_0);
        predicted.set(t.id, p);
        replayed++;
        if (JSON.stringify(moveOf(p)) !== JSON.stringify(moveOf(t))) mismatches++;
      }
    }

    expect(mismatches).toBe(0);
    expect(replayed).toBeGreaterThan(200_000);
    expect(windows).toBeGreaterThan(20_000);
    expect(touched).toBeGreaterThan(100); // tanks did push against each other, and those were left out
  }, 300_000);
});

describe('determinism', () => {
  /** FNV-1a over the world's JSON — plain data, so its JSON is the world. */
  function hash(w: World): string {
    let h = 0x811c9dc5;
    const s = JSON.stringify(w);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  const last = (seed: number, ticks: number) => {
    let w: World | null = null;
    for (const { after } of room(seed, ticks)) w = after;
    return w ?? createWorld(seed);
  };

  it('the same seed and commands give the same world, byte for byte', () => {
    expect(JSON.stringify(last(3, 3000))).toBe(JSON.stringify(last(3, 3000)));
  });

  it('a different seed gives a different world', () => {
    expect(hash(last(3, 3000))).not.toBe(hash(last(4, 3000)));
  });

  it('5,000 ticks of seed 3 end in the pinned world — a rule change shows up here first', () => {
    // Pinned from a run on 2026-10-03. If this changes, a rule or an order changed: say so in the
    // commit, and repin it on purpose. C1 replays this run in Chromium, Firefox and WebKit.
    expect(hash(last(3, 5000))).toBe('68b4d373');
  });
});
