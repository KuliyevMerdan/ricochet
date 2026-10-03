import { describe, expect, it } from 'vitest';
import { eslint } from './lint-runner.js';

/**
 * Proves the purity rules fire, in every package they are meant to hold.
 *
 * `geom`, `protocol`, `sim` and `bots` take time as a parameter and randomness as a seed. Ambient
 * either anywhere in them destroys prediction and replay quietly — the tests keep passing, they stop
 * meaning anything — so the rule that forbids it is itself tested. One fixture per package, because
 * a package missing from the rule's list is the likeliest way for it to stop applying.
 */

describe.each(['geom', 'protocol', 'sim', 'bots'])('purity rules hold @ricochet/%s', (pkg) => {
  const messages = eslint(`config/fixtures/packages/${pkg}/src/impure.ts`);
  const syntax = messages.filter((m) => m.ruleId === 'no-restricted-syntax');

  it.each([
    ['Math.random()', 3, /seed carried in the world/],
    ['Date.now()', 4, /Time is a parameter/],
    ['new Date()', 5, /Time is a parameter/],
    ['performance.now()', 6, /Time is a parameter/],
  ])('rejects %s', (_label, line, expected) => {
    expect(syntax.find((m) => m.line === line)?.message).toMatch(expected);
  });

  it('rejects ambient config through process', () => {
    expect(messages.filter((m) => m.ruleId === 'no-restricted-globals').map((m) => m.line)).toEqual(
      [7],
    );
  });

  it('reports one violation per offending line and nothing else', () => {
    expect(syntax).toHaveLength(4);
  });
});

/**
 * Proves the exactness rules fire where the client's prediction and the server's world must agree
 * to the bit — and only there.
 */
describe.each(['geom', 'sim'])('exactness rules hold @ricochet/%s', (pkg) => {
  const lines = eslint(`config/fixtures/packages/${pkg}/src/inexact.ts`)
    .filter((m) => m.ruleId === 'no-restricted-syntax')
    .map((m) => m.line);

  it('rejects Math.sin, cos, atan2, pow, hypot and the ** operator', () => {
    expect(lines).toEqual([3, 4, 5, 6, 7, 8]);
  });
});

describe('exactness rules stay out of @ricochet/protocol', () => {
  it('leaves a codec its Math', () => {
    expect(eslint('config/fixtures/packages/protocol/src/inexact.ts')).toEqual([]);
  });
});
