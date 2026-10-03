import { nearestDir } from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena, GameEvent, Point } from '@ricochet/protocol';
import { below } from './rng.js';
import { fly, flyTick } from './shell.js';
import type { Fate } from './shell.js';
import { blocked, stepTank } from './tank.js';
import { arenaOf } from './world.js';
import type { Command, ShellBody, TankBody, World } from './world.js';

/** A world and what happened in the tick that made it. */
export interface Stepped {
  readonly world: World;
  readonly events: readonly GameEvent[];
}

/** A new room: no tanks, the first crate a full interval away. */
export function createWorld(seed: number, arena = 0): World {
  return {
    tick: 0,
    arena,
    rng: seed >>> 0,
    tanks: [],
    shells: [],
    crates: 0,
    crateIn: RULES.crateEvery,
    nextShell: 1,
  };
}

const byId = <T extends { readonly id: number }>(a: T, b: T) => a.id - b.id;

/**
 * Where a tank spawns: of the spawn points no live tank stands on, the one furthest from its nearest
 * live tank; ties — an empty room among them — drawn from the world's stream. `null` when every
 * spawn point is taken.
 */
function spawnPoint(
  arena: Arena,
  tanks: readonly TankBody[],
  rng: number,
): { point: Point; rng: number } | null {
  const live = tanks.filter((t) => t.alive);
  let best: Point[] = [];
  let bestScore = -1;
  for (const p of arena.spawns) {
    if (blocked(p.x, p.y, arena, live)) continue;
    let nearest = Number.MAX_SAFE_INTEGER;
    for (const t of live) {
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      nearest = Math.min(nearest, dx * dx + dy * dy);
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = [p];
    } else if (nearest === bestScore) {
      best.push(p);
    }
  }
  if (best.length === 0) return null;
  const [i, next] = below(rng, best.length);
  const point = best[i];
  return point ? { point, rng: next } : null;
}

/** The hull of a fresh tank faces the middle of the arena. */
function facingCentre(p: Point): number {
  return nearestDir(RULES.arena / 2 - p.x, RULES.arena / 2 - p.y) ?? 0;
}

function spawned(t: TankBody, p: Point): TankBody {
  const hull = facingCentre(p);
  return {
    ...t,
    x: p.x,
    y: p.y,
    hull,
    turret: hull,
    hp: RULES.hitPoints,
    alive: true,
    reload: 0,
    shield: RULES.shield,
    respawn: 0,
  };
}

/**
 * A player joins: their tank spawns at once if a spawn point is free, else it waits a tick at a time
 * for one. An id already in the room is a bug.
 */
export function join(world: World, id: number): Stepped {
  if (world.tanks.some((t) => t.id === id)) throw new Error(`tank ${id} is already in the room`);
  const arena = arenaOf(world);
  const first = arena.spawns[0] ?? { x: 0, y: 0 };
  const waiting: TankBody = {
    id,
    x: first.x,
    y: first.y,
    hull: 0,
    turret: 0,
    hp: 0,
    alive: false,
    reload: 0,
    shield: 0,
    respawn: 1,
    score: 0,
  };
  const spot = spawnPoint(arena, world.tanks, world.rng);
  const tank = spot ? spawned(waiting, spot.point) : waiting;
  return {
    world: {
      ...world,
      rng: spot ? spot.rng : world.rng,
      tanks: [...world.tanks, tank].sort(byId),
    },
    events: spot ? [{ type: 'spawn', tank: id }] : [],
  };
}

/** A player leaves. Their shells fly on; a kill by a shell whose owner left scores for no one. */
export function leave(world: World, id: number): World {
  return { ...world, tanks: world.tanks.filter((t) => t.id !== id) };
}

/** A shell id not in flight, from `from` on, wrapping in `1 … 65535`. */
function freeShellId(shells: readonly ShellBody[], from: number): number {
  const used = new Set(shells.map((s) => s.id));
  let id = from;
  while (used.has(id)) id = (id % 0xffff) + 1;
  return id;
}

/**
 * One tick of the room — `step(world, commands) → { world, events }`. Pure: the same world and
 * commands give the same result, byte for byte, in any engine. It returns events; it never emits.
 *
 * The order is the rule:
 * 1. **Timers.** Reload and shield count down; a dead tank's respawn counts down, and at zero it
 *    spawns where § spawnPoint says (or waits another tick).
 * 2. **Driving**, in id order, each tank by `stepTank` against the walls and every other live tank
 *    as it stands at that moment.
 * 3. **Firing**, in id order: a live, unshielded, loaded tank with fewer than `maxShells` in the air
 *    and the trigger held fires — a shell from its centre, flown `muzzle` then `lead` ticks
 *    (ADR-0002), able to hit on the way.
 * 4. **Flight**, in id order, of every shell that was in the air before this tick.
 * 5. **Crates**: one appears at a free spot every `crateEvery`; a live tank under full health that
 *    reaches one takes it.
 *
 * A tank with no command this tick stands still and holds its fire. Commands for tanks not in the
 * room are ignored.
 */
export function step(world: World, commands: ReadonlyMap<number, Command>): Stepped {
  const arena = arenaOf(world);
  const events: GameEvent[] = [];
  let rng = world.rng;
  const tanks = new Map<number, TankBody>(world.tanks.map((t) => [t.id, t]));
  const ids = [...tanks.keys()].sort((a, b) => a - b);
  const live = () => [...tanks.values()].filter((t) => t.alive).sort(byId);

  // 1. Timers.
  for (const id of ids) {
    const t = tanks.get(id);
    if (!t) continue;
    if (t.alive) {
      tanks.set(id, { ...t, reload: Math.max(0, t.reload - 1), shield: Math.max(0, t.shield - 1) });
      continue;
    }
    if (t.respawn > 1) {
      tanks.set(id, { ...t, respawn: t.respawn - 1 });
      continue;
    }
    const spot = spawnPoint(arena, live(), rng);
    if (spot) {
      rng = spot.rng;
      tanks.set(id, spawned(t, spot.point));
      events.push({ type: 'spawn', tank: id });
    } else {
      tanks.set(id, { ...t, respawn: 1 });
    }
  }

  // 2. Driving.
  for (const id of ids) {
    const t = tanks.get(id);
    const c = commands.get(id);
    if (!t || !t.alive || !c) continue;
    const others = live().filter((o) => o.id !== id);
    tanks.set(id, stepTank(t, c, arena, others));
  }

  // Damage, death and the score, wherever a shell ends in a tank.
  const strike = (shell: ShellBody, victimId: number) => {
    const victim = tanks.get(victimId);
    if (!victim || !victim.alive) return;
    const hp = victim.shield > 0 ? victim.hp : victim.hp - 1;
    events.push({ type: 'hit', shell: shell.id, victim: victimId, hp });
    if (hp > 0) {
      tanks.set(victimId, { ...victim, hp });
      return;
    }
    tanks.set(victimId, { ...victim, hp: 0, alive: false, respawn: RULES.respawn, shield: 0 });
    events.push({ type: 'kill', killer: shell.owner, victim: victimId });
    const killer = tanks.get(shell.owner);
    if (killer && shell.owner !== victimId)
      tanks.set(shell.owner, { ...killer, score: killer.score + 1 });
  };

  const settle = (shell: ShellBody, fate: Fate): ShellBody | null => {
    if (fate.kind === 'tank') strike(shell, fate.tank);
    return fate.kind === 'flying' ? shell : null;
  };

  // 3. Firing.
  const fired: ShellBody[] = [];
  let nextShell = world.nextShell;
  const inAir = (owner: number) =>
    world.shells.filter((s) => s.owner === owner).length +
    fired.filter((s) => s.owner === owner).length;
  for (const id of ids) {
    const t = tanks.get(id);
    const c = commands.get(id);
    if (!t || !t.alive || !c?.fire || t.shield > 0 || t.reload > 0) continue;
    if (inAir(id) >= RULES.maxShells) continue;

    const shellId = freeShellId([...world.shells, ...fired], nextShell);
    nextShell = (shellId % 0xffff) + 1;
    tanks.set(id, { ...t, reload: RULES.reload });
    if (c.seq !== undefined) events.push({ type: 'shot', shell: shellId, tank: id, seq: c.seq });

    let shell: ShellBody | null = {
      id: shellId,
      owner: id,
      x: t.x,
      y: t.y,
      dir: t.turret,
      bounced: false,
      age: 0,
    };
    const out = fly(shell, RULES.muzzle, arena, live());
    shell = settle(out.shell, out.fate);
    const lead = Math.min(Math.max(0, c.lead ?? 0), RULES.fastForwardMax);
    for (let i = 0; i < lead && shell; i++) {
      const r = flyTick(shell, arena, live());
      shell = settle(r.shell, r.fate);
    }
    if (shell) fired.push(shell);
  }

  // 4. Flight.
  const flown: ShellBody[] = [];
  for (const s of world.shells) {
    const r = flyTick(s, arena, live());
    const kept = settle(r.shell, r.fate);
    if (kept) flown.push(kept);
  }

  // 5. Crates.
  let crates = world.crates;
  let crateIn = world.crateIn - 1;
  if (crateIn <= 0) {
    crateIn = RULES.crateEvery;
    const free = arena.crates.map((_, i) => i).filter((i) => (crates & (1 << i)) === 0);
    if (free.length > 0) {
      const [k, next] = below(rng, free.length);
      rng = next;
      crates |= 1 << (free[k] ?? 0);
    }
  }
  const reach = RULES.tankRadius + RULES.crateRadius;
  arena.crates.forEach((spot, i) => {
    if ((crates & (1 << i)) === 0) return;
    const taker = live().find((t) => {
      const dx = t.x - spot.x;
      const dy = t.y - spot.y;
      return t.hp < RULES.hitPoints && dx * dx + dy * dy < reach * reach;
    });
    if (!taker) return;
    crates &= ~(1 << i);
    tanks.set(taker.id, { ...taker, hp: Math.min(RULES.hitPoints, taker.hp + RULES.crateHeal) });
    events.push({ type: 'crate', spot: i, tank: taker.id });
  });

  return {
    world: {
      tick: world.tick + 1,
      arena: world.arena,
      rng,
      tanks: [...tanks.values()].sort(byId),
      shells: [...flown, ...fired].sort(byId),
      crates,
      crateIn,
      nextShell,
    },
    events,
  };
}
