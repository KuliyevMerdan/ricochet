// FIXTURE — must be rejected by `no-siblings`: nor by a relative path into ../slots.
import { anything } from '../../../../../../slots/packages/protocol/src/not-a-real-module';

export const leak = anything;
