// What the log says was bought, per company, and how one entry reads in a list. A record, never a control.
import { formatMicro, parseAmount } from '../../server/money';
import type { Entry } from './log';

export type Holding = { company: string; invested: bigint; buys: number };

// Sorted by invested desc, then company.
export function holdings(entries: Entry[]): Holding[] {
  const byCompany = new Map<string, Holding>();
  for (const e of entries) {
    if ('error' in e || e.pay?.state !== 'bought' || e.pay.confirmed !== true) continue;
    const company = 'order' in e ? e.invest?.company : e.company ?? e.lookup?.listedParent ?? e.category?.leader; // an order's invest after it counts too
    if (!company) continue;
    const h = byCompany.get(company) ?? { company, invested: 0n, buys: 0 };
    try { if (e.pay.value !== undefined) h.invested += parseAmount(e.pay.value); } catch { /* entries come from anywhere: count the buy, add nothing */ }
    h.buys += 1;
    byCompany.set(company, h);
  }
  return [...byCompany.values()].sort((a, b) => (a.invested === b.invested ? a.company.localeCompare(b.company) : a.invested > b.invested ? -1 : 1));
}

// Micro-units with at least two decimals: 500000n is "0.50", 1234567n is "1.234567".
export const money = (v: bigint) => { const [whole, fraction = ''] = formatMicro(v).split('.'); return `${whole}.${fraction.padEnd(2, '0')}`; };

// A stored value shown as money, or as stored when it does not parse.
export const shown = (value: string) => { try { return money(parseAmount(value)); } catch { return value; } };

export type Summary = { pill: 'Bought' | 'Ordered' | 'Looked up' | 'Nothing bought' | 'Error' | 'Working'; line: string; company: string | null };

export function summarise(entry: Entry): Summary {
  if ('error' in entry) return { pill: 'Error', line: entry.error, company: null };
  if ('order' in entry) {
    const { order } = entry;
    if (order.error !== undefined) return { pill: 'Error', line: order.error, company: null };
    const demo = order.seller === 'bitrefill' ? 'Demo purchase on Sepolia' : 'Demo order, not shipped';
    return order.state === 'done' ? { pill: 'Ordered', line: `${demo} · ${money(BigInt(order.amount))} USD₮0`, company: null } : { pill: 'Working', line: 'Ordering…', company: null };
  }
  const { pay, lookup } = entry;
  const company = entry.company ?? lookup?.listedParent ?? entry.category?.leader ?? null;
  if (pay?.state === 'bought' && pay.confirmed === true) return { pill: 'Bought', line: `${company ?? entry.merchant} · ${pay.value !== undefined ? `${shown(pay.value)} invested` : 'bought'}`, company };
  if (pay?.error?.startsWith('Nothing bought')) return { pill: 'Nothing bought', line: pay.error, company };
  if (pay?.error !== undefined) return { pill: 'Error', line: pay.error, company };
  if (pay?.state === 'bought') return { pill: 'Error', line: 'The buy failed on Sepolia', company };
  if (pay) return { pill: 'Working', line: 'Buying…', company };
  if (lookup?.state === 'done') return { pill: 'Looked up', line: `${lookup.operator ?? 'Unknown'} · ${lookup.listedParent ?? 'not listed'}`, company };
  if (lookup?.error !== undefined) return { pill: 'Nothing bought', line: lookup.error, company };
  if (lookup) return { pill: 'Working', line: 'Looking up…', company };
  if (company) return { pill: 'Nothing bought', line: `${company} · nothing invested`, company };
  return { pill: 'Nothing bought', line: 'No listed company', company: null };
}
