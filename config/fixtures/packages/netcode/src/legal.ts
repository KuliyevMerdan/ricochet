// FIXTURE — must NOT be flagged: netcode predicts with sim, reads the wire and the geometry.
import { stepTank } from '@ricochet/sim';
import { decode } from '@ricochet/protocol';
import { vec } from '@ricochet/geom';

export const ok = [stepTank, decode, vec];
