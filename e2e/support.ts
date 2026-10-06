import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * What the game's E2E suites share (ROADMAP P1). They act on the page as a player does — keys, the
 * mouse, the lab's buttons — and read `window.__ricochet` (the view, the client, the last picture)
 * only to measure what the player would see.
 */

/** The page's measurement hooks, as the suites read them. */
export interface Seen {
  readonly you: number;
  readonly state: string;
  readonly resumed: boolean;
  readonly alive: boolean;
  readonly me: { x: number; y: number } | null;
  readonly others: { id: number; x: number; y: number; alive: boolean }[];
  readonly ghosts: number;
}

export async function seen(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const h = Reflect.get(window, '__ricochet');
    const c = h.client;
    const v = c.latest;
    const p = h.picture;
    const own = v?.tanks.find((t: { id: number }) => t.id === c.you);
    return {
      you: c.you,
      state: c.state.kind,
      resumed: c.state.kind === 'live' ? c.state.resumed : false,
      alive: own?.alive ?? false,
      me: p?.me ? { x: p.me.x, y: p.me.y } : null,
      others: (p?.others ?? []).map((t: { id: number; x: number; y: number; alive: boolean }) => ({
        id: t.id,
        x: t.x,
        y: t.y,
        alive: t.alive,
      })),
      ghosts: p?.ghosts.length ?? 0,
    };
  });
}

/** Through the page's own name form, to live. */
export async function join(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.fill('#name', name);
  await page.click('#join button');
  await expect.poll(async () => (await seen(page)).state, { timeout: 60_000 }).toBe('live');
}

/** Until the own tank is alive, unshielded and standing still. */
export async function alive(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const h = Reflect.get(window, '__ricochet');
      const v = h.client.latest;
      const me = v?.tanks.find((t: { id: number }) => t.id === h.client.you);
      return Boolean(me?.alive) && v.self.shield === 0;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );
}

/**
 * A key pressed just after a frame: how many frames until the own tank is drawn moved, and how
 * long. Frames say "on the next one" whatever the machine's rate; milliseconds say "a round trip
 * later" whatever the frames.
 */
export async function keyToMotion(
  page: Page,
  code: string,
  most = 600,
): Promise<{ frames: number; ms: number }> {
  return page.evaluate(
    async ({ code, most }) => {
      const h = Reflect.get(window, '__ricochet');
      const game = h.view.game;
      const frame = () => new Promise((r) => game.events.once('postrender', r));
      await frame();
      await frame();
      const me0 = h.picture.me;
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      let n = 0;
      for (; n < most; n++) {
        await frame();
        const p = h.picture.me;
        if (p && me0 && Math.hypot(p.x - me0.x, p.y - me0.y) > 0.5) break;
      }
      const ms = performance.now() - t0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      return { frames: n + 1, ms };
    },
    { code, most },
  );
}

/** `keyToMotion` on the first of the four keys whose way is not a wall: a tank pressed against
 * one does not move, predicted or not, and says nothing about the prediction. */
export async function anyKeyToMotion(page: Page): Promise<{ frames: number; ms: number }> {
  let last = { frames: Infinity, ms: Infinity };
  for (const code of ['KeyD', 'KeyA', 'KeyS', 'KeyW']) {
    last = await keyToMotion(page, code, 20);
    if (last.frames <= 20) return last;
  }
  return last;
}

/**
 * A gamepad in the standard mapping, as the page reads one: the left stick drives toward `move`,
 * the right aims at `aim` (directions in 1,024ths of a turn; `null` at rest), the right trigger
 * fires. The Gamepad API cannot be driven from outside a page, so the pad is the page's own
 * `navigator.getGamepads`, answered from what the suite last set.
 */
export async function pad(
  page: Page,
  move: number | null,
  aim: number | null = null,
  fire = false,
): Promise<void> {
  await page.evaluate(
    ({ move, aim, fire }) => {
      const axis = (d: number | null, f: (a: number) => number) =>
        d === null ? 0 : f((d / 1024) * 2 * Math.PI);
      const state = {
        connected: true,
        mapping: 'standard',
        id: 'e2e pad',
        axes: [
          axis(move, Math.cos),
          axis(move, Math.sin),
          axis(aim, Math.cos),
          axis(aim, Math.sin),
        ],
        buttons: Array.from({ length: 17 }, (_, i) => ({
          pressed: fire && i === 7,
          value: fire && i === 7 ? 1 : 0,
        })),
      };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [state] });
    },
    { move, aim, fire },
  );
}
