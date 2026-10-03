// FIXTURE — must be rejected by `no-siblings`: nor by a relative path into ../crash.
import { anything } from '../../../../../../crash/packages/protocol/src/not-a-real-module';

export const leak = anything;
