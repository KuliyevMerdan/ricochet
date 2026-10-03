import { RULES } from '@ricochet/protocol';
import type { GameEvent, Tank, View } from '@ricochet/protocol';
import { arenaOf } from './world.js';
import type { TankBody, World } from './world.js';

const within = (cx: number, cy: number, x: number, y: number) =>
  Math.abs(x - cx) <= RULES.viewHalf && Math.abs(y - cy) <= RULES.viewHalf;

function onWire(t: TankBody): Tank {
  return {
    id: t.id,
    x: t.x,
    y: t.y,
    hull: t.hull,
    turret: t.turret,
    hp: t.hp,
    shield: t.shield > 0,
    alive: t.alive,
  };
}

/**
 * What one player may know of the world at this tick — **the one door to the wire**
 * (docs/protocol.md invariant 2). Tanks and shells whose centres lie within `viewHalf` of the
 * viewer's tank on both axes, the viewer always; the viewer's own timers; the crates; and the tick's
 * events filtered by § 6 — `shot` to its shooter, `hit` and `spawn` where the tank is in view,
 * `crate` where the spot is, `kill` to everyone. `ack` is the server's, not the world's: the last
 * input it applied for this player.
 *
 * A viewer not in the world is a bug.
 */
export function view(
  world: World,
  viewer: number,
  events: readonly GameEvent[],
  ack: number,
): View {
  const me = world.tanks.find((t) => t.id === viewer);
  if (!me) throw new Error(`tank ${viewer} is not in the room`);
  const sees = (x: number, y: number) => within(me.x, me.y, x, y);
  const tankIn = (id: number) => {
    const t = world.tanks.find((o) => o.id === id);
    return t !== undefined && (t.id === viewer || sees(t.x, t.y));
  };
  const arena = arenaOf(world);

  return {
    tick: world.tick,
    ack,
    self: {
      reload: me.reload,
      shells: world.shells.filter((s) => s.owner === viewer).length,
      respawn: me.respawn,
      shield: me.shield,
    },
    crates: world.crates,
    tanks: world.tanks.filter((t) => t.id === viewer || sees(t.x, t.y)).map(onWire),
    shells: world.shells.filter((s) => sees(s.x, s.y)).map((s) => ({ ...s, at: world.tick })),
    events: events.filter((e) => {
      switch (e.type) {
        case 'shot':
          return e.tank === viewer;
        case 'hit':
          return tankIn(e.victim);
        case 'spawn':
          return tankIn(e.tank);
        case 'crate': {
          const spot = arena.crates[e.spot];
          return spot !== undefined && sees(spot.x, spot.y);
        }
        case 'kill':
          return true;
      }
    }),
  };
}
