/**
 * The one clock every room steps to — a drift-free 30 Hz loop.
 *
 * Tick `n`'s deadline is `start + n · period`, computed from the first tick, never from the last:
 * a tick that runs 3 ms late does not push every later one 3 ms later. Rooms are units of work on
 * this one loop, not timers of their own, so a slow room delays the ticks after it in that moment
 * and nothing after (ROADMAP S3).
 *
 * `setTimeout` alone is late by a millisecond or two, so the loop sleeps to just short of the
 * deadline and spins the rest on `setImmediate`, which yields to the sockets between turns. A loop
 * that falls more than a few ticks behind (a paused process, a debugger) does not replay the gap: it
 * starts its deadlines again from now and counts what it skipped.
 */
export interface TickerClock {
  /** Milliseconds, monotonic. */
  now(): number;
  sleep(ms: number, fn: () => void): () => void;
  yieldThen(fn: () => void): () => void;
}

export interface TickStats {
  readonly ticks: number;
  readonly skipped: number;
  /** How late each tick started after its deadline, ms — the last `window` ticks. */
  readonly lateness: readonly number[];
  /** How long each tick's work took, ms — the last `window` ticks. */
  readonly work: readonly number[];
}

const WINDOW = 18_000; // ten minutes of ticks
const CATCH_UP = 5; // ticks behind before the deadlines are rebased

export class Ticker {
  readonly period: number;
  private origin = 0;
  private n = 0;
  private skipped = 0;
  private cancel: (() => void) | null = null;
  private running = false;
  private readonly lateness: number[] = [];
  private readonly work: number[] = [];

  constructor(
    private readonly onTick: (n: number) => void,
    private readonly clock: TickerClock,
    hz: number,
  ) {
    this.period = 1000 / hz;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The last tick that ran, and how far past its deadline it is now, ms. */
  phase(): { tick: number; offsetMs: number } {
    const tick = Math.max(0, this.n - 1);
    return { tick, offsetMs: this.clock.now() - this.deadline(tick) };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.origin = this.clock.now();
    this.n = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = null;
  }

  stats(): TickStats {
    return { ticks: this.n, skipped: this.skipped, lateness: this.lateness, work: this.work };
  }

  private deadline(n: number): number {
    return this.origin + n * this.period;
  }

  private schedule(): void {
    if (!this.running) return;
    const wait = this.deadline(this.n) - this.clock.now();
    this.cancel =
      wait > 2
        ? this.clock.sleep(wait - 1.5, () => this.spin())
        : this.clock.yieldThen(() => this.spin());
  }

  private spin(): void {
    if (!this.running) return;
    if (this.clock.now() < this.deadline(this.n)) {
      this.cancel = this.clock.yieldThen(() => this.spin());
      return;
    }
    const began = this.clock.now();
    record(this.lateness, began - this.deadline(this.n));
    this.onTick(this.n);
    record(this.work, this.clock.now() - began);
    this.n++;
    const behind = Math.floor((this.clock.now() - this.deadline(this.n)) / this.period);
    if (behind > CATCH_UP) {
      this.skipped += behind;
      this.origin = this.clock.now() - this.n * this.period;
    }
    this.schedule();
  }
}

function record(into: number[], value: number): void {
  into.push(value);
  if (into.length > WINDOW) into.splice(0, into.length - WINDOW);
}

/** The process's clock: `performance.now()`, `setTimeout`, `setImmediate`. */
export function systemTickerClock(now: () => number): TickerClock {
  return {
    now,
    sleep(ms, fn) {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    },
    yieldThen(fn) {
      const h = setImmediate(fn);
      return () => clearImmediate(h);
    },
  };
}

/** The value at quantile `q` of a list, by nearest rank. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
}
