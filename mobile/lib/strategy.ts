// How much a purchase invests. Null means do not buy: neither strategy is on,
// the amount is already whole (round-up) or it could not be read.
import { MICRO, MINIMUM_BUY, displayDigits, parseAmount, principal } from '../../server/money';

import type { Strategies } from './settings';

export function amountFor(strategies: Strategies, amountText: string): bigint | null {
  const digits = displayDigits(amountText);
  let purchase: bigint;
  try { purchase = parseAmount(digits); } catch { return null; }
  const options: bigint[] = [];
  // shortcut: treats AED/EUR amounts as USD, add a rate table when amounts must be right
  if (strategies.invest) options.push(principal(digits, 'USD'));
  if (strategies.roundUp && purchase % MICRO !== 0n) {
    const gap = MICRO - purchase % MICRO;
    options.push(gap < MINIMUM_BUY ? MINIMUM_BUY : gap > MICRO ? MICRO : gap);
  }
  return options.length ? options.reduce((a, b) => (a > b ? a : b)) : null;
}
