import { ARENA_EIGHTHS } from '@ricochet/geom';
import type { GameEvent, SelfState, Shell, Snapshot, Tank, TankUpdate } from './messages.js';
import { fail, ok } from './result.js';
import type { Result } from './result.js';

/** A shell with the tick its state holds at: when it entered this view. */
export interface ShellAt extends Shell {
  readonly at: number;
}

/**
 * One client's whole view at one tick — what a snapshot delta is a delta *of*. The server builds
 * it (`sim.view` in S2) and diffs it against the last one it sent on the socket; the client applies
 * each delta to the last view it holds. Tanks and shells are listed in ascending id.
 */
export interface View {
  readonly tick: number;
  readonly ack: number;
  readonly self: SelfState;
  readonly crates: number;
  readonly tanks: readonly Tank[];
  readonly shells: readonly ShellAt[];
  readonly events: readonly GameEvent[];
}

const byId = <T extends { readonly id: number }>(a: T, b: T) => a.id - b.id;

/** A position step a relative update can carry: each axis within an i8. */
const REL_MAX = 127;

function sameState(a: Tank, b: Tank): boolean {
  return (
    a.hull === b.hull &&
    a.turret === b.turret &&
    a.hp === b.hp &&
    a.shield === b.shield &&
    a.alive === b.alive
  );
}

function stateOf(t: Tank) {
  return { hull: t.hull, turret: t.turret, hp: t.hp, shield: t.shield, alive: t.alive };
}

/**
 * The snapshot that takes `base` to `next` (docs/protocol.md § 5). `base` is the last view sent on
 * this socket, or `null` for the first, which is then a delta against nothing — every tank and
 * shell new. A tank is sent only for what changed, its position as a step when the step is small;
 * a shell only when it enters the view, and then never again until it leaves.
 */
export function diff(base: View | null, next: View): Snapshot {
  const was = new Map((base?.tanks ?? []).map((t) => [t.id, t]));
  const hadShell = new Set((base?.shells ?? []).map((s) => s.id));
  const nowTanks = new Set(next.tanks.map((t) => t.id));
  const nowShells = new Set(next.shells.map((s) => s.id));

  const updated: TankUpdate[] = [];
  for (const t of next.tanks) {
    const b = was.get(t.id);
    if (!b) {
      updated.push({ id: t.id, pos: { kind: 'abs', x: t.x, y: t.y }, state: stateOf(t) });
      continue;
    }
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const pos =
      dx === 0 && dy === 0
        ? null
        : Math.abs(dx) <= REL_MAX && Math.abs(dy) <= REL_MAX
          ? { kind: 'rel' as const, dx, dy }
          : { kind: 'abs' as const, x: t.x, y: t.y };
    const state = sameState(b, t) ? null : stateOf(t);
    if (pos || state) updated.push({ id: t.id, pos, state });
  }

  return {
    type: 'snapshot',
    tick: next.tick,
    ack: next.ack,
    self: next.self,
    crates: next.crates,
    tanks: { removed: [...was.keys()].filter((id) => !nowTanks.has(id)), updated },
    shells: {
      removed: [...hadShell].filter((id) => !nowShells.has(id)),
      added: next.shells
        .filter((s) => !hadShell.has(s.id))
        .map(({ id, owner, x, y, dir, bounced, age }) => ({ id, owner, x, y, dir, bounced, age })),
    },
    events: next.events,
  };
}

/**
 * The view a snapshot takes `base` to — or why it cannot: a delta that names a tank or shell the
 * base does not hold, adds one twice, or moves a tank off the arena is not a delta of this base, and
 * the client must not guess (it reconnects for a full snapshot).
 */
export function apply(base: View | null, snap: Snapshot): Result<View> {
  const tanks = new Map((base?.tanks ?? []).map((t) => [t.id, t]));
  for (const id of snap.tanks.removed) {
    if (!tanks.delete(id)) return fail(`removes tank ${id}, which the base does not hold`);
  }
  const touched = new Set<number>();
  for (const u of snap.tanks.updated) {
    if (touched.has(u.id)) return fail(`updates tank ${u.id} twice`);
    touched.add(u.id);
    const b = tanks.get(u.id);
    if (!b && (u.pos?.kind !== 'abs' || !u.state)) {
      return fail(`tank ${u.id} is new but not given whole`);
    }
    const x =
      u.pos?.kind === 'abs' ? u.pos.x : (b?.x ?? 0) + (u.pos?.kind === 'rel' ? u.pos.dx : 0);
    const y =
      u.pos?.kind === 'abs' ? u.pos.y : (b?.y ?? 0) + (u.pos?.kind === 'rel' ? u.pos.dy : 0);
    if (x < 0 || y < 0 || x >= ARENA_EIGHTHS || y >= ARENA_EIGHTHS) {
      return fail(`moves tank ${u.id} off the arena`);
    }
    const state = u.state ?? (b ? stateOf(b) : null);
    if (!state) return fail(`tank ${u.id} has no state`);
    tanks.set(u.id, { id: u.id, x, y, ...state });
  }

  const shells = new Map((base?.shells ?? []).map((s) => [s.id, s]));
  for (const id of snap.shells.removed) {
    if (!shells.delete(id)) return fail(`removes shell ${id}, which the base does not hold`);
  }
  for (const s of snap.shells.added) {
    if (shells.has(s.id)) return fail(`adds shell ${s.id}, which is already in flight`);
    shells.set(s.id, { ...s, at: snap.tick });
  }

  return ok({
    tick: snap.tick,
    ack: snap.ack,
    self: snap.self,
    crates: snap.crates,
    tanks: [...tanks.values()].sort(byId),
    shells: [...shells.values()].sort(byId),
    events: snap.events,
  });
}
