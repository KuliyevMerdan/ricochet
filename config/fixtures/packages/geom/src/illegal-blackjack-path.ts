// FIXTURE — must be rejected by `no-siblings`: nor by a relative path into ../blackjack.
import { anything } from '../../../../../../blackjack/packages/protocol/src/not-a-real-module';

export const leak = anything;
