import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { encodeServer } from '@ricochet/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { Connection } from './connection.js';
import type { ConnectionClock, Socket } from './connection.js';
import { Link } from './link.js';
import type { LaneTimers } from './link.js';
import type { Lobby } from './lobby.js';

export interface Sockets {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
  readonly size: number;
}

/** A socket's round-trip measurement: the pings in flight by id, with when each was sent, and
 * the recent samples. */
interface Probe {
  next: number;
  readonly sent: Map<number, number>;
  readonly rtts: number[];
}

/** The close code the server ends a connection with — 4000s are the application's to define. */
export const CLOSED_BY_SERVER = 4000;
/** A `hello` must arrive this soon after the socket opens (protocol § 3). */
const HELLO_WITHIN_MS = 5000;
/** The largest frame a client may send; the largest real one is a `hello` of 68 bytes. */
const MAX_FRAME = 256;
/** Round-trip samples kept per socket; the median of them is the socket's round trip. */
const RTT_SAMPLES = 5;
/** A socket whose oldest ping has gone unanswered this long has died without saying so — longer
 * than the lab's worst: a 5 s stall on a 2 s round trip (protocol § 3, § 4.9). */
const DEAD_MS = 10_000;

/**
 * The `ws` transport. Each socket is pinged at the WebSocket level every `pingMs` — answered by the
 * browser itself, below any JavaScript — and the answers are the server's own measure of that
 * socket's round trip, which ADR-0002's fast-forward reads. Each ping carries its id, so a round
 * trip longer than the interval is still measured against its own ping. A socket that leaves a ping
 * unanswered for `DEAD_MS` has died without saying so and is terminated.
 *
 * With `lab`, each socket runs through a `Link` of its own (docs/protocol.md § 3.1): its frames,
 * both ways, and its pings and their answers, so the measured round trip includes what the lab
 * adds. A clean link delivers at once.
 */
export function createSockets(
  lobby: Lobby,
  clock: ConnectionClock,
  log: FastifyBaseLogger,
  pingMs: number,
  lab = false,
): Sockets {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const pingers = new WeakMap<WebSocket, () => void>();
  const timers: LaneTimers = {
    after(ms, fn) {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  };

  const beat = setInterval(() => {
    for (const ws of wss.clients) pingers.get(ws)?.();
  }, pingMs);
  beat.unref();

  wss.on('connection', (ws: WebSocket) => {
    const link = lab ? new Link(clock, timers, Math.random) : null;
    const down = (fn: () => void) => (link ? link.toClient(fn) : fn());
    const up = (fn: () => void) => (link ? link.fromClient(fn) : fn());
    const open = () => ws.readyState === ws.OPEN;

    const probe: Probe = { next: 0, sent: new Map(), rtts: [] };
    const ping = () => {
      const oldest = probe.sent.values().next();
      if (!oldest.done && clock.now() - oldest.value > DEAD_MS) {
        ws.terminate();
        return;
      }
      const id = (probe.next = (probe.next + 1) >>> 0);
      probe.sent.set(id, clock.now());
      const data = Buffer.alloc(4);
      data.writeUInt32LE(id);
      down(() => {
        if (open()) ws.ping(data);
      });
    };
    pingers.set(ws, ping);
    ws.on('pong', (data: Buffer) => {
      up(() => {
        if (data.length !== 4) return;
        const id = data.readUInt32LE(0);
        const at = probe.sent.get(id);
        if (at === undefined) return;
        // In order, as TCP delivers: every ping before this one has been answered too.
        for (const k of probe.sent.keys()) {
          probe.sent.delete(k);
          if (k === id) break;
        }
        probe.rtts.push(clock.now() - at);
        if (probe.rtts.length > RTT_SAMPLES) probe.rtts.shift();
      });
    });
    // One ping at once, so the first shells a player fires already have a lead to go on.
    ping();

    const socket: Socket = {
      send(frame) {
        down(() => {
          if (open()) ws.send(frame, { binary: true });
        });
      },
      close(reason = 'replaced by another connection') {
        ws.close(CLOSED_BY_SERVER, reason);
        setTimeout(() => ws.terminate(), 2000).unref();
      },
      refuse(code) {
        down(() => {
          if (open()) ws.send(encodeServer({ type: 'error', code }), { binary: true });
          ws.close(CLOSED_BY_SERVER, code);
          setTimeout(() => ws.terminate(), 2000).unref();
        });
      },
      rttMs() {
        if (probe.rtts.length === 0) return null;
        const sorted = [...probe.rtts].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? null;
      },
      // What `ws` holds unsent. The lab's lanes are the network, not the server: a frame waiting in
      // one has left as far as the server can tell.
      backlog: () => ws.bufferedAmount,
      link,
    };
    const connection = new Connection(socket, lobby, clock);
    const hello = setTimeout(() => {
      if (!connection.welcomed) ws.terminate();
    }, HELLO_WITHIN_MS);
    hello.unref();

    ws.on('message', (data: RawData, isBinary: boolean) => {
      const frame = isBinary ? bytes(data) : null;
      up(() => connection.receive(frame));
    });
    ws.on('close', () => {
      clearTimeout(hello);
      link?.close();
      connection.closed();
    });
    ws.on('error', (error) => log.warn({ err: error }, 'socket error'));
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      clearInterval(beat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
    get size() {
      return wss.clients.size;
    },
  };
}

function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
