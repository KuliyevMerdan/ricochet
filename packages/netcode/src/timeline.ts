import type { View } from '@ricochet/protocol';

/** Views kept, ticks — three seconds: enough to draw from after a stall, and C3's kill replay. */
const KEEP = 90;
/** Snapshots whose lateness the delay is computed from — three seconds of them. */
const LATE_WINDOW = 90;
/** The delay's bounds, ticks: never closer than two snapshots, never further than 400 ms. */
const MIN_DELAY = 2;
const MAX_DELAY = 12;
/** The drawn time runs at most 10 % fast or slow while it follows a new delay. */
const RATE = 0.1;
/** Ticks of error that ask for the full 10 %. */
const GAIN = 2;
/** Further behind than this, ticks, and the drawn time jumps forward instead. */
const JUMP = 10;

/** Where between two views the others are drawn. */
export interface Between {
  /** The drawn tick, fractional. */
  readonly tick: number;
  /** The view at or before `tick`. */
  readonly from: View;
  /** The view after it — `null` past the newest, where at most one tick is extrapolated. */
  readonly to: View | null;
  /** How far from `from` toward `to`, 0…1 — or, with no `to`, how far past `from`. */
  readonly alpha: number;
  /** The view a tick before `from`, when `to` is missing: the step to extrapolate by. */
  readonly before: View | null;
}

/**
 * The snapshots received and the time everyone else is drawn at (ADR-0001): `serverTick − delay`,
 * between the two views around it. The delay is two snapshot intervals plus the 95th percentile of
 * how late snapshots arrive, within bounds; a stall that empties the buffer extrapolates one tick
 * past the newest view and holds there. The drawn time never steps backward.
 *
 * Lateness is measured against the server's clock (`ServerClock.at`): a snapshot of tick `T`
 * arriving when the server is at `P` is `P − T` late. The least of these is the link's own delay;
 * what is above it is jitter, and the delay covers it.
 */
export class Timeline {
  private views: View[] = [];
  private raw: number[] = [];
  private drawn: { readonly server: number; readonly tick: number } | null = null;

  /** A view applied from a snapshot, and the server's clock when it arrived (`null` until the
   * clock has a sample — its lateness says nothing then). */
  received(view: View, serverNow: number | null): void {
    const last = this.views.at(-1);
    if (last && view.tick <= last.tick) this.reset(); // a new baseline: a resumed or new room
    this.views.push(view);
    while ((this.views[0]?.tick ?? view.tick) < view.tick - KEEP) this.views.shift();
    if (serverNow !== null) {
      this.raw.push(serverNow - view.tick);
      if (this.raw.length > LATE_WINDOW) this.raw.shift();
    }
  }

  newest(): View | null {
    return this.views.at(-1) ?? null;
  }

  /** Every view held, oldest first. */
  held(): readonly View[] {
    return this.views;
  }

  /** How far behind the newest snapshot expected the others are drawn, ticks. */
  delay(): number {
    if (this.raw.length === 0) return MIN_DELAY;
    const least = Math.min(...this.raw);
    const late = this.raw.map((r) => r - least).sort((a, b) => a - b);
    const p95 = late[Math.min(late.length - 1, Math.ceil(0.95 * late.length) - 1)] ?? 0;
    return Math.min(MAX_DELAY, Math.max(MIN_DELAY, 2 + p95));
  }

  /** The tick everyone else is drawn at, by the server's clock now, and the views around it. */
  sample(serverNow: number): Between | null {
    const newest = this.views.at(-1);
    const oldest = this.views[0];
    if (!newest || !oldest) return null;

    const target =
      this.raw.length === 0 ? newest.tick : serverNow - Math.min(...this.raw) - this.delay();
    let tick: number;
    if (!this.drawn) {
      tick = Math.min(target, newest.tick);
    } else {
      const elapsed = Math.max(0, serverNow - this.drawn.server);
      const free = this.drawn.tick + elapsed;
      const rate = 1 + Math.max(-RATE, Math.min(RATE, ((target - free) / GAIN) * RATE));
      tick = target - this.drawn.tick > JUMP ? target : this.drawn.tick + elapsed * rate;
    }
    // Never past one tick beyond what exists; never before what is held; never backward.
    tick = Math.max(oldest.tick, Math.min(tick, newest.tick + 1));
    if (this.drawn) tick = Math.max(tick, Math.min(this.drawn.tick, newest.tick + 1));
    this.drawn = { server: serverNow, tick };

    let i = this.views.length - 1;
    while (i > 0 && (this.views[i]?.tick ?? 0) > tick) i--;
    const from = this.views[i] ?? oldest;
    const to = this.views[i + 1] ?? null;
    if (to)
      return { tick, from, to, alpha: (tick - from.tick) / (to.tick - from.tick), before: null };
    const before = this.views[i - 1];
    return {
      tick,
      from,
      to: null,
      alpha: tick - from.tick,
      before: before && before.tick === from.tick - 1 ? before : null,
    };
  }

  reset(): void {
    this.views = [];
    this.raw = [];
    this.drawn = null;
  }
}
