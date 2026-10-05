import { RULES } from '@ricochet/protocol';
import type { Arena, Input, Point } from '@ricochet/protocol';
import { stepTank } from '@ricochet/sim';
import type { TankBody } from '@ricochet/sim';

/** A correction the eye could follow is smoothed away with this time constant, ms: ~5 % is left
 * after 100 ms (ADR-0001). */
const SMOOTH_MS = 1000 / RULES.tickHz;
/** A correction larger than this, eighths — two tank radii — is a teleport (a respawn), not an
 * error, and is drawn at once. */
const SNAP = 2 * RULES.tankRadius;

/** An input sent and not yet acknowledged, and the tank as the prediction has it once applied. */
interface Pending {
  readonly input: Input;
  after: TankBody;
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
  push(input: Input): void {
    const from = this.tank;
    if (!from) return;
    const n = this.pending.length + 1;
    this.pending.push({
      input,
      after: stepTank(from, input, this.arena, standing(this.movers, n)),
    });
  }

  /** A snapshot's word on the own tank, and the input `seq` it acknowledges. */
  reconcile(
    server: TankBody,
    ack: number,
    tick: number,
    now: number,
    movers: readonly Mover[] = [],
  ): Reconciled {
    const drawn = this.tank;
    const predicted =
      this.pending.find((p) => p.input.seq === ack)?.after ??
      // No new input applied this tick: the server's tank stood (protocol D15), as it was.
      (this.base && this.base.ack === ack ? this.base.tank : null);

    this.pending = this.pending.filter((p) => p.input.seq > ack);
    this.base = { tank: server, ack };
    this.movers = movers;
    let t = server;
    for (const [i, p] of this.pending.entries()) {
      t = stepTank(t, p.input, this.arena, standing(movers, i + 1));
      p.after = t;
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
    return { tick, ack, predicted, server, moved, snapped };
  }

  /** What is left of the corrections, eighths: added to where the tank is drawn. */
  offset(now: number): Offset {
    const k = Math.exp(-Math.max(0, now - this.offset0.at) / SMOOTH_MS);
    return { x: this.offset0.x * k, y: this.offset0.y * k };
  }

  reset(): void {
    this.pending = [];
    this.base = null;
    this.offset0 = { x: 0, y: 0, at: 0 };
  }
}
