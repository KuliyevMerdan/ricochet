import { RULES, apply, decodeServer, encodeClient } from '@ricochet/protocol';
import type { ShellAt, View } from '@ricochet/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from './app.js';
import type { TickRecord } from './room.js';
import { quantile } from './ticker.js';

/**
 * ROADMAP S3's done-when, over a real socket: a room of 12 headless clients driving at random, each
 * applying every snapshot it is sent to the view it holds — and that view, at every tick, is the one
 * the server sent it. `RICOCHET_SOAK_S` sets the length (`pnpm --filter @ricochet/server soak` runs
 * the full five minutes); CI runs ten seconds.
 */
const SECONDS = Number(process.env.RICOCHET_SOAK_S ?? 10);
const CLIENTS = 12;

const server = createServer({
  config: {
    env: 'development',
    host: '127.0.0.1',
    port: 0,
    maxRooms: 5,
    pingMs: 250,
    bots: RULES.botsFillTo,
    lab: false,
    staticDir: null,
    logLevel: 'silent',
  },
  logger: false,
  observe: record,
});
afterAll(() => server.close());

/** What the server sent each player at each tick, and what was wrong with any of it. */
const sent = new Map<number, Map<number, View>>();
const serverProblems: string[] = [];

function record({ world, views }: TickRecord): void {
  for (const [id, v] of views) {
    // Every view a subset of the world: each tank and shell in it is in the world, as it is there.
    for (const t of v.tanks) {
      const w = world.tanks.find((o) => o.id === t.id);
      if (!w || w.x !== t.x || w.y !== t.y || w.hull !== t.hull || w.hp !== t.hp) {
        serverProblems.push(
          `tick ${v.tick}: player ${id} was shown tank ${t.id} not as the world has it`,
        );
      }
    }
    for (const s of v.shells) {
      if (!world.shells.some((o) => o.id === s.id && o.x === s.x && o.y === s.y)) {
        serverProblems.push(
          `tick ${v.tick}: player ${id} was shown shell ${s.id} the world does not have`,
        );
      }
    }
    const mine = sent.get(id) ?? new Map<number, View>();
    mine.set(v.tick, v);
    sent.set(id, mine);
  }
}

interface Client {
  id: number;
  held: Map<number, View>;
  problems: string[];
  pongs: number;
  close(): void;
}

function client(url: string, n: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';
    let seq = 0;
    let view: View | null = null;
    let move: number | null = null;
    let aim = 0;
    const c: Client = { id: 0, held: new Map(), problems: [], pongs: 0, close: () => ws.close() };
    let inputs: ReturnType<typeof setInterval> | null = null;
    let pings: ReturnType<typeof setInterval> | null = null;

    ws.on('open', () =>
      ws.send(encodeClient({ type: 'hello', version: 1, token: null, name: `bot ${n}` })),
    );
    ws.on('message', (data: Buffer) => {
      const d = decodeServer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (!d.ok) {
        c.problems.push(`undecodable frame: ${d.reason}`);
        return;
      }
      const m = d.value;
      if (m.type === 'welcome') {
        c.id = m.you;
        inputs = setInterval(() => {
          if (Math.random() < 0.05)
            move = Math.random() < 0.2 ? null : Math.floor(Math.random() * 1024);
          aim = (aim + 7) % 1024;
          ws.send(
            encodeClient({ type: 'input', seq: ++seq, aim, move, fire: Math.random() < 0.3 }),
          );
        }, 1000 / 30);
        let ping = 0;
        pings = setInterval(() => ws.send(encodeClient({ type: 'ping', id: ++ping })), 500);
        resolve(c);
      } else if (m.type === 'snapshot') {
        const r = apply(view, m);
        if (!r.ok) c.problems.push(`tick ${m.tick}: ${r.reason}`);
        else {
          view = r.value;
          c.held.set(view.tick, view);
        }
      } else if (m.type === 'pong') {
        c.pongs++;
      } else if (m.type === 'error') {
        c.problems.push(`error ${m.code}`);
      }
    });
    ws.on('close', () => {
      if (inputs) clearInterval(inputs);
      if (pings) clearInterval(pings);
    });
    ws.on('error', reject);
  });
}

/** The view a client must hold: the server's, with each shell as it was when it entered the view. */
function expected(byTick: Map<number, View>): Map<number, View> {
  const out = new Map<number, View>();
  let first = new Map<number, ShellAt>();
  for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
    const v = byTick.get(tick);
    if (!v) continue;
    const next = new Map<number, ShellAt>();
    for (const s of v.shells) next.set(s.id, first.get(s.id) ?? s);
    first = next;
    out.set(tick, { ...v, shells: v.shells.map((s) => next.get(s.id) ?? s) });
  }
  return out;
}

describe('ROADMAP S3 done-when, over real sockets', () => {
  it(
    `a room of ${CLIENTS} for ${SECONDS} s: every client's view is the server's at every tick`,
    async () => {
      const address = await server.listen();
      const url = address.replace(/^http/, 'ws') + '/play';
      const clients = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(url, i)));
      await new Promise((r) => setTimeout(r, SECONDS * 1000));
      for (const c of clients) c.close();
      await new Promise((r) => setTimeout(r, 200));

      expect(server.lobby.rooms).toHaveLength(1);
      expect(serverProblems).toEqual([]);
      let compared = 0;
      for (const c of clients) {
        expect(c.problems).toEqual([]);
        expect(c.pongs).toBeGreaterThan(SECONDS);
        const want = expected(sent.get(c.id) ?? new Map());
        // The last tick or two may have been sent after the client stopped listening.
        for (const [tick, held] of c.held) {
          const w = want.get(tick);
          if (!w) continue;
          expect(JSON.stringify(held), `player ${c.id} at tick ${tick}`).toBe(JSON.stringify(w));
          compared++;
        }
        expect(c.held.size).toBeGreaterThan(SECONDS * 30 * 0.9);
      }
      expect(compared).toBeGreaterThan(CLIENTS * SECONDS * 30 * 0.9);

      const stats = server.ticker.stats();
      const p99 = quantile(stats.lateness, 0.99);
      const work = quantile(stats.work, 0.99);
      console.log(
        `${stats.ticks} ticks · lateness p50 ${quantile(stats.lateness, 0.5).toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${Math.max(...stats.lateness).toFixed(3)} ms · work p99 ${work.toFixed(3)} ms · skipped ${stats.skipped}`,
      );
      // The done-when's 2 ms is a measurement for a quiet machine — `soak`, five minutes. CI is a
      // shared runner, so the short run holds the bound that is about correctness, not speed: no
      // tick a whole period late at p99. Even that needs the package suites run one at a time
      // (`pnpm test`): beside them on four vCPUs it measured 11 ms at S3, and 153 ms once S4's
      // bot room and grid tests joined in — the process starved, not the tick.
      expect(p99).toBeLessThan(SECONDS >= 60 ? 2 : server.ticker.period);
      expect(stats.skipped).toBe(0);
    },
    (SECONDS + 30) * 1000,
  );
});
