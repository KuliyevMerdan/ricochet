import { RULES } from '@ricochet/protocol';
import { createWorld } from '../step.js';
import type { Command, ShellBody, TankBody, World } from '../world.js';

/** Units to eighths. */
export const u = (units: number) => units * 8;

/**
 * An open lane of arena 0: y = 288 units, clear of every wall from x = 600 to x = 1,450, with the
 * right-hand quadrant's long bar standing across it at x = 1,504–1,536.
 */
export const LANE_Y = u(288);
export const BAR_X0 = u(1504);

export function tank(id: number, x: number, y: number, over: Partial<TankBody> = {}): TankBody {
  return {
    id,
    x,
    y,
    hull: 0,
    turret: 0,
    hp: RULES.hitPoints,
    alive: true,
    reload: 0,
    shield: 0,
    respawn: 0,
    score: 0,
    ...over,
  };
}

export function stage(
  tanks: TankBody[],
  shells: ShellBody[] = [],
  over: Partial<World> = {},
): World {
  return { ...createWorld(7), tanks, shells, ...over };
}

export const idle: Command = { aim: 0, move: null, fire: false };

export function commands(entries: Array<[number, Partial<Command>]>): Map<number, Command> {
  return new Map(entries.map(([id, c]) => [id, { ...idle, ...c }]));
}
