// FIXTURE — must NOT be flagged: sim's whole allow-list, through entry points.
import { decode } from '@ricochet/protocol';
import { vec } from '@ricochet/geom';

export const ok = [decode, vec];
