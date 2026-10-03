// FIXTURE — must be rejected by `packages-no-node-builtins`: sim runs in the page too.
import { readFileSync } from 'node:fs';

export const leak = readFileSync;
