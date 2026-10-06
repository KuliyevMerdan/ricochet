import { defineConfig, devices } from '@playwright/test';

/**
 * Browser suites (`pnpm e2e`), two kinds:
 *
 * - **The engines** (`determinism.spec.ts`, C1): the simulation's pinned run in each of the three
 *   engines a player may bring.
 * - **The game** (P1), in Chromium against the built server serving the built page from its own
 *   origin — the shape the image has (ADR-0004): `duel.spec.ts` on a server with no bots, two
 *   players finding and fighting each other; `stranger.spec.ts` on one with bots, the done-when as a
 *   visitor meets it.
 *
 * `E2E_BASE_URL=https://… pnpm e2e:live` runs only the stranger, against any deployed copy — it
 * touches nothing but the page. At a pixel ratio of 1: the suites test behaviour, not pixels, and a
 * CI runner draws WebGL in software.
 */
const live = process.env['E2E_BASE_URL'];
const DUEL = 8191;
const STRANGER = 8192;

const server = (port: number, bots: number) => ({
  command: 'node apps/server/dist/main.js',
  cwd: '..',
  url: `http://127.0.0.1:${port}/ready`,
  timeout: 30_000,
  reuseExistingServer: false,
  env: {
    NODE_ENV: 'production',
    RICOCHET_LAB: 'on',
    RICOCHET_BOTS: String(bots),
    RICOCHET_STATIC_DIR: 'apps/web/dist',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: 'warn',
  },
});

const game = {
  ...devices['Desktop Chrome'],
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 800 },
};

export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],
  outputDir: '../test-results',
  use: { trace: 'retain-on-failure' },
  projects: live
    ? [{ name: 'live', testMatch: 'stranger.spec.ts', use: { ...game, baseURL: live } }]
    : [
        {
          name: 'chromium',
          testMatch: 'determinism.spec.ts',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'firefox',
          testMatch: 'determinism.spec.ts',
          use: { ...devices['Desktop Firefox'] },
        },
        { name: 'webkit', testMatch: 'determinism.spec.ts', use: { ...devices['Desktop Safari'] } },
        {
          name: 'duel',
          testMatch: 'duel.spec.ts',
          use: { ...game, baseURL: `http://127.0.0.1:${DUEL}` },
        },
        {
          name: 'stranger',
          testMatch: 'stranger.spec.ts',
          use: { ...game, baseURL: `http://127.0.0.1:${STRANGER}` },
        },
      ],
  ...(live ? {} : { webServer: [server(DUEL, 0), server(STRANGER, 6)] }),
});
