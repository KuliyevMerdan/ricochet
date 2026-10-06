import { RANGE, cellAt, dirTo, fieldTo, gridOf, shotAt, waypoint } from '@ricochet/bots';
import { ARENA_0 } from '@ricochet/protocol';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { alive, anyKeyToMotion, join, pad, seen } from './support.js';

/**
 * ROADMAP P1's two players (against a local server with no bots — `playwright.config.ts`): two
 * browsers join one room; each sees the other move; one shoots the other dead and both see the
 * kill; the lab's 300 ms on one leaves its own tank answering on the next frame and the other's view
 * of it smooth; a dropped socket comes back to the same tank. Every action is a key, the mouse or a
 * lab button.
 */

test.describe.configure({ mode: 'serial' });

const grid = gridOf(ARENA_0);

async function player(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // Every kill a page is told of, for the suite to read.
    Reflect.set(window, '__kills', []);
  });
  await join(page, name);
  await page.evaluate(() => {
    const h = Reflect.get(window, '__ricochet');
    h.client.onEvents((events: { type: string; killer?: number; victim?: number }[]) => {
      for (const e of events) if (e.type === 'kill') Reflect.get(window, '__kills').push(e);
    });
  });
  return page;
}

const kills = (page: Page) =>
  page.evaluate((): { type: string; killer: number; victim: number }[] =>
    Reflect.get(window, '__kills'),
  );

/** How far a tank has gone from where it was, eighths. */
const gone = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) =>
  a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;

const STILL = { x: 0, y: 0 };

/** The straight line a shell would fly from `me` to a tank at `to`, if no wall is in its way — the
 * bots' own trace. A shell's line, not a tank's path: a tank parked against a wall is in the clear
 * for a shot, though another tank could not drive to its centre. */
const lineOfFire = (me: { x: number; y: number }, to: { x: number; y: number }) =>
  shotAt(ARENA_0, me, to, STILL, false);

/** Drive `page`'s tank round the walls toward `to` (eighths) — the bots' own distance field — until
 * it has a clear line of fire to it within `near`. */
async function approach(page: Page, to: { x: number; y: number }, near: number): Promise<void> {
  const field = fieldTo(grid, cellAt(to.x, to.y));
  let there = false;
  for (let i = 0; i < 400 && !there; i++) {
    const s = await seen(page);
    if (!s.me) continue;
    const d = Math.hypot(to.x - s.me.x, to.y - s.me.y);
    there = d < near && lineOfFire(s.me, to) !== null;
    if (there) break;
    const next = waypoint(grid, field, s.me.x, s.me.y) ?? to;
    await pad(page, dirTo(next.x - s.me.x, next.y - s.me.y));
    await page.waitForTimeout(100);
  }
  await pad(page, null);
  const at = (await seen(page)).me;
  expect(there, `drove from ${JSON.stringify(at)} toward ${JSON.stringify(to)}`).toBe(true);
}

/** Drive `page`'s tank round the walls toward `to` for `ms`, whether or not it gets there. */
async function drive(page: Page, to: { x: number; y: number }, ms: number): Promise<void> {
  const field = fieldTo(grid, cellAt(to.x, to.y));
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await seen(page);
    if (s.me) {
      const next = waypoint(grid, field, s.me.x, s.me.y) ?? to;
      await pad(page, dirTo(next.x - s.me.x, next.y - s.me.y));
    }
    await page.waitForTimeout(100);
  }
  await pad(page, null);
}

test('two players: each sees the other move, one kills the other, the lab, a dropped socket', async ({
  browser,
}) => {
  const a = await player(browser, 'Alpha');
  const b = await player(browser, 'Bravo');
  await alive(a);
  await alive(b);
  const ida = (await seen(a)).you;
  const home = (await seen(a)).me;
  if (!home) throw new Error('Alpha has no tank');
  const idb = (await seen(b)).you;
  expect(ida).not.toBe(idb);

  // ── each sees the other move ──
  // Alpha drives across the arena to Bravo, and Bravo watches it come.
  const bravoAt = (await seen(b)).me;
  if (!bravoAt) throw new Error('Bravo has no tank');
  await approach(a, bravoAt, 3200);
  const inB = async () => (await seen(b)).others.find((t) => t.id === ida) ?? null;
  const inA = async () => (await seen(a)).others.find((t) => t.id === idb) ?? null;
  await expect.poll(inB, { timeout: 10_000 }).not.toBeNull();
  await expect.poll(inA, { timeout: 10_000 }).not.toBeNull();
  // Bravo drives a little; Alpha sees it go. Alpha too; Bravo sees it.
  const before = await inA();
  await pad(b, 768);
  await b.waitForTimeout(500);
  await pad(b, null);
  await expect.poll(async () => gone(await inA(), before)).toBeGreaterThan(200);
  const alphaBefore = await inB();
  await pad(a, 0);
  await a.waitForTimeout(500);
  await pad(a, null);
  await expect.poll(async () => gone(await inB(), alphaBefore)).toBeGreaterThan(200);

  // ── one shoots the other dead ──
  const target = (await seen(b)).me;
  if (!target) throw new Error('Bravo has no tank');
  await approach(a, target, Math.min(RANGE, 3600));
  for (let shot = 0; shot < 40; shot++) {
    if ((await kills(a)).some((k) => k.victim === idb)) break;
    const t = (await seen(b)).me;
    const me = (await seen(a)).me;
    if (!t || !me) break;
    // The right stick on Bravo, the trigger pulled a moment, then let go to reload.
    const aim = lineOfFire(me, t)?.dir ?? dirTo(t.x - me.x, t.y - me.y);
    await pad(a, null, aim, false);
    await a.waitForTimeout(100);
    await pad(a, null, aim, true);
    await a.waitForTimeout(100);
    await pad(a, null, aim, false);
    await a.waitForTimeout(300);
  }
  await pad(a, null); // the sticks let go: the keys drive again
  const kill = { type: 'kill', killer: ida, victim: idb };
  await expect.poll(() => kills(a), { timeout: 10_000 }).toContainEqual(kill);
  await expect.poll(() => kills(b), { timeout: 10_000 }).toContainEqual(kill);
  await expect(b.locator('#death-by')).toHaveText('Destroyed by Alpha');
  await expect(b.locator('#replay')).toBeVisible();

  // ── the lab's 300 ms on Alpha: its own tank on the next frame, its motion smooth to Bravo ──
  await alive(b);
  await a.click('#lab-open');
  await a.check('input[name="latency"][value="300"]');
  await expect
    .poll(() => a.evaluate(() => Reflect.get(window, '__ricochet').client.stats().rttMs ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(290);
  await alive(a);
  expect((await anyKeyToMotion(a)).frames).toBeLessThanOrEqual(2);
  // Bravo is back elsewhere: Alpha finds it again, then drives off home while Bravo watches —
  // Bravo's picture of it, frame by frame, never jumps.
  const again = (await seen(b)).me;
  if (!again) throw new Error('Bravo has no tank');
  await approach(a, again, 3200);
  // Speeds, not steps, so a slow machine's long frames do not count as jumps: eighths a second.
  const speeds = b.evaluate(async (id) => {
    const h = Reflect.get(window, '__ricochet');
    const game = h.view.game;
    const frame = () => new Promise((r) => game.events.once('postrender', r));
    const out: number[] = [];
    let last: { x: number; y: number; at: number } | null = null;
    const end = performance.now() + 2000;
    while (performance.now() < end) {
      await frame();
      const at = performance.now();
      const t = h.picture.others.find((o: { id: number }) => o.id === id);
      if (t && last && at > last.at)
        out.push(Math.hypot(t.x - last.x, t.y - last.y) / ((at - last.at) / 1000));
      last = t ? { x: t.x, y: t.y, at } : null;
    }
    return out;
  }, ida);
  await drive(a, home, 2000);
  const moving = (await speeds).filter((v) => v > 0);
  expect(moving.length).toBeGreaterThan(10);
  // Interpolated, the drawn speed is the tank's own, 59 eighths a tick; drawn snapshot to snapshot,
  // it would be nothing, then twice that — half the frames at 60 Hz past half again its speed. One
  // frame in fifty may be: a snapshot later than the delay allows is extrapolated a tick and put
  // right when it lands (netcode `Timeline`), and a CI runner's frames are not a quiet laptop's.
  const fast = moving.filter((v) => v > 1.5 * 59 * 30);
  expect(
    fast.length,
    `frames past 1.5× of ${moving.length}: ${fast.map(Math.round)}`,
  ).toBeLessThanOrEqual(Math.max(1, Math.floor(moving.length / 50)));

  // ── a dropped socket comes back to the same tank ──
  await a.evaluate(() => {
    const states: string[] = [];
    Reflect.set(window, '__states', states);
    Reflect.get(window, '__ricochet').client.onState((s: { kind: string }) => states.push(s.kind));
  });
  await a.click('#lab-drop');
  await expect
    .poll(() => a.evaluate((): string[] => Reflect.get(window, '__states')), { timeout: 15_000 })
    .toEqual(['reconnecting', 'connecting', 'joining', 'live']);
  await expect
    .poll(async () => seen(a), { timeout: 15_000 })
    .toMatchObject({
      state: 'live',
      resumed: true,
      you: ida,
    });
});
