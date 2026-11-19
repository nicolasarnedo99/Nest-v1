// The demo shop client: search and quote are free GETs, the order is paid over x402 (paidOrder). Every answer is parsed strictly.
export type ShopProduct = { id: string; title: string; url: string; priceAed: string; approxUsdt: string; verified: boolean; recordedAt: string };
export type ShopQuote = { token: string; quote: { quoteId: string; productId: string; priceAed: string; amount: string; source: 'recorded' | 'sample' | 'live'; checkedAt: string; expiresAt: number } };
export type OrderAnswer = { orderId: string; productId: string; title: string; priceAed: string; amount: string; note: string };

type Fields = Record<string, unknown>;
const object = (value: unknown): Fields => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Shop returned an unreadable answer');
  return value as Fields;
};
// Copies exactly the named string fields, so nothing unchecked rides along.
function strings<K extends string>(value: unknown, keys: readonly K[]): Record<K, string> {
  const fields = object(value);
  for (const key of keys) if (typeof fields[key] !== 'string') throw new Error('Shop returned an unreadable answer');
  return Object.fromEntries(keys.map(key => [key, fields[key]])) as Record<K, string>;
}

export function parseProduct(value: unknown): ShopProduct {
  const verified = object(value).verified;
  if (typeof verified !== 'boolean') throw new Error('Shop returned an unreadable answer');
  return { ...strings(value, ['id', 'title', 'url', 'priceAed', 'approxUsdt', 'recordedAt']), verified };
}

function parseQuote(value: unknown): ShopQuote {
  const { token } = strings(value, ['token']);
  const raw = object(object(value).quote);
  const quote = strings(raw, ['quoteId', 'productId', 'priceAed', 'amount', 'checkedAt']);
  const { source, expiresAt } = raw;
  if ((source !== 'recorded' && source !== 'sample' && source !== 'live') || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)
    || !/^\d+$/.test(quote.amount)) throw new Error('Shop returned an unreadable answer');
  return { token, quote: { ...quote, source, expiresAt } };
}

export function parseOrder(value: unknown): OrderAnswer {
  const order = strings(value, ['orderId', 'productId', 'title', 'priceAed', 'amount', 'note']);
  if (!/^\d+$/.test(order.amount)) throw new Error('Shop returned an unreadable answer');
  return order;
}

async function get(url: URL, timeoutMs: number, doFetch: typeof fetch): Promise<unknown> {
  const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status !== 200) throw new Error(`Shop answered ${response.status}`);
  return response.json();
}

export async function searchShop(base: string, query: string, maxAed: string | null, doFetch: typeof fetch = fetch): Promise<ShopProduct[]> {
  const url = new URL(`${base}/search`);
  url.searchParams.set('q', query);
  if (maxAed !== null) url.searchParams.set('maxAed', maxAed);
  const { products } = object(await get(url, 15_000, doFetch));
  if (!Array.isArray(products)) throw new Error('Shop returned an unreadable answer');
  return products.map(parseProduct);
}

export async function quoteShop(base: string, id: string, doFetch: typeof fetch = fetch): Promise<ShopQuote> {
  const url = new URL(`${base}/quote`);
  url.searchParams.set('id', id);
  return parseQuote(await get(url, 150_000, doFetch)); // a live Crossmint price can take the server up to ~134 s
}

export const orderUrl = (base: string, token: string) => `${base}/order?quote=${encodeURIComponent(token)}`;
