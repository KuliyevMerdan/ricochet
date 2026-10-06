import { ARENA_0, RULES } from '@ricochet/protocol';
import type { View } from '@ricochet/protocol';
import { createWorld, stepShell, step, view } from '@ricochet/sim';
import type { Command, TankBody, World } from '@ricochet/sim';
import { describe, expect, it } from 'vitest';
import { Replay, pointAt } from './replay.js';

const tank = (over: Partial<TankBody>): TankBody => ({
  id: 1,
  x: 0,
  y: 0,
  hull: 0,
  turret: 0,
  hp: 3,
  alive: true,
  reload: 0,
  shield: 0,
  respawn: 0,
  score: 0,
  ...over,
});

/** Down and to the west: off the arena's west edge, then down and to the east. */
const AIM = 448;
const SHOOTER = { x: 2200, y: 2900 };

/** The real `sim`, a shooter firing once along `AIM`, and the victim's views tick by tick. */
function play(victim: { x: number; y: number }, ticks: number): View[] {
  let w: World = {
    ...createWorld(1),
    crateIn: 10_000,
    tanks: [tank({ id: 1, ...SHOOTER, turret: AIM }), tank({ id: 2, ...victim, hp: 1 })],
  };
  const views: View[] = [];
  for (let t = 0; t < ticks; t++) {
    const commands = new Map<number, Command>();
    if (t === 0) commands.set(1, { aim: AIM, move: null, fire: true, seq: 1, lead: 0 });
    const r = step(w, commands);
    w = r.world;
    views.push(view(w, 2, r.events, 0));
  }
  return views;
}

/** Where the shell from `SHOOTER` would be, `n` ticks after the firing tick, with no tanks. */
function shellPath(n: number): { x: number; y: number; bounced: boolean } {
  const views = play({ x: 6000, y: 1000 }, 2); // in view, out of the way
  const s = views[0]?.shells[0];
  if (!s) throw new Error('no shell');
  let b: Parameters<typeof stepShell>[0] | null = { ...s };
  for (let i = 0; i < n && b; i++) b = stepShell(b, ARENA_0);
  if (!b) throw new Error('the shell ended');
  return b;
}

describe('Replay — the last seconds before a death, from the views', () => {
  // Off the wall and twelve ticks on, a tank stands a little off the shell's line.
  const on = shellPath(20);
  const victim = { x: on.x + 60, y: on.y - 90 };
  const views = play(victim, 40);
  const replay = Replay.of(views, 2, ARENA_0);

  it('finds the death and its killer', () => {
    expect(on.bounced).toBe(true);
    expect(replay).not.toBeNull();
    expect(replay?.killer).toBe(1);
    expect(replay?.where).toEqual(victim);
    const death = views.findIndex((v) => v.events.some((e) => e.type === 'kill'));
    expect(replay?.to).toBe(views[death]?.tick);
  });

  it('traces the fatal shell off its wall to the edge of the tank it reached', () => {
    const f = replay?.fatal;
    if (!f || !replay) throw new Error('no fatal path');
    // The bounce: on the west wall's face, grown by the shell's radius.
    expect(Math.abs((f.bounce?.x ?? 0) - RULES.shellRadius)).toBeLessThanOrEqual(2);
    // The hit: where the flight first comes within reach — on the edge, not the centre.
    const reach = RULES.tankRadius + RULES.shellRadius;
    const d = Math.hypot(f.hit.x - victim.x, f.hit.y - victim.y);
    expect(Math.abs(d - reach)).toBeLessThanOrEqual(2);
    expect(f.hit.tick).toBeGreaterThan(replay.to - 1);
    expect(f.hit.tick).toBeLessThanOrEqual(replay.to);
    // In order, and the bounce among the points.
    expect(f.points.every((p, i) => i === 0 || p.tick >= (f.points[i - 1]?.tick ?? 0))).toBe(true);
    expect(f.points).toContainEqual(f.bounce);
    expect(f.points.at(-1)).toEqual(f.hit);
  });

  it('draws the fatal shell on its path at every moment, and stops it at the tank', () => {
    const f = replay?.fatal;
    if (!f || !replay) throw new Error('no fatal path');
    let compared = 0;
    for (let t = replay.from; t <= replay.to; t += 0.25) {
      const s = replay.at(t).shells.find((x) => x.id === f.id);
      const p = pointAt(f.points, t);
      if (t > f.hit.tick || !p) {
        expect(s, `tick ${t}`).toBeUndefined();
        continue;
      }
      if (!s) continue; // before the views held it
      // On the path within a unit — through the bounce too, where a straight line between whole
      // ticks would cut the corner.
      expect(Math.hypot(s.x - p.x, s.y - p.y), `tick ${t}`).toBeLessThan(10);
      compared++;
    }
    expect(compared).toBeGreaterThan(4 * 12); // every quarter tick from before the bounce
    const tanks = replay.at(replay.to).tanks;
    expect(tanks.find((t) => t.id === 2)?.alive).toBe(false);
  });

  it('is null with no death in the views', () => {
    expect(Replay.of(views.slice(0, 5), 2, ARENA_0)).toBeNull();
  });
});
