// Where an entry is in its run: decide on the phone, look up the merchant (only when the model said none), then buy.
// Drives the step bar in the entry sheet, so you can see which step the agent is on while it works.
import { parseAmount } from '../../server/money';
import { money } from './holdings';
import type { Entry, InvestTarget, Order, Pay, WouldPay } from './log';

export type StepState = 'done' | 'active' | 'pending' | 'failed' | 'skipped';
export type Steps = { decide: StepState; lookup: StepState; buy: StepState };

export function steps(entry: Entry): Steps {
  if ('order' in entry) return { decide: 'skipped', lookup: 'skipped', buy: entry.order.error !== undefined ? 'failed' : entry.order.state === 'done' ? 'done' : 'active' };
  if ('error' in entry) return { decide: 'failed', lookup: 'skipped', buy: 'skipped' };
  const { lookup, pay } = entry;
  const lookupState: StepState = entry.company !== null ? 'skipped'
    : !lookup ? (pay ? 'skipped' : 'active')
    : lookup.error !== undefined ? (lookup.error.startsWith('Not looked up') ? 'skipped' : 'failed')
    : lookup.state === 'done' ? 'done' : 'active';
  const buy: StepState = pay
    ? pay.error !== undefined ? (pay.error.startsWith('Nothing bought') ? 'skipped' : 'failed')
      : pay.state === 'bought' ? (pay.confirmed === false ? 'failed' : 'done') : 'active'
    : lookupState === 'active' ? 'pending'
    : lookupState === 'failed' || lookupState === 'skipped' && entry.company === null ? 'skipped'
    : 'active'; // decided or looked up, not yet signing: matching a category or about to buy
  return { decide: 'done', lookup: lookupState, buy };
}

// The x402 exchange of an order, from what the entry recorded: the 402 the seller sent, the signature on this phone, the settlement.
// Then the invest after it, a gasless buy, when the entry recorded its target (older entries did not).
export type PayStep = { key: 'asked' | 'signed' | 'settled' | 'invested'; state: StepState; text: string; transaction?: string };
// What the Chat sheet and the entry sheet show for an order: the order and, once it settles, its invest.
export type Paying = { order: Order; invest?: InvestTarget; pay?: Pay };

const NETWORKS: Record<string, string> = { 'eip155:11155111': 'Sepolia', 'eip155:42161': 'Arbitrum' };
export const short = (address: string) => (address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address);

export function paySteps(order: Order, invest?: InvestTarget, pay?: Pay): PayStep[] {
  const done = order.state === 'done';
  const failed = order.error !== undefined;
  const signed = order.signed === true || done; // an older finished entry has no marker, but was signed
  const asked = order.payTo !== undefined || signed;
  const seller = order.seller === 'bitrefill' ? 'the Sepolia mirror' : 'the Nest demo shop';
  const terms = order.payTo === undefined ? ''
    : ` to ${short(order.payTo)} on ${NETWORKS[order.network ?? ''] ?? order.network ?? 'an unrecorded network'}${order.scheme ? ` (scheme ${order.scheme})` : ''}`;
  const x402: PayStep[] = [
    { key: 'asked', state: asked ? 'done' : failed ? 'failed' : 'active',
      text: asked ? `Asked ${seller} → 402 Payment Required: ${money(BigInt(order.amount))} USD₮0${terms}`
        : failed ? `Asked ${seller} → no payment terms recorded` : `Asking ${seller}…` },
    { key: 'signed', state: signed ? 'done' : failed ? (asked ? 'failed' : 'skipped') : asked ? 'active' : 'pending',
      text: signed ? 'Signed an EIP-3009 authorisation on this phone' : 'Sign an EIP-3009 authorisation on this phone' }, // never past tense before it happened
    { key: 'settled', state: done ? 'done' : failed ? (signed ? 'failed' : 'skipped') : signed ? 'active' : 'pending',
      text: done ? "Settled by the seller's facilitator" : "Settlement by the seller's facilitator", ...(order.transaction ? { transaction: order.transaction } : {}) },
  ];
  return invest ? [...x402, investStep(order, invest, pay)] : x402;
}

function investStep(order: Order, { company, reason, of }: InvestTarget, pay?: Pay): PayStep {
  const target = of === company ? company : `${company} (${reason} of ${of})`; // "Apple", not "Apple (owner of Apple)"
  let value = '';
  try { if (pay?.value !== undefined) value = `${money(parseAmount(pay.value))} `; } catch { /* an unreadable amount is left out */ }
  const step = (state: StepState, text: string): PayStep => ({ key: 'invested', state, text, ...(pay?.transaction ? { transaction: pay.transaction } : {}) });
  if (order.error !== undefined) return step('skipped', `Invest in ${target} · not run, the order did not settle`);
  if (order.state !== 'done') return step('pending', `Invest in ${target} · gasless buy`);
  if (!pay) return step('active', `Investing in ${target}…`);
  if (pay.error?.startsWith('Nothing bought')) return step('skipped', pay.error);
  if (pay.error !== undefined) return step('failed', `Invest in ${target} failed: ${pay.error}`);
  if (pay.state === 'bought') return pay.confirmed ? step('done', `Invested ${value}in ${target} · gasless buy`) : step('failed', `Invest in ${target} failed on Sepolia`);
  return step('active', `Investing ${value}in ${target} · gasless buy…`);
}

// What Bitrefill's own invoice would ask, as recorded by the mirror. Never paid.
export const wouldPayLine = (w: WouldPay) => `On ${NETWORKS[w.network] ?? w.network} this would be paid to ${w.seller} (${short(w.payTo)}) in USD₮0`;
