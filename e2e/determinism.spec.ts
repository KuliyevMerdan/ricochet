import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/**
 * CLAUDE.md § The invariant that makes prediction exact, measured: `sim` computes the same bits in
 * every engine. The soak pins 5,000 ticks of a seeded room of twelve to a hash in Node (V8); here
 * the same run, bundled as it would be for a page, plays in Chromium (V8 again, through the
 * browser), Firefox (SpiderMonkey) and WebKit (JavaScriptCore) — and each must end in the same
 * world, byte for byte. A `Math.sin` slipped into `sim`, or a rounding that differs by an ulp,
 * fails here first.
 */
const PINNED = '68b4d373';

let script = '';

test.beforeAll(async () => {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: fileURLToPath(new URL('./determinism/entry.ts', import.meta.url)),
        formats: ['iife'],
        name: 'determinism',
      },
    },
  });
  const outputs = Array.isArray(out) ? out : [out];
  for (const o of outputs) {
    if (!('output' in o)) continue;
    for (const chunk of o.output) if (chunk.type === 'chunk') script = chunk.code;
  }
  expect(script.length).toBeGreaterThan(1000);
});

test('the pinned 5,000-tick run ends in the same world in this engine', async ({ page }) => {
  await page.setContent('<!doctype html><title>determinism</title>');
  await page.addScriptTag({ content: script });
  const hash = await page.evaluate(() => {
    const replay: unknown = Reflect.get(globalThis, 'replay');
    if (typeof replay !== 'function') throw new Error('the bundle did not load');
    const h: unknown = replay();
    return String(h);
  });
  expect(hash).toBe(PINNED);
});
