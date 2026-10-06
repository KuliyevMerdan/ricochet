import { apply, decodeServer, encodeClient } from '@ricochet/protocol';
import type { ClientMessage, View } from '@ricochet/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from './app.js';

/**
 * The network lab over real sockets (docs/protocol.md § 3.1): it delays and stalls its sender's own
 * link and nobody else's, the server's own measure of the round trip sees what it adds, and a stall
 * delivers what it held in order. A server without the lab hears the same frames and changes nothing.
 */

const config = {
  env: 'development',
  host: '127.0.0.1',
  port: 0,
  maxRooms: 5,
  pingMs: 100,
  bots: 0,
  logLevel: 'silent',
} as const;
const server = createServer({ config: { ...config, lab: true }, logger: false });
const plain = createServer({ config: { ...config, lab: false }, logger: false });
let url = '';
let plainUrl = '';
beforeAll(async () => {
  url = (await server.listen()).replace(/^http/, 'ws') + '/play';
  plainUrl = (await plain.listen()).replace(/^http/, 'ws') + '/play';
});
afterAll(async () => {
  await server.close();
  await plain.close();
});

interface Peer {
  id: number;
  /** Every snapshot's tick and when it arrived, ms. */
  readonly ticks: { tick: number; at: number }[];
  readonly problems: string[];
  send(m: ClientMessage): void;
  /** The round trip of a protocol ping, ms. */
  ping(): Promise<number>;
  close(): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function join(to: string, name: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(to);
    ws.binaryType = 'nodebuffer';
    let view: View | null = null;
    let pingId = 0;
    const waiting = new Map<number, (ms: number) => void>();
    const sentAt = new Map<number, number>();
    const peer: Peer = {
      id: 0,
      ticks: [],
      problems: [],
      send: (m) => ws.send(encodeClient(m)),
      ping: () =>
        new Promise((done) => {
          const id = ++pingId;
          waiting.set(id, done);
          sentAt.set(id, performance.now());
          ws.send(encodeClient({ type: 'ping', id }));
        }),
      close: () => ws.close(),
    };
    ws.on('open', () => peer.send({ type: 'hello', version: 1, token: null, name }));
    ws.on('message', (data: Buffer) => {
      const d = decodeServer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      if (!d.ok) return void peer.problems.push(d.reason);
      const m = d.value;
      if (m.type === 'welcome') {
        peer.id = m.you;
        resolve(peer);
      } else if (m.type === 'snapshot') {
        const r = apply(view, m);
        if (!r.ok) return void peer.problems.push(r.reason);
        view = r.value;
        peer.ticks.push({ tick: view.tick, at: performance.now() });
      } else if (m.type === 'pong') {
        const at = sentAt.get(m.id);
        waiting.get(m.id)?.(performance.now() - (at ?? 0));
      } else if (m.type === 'error') {
        peer.problems.push(m.code);
      }
    });
    ws.on('error', reject);
  });
}

/** The server's own measure of a player's round trip, ms. */
function measured(id: number): number | null {
  for (const room of server.lobby.rooms) {
    const p = room.players.get(id);
    if (p?.peer) return p.peer.rttMs();
  }
  return null;
}

describe('the network lab', () => {
  it('adds its latency to its sender’s link only, and the server measures it', async () => {
    const lagged = await join(url, 'Lagged');
    const clean = await join(url, 'Clean');
    lagged.send({ type: 'lab', latencyMs: 300, jitterMs: 0 });
    await wait(200); // the lab frame itself crosses the clean link at once
    const lag = [];
    for (let i = 0; i < 4; i++) lag.push(await lagged.ping());
    const fast = await clean.ping();
    // Five WebSocket pings at 100 ms apart, each a 300 ms round trip.
    await wait(800);
    expect(Math.min(...lag)).toBeGreaterThanOrEqual(295);
    expect(fast).toBeLessThan(100);
    expect(measured(lagged.id)).toBeGreaterThanOrEqual(295);
    expect(measured(clean.id)).toBeLessThan(100);

    // Back to a clean link: the next frames come straight through.
    lagged.send({ type: 'lab', latencyMs: 0, jitterMs: 0 });
    await wait(400);
    expect(await lagged.ping()).toBeLessThan(100);
    expect(lagged.problems).toEqual([]);
    lagged.close();
    clean.close();
  }, 15_000);

  it('stalls its sender’s link, then delivers every snapshot it held, in order', async () => {
    const stalled = await join(url, 'Stalled');
    await wait(300);
    stalled.send({ type: 'stall', ms: 1000 });
    await wait(1500);
    // From the last snapshot before the stall was asked for.
    const sent = performance.now() - 1500;
    const ticks = stalled.ticks.filter((t) => t.at >= sent - 100);
    // Nothing for the second it was stalled, then a burst at once…
    const gap = Math.max(...ticks.slice(1).map((t, i) => t.at - (ticks[i]?.at ?? t.at)));
    expect(gap).toBeGreaterThanOrEqual(900);
    // … and every tick arrived exactly once, in order.
    const all = stalled.ticks.map((t) => t.tick);
    expect(all.every((t, i) => i === 0 || t === (all[i - 1] ?? 0) + 1)).toBe(true);
    expect(stalled.problems).toEqual([]);
    stalled.close();
  }, 10_000);

  it('is heard by a server with the lab only', async () => {
    const p = await join(plainUrl, 'Plain');
    p.send({ type: 'lab', latencyMs: 600, jitterMs: 0 });
    p.send({ type: 'stall', ms: 2000 });
    await wait(200);
    expect(await p.ping()).toBeLessThan(100);
    expect(p.problems).toEqual([]);
    p.close();
  }, 10_000);
});
