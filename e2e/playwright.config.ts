import { defineConfig, devices } from '@playwright/test';

/**
 * Browser suites (`pnpm e2e`). At C1 one: `determinism.spec.ts`, the simulation replayed in each of
 * the three engines a player may bring. P1 adds the game's own E2E here.
 */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
