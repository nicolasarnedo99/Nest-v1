import { describe, expect, it } from 'vitest';
import { tapFromIntent } from '../../mobile/lib/tap.js';

describe('tapFromIntent: what the background action may hand the app', () => {
  it('accepts a merchant and an amount', () => {
    expect(tapFromIntent({ merchant: '  CARREFOUR EXPRESS  ', amount: '4,50 €' })).toEqual({ merchant: 'CARREFOUR EXPRESS', amount: '4,50 €' });
  });
  it('cuts a merchant to 160 characters and an amount to 40', () => {
    const tap = tapFromIntent({ merchant: 'A'.repeat(300), amount: '9'.repeat(100) });
    expect(tap?.merchant).toHaveLength(160); expect(tap?.amount).toHaveLength(40);
  });
  it('refuses anything else', () => {
    for (const input of [null, 'x', {}, { merchant: '', amount: '1' }, { merchant: 'x' }, { merchant: 1, amount: '1' }, { merchant: 'x\u0000y', amount: '1' }]) {
      expect(tapFromIntent(input)).toBeNull();
    }
  });
});
