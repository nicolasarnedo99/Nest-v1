import { describe, expect, it } from 'vitest';
import { shoppedToday, spend, spendShopping, spentToday, type Store } from '../../mobile/lib/budget.js';

// A Store kept in memory, standing in for the JSON file in Documents.
const memory = (): Store & { text: string | null } => {
  const store = { text: null as string | null, read: () => store.text, write: (text: string) => { store.text = text; } };
  return store;
};
// 10:00 and 23:30 on 18 Nov in Madrid (UTC+1), then 00:30 on 19 Nov in Madrid.
const morning = new Date('2026-11-18T09:00:00Z');
const lateNight = new Date('2026-11-18T22:30:00Z');
const nextDay = new Date('2026-11-18T23:30:00Z');

describe('spend: the daily cap, on the phone', () => {
  it('allows exactly 5.00 in a day and refuses 5.10', () => {
    const store = memory();
    for (let i = 0; i < 10; i++) spend(store, 500000n, morning);
    expect(() => spend(store, 100000n, lateNight)).toThrow('daily cap');
  });

  it('refuses a buy that would take the day past the cap, without counting it', () => {
    const store = memory();
    spend(store, 1000000n, morning); spend(store, 1000000n, morning); spend(store, 1000000n, morning); spend(store, 1000000n, morning);
    spend(store, 500000n, morning);
    expect(() => spend(store, 600000n, morning)).toThrow('daily cap');
    expect(() => spend(store, 500000n, morning)).not.toThrow();
  });

  it('starts again on the next Madrid day', () => {
    const store = memory();
    for (let i = 0; i < 5; i++) spend(store, 1000000n, lateNight);
    expect(() => spend(store, 100000n, lateNight)).toThrow('daily cap');
    expect(() => spend(store, 1000000n, nextDay)).not.toThrow();
  });

  it('releases a buy whose sending failed', () => {
    const store = memory();
    for (let i = 0; i < 4; i++) spend(store, 1000000n, morning);
    const { release } = spend(store, 1000000n, morning);
    expect(() => spend(store, 100000n, morning)).toThrow('daily cap');
    release();
    expect(() => spend(store, 1000000n, morning)).not.toThrow();
  });

  // A send that throws after submission may still have reached the bundler and land on chain.
  it('keeps a buy counted once it was handed to the bundler, even if sending then failed', () => {
    const store = memory();
    for (let i = 0; i < 4; i++) spend(store, 1000000n, morning);
    const last = spend(store, 1000000n, morning);
    last.submit();
    last.release();
    expect(() => spend(store, 100000n, morning)).toThrow('daily cap');
  });

  it('does not let a release from yesterday touch today', () => {
    const store = memory();
    const { release } = spend(store, 1000000n, lateNight);
    for (let i = 0; i < 5; i++) spend(store, 1000000n, nextDay);
    release();
    expect(() => spend(store, 100000n, nextDay)).toThrow('daily cap');
  });

  it('keeps each buy between 0.10 and 1.00', () => {
    expect(() => spend(memory(), 99999n, morning)).toThrow();
    expect(() => spend(memory(), 1000001n, morning)).toThrow();
    expect(() => spend(memory(), 100000n, morning)).not.toThrow();
  });

  it('refuses to buy when what was spent cannot be read', () => {
    const store = memory(); store.text = '{not json';
    expect(() => spend(store, 500000n, morning)).toThrow();
  });

  it('counts a lookup fee of up to 0.01 against the same cap', () => {
    const store = memory();
    for (let i = 0; i < 4; i++) spend(store, 1000000n, morning);
    spend(store, 990000n, morning);
    expect(() => spend(store, 10000n, morning, 'fee')).not.toThrow(); // exactly 5.00
    expect(() => spend(store, 10000n, morning, 'fee')).toThrow('daily cap');
  });
  it('refuses a fee above 0.01, or a fee passed off as a buy', () => {
    const store = memory();
    expect(() => spend(store, 10001n, morning, 'fee')).toThrow('fee');
    expect(() => spend(store, 0n, morning, 'fee')).toThrow('fee');
    expect(() => spend(store, 10000n, morning)).toThrow('between 0.10 and 1.00');
  });
  it('releases an unsigned fee and keeps a signed one', () => {
    const store = memory();
    spend(store, 10000n, morning, 'fee').release();
    const signed = spend(store, 10000n, morning, 'fee'); signed.submit(); signed.release();
    expect(JSON.parse(store.text!).spent).toBe('10000');
  });
});

describe('spentToday', () => {
  it('reports what today has spent, and zero on a new day', () => {
    const store = memory(); spend(store, 500000n, morning); spend(store, 10000n, morning, 'fee');
    expect(spentToday(store, lateNight)).toBe(510000n);
    expect(spentToday(store, nextDay)).toBe(0n);
    expect(spentToday(memory(), morning)).toBe(0n);
  });
});

describe('spendShopping: the separate 200 shopping limit', () => {
  it('allows exactly 200 in a day and refuses 200.000001', () => {
    const store = memory();
    expect(() => spendShopping(store, 200_000_000n, morning)).not.toThrow();
    expect(() => spendShopping(store, 1n, lateNight)).toThrow("This order would pass today's shopping limit of 200 (already spent 200)");
    expect(() => spendShopping(memory(), 200_000_001n, morning)).toThrow('Each order must be above 0 and at most 200');
    expect(() => spendShopping(memory(), 0n, morning)).toThrow('Each order must be above 0 and at most 200');
  });
  it('refuses a second 120 order the same day, without counting it', () => {
    const store = memory();
    spendShopping(store, 120_000_000n, morning);
    expect(() => spendShopping(store, 120_000_000n, morning)).toThrow('already spent 120');
    expect(shoppedToday(store, morning)).toBe(120_000_000n);
  });
  it('starts again on the next Madrid day', () => {
    const store = memory();
    spendShopping(store, 200_000_000n, lateNight);
    expect(() => spendShopping(store, 120_000_000n, nextDay)).not.toThrow();
    expect(shoppedToday(store, nextDay)).toBe(120_000_000n);
  });
  it('frees a released unsigned order and keeps a submitted one', () => {
    const store = memory();
    spendShopping(store, 120_000_000n, morning).release();
    expect(shoppedToday(store, morning)).toBe(0n);
    const signed = spendShopping(store, 120_000_000n, morning); signed.submit(); signed.release();
    expect(shoppedToday(store, morning)).toBe(120_000_000n);
  });
  // Orders above 1.00 would always fail the savings cap; the two limits live in two files.
  it('is counted apart from the savings cap', () => {
    const savings = memory(), shopping = memory();
    for (let i = 0; i < 5; i++) spend(savings, 1000000n, morning);
    expect(() => spendShopping(shopping, 200_000_000n, morning)).not.toThrow();
    expect(spentToday(savings, morning)).toBe(5_000_000n);
    expect(shoppedToday(shopping, morning)).toBe(200_000_000n);
  });
});
