import { SKILLS, createBot, decide } from '@ricochet/bots';
import type { Memory, Skill } from '@ricochet/bots';
import { ARENA_0 } from '@ricochet/protocol';
import type { GameEvent } from '@ricochet/protocol';
import { createWorld, join, step, view } from '@ricochet/sim';
import type { Command, World } from '@ricochet/sim';

/** The skills a room of bots cycles through, so a room is a mix and not a mirror. */
export const MIX: readonly Skill[] = [SKILLS.normal, SKILLS.hard, SKILLS.easy, SKILLS.normal];

/**
 * A room played only by bots, with no server and no sockets: each tick every bot is handed the view
 * a player in its seat would hold, its input becomes its tank's command, and `sim.step` runs. The
 * bench times it; the tests watch it.
 */
export class BotRoom {
  world: World;
  /** The last tick's events — what the next tick's views carry, as a snapshot would. */
  events: readonly GameEvent[] = [];
  readonly bots = new Map<number, Memory>();

  constructor(tanks: number, seed: number) {
    let w = createWorld(seed);
    const events: GameEvent[] = [];
    for (let id = 1; id <= tanks; id++) {
      const r = join(w, id);
      w = r.world;
      events.push(...r.events);
      const skill = MIX[(id - 1) % MIX.length] ?? SKILLS.normal;
      this.bots.set(id, createBot(id, ARENA_0, (seed ^ Math.imul(id, 0x9e3779b1)) >>> 0, skill));
    }
    this.world = w;
    this.events = events;
  }

  /** Every bot's command for the coming tick, from the world as it stands. */
  decide(): Map<number, Command> {
    const commands = new Map<number, Command>();
    for (const [id, memory] of this.bots) {
      const r = decide(view(this.world, id, this.events, 0), memory);
      this.bots.set(id, r.memory);
      commands.set(id, r.input);
    }
    return commands;
  }

  /** One tick of the world on those commands. */
  step(commands: ReadonlyMap<number, Command>): readonly GameEvent[] {
    const r = step(this.world, commands);
    this.world = r.world;
    this.events = r.events;
    return r.events;
  }
}
