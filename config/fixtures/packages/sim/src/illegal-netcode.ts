// FIXTURE — must be rejected by `sim-deps`: the world knows nothing of a client.
import { connect } from '@ricochet/netcode';

export const leak = connect;
