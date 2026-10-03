import { performance } from 'node:perf_hooks';
import { deflateRawSync } from 'node:zlib';
import { diff, encodeServer } from '@ricochet/protocol';
import type { RosterEntry, View } from '@ricochet/protocol';
import { view } from '@ricochet/sim';
import { BotRoom } from './arena.js';

export interface BenchOptions {
  readonly tanks: number;
  readonly seed: number;
  /** Ticks played before measuring, so the room has spread out and the JIT has warmed. */
  readonly warmup: number;
  readonly ticks: number;
  /** Every how many ticks a frame is also deflated, per client — compression is costly to measure. */
  readonly deflateEvery: number;
}

export interface Quantiles {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
}

export interface BenchResult {
  readonly tanks: number;
  readonly ticks: number;
  /** The server's work for one tick, ms: `step`, then a view, a diff and an encode per player. */
  readonly tick: Quantiles;
  /** Of which `sim.step` alone, ms. */
  readonly step: Quantiles;
  /** Every bot's `decide` for one tick, ms — the server's extra work when bots fill the room. */
  readonly bots: Quantiles;
  /** Bytes per second down to one client, averaged over clients (and the worst client's). */
  readonly down: {
    /** Each tick's snapshot as a delta against the last sent — what the server sends. */
    readonly delta: Bandwidth;
    /** Each tick's snapshot whole, against nothing — what deltas save. */
    readonly full: Bandwidth;
    /** A snapshot every other tick, a delta against the one before, carrying both ticks' events. */
    readonly delta15: Bandwidth;
  };
  /** Deflated size over raw, for the sampled delta frames. */
  readonly deflate: {
    /** Each frame on its own — permessage-deflate with `no_context_takeover`. */
    readonly alone: number;
    /** Each frame with the socket's previous 8 KB as the dictionary — a shortened stand-in for
     * context takeover's 32 KB window. */
    readonly context: number;
  };
}

export interface Bandwidth {
  readonly mean: number;
  readonly worst: number;
}

/** A WebSocket frame's header from the server: 2 bytes, 4 past 125 bytes of payload. */
const wsHeader = (payload: number) => (payload < 126 ? 2 : 4);

export function quantiles(samples: readonly number[]): Quantiles {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1] ?? 0 };
}

/**
 * One room of `tanks` bots, stepped as fast as it goes, every tank treated as a connected player:
 * the work a server tick does for it, timed, and the bytes each player would be sent, counted —
 * snapshots and the roster, each with its WebSocket header.
 */
export function bench(opts: BenchOptions): BenchResult {
  const room = new BotRoom(opts.tanks, opts.seed);
  const ids = room.world.tanks.map((t) => t.id);
  const sent = new Map<number, View | null>(ids.map((id) => [id, null]));
  const sent15 = new Map<number, View | null>(ids.map((id) => [id, null]));
  const between = new Map<number, View>();
  const history = new Map<number, Uint8Array[]>(ids.map((id) => [id, []]));
  const bytes = {
    delta: new Map<number, number>(),
    full: new Map<number, number>(),
    delta15: new Map<number, number>(),
  };
  const add = (m: Map<number, number>, id: number, n: number) =>
    m.set(id, (m.get(id) ?? 0) + n + wsHeader(n));
  const tick: number[] = [];
  const stepMs: number[] = [];
  const bots: number[] = [];
  let raw = 0;
  let alone = 0;
  let context = 0;
  let lastScores = '';

  for (let i = 0; i < opts.warmup + opts.ticks; i++) {
    const measuring = i >= opts.warmup;
    const n = i - opts.warmup;
    const t0 = performance.now();
    const commands = room.decide();
    const t1 = performance.now();
    const events = room.step(commands);
    const t2 = performance.now();
    const views = new Map<number, View>();
    const frames = new Map<number, Uint8Array>();
    for (const id of ids) {
      const v = view(room.world, id, events, 0);
      frames.set(id, encodeServer(diff(sent.get(id) ?? null, v)));
      sent.set(id, v);
      views.set(id, v);
    }
    const t3 = performance.now();
    if (!measuring) continue;
    bots.push(t1 - t0);
    stepMs.push(t2 - t1);
    tick.push(t3 - t1);

    // The roster goes to everyone whenever a score changes.
    const scores = room.world.tanks.map((t) => `${t.id}:${t.score}`).join(',');
    const roster =
      scores === lastScores
        ? 0
        : encodeServer({
            type: 'roster',
            entries: room.world.tanks.map((t): RosterEntry => ({
              id: t.id,
              bot: true,
              score: t.score,
              name: `bot ${t.id}`,
            })),
          }).length;
    lastScores = scores;

    for (const id of ids) {
      const frame = frames.get(id);
      const v = views.get(id);
      if (!frame || !v) continue;
      const extra = roster > 0 ? roster + wsHeader(roster) : 0;
      add(bytes.delta, id, frame.length);
      add(bytes.full, id, encodeServer(diff(null, v)).length);
      bytes.delta.set(id, (bytes.delta.get(id) ?? 0) + extra);
      bytes.full.set(id, (bytes.full.get(id) ?? 0) + extra);

      if (n % 2 === 1) {
        const prev = between.get(id);
        const merged: View = { ...v, events: [...(prev?.events ?? []), ...v.events] };
        add(bytes.delta15, id, encodeServer(diff(sent15.get(id) ?? null, merged)).length);
        bytes.delta15.set(id, (bytes.delta15.get(id) ?? 0) + extra);
        sent15.set(id, v);
      } else {
        between.set(id, v);
      }

      const past = history.get(id) ?? [];
      if (n % opts.deflateEvery === 0) {
        const dictionary = Buffer.concat(past);
        raw += frame.length;
        alone += deflateRawSync(frame).length;
        context += deflateRawSync(frame, { dictionary }).length;
      }
      past.push(frame);
      let kept = past.reduce((s, f) => s + f.length, 0);
      while (kept > 8192 && past.length > 0) kept -= past.shift()?.length ?? 0;
    }
  }

  const seconds = opts.ticks / 30;
  const bandwidth = (m: Map<number, number>): Bandwidth => {
    const perSecond = [...m.values()].map((b) => b / seconds);
    return {
      mean: perSecond.reduce((s, b) => s + b, 0) / Math.max(1, perSecond.length),
      worst: Math.max(0, ...perSecond),
    };
  };
  return {
    tanks: opts.tanks,
    ticks: opts.ticks,
    tick: quantiles(tick),
    step: quantiles(stepMs),
    bots: quantiles(bots),
    down: {
      delta: bandwidth(bytes.delta),
      full: bandwidth(bytes.full),
      delta15: bandwidth(bytes.delta15),
    },
    deflate: { alone: alone / Math.max(1, raw), context: context / Math.max(1, raw) },
  };
}
