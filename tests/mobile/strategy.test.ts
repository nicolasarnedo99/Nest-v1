import { describe, expect, it } from 'vitest';
import { amountFor } from '../../mobile/lib/strategy.js';

const invest = { invest: true, roundUp: false };
const roundUp = { invest: false, roundUp: true };
const both = { invest: true, roundUp: true };
const none = { invest: false, roundUp: false };

describe('amountFor: how much a purchase invests', () => {
  it('invest takes 10% of the purchase, clamped to 0.10 to 1.00', () => {
    expect(amountFor(invest, '4.50')).toBe(450_000n);
    expect(amountFor(invest, '0.50')).toBe(100_000n);
    expect(amountFor(invest, '250.00')).toBe(1_000_000n);
  });

  it('round-up buys the difference to the next whole unit', () => {
    expect(amountFor(roundUp, '4.50')).toBe(500_000n);
    expect(amountFor(roundUp, '4.20')).toBe(800_000n);
  });
  it('round-up buys nothing when the amount is already whole', () => {
    expect(amountFor(roundUp, '5.00')).toBeNull();
  });
  it('round-up raises a difference below 0.10 to 0.10; a whole-unit difference never passes 1.00', () => {
    expect(amountFor(roundUp, '4.95')).toBe(100_000n);
    expect(amountFor(roundUp, '4.91')).toBe(100_000n);
    expect(amountFor(roundUp, '4.01')).toBe(990_000n);
  });

  it('with both on, the larger amount wins, so one tap is one buy', () => {
    expect(amountFor(both, '4.50')).toBe(500_000n); // round-up 0.50 > invest 0.45
    expect(amountFor(both, '4.00')).toBe(400_000n); // whole: only invest applies
    expect(amountFor(both, '4.95')).toBe(495_000n);
    expect(amountFor(both, '49.10')).toBe(1_000_000n); // invest 4.91 clamps to 1.00, beating round-up 0.90
  });

  it('with neither on, buys nothing', () => {
    expect(amountFor(none, '4.50')).toBeNull();
  });

  it('reads the number as USD whatever the currency, from the display text iOS sends', () => {
    expect(amountFor(invest, '1.00€')).toBe(100_000n);
    expect(amountFor(invest, 'AED 3.49')).toBe(349_000n);
    expect(amountFor(invest, '4,50 €')).toBe(450_000n);
    expect(amountFor(invest, '$1,234.56')).toBe(1_000_000n);
    expect(amountFor(roundUp, '4,50 €')).toBe(500_000n);
  });

  it('buys nothing when the amount cannot be read', () => {
    for (const text of ['', 'abc', 'free', '0.00', '€']) expect(amountFor(both, text)).toBeNull();
  });
});
