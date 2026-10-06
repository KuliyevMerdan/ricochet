// ROADMAP C3 "Done when", measured: `pnpm --filter @ricochet/web lab` (after `pnpm build`).
//
// The built page behind `vite preview`, the built server with the network lab on (development's
// default) and bots filling the room, and Chromium driving the page **through its DOM only**, as a
// stranger would — the clock running from the page's load:
//
//   1. join; open the lab; turn on the server ghost; add 300 ms;
//   2. a key with the prediction on, then off, then on again: frames from the keydown to the first
//      frame the own tank is drawn moved, and the ghost's distance behind it while it drives;
//   3. the stall and the drop: the snapshots' gap, the reconnect onto the same tank, the lab back on
//      the new socket;
//   4. a death: its replay shown, the shell that killed traced to the tank, from the views held.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const web = path.join(root, 'apps/web');
const vite = path.join(web, 'node_modules/vite/bin/vite.js');
const SERVER = 8099;
const PREVIEW = 4199;

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
  RICOCHET_LAB: 'on',
  RICOCHET_BOTS: '6',
});
run(
  [
    vite,
    'preview',
    '--outDir',
    'dist-perf',
    '--host',
    '127.0.0.1',
    '--port',
    String(PREVIEW),
    '--strictPort',
  ],
  { RICOCHET_SERVER: `http://127.0.0.1:${SERVER}` },
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

// ── 1. the stranger's steps, through the DOM ──
const loaded = Date.now();
await page.goto(PAGE);
await page.fill('#name', 'stranger');
await page.click('#join button');
await page.waitForFunction(() => window.__ricochet?.client?.state.kind === 'live', null, {
  timeout: 30_000,
});
await page.click('#lab-open');
await page.check('#lab-ghost');
await page.check('input[name="latency"][value="300"]');
// The link settles: the page's own measure of the round trip shows the 300 ms.
await page.waitForFunction(() => (window.__ricochet.client.stats().rttMs ?? 0) >= 290, null, {
  timeout: 15_000,
});

/** Frames from a keydown, fired just after a frame, to the first frame the own tank is drawn moved
 * — and, while the key is held, how far behind it the own ghost is drawn, units. */
async function drive(code) {
  await page.waitForFunction(
    () => {
      const h = window.__ricochet;
      const me = h.client.latest?.tanks.find((t) => t.id === h.client.you);
      return me?.alive;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );
  return page.evaluate(async (code) => {
    const h = window.__ricochet;
    const game = h.view.game;
    const frame = () => new Promise((r) => game.events.once('postrender', r));
    await frame();
    await frame();
    const me0 = h.picture.me;
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    let n = 0;
    for (; n < 120; n++) {
      await frame();
      const p = h.picture.me;
      if (p && me0 && Math.hypot(p.x - me0.x, p.y - me0.y) > 0.5) break;
    }
    // Held on, the ghost: the newest snapshot's own tank against the one drawn.
    let gap = 0;
    for (let i = 0; i < 30; i++) {
      await frame();
      const p = h.picture.me;
      const g = h.picture.ghosts.find((t) => t.id === h.client.you);
      if (p && g) gap = Math.max(gap, Math.hypot(p.x - g.x, p.y - g.y) / 8);
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    return { frames: n + 1, ghostUnits: Math.round(gap) };
  }, code);
}
const codes = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
const trials = async (label) => {
  const out = [];
  for (const code of codes) {
    out.push(await drive(code));
    await page.waitForTimeout(400);
  }
  return { label, frames: out.map((t) => t.frames), ghostUnits: out.map((t) => t.ghostUnits) };
};
const fps = await page.evaluate(async () => {
  const game = window.__ricochet.view.game;
  const t0 = performance.now();
  let n = 0;
  await new Promise((r) => {
    const count = () => {
      n++;
      if (performance.now() - t0 < 1000) game.events.once('postrender', count);
      else r();
    };
    game.events.once('postrender', count);
  });
  return n;
});
const predicted = await trials('prediction on');
await page.uncheck('#lab-predict');
const unpredicted = await trials('prediction off');
await page.check('#lab-predict');
const again = await trials('prediction on again');
const strangerSeconds = (Date.now() - loaded) / 1000;

// ── 3. the stall and the drop ──
const link = await page.evaluate(async () => {
  const c = window.__ricochet.client;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let last = c.latest?.tick;
  let prev = performance.now();
  let gap = 0;
  document.getElementById('lab-stall').click();
  const t0 = performance.now();
  while (performance.now() - t0 < 3500) {
    if (c.latest?.tick !== last) {
      gap = Math.max(gap, performance.now() - prev);
      prev = performance.now();
      last = c.latest?.tick;
    }
    await wait(5);
  }
  const you = c.you;
  const states = [];
  const off = c.onState((s) => states.push(s.kind));
  const d0 = performance.now();
  document.getElementById('lab-drop').click();
  while (!(c.state.kind === 'live' && states.length > 0) && performance.now() - d0 < 10_000)
    await wait(10);
  const back = performance.now() - d0;
  await wait(3000);
  off();
  return {
    stallGapMs: Math.round(gap),
    dropStates: states,
    backInMs: Math.round(back),
    sameTank: c.you === you && c.state.kind === 'live' && c.state.resumed,
    rttAfterMs: Math.round(c.stats().rttMs ?? 0),
  };
});

// ── 4. a death and its replay ──
await page.uncheck('#lab-predict');
await page.check('#lab-predict');
await page.check('input[name="latency"][value="0"]');
const death = await page.evaluate(async () => {
  const h = window.__ricochet;
  const c = h.client;
  // Drive about until a bot obliges; give up after three minutes.
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const driving = setInterval(() => {
    for (const k of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: keys[Math.floor(Math.random() * 4)] }),
    );
  }, 800);
  const killed = await new Promise((resolve) => {
    const off = c.onEvents((events) => {
      const k = events.find((e) => e.type === 'kill' && e.victim === c.you);
      if (k) {
        off();
        resolve(k);
      }
    });
    setTimeout(() => resolve(null), 180_000);
  });
  clearInterval(driving);
  for (const k of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
  if (!killed) return { died: false };
  await new Promise((r) => setTimeout(r, 300));
  const r = c.replay();
  const f = r?.fatal;
  const reach = 240;
  const victim = r?.where;
  return {
    died: true,
    self: killed.killer === killed.victim,
    shown: !document.getElementById('replay').hidden,
    caption: document.getElementById('replay-caption').textContent,
    seconds: r ? (r.to - r.from) / 30 : 0,
    traced: Boolean(f),
    bounced: Boolean(f?.bounce),
    hitFromEdgeUnits:
      f && victim
        ? Math.round(
            (Math.abs(Math.hypot(f.hit.x - victim.x, f.hit.y - victim.y) - reach) / 8) * 10,
          ) / 10
        : null,
  };
});

console.log(
  JSON.stringify(
    {
      fps,
      strangerSeconds,
      key: [predicted, unpredicted, again],
      link,
      death,
      errors: errors.slice(0, 5),
    },
    null,
    2,
  ),
);
await browser.close();
stop();
process.exit(0);
