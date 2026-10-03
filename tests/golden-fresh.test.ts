import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lint-runner.js';

/**
 * The direction table in `@ricochet/geom` is only trustworthy if nobody edited it by hand. This
 * reruns the script that generates it and requires its output, byte for byte — which is also why
 * the file is excluded from Prettier.
 */
describe('the direction table is what its generator prints', () => {
  it('matches golden/directions.py exactly', () => {
    const geom = path.join(ROOT, 'packages/geom');
    const printed = execFileSync('python3', ['golden/directions.py'], {
      cwd: geom,
      encoding: 'utf8',
    });
    const committed = readFileSync(path.join(geom, 'src/directions.ts'), 'utf8');
    expect(committed).toBe(printed);
  });
});
