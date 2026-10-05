import { hash, last } from '../../packages/sim/src/__fixtures__/room.js';

/** The soak's pinned run, for a browser to replay: `window.replay()` is the world's hash after
 * 5,000 ticks of seed 3. */
Object.assign(globalThis, { replay: () => hash(last(3, 5000)) });
