import { describe, expect, it } from 'vitest';
import { amountFor } from '../../mobile/lib/strategy.js';

const share = (n: number) => ({ share: n });

describe('amountFor: how much a purchase invests', () => {
  it('invests the chosen share of the purchase, clamped to 0.10 to 1.00', () => {
    expect(amountFor(share(10), '4.50')).toBe(450_000n);
    expect(amountFor(share(10), '0.50')).toBe(100_000n);
    expect(amountFor(share(10), '250.00')).toBe(1_000_000n);
    expect(amountFor(share(20), '4.50')).toBe(900_000n);
    expect(amountFor(share(100), '4.50')).toBe(1_000_000n); // all of it, but never more than 1.00 a buy
    expect(amountFor(share(1), '4.50')).toBe(100_000n); // 0.045 rounds up to the 0.10 minimum
  });

  it('buys nothing at 0%', () => {
    expect(amountFor(share(0), '4.50')).toBeNull();
  });

  it('reads the number as USD whatever the currency, from the display text iOS sends', () => {
    expect(amountFor(share(10), '1.00€')).toBe(100_000n);
    expect(amountFor(share(10), 'AED 3.49')).toBe(349_000n);
    expect(amountFor(share(10), '4,50 €')).toBe(450_000n);
    expect(amountFor(share(10), '$1,234.56')).toBe(1_000_000n);
  });

  it('buys nothing when the amount cannot be read', () => {
    for (const text of ['', 'abc', 'free', '0.00', '€']) expect(amountFor(share(10), text)).toBeNull();
  });
});
