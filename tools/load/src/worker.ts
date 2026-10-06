import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { ARENA_0 } from '@ricochet/protocol';
import { LoadPlayer } from './player.js';
import { PROFILES, ROOM_MIX } from './policy.js';

/** What a worker is handed: the players `first … first + count − 1` of the run. */
export interface WorkerJob {
  readonly url: string;
  readonly first: number;
  readonly count: number;
  /** Player `i` joins `i · joinMs` into the run, so rooms fill one at a time. */
  readonly joinMs: number;
  readonly seconds: number;
}

const QUIET_MS = 20_000;

function isJob(v: unknown): v is WorkerJob {
  if (typeof v !== 'object' || v === null) return false;
  const get = (k: string): unknown => Reflect.get(v, k);
  return (
    typeof get('url') === 'string' &&
    ['first', 'count', 'joinMs', 'seconds'].every((k) => typeof get(k) === 'number')
  );
}

/**
 * One thread of the load: its share of the players, each joining in turn, playing for the run's
 * length and reporting. Threads, because 240 clients each predicting and deciding thirty times a
 * second are more than one event loop should carry beside its sockets.
 */
const job: unknown = workerData;
if (!isJob(job) || !parentPort) throw new Error('a load worker needs its job');
const port = parentPort;
const players: LoadPlayer[] = [];
/** The last 20 s are quiet: a long drop is 13 s out and a reconnect up to 4 s more, so every fault
 * begun is followed to its end. */
const quietAt = performance.now() + job.seconds * 1000 - QUIET_MS;
const joins: ReturnType<typeof setTimeout>[] = [];
for (let k = 0; k < job.count; k++) {
  const i = job.first + k;
  const profile = PROFILES[ROOM_MIX[i % ROOM_MIX.length] ?? 'clean'];
  const p = new LoadPlayer(job.url, `load ${i}`, profile, ARENA_0, 0x9e3779b1 ^ i);
  players.push(p);
  joins.push(setTimeout(() => p.start(quietAt), i * job.joinMs));
}
setTimeout(() => {
  for (const t of joins) clearTimeout(t);
  port.postMessage(players.map((p) => p.stop()));
}, job.seconds * 1000);
