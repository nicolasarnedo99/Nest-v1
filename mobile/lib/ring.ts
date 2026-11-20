// The chat's confirm message: what Confirm will invest, then the ring around the message while the payment runs, and how it ended.
// Read from the activity entry the payment wrote, so the chat and the entry sheet never disagree.
import { money, shown } from './holdings';
import { amountFor } from './strategy';
import { timeline } from './steps';
import type { Entry } from './log';
import type { Strategies } from './settings';

export type Ring = { state: 'running' | 'done' | 'ended'; text: string }
  | { state: 'failed'; text: string; reason: string; retry: 'decide' | 'buy' | 'order' | null };

export const askLine = (merchant: string, invest: bigint | null) =>
  invest === null ? `Note this payment at ${merchant}?` : `Invest ${money(invest)} USD₮0 into ${merchant}?`;

// The share and what limits it, under the question; a surprising share shows here before Confirm.
export function shareLine(strategies: Strategies, amountText: string): string {
  if (strategies.share <= 0) return `${amountText} · investing is off, nothing will be bought`;
  const invest = amountFor(strategies, amountText);
  if (invest === null) return `${amountText} · the amount is unreadable, nothing will be bought`;
  const cut = amountFor({ share: strategies.share }, amountText)! > invest;
  return `${amountText} · ${strategies.share}% share${cut ? `, cut to the ${money(invest)} max per buy` : ''}`;
}

// `asked` is the confirmed question without its "?": the message's text while it runs, and after a failure.
export function ring(entry: Entry | undefined, asked: string): Ring {
  if (!entry) return { state: 'running', text: asked };
  if ('order' in entry) return orderRing(entry, asked);
  const steps = timeline(entry);
  if (steps.some(step => step.state === 'active' || step.state === 'pending')) return { state: 'running', text: asked };
  const failed = steps.find(step => step.state === 'failed');
  if (failed) {
    const reason = failed.key === 'buy' && failed.title !== 'The buy failed on Sepolia' ? failed.detail : failed.title;
    // A lookup cut short may have paid its fee, so it is never paid again from here.
    const retry = failed.key === 'buy' ? 'buy' : reason.startsWith('Lookup interrupted') ? null : 'decide';
    return { state: 'failed', text: asked, reason, retry };
  }
  const last = steps[steps.length - 1]!;
  return { state: last.key === 'buy' && last.state === 'done' ? 'done' : 'ended', text: last.title };
}

function orderRing(entry: Extract<Entry, { order: unknown }>, asked: string): Ring {
  const { order, invest, pay } = entry;
  if (order.error !== undefined) return { state: 'failed', text: asked, reason: order.error, retry: 'order' };
  if (order.state !== 'done') return { state: 'running', text: asked };
  const ordered = `Ordered ${order.title}`;
  if (!invest && !pay) return { state: 'done', text: ordered }; // an older entry, saved before orders invested
  if (pay?.error?.startsWith('Nothing bought')) return { state: 'ended', text: `${ordered} · nothing invested` };
  const company = invest?.company ?? 'the company';
  if (pay?.error !== undefined) return { state: 'failed', text: ordered, reason: `Investing in ${company} failed: ${pay.error}`, retry: 'buy' };
  if (pay?.state === 'bought') return pay.confirmed === false
    ? { state: 'failed', text: ordered, reason: `Investing in ${company} failed on Sepolia`, retry: 'buy' }
    : { state: 'done', text: `${ordered} · invested ${pay.value !== undefined ? `${shown(pay.value)} ` : ''}in ${company}` };
  return { state: 'running', text: asked };
}
