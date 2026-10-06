import { expect, test } from '@playwright/test';
import { alive, join, keyToMotion, seen } from './support.js';

/**
 * ROADMAP P1's done-when, as a stranger meets it: open the link, play against the bots, turn on the
 * ghost, break the network from the lab, and watch the tank stay under the thumb — in under two
 * minutes. Through the page alone, so it runs unchanged against the live demo
 * (`E2E_BASE_URL=https://… pnpm e2e:live`) as against the local server.
 */

test('a stranger: bots to play, the ghost, 300 ms, the prediction off and on, a dropped socket', async ({
  page,
}) => {
  const began = Date.now();
  await join(page, 'Stranger');

  // Bots to play against: the room is never empty.
  await expect
    .poll(async () => (await seen(page)).others.length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  // The lab: the ghost on, 300 ms more round trip.
  await page.click('#lab-open');
  await page.check('#lab-ghost');
  await page.check('input[name="latency"][value="300"]');
  await expect.poll(async () => (await seen(page)).ghosts, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate((): number => Reflect.get(window, '__ricochet').client.stats().rttMs ?? 0),
      {
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(290);

  // Predicted, the tank answers on the next frame; unpredicted, a round trip later; then on again.
  await alive(page);
  const on = await keyToMotion(page, 'KeyD');
  expect(on.frames).toBeLessThanOrEqual(2);
  await page.uncheck('#lab-predict');
  await alive(page);
  const off = await keyToMotion(page, 'KeyA');
  expect(off.ms).toBeGreaterThan(250);
  await page.check('#lab-predict');
  await alive(page);
  const again = await keyToMotion(page, 'KeyS');
  expect(again.frames).toBeLessThanOrEqual(2);

  // A dropped socket comes back to the same tank.
  const you = (await seen(page)).you;
  await page.click('#lab-drop');
  await expect
    .poll(async () => seen(page), { timeout: 15_000 })
    .toMatchObject({
      state: 'live',
      resumed: true,
      you,
    });
  await page.check('input[name="latency"][value="0"]');

  console.log(
    `stranger: ${((Date.now() - began) / 1000).toFixed(1)} s · key ${on.frames} frame(s) predicted, ${Math.round(off.ms)} ms not, ${again.frames} again`,
  );
  expect(Date.now() - began).toBeLessThan(120_000);
});
