import { RULES } from '@ricochet/protocol';
import type { Arena, ShellAt, Tank, View } from '@ricochet/protocol';
import { fly, flyTick } from '@ricochet/sim';
import type { ShellBody, TankBody } from '@ricochet/sim';
import { between } from './picture.js';
import type { DrawnShell, DrawnTank } from './picture.js';

/** A point on a shell's path, eighths, at a fractional tick. */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

/** The shell that killed: its path from where the views first held it, its bounce, and the hit. */
export interface FatalPath {
  readonly id: number;
  readonly owner: number;
  /** Where it was at each tick, with the bounce and the hit among them, in order. */
  readonly points: readonly PathPoint[];
  /** Where it met its wall, if it did within the views. */
  readonly bounce: PathPoint | null;
  /** Where it reached the tank. */
  readonly hit: PathPoint;
}

/** What `Replay.at` draws: everything the views held, at a fractional tick. */
export interface ReplayPicture {
  readonly tanks: readonly DrawnTank[];
  readonly shells: readonly DrawnShell[];
}

const body = (s: ShellAt): ShellBody => ({
  id: s.id,
  owner: s.owner,
  x: s.x,
  y: s.y,
  dir: s.dir,
  bounced: s.bounced,
  age: s.age,
});

const live = (t: Tank): TankBody => ({
  ...t,
  alive: true,
  hp: Math.max(1, t.hp),
  reload: 0,
  shield: 0,
  respawn: 0,
  score: 0,
});

/** The least distance in 1…`shellSpeed` at which `done` holds — a flight's fate is monotone in its
 * distance. `null` when not even a whole tick's flight does. */
function least(done: (d: number) => boolean): number | null {
  if (!done(RULES.shellSpeed)) return null;
  let lo = 0;
  let hi: number = RULES.shellSpeed;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (done(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The kill replay (ROADMAP C3): the last three seconds before the own tank died, from the views this
 * client was sent — **the server's truth, not the prediction**: the own tank as the snapshots had it,
 * every shell flown from its starting condition with `sim`'s own flight. The shell that killed is
 * traced from where the views first held it, with the point it met its wall and the point it reached
 * the tank found by `sim.fly` itself — the least distance at which the flight bounces, or hits.
 */
export class Replay {
  /** One per held tick, oldest first. */
  private readonly ticks: readonly number[];
  private readonly tanks = new Map<number, readonly Tank[]>();
  /** Every shell's body at every tick a view held it. */
  private readonly shells = new Map<number, readonly ShellBody[]>();

  private constructor(
    private readonly arena: Arena,
    views: readonly View[],
    /** The own tank. */
    readonly you: number,
    /** Who killed it — `you` for its own ricochet. */
    readonly killer: number,
    /** Where it died. */
    readonly where: { readonly x: number; readonly y: number },
    readonly fatal: FatalPath | null,
  ) {
    this.ticks = views.map((v) => v.tick);
    const flown = new Map<number, { tick: number; body: ShellBody | null }>();
    for (const v of views) {
      this.tanks.set(v.tick, v.tanks);
      const out: ShellBody[] = [];
      for (const s of v.shells) {
        const kept = flown.get(s.id);
        let t = kept && kept.tick <= v.tick ? kept.tick : s.at;
        let b: ShellBody | null = kept && kept.tick <= v.tick ? kept.body : body(s);
        while (b && t < v.tick) {
          const r = flyTick(b, arena, null);
          b = r.fate.kind === 'flying' ? r.shell : null;
          t++;
        }
        flown.set(s.id, { tick: v.tick, body: b });
        if (b) out.push(b);
      }
      this.shells.set(v.tick, out);
    }
  }

  /** The replay of the last death in `views`, or `null` when they hold none. */
  static of(views: readonly View[], you: number, arena: Arena): Replay | null {
    let at = -1;
    for (let i = views.length - 1; i >= 0 && at < 0; i--) {
      if (views[i]?.events.some((e) => e.type === 'kill' && e.victim === you)) at = i;
    }
    const death = views[at];
    if (!death) return null;
    const held = views.slice(0, at + 1).filter((v) => v.tick > death.tick - 3 * RULES.tickHz);
    const kill = death.events.find((e) => e.type === 'kill' && e.victim === you);
    const hit = death.events.find((e) => e.type === 'hit' && e.victim === you);
    const me = death.tanks.find((t) => t.id === you);
    if (!kill || kill.type !== 'kill' || !me) return null;
    const fatal = hit && hit.type === 'hit' ? trace(held, hit.shell, me, arena) : null;
    return new Replay(arena, held, you, kill.killer, { x: me.x, y: me.y }, fatal);
  }

  /** The first tick held. */
  get from(): number {
    return this.ticks[0] ?? 0;
  }

  /** The tick of the death — the last held. */
  get to(): number {
    return this.ticks.at(-1) ?? 0;
  }

  /** Everything at fractional tick `t`: tanks between the two views around it, shells flown on. */
  at(t: number): ReplayPicture {
    const tick = Math.max(this.from, Math.min(this.to, t));
    let i = this.ticks.length - 1;
    while (i > 0 && (this.ticks[i] ?? 0) > tick) i--;
    const a = this.ticks[i] ?? this.from;
    const b = this.ticks[i + 1];
    const alpha = b === undefined ? 0 : (tick - a) / (b - a);
    const ta = this.tanks.get(a) ?? [];
    const tb = new Map((b === undefined ? [] : (this.tanks.get(b) ?? [])).map((x) => [x.id, x]));
    const tanks = ta.map((x) => {
      const n = tb.get(x.id);
      return n ? between(x, n, alpha) : between(x, x, 0);
    });

    const next = new Set((b === undefined ? [] : (this.shells.get(b) ?? [])).map((s) => s.id));
    const part = Math.round((tick - a) * RULES.shellSpeed);
    const shells: DrawnShell[] = [];
    for (const s of this.shells.get(a) ?? []) {
      const isFatal = this.fatal?.id === s.id;
      // Gone by the next view and not the one that killed: it ended within this tick.
      if (b !== undefined && !next.has(s.id) && !isFatal) continue;
      let shown = s;
      if (part > 0) {
        // The fatal shell, in its last tick, flies no further than the tank it reached.
        const last = isFatal && !next.has(s.id) && this.fatal;
        const limit = last ? Math.round((last.hit.tick - a) * RULES.shellSpeed) : part;
        const f = fly(s, Math.min(part, limit), this.arena, null);
        shown = f.shell;
      }
      shells.push({ id: s.id, owner: s.owner, x: shown.x, y: shown.y, dir: shown.dir });
    }
    return { tanks, shells };
  }
}

/** Where a path is at fractional tick `t`, between its points. */
export function pointAt(points: readonly PathPoint[], t: number): PathPoint | null {
  const first = points[0];
  if (!first || t < first.tick) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b || t > b.tick) continue;
    const k = b.tick === a.tick ? 1 : (t - a.tick) / (b.tick - a.tick);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tick: t };
  }
  return points.at(-1) ?? null;
}

/**
 * The fatal shell's path through `views`: its body at every tick it was held, its bounce, and the
 * hit — where, in the tick of the death, the server's flight first came within reach of the tank,
 * which stands in that view where it died (the tick drives before its shells fly, § 8.1).
 */
function trace(views: readonly View[], id: number, victim: Tank, arena: Arena): FatalPath | null {
  const death = views.at(-1);
  if (!death) return null;
  let start: ShellAt | null = null;
  for (const v of views) {
    const s = v.shells.find((x) => x.id === id);
    if (s) {
      start = s;
      break;
    }
  }
  if (!start) return null;
  const points: PathPoint[] = [];
  let bounce: PathPoint | null = null;
  let b = body(start);
  let t = start.at;
  points.push({ x: b.x, y: b.y, tick: t });
  const target = [live(victim)];
  while (t < death.tick) {
    // The flight in the tick of the death is the one that reached the tank, flown with it.
    const reach =
      t === death.tick - 1 ? least((d) => fly(b, d, arena, target).fate.kind === 'tank') : null;
    const turn = b.bounced
      ? null
      : least((d) => {
          const r = fly(b, d, arena, null);
          return r.shell.bounced || r.fate.kind === 'wall';
        });
    if (turn !== null && (reach === null || turn < reach)) {
      const p = fly(b, turn, arena, null).shell;
      bounce = { x: p.x, y: p.y, tick: t + turn / RULES.shellSpeed };
      points.push(bounce);
    }
    if (reach !== null) {
      const p = fly(b, reach, arena, null).shell;
      const hit = { x: p.x, y: p.y, tick: t + reach / RULES.shellSpeed };
      points.push(hit);
      return { id, owner: start.owner, points, bounce, hit };
    }
    const r = flyTick(b, arena, null);
    if (r.fate.kind !== 'flying') return null;
    b = r.shell;
    t++;
    points.push({ x: b.x, y: b.y, tick: t });
  }
  return null;
}
