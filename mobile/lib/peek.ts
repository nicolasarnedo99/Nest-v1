// The activity handle's one line: the newest entry, what happened or what is happening now, and how long ago.
import { boughtLine } from './bought';
import { money, shown, summarise } from './holdings';
import type { Entry } from './log';
import { steps } from './steps';

export function peek(entries: Entry[], now: number): string {
  const newest = entries.reduce<Entry | undefined>((a, b) => (!a || b.at > a.at ? b : a), undefined);
  return newest ? `${headline(newest)} · ${ago(newest.at, now)}` : 'Activity · nothing yet';
}

function headline(e: Entry): string {
  if ('error' in e) return `Failed · ${e.merchant}`;
  if ('order' in e) {
    const { order, invest, pay } = e;
    if (order.error !== undefined) return `Failed · ${order.title}`;
    if (order.state !== 'done') return `Ordering · ${order.title}`;
    const demo = order.seller === 'bitrefill' ? 'Demo purchase' : 'Demo order';
    if (invest && pay?.state === 'bought' && pay.confirmed === true) return `${demo} · ${order.title} · invested ${pay.value !== undefined ? `${shown(pay.value)} ` : ''}in ${invest.company}`;
    return `${demo} · ${order.title} · ${money(BigInt(order.amount))} USD₮0`;
  }
  const bought = boughtLine(e);
  if (bought) return bought.title;
  const at = steps(e);
  if (at.lookup === 'active') return `Looking up · ${e.merchant}`;
  if (at.buy === 'active') return `Buying · ${e.merchant}`;
  return summarise(e).pill === 'Error' ? `Failed · ${e.merchant}` : `Nothing bought · ${e.merchant}`;
}

// "just now", "2 min ago", "3 h ago", then the day ("17 Nov").
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
