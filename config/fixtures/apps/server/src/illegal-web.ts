// FIXTURE — must be rejected by `nothing-imports-apps`.
import { boot } from '@ricochet/web';

export const leak = boot;
