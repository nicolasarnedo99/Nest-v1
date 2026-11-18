// The activity log: what the results list showed, kept so it survives closing the
// app. It is a record, not a control: nothing here decides or blocks a payment.
import { parseAmount } from '../../server/money';
import { MODELS } from './settings';

export type Lookup = { state: 'paying' | 'done'; operator?: string | null; listedParent?: string | null; fee?: string; transaction?: string; error?: string; agent?: string };
export type Pay = { state: 'signing' | 'sending' | 'mining' | 'bought'; value?: string; transaction?: string; userOperation?: string; confirmed?: boolean; error?: string };
// `model` is the label of the model that decided; entries saved before the model choice carry `tuned` instead.
export type Entry = { at: number; merchant: string; amount?: string; model: string } &
  ({ company: string | null; explanation: string; seconds: number; pay?: Pay; lookup?: Lookup } | { error: string });

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
    ...(error !== undefined ? { error } : {}) } as Lookup;
}

// Rebuilds an entry from only the fields it knows, so nothing else stored in the file is carried along.
function clean(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (typeof r.at !== 'number' || typeof r.merchant !== 'string' || !optional(r.amount, 'string')) return null;
  const model = typeof r.model === 'string' ? r.model : typeof r.tuned === 'boolean' ? (r.tuned ? MODELS[0].label : 'Qwen3 1.7B, untuned') : null;
  if (model === null) return null;
  const base = { at: r.at, merchant: r.merchant, ...(r.amount !== undefined ? { amount: r.amount } : {}), model };
  if (typeof r.error === 'string') return { ...base, error: r.error };
  if (!(r.company === null || typeof r.company === 'string') || typeof r.explanation !== 'string' || typeof r.seconds !== 'number') return null;
  const lookup = r.lookup === undefined ? undefined : cleanLookup(r.lookup);
  if (lookup === null) return null;
  const decision = { ...base, company: r.company, explanation: r.explanation, seconds: r.seconds, ...(lookup ? { lookup } : {}) };
  if (r.pay === undefined) return decision;
  const p = r.pay;
  if (!p || typeof p !== 'object' || !STATES.includes(p.state) || !optional(p.transaction, 'string') || !optional(p.userOperation, 'string') || !optional(p.confirmed, 'boolean') || !optional(p.error, 'string')) return null;
  // A buy that was neither finished nor failed may still have landed, so it is never shown as pending.
  const interrupted = p.state !== 'bought' && p.error === undefined
    ? `Interrupted while ${p.state}, a buy may have been sent, check Etherscan${p.userOperation ? ` (UserOperation ${p.userOperation})` : ''}` : p.error;
  return { ...decision, pay: { state: p.state, ...(validAmount(p.value) ? { value: p.value } : {}),
    ...(p.transaction !== undefined ? { transaction: p.transaction } : {}),
    ...(p.userOperation !== undefined ? { userOperation: p.userOperation } : {}),
    ...(p.confirmed !== undefined ? { confirmed: p.confirmed } : {}), ...(interrupted !== undefined ? { error: interrupted } : {}) } };
}

// A missing file is an empty log. A corrupt one is also empty, but says so in `problem`.
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
