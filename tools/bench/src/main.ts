import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bench } from './bench.js';
import type { BenchResult } from './bench.js';

/**
 * `pnpm bench` — ROADMAP S4's done-when: rooms of 6, 12 and 24 bots stepped headless, the server's
 * tick timed and every player's bytes counted, written to `docs/bench/results.md`. Fails when a
 * 12-tank tick takes 1 ms at p99 or any client of 12 is sent 6 KB/s with deltas.
 *
 * `--ticks N` measures N ticks per room (default 9,000 — five minutes of play).
 */
const TICK_BUDGET_MS = 1;
const DOWN_BUDGET = 6000;

const arg = process.argv.indexOf('--ticks');
const ticks = arg >= 0 ? Number(process.argv[arg + 1]) : 9000;
if (!Number.isInteger(ticks) || ticks < 30) throw new Error(`--ticks must be at least 30`);

const results: BenchResult[] = [];
for (const tanks of [6, 12, 24]) {
  const r = bench({ tanks, seed: 1, warmup: 300, ticks, deflateEvery: 30 });
  results.push(r);
  console.log(
    `${String(tanks).padStart(2)} tanks · tick p50 ${ms(r.tick.p50)} p99 ${ms(r.tick.p99)} ms · bots p99 ${ms(r.bots.p99)} ms · down ${kb(r.down.delta.worst)} KB/s delta, ${kb(r.down.full.worst)} full`,
  );
}

const twelve = results.find((r) => r.tanks === 12);
const failures: string[] = [];
if (!twelve || twelve.tick.p99 >= TICK_BUDGET_MS) {
  failures.push(`a 12-tank tick takes ${ms(twelve?.tick.p99 ?? NaN)} ms at p99 (budget 1 ms)`);
}
if (!twelve || twelve.down.delta.worst >= DOWN_BUDGET) {
  failures.push(`a client of 12 is sent ${kb(twelve?.down.delta.worst ?? NaN)} KB/s (budget 6)`);
}

const out = fileURLToPath(new URL('../../../docs/bench/', import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(`${out}results.md`, report(results, ticks));
console.log(`written to docs/bench/results.md`);
if (failures.length > 0) {
  console.error(`over budget:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}

function ms(v: number): string {
  return v.toFixed(3);
}

function kb(bytesPerSecond: number): string {
  return (bytesPerSecond / 1000).toFixed(2);
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

function report(rs: readonly BenchResult[], n: number): string {
  const cpu = cpus()[0]?.model ?? 'unknown CPU';
  const row = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  const lines = [
    '# Bench results',
    '',
    `Written by \`pnpm bench\` (\`tools/bench\`) on ${new Date().toISOString().slice(0, 10)} — ${cpu}, ${cpus().length} cores, Node ${process.version}. Each room is played by bots for ${n.toLocaleString('en')} ticks (${(n / 30 / 60).toFixed(1)} min of play) after 300 to spread out, every tank treated as a connected player. What the numbers mean, and the decisions taken from them, is in [README.md](README.md).`,
    '',
    '## The tick',
    '',
    "Milliseconds of one server tick: `sim.step`, then a view, a diff and an encode per player. The bots' decisions are timed apart — a room with people in it has fewer.",
    '',
    row([
      'Tanks',
      'tick p50',
      'tick p99',
      'tick max',
      'of which `step` p99',
      'bots p50',
      'bots p99',
    ]),
    row(['---:', '---:', '---:', '---:', '---:', '---:', '---:']),
    ...rs.map((r) =>
      row([
        String(r.tanks),
        ms(r.tick.p50),
        `**${ms(r.tick.p99)}**`,
        ms(r.tick.max),
        ms(r.step.p99),
        ms(r.bots.p50),
        ms(r.bots.p99),
      ]),
    ),
    '',
    '## Down, per client',
    '',
    'KB/s (1 KB = 1,000 bytes) sent to one client — snapshots and the roster, each with its WebSocket header — as the mean over clients / the worst client.',
    '',
    row([
      'Tanks',
      'delta, 30 Hz',
      'whole, 30 Hz',
      'delta, 15 Hz',
      'deflated alone',
      'deflated in context',
    ]),
    row(['---:', '---:', '---:', '---:', '---:', '---:']),
    ...rs.map((r) =>
      row([
        String(r.tanks),
        `**${kb(r.down.delta.mean)}** / ${kb(r.down.delta.worst)}`,
        `${kb(r.down.full.mean)} / ${kb(r.down.full.worst)}`,
        `${kb(r.down.delta15.mean)} / ${kb(r.down.delta15.worst)}`,
        pct(r.deflate.alone),
        pct(r.deflate.context),
      ]),
    ),
    '',
    '"Deflated" is the size of a sampled delta frame after `deflateRaw`, against its raw size: alone (permessage-deflate with `no_context_takeover`), and with the socket\'s previous 8 KB as the dictionary (a shortened stand-in for context takeover\'s 32 KB window).',
    '',
  ];
  return lines.join('\n');
}
