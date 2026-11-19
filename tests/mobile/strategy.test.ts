import { describe, expect, it } from 'vitest';
import { amountFor, amountForOrder } from '../../mobile/lib/strategy.js';

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

describe('amountForOrder: how much an order invests, from its micro-unit amount', () => {
  it('reads micro-units as a decimal amount, cut to cents', () => {
    expect(amountForOrder(share(10), '4500000')).toBe(450_000n);
    expect(amountForOrder(share(10), '1234567')).toBe(123_000n); // 1.23, not 1234567 read as thousands
    expect(amountForOrder(share(10), '272021780')).toBe(1_000_000n);
    expect(amountForOrder(share(10), '2820000')).toBe(282_000n);
  });
  it('buys nothing at 0% or for less than a cent', () => {
    expect(amountForOrder(share(0), '4500000')).toBeNull();
    expect(amountForOrder(share(10), '9999')).toBeNull();
  });
});
