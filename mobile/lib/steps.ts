// Where an entry is in its run: decide on the phone, look up the merchant (only when the model said none), then buy.
// Drives the step bar in the entry sheet, so you can see which step the agent is on while it works.
import { parseAmount } from '../../server/money';
import { money, shown } from './holdings';
import { investedIn, showExplanation } from './bought';
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

// The entry sheet's story of a card decision, top to bottom: decide, pay the lookup, the owner, the category, buy.
// One headline and one muted detail per step; a step that never ran is left out, so nothing is said twice.
export type TimelineStep = { key: 'decide' | 'lookup' | 'owner' | 'category' | 'buy'; state: StepState; title: string; detail: string; transaction?: string };
type Decided = Exclude<Entry, { order: Order }>;

export function timeline(entry: Decided): TimelineStep[] {
  if ('error' in entry) return [{ key: 'decide', state: 'failed', title: entry.error, detail: entry.model }];
  const at = steps(entry);
  const { lookup, category, pay } = entry;
  const tx = (transaction?: string) => (transaction ? { transaction } : {});
  // A placement's explanation is code's own reason, so it always shows; the 2B's guess (older entries) hides once the lookup named the operator.
  const decideDetail = entry.placement
    ? [entry.explanation, 'S&P 500 brand table on this phone', `${entry.seconds.toFixed(2)} s`]
    : [showExplanation(lookup) ? `“${entry.explanation}”` : '', `${entry.seconds.toFixed(2)} s`, entry.model];
  const out: TimelineStep[] = [{ key: 'decide', state: 'done', title: entry.company ?? 'No listed company', detail: decideDetail.filter(Boolean).join(' · ') }];

  if (at.lookup !== 'skipped' || lookup?.error !== undefined) {
    const source = `${lookup?.agent ? `agent #${lookup.agent} · ` : ''}x402 · ${lookup?.source ?? 'demo data'}`; // entries before the source was recorded were all demo data
    out.push(lookup?.error !== undefined ? { key: 'lookup', state: at.lookup, title: lookup.error, detail: source }
      : lookup?.state === 'done' ? { key: 'lookup', state: 'done', title: `Paid the lookup · ${lookup.fee ?? '0.01'} USD₮0`, detail: source, ...tx(lookup.transaction) }
      : { key: 'lookup', state: 'active', title: 'Paying the lookup · 0.01 USD₮0', detail: source });
  }
  if (lookup?.state === 'done' && lookup.error === undefined) {
    out.push(lookup.listedParent
      ? { key: 'owner', state: 'done', title: `Owned by ${lookup.listedParent}`, detail: `operated by ${lookup.operator || entry.merchant} · S&P 500` }
      : { key: 'owner', state: 'done', title: 'Not a listed company', detail: lookup.operator ? `operated by ${lookup.operator}` : 'unknown to the lookup' });
  }
  if (category) out.push({ key: 'category', state: 'done', title: `${category.name} → its leader, ${category.leader}`, detail: `matched on this phone · score ${category.score.toFixed(2)}` });

  const [company] = investedIn(entry);
  const value = pay?.value !== undefined ? shown(pay.value) : '';
  const of = company ? `${value ? `${value} of ` : ''}${company}` : value;
  if (pay?.error !== undefined) out.push(pay.error.startsWith('Nothing bought') ? { key: 'buy', state: 'skipped', title: pay.error, detail: '' }
    : { key: 'buy', state: 'failed', title: company ? `Buying ${company} failed` : 'The buy failed', detail: pay.error });
  else if (pay?.state === 'bought') out.push(pay.confirmed === false
    ? { key: 'buy', state: 'failed', title: 'The buy failed on Sepolia', detail: `${company ?? entry.merchant} · reverted`, ...tx(pay.transaction) }
    : { key: 'buy', state: 'done', title: `Bought ${of}`, detail: 'signed on this phone · gas paid by the paymaster', ...tx(pay.transaction) });
  else if (pay) out.push({ key: 'buy', state: 'active', title: `Buying ${of}`, detail: WAITING[pay.state] });
  else if (at.buy === 'active') out.push({ key: 'buy', state: 'active', title: company ? `Buying ${company}` : 'Buying', detail: 'about to sign on this phone' });
  else if (at.buy === 'pending') out.push({ key: 'buy', state: 'pending', title: 'Buy', detail: '' });
  return out;
}

const WAITING = { signing: 'signing on this phone', sending: 'sending, gas paid by the paymaster', mining: 'waiting for Sepolia to include it', bought: '' } as const;
