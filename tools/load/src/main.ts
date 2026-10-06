import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { RULES } from '@ricochet/protocol';
import type { PlayerReport } from './player.js';
import { markdown, summarise } from './report.js';
import type { ServerSample } from './report.js';
import type { WorkerJob } from './worker.js';

/**
 * `pnpm load` — ROADMAP P0's done-when: 20 rooms of 12 headless clients for 30 minutes, over real
 * sockets, against the built server in production mode with its network lab on — half of each
 * room on a clean link, the rest lagged, rough (stalling) or dropping, through the lab. `/ready` is
 * sampled every 30 s for the tick's lateness and work; every client reports its bytes, corrections
 * and drops. Writes `docs/load/results.md`; fails when the done-when is not met.
 *
 * `--rooms N` (20), `--minutes M` (30), `--workers W` (half the cores, at most 8), `--url ws://…`
 * to load a server already running instead of starting one.
 */
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};
const rooms = arg('rooms', 20);
const minutes = arg('minutes', 30);
const workers = Math.min(
  rooms * RULES.roomSize,
  arg('workers', Math.min(8, Math.max(1, cpus().length >> 1))),
);
const urlAt = process.argv.indexOf('--url');
const given = urlAt >= 0 ? process.argv[urlAt + 1] : undefined;
const PORT = 8096;
/** A join every 100 ms: twenty rooms full in 24 s, each filled before the next opens. */
const JOIN_MS = 100;
const SAMPLE_MS = 30_000;

const clients = rooms * RULES.roomSize;
const url = given ?? `ws://127.0.0.1:${PORT}/play`;
const http = url.replace(/^ws/, 'http').replace(/\/play$/, '');

const server = given
  ? null
  : spawn(
      process.execPath,
      [fileURLToPath(new URL('../../../apps/server/dist/main.js', import.meta.url))],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          RICOCHET_LAB: 'on',
          RICOCHET_BOTS: '0',
          RICOCHET_MAX_ROOMS: String(rooms + 5),
          PORT: String(PORT),
          HOST: '127.0.0.1',
          LOG_LEVEL: 'warn',
        },
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
process.on('exit', () => server?.kill('SIGTERM'));

async function ready(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${http}/ready`);
    const body: unknown = await r.json();
    return typeof body === 'object' && body !== null
      ? Object.fromEntries(Object.entries(body))
      : null;
  } catch {
    return null;
  }
}
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

for (let i = 0; ; i++) {
  if ((await ready())?.['ready'] === true) break;
  if (i > 150) throw new Error(`no server at ${http}`);
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`${clients} clients in ${rooms} rooms for ${minutes} min, ${workers} threads → ${url}`);

const started = Date.now();
const samples: ServerSample[] = [];
const sampler = setInterval(() => {
  void ready().then((r) => {
    if (!r) return;
    const s: ServerSample = {
      at: (Date.now() - started) / 1000,
      rooms: num(r['rooms']),
      players: num(r['players']),
      latenessP99Ms: num(r['latenessP99Ms']),
      workP99Ms: num(r['workP99Ms']),
    };
    samples.push(s);
    console.log(
      `${Math.round(s.at)} s · ${s.rooms} rooms, ${s.players} players · tick late ${s.latenessP99Ms.toFixed(2)} ms, work ${s.workP99Ms.toFixed(2)} ms at p99`,
    );
  });
}, SAMPLE_MS);

const seconds = minutes * 60;
const per = Math.ceil(clients / workers);
const reports = await Promise.all(
  Array.from({ length: workers }, (_, w) => {
    const first = w * per;
    const job: WorkerJob = {
      url,
      first,
      count: Math.max(0, Math.min(per, clients - first)),
      joinMs: JOIN_MS,
      seconds,
    };
    return new Promise<PlayerReport[]>((resolve, reject) => {
      const t = new Worker(new URL('./worker.js', import.meta.url), { workerData: job });
      t.once('message', (m: PlayerReport[]) => {
        resolve(m);
        void t.terminate();
      });
      t.once('error', reject);
    });
  }),
);
clearInterval(sampler);
const last = await ready();
if (last) {
  samples.push({
    at: (Date.now() - started) / 1000,
    rooms: num(last['rooms']),
    players: num(last['players']),
    latenessP99Ms: num(last['latenessP99Ms']),
    workP99Ms: num(last['workP99Ms']),
  });
}

const summary = summarise(reports.flat(), samples, minutes, 1000 / RULES.tickHz);
const machine = `${cpus()[0]?.model ?? 'unknown CPU'}, Node ${process.version}`;
const out = fileURLToPath(new URL('../../../docs/load/', import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}results.md`,
  markdown(summary, machine, new Date().toISOString().slice(0, 10)),
);
// Every client's own report, for a failure to be looked into; too much to keep beside the summary.
const raw = `${tmpdir()}/ricochet-load-players.json`;
writeFileSync(raw, JSON.stringify(reports.flat()));
console.log(JSON.stringify(summary, null, 2));
console.log(`every client's report: ${raw}`);
server?.kill('SIGTERM');
if (summary.failures.length > 0) {
  console.error(`P0's done-when not met:\n  ${summary.failures.join('\n  ')}`);
  process.exit(1);
}
process.exit(0);
