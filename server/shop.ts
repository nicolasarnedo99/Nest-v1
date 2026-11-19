// The demo shop: a small catalog of real amazon.ae products with recorded prices.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import type { Address } from 'viem';
import { x402ResourceServer, type FacilitatorClient, type HTTPRequestContext } from '@x402/core/server';
import { ExactEvmScheme as ServerScheme } from '@x402/evm/exact/server';
import { paymentMiddleware } from '@x402/express';
import { normalise } from './lookup.js';
import { formatMicro } from './money.js';
import catalog from './shop/catalog.json' with { type: 'json' };

export type Product = { id: string; title: string; keywords: string[]; url: string; priceAed: string; recordedAt: string; verified: boolean; note: string };

const cents = (aed: string) => BigInt(aed.replace('.', ''));

// maxAed is in fils (AED x 100). Every query word (3+ letters) must appear in the title or keywords; at most 5, cheapest first.
export function searchCatalog(query: string, maxAed: bigint | null, products: Product[] = catalog): Product[] {
  const wordsOf = (p: Product) => new Set(normalise(`${p.title} ${p.keywords.join(' ')}`));
  const catalogWords = new Set(products.flatMap(p => [...wordsOf(p)]));
  // Words no product uses ("shipped", "house") are ignored, so a request phrased as a sentence still finds the product.
  const wanted = normalise(query).filter(word => word.length > 2 && catalogWords.has(word));
  if (wanted.length === 0) return [];
  return products
    .filter(p => {
      const words = wordsOf(p);
      return wanted.every(word => words.has(word)) && (maxAed === null || cents(p.priceAed) <= maxAed);
    })
    .sort((a, b) => Number(cents(a.priceAed) - cents(b.priceAed)) || a.title.localeCompare(b.title))
    .slice(0, 5);
}

export const AED_PER_USDT = '3.6725';

// ceil(aed x 10^6 / 3.6725) in bigint: fils x 10^6 x 10^4 / (100 x 36725), no floats.
export function aedToMicro(aed: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(aed)) throw new Error('aed: invalid price');
  const [whole, fraction = ''] = aed.split('.');
  const fils = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (fils === 0n) throw new Error('aed: price must be positive');
  const divisor = 36725n;
  return (fils * 10_000_000000n / 100n + divisor - 1n) / divisor;
}

export type PriceQuote = { priceAed: string; source: 'recorded' | 'sample' | 'live'; checkedAt: string };
export interface PriceSource { quote(product: Product): Promise<PriceQuote> }

export class RecordedPriceSource implements PriceSource {
  async quote(p: Product): Promise<PriceQuote> {
    return { priceAed: p.priceAed, source: p.verified ? 'recorded' : 'sample', checkedAt: p.recordedAt };
  }
}

export type Quote = { quoteId: string; productId: string; priceAed: string; amount: string; source: PriceQuote['source']; checkedAt: string; expiresAt: number };

const b64 = (data: string | Buffer) => Buffer.from(data).toString('base64url');
const mac = (payload: string, secret: Uint8Array) => createHmac('sha256', secret).update(payload).digest();

// The amount must be exactly the conversion of priceAed, so a quote-building bug can't mint a mispriced token.
function amountMatches(q: { amount: string; priceAed: string }): boolean {
  try { return /^\d+$/.test(q.amount) && BigInt(q.amount) === aedToMicro(q.priceAed); } catch { return false; }
}

export function signQuote(quote: Quote, secret: Uint8Array): string {
  if (!amountMatches(quote)) throw new Error('quote: malformed');
  const payload = b64(JSON.stringify(quote));
  return `${payload}.${b64(mac(payload, secret))}`;
}

export function verifyQuote(token: string, secret: Uint8Array, now: number): Quote {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('quote: malformed');
  const given = Buffer.from(parts[1], 'base64url');
  const expected = mac(parts[0], secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('quote: bad signature');
  let q: Record<string, unknown>;
  try { q = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new Error('quote: malformed'); }
  const str = (k: string) => typeof q?.[k] === 'string';
  if (!q || typeof q !== 'object' || !['quoteId', 'productId', 'priceAed', 'amount', 'checkedAt'].every(str)
    || !['recorded', 'sample', 'live'].includes(q.source as string) || typeof q.expiresAt !== 'number' || !Number.isFinite(q.expiresAt)) {
    throw new Error('quote: malformed');
  }
  if (!amountMatches(q as Quote)) throw new Error('quote: malformed');
  if (now >= (q.expiresAt as number)) throw new Error('quote: expired');
  const { quoteId, productId, priceAed, amount, source, checkedAt, expiresAt } = q as Quote;
  return { quoteId, productId, priceAed, amount, source, checkedAt, expiresAt };
}

export type ShopOptions = {
  facilitator: FacilitatorClient; payTo: Address; chainId: number; token: Address; tokenName: string;
  prices: PriceSource; secret: Uint8Array; catalog?: Product[]; now?: () => number; limitPerMinute?: number;
  // Called once per order that was paid, settled and served.
  onOrdered?: (order: { orderId: string; productId: string; amount: string; transaction: string }) => void;
};

const QUOTE_LIFETIME = 10 * 60_000;
const text = (raw: unknown, max: number) => typeof raw === 'string' && raw.trim().length >= 1 && raw.trim().length <= max && !/[\x00-\x1f\x7f]/.test(raw) ? raw.trim() : null;

// Every route lives under /shop and there is no catch-all, so other paths fall through to the lookup app.
export function createShopApp(options: ShopOptions) {
  const app = express();
  const products = options.catalog ?? catalog;
  const now = options.now ?? Date.now;
  const limit = options.limitPerMinute ?? 60;
  const network = `eip155:${options.chainId}` as const;
  app.disable('x-powered-by');
  let windowStart = 0, count = 0;
  app.use('/shop', (_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const time = now();
    if (time - windowStart >= 60_000) { windowStart = time; count = 0; }
    if (++count > limit) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'Shop limit reached; wait one minute' }); return;
    }
    next();
  });

  app.get('/shop/search', (request, response) => {
    const q = text(request.query.q, 80);
    const max = request.query.maxAed;
    if (!q || (max !== undefined && (typeof max !== 'string' || !/^\d+(\.\d{1,2})?$/.test(max)))) {
      response.status(400).json({ error: 'q must be 1 to 80 characters of text; maxAed a decimal with up to 2 places' }); return;
    }
    const [whole, fraction = ''] = typeof max === 'string' ? max.split('.') : [];
    const fils = whole === undefined ? null : BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    response.json({ products: searchCatalog(q, fils, products).map(({ id, title, url, priceAed, verified, recordedAt }) =>
      ({ id, title, url, priceAed, approxUsdt: formatMicro(aedToMicro(priceAed)), verified, recordedAt })) });
  });

  app.get('/shop/quote', async (request, response) => {
    const product = products.find(p => p.id === request.query.id);
    if (!product) { response.status(404).json({ error: 'Unknown product' }); return; }
    const { priceAed, source, checkedAt } = await options.prices.quote(product);
    const quote: Quote = { quoteId: randomUUID(), productId: product.id, priceAed, amount: aedToMicro(priceAed).toString(),
      source, checkedAt, expiresAt: now() + QUOTE_LIFETIME };
    response.json({ token: signQuote(quote, options.secret), quote });
  });

  // shortcut: used quotes live in memory, a restart forgets them, but quotes expire in 10 min anyway
  const used = new Set<string>();
  const pending = new Set<string>(); // a paid request is between verify and settle; a second one for the same quote waits its turn
  const validOrder: RequestHandler = (request, response, next) => {
    const token = request.query.quote;
    let quote: Quote;
    try { quote = verifyQuote(typeof token === 'string' ? token : '', options.secret, now()); }
    // An expired quote is a conflict like a used one, so the phone fetches a new quote; a bad token stays 400.
    catch (error) { const message = (error as Error).message; response.status(message === 'quote: expired' ? 409 : 400).json({ error: message }); return; }
    const product = products.find(p => p.id === quote.productId);
    if (!product) { response.status(400).json({ error: 'quote: unknown product' }); return; }
    if (used.has(quote.quoteId) || pending.has(quote.quoteId)) { response.status(409).json({ error: 'quote already used' }); return; }
    response.locals.quote = quote;
    response.locals.product = product;
    next();
  };
  // The price function only sees x402's request context; validOrder already checked this token, so this re-read cannot fail
  // unless the quote expires in between, which fails closed (no payment is taken).
  const quotedPrice = (context: HTTPRequestContext) => {
    const token = context.adapter.getQueryParam?.('quote');
    const quote = verifyQuote(typeof token === 'string' ? token : '', options.secret, now());
    return { amount: quote.amount, asset: options.token, extra: { name: options.tokenName, version: '1', decimals: 6 } };
  };
  // One paywall per product, because the route description names the product.
  const paywalls = new Map(products.map(p => [p.id, paymentMiddleware({ 'GET /shop/order': { accepts: [{ scheme: 'exact', network,
    payTo: options.payTo, price: quotedPrice, maxTimeoutSeconds: 120 }],
    description: `A demo order at Nest demo shop for ${p.title}. Demo order, not shipped.`, mimeType: 'application/json' } },
    new x402ResourceServer(options.facilitator).register(network, new ServerScheme()))]));
  // verify → handler (buffered by @x402/express) → settle; the paywall's promise resolves after settlement, even if the client hung up.
  const pay: RequestHandler = async (request, response, next) => {
    const quote = response.locals.quote as Quote;
    const paying = Boolean(request.header('payment-signature') || request.header('x-payment'));
    if (paying) pending.add(quote.quoteId);
    try { await paywalls.get(quote.productId)!(request, response, next); }
    finally { if (paying) pending.delete(quote.quoteId); }
    const header = response.getHeader('payment-response');
    if (response.statusCode !== 200 || typeof header !== 'string') return;
    // shortcut: a settle that broadcast but failed its receipt wait leaves the quote unused, so the same token could be paid again within its 10 minutes (the phone always fetches a fresh quote); upgrade by marking the quote used once settlement reaches broadcast.
    used.add(quote.quoteId);
    const { transaction } = JSON.parse(Buffer.from(header, 'base64').toString()) as { transaction: string };
    options.onOrdered?.({ orderId: response.locals.orderId as string, productId: quote.productId, amount: quote.amount, transaction });
  };
  app.get('/shop/order', validOrder, pay, (_request, response) => {
    const quote = response.locals.quote as Quote;
    const orderId = response.locals.orderId = randomUUID();
    response.json({ orderId, productId: quote.productId, title: (response.locals.product as Product).title, priceAed: quote.priceAed,
      amount: quote.amount, note: 'Demo order, not shipped' });
  });
  const failed: ErrorRequestHandler = (_error, _request, response, _next) => { response.status(500).json({ error: 'Request failed' }); };
  app.use(failed);
  return app;
}
