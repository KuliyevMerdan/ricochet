// FIXTURE — must be rejected by `no-cross-package-deep-imports`.
import { decode } from '../../protocol/src/index';

export const leak = decode;
