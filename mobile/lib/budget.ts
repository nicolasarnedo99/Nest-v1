// What was spent today (a Madrid day) lives in a small JSON file; a buy counts
// as soon as it is sent, and is given back only if sending failed outright.
// Savings buys have no daily cap, only a per-buy minimum and a fee bound; shopping orders are not counted here.
import { MINIMUM_BUY, formatMicro, madridDay } from '../../server/money';

export type Store = { read(): string | null; write(text: string): void };

// An unreadable record throws: spending is refused rather than reset to zero.
function spentOn(store: Store, day: string): bigint {
  const text = store.read();
  if (text === null) return 0n;
  const saved = JSON.parse(text) as { day: string; spent: string };
  return saved.day === day ? BigInt(saved.spent) : 0n;
}

export const MAX_FEE = 10_000n; // 0.01 USD₮0

// Counts a buy or a lookup fee of `amount` toward today's total. `release` gives it back, until `submit` marks it handed to the bundler.
export function spend(store: Store, amount: bigint, now = new Date(), kind: 'buy' | 'fee' = 'buy'): { submit(): void; release(): void } {
  if (kind === 'fee' ? amount <= 0n || amount > MAX_FEE : amount < MINIMUM_BUY)
    throw new Error(kind === 'fee' ? 'Each lookup fee must be above 0 and at most 0.01' : 'Each buy must be at least 0.10');
  return count(store, amount, now);
}

// Counts `amount` against today's total in `store`; with a `cap`, refuses it past that without counting it.
function count(store: Store, amount: bigint, now: Date, cap?: bigint, refused?: (spent: bigint) => string): { submit(): void; release(): void } {
  const day = madridDay(now);
  const spent = spentOn(store, day);
  if (cap !== undefined && spent + amount > cap) throw new Error(refused!(spent));
  store.write(JSON.stringify({ day, spent: (spent + amount).toString() }));
  let submitted = false;
  // Once handed to the bundler the buy may land even if the call throws, so it stays counted for the day.
  const submit = () => { submitted = true; };
  return { submit, release: () => {
    if (submitted) return;
    const text = store.read();
    if (text === null || (JSON.parse(text) as { day: string }).day !== day) return; // a new day already started from zero
    const left = spentOn(store, day) - amount;
    store.write(JSON.stringify({ day, spent: (left < 0n ? 0n : left).toString() }));
  } };
}

export const spentToday = (store: Store, now = new Date()) => spentOn(store, madridDay(now));
