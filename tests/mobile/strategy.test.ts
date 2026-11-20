import { describe, expect, it } from 'vitest';
import { amountFor, amountForOrder } from '../../mobile/lib/strategy.js';

const share = (n: number) => ({ share: n });

describe('amountFor: how much a purchase invests', () => {
  it('invests the chosen share of the purchase, lifted to a 0.10 minimum, with no maximum', () => {
    expect(amountFor(share(10), '4.50')).toBe(450_000n);
    expect(amountFor(share(10), '0.50')).toBe(100_000n);
    expect(amountFor(share(10), '250.00')).toBe(25_000_000n);
    expect(amountFor(share(20), '11.20')).toBe(2_240_000n);
    expect(amountFor(share(100), '50.00')).toBe(50_000_000n); // all of it, however large
    expect(amountFor(share(1), '4.50')).toBe(100_000n); // 0.045 rounds up to the 0.10 minimum
  });

  it('buys nothing at 0%', () => {
    expect(amountFor(share(0), '4.50')).toBeNull();
  });

  it('reads the number as USD whatever the currency, from the display text iOS sends', () => {
    expect(amountFor(share(10), '1.00€')).toBe(100_000n);
    expect(amountFor(share(10), 'AED 3.49')).toBe(349_000n);
    expect(amountFor(share(10), '4,50 €')).toBe(450_000n);
    expect(amountFor(share(10), '$1,234.56')).toBe(123_456_000n);
  });

  it('buys nothing when the amount cannot be read', () => {
    for (const text of ['', 'abc', 'free', '0.00', '€']) expect(amountFor(share(10), text)).toBeNull();
  });
});

describe('amountForOrder: how much an order invests, from its micro-unit amount', () => {
  it('reads micro-units as a decimal amount, cut to cents', () => {
    expect(amountForOrder(share(10), '4500000')).toBe(450_000n);
    expect(amountForOrder(share(10), '1234567')).toBe(123_000n); // 1.23, not 1234567 read as thousands
    expect(amountForOrder(share(10), '272021780')).toBe(27_202_000n); // a large order is no longer capped at 1.00
    expect(amountForOrder(share(10), '2820000')).toBe(282_000n);
  });
  it('buys nothing at 0% or for less than a cent', () => {
    expect(amountForOrder(share(0), '4500000')).toBeNull();
    expect(amountForOrder(share(10), '9999')).toBeNull();
  });
});

describe('amountFor: the optional max per stock buy', () => {
  it('caps the invested amount at the max, and is no limit without one', () => {
    expect(amountFor({ share: 20, maxBuy: '1500000' }, '11.20')).toBe(1_500_000n);
    expect(amountFor(share(20), '11.20')).toBe(2_240_000n);
    expect(amountFor({ share: 20, maxBuy: '2240000' }, '11.20')).toBe(2_240_000n); // at the max is allowed
    expect(amountFor({ share: 20, maxBuy: '3000000' }, '11.20')).toBe(2_240_000n);
  });
  it('keeps the 0.10 minimum, and caps an order the same way', () => {
    expect(amountFor({ share: 1, maxBuy: '100000' }, '4.50')).toBe(100_000n);
    expect(amountForOrder({ share: 50, maxBuy: '1500000' }, '10000000')).toBe(1_500_000n);
  });
});
