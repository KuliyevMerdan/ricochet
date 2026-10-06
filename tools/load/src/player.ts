import { performance } from 'node:perf_hooks';
import { createClient } from '@ricochet/netcode';
import type { Client, Connect } from '@ricochet/netcode';
import type { Arena } from '@ricochet/protocol';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { BotDriver } from './policy.js';
import type { Profile } from './policy.js';

/** One drop the schedule made, and how the client came back from it. */
export interface DropRecord {
  /** Kept from coming back for longer than the resume grace. */
  readonly long: boolean;
  /** From the drop to live again, ms; `null` if it never was. */
  readonly backMs: number | null;
  /** Whether the server gave the tank back — and whether it was the same tank. */
  readonly resumed: boolean | null;
  readonly sameTank: boolean | null;
}

export interface PlayerReport {
  readonly profile: Profile['name'];
  readonly seconds: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly corrections: number;
  /** How far the corrections moved the tank, all told, eighths. */
  readonly corrected: number;
  readonly drops: readonly DropRecord[];
  /** Reconnects the schedule did not ask for, by reason — a slow socket closed, a silent link. */
  readonly unplanned: readonly string[];
  /** Seconds spent live. */
  readonly liveSeconds: number;
  readonly kills: number;
  readonly deaths: number;
}

const bytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

/** The page draws at the display's rate; a load client asks for a picture ten times a second —
 * enough to drain its effects and end its shells, as a page's frames do. */
const FRAME_MS = 100;

/**
 * A headless player over the wire (ROADMAP P0): a `netcode` client on a `ws` socket, driven by
 * `bots`' policy from the views it is sent, its link made worse through the server's lab by its
 * `Profile`, and its drops scheduled — each followed to the welcome that ends it.
 */
export class LoadPlayer {
  private client: Client | null = null;
  private readonly driver: BotDriver;
  private blockedUntil = 0;
  private pending: { at: number; you: number; long: boolean } | null = null;
  private readonly drops: DropRecord[] = [];
  private readonly unplanned: string[] = [];
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private startedAt = 0;
  private liveSince: number | null = null;
  private liveMs = 0;
  private kills = 0;
  private deaths = 0;
  private dropCount = 0;

  constructor(
    private readonly url: string,
    private readonly name: string,
    readonly profile: Profile,
    arena: Arena,
    seed: number,
  ) {
    this.driver = new BotDriver(arena, seed);
  }

  /** Join and play; no stall or drop is begun past `quietAt` (performance ms), so each is followed
   * to its end before the run stops. */
  start(quietAt = Infinity): void {
    this.startedAt = performance.now();
    const client = createClient({
      connect: this.connect,
      clock: performance,
      timers: {
        after(ms, fn) {
          const t = setTimeout(fn, ms);
          return () => clearTimeout(t);
        },
      },
      name: this.name,
      intent: () => this.driver.intent(client.latest, client.you),
    });
    this.client = client;
    client.onState((s) => {
      const now = performance.now();
      if (s.kind === 'live') {
        this.liveSince = now;
        const p = this.pending;
        if (p) {
          this.drops.push({
            long: p.long,
            backMs: now - p.at,
            resumed: s.resumed,
            sameTank: s.you === p.you,
          });
          this.pending = null;
        }
        return;
      }
      if (this.liveSince !== null) this.liveMs += now - this.liveSince;
      this.liveSince = null;
      if (s.kind === 'reconnecting' && !this.pending) this.unplanned.push(s.reason);
      if (s.kind === 'outdated' || s.kind === 'refused') this.unplanned.push(s.kind);
    });
    client.onEvents((events) => {
      for (const e of events) {
        if (e.type !== 'kill' || e.killer === e.victim) continue;
        if (e.killer === client.you) this.kills++;
        if (e.victim === client.you) this.deaths++;
      }
    });
    client.lab(this.profile.faults);

    this.timers.push(setInterval(() => client.frame(performance.now()), FRAME_MS));
    const { stall, drop } = this.profile;
    if (stall) {
      this.every(stall.everyMs, () => {
        if (performance.now() <= quietAt) client.stall(stall.ms);
      });
    }
    if (drop) {
      this.every(drop.everyMs, () => {
        if (client.state.kind !== 'live' || performance.now() > quietAt) return;
        const long = ++this.dropCount % drop.longEvery === 0;
        const at = performance.now();
        this.pending = { at, you: client.you, long };
        if (long) this.blockedUntil = at + drop.outageMs;
        client.drop();
      });
    }
  }

  /** Every `ms`, starting at a random point in the first interval — so a room's faults spread out. */
  private every(ms: number, fn: () => void): void {
    const first = setTimeout(() => {
      fn();
      this.timers.push(setInterval(fn, ms));
    }, Math.random() * ms);
    this.timers.push(first);
  }

  stop(): PlayerReport {
    for (const t of this.timers) clearInterval(t);
    const now = performance.now();
    const client = this.client;
    const st = client?.stats();
    if (this.liveSince !== null) this.liveMs += now - this.liveSince;
    this.liveSince = null;
    // A drop still in flight when the run ended has not come back.
    if (this.pending) {
      this.drops.push({ long: this.pending.long, backMs: null, resumed: null, sameTank: null });
    }
    client?.close();
    return {
      profile: this.profile.name,
      seconds: (now - this.startedAt) / 1000,
      bytesIn: st?.bytesIn ?? 0,
      bytesOut: st?.bytesOut ?? 0,
      corrections: st?.corrections ?? 0,
      corrected: st?.corrected ?? 0,
      drops: this.drops,
      unplanned: this.unplanned,
      liveSeconds: this.liveMs / 1000,
      kills: this.kills,
      deaths: this.deaths,
    };
  }

  /** A `ws` socket — or, during a long outage, one that never opens. */
  private readonly connect: Connect = (events) => {
    if (performance.now() < this.blockedUntil) {
      const t = setTimeout(() => events.close(), 20);
      return { send() {}, close: () => clearTimeout(t) };
    }
    const ws = new WebSocket(this.url);
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => events.open());
    ws.on('message', (data: RawData, isBinary: boolean) =>
      events.message(isBinary ? bytes(data) : null),
    );
    ws.on('close', () => events.close());
    ws.on('error', () => {}); // a close follows
    return {
      send: (frame) => {
        if (ws.readyState === ws.OPEN) ws.send(frame);
      },
      close: () => ws.close(),
    };
  };
}
