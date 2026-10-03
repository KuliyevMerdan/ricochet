import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, runForJson } from './lint-runner.js';

/**
 * Proves the dependency rules fire.
 *
 * `pnpm lint:boundaries` scans the real workspace and (correctly) finds nothing — which says nothing
 * about whether the rules work. These are known-illegal imports that must each be rejected by a
 * named rule, and legal ones that must not be.
 */

const FIXTURES = path.join(ROOT, 'config/fixtures');
const CONFIG = path.join(ROOT, '.dependency-cruiser.cjs');

function ruleNamesFor(fixture: string): string[] {
  const report = runForJson(
    'depcruise',
    [fixture, '--config', CONFIG, '--output-type', 'json'],
    FIXTURES,
  ) as { summary: { violations: Array<{ rule: { name: string } }> } };
  return report.summary.violations.map((v) => v.rule.name);
}

describe('dependency boundaries', () => {
  it.each([
    ['packages/renderer/src/illegal-protocol.ts', 'renderer-deps'],
    ['packages/bots/src/illegal-sim.ts', 'bots-deps'],
    ['packages/sim/src/illegal-netcode.ts', 'sim-deps'],
    ['packages/sim/src/illegal-phaser.ts', 'phaser-stays-on-stage'],
    ['packages/sim/src/illegal-fs.ts', 'packages-no-node-builtins'],
    ['packages/sim/src/illegal-deep-import.ts', 'no-cross-package-deep-imports'],
    ['packages/netcode/src/illegal-ws.ts', 'packages-no-server-libs'],
    ['packages/netcode/src/illegal-react.ts', 'no-react'],
    ['packages/geom/src/illegal-slots-package.ts', 'no-siblings'],
    ['packages/geom/src/illegal-slots-path.ts', 'no-siblings'],
    ['packages/geom/src/illegal-crash-package.ts', 'no-siblings'],
    ['packages/geom/src/illegal-crash-path.ts', 'no-siblings'],
    ['packages/geom/src/illegal-blackjack-package.ts', 'no-siblings'],
    ['packages/geom/src/illegal-blackjack-path.ts', 'no-siblings'],
    ['apps/web/src/illegal-sim.ts', 'web-deps'],
    ['apps/server/src/illegal-web.ts', 'nothing-imports-apps'],
    ['apps/server/src/illegal-phaser.ts', 'phaser-stays-on-stage'],
    ['tools/bench/src/illegal-server.ts', 'bench-deps'],
    ['tools/bench/src/illegal-server.ts', 'nothing-imports-apps'],
    ['tools/load/src/illegal-sim.ts', 'load-deps'],
  ])('rejects %s — %s', (fixture, rule) => {
    expect(ruleNamesFor(fixture)).toContain(rule);
  });

  it.each([
    'packages/renderer/src/legal.ts',
    'packages/bots/src/legal.ts',
    'packages/sim/src/legal.ts',
    'packages/netcode/src/legal.ts',
    'apps/web/src/legal.ts',
    'apps/server/src/legal.ts',
  ])('accepts %s', (fixture) => {
    expect(ruleNamesFor(fixture)).toEqual([]);
  });
});
