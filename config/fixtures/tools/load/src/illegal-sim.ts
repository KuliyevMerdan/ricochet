// FIXTURE — must be rejected by `load-deps`: the load tool plays over the wire, as a client does.
import { step } from '@ricochet/sim';

export const leak = step;
