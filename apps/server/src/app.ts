import { randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { RULES } from '@ricochet/protocol';
import type { Config } from './config.js';
import { IDLE_ROOM_TICKS, Lobby } from './lobby.js';
import type { Observer } from './room.js';
import { createSockets } from './sockets.js';
import type { Sockets } from './sockets.js';
import { Ticker, quantile, systemTickerClock } from './ticker.js';

export interface Server {
  readonly app: FastifyInstance;
  readonly lobby: Lobby;
  readonly ticker: Ticker;
  readonly sockets: Sockets;
  /** Listen, then start the tick. Returns the address. */
  listen(): Promise<string>;
  close(): Promise<void>;
}

export interface ServerOptions {
  readonly config: Config;
  readonly logger?: boolean | FastifyBaseLogger;
  readonly observe?: Observer;
}

/** Everything wired, nothing started — tests and `main.ts` both build the server through here. */
export function createServer({ config, logger = true, observe }: ServerOptions): Server {
  const now = () => performance.now();
  const app = Fastify({
    logger: logger === true ? { level: config.logLevel } : false,
    disableRequestLogging: true,
  });
  let ticker: Ticker | null = null;
  const lobby = new Lobby({
    maxRooms: config.maxRooms,
    idleTicks: IDLE_ROOM_TICKS,
    token: () => randomBytes(16).toString('hex'),
    seed: () => randomInt(0, 2 ** 32 - 1),
    tick: () => ticker?.phase().tick ?? 0,
    botsFillTo: config.bots,
    ...(observe ? { observe } : {}),
  });
  ticker = new Ticker(() => lobby.tick(), systemTickerClock(now), RULES.tickHz);
  const t = ticker;
  const sockets = createSockets(lobby, { now, phase: () => t.phase() }, app.log, config.pingMs);

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_req, reply) => {
    if (!t.isRunning) return reply.code(503).send({ ready: false });
    const stats = t.stats();
    return {
      ready: true,
      rooms: lobby.rooms.length,
      players: lobby.players(),
      bots: lobby.bots(),
      sockets: sockets.size,
      tick: stats.ticks,
      latenessP99Ms: quantile(stats.lateness, 0.99),
      workP99Ms: quantile(stats.work, 0.99),
    };
  });

  app.server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/play') {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head);
  });

  return {
    app,
    lobby,
    ticker: t,
    sockets,
    async listen() {
      const address = await app.listen({ host: config.host, port: config.port });
      t.start();
      app.log.info({ address, env: config.env }, 'listening');
      return address;
    },
    async close() {
      t.stop();
      sockets.close();
      await app.close();
    },
  };
}
