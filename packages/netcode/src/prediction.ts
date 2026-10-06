import { RULES } from '@ricochet/protocol';
import type { Arena, Input, Point } from '@ricochet/protocol';
import { stepTank } from '@ricochet/sim';
import type { Command, TankBody } from '@ricochet/sim';

/** A correction the eye could follow is smoothed away with this time constant, ms: ~5 % is left
 * after 100 ms (ADR-0001). */
const SMOOTH_MS = 1000 / RULES.tickHz;
/** A correction larger than this, eighths — two tank radii — is a teleport (a respawn), not an
 * error, and is drawn at once. */
const SNAP = 2 * RULES.tankRadius;

/** The own gun's timers: what decides, with the shells in the air, whether a trigger fires. */
export interface Gun {
  readonly reload: number;
  readonly shield: number;
}

/** An input sent and not yet acknowledged, the tank as the prediction has it once applied, and
 * whether its trigger fires a shell. */
interface Pending {
  readonly input: Input;
  after: TankBody;
  gun: Gun;
  fires: boolean;
}

/** How many of the own shells the server holds will still be in the air at the `n`-th tick past
 * the snapshot (from 1) — the prediction's count of what `maxShells` allows. */
export type InAir = (n: number) => number;

/**
 * One tick of the own gun, as `sim.step` runs it: the timers count down (§ 8.1's first step), then a
 * live tank with no shield, no reload and fewer than `maxShells` in the air fires when the trigger
 * is held (its third), and reloads.
 */
export function gunStep(
  gun: Gun,
  fire: boolean,
  alive: boolean,
  inAir: number,
): { gun: Gun; fires: boolean } {
  const g = { reload: Math.max(0, gun.reload - 1), shield: Math.max(0, gun.shield - 1) };
  const fires = fire && alive && g.shield === 0 && g.reload === 0 && inAir < RULES.maxShells;
  return { gun: fires ? { ...g, reload: RULES.reload } : g, fires };
}

/**
 * Another live tank as the newest snapshot has it, with the step it took into that snapshot. A
 * tick drives tanks in ascending id (protocol § 8.1), so one with a lower id than the own tank has
 * already taken its next step when the own tank takes its — `ahead`.
 */
export interface Mover {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ahead: boolean;
}

/** Where the movers stand when the own tank takes the `n`-th step past the snapshot (from 1): each
 * carried on along its last step, as far as it will have gone by then. */
function standing(movers: readonly Mover[], n: number): Point[] {
  return movers.map((m) => {
    const k = m.ahead ? n : n - 1;
    return { x: m.x + m.vx * k, y: m.y + m.vy * k };
  });
}

/** What one snapshot did to the prediction. */
export interface Reconciled {
  /** The snapshot's tick. */
  readonly tick: number;
  readonly ack: number;
  /**
   * The tank the prediction said the server would hold once it had applied `ack` — what it is
   * judged by. `null` when it had predicted nothing for `ack`: the first snapshot on a socket, or an
   * input it never sent.
   */
  readonly predicted: TankBody | null;
  readonly server: TankBody;
  /** How far the drawn tank's prediction moved, eighths; 0 when it was right. */
  readonly moved: number;
  /** Whether the move was too large to smooth and was drawn at once. */
  readonly snapped: boolean;
  /** Unacknowledged inputs whose shot the replay no longer fires, and those it now does. */
  readonly unfired: readonly number[];
  readonly refired: readonly number[];
}

export interface Offset {
  readonly x: number;
  readonly y: number;
}

/**
 * The own tank, predicted (ADR-0001). Each client tick's input is applied at once through
 * `sim.stepTank` — the function the server's `step` runs for every tank — and kept. Each snapshot
 * drops the inputs it acknowledges, sets the tank to the server's, and replays the rest. With no
 * other tank involved the replay *is* the server's computation, so it agrees to the bit; when it
 * does not, the drawn tank's jump becomes an offset that decays over ~100 ms.
 *
 * Tanks block one another and do not push (protocol D12), so the prediction stops at another tank
 * where it expects that tank to be: where the newest snapshot has it, carried on along its last
 * step — one step further for a tank that drives before this one in a tick (`Mover`). It is a guess
 * about a tank this client sees ~100 ms late, and a wrong guess is a correction; with no guess at
 * all, every contact was one (ROADMAP C0's question, decided here).
 */
export class Prediction {
  private pending: Pending[] = [];
  /** The last snapshot's own tank and the `ack` it came with. */
  private base: { readonly tank: TankBody; readonly ack: number } | null = null;
  private offset0 = { x: 0, y: 0, at: 0 };
  /** The other live tanks as the newest snapshot has them. */
  private movers: readonly Mover[] = [];
  private baseGun: Gun = { reload: 0, shield: 0 };
  private inAir: InAir = () => 0;

  constructor(private readonly arena: Arena) {}

  /** The tank once every input sent is applied; `null` before the first snapshot. */
  get tank(): TankBody | null {
    return this.pending.at(-1)?.after ?? this.base?.tank ?? null;
  }

  /** The tank a client tick before `tank` — what the drawing moves from. */
  get previous(): TankBody | null {
    return this.pending.at(-2)?.after ?? this.base?.tank ?? null;
  }

  /** Inputs sent and not yet acknowledged. */
  get unacked(): number {
    return this.pending.length;
  }

  /** A client tick's input, sent: applied to the own tank now, kept until acknowledged. Nothing to
   * apply it to before the first snapshot. */
  push(input: Input): boolean {
    const next = this.next(input);
    if (!next) return false;
    this.pending.push({ input, ...next });
    return next.fires;
  }

  /**
   * What the next input would do, unsent: the tank a tick on, and whether it would fire. The page
   * draws the own tank toward it between ticks, so a key shows on the next frame rather than the
   * next tick, and a press fires on that frame.
   */
  next(intent: Command): { after: TankBody; gun: Gun; fires: boolean } | null {
    const from = this.tank;
    if (!from) return null;
    const n = this.pending.length + 1;
    const after = stepTank(from, intent, this.arena, standing(this.movers, n));
    const shot = gunStep(this.gun, intent.fire, from.alive, this.inAir(n) + this.firedPending());
    return { after, gun: shot.gun, fires: shot.fires };
  }

  /** The gun once every input sent is applied. */
  get gun(): Gun {
    return this.pending.at(-1)?.gun ?? this.baseGun;
  }

  /** Whether the input `seq`, sent and unacknowledged, fires. */
  fires(seq: number): boolean {
    return this.pending.find((p) => p.input.seq === seq)?.fires ?? false;
  }

  /** The tank once the input `seq` is applied, while it is unacknowledged. */
  after(seq: number): TankBody | null {
    return this.pending.find((p) => p.input.seq === seq)?.after ?? null;
  }

  private firedPending(): number {
    let n = 0;
    for (const p of this.pending) if (p.fires) n++;
    return n;
  }

  /** A snapshot's word on the own tank, and the input `seq` it acknowledges. */
  reconcile(
    server: TankBody,
    ack: number,
    tick: number,
    now: number,
    movers: readonly Mover[] = [],
    gun: Gun = { reload: 0, shield: 0 },
    inAir: InAir = () => 0,
  ): Reconciled {
    const drawn = this.tank;
    const predicted =
      this.pending.find((p) => p.input.seq === ack)?.after ??
      // No new input applied this tick: the server's tank stood (protocol D15), as it was.
      (this.base && this.base.ack === ack ? this.base.tank : null);

    this.pending = this.pending.filter((p) => p.input.seq > ack);
    this.base = { tank: server, ack };
    this.movers = movers;
    this.baseGun = gun;
    this.inAir = inAir;
    let t = server;
    let g = gun;
    let fired = 0;
    const unfired: number[] = [];
    const refired: number[] = [];
    for (const [i, p] of this.pending.entries()) {
      const shot = gunStep(g, p.input.fire, t.alive, inAir(i + 1) + fired);
      t = stepTank(t, p.input, this.arena, standing(movers, i + 1));
      g = shot.gun;
      if (shot.fires) fired++;
      if (p.fires && !shot.fires) unfired.push(p.input.seq);
      if (!p.fires && shot.fires) refired.push(p.input.seq);
      p.after = t;
      p.gun = g;
      p.fires = shot.fires;
    }

    let moved = 0;
    let snapped = false;
    if (drawn) {
      const dx = drawn.x - t.x;
      const dy = drawn.y - t.y;
      moved = Math.sqrt(dx * dx + dy * dy);
      snapped = drawn.alive !== t.alive || moved > SNAP;
      const o = this.offset(now);
      this.offset0 = snapped ? { x: 0, y: 0, at: now } : { x: o.x + dx, y: o.y + dy, at: now };
    }
    return { tick, ack, predicted, server, moved, snapped, unfired, refired };
  }

  /** What is left of the corrections, eighths: added to where the tank is drawn. */
  offset(now: number): Offset {
    const k = Math.exp(-Math.max(0, now - this.offset0.at) / SMOOTH_MS);
    return { x: this.offset0.x * k, y: this.offset0.y * k };
  }

  /** The correction left is dropped, not smoothed: the tank drawn where the prediction has it. */
  snap(): void {
    this.offset0 = { x: 0, y: 0, at: 0 };
  }

  reset(): void {
    this.pending = [];
    this.base = null;
    this.baseGun = { reload: 0, shield: 0 };
    this.inAir = () => 0;
    this.offset0 = { x: 0, y: 0, at: 0 };
  }
}
