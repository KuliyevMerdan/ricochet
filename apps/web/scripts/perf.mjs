// ROADMAP C1 "Done when", measured: `pnpm --filter @ricochet/web perf` (after `pnpm build`).
//
// The minified page behind `vite preview` and the built server behind it, in Chromium as a phone —
// 375×812, DPR 3 (the page draws at 2), CPU throttled 4× — and:
//
//   1. stress: `?stress`, twelve tanks and thirty-six shells with every effect, no server — every
//      frame's interval and the game loop's work on the main thread;
//   2. hidden: the same page made hidden — frames rendered while it is, and after it is back;
//   3. live: the real game against eleven bots for RICOCHET_PERF_MINUTES (10), driving and firing —
//      the heap after a forced GC every minute, and the frames.
//
// Needs Playwright's Chromium. RICOCHET_PERF_GPU=0 draws on SwiftShader (the CPU) instead of the
// machine's GPU; RICOCHET_PERF_THROTTLE changes the slowdown.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const web = path.join(root, 'apps/web');
const vite = path.join(web, 'node_modules/vite/bin/vite.js');
const env = process.env;
const MINUTES = Number(env.RICOCHET_PERF_MINUTES ?? 10);
const SERVER = 8096;
const PREVIEW = 4196;

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
  RICOCHET_BOTS: '12',
});
run(
  [vite, 'preview', '--outDir', 'dist-perf', '--port', String(PREVIEW), '--strictPort'],
  {
    RICOCHET_SERVER: `http://127.0.0.1:${SERVER}`,
  },
  web,
);
const PAGE = `http://127.0.0.1:${PREVIEW}/`;
await until(async () => (await fetch(`http://127.0.0.1:${SERVER}/health`)).ok, 15_000, 'server');
await until(async () => (await fetch(PAGE)).ok, 15_000, 'preview');

// The machine's GPU, as a phone's browser has one; RICOCHET_PERF_GPU=0 draws on SwiftShader, on
// the (throttled) CPU — far slower than any phone's GPU, a bound and not a profile.
const gpuArgs = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const cpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: env.RICOCHET_PERF_GPU === '0' ? cpuArgs : gpuArgs,
});
const phone = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await phone.newPage();
const cdp = await phone.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(env.RICOCHET_PERF_THROTTLE ?? 4) });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/** Install the frame probe: every rAF interval, and each game step's work from its pre-step to its
 * post-render on the main thread — the browser sets the interval, the work is ours. */
const probe = () =>
  page.evaluate(() => {
    const { game } = window.__ricochet.view;
    const p = { intervals: [], work: [], renders: 0, last: 0, start: 0, on: true };
    window.__probe = p;
    game.events.on('prestep', () => (p.start = performance.now()));
    game.events.on('postrender', () => {
      p.renders += 1;
      if (p.on && p.start) p.work.push(performance.now() - p.start);
    });
    const loop = (t) => {
      if (p.on && p.last) p.intervals.push(t - p.last);
      p.last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
const take = () =>
  page.evaluate(() => {
    const p = window.__probe;
    const out = { intervals: p.intervals, work: p.work };
    p.intervals = [];
    p.work = [];
    return out;
  });
const q = (xs, f) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2) : null;
};
const summary = ({ intervals, work }) => ({
  frames: intervals.length,
  fps: +((1000 * intervals.length) / intervals.reduce((a, b) => a + b, 0)).toFixed(1),
  interval: { p50: q(intervals, 0.5), p95: q(intervals, 0.95), p99: q(intervals, 0.99) },
  longFrames: intervals.filter((i) => i > 25).length,
  work: { p50: q(work, 0.5), p95: q(work, 0.95), p99: q(work, 0.99), max: q(work, 1) },
  workOver16_7: work.filter((w) => w > 1000 / 60).length,
});
const heap = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return +(usedSize / 1e6).toFixed(2);
};
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const d = c?.getExtension('WEBGL_debug_renderer_info');
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});

// ── 1. stress ──
const opened = Date.now();
await page.goto(`${PAGE}?stress`);
await page.waitForFunction(() => window.__ricochet?.view?.stats().frames > 10, null, {
  timeout: 60_000,
});
const bootMs = Date.now() - opened;
await probe();
await page.waitForTimeout(3000);
await take();
await page.waitForTimeout(20_000);
const stress = summary(await take());
const drawn = await page.evaluate(() => {
  const scene = window.__ricochet.view.game.scene.getScene('arena');
  const list = scene.children.list;
  return { displayList: list.length };
});

// ── 2. hidden ──
const hidden = await page.evaluate(async () => {
  const p = window.__probe;
  const set = (hide) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hide });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hide ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  set(true);
  await new Promise((r) => setTimeout(r, 200));
  const before = p.renders;
  await new Promise((r) => setTimeout(r, 3000));
  const whileHidden = p.renders - before;
  set(false);
  await new Promise((r) => setTimeout(r, 1000));
  return { rendersWhileHidden: whileHidden, rendersAfter: p.renders - before - whileHidden };
});

// ── 3. live ──
await page.goto(PAGE);
await page.fill('#name', 'perf');
await page.click('#join button');
await page.waitForFunction(() => window.__ricochet?.client?.state.kind === 'live', null, {
  timeout: 30_000,
});
await page.waitForTimeout(2000);
await probe();
const drive = setInterval(() => {
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const a = keys[Math.floor(Math.random() * 4)];
  const b = keys[Math.floor(Math.random() * 4)];
  page
    .evaluate(
      ([a, b]) => {
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD'])
          window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: a }));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: b }));
        const stage = document.getElementById('stage');
        stage?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      },
      [a, b],
    )
    .catch(() => {});
}, 800);
const heaps = [await heap()];
const liveFrames = { intervals: [], work: [] };
const shellsSeen = [];
for (let m = 1; m <= MINUTES; m++) {
  for (let s = 0; s < 6; s++) {
    await page.waitForTimeout(10_000);
    const t = await take();
    liveFrames.intervals.push(...t.intervals);
    liveFrames.work.push(...t.work);
    shellsSeen.push(
      await page.evaluate(() => {
        const f = window.__ricochet.client.frame(performance.now());
        return { tanks: f.others.length + (f.me ? 1 : 0), shells: f.shells.length };
      }),
    );
  }
  heaps.push(await heap());
  console.error(`minute ${m}: heap ${heaps.at(-1)} MB`);
}
clearInterval(drive);
const live = {
  ...summary(liveFrames),
  state: await page.evaluate(() => window.__ricochet.client.state.kind),
  stats: await page.evaluate(() => window.__ricochet.client.stats()),
  inView: {
    tanksMax: Math.max(...shellsSeen.map((s) => s.tanks)),
    shellsMax: Math.max(...shellsSeen.map((s) => s.shells)),
  },
  heapMB: heaps,
};

console.log(
  JSON.stringify(
    { gl, bootMs, stress, drawn, hidden, live, minutes: MINUTES, errors: errors.slice(0, 5) },
    null,
    2,
  ),
);
await browser.close();
stop();
process.exit(0);
