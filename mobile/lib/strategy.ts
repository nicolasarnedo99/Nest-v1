// How much a purchase invests: the chosen share of it, between 0.10 and 1.00. Null means do not buy: the share is 0%
// or the amount could not be read.
import { MICRO, MINIMUM_BUY, displayDigits, parseAmount } from '../../server/money';

import type { Strategies } from './settings';

export function amountFor(strategies: Strategies, amountText: string): bigint | null {
  if (strategies.share <= 0) return null;
  let purchase: bigint;
  try { purchase = parseAmount(displayDigits(amountText)); } catch { return null; }
  // shortcut: treats AED/EUR amounts as USD, add a rate table when amounts must be right
  const part = purchase * BigInt(strategies.share) / 100n;
  return part < MINIMUM_BUY ? MINIMUM_BUY : part > MICRO ? MICRO : part;
}
