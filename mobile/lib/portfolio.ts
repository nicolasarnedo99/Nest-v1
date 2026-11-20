// What was invested per company, from confirmed buys only (the same ones as `holdings`), for the portfolio sheet's donut.
// No market prices: a slice is what was paid in. Lookup fees are not buys and never appear.
import { holdings } from './holdings';
import type { Entry } from './log';

export type Slice = { company: string; invested: bigint; share: number };
export type Portfolio = { total: bigint; slices: Slice[] };

// Largest first, with whole-percent shares that sum to 100 (largest remainder). A buy with no recorded amount has no size, so it is left out.
export function portfolio(entries: Entry[]): Portfolio {
  const held = holdings(entries).filter(h => h.invested > 0n);
  const total = held.reduce((sum, h) => sum + h.invested, 0n);
  if (total === 0n) return { total, slices: [] };
  const parts = held.map(h => ({ h, share: Number(h.invested * 100n / total), rest: h.invested * 100n % total }));
  let left = 100 - parts.reduce((sum, p) => sum + p.share, 0);
  for (const p of [...parts].sort((a, b) => (a.rest === b.rest ? 0 : a.rest > b.rest ? -1 : 1))) {
    if (left === 0) break;
    p.share += 1;
    left -= 1;
  }
  return { total, slices: parts.map(({ h, share }) => ({ company: h.company, invested: h.invested, share })) };
}

// A slice rounded down to 0% still exists, so it reads "<1%" rather than "0%".
export const shareLabel = (share: number) => (share < 1 ? '<1%' : `${share}%`);

export type Arc = { length: number; offset: number };

// Each slice's drawn length and where it starts along the ring, both in the ring's own units; `gap` is cut from each slice when there are two or more.
export function donutArcs(shares: number[], circumference: number, gap: number): Arc[] {
  const drawn = shares.filter(share => share > 0).length;
  let start = 0;
  return shares.map(share => {
    const span = circumference * share / 100;
    const arc = { length: Math.max(0, span - (drawn > 1 ? gap : 0)), offset: start };
    start += span;
    return arc;
  });
}
