import { RULES } from '@ricochet/protocol';
import type { Arena, ShellAt, View } from '@ricochet/protocol';
import { fly, flyTick } from '@ricochet/sim';
import type { ShellBody, TankBody } from '@ricochet/sim';
import type { DrawnShell } from './picture.js';

/**
 * Something the page should show once: a muzzle flash, a hit's sparks, a shell's end. Hits, kills
 * and spawns come only from the server's events — never predicted (ROADMAP C2); a shell's end on a
 * wall is its own flight, which the server's is to the bit; a fizzle is a predicted shot the server
 * refused. Positions in eighths.
 */
export type Effect =
  | {
      readonly kind: 'fire';
      readonly x: number;
      readonly y: number;
      readonly dir: number;
      readonly owner: number;
    }
  | {
      readonly kind: 'hit';
      readonly x: number;
      readonly y: number;
      readonly victim: number;
      readonly hp: number;
      readonly shell: number;
    }
  | {
      readonly kind: 'kill';
      readonly x: number;
      readonly y: number;
      readonly killer: number;
      readonly victim: number;
    }
  | { readonly kind: 'spawn'; readonly x: number; readonly y: number; readonly tank: number }
  | { readonly kind: 'end'; readonly x: number; readonly y: number; readonly owner: number }
  | {
      readonly kind: 'fizzle';
      readonly x: number;
      readonly y: number;
      readonly owner: number;
      readonly seq: number;
    }
  | { readonly kind: 'crate'; readonly spot: number; readonly tank: number };

export interface ShotStats {
  readonly predicted: number;
  readonly adopted: number;
  readonly fizzled: number;
  readonly unforeseen: number;
  readonly stepMean: number;
  readonly stepMax: number;
}

export const NO_SHOTS: ShotStats = {
  predicted: 0,
  adopted: 0,
  fizzled: 0,
  unforeseen: 0,
  stepMean: 0,
  stepMax: 0,
};

/** A tick's flight, a fraction of one by distance — so a shell drawn mid-bounce is on its legs. */
const partial = (body: ShellBody, frac: number, arena: Arena): ShellBody => {
  const part = Math.round(frac * RULES.shellSpeed);
  if (part <= 0) return body;
  const r = fly(body, part, arena, null);
  return r.fate.kind === 'flying' ? r.shell : body;
};

/** Smoothing for the step between a predicted shell and the server's, ms — the tank's. */
const SMOOTH_MS = 1000 / RULES.tickHz;

interface Own {
  /** The id it is drawn under, steady for its life: −seq for a predicted shot, the server's id for
   * one this client did not predict. */
  readonly key: number;
  readonly seq: number | null;
  id: number | null;
  /** The starting condition, and the present tick it holds at — fractional for a predicted shot,
   * born at the moment it was fired. */
  start: ShellBody;
  at: number;
  /** The last whole step flown: its count of ticks from `at`, and the shell then. */
  steps: number;
  body: ShellBody | null;
  /** Where it ended on a wall or its age, once it has. */
  end: { readonly x: number; readonly y: number; readonly after: number } | null;
  /** What was left of the step from prediction to the server's shell, and when. */
  ox: number;
  oy: number;
  oat: number;
  /** How many ticks a predicted shell falls behind its own flight, eased in over `ease` ticks from
   * its birth: the part of the time from the press to the server's tick that fires it which the
   * fast-forward's cap leaves uncovered (ADR-0002). 0 once adopted. */
  lag: number;
  ease: number;
}

/**
 * The own shells (ROADMAP C2, ADR-0002). A press fires one at once: born at the predicted tank's
 * muzzle and flown in the server's **present** — not the others' interpolated past — because that is
 * where the server's shell will be: it is born half a round trip later and fast-forwarded by as
 * much. The snapshot whose `shot` event carries the input's `seq` names the real shell, which is
 * adopted (the difference decaying); a `seq` acknowledged with no `shot` was refused, and fizzles.
 *
 * Nothing here decides a hit. A shell is flown with no tanks, as `stepShell` does, so it passes
 * through any tank until the server says it struck one; it ends on its own at its second wall or
 * its age, where the server's does too.
 */
export class OwnShells {
  private readonly shells = new Map<number, Own>();
  /** Own shells that ended here, by server id, until the snapshots — a tick or two behind the
   * present they are drawn in — reach their end too: not taken on again as new, and still counted
   * in the air for the ticks the gun is predicted at. By their flight, not by the view: a shell
   * often leaves the view a tick or two before it dies. */
  private readonly ended = new Map<number, Own>();
  private predicted = 0;
  private adopted = 0;
  private fizzled = 0;
  private unforeseen = 0;
  private steps: number[] = [];

  stats(): ShotStats {
    const n = this.steps.length;
    return {
      predicted: this.predicted,
      adopted: this.adopted,
      fizzled: this.fizzled,
      unforeseen: this.unforeseen,
      stepMean: n ? this.steps.reduce((a, b) => a + b, 0) / n : 0,
      stepMax: n ? Math.max(...this.steps) : 0,
    };
  }

  constructor(private readonly arena: Arena) {}

  /** A predicted shot: from the tank once its input is applied, along the turret. */
  fire(seq: number, tank: TankBody, present: number, out: Effect[]): void {
    if (this.shells.has(-seq)) return;
    const born: ShellBody = {
      id: -seq,
      owner: tank.id,
      x: tank.x,
      y: tank.y,
      dir: tank.turret,
      bounced: false,
      age: 0,
    };
    const r = fly(born, RULES.muzzle, this.arena, null);
    const start = r.shell;
    this.shells.set(-seq, this.own(-seq, seq, null, start, present));
    this.predicted++;
    out.push({ kind: 'fire', x: tank.x, y: tank.y, dir: tank.turret, owner: tank.id });
  }

  /** A predicted shot the replay no longer fires, or the server refused: it fizzles where it is. */
  cancel(seq: number, present: number, out: Effect[]): void {
    const o = this.shells.get(-seq);
    if (!o || o.id !== null) return;
    const at = this.peek(o, present);
    if (at) out.push({ kind: 'fizzle', x: at.x, y: at.y, owner: o.start.owner, seq });
    this.shells.delete(-seq);
    this.fizzled++;
  }

  /**
   * A snapshot: its `shot` events adopt the predicted shells they name, the own shells in the view
   * this client did not predict are taken on, a predicted shot acknowledged with no `shot` fizzles,
   * and a `hit` by an own shell ends it with the server's sparks.
   */
  snapshot(view: View, you: number, present: number, nowMs: number, out: Effect[]): void {
    const inView = new Map<number, ShellAt>();
    for (const s of view.shells) if (s.owner === you) inView.set(s.id, s);
    const named = new Set<number>();

    for (const e of view.events) {
      if (e.type !== 'shot' || e.tank !== you) continue;
      named.add(e.shell);
      const o = this.shells.get(-e.seq);
      const real = inView.get(e.shell);
      if (!o) {
        if (real) this.takeOn(real, out);
        continue;
      }
      if (!real) {
        // Gone in the tick it was fired — at once into a wall, or a tank (the hit says which).
        const at = this.peek(o, present);
        if (at) out.push({ kind: 'end', x: at.x, y: at.y, owner: you });
        this.shells.delete(o.key);
        continue;
      }
      const was = this.peek(o, present);
      o.id = real.id;
      o.start = body(real);
      o.at = real.at;
      o.lag = 0;
      o.steps = 0;
      o.body = o.start;
      o.end = null;
      const now = this.peek(o, present);
      const left = this.offset(o, nowMs);
      o.ox = left.x + (was && now ? was.x - now.x : 0);
      o.oy = left.y + (was && now ? was.y - now.y : 0);
      o.oat = nowMs;
      this.adopted++;
      if (was && now) {
        this.steps.push(Math.hypot(was.x - now.x, was.y - now.y));
        if (this.steps.length > 100) this.steps.shift();
      }
    }
    for (const s of inView.values()) {
      if (!named.has(s.id) && !this.byId(s.id) && !this.ended.has(s.id)) this.takeOn(s, out);
    }
    for (const [id, o] of this.ended) if (!this.peek(o, view.tick)) this.ended.delete(id);
    for (const o of this.shells.values()) {
      if (o.id === null && o.seq !== null && o.seq <= view.ack) this.cancel(o.seq, present, out);
    }
    for (const e of view.events) {
      if (e.type !== 'hit') continue;
      // Drawn in the present, a shell may already have reached its wall here when the server's
      // word comes that a tank stopped it first: the hit is still shown.
      const o = this.byId(e.shell) ?? this.ended.get(e.shell);
      if (!o) continue;
      const victim = view.tanks.find((t) => t.id === e.victim);
      const at = victim ?? this.peek(o, present);
      if (at)
        out.push({ kind: 'hit', x: at.x, y: at.y, victim: e.victim, hp: e.hp, shell: e.shell });
      this.shells.delete(o.key);
      this.ended.delete(e.shell);
    }
  }

  /** How many of the server's own shells are still in the air after server tick `tick`: by their
   * flight, which ends at the second wall or the age as the server's does. A hit is not foreseen. */
  aliveAt(tick: number): number {
    let n = 0;
    for (const o of this.shells.values()) if (o.id !== null && this.peek(o, tick)) n++;
    for (const o of this.ended.values()) if (this.peek(o, tick)) n++;
    return n;
  }

  /** Every own shell at the present, and the ends that came due since the last call. */
  draw(present: number, nowMs: number, out: DrawnShell[], effects: Effect[]): void {
    for (const o of this.shells.values()) {
      const at = this.at(o, present);
      if (!at) {
        if (o.end) effects.push({ kind: 'end', x: o.end.x, y: o.end.y, owner: o.start.owner });
        if (o.id !== null) this.ended.set(o.id, o);
        this.shells.delete(o.key);
        continue;
      }
      const off = this.offset(o, nowMs);
      out.push({ id: o.key, owner: o.start.owner, x: at.x + off.x, y: at.y + off.y, dir: at.dir });
    }
  }

  reset(): void {
    this.shells.clear();
    this.ended.clear();
  }

  private own(
    key: number,
    seq: number | null,
    id: number | null,
    start: ShellBody,
    at: number,
  ): Own {
    const o = { key, seq, id, start, at, steps: 0, body: start, end: null };
    return { ...o, ox: 0, oy: 0, oat: 0, lag: 0, ease: 1 };
  }

  /**
   * The input carrying a predicted shot went out at present tick `present`; it will be fired
   * `travel` ticks later on the server (half the round trip, and the wait in its queue), and
   * adopted here `back` ticks after that. Past the fast-forward's cap the server's shell starts
   * behind where this one is drawn, so this one falls behind its own flight by as much — gradually,
   * over the time until the server's is adopted: it still leaves the barrel at the press, and meets
   * the server's where it will be rather than jumping back to it.
   */
  sent(seq: number, present: number, travel: number, back: number): void {
    const o = this.shells.get(-seq);
    if (!o || o.id !== null) return;
    const since = Math.max(0, present - o.at);
    o.lag = Math.max(0, since + travel - RULES.fastForwardMax);
    o.ease = Math.max(o.lag + 1, since + travel + back);
  }

  private takeOn(s: ShellAt, out: Effect[]): void {
    this.shells.set(s.id, this.own(s.id, null, s.id, body(s), s.at));
    this.unforeseen++;
    if (s.age <= RULES.fastForwardMax + 1) {
      out.push({ kind: 'fire', x: s.x, y: s.y, dir: s.dir, owner: s.owner });
    }
  }

  private byId(id: number): Own | undefined {
    for (const o of this.shells.values()) if (o.id === id) return o;
    return undefined;
  }

  private offset(o: Own, nowMs: number): { x: number; y: number } {
    const k = Math.exp(-Math.max(0, nowMs - o.oat) / SMOOTH_MS);
    return { x: o.ox * k, y: o.oy * k };
  }

  /** The shell at tick `t`, keeping nothing — `null` once it has ended, or before it was fired. */
  /** A shell's age at present tick `t`: its time since birth, less the lag eased in. */
  private age(o: Own, t: number): number {
    const age = t - o.at;
    return o.lag > 0 ? age - o.lag * Math.min(1, Math.max(0, age) / o.ease) : age;
  }

  private peek(o: Own, t: number): ShellBody | null {
    const age = this.age(o, t);
    if (age < 0) return null;
    const whole = Math.floor(age);
    let b: ShellBody | null = whole >= o.steps ? o.body : o.start;
    let k = whole >= o.steps ? o.steps : 0;
    for (; b && k < whole; k++) b = step(b, this.arena).body;
    return b ? partial(b, age - whole, this.arena) : null;
  }

  /** The shell at the drawn present `t`, which only moves forward: its whole steps are kept, so
   * drawing at the display's rate costs a step a tick. */
  private at(o: Own, t: number): ShellBody | null {
    const age = this.age(o, t);
    if (age < 0) return null;
    const whole = Math.floor(age);
    if (whole < o.steps) return this.peek(o, t);
    while (o.body && o.steps < whole) {
      const r = step(o.body, this.arena);
      if (!r.body) o.end = { x: r.last.x, y: r.last.y, after: o.at + o.steps + 1 };
      o.body = r.body;
      o.steps++;
    }
    return o.body ? partial(o.body, age - whole, this.arena) : null;
  }
}

/** One tick of flight with no tanks: the shell after it, or `null` and where it ended. */
function step(b: ShellBody, arena: Arena): { body: ShellBody | null; last: ShellBody } {
  const r = flyTick(b, arena, null);
  return { body: r.fate.kind === 'flying' ? r.shell : null, last: r.shell };
}

function body(s: ShellAt): ShellBody {
  return { id: s.id, owner: s.owner, x: s.x, y: s.y, dir: s.dir, bounced: s.bounced, age: s.age };
}
