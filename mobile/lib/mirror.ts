// The Bitrefill mirror client: a free quote whose price the mirror checked with Bitrefill, then the order paid over x402 on Sepolia.
// What Bitrefill itself would ask on Arbitrum comes back as `wouldPay`, for display only. Every answer is parsed strictly.
import { wouldPayOf, type WouldPay } from './log';
import { OrderFailed, countOrder, paidRequest, type OrderInput } from './x402';
import type { BitrefillItem } from './bitrefill';
import type { Intent } from './chat';

export type MirrorQuote = { token: string; wouldPay: WouldPay; quote: { quoteId: string; slug: string; title: string; kind: BitrefillItem['kind'];
  packageValue: string; packageCurrency: string; priceUsd: string; amount: string; checkedAt: string; expiresAt: number } };
export type MirrorOrder = { orderId: string; slug: string; title: string; packageValue: string; amount: string; wouldPay: WouldPay; note: string };

const UNREADABLE = 'Bitrefill mirror returned an unreadable answer';
type Fields = Record<string, unknown>;
const object = (value: unknown): Fields => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(UNREADABLE);
  return value as Fields;
};
// Copies exactly the named string fields, so nothing unchecked rides along.
function strings<K extends string>(value: unknown, keys: readonly K[]): Record<K, string> {
  const fields = object(value);
  for (const key of keys) if (typeof fields[key] !== 'string') throw new Error(UNREADABLE);
  return Object.fromEntries(keys.map(key => [key, fields[key]])) as Record<K, string>;
}
const wouldPay = (value: unknown) => { const w = wouldPayOf(value); if (!w) throw new Error(UNREADABLE); return w; };

// The quote must be for the item and package asked for, and its would-pay line for the same amount.
export function parseMirrorQuote(value: unknown, slug: string, packageValue: string): MirrorQuote {
  const { token } = strings(value, ['token']);
  const raw = object(object(value).quote);
  const quote = strings(raw, ['quoteId', 'slug', 'title', 'kind', 'packageValue', 'packageCurrency', 'priceUsd', 'amount', 'checkedAt']);
  const { expiresAt } = raw;
  const would = wouldPay(object(value).wouldPay);
  if (!['giftcard', 'esim', 'topup'].includes(quote.kind) || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || !/^\d+$/.test(quote.amount) ||
    BigInt(quote.amount) === 0n || quote.slug !== slug || quote.packageValue !== packageValue || would.amount !== quote.amount) throw new Error(UNREADABLE);
  return { token, wouldPay: would, quote: { ...quote, kind: quote.kind as BitrefillItem['kind'], expiresAt } };
}

export function parseMirrorOrder(value: unknown): MirrorOrder {
  const order = strings(value, ['orderId', 'slug', 'title', 'packageValue', 'amount', 'note']);
  if (!/^\d+$/.test(order.amount)) throw new Error(UNREADABLE);
  return { ...order, wouldPay: wouldPay(object(value).wouldPay) };
}

export async function quoteMirror(base: string, slug: string, packageValue: string, doFetch: typeof fetch = fetch): Promise<MirrorQuote> {
  const url = new URL(`${base}/quote`);
  url.searchParams.set('slug', slug);
  url.searchParams.set('package', packageValue);
  const response = await doFetch(url, { signal: AbortSignal.timeout(45_000) }); // the mirror asks Bitrefill first
  if (response.status !== 200) throw new Error(`Bitrefill mirror answered ${response.status}`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error(UNREADABLE); }
  return parseMirrorQuote(body, slug, packageValue);
}

// "10 AED" for a face value, "1GB, 7 Days" as is for a plan.
export const packageLabel = (value: string, currency: string) => (/^\d+(\.\d+)?$/.test(value) ? `${value} ${currency}` : value);

export const mirrorOrderUrl = (base: string, token: string) => `${base}/order?quote=${encodeURIComponent(token)}`;

// Pays a mirror quote like a demo shop order: same refusals, only the answer differs.
export async function paidMirrorOrder(input: OrderInput): Promise<{ order: MirrorOrder; amount: bigint; transaction: string | null }> {
  const { result, amount, transaction } = await paidRequest({ ...input, url: new URL(input.url), count: countOrder,
    failure: (message, mayBePaid) => new OrderFailed(message, mayBePaid), parse: parseMirrorOrder,
    words: { unavailable: 'Order unavailable', interrupted: 'Order interrupted, it may have been paid, check Etherscan', unreadable: 'Bitrefill mirror returned an unreadable order' } });
  return { order: result, amount, transaction };
}

// What to ask Bitrefill for a chat search: the kind from the words, the words that only name the kind dropped
// ("eSIM for Spain" searches eSIMs for "Spain"), and the UAE store for a gift card priced in dirhams.
export function bitrefillSearches(intent: Intent, kinds: Array<BitrefillItem['kind']>): { kind: BitrefillItem['kind']; query: string; country?: string }[] {
  const query = intent.query.replace(/\b(e?sims?|data|roaming|top[- ]?ups?|airtime|credit|gift[- ]?cards?|vouchers?|for|in|a|an|the)\b/gi, ' ').replace(/\s+/g, ' ').trim() || intent.query.trim();
  return kinds.map(kind => ({ kind, query, ...(kind === 'giftcard' && intent.currency === 'AED' ? { country: 'AE' } : {}) }));
}
