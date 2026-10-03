// FIXTURE — must be rejected by `bots-deps`: a bot sees a snapshot, never the world.
import { step } from '@ricochet/sim';

export const leak = step;
