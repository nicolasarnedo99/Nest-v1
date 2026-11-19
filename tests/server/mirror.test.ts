import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import { NotSoldInUsd, parseDetail, type Detail } from '../../server/bitrefill.js';
import { createMirrorApp, signMirrorQuote, usdToMicro, verifyMirrorQuote, type MirrorQuote } from '../../server/mirror.js';
import { createShopApp, RecordedPriceSource, signQuote, verifyQuote, type Quote } from '../../server/shop.js';
import { createLookupApp } from '../../server/lookup.js';

const NETWORK = 'eip155:11155111';
const TOKEN = '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f';
const PAY_TO = '0x1111111111111111111111111111111111111111';
const SECRET = new Uint8Array(32).fill(9);
const NOTE = 'Demo purchase on Sepolia · the card is not issued';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/bitrefill/${name}.json`, import.meta.url), 'utf8')).body;
const DETAILS: Record<string, Detail> = {
  'noon-uae': parseDetail(fixture('products-detail-noon-uae'), 'noon-uae'),
  'bitrefill-esim-spain': parseDetail(fixture('products-detail-esim'), 'bitrefill-esim-spain'),
};

describe('usdToMicro', () => {
  it('converts USD to 6-decimal units, rounding any 7th decimal up', () => {
    expect(usdToMicro('2.82')).toBe(2_820_000n);
    expect(usdToMicro('1407.57')).toBe(1_407_570_000n);
    expect(usdToMicro('2')).toBe(2_000_000n);
    expect(usdToMicro('2.8200001')).toBe(2_820_001n);
    expect(usdToMicro('2.8200000000')).toBe(2_820_000n);
    expect(usdToMicro('0.0000001')).toBe(1n);
  });
  it('refuses zero and anything but a plain decimal', () => {
    for (const bad of ['0', '0.000', '', '-1', '1e3', '2,82', ' 2.82', '2.', '.5']) expect(() => usdToMicro(bad)).toThrow(/^usd: /);
  });
});

function fakeFacilitator(outcome: { valid?: boolean; settled?: boolean } = {}) {
  const calls = { verify: 0, settle: 0 };
  return { calls, outcome, client: {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }], extensions: [], signers: {} }),
    verify: async (payload: any) => { calls.verify++; return outcome.valid === false
      ? { isValid: false, invalidReason: 'invalid_exact_evm_signature' } : { isValid: true, payer: payload.payload.authorization.from }; },
    settle: async (payload: any) => { calls.settle++; return outcome.settled === false
      ? { success: false, errorReason: 'transaction_failed', transaction: '', network: NETWORK }
      : { success: true, transaction: '0xsettled', network: NETWORK, payer: payload.payload.authorization.from }; },
  } };
}

// A Bitrefill stand-in serving the WS0 fixtures; `fail` makes it unreachable.
function fakeBitrefill() {
  const state = { calls: 0, fail: false, notUsd: false, details: { ...DETAILS } };
  return { state, productDetail: async (slug: string) => {
    state.calls++;
    if (state.notUsd) throw new NotSoldInUsd('bitrefill: package is not priced in USD');
    if (state.fail) throw new Error('bitrefill: connect answered 503, expected 402');
    return state.details[slug] ?? null;
  } };
}

// The same composition as server/lookup-service.ts: mirror, then shop, then lookup.
async function start(extra: Partial<Parameters<typeof createMirrorApp>[0]> = {}, facilitator = fakeFacilitator()) {
  const common = { facilitator: facilitator.client as never, payTo: PAY_TO, chainId: 11155111, token: TOKEN, tokenName: 'Test USDT0 copy (Turtle demo)' } as const;
  const orders: unknown[] = [];
  const bitrefill = fakeBitrefill();
  const root = express();
  root.disable('x-powered-by');
  root.use(createMirrorApp({ ...common, bitrefill, secret: SECRET, onOrdered: o => orders.push(o), ...extra }));
  root.use(createShopApp({ ...common, prices: new RecordedPriceSource(), secret: SECRET }));
  root.use(createLookupApp(common));
  const server: Server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, facilitator, orders, bitrefill: bitrefill.state,
    stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
// A payment header built by the real client with a throwaway viem key: the fake facilitator never checks it.
async function paidFetch(url: string, max: string) {
  const { x402Client, wrapFetchWithPayment } = await import('@x402/fetch');
  const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
  const payer = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client();
  client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: TOKEN, maxAmountPerPayment: max }] });
  registerExactEvmScheme(client, { signer: { address: payer.address, signTypedData: d => payer.signTypedData(d as never) } });
  return wrapFetchWithPayment(fetch, client)(url);
}
const quoteUrl = (base: string, slug: string, pkg: string) => `${base}/mirror/bitrefill/quote?slug=${encodeURIComponent(slug)}&package=${encodeURIComponent(pkg)}`;
const getQuote = async (base: string, slug = 'noon-uae', pkg = '10') =>
  (await (await fetch(quoteUrl(base, slug, pkg))).json()) as { token: string; quote: MirrorQuote; wouldPay: Record<string, string> };
const orderUrl = (base: string, token: string) => `${base}/mirror/bitrefill/order?quote=${encodeURIComponent(token)}`;

describe('GET /mirror/bitrefill/quote', () => {
  it('quotes the Bitrefill USD price in token units and records what Bitrefill would ask', async () => {
    const s = await start({ now: () => 1_000_000 });
    try {
      const res = await fetch(quoteUrl(s.base, 'noon-uae', '10'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ token: expect.any(String), quote: { quoteId: expect.any(String), slug: 'noon-uae', title: 'Noon.com UAE', kind: 'giftcard',
        packageValue: '10', packageCurrency: 'AED', priceUsd: '2.82', amount: '2820000', checkedAt: '1970-01-01T00:16:40.000Z', expiresAt: 1_600_000 },
        wouldPay: { seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
          payTo: '0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A', amount: '2820000' } });
      expect(verifyMirrorQuote(body.token, SECRET, 1_000_000)).toEqual(body.quote);
      const esim = await getQuote(s.base, 'bitrefill-esim-spain', '1GB, 7 Days');
      expect(esim.quote).toMatchObject({ kind: 'esim', packageValue: '1GB, 7 Days', priceUsd: '2.53', amount: '2530000' });
    } finally { await s.stop(); }
  });
  it('rounds a price with more than 6 decimals up', async () => {
    const s = await start();
    try {
      s.bitrefill.details['noon-uae'] = { ...DETAILS['noon-uae']!, packages: [{ value: '10', currency: 'AED', priceUsd: '2.8200001' }] };
      expect((await getQuote(s.base)).quote.amount).toBe('2820001');
    } finally { await s.stop(); }
  });
  it('refuses bad input with 400 without asking Bitrefill', async () => {
    const s = await start();
    try {
      for (const q of ['', '?slug=noon-uae', '?package=10', '?slug=Noon&package=10', `?slug=${'a'.repeat(81)}&package=10`,
        '?slug=noon-uae&package=', '?slug=noon-uae&package=%0A10', '?slug=noon-uae&package=10;drop', `?slug=noon-uae&package=${'1'.repeat(41)}`,
        '?slug=noon-uae&slug=x&package=10', '?slug=noon-uae&package=10&package=25'])
        expect((await fetch(`${s.base}/mirror/bitrefill/quote${q}`)).status).toBe(400);
      expect(s.bitrefill.calls).toBe(0);
    } finally { await s.stop(); }
  });
  it('answers 404 for an unknown product, package, or an item out of stock', async () => {
    const s = await start();
    try {
      expect((await fetch(quoteUrl(s.base, 'nothing-here', '10'))).status).toBe(404);
      expect((await fetch(quoteUrl(s.base, 'noon-uae', '11'))).status).toBe(404);
      s.bitrefill.details['noon-uae'] = { ...DETAILS['noon-uae']!, inStock: false };
      expect((await fetch(quoteUrl(s.base, 'noon-uae', '10'))).status).toBe(404);
    } finally { await s.stop(); }
  });
  it('answers 503 and quotes nothing when Bitrefill is unreachable', async () => {
    const s = await start();
    try {
      s.bitrefill.fail = true;
      const res = await fetch(quoteUrl(s.base, 'noon-uae', '10'));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'Bitrefill is unreachable; nothing was quoted' });
    } finally { await s.stop(); }
  });
});

describe('a product not priced in USD', () => {
  it('answers 404 "not sold in USD", not unreachable', async () => {
    const s = await start();
    try {
      s.bitrefill.notUsd = true;
      const res = await fetch(quoteUrl(s.base, 'noon-uae', '10'));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not sold in USD at Bitrefill' });
    } finally { await s.stop(); }
  });
});

describe('GET /mirror/bitrefill/order: paid over x402 on Sepolia at the quoted price', () => {
  it('asks an unpaid request for exactly the quoted amount in the Sepolia token', async () => {
    const s = await start();
    try {
      const { token, quote } = await getQuote(s.base, 'noon-uae', '100');
      const res = await fetch(orderUrl(s.base, token));
      expect(res.status).toBe(402);
      const required = JSON.parse(atob(res.headers.get('payment-required')!));
      expect(required.accepts).toHaveLength(1);
      expect(required.accepts[0]).toMatchObject({ scheme: 'exact', network: NETWORK, asset: TOKEN, amount: '28160000', payTo: PAY_TO,
        extra: { name: 'Test USDT0 copy (Turtle demo)', version: '1' } });
      expect(quote.amount).toBe('28160000');
      expect(required.resource.description).toContain('The card is not issued');
    } finally { await s.stop(); }
  });
  it('refuses a tampered, missing or shop token with 400, and an expired one with 409, before payment', async () => {
    let time = 1_000_000;
    const s = await start({ now: () => time });
    try {
      const { token } = await getQuote(s.base);
      const [payload, mac] = token.split('.');
      const tampered = `${payload!.slice(0, -2)}${payload!.endsWith('AA') ? 'BB' : 'AA'}.${mac}`;
      const shop: Quote = { quoteId: 'q', productId: 'airpods-4', priceAed: '429.00', amount: '116814160', source: 'sample', checkedAt: 'x', expiresAt: 9e15 };
      for (const url of [orderUrl(s.base, tampered), orderUrl(s.base, 'garbage'), `${s.base}/mirror/bitrefill/order`, orderUrl(s.base, signQuote(shop, SECRET))]) {
        const res = await fetch(url);
        expect(res.status).toBe(400);
        expect(res.headers.get('payment-required')).toBeNull();
      }
      // and a mirror token is no good at the shop
      expect((await fetch(`${s.base}/shop/order?quote=${encodeURIComponent(token)}`)).status).toBe(400);
      expect(() => verifyQuote(token, SECRET, time)).toThrow('quote: malformed');
      time += 600_000;
      const expired = await fetch(orderUrl(s.base, token));
      expect(expired.status).toBe(409);
      expect(expired.headers.get('payment-required')).toBeNull();
      expect(s.facilitator.calls.verify).toBe(0);
    } finally { await s.stop(); }
  });
  it('refuses to sign or accept a quote whose amount is not its USD price', () => {
    const quote: MirrorQuote = { quoteId: 'q', slug: 'noon-uae', title: 'Noon.com UAE', kind: 'giftcard', packageValue: '10', packageCurrency: 'AED',
      priceUsd: '2.82', amount: '2820000', checkedAt: 'x', expiresAt: 9e15 };
    expect(verifyMirrorQuote(signMirrorQuote(quote, SECRET), SECRET, 0)).toEqual(quote);
    expect(() => signMirrorQuote({ ...quote, amount: '1' }, SECRET)).toThrow('quote: malformed');
  });
  it('serves a paid order once, settles once, and refuses the same quote again with 409 before payment', async () => {
    const s = await start();
    try {
      const { token, quote } = await getQuote(s.base);
      const res = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ orderId: expect.any(String), slug: 'noon-uae', title: 'Noon.com UAE', packageValue: '10', amount: '2820000',
        wouldPay: { seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
          payTo: '0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A', amount: '2820000' }, note: NOTE });
      expect(s.facilitator.calls.settle).toBe(1);
      expect(s.orders).toEqual([{ orderId: body.orderId, slug: 'noon-uae', packageValue: '10', amount: '2820000', transaction: '0xsettled' }]);
      const again = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(again.status).toBe(409);
      expect(again.headers.get('payment-required')).toBeNull();
      expect(s.facilitator.calls.settle).toBe(1);
    } finally { await s.stop(); }
  });
  it('refuses a second paid request for a quote whose payment is still settling', async () => {
    let release!: () => void;
    const facilitator = fakeFacilitator();
    const settle = facilitator.client.settle;
    facilitator.client.settle = async (p: any) => { await new Promise<void>(done => { release = done; }); return settle(p); };
    const s = await start({}, facilitator);
    try {
      const { token, quote } = await getQuote(s.base);
      const first = paidFetch(orderUrl(s.base, token), quote.amount);
      while (!release) await new Promise(done => setTimeout(done, 10));
      expect((await paidFetch(orderUrl(s.base, token), quote.amount)).status).toBe(409);
      release();
      expect((await first).status).toBe(200);
      expect(s.facilitator.calls.settle).toBe(1);
      expect(s.orders).toHaveLength(1);
    } finally { await s.stop(); }
  });
  it('serves no order and keeps the quote usable when settlement fails', async () => {
    const s = await start({}, fakeFacilitator({ settled: false }));
    try {
      const { token, quote } = await getQuote(s.base);
      const failed = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(failed.status).toBe(402);
      expect(await failed.text()).not.toContain('not issued');
      expect(s.orders).toEqual([]);
      s.facilitator.outcome.settled = true;
      expect((await paidFetch(orderUrl(s.base, token), quote.amount)).status).toBe(200);
      expect(s.orders).toHaveLength(1);
    } finally { await s.stop(); }
  });
});

describe('the composed lookup service with the mirror in front', () => {
  it('rate-limits the mirror routes', async () => {
    const s = await start({ limitPerMinute: 2 });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await fetch(quoteUrl(s.base, 'noon-uae', '10'))).status);
      expect(codes).toEqual([200, 200, 429]);
      expect((await fetch(`${s.base}/shop/search?q=airpods`)).status).toBe(200);
    } finally { await s.stop(); }
  });
  it('leaves the shop and the lookup untouched, and unknown paths get the lookup 404', async () => {
    const s = await start();
    try {
      expect((await (await fetch(`${s.base}/shop/search?q=airpods`)).json()).products.map((p: { id: string }) => p.id)).toEqual(['airpods-4', 'airpods-pro-2']);
      const lookup = await fetch(`${s.base}/lookup?merchant=GITHUB`);
      expect(lookup.status).toBe(402);
      expect(JSON.parse(atob(lookup.headers.get('payment-required')!)).accepts[0].amount).toBe('10000');
      for (const path of ['/mirror/bitrefill/nothing', '/mirror']) {
        const missing = await fetch(`${s.base}${path}`);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: 'Not found' });
      }
    } finally { await s.stop(); }
  });
});

describe('Bitrefill slugs with underscores', () => {
  it('accepts a real slug like noon_com-saudi-arabia in the slug check', async () => {
    const { SLUG } = await import('../../server/bitrefill.js');
    expect(SLUG.test('noon_com-saudi-arabia')).toBe(true);
    expect(SLUG.test('bad slug!')).toBe(false);
  });
});
