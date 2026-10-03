// FIXTURE — must be rejected by `bench-deps` and `nothing-imports-apps`: the bench measures the
// sim, not the server.
import { Room } from '@ricochet/server';

export const leak = Room;
