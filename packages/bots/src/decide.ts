import { HALF_TURN, wrapDir } from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena, Point, Tank, View } from '@ricochet/protocol';
import { RANGE, dirTo, shotAt } from './aim.js';
import { CELL, cellAt, fieldTo, gridOf, waypoint } from './nav.js';
import { below, unit } from './rng.js';

/**
 * How good a bot is. `spread` is the deliberate error, in directions either side of a perfect aim,
 * drawn afresh for every shot — the difficulty is a number, not a different algorithm. `bank` lets
 * it take a shot off a wall when the straight line is blocked.
 */
export interface Skill {
  readonly spread: number;
  readonly bank: boolean;
}

export const SKILLS = {
  easy: { spread: 40, bank: false },
  normal: { spread: 24, bank: true },
  hard: { spread: 12, bank: true },
} as const satisfies Record<string, Skill>;

/** One tick's input, as a player's would be: a direction to drive (or none), a direction to aim, a
 * trigger. The server numbers it. */
export interface BotInput {
  readonly aim: number;
  readonly move: number | null;
  readonly fire: boolean;
}

/** Where a tank was when the bot last saw it — how it tells which way a target is moving. */
interface Sighting {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

/**
 * Everything a bot carries from one tick to the next. Plain data, replaced rather than changed:
 * `decide` takes one and returns the next, so a bot is as replayable as the world it plays in.
 */
export interface Memory {
  readonly id: number;
  readonly arena: Arena;
  readonly skill: Skill;
  /** The bot's own seeded stream (`rng.ts`). */
  readonly rng: number;
  readonly seen: readonly Sighting[];
  /** Where it wanders while it sees no one, and until when. */
  readonly roam: Point | null;
  readonly roamUntil: number;
  /** Where it stood last tick, and for how many ticks a held stick has not moved it. */
  readonly last: Point | null;
  readonly stuck: number;
  /** A direction to drive blind until a tick, to work loose from another tank. */
  readonly unstick: { readonly dir: number; readonly until: number } | null;
  /** Which way it circles a target, and until when. */
  readonly strafe: 1 | -1;
  readonly strafeUntil: number;
}

export function createBot(id: number, arena: Arena, seed: number, skill: Skill): Memory {
  gridOf(arena); // built now rather than on the first tick of play
  return {
    id,
    arena,
    skill,
    rng: seed >>> 0,
    seen: [],
    roam: null,
    roamUntil: 0,
    last: null,
    stuck: 0,
    unstick: null,
    strafe: 1,
    strafeUntil: 0,
  };
}

/** Closer than this, a bot backs off as it circles; further, it closes in. */
const NEAR = 2400;
/** Within this, with a clear line, a bot fights instead of travelling. */
const ENGAGE = 5600;
/** A held stick that moves the tank less than this in a tick is not moving it. */
const STILL = 8;
const STUCK_TICKS = 8;

const d2 = (a: Point, b: Point) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/**
 * One tick of a bot: the view it was sent — exactly what a player's client holds, never more
 * (CLAUDE.md § Dependency rules: `bots` may not import `sim`) — and its memory, in; an input and
 * the next memory out. Pure: the same view and memory give the same input.
 *
 * It picks the nearest tank it can hurt, or a crate when it is hurt and one is up, or somewhere to
 * wander; drives there round the walls by the grid, circling a target it can see instead of ramming
 * it; and fires when a shell — straight, or off a wall — would land where the target will be,
 * spoiled by the skill's error.
 */
export function decide(view: View, memory: Memory): { input: BotInput; memory: Memory } {
  const me = view.tanks.find((t) => t.id === memory.id);
  const seen = view.tanks.map((t) => ({ id: t.id, x: t.x, y: t.y, tick: view.tick }));
  if (!me || !me.alive) {
    const aim = me?.turret ?? 0;
    return {
      input: { aim, move: null, fire: false },
      memory: { ...memory, seen, last: null, stuck: 0, unstick: null },
    };
  }

  let rng = memory.rng;
  const draw = (n: number) => {
    const [v, s] = below(rng, n);
    rng = s;
    return v;
  };
  const drawUnit = () => {
    const [v, s] = unit(rng);
    rng = s;
    return v;
  };

  const target = pickTarget(view, me);
  const velocity = (t: Tank): Point => {
    const was = memory.seen.find((s) => s.id === t.id);
    const dt = was ? view.tick - was.tick : 0;
    return was && dt > 0 && dt <= 3
      ? { x: (t.x - was.x) / dt, y: (t.y - was.y) / dt }
      : { x: 0, y: 0 };
  };

  // Where to go.
  const crate = nearestCrate(view, memory.arena, me);
  const hurt = me.hp < RULES.hitPoints;
  let roam = memory.roam;
  let roamUntil = memory.roamUntil;
  let goal: Point;
  if (crate && hurt && (me.hp === 1 || !target)) {
    goal = crate;
  } else if (target) {
    goal = target;
  } else {
    if (!roam || view.tick >= roamUntil || d2(roam, me) < (2 * CELL) ** 2) {
      const spots = [...memory.arena.spawns, ...memory.arena.crates];
      roam = spots[draw(spots.length)] ?? null;
      roamUntil = view.tick + 300;
    }
    goal = roam ?? me;
  }

  // How to drive there.
  let strafe = memory.strafe;
  let strafeUntil = memory.strafeUntil;
  if (view.tick >= strafeUntil) {
    strafe = draw(2) === 0 ? 1 : -1;
    strafeUntil = view.tick + 30 + draw(60);
  }
  let move: number | null;
  const sightline = target !== null && goal === target && clearShot(memory.arena, me, target);
  if (memory.unstick && view.tick < memory.unstick.until) {
    move = memory.unstick.dir;
  } else if (target && sightline && d2(me, target) < ENGAGE * ENGAGE) {
    const toward = dirTo(target.x - me.x, target.y - me.y);
    move =
      d2(me, target) < NEAR * NEAR
        ? wrapDir(toward + HALF_TURN - strafe * (HALF_TURN / 4))
        : wrapDir(toward + strafe * (HALF_TURN / 2));
  } else {
    const grid = gridOf(memory.arena);
    const field = fieldTo(grid, cellAt(goal.x, goal.y));
    const next = waypoint(grid, field, me.x, me.y) ?? goal;
    move = d2(next, me) > STILL * STILL ? dirTo(next.x - me.x, next.y - me.y) : null;
  }

  // Working loose: a stick held for ticks without the tank moving is another tank in the way.
  let stuck = memory.stuck;
  let unstick = memory.unstick && view.tick < memory.unstick.until ? memory.unstick : null;
  const moved = memory.last
    ? Math.abs(me.x - memory.last.x) + Math.abs(me.y - memory.last.y)
    : STILL;
  stuck = move !== null && !unstick && moved < STILL ? stuck + 1 : 0;
  if (stuck >= STUCK_TICKS) {
    unstick = { dir: draw(1024), until: view.tick + 12 + draw(12) };
    move = unstick.dir;
    strafe = strafe === 1 ? -1 : 1;
    stuck = 0;
  }

  // Aim and fire.
  let aim = move ?? me.turret;
  let fire = false;
  if (target) {
    aim = dirTo(target.x - me.x, target.y - me.y);
    const ready =
      view.self.reload === 0 && view.self.shield === 0 && view.self.shells < RULES.maxShells;
    if (ready && d2(me, target) < RANGE * RANGE) {
      const shot = shotAt(memory.arena, me, target, velocity(target), memory.skill.bank);
      if (shot) {
        const spread = memory.skill.spread;
        aim = wrapDir(shot.dir + Math.round((drawUnit() * 2 - 1) * spread));
        fire = true;
      }
    }
  }

  return {
    input: { aim, move, fire },
    memory: {
      ...memory,
      rng,
      seen,
      roam,
      roamUntil,
      last: { x: me.x, y: me.y },
      stuck,
      unstick,
      strafe,
      strafeUntil,
    },
  };
}

/** The nearest live tank the bot can hurt — a shielded one only when there is nothing else. */
function pickTarget(view: View, me: Tank): Tank | null {
  let best: Tank | null = null;
  let bestScore = Infinity;
  for (const t of view.tanks) {
    if (t.id === me.id || !t.alive) continue;
    const score = d2(t, me) * (t.shield ? 16 : 1);
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** The nearest crate spot holding a crate. */
function nearestCrate(view: View, arena: Arena, me: Point): Point | null {
  let best: Point | null = null;
  for (let i = 0; i < arena.crates.length; i++) {
    const spot = arena.crates[i];
    if (!spot || (view.crates & (1 << i)) === 0) continue;
    if (!best || d2(spot, me) < d2(best, me)) best = spot;
  }
  return best;
}

/** Whether a straight shell from `a` would reach `b` with no wall between. */
function clearShot(arena: Arena, a: Point, b: Point): boolean {
  return shotAt(arena, a, b, { x: 0, y: 0 }, false) !== null;
}
