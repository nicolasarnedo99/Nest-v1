import { describe, expect, it } from 'vitest';
import { checkBudget, formatMicro, madridDay, parseAmount, principal } from '../../server/money.js';

describe('purchase principal', () => {
  it('rounds down with integer math and clamps to the agreed bounds', () => {
    expect(principal('0.000001', 'USD')).toBe(100_000n);
    expect(principal('1', 'USD')).toBe(100_000n);
    expect(principal('9.999999', 'USD')).toBe(999_999n);
    expect(principal('10', 'USD')).toBe(1_000_000n);
    expect(principal('999999999999', 'USD')).toBe(1_000_000n);
    expect(principal('2.345678', 'EUR')).toBe(258_024n);
    expect(formatMicro(principal('2', 'EUR'))).toBe('0.22');
  });
  it.each(['0', '-1', '1e3', '01', '1.', '.1', 'NaN', 'Infinity', '0.0000001', ' 1', '1\n'])('rejects %s', amount => {
    expect(() => parseAmount(amount)).toThrow();
  });
});

describe('budget check before any signature', () => {
  const budget = { principalMicro: 1_000_000n, balanceMicro: 10_000_000n, spentTodayMicro: 4_000_000n, reservations: [] };
  it('allows exactly the cap and rejects one micro-unit over', () => {
    expect(() => checkBudget(budget)).not.toThrow();
    expect(() => checkBudget({ ...budget, spentTodayMicro: 4_000_001n })).toThrow('Daily cap');
  });
  it('rejects a buy outside the 0.10 to 1 range', () => {
    expect(() => checkBudget({ ...budget, principalMicro: 99_999n })).toThrow('Invalid budget input');
    expect(() => checkBudget({ ...budget, principalMicro: 1_000_001n })).toThrow('Invalid budget input');
  });
  it('retains unresolved exposure from yesterday after Madrid midnight', () => {
    expect(madridDay(new Date('2026-09-12T21:59:59Z'))).toBe('2026-09-12');
    expect(madridDay(new Date('2026-09-12T22:00:00Z'))).toBe('2026-09-13');
    const old = { principalMicro: 4_000_001n, budgetDay: '2026-09-12', uncertain: false };
    expect(() => checkBudget({ ...budget, spentTodayMicro: 0n, reservations: [old] })).toThrow('Daily cap');
    expect(() => checkBudget({ ...budget, spentTodayMicro: 0n, reservations: [{ ...old, principalMicro: 1n, uncertain: true }] })).toThrow('Unresolved transaction');
  });
  it('never signs for more than the wallet holds, counting outstanding buys', () => {
    const boundary = { ...budget, spentTodayMicro: 0n, balanceMicro: 1_000_000n };
    expect(() => checkBudget(boundary)).not.toThrow();
    expect(() => checkBudget({ ...boundary, balanceMicro: 999_999n })).toThrow('Insufficient balance');
    expect(() => checkBudget({ ...boundary, balanceMicro: 1_500_000n,
      reservations: [{ principalMicro: 1_000_000n, budgetDay: '2026-09-11', uncertain: false }] })).toThrow('Insufficient balance');
  });
});
