// The daily cap, kept on the phone now that the Mac no longer sees each buy.
// What was spent today (a Madrid day) lives in a small JSON file; a buy counts
// as soon as it is sent, and is given back only if sending failed outright.
import { DAILY_CAP, MICRO, MINIMUM_BUY, formatMicro, madridDay } from '../../server/money';

export type Store = { read(): string | null; write(text: string): void };

// An unreadable record throws: spending is refused rather than reset to zero.
function spentOn(store: Store, day: string): bigint {
  const text = store.read();
  if (text === null) return 0n;
  const saved = JSON.parse(text) as { day: string; spent: string };
  return saved.day === day ? BigInt(saved.spent) : 0n;
}

// Counts `amount` against today's cap. `release` gives it back, until `submit` marks it handed to the bundler.
export function spend(store: Store, amount: bigint, now = new Date()): { submit(): void; release(): void } {
  if (amount < MINIMUM_BUY || amount > MICRO) throw new Error('Each buy must be between 0.10 and 1.00');
  const day = madridDay(now);
  const spent = spentOn(store, day);
  if (spent + amount > DAILY_CAP) throw new Error(`This buy would pass today's daily cap of 5.00 (already spent ${formatMicro(spent)})`);
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
