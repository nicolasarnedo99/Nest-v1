import { describe, expect, it } from 'vitest';
import { spend, type Store } from '../../mobile/lib/budget.js';

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
});
