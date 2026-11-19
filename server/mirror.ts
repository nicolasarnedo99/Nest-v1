// The Bitrefill mirror: a demo seller of real Bitrefill items. It checks the price with Bitrefill, quotes it, and takes
// payment over x402 on Sepolia like /shop/order. It never calls Bitrefill's invoice/pay, so no card is issued; wouldPay
// records what Bitrefill's invoice/pay 402 asks for the same item (captured in tests/fixtures/bitrefill/).
import { randomUUID } from 'node:crypto';
import express from 'express';
import { NotSoldInUsd, SLUG, type Bitrefill, type Kind } from './bitrefill.js';
import { failed, guard, quotedOrder, seal, unseal, type Seller } from './shop.js';

export const NOTE = 'Demo purchase on Sepolia · the card is not issued';
const DESCRIPTION = 'A demo purchase of a Bitrefill item at the Bitrefill mirror (Sepolia). The card is not issued.';
const QUOTE_LIFETIME = 10 * 60_000;
// Package values look like "10" or "1GB, 7 Days".
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9 .,]{0,39}$/;

// USD₮0 on Arbitrum, from the invoice/pay 402 captured on 19 Nov 2026. payTo was seen on one invoice only.
export const wouldPay = (amount: string) => ({ seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161',
  asset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', payTo: '0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A', amount } as const);

export type MirrorQuote = { quoteId: string; slug: string; title: string; kind: Kind; packageValue: string; packageCurrency: string;
  priceUsd: string; amount: string; checkedAt: string; expiresAt: number };

// A USD decimal in 6-decimal token units, rounded up so the mirror never asks for less than Bitrefill's price.
export function usdToMicro(usd: string): bigint {
  const match = /^(\d{1,9})(?:\.(\d{1,18}))?$/.exec(usd);
  if (!match) throw new Error('usd: invalid price');
  const fraction = match[2] ?? '';
  const scale = 10n ** BigInt(Math.max(fraction.length, 6));
  const exact = BigInt(match[1]!) * scale + BigInt(fraction.padEnd(6, '0'));
  const divisor = scale / 1_000_000n;
  const micro = (exact + divisor - 1n) / divisor;
  if (micro === 0n) throw new Error('usd: price must be positive');
  return micro;
}

function amountMatches(q: { amount: unknown; priceUsd: unknown }): boolean {
  try { return typeof q.amount === 'string' && /^\d+$/.test(q.amount) && BigInt(q.amount) === usdToMicro(q.priceUsd as string); } catch { return false; }
}

export function signMirrorQuote(quote: MirrorQuote, secret: Uint8Array): string {
  if (!amountMatches(quote)) throw new Error('quote: malformed');
  return seal(quote, secret);
}

// A shop quote (no slug, priceAed) fails here as malformed, and a mirror quote fails the shop's verifyQuote.
export function verifyMirrorQuote(token: string, secret: Uint8Array, now: number): MirrorQuote {
  const q = unseal(token, secret);
  const str = (k: string) => typeof q[k] === 'string';
  if (!['quoteId', 'slug', 'title', 'packageValue', 'packageCurrency', 'priceUsd', 'amount', 'checkedAt'].every(str)
    || !SLUG.test(q.slug as string) || !['giftcard', 'esim', 'topup'].includes(q.kind as string)
    || typeof q.expiresAt !== 'number' || !Number.isFinite(q.expiresAt) || !amountMatches(q as MirrorQuote)) {
    throw new Error('quote: malformed');
  }
  if (now >= (q.expiresAt as number)) throw new Error('quote: expired');
  const { quoteId, slug, title, kind, packageValue, packageCurrency, priceUsd, amount, checkedAt, expiresAt } = q as MirrorQuote;
  return { quoteId, slug, title, kind, packageValue, packageCurrency, priceUsd, amount, checkedAt, expiresAt };
}

export type MirrorOptions = Seller & {
  bitrefill: Pick<Bitrefill, 'productDetail'>; secret: Uint8Array; now?: () => number; limitPerMinute?: number;
  // Called once per order that was paid, settled and served.
  onOrdered?: (order: { orderId: string; slug: string; packageValue: string; amount: string; transaction: string }) => void;
};

// Every route lives under /mirror/bitrefill and there is no catch-all, so other paths fall through to the shop and lookup.
export function createMirrorApp(options: MirrorOptions) {
  const app = express();
  const now = options.now ?? Date.now;
  app.disable('x-powered-by');
  app.use('/mirror', guard(now, options.limitPerMinute ?? 60, 'Mirror limit reached; wait one minute'));

  app.get('/mirror/bitrefill/quote', async (request, response) => {
    const { slug, package: value } = request.query;
    if (typeof slug !== 'string' || !SLUG.test(slug) || typeof value !== 'string' || !PACKAGE.test(value)) {
      response.status(400).json({ error: 'slug must be 1 to 80 of a-z, 0-9 and -; package 1 to 40 of letters, digits, spaces, dots and commas' }); return;
    }
    let detail;
    try { detail = await options.bitrefill.productDetail(slug); }
    catch (error) {
      if (error instanceof NotSoldInUsd) { response.status(404).json({ error: 'Not sold in USD at Bitrefill' }); return; }
      console.error(`Mirror: Bitrefill detail for ${slug} failed: ${(error as Error).message}`);
      response.status(503).json({ error: 'Bitrefill is unreachable; nothing was quoted' }); return;
    }
    const found = detail?.packages.find(p => p.value === value);
    if (!detail || !found) { response.status(404).json({ error: detail ? 'Unknown package' : 'Unknown product' }); return; }
    if (!detail.inStock) { response.status(404).json({ error: 'Out of stock at Bitrefill' }); return; }
    const quote: MirrorQuote = { quoteId: randomUUID(), slug, title: detail.name, kind: detail.kind, packageValue: found.value,
      packageCurrency: found.currency, priceUsd: found.priceUsd, amount: usdToMicro(found.priceUsd).toString(),
      checkedAt: new Date(now()).toISOString(), expiresAt: now() + QUOTE_LIFETIME };
    response.json({ token: signMirrorQuote(quote, options.secret), quote, wouldPay: wouldPay(quote.amount) });
  });

  app.get('/mirror/bitrefill/order', ...quotedOrder<MirrorQuote>({ ...options, route: 'GET /mirror/bitrefill/order',
    read: token => verifyMirrorQuote(token, options.secret, now()),
    // One fixed description, so there is a single paywall however many products are quoted.
    describe: () => DESCRIPTION,
    onPaid: (quote, orderId, transaction) => options.onOrdered?.({ orderId, slug: quote.slug, packageValue: quote.packageValue, amount: quote.amount, transaction }) }),
  (_request, response) => {
    const quote = response.locals.quote as MirrorQuote;
    const orderId = response.locals.orderId = randomUUID();
    response.json({ orderId, slug: quote.slug, title: quote.title, packageValue: quote.packageValue, amount: quote.amount,
      wouldPay: wouldPay(quote.amount), note: NOTE });
  });
  app.use(failed);
  return app;
}
