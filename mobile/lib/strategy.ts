// How much a purchase invests: the chosen share of it, at least 0.10 (no upper limit). Null means do not buy: the share is 0%
// or the amount could not be read.
import { MINIMUM_BUY, displayDigits, formatMicro, parseAmount } from '../../server/money';

import type { Strategies } from './settings';

export function amountFor(strategies: Strategies, amountText: string): bigint | null {
  if (strategies.share <= 0) return null;
  let purchase: bigint;
  try { purchase = parseAmount(displayDigits(amountText)); } catch { return null; }
  // shortcut: treats AED/EUR amounts as USD, add a rate table when amounts must be right
  const part = purchase * BigInt(strategies.share) / 100n;
  return part < MINIMUM_BUY ? MINIMUM_BUY : part;
}

// An order's amount is micro-units as digits; cut to cents so it reads as a decimal ("1.23"), not as thousands ("1.234567" → 1234567).
export const amountForOrder = (strategies: Strategies, micro: string) => amountFor(strategies, formatMicro(BigInt(micro) / 10_000n * 10_000n));
