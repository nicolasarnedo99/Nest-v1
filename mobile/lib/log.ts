// The activity log: what the results list showed, kept so it survives closing the
// app. It is a record, not a control: nothing here decides or blocks a payment.
import { parseAmount } from '../../server/money';
import type { Placement } from './merchant';

// `source` is where the lookup's answer came from ("demo data"); entries saved before it was recorded have none.
export type Lookup = { state: 'paying' | 'done'; operator?: string | null; listedParent?: string | null; fee?: string; transaction?: string; error?: string; agent?: string; source?: string };
export type Pay = { state: 'signing' | 'sending' | 'mining' | 'bought'; value?: string; transaction?: string; userOperation?: string; confirmed?: boolean; error?: string };
// `model` is the label of the model that decided; entries saved before the model choice carry `tuned` instead.
// A demo shop order, or a Bitrefill item bought from the Sepolia mirror (`seller: 'bitrefill'`). `amount` is micro-units of USD₮0 as digits.
// `payTo`, `scheme` and `network` are the checked 402 terms and `signed` marks the signature, so the sheet can show the exchange; older entries have none.
export type Order = { state: 'paying' | 'done'; productId: string; title: string; amount: string;
  agent?: string; orderId?: string; transaction?: string; error?: string; checkedAt?: string; payTo?: string; scheme?: string; network?: string; signed?: boolean } &
  ({ seller?: undefined; priceAed: string; source: 'recorded' | 'sample' | 'live' } | { seller: 'bitrefill'; packageValue: string; priceUsd: string; wouldPay: WouldPay });
// What Bitrefill's own invoice would ask on Arbitrum, recorded by the mirror; display only, never paid.
export type WouldPay = { seller: string; scheme: string; network: string; asset: string; payTo: string; amount: string };
// `placement` is the step mobile/lib/merchant.ts ended on; entries the 2B decided (before the brand table) have none.
// An order's entry also carries the invest after it: the company and why (`owner of` a brand or `leader of` a category), then the buy. Older entries have neither.
export type Entry = { at: number; merchant: string; amount?: string; model: string } &
  ({ company: string | null; explanation: string; seconds: number; pay?: Pay; lookup?: Lookup; category?: CategoryPick; placement?: Placement['step'] } | { error: string } | { order: Order; invest?: InvestTarget; pay?: Pay });
export type InvestTarget = { company: string; reason: 'owner' | 'leader'; of: string };
// The listed leader of the merchant's category, matched on the phone when no listed owner was found.
export type CategoryPick = { name: string; leader: string; score: number };

const PLACEMENTS: readonly Placement['step'][] = ['instruction', 'unread', 'no-candidate', 'unlisted', 'ambiguous', 'none', 'picked'];

export const LIMIT = 200; // shortcut: the file is rewritten whole and the oldest entries fall off, move to SQLite for a real history.

const STATES = ['signing', 'sending', 'mining', 'bought'];
const optional = (value: unknown, type: string) => value === undefined || typeof value === type;
const optionalOrNull = (value: unknown) => value === undefined || value === null || typeof value === 'string';
// A bad value drops the field, not the record. parseAmount applies AMOUNT_PATTERN and rejects zero.
const validAmount = (v: unknown): v is string => { try { parseAmount(v as string); return typeof v === 'string'; } catch { return false; } };
const pick = (r: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => r[k] !== undefined).map(k => [k, r[k]]));

// A lookup that was neither finished nor failed may have paid its fee, so it is never shown as pending.
function cleanLookup(l: any): Lookup | null {
  if (!l || typeof l !== 'object' || !['paying', 'done'].includes(l.state) || !optionalOrNull(l.operator) || !optionalOrNull(l.listedParent) ||
    !optional(l.fee, 'string') || !optional(l.transaction, 'string') || !optional(l.error, 'string')) return null;
  const error = l.state === 'paying' && l.error === undefined ? 'Lookup interrupted, a fee may have been paid' : l.error;
  // The ERC-8004 agent id is display only, so a bad one drops the field, not the record.
  return { ...pick(l, ['state', 'operator', 'listedParent', 'fee', 'transaction']), ...(typeof l.agent === 'string' && l.agent !== '' ? { agent: l.agent } : {}),
    ...(typeof l.source === 'string' && l.source !== '' ? { source: l.source } : {}), // display only, like the agent
    ...(error !== undefined ? { error } : {}) } as Lookup;
}

// Copies exactly the six string fields (amount as digits), or null.
export function wouldPayOf(w: any): WouldPay | null {
  const keys = ['seller', 'scheme', 'network', 'asset', 'payTo', 'amount'] as const;
  if (!w || typeof w !== 'object' || Array.isArray(w) || !keys.every(k => typeof w[k] === 'string' && w[k] !== '') || !/^\d+$/.test(w.amount)) return null;
  return pick(w, [...keys]) as WouldPay;
}

// Like a lookup, an order that was neither finished nor failed may have been paid, so it is never shown as pending.
function cleanOrder(o: any): Order | null {
  const bitrefill = o?.seller === 'bitrefill';
  const own = bitrefill ? ['packageValue', 'priceUsd'] : ['priceAed'];
  if (!o || typeof o !== 'object' || !['paying', 'done'].includes(o.state) || (o.seller !== undefined && !bitrefill) ||
    (!bitrefill && !['recorded', 'sample', 'live'].includes(o.source)) ||
    !['productId', 'title', 'amount', ...own].every(k => typeof o[k] === 'string') || !/^\d+$/.test(o.amount) ||
    !['agent', 'orderId', 'transaction', 'error', 'checkedAt'].every(k => optional(o[k], 'string'))) return null;
  const wouldPay = bitrefill ? wouldPayOf(o.wouldPay) : null;
  if (bitrefill && !wouldPay) return null;
  const error = o.state === 'paying' && o.error === undefined ? 'Order interrupted, it may have been paid, check Etherscan' : o.error;
  // The 402 terms are display only, so a bad one drops the field, not the record.
  const terms = { ...(typeof o.payTo === 'string' && /^0x[0-9a-fA-F]{40}$/.test(o.payTo) ? { payTo: o.payTo } : {}),
    ...(o.scheme === 'exact' ? { scheme: o.scheme } : {}), ...(typeof o.network === 'string' && /^eip155:\d+$/.test(o.network) ? { network: o.network } : {}),
    ...(o.signed === true ? { signed: true } : {}) };
  return { ...pick(o, ['state', 'productId', 'title', 'amount', 'agent', 'orderId', 'transaction', 'checkedAt', ...own, ...(bitrefill ? ['seller'] : ['source'])]),
    ...terms, ...(wouldPay ? { wouldPay } : {}), ...(error !== undefined ? { error } : {}) } as Order;
}

// Rebuilds an entry from only the fields it knows, so nothing else stored in the file is carried along.
function clean(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (typeof r.at !== 'number' || typeof r.merchant !== 'string' || !optional(r.amount, 'string')) return null;
  const model = typeof r.model === 'string' ? r.model : typeof r.tuned === 'boolean' ? (r.tuned ? 'Qwen3 1.7B, fine-tuned' : 'Qwen3 1.7B, untuned') : null;
  if (model === null) return null;
  const base = { at: r.at, merchant: r.merchant, ...(r.amount !== undefined ? { amount: r.amount } : {}), model };
  if (typeof r.error === 'string') return { ...base, error: r.error };
  if (r.order !== undefined) {
    const order = cleanOrder(r.order);
    const v = r.invest;
    if (!order || (v !== undefined && (!v || typeof v !== 'object' || typeof v.company !== 'string' || v.company === '' || !['owner', 'leader'].includes(v.reason) || typeof v.of !== 'string'))) return null;
    if (v === undefined) return r.pay === undefined ? { ...base, order } : null; // a buy is never kept without what it bought
    const pay = r.pay === undefined ? undefined : cleanPay(r.pay);
    return pay === null ? null : { ...base, order, invest: { company: v.company, reason: v.reason, of: v.of }, ...(pay ? { pay } : {}) };
  }
  if (!(r.company === null || typeof r.company === 'string') || typeof r.explanation !== 'string' || typeof r.seconds !== 'number') return null;
  const lookup = r.lookup === undefined ? undefined : cleanLookup(r.lookup);
  if (lookup === null) return null;
  const c = r.category;
  if (c !== undefined && (!c || typeof c !== 'object' || typeof c.name !== 'string' || typeof c.leader !== 'string' || typeof c.score !== 'number' || !Number.isFinite(c.score))) return null;
  const category = c === undefined ? undefined : { name: c.name, leader: c.leader, score: c.score };
  const decision = { ...base, company: r.company, explanation: r.explanation, seconds: r.seconds, ...(lookup ? { lookup } : {}), ...(category ? { category } : {}),
    ...(PLACEMENTS.includes(r.placement) ? { placement: r.placement as Placement['step'] } : {}) }; // display only: a bad step drops the field
  if (r.pay === undefined) return decision;
  const pay = cleanPay(r.pay);
  return pay ? { ...decision, pay } : null;
}

function cleanPay(p: any): Pay | null {
  if (!p || typeof p !== 'object' || !STATES.includes(p.state) || !optional(p.transaction, 'string') || !optional(p.userOperation, 'string') || !optional(p.confirmed, 'boolean') || !optional(p.error, 'string')) return null;
  // A buy that was neither finished nor failed may still have landed, so it is never shown as pending.
  const interrupted = p.state !== 'bought' && p.error === undefined
    ? `Interrupted while ${p.state}, a buy may have been sent, check Etherscan${p.userOperation ? ` (UserOperation ${p.userOperation})` : ''}` : p.error;
  return { state: p.state, ...(validAmount(p.value) ? { value: p.value } : {}),
    ...(p.transaction !== undefined ? { transaction: p.transaction } : {}),
    ...(p.userOperation !== undefined ? { userOperation: p.userOperation } : {}),
    ...(p.confirmed !== undefined ? { confirmed: p.confirmed } : {}), ...(interrupted !== undefined ? { error: interrupted } : {}) };
}

// A missing file is an empty log. A corrupt one is also empty, but says so in `problem`.
// The UserOperation of a buy that a relaunch cut off mid-flight (see cleanPay), so it can be checked once with the bundler.
export function unsettledBuy(entry: Entry): string | null {
  const pay = 'pay' in entry ? entry.pay : undefined;
  return pay?.userOperation && pay.state !== 'bought' && pay.error?.startsWith('Interrupted') ? pay.userOperation : null;
}

export function parseLog(text: string | null): { entries: Entry[]; problem?: string } {
  if (text === null) return { entries: [] };
  let list: unknown;
  try { list = JSON.parse(text); } catch { return { entries: [], problem: 'The activity log was unreadable and was ignored' }; }
  if (!Array.isArray(list)) return { entries: [], problem: 'The activity log was unreadable and was ignored' };
  const entries = list.map(clean).filter((e): e is Entry => e !== null).slice(0, LIMIT);
  const dropped = list.length - entries.length;
  return dropped > 0 && list.length <= LIMIT ? { entries, problem: `${dropped} unreadable activity log entries were dropped` } : { entries };
}

// Newest first. An entry with the same timestamp is replaced: a payment result updates its decision.
export function record(entries: Entry[], entry: Entry): Entry[] {
  return [entry, ...entries.filter(e => e.at !== entry.at)].slice(0, LIMIT);
}
