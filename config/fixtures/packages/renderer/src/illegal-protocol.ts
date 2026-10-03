// FIXTURE — must be rejected by `renderer-deps`: the renderer draws pictures, not messages.
import { decode } from '@ricochet/protocol';

export const leak = decode;
