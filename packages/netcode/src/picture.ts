import { DIRECTIONS, turnBetween } from '@ricochet/geom';
import { RULES } from '@ricochet/protocol';
import type { Arena, ShellAt, Tank } from '@ricochet/protocol';
import { fly, stepShell } from '@ricochet/sim';
import type { ShellBody } from '@ricochet/sim';
import type { Between } from './timeline.js';

/** A tank as it is drawn: a position in eighths and directions in 1,024ths, both fractional. */
export interface DrawnTank {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly hull: number;
  readonly turret: number;
  readonly hp: number;
  readonly alive: boolean;
  readonly shield: boolean;
}

export interface DrawnShell {
  readonly id: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
}

/** A tank further than this between two views, eighths, was put there — a respawn — not driven. */
const TELEPORT = 4 * RULES.tankSpeed;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Between two directions the short way round, in `[0, 1024)`. */
export function lerpDir(a: number, b: number, t: number): number {
  const d = a + turnBetween(a, b) * t;
  return ((d % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}

/** A tank drawn `t` of the way from `a` to `b` — or past `b` along the step from `a`, for `t > 1`.
 * State changes (hit points, the shield, life) show at the view that has them. */
export function between(a: Tank, b: Tank, t: number): DrawnTank {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const state = t < 1 ? a : b;
  if (dx * dx + dy * dy > TELEPORT * TELEPORT || a.alive !== b.alive) {
    return { ...state };
  }
  return {
    id: b.id,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    hull: lerpDir(a.hull, b.hull, t),
    turret: lerpDir(a.turret, b.turret, t),
    hp: state.hp,
    alive: state.alive,
    shield: state.shield,
  };
}

/** Every tank but `you`, at the drawn time: between the two views, or at most a tick past the
 * newest along its last step. A tank in only one of the two is drawn where that view has it, and
 * only once the drawn time has reached it. */
export function others(b: Between, you: number): DrawnTank[] {
  const out: DrawnTank[] = [];
  if (b.to) {
    const next = new Map(b.to.tanks.map((t) => [t.id, t]));
    for (const t of b.from.tanks) {
      if (t.id === you) continue;
      const n = next.get(t.id);
      out.push(n ? between(t, n, b.alpha) : between(t, t, 0));
    }
    return out;
  }
  const prev = new Map((b.before?.tanks ?? []).map((t) => [t.id, t]));
  for (const t of b.from.tanks) {
    if (t.id === you) continue;
    const p = prev.get(t.id);
    out.push(p ? between(p, t, 1 + b.alpha) : between(t, t, 0));
  }
  return out;
}

/**
 * The shells held, flown to the drawn time. A shell on the wire is a starting condition (protocol
 * § 5.3): it is stepped on from the tick it entered the view with `sim.stepShell` — the server's own
 * flight, to the bit — and the fraction of a tick past that is a partial flight, so a shell drawn
 * mid-bounce is on its two legs, not cutting the corner. Each shell's last whole tick is kept, so a
 * frame costs a step at most per shell.
 */
export class Shells {
  private flown = new Map<number, { readonly tick: number; readonly body: ShellBody | null }>();

  constructor(private readonly arena: Arena) {}

  /** The others' shells at the drawn time — the own are `OwnShells`', in the present. */
  draw(b: Between, you: number): DrawnShell[] {
    const whole = Math.floor(b.tick);
    const frac = b.tick - whole;
    const alive = new Set(b.to ? b.to.shells.map((s) => s.id) : b.from.shells.map((s) => s.id));
    const out: DrawnShell[] = [];
    const seen = new Set<number>();
    for (const s of b.from.shells) {
      seen.add(s.id);
      if (s.owner === you) continue;
      // Gone in the next view: it died within this interval, and the server said how (§ 6).
      if (!alive.has(s.id)) continue;
      const body = this.at(s, whole);
      if (!body) continue;
      const part = Math.round(frac * RULES.shellSpeed);
      const f = part > 0 ? fly(body, part, this.arena, null) : null;
      const shown = f && f.fate.kind === 'flying' ? f.shell : body;
      out.push({ id: s.id, owner: s.owner, x: shown.x, y: shown.y, dir: shown.dir });
    }
    for (const id of this.flown.keys()) if (!seen.has(id)) this.flown.delete(id);
    return out;
  }

  reset(): void {
    this.flown.clear();
  }

  /** The shell at a whole tick, stepped from where it was last asked for — `null` once it is gone. */
  private at(s: ShellAt, tick: number): ShellBody | null {
    if (tick < s.at) return null;
    const kept = this.flown.get(s.id);
    const resume = kept !== undefined && kept.tick <= tick;
    let t = resume ? kept.tick : s.at;
    let body: ShellBody | null = resume
      ? kept.body
      : { id: s.id, owner: s.owner, x: s.x, y: s.y, dir: s.dir, bounced: s.bounced, age: s.age };
    while (body && t < tick) {
      body = stepShell(body, this.arena);
      t++;
    }
    this.flown.set(s.id, { tick, body });
    return body;
  }
}
