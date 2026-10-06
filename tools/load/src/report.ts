import type { PlayerReport } from './player.js';
import type { Profile } from './policy.js';

/** What `/ready` said at one moment of the run. */
export interface ServerSample {
  /** Seconds into the run. */
  readonly at: number;
  readonly rooms: number;
  readonly players: number;
  /** The tick's lateness and work at p99, ms — over the server's last ten minutes of ticks. */
  readonly latenessP99Ms: number;
  readonly workP99Ms: number;
}

export interface Summary {
  readonly clients: number;
  readonly minutes: number;
  readonly rooms: number;
  readonly periodMs: number;
  /** The worst of every sample's p99s. */
  readonly latenessP99Ms: number;
  readonly workP99Ms: number;
  /** Bytes a second a client was sent and sent, frames' payloads: the mean and the worst. */
  readonly down: { readonly mean: number; readonly worst: number };
  readonly up: { readonly mean: number; readonly worst: number };
  /** Corrections a minute, and their mean size in units, by profile. */
  readonly corrections: Readonly<
    Record<string, { readonly perMinute: number; readonly units: number; readonly clients: number }>
  >;
  readonly drops: {
    readonly short: number;
    /** Short drops that came back to their own tank. */
    readonly resumed: number;
    readonly backMs: { readonly p50: number; readonly max: number };
    readonly long: number;
    /** Long drops whose tank was gone, and that joined again as new. */
    readonly rejoined: number;
  };
  /** Reconnects nobody scheduled, by reason. */
  readonly unplanned: Readonly<Record<string, number>>;
  readonly kills: number;
  /** What failed ROADMAP P0's done-when; empty when it was met. */
  readonly failures: readonly string[];
}

/** ROADMAP S4's budget, bytes a second down to a client. */
export const DOWN_BUDGET = 6000;

const quantile = (xs: readonly number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

/**
 * The run in numbers, and ROADMAP P0's done-when held to them: every room's tick within its
 * deadline at p99 — its lateness and its work together inside a period — every client under the
 * bandwidth budget, every short drop back on its own tank, and every long one, its tank gone,
 * joined again as new.
 */
export function summarise(
  players: readonly PlayerReport[],
  samples: readonly ServerSample[],
  minutes: number,
  periodMs: number,
): Summary {
  const rate = (n: number, p: PlayerReport) => (p.seconds > 0 ? n / p.seconds : 0);
  const down = players.map((p) => rate(p.bytesIn, p));
  const up = players.map((p) => rate(p.bytesOut, p));
  const mean = (xs: readonly number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  const corrections: Record<string, { perMinute: number; units: number; clients: number }> = {};
  const byProfile = new Map<Profile['name'], PlayerReport[]>();
  for (const p of players) byProfile.set(p.profile, [...(byProfile.get(p.profile) ?? []), p]);
  for (const [name, ps] of byProfile) {
    const n = ps.reduce((a, p) => a + p.corrections, 0);
    corrections[name] = {
      perMinute: mean(ps.map((p) => rate(p.corrections, p) * 60)),
      units: n > 0 ? ps.reduce((a, p) => a + p.corrected, 0) / n / 8 : 0,
      clients: ps.length,
    };
  }

  const drops = players.flatMap((p) => p.drops);
  const short = drops.filter((d) => !d.long);
  const long = drops.filter((d) => d.long);
  const resumed = short.filter((d) => d.resumed === true && d.sameTank === true);
  const rejoined = long.filter((d) => d.resumed === false);
  const back = short.flatMap((d) => (d.backMs === null ? [] : [d.backMs]));

  const unplanned: Record<string, number> = {};
  for (const r of players.flatMap((p) => p.unplanned)) unplanned[r] = (unplanned[r] ?? 0) + 1;

  const lateness = Math.max(0, ...samples.map((s) => s.latenessP99Ms));
  const work = Math.max(0, ...samples.map((s) => s.workP99Ms));
  const worstDown = Math.max(0, ...down);
  const failures: string[] = [];
  if (samples.length === 0) failures.push('the server was never sampled');
  if (lateness + work >= periodMs) {
    failures.push(
      `the tick ran ${lateness.toFixed(2)} ms late and ${work.toFixed(2)} ms long at p99 — past its ${periodMs.toFixed(1)} ms`,
    );
  }
  if (worstDown >= DOWN_BUDGET) {
    failures.push(
      `a client was sent ${(worstDown / 1024).toFixed(2)} KB/s (budget ${DOWN_BUDGET / 1000})`,
    );
  }
  if (resumed.length < short.length) {
    failures.push(
      `${short.length - resumed.length} of ${short.length} short drops did not find their own tank`,
    );
  }
  if (rejoined.length < long.length) {
    const odd = long
      .filter((d) => d.resumed !== false)
      .slice(0, 3)
      .map((d) =>
        d.backMs === null ? 'never back' : `back in ${Math.round(d.backMs)} ms, resumed`,
      );
    failures.push(
      `${long.length - rejoined.length} of ${long.length} long drops did not join again as new (${odd.join(', ')})`,
    );
  }
  if (unplanned['outdated'] || unplanned['refused'])
    failures.push('a client was told it is outdated or refused');

  return {
    clients: players.length,
    minutes,
    rooms: Math.max(0, ...samples.map((s) => s.rooms)),
    periodMs,
    latenessP99Ms: lateness,
    workP99Ms: work,
    down: { mean: mean(down), worst: worstDown },
    up: { mean: mean(up), worst: Math.max(0, ...up) },
    corrections,
    drops: {
      short: short.length,
      resumed: resumed.length,
      backMs: { p50: quantile(back, 0.5), max: Math.max(0, ...back) },
      long: long.length,
      rejoined: rejoined.length,
    },
    unplanned,
    kills: players.reduce((a, p) => a + p.kills, 0),
    failures,
  };
}

const kb = (b: number) => (b / 1024).toFixed(2);

/** `docs/load/results.md`: the run's table, rewritten by every `pnpm load`. */
export function markdown(s: Summary, machine: string, date: string): string {
  const rows = Object.entries(s.corrections)
    .map(
      ([name, c]) =>
        `| ${name} | ${c.clients} | ${c.perMinute.toFixed(1)} | ${c.units.toFixed(1)} |`,
    )
    .join('\n');
  const unplanned = Object.entries(s.unplanned)
    .map(([r, n]) => `${n} × ${r}`)
    .join(', ');
  return `# Load — results

Written by \`pnpm load\` (${date}, ${machine}). See [README.md](README.md) for what is run and why.

| | |
| --- | --- |
| Clients · rooms · minutes | ${s.clients} · ${s.rooms} · ${s.minutes} |
| Tick lateness p99 (worst sample) | ${s.latenessP99Ms.toFixed(3)} ms |
| Tick work p99 (worst sample) | ${s.workP99Ms.toFixed(3)} ms — the period is ${s.periodMs.toFixed(1)} ms |
| Down per client, mean · worst | ${kb(s.down.mean)} · ${kb(s.down.worst)} KB/s (budget ${DOWN_BUDGET / 1000}) |
| Up per client, mean · worst | ${kb(s.up.mean)} · ${kb(s.up.worst)} KB/s |
| Short drops back on their own tank | ${s.drops.resumed} of ${s.drops.short} — back in ${Math.round(s.drops.backMs.p50)} ms at p50, ${Math.round(s.drops.backMs.max)} at worst |
| Long drops (past the grace) joined again as new | ${s.drops.rejoined} of ${s.drops.long} |
| Reconnects nobody scheduled | ${unplanned || 'none'} |
| Kills | ${s.kills} |

| Profile | Clients | Corrections a minute | Mean size, units |
| --- | --- | --- | --- |
${rows}

**Done when:** ${s.failures.length === 0 ? 'met.' : `not met — ${s.failures.join('; ')}.`}
`;
}
