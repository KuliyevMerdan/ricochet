// ROADMAP C2 "Done when", measured: `pnpm --filter @ricochet/web feel` (after `pnpm build`).
//
// The built page behind `vite preview`, the built server behind a proxy that holds every byte 75 ms
// each way — 150 ms of round trip, as TCP would — and Chromium driving it:
//
//   1. a key: frames from the keydown to the first frame the own tank is drawn moved, 20 times;
//   2. a press: frames from the pointerdown to the first frame the own shell is drawn, 20 times;
//   3. the schemes: two touch sticks and a gamepad each drive and fire, and switch the scheme;
//   4. RICOCHET_FEEL_MINUTES (10) against eleven bots, driving and firing: every hit the page drew
//      held to a `hit` event the server sent, and every shell of its own the page stopped drawing
//      held to its own end — a hit, a wall or its age, a refusal — never to a tank it passed.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const web = path.join(root, 'apps/web');
const vite = path.join(web, 'node_modules/vite/bin/vite.js');
const env = process.env;
const MINUTES = Number(env.RICOCHET_FEEL_MINUTES ?? 10);
const ONE_WAY = Number(env.RICOCHET_FEEL_ONE_WAY_MS ?? 75);
const SERVER = 8097;
const PROXY = 8098;
const PREVIEW = 4197;

const children = new Set();
const run = (args, extra, cwd = root) => {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...extra },
    stdio: 'ignore',
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
};
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('exit', stop);

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A TCP proxy that holds every chunk `ONE_WAY` ms in each direction, in order — latency as a
 * WebSocket feels it, with nothing lost or reordered. */
const proxy = net.createServer((client) => {
  const upstream = net.connect(SERVER, '127.0.0.1');
  const delay = (from, to) => {
    let last = 0;
    from.on('data', (chunk) => {
      const at = Math.max(Date.now() + ONE_WAY, last);
      last = at;
      setTimeout(() => to.writable && to.write(chunk), at - Date.now());
    });
    from.on('close', () => setTimeout(() => to.destroy(), ONE_WAY));
    from.on('error', () => to.destroy());
  };
  delay(client, upstream);
  delay(upstream, client);
});
proxy.listen(PROXY, '127.0.0.1');

await new Promise((resolve, reject) => {
  const build = spawn(
    process.execPath,
    [vite, 'build', '--mode', 'perf', '--outDir', 'dist-perf', '--logLevel', 'warn'],
    { cwd: web, stdio: 'inherit' },
  );
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite build: ${code}`))));
});
run([path.join(root, 'apps/server/dist/main.js')], {
  PORT: String(SERVER),
  HOST: '127.0.0.1',
  LOG_LEVEL: 'warn',
  RICOCHET_BOTS: '12',
});
run(
  [vite, 'preview', '--outDir', 'dist-perf', '--port', String(PREVIEW), '--strictPort'],
  { RICOCHET_SERVER: `http://127.0.0.1:${PROXY}` },
  web,
);
const PAGE = `http://127.0.0.1:${PREVIEW}/`;
await until(async () => (await fetch(`http://127.0.0.1:${SERVER}/health`)).ok, 15_000, 'server');
await until(async () => (await fetch(PAGE)).ok, 15_000, 'preview');

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Join, and wait for the own tank alive, unshielded and loaded. */
async function join(p) {
  await p.goto(PAGE);
  await p.fill('#name', 'feel');
  await p.click('#join button');
  await p.waitForFunction(() => window.__ricochet?.client?.state.kind === 'live', null, {
    timeout: 30_000,
  });
}
const ready = (p) =>
  p.waitForFunction(
    () => {
      const h = window.__ricochet;
      const v = h.client.latest;
      const me = v?.tanks.find((t) => t.id === h.client.you);
      return me?.alive && v.self.shield === 0 && v.self.reload === 0 && v.self.shells < 3;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );

await join(page);

/** Frames, at the page's own rate, from an event fired just after a frame to the first frame
 * that shows its effect. Each trial starts from a standing, loaded tank. */
async function frames(fire, keyCode) {
  await ready(page);
  return page.evaluate(
    async ({ fire, keyCode }) => {
      const h = window.__ricochet;
      const game = h.view.game;
      const frame = () => new Promise((r) => game.events.once('postrender', r));
      await frame();
      await frame();
      const me0 = h.picture.me;
      const own0 = new Set(h.picture.shells.filter((s) => s.id < 0).map((s) => s.id));
      if (fire) {
        document
          .getElementById('stage')
          .dispatchEvent(
            new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, bubbles: true }),
          );
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: keyCode }));
      }
      let n = 0;
      for (; n < 30; n++) {
        await frame();
        const p = h.picture;
        if (fire && p.shells.some((s) => s.id < 0 && !own0.has(s.id))) break;
        if (!fire && p.me && me0 && Math.hypot(p.me.x - me0.x, p.me.y - me0.y) > 0.5) break;
      }
      window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', button: 0 }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: keyCode }));
      return n + 1;
    },
    { fire, keyCode },
  );
}
const keys = [];
const presses = [];
const codes = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
for (let i = 0; i < 20; i++) {
  keys.push(await frames(false, codes[i % 4]));
  await page.waitForTimeout(300);
  presses.push(await frames(true, 'Space'));
  await page.waitForTimeout(400);
}

// ── 3. the schemes ──
const schemes = await page.evaluate(async () => {
  const h = window.__ricochet;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pos = () => (h.picture.me ? { x: h.picture.me.x, y: h.picture.me.y } : null);
  const out = {};
  // Touch: the move stick at the bottom left, pushed right; the aim stick bottom right, pushed up.
  const W = innerWidth;
  const H = innerHeight;
  const touch = (type, id, x, y) =>
    window.dispatchEvent(
      new PointerEvent(type, {
        pointerType: 'touch',
        pointerId: id,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
  const a = pos();
  const shots0 = h.client.stats().shots.predicted;
  touch('pointerdown', 11, 120, H - 120);
  touch('pointermove', 11, 200, H - 120);
  touch('pointerdown', 12, W - 120, H - 120);
  touch('pointermove', 12, W - 120, H - 200);
  await wait(1200);
  const b = pos();
  out.touch = {
    sticksShown: !document.getElementById('sticks').hidden,
    moved: a && b ? Math.round(Math.hypot(b.x - a.x, b.y - a.y)) : null,
    fired: h.client.stats().shots.predicted - shots0,
  };
  touch('pointerup', 11, 200, H - 120);
  touch('pointerup', 12, W - 120, H - 200);
  // A gamepad: the standard mapping, the left stick left, the right trigger held.
  const pad = {
    connected: true,
    mapping: 'standard',
    id: 'test pad',
    axes: [-1, 0, 0, 1],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 7, value: i === 7 ? 1 : 0 })),
  };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  const c = pos();
  const shots1 = h.client.stats().shots.predicted;
  await wait(1200);
  const d = pos();
  out.pad = {
    sticksHidden: document.getElementById('sticks').hidden,
    moved: c && d ? Math.round(Math.hypot(d.x - c.x, d.y - c.y)) : null,
    fired: h.client.stats().shots.predicted - shots1,
  };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
  return out;
});

// ── 4. minutes against bots ──
await page.evaluate(() => {
  const h = window.__ricochet;
  const log = { drawnHits: [], serverHits: new Set(), ownGone: [], ownSeen: new Map() };
  window.__feel = log;
  h.client.onEvents((events) => {
    for (const e of events) if (e.type === 'hit') log.serverHits.add(`${e.shell}:${e.victim}`);
  });
  const game = h.view.game;
  game.events.on('postrender', () => {
    const p = h.picture;
    for (const e of p.effects) {
      if (e.kind === 'hit') log.drawnHits.push(`${e.shell}:${e.victim}`);
      if (e.kind === 'end' || e.kind === 'fizzle' || e.kind === 'hit') log.lastEnd = e;
    }
    // Every own shell that stops being drawn: what ended it, if anything did.
    const now = new Set();
    for (const s of p.shells) {
      if (s.owner !== h.client.you) continue;
      now.add(s.id);
      log.ownSeen.set(s.id, s);
    }
    for (const [id, s] of log.ownSeen) {
      if (now.has(id)) continue;
      const ended = p.effects.some(
        (e) =>
          (e.kind === 'end' || e.kind === 'fizzle' || e.kind === 'hit') &&
          Math.hypot(e.x - s.x, e.y - s.y) < 2000,
      );
      const near = [...p.others].some((t) => t.alive && Math.hypot(t.x - s.x, t.y - s.y) < 300);
      log.ownGone.push({ ended, near });
      log.ownSeen.delete(id);
    }
  });
});
const drive = setInterval(() => {
  const k = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const a = k[Math.floor(Math.random() * 4)];
  page
    .evaluate((a) => {
      for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD'])
        window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: a }));
      document
        .getElementById('stage')
        .dispatchEvent(
          new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, bubbles: true }),
        );
    }, a)
    .catch(() => {});
}, 700);
for (let m = 1; m <= MINUTES; m++) {
  await page.waitForTimeout(60_000);
  console.error(`minute ${m}`);
}
clearInterval(drive);
const played = await page.evaluate(() => {
  const log = window.__feel;
  const h = window.__ricochet;
  const unmatched = log.drawnHits.filter((k) => !log.serverHits.has(k));
  return {
    drawnHits: log.drawnHits.length,
    serverHits: log.serverHits.size,
    drawnWithoutServerHit: unmatched.length,
    ownShellsGone: log.ownGone.length,
    goneUnexplained: log.ownGone.filter((g) => !g.ended).length,
    goneNearTankUnexplained: log.ownGone.filter((g) => !g.ended && g.near).length,
    shots: h.client.stats().shots,
    state: h.client.state.kind,
  };
});

const q = (xs, f) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];
console.log(
  JSON.stringify(
    {
      oneWayMs: ONE_WAY,
      keyFrames: { all: keys, p50: q(keys, 0.5), max: Math.max(...keys) },
      pressFrames: { all: presses, p50: q(presses, 0.5), max: Math.max(...presses) },
      schemes,
      minutes: MINUTES,
      played,
      errors: errors.slice(0, 5),
    },
    null,
    2,
  ),
);
await browser.close();
proxy.close();
stop();
process.exit(0);
