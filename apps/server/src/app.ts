import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import fastifyStatic from '@fastify/static';
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
  // Checked before anything else is built, so a bad path names itself and opens nothing.
  const webRoot = config.staticDir === null ? null : webAppRoot(config.staticDir);
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
  const sockets = createSockets(
    lobby,
    { now, phase: () => t.phase() },
    app.log,
    config.pingMs,
    config.lab,
  );

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

  if (webRoot) serveWebApp(app, webRoot);

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
      app.log.info({ address, env: config.env, lab: config.lab }, 'listening');
      return address;
    },
    async close() {
      t.stop();
      sockets.close();
      await app.close();
    },
  };
}

/**
 * The built page from `/` (ADR-0004). Vite names every asset by its content hash, so those are
 * cached for a year; `index.html` names the current ones and is asked for afresh every time, or a
 * returning browser runs the last deploy's client against this deploy's server — the skew the
 * protocol's version byte exists to catch, better not caused. `/health`, `/ready` and the socket's
 * `/play` are more specific than any file, so none can be shadowed.
 */
function serveWebApp(app: FastifyInstance, root: string): void {
  void app.register(fastifyStatic, {
    root,
    cacheControl: false, // its own `max-age=0` would overwrite the header set below
    setHeaders(res, file) {
      res.setHeader(
        'cache-control',
        file.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });
}

function webAppRoot(dir: string): string {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error(`RICOCHET_STATIC_DIR has no index.html: ${root}`);
  }
  return root;
}
