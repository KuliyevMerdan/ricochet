/** What a lab'd link adds (docs/protocol.md § 3.1, D17): to the round trip, half each way, and up
 * to `jitterMs` more on each frame. */
export interface Faults {
  readonly latencyMs: number;
  readonly jitterMs: number;
}

export const CLEAN: Faults = { latencyMs: 0, jitterMs: 0 };

export interface LaneClock {
  now(): number;
}

export interface LaneTimers {
  /** Call `fn` in `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

/**
 * One direction of a socket, as TCP behaves on a slow, uneven path: **a frame is never lost, only
 * late, and never overtakes the frame before it.** Each frame waits its share of the latency plus a
 * fresh draw of the jitter — but not past the frame ahead of it, so jitter bunches frames rather than
 * reordering them, which is what it looks like on a WebSocket. A stall holds the lane shut until it
 * lifts, then delivers what it held, in order.
 *
 * Order is the queue's, never the timers': one timer drains the queue from its head, so a frame handed
 * in while a late timer has yet to fire still waits its turn (the sibling crash project's load test
 * caught a timer per frame letting a tick overtake its round's end). With no faults and nothing
 * queued, a frame is delivered at once — a clean link pays nothing for the lab existing.
 */
export class Lane {
  /** When the last frame handed in is due: a later frame is never due before it. */
  private tail = 0;
  private stalledUntil = 0;
  private readonly queue: { readonly at: number; readonly fn: () => void }[] = [];
  private cancel: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly clock: LaneClock,
    private readonly timers: LaneTimers,
    private readonly random: () => number,
  ) {}

  /** How many frames are waiting. */
  get waiting(): number {
    return this.queue.length;
  }

  deliver(faults: Faults, oneWayMs: number, fn: () => void): void {
    if (this.closed) return;
    const now = this.clock.now();
    const delay = oneWayMs + (faults.jitterMs > 0 ? this.random() * faults.jitterMs : 0);
    const at = Math.max(now + delay, this.tail, this.stalledUntil);
    this.tail = at;
    if (this.queue.length === 0 && at <= now) {
      fn(); // a clean link: nothing queued, nothing to wait for
      return;
    }
    this.queue.push({ at, fn });
    this.arm();
  }

  /** Shut for `ms` from now; what is due meanwhile leaves when it lifts, in order. */
  stall(ms: number): void {
    this.stalledUntil = Math.max(this.stalledUntil, this.clock.now() + ms);
    this.tail = Math.max(this.tail, this.stalledUntil);
    this.cancel?.();
    this.cancel = null;
    this.arm();
  }

  /** The socket is gone: nothing more is delivered. */
  close(): void {
    this.closed = true;
    this.cancel?.();
    this.cancel = null;
    this.queue.length = 0;
  }

  private arm(): void {
    const head = this.queue[0];
    if (!head || this.cancel) return;
    const wait = Math.max(head.at, this.stalledUntil) - this.clock.now();
    this.cancel = this.timers.after(Math.max(0, wait), () => {
      this.cancel = null;
      this.drain();
    });
  }

  private drain(): void {
    const now = this.clock.now();
    if (now >= this.stalledUntil) {
      for (let head = this.queue[0]; head && head.at <= now; head = this.queue[0]) {
        this.queue.shift();
        head.fn();
        if (this.closed) return;
      }
    }
    this.arm();
  }
}

/**
 * A socket's two lanes and the faults they run under — the network lab's hold on one connection,
 * and on nobody else's (docs/protocol.md § 3.1).
 */
export class Link {
  private faults: Faults = CLEAN;
  private readonly down: Lane;
  private readonly up: Lane;

  constructor(clock: LaneClock, timers: LaneTimers, random: () => number) {
    this.down = new Lane(clock, timers, random);
    this.up = new Lane(clock, timers, random);
  }

  get current(): Faults {
    return this.faults;
  }

  set(faults: Faults): void {
    this.faults = faults;
  }

  /** Server → client: `fn` sends, once the frame has crossed. */
  toClient(fn: () => void): void {
    this.down.deliver(this.faults, this.faults.latencyMs / 2, fn);
  }

  /** Client → server: `fn` handles, once the frame has arrived. */
  fromClient(fn: () => void): void {
    this.up.deliver(this.faults, this.faults.latencyMs / 2, fn);
  }

  stall(ms: number): void {
    this.down.stall(ms);
    this.up.stall(ms);
  }

  close(): void {
    this.down.close();
    this.up.close();
  }
}
