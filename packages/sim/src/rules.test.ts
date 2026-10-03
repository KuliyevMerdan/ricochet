import { circleOverlapsBox } from '@ricochet/geom';
import { ARENA_0, RULES } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { BAR_X0, LANE_Y, commands, idle, stage, tank, u } from './__fixtures__/stage.js';
import { join, step, stepTank, view } from './index.js';
import type { ShellBody, World } from './index.js';

const run = (world: World, ticks: number, cmds = commands([])) => {
  let w = world;
  const events = [];
  for (let i = 0; i < ticks; i++) {
    const r = step(w, cmds);
    w = r.world;
    events.push(...r.events);
  }
  return { world: w, events };
};
const tankOf = (w: World, id: number) => w.tanks.find((t) => t.id === id);

describe('driving', () => {
  it('drives tankSpeed along the hull', () => {
    const w = step(stage([tank(1, u(800), LANE_Y)]), commands([[1, { move: 0 }]])).world;
    expect(tankOf(w, 1)).toMatchObject({ x: u(800) + RULES.tankSpeed, y: LANE_Y, hull: 0 });
  });

  it('turns the hull at most hullTurn a tick, driving along it as it turns', () => {
    const w = step(stage([tank(1, u(800), LANE_Y)]), commands([[1, { move: 256 }]])).world;
    expect(tankOf(w, 1)?.hull).toBe(RULES.hullTurn);
  });

  it('reverses rather than turning round when the stick points behind', () => {
    const w = step(stage([tank(1, u(800), LANE_Y)]), commands([[1, { move: 512 }]])).world;
    expect(tankOf(w, 1)).toMatchObject({ x: u(800) - RULES.tankSpeed, hull: 0 });
  });

  it('takes the aim on the turret, moving or not', () => {
    const w = step(stage([tank(1, u(800), LANE_Y)]), commands([[1, { aim: 700 }]])).world;
    expect(tankOf(w, 1)?.turret).toBe(700);
  });

  it('stops flush against a wall and slides along it', () => {
    // Driving east into the bar, then diagonally into it: x stays flush, y keeps moving.
    let w = run(stage([tank(1, u(1400), LANE_Y)]), 40, commands([[1, { move: 0 }]])).world;
    const flush = BAR_X0 - RULES.tankRadius;
    expect(tankOf(w, 1)?.x).toBe(flush);
    w = { ...w, tanks: w.tanks.map((t) => ({ ...t, hull: 128 })) };
    const after = step(w, commands([[1, { move: 128 }]])).world;
    expect(tankOf(after, 1)?.x).toBe(flush);
    expect(tankOf(after, 1)?.y).toBeGreaterThan(LANE_Y);
  });

  it('stops against another tank', () => {
    const w = run(
      stage([tank(1, u(800), LANE_Y), tank(2, u(900), LANE_Y)]),
      20,
      commands([[1, { move: 0 }]]),
    ).world;
    const a = tankOf(w, 1);
    const b = tankOf(w, 2);
    const d2 = ((b?.x ?? 0) - (a?.x ?? 0)) ** 2 + ((b?.y ?? 0) - (a?.y ?? 0)) ** 2;
    expect(d2).toBeGreaterThanOrEqual((2 * RULES.tankRadius) ** 2);
    expect(b?.x).toBe(u(900));
  });

  it('stepTank is what step does to a tank with nothing in its way', () => {
    const world = stage([tank(1, u(800), LANE_Y, { hull: 300 })]);
    const c = { aim: 12, move: 200, fire: false };
    expect(step(world, commands([[1, c]])).world.tanks[0]).toEqual(
      stepTank(world.tanks[0] ?? tank(0, 0, 0), c, ARENA_0),
    );
  });
});

describe('firing', () => {
  it('fires a shell from the muzzle, reloads, and tells the shooter which input fired it', () => {
    const r = step(stage([tank(1, u(800), LANE_Y)]), commands([[1, { fire: true, seq: 9 }]]));
    expect(r.world.shells).toEqual([
      { id: 1, owner: 1, x: u(800) + RULES.muzzle, y: LANE_Y, dir: 0, bounced: false, age: 0 },
    ]);
    expect(tankOf(r.world, 1)?.reload).toBe(RULES.reload);
    expect(r.events).toEqual([{ type: 'shot', shell: 1, tank: 1, seq: 9 }]);
  });

  it('holds fire while reloading, while shielded, and with maxShells in the air', () => {
    const inAir: ShellBody[] = [1, 2, 3].map((id) => ({
      id,
      owner: 1,
      x: u(700),
      y: u(200 + 10 * id),
      dir: 512,
      bounced: false,
      age: 0,
    }));
    const fire = commands([[1, { fire: true }]]);
    for (const world of [
      stage([tank(1, u(800), LANE_Y, { reload: 5 })]),
      stage([tank(1, u(800), LANE_Y, { shield: 5 })]),
      stage([tank(1, u(800), LANE_Y)], inAir),
    ]) {
      expect(step(world, fire).world.shells.filter((s) => s.owner === 1 && s.x > u(750))).toEqual(
        [],
      );
    }
  });

  it('fast-forwards a shell by its lead, capped at fastForwardMax (ADR-0002)', () => {
    const x = (lead: number) =>
      step(stage([tank(1, u(700), LANE_Y)]), commands([[1, { fire: true, lead }]])).world.shells[0]
        ?.x;
    expect(x(2)).toBe(u(700) + RULES.muzzle + 2 * RULES.shellSpeed);
    expect(x(10)).toBe(x(RULES.fastForwardMax));
  });
});

describe('shells', () => {
  const shell = (over: Partial<ShellBody>): ShellBody => ({
    id: 5,
    owner: 9,
    x: u(1300),
    y: LANE_Y,
    dir: 0,
    bounced: false,
    age: 0,
    ...over,
  });

  it('bounce off a wall once, flying back the way they came', () => {
    // 18 units short of the bar's grown face: it bounces within the tick.
    const { world } = run(stage([], [shell({ x: u(1480) })]), 1);
    const s = world.shells[0];
    expect(s?.bounced).toBe(true);
    expect(s?.dir).toBe(512);
    expect(s?.x).toBeLessThan(BAR_X0 - RULES.shellRadius);
    for (const w of ARENA_0.walls)
      expect(circleOverlapsBox(s?.x ?? 0, s?.y ?? 0, RULES.shellRadius, w)).toBe(false);
  });

  it('die on their second wall', () => {
    expect(run(stage([], [shell({ x: u(1480), bounced: true })]), 1).world.shells).toEqual([]);
  });

  it('die at the end of their life', () => {
    const s = shell({ x: u(800), age: RULES.shellLife - 1 });
    expect(step(stage([], [s]), commands([])).world.shells).toEqual([]);
  });

  it('pass their own tank until they have bounced, and hit it after', () => {
    // Facing the bar at point-blank range: out through the hull, off the bar, back into it.
    const r = run(stage([tank(1, u(1400), LANE_Y)]), 10, commands([[1, { fire: true }]]));
    expect(r.events).toContainEqual({ type: 'hit', shell: 1, victim: 1, hp: 2 });
  });
});

describe('damage, death and respawn', () => {
  const duel = () => stage([tank(1, u(700), LANE_Y), tank(2, u(1000), LANE_Y)]);

  it('a hit costs a hit point; the third kills, scores and starts the respawn', () => {
    let w = duel();
    const events = [];
    for (let i = 0; i < 60; i++) {
      const r = step(w, commands([[1, { fire: true }]]));
      w = r.world;
      events.push(...r.events);
    }
    expect(
      events.filter((e) => e.type === 'hit').map((e) => (e.type === 'hit' ? e.hp : -1)),
    ).toEqual([2, 1, 0]);
    expect(events).toContainEqual({ type: 'kill', killer: 1, victim: 2 });
    expect(tankOf(w, 1)?.score).toBe(1);
    expect(tankOf(w, 2)).toMatchObject({ alive: false, hp: 0 });
  });

  it('a shielded tank takes the shell and no damage', () => {
    const w = stage([tank(1, u(700), LANE_Y), tank(2, u(1000), LANE_Y, { shield: 30 })]);
    const r = run(w, 20, commands([[1, { fire: true }]]));
    expect(r.events).toContainEqual({ type: 'hit', shell: 1, victim: 2, hp: 3 });
    expect(tankOf(r.world, 2)?.hp).toBe(3);
  });

  it('a dead tank respawns after respawn ticks, whole and shielded, far from the living', () => {
    const w = stage([
      tank(1, u(700), LANE_Y),
      tank(2, u(1000), LANE_Y, { alive: false, hp: 0, respawn: RULES.respawn }),
    ]);
    const before = run(w, RULES.respawn - 1);
    expect(tankOf(before.world, 2)?.alive).toBe(false);
    const after = step(before.world, commands([]));
    expect(after.events).toEqual([{ type: 'spawn', tank: 2 }]);
    const t = tankOf(after.world, 2);
    expect(t).toMatchObject({ alive: true, hp: RULES.hitPoints, shield: RULES.shield });
    expect(ARENA_0.spawns).toContainEqual({ x: t?.x, y: t?.y });
    // Tank 1 is at the top middle: the furthest spawns are the two bottom corners.
    expect(t?.y).toBe(u(1888));
  });
});

describe('crates', () => {
  it('appear every crateEvery ticks and heal a hurt tank that reaches one', () => {
    const spot = ARENA_0.crates[0] ?? { x: 0, y: 0 };
    let w = stage([tank(1, spot.x, spot.y, { hp: 1 })], [], { crateIn: 1 });
    const r = step(w, commands([]));
    w = r.world;
    expect(r.events).toContainEqual({ type: 'crate', spot: 0, tank: 1 });
    expect(tankOf(w, 1)?.hp).toBe(2);
    expect(w.crates).toBe(0);
    expect(w.crateIn).toBe(RULES.crateEvery);
  });

  it('are left for someone who needs them', () => {
    const spot = ARENA_0.crates[0] ?? { x: 0, y: 0 };
    const w = step(
      stage([tank(1, spot.x, spot.y)], [], { crateIn: 1, rng: 0 }),
      commands([]),
    ).world;
    expect(w.crates).not.toBe(0);
  });
});

describe('joining', () => {
  it('spawns a newcomer at once, and one by one into a full set of spawn points', () => {
    let w = stage([]);
    for (let id = 1; id <= ARENA_0.spawns.length; id++) w = join(w, id).world;
    expect(w.tanks.every((t) => t.alive)).toBe(true);
    const late = join(w, 99);
    expect(late.events).toEqual([]);
    expect(tankOf(late.world, 99)).toMatchObject({ alive: false, respawn: 1 });
  });
});

describe('view', () => {
  it('shows the viewer what is near and nothing that is not, and the shot only to its shooter', () => {
    const w = stage([tank(1, u(800), LANE_Y), tank(2, u(1000), LANE_Y), tank(3, u(1800), u(1800))]);
    const r = step(w, commands([[1, { fire: true, seq: 4 }]]));
    const one = view(r.world, 1, r.events, 7);
    expect(one.tanks.map((t) => t.id)).toEqual([1, 2]);
    expect(one.ack).toBe(7);
    expect(one.events).toEqual([{ type: 'shot', shell: 1, tank: 1, seq: 4 }]);
    expect(view(r.world, 2, r.events, 0).events).toEqual([]);
    expect(view(r.world, 3, r.events, 0).shells).toEqual([]);
  });

  it('tells everyone of a kill', () => {
    const w = stage([tank(1, u(800), LANE_Y), tank(3, u(1800), u(1800))]);
    expect(view(w, 3, [{ type: 'kill', killer: 1, victim: 1 }], 0).events).toHaveLength(1);
  });

  it('keeps idle in the fixtures honest', () => {
    expect(idle).toEqual({ aim: 0, move: null, fire: false });
  });
});
