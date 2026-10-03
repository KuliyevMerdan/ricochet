import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { encodeServer } from '@ricochet/protocol';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { Connection } from './connection.js';
import type { ConnectionClock, Socket } from './connection.js';
import type { Lobby } from './lobby.js';

export interface Sockets {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
  readonly size: number;
}

/** A socket's round-trip measurement: the ping in flight, pings missed in a row, recent samples. */
interface Probe {
  sentAt: number | null;
  missed: number;
  rtts: number[];
}

/** The close code the server ends a connection with — 4000s are the application's to define. */
export const CLOSED_BY_SERVER = 4000;
/** A `hello` must arrive this soon after the socket opens (protocol § 3). */
const HELLO_WITHIN_MS = 5000;
/** The largest frame a client may send; the largest real one is a `hello` of 68 bytes. */
const MAX_FRAME = 256;
/** Round-trip samples kept per socket; the median of them is the socket's round trip. */
const RTT_SAMPLES = 5;

/**
 * The `ws` transport. Each socket is pinged at the WebSocket level every `pingMs` — answered by the
 * browser itself, below any JavaScript — and the answers are the server's own measure of that
 * socket's round trip, which ADR-0002's fast-forward reads. A socket that leaves five pings
 * unanswered has died without saying so and is terminated.
 */
export function createSockets(
  lobby: Lobby,
  clock: ConnectionClock,
  log: FastifyBaseLogger,
  pingMs: number,
): Sockets {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const probes = new WeakMap<WebSocket, Probe>();

  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      const p = probes.get(ws);
      if (!p) continue;
      if (p.sentAt !== null && ++p.missed >= 5) {
        ws.terminate();
        continue;
      }
      p.sentAt = clock.now();
      ws.ping();
    }
  }, pingMs);
  pinger.unref();

  wss.on('connection', (ws: WebSocket) => {
    const probe: Probe = { sentAt: null, missed: 0, rtts: [] };
    probes.set(ws, probe);
    ws.on('pong', () => {
      if (probe.sentAt === null) return;
      probe.rtts.push(clock.now() - probe.sentAt);
      if (probe.rtts.length > RTT_SAMPLES) probe.rtts.shift();
      probe.sentAt = null;
      probe.missed = 0;
    });
    // One ping at once, so the first shells a player fires already have a lead to go on.
    probe.sentAt = clock.now();
    ws.ping();

    const socket: Socket = {
      send(frame) {
        if (ws.readyState === ws.OPEN) ws.send(frame, { binary: true });
      },
      close() {
        ws.close(CLOSED_BY_SERVER, 'replaced by another connection');
        setTimeout(() => ws.terminate(), 2000).unref();
      },
      refuse(code) {
        if (ws.readyState === ws.OPEN)
          ws.send(encodeServer({ type: 'error', code }), { binary: true });
        ws.close(CLOSED_BY_SERVER, code);
        setTimeout(() => ws.terminate(), 2000).unref();
      },
      rttMs() {
        if (probe.rtts.length === 0) return null;
        const sorted = [...probe.rtts].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? null;
      },
    };
    const connection = new Connection(socket, lobby, clock);
    const hello = setTimeout(() => {
      if (!connection.welcomed) ws.terminate();
    }, HELLO_WITHIN_MS);
    hello.unref();

    ws.on('message', (data: RawData, isBinary: boolean) => {
      connection.receive(isBinary ? bytes(data) : null);
    });
    ws.on('close', () => {
      clearTimeout(hello);
      connection.closed();
    });
    ws.on('error', (error) => log.warn({ err: error }, 'socket error'));
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      clearInterval(pinger);
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
