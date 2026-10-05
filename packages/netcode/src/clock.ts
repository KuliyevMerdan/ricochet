import { RULES } from '@ricochet/protocol';

/** A tick's length, ms. */
export const TICK_MS = 1000 / RULES.tickHz;

/** Pongs kept: about twelve seconds of them at one every two. */
const WINDOW = 6;
/** How fast the estimate may move toward a new one: 5 % of a tick per tick. */
const SLEW = 0.05;
/** Further off than this, ticks, and the estimate jumps instead — a first sample, a long stall. */
const JUMP = 10;

interface Sample {
  readonly rtt: number;
  /** The server's tick minus the local clock in ticks, as this sample saw it. */
  readonly offset: number;
}

/**
 * The server's tick as seen from here (docs/protocol.md § 3, ROADMAP C0). Each `pong` says which
 * tick the server was in when it answered and how far into it; half the round trip later is when
 * the answer arrived. Of the last few, the sample with the shortest round trip is believed — the
 * one queueing delayed least, so the one whose half-way guess is best.
 *
 * A new estimate is not jumped to: the clock in use slews toward it at `SLEW`, so the client's
 * ticks run at most 5 % fast or slow while they catch up, and never step backward. Only a first
 * sample, or one more than `JUMP` ticks out, is taken at once.
 *
 * `at(now)` is fractional, in ticks, on the server's own scale: tick `T` is the moment the server
 * stepped tick `T` and sent its snapshot.
 */
export class ServerClock {
  private samples: Sample[] = [];
  /** The offset in use at a moment, and the one it is slewing toward. */
  private from = { at: 0, offset: 0 };
  private target = 0;
  private hasSample = false;

  get synced(): boolean {
    return this.hasSample;
  }

  /** A pong: the local times its ping left and its answer came, and what the server said. */
  sample(sentAt: number, receivedAt: number, tick: number, offsetUs: number): void {
    const rtt = Math.max(0, receivedAt - sentAt);
    const server = tick + offsetUs / 1000 / TICK_MS + rtt / 2 / TICK_MS;
    this.samples.push({ rtt, offset: server - receivedAt / TICK_MS });
    if (this.samples.length > WINDOW) this.samples.shift();
    // The newest of the shortest: a tie goes to the fresher sample, which has drifted least.
    const best = this.samples.reduce((a, b) => (b.rtt <= a.rtt ? b : a));
    const current = this.offsetAt(receivedAt);
    const jump = !this.hasSample || Math.abs(best.offset - current) > JUMP;
    this.from = { at: receivedAt, offset: jump ? best.offset : current };
    this.target = best.offset;
    this.hasSample = true;
  }

  /** The shortest round trip among the samples kept, ms; `null` before the first. */
  rtt(): number | null {
    if (this.samples.length === 0) return null;
    return Math.min(...this.samples.map((s) => s.rtt));
  }

  /** The server's present at local time `now`, in ticks. */
  at(now: number): number {
    return now / TICK_MS + this.offsetAt(now);
  }

  reset(): void {
    this.samples = [];
    this.hasSample = false;
    this.from = { at: 0, offset: 0 };
    this.target = 0;
  }

  private offsetAt(now: number): number {
    const gap = this.target - this.from.offset;
    const reach = (SLEW * Math.max(0, now - this.from.at)) / TICK_MS;
    return Math.abs(gap) <= reach ? this.target : this.from.offset + Math.sign(gap) * reach;
  }
}
