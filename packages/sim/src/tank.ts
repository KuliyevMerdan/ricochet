import {
  circleOverlapsBox,
  step,
  turnBetween,
  turnToward,
  wrapDir,
  HALF_TURN,
} from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena, Point } from '@ricochet/protocol';
import type { Command, TankBody } from './world.js';

/** Whether a tank centred at `(x, y)` overlaps a wall or another tank. Touching is not overlapping. */
export function blocked(x: number, y: number, arena: Arena, obstacles: readonly Point[]): boolean {
  const r = RULES.tankRadius;
  for (const w of arena.walls) if (circleOverlapsBox(x, y, r, w)) return true;
  const reach = 2 * r;
  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}

/** The furthest a tank gets of `d` along one axis before it is blocked — all of it, or the largest
 * whole number of eighths that is free. */
function slide(from: number, d: number, at: (v: number) => boolean): number {
  if (d === 0 || !at(from + d)) return from + d;
  // Blocked somewhere along the way: the largest free k in [0, |d|), by bisection. A tank moves 59
  // eighths a tick and every wall is at least 512 across once grown by a tank's radius, so the
  // blocked stretch is one interval and bisection finds its edge.
  const sign = d < 0 ? -1 : 1;
  let lo = 0;
  let hi = Math.abs(d);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(from + sign * mid)) hi = mid;
    else lo = mid;
  }
  return from + sign * lo;
}

/**
 * One tick of one tank's driving — **the prediction's entry point**. The client calls it on its own
 * tank with its own inputs; the server's `step` calls it for every tank. Same function, same
 * integers, same answer (ADR-0001).
 *
 * The turret takes the aim. With the stick held, the hull turns toward it — or toward its opposite
 * when that is nearer, and the tank drives in reverse — by at most `hullTurn`, and the tank moves
 * `tankSpeed` along the hull: along x first, then y, each as far as it is free, so a tank slides
 * along a wall rather than sticking to it. `obstacles` are other tanks' centres; the server passes
 * them, a prediction passes none.
 */
export function stepTank(
  tank: TankBody,
  command: Command,
  arena: Arena,
  obstacles: readonly Point[] = [],
): TankBody {
  if (!tank.alive) return tank;
  if (command.move === null) return { ...tank, turret: wrapDir(command.aim) };

  const forward = Math.abs(turnBetween(tank.hull, command.move)) <= HALF_TURN / 2;
  const target = forward ? command.move : command.move + HALF_TURN;
  const hull = turnToward(tank.hull, target, RULES.hullTurn);
  const [dx, dy] = step(forward ? hull : hull + HALF_TURN, RULES.tankSpeed);

  const x = slide(tank.x, dx, (v) => blocked(v, tank.y, arena, obstacles));
  const y = slide(tank.y, dy, (v) => blocked(x, v, arena, obstacles));
  return { ...tank, x, y, hull, turret: wrapDir(command.aim) };
}
