import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { CrossmintPriceSource } from '../../server/shop-crossmint.js';
import { aedToMicro, RecordedPriceSource, signQuote, verifyQuote, type Quote } from '../../server/shop.js';
import { createShopApp, searchCatalog } from '../../server/shop.js';
import { createLookupApp } from '../../server/lookup.js';
import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import catalog from '../../server/shop/catalog.json' with { type: 'json' };

describe('searchCatalog', () => {
  it('finds both AirPods models, cheapest first', () => {
    expect(searchCatalog('airpods', null).map(p => p.id)).toEqual(['airpods-4', 'airpods-pro-2']);
  });
  it('drops products above the AED limit', () => {
    expect(searchCatalog('airpods', 69899n).map(p => p.id)).toEqual(['airpods-4']);
  });
  it('treats the limit as inclusive, in fils', () => {
    expect(searchCatalog('airpods', 69900n).map(p => p.id)).toEqual(['airpods-4', 'airpods-pro-2']);
    expect(searchCatalog('airpods', 69899n).map(p => p.id)).toEqual(['airpods-4']);
  });
  it('needs every query word, case-insensitively', () => {
    expect(searchCatalog('AIRPODS PRO', null).map(p => p.id)).toEqual(['airpods-pro-2']);
  });
  it('finds nothing for a product the shop does not stock', () => {
    expect(searchCatalog('toaster', null)).toEqual([]);
  });
  it('ignores words of two letters or fewer, and an all-short query matches nothing', () => {
    expect(searchCatalog('an airpods pro', null).map(p => p.id)).toEqual(['airpods-pro-2']);
    expect(searchCatalog('an of', null)).toEqual([]);
  });
  it('returns at most 5, cheapest first', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...catalog[0]!, id: `p${i}`, title: `Widget ${i}`, keywords: [], priceAed: `${100 - i}.00` }));
    expect(searchCatalog('widget', null, many).map(p => p.id)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2']);
  });
});

describe('catalog data', () => {
  it('has 15 to 20 entries with unique ids', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(15);
    expect(catalog.length).toBeLessThanOrEqual(20);
    expect(new Set(catalog.map(p => p.id)).size).toBe(catalog.length);
  });
  it('keeps every entry honest: amazon.ae url, decimal price, date, verified flag, a note', () => {
    for (const p of catalog) {
      expect(p.url).toMatch(/^https:\/\/www\.amazon\.ae\//);
      expect(p.priceAed).toMatch(/^\d+\.\d{2}$/);
      expect(p.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof p.verified).toBe('boolean');
      expect(p.note.length).toBeGreaterThan(0);
    }
  });
});

describe('aedToMicro', () => {
  it('rounds up to the next micro-unit', () => {
    expect(aedToMicro('3.67')).toBe(999320n);
    expect(aedToMicro('599.00')).toBe((599_000000n * 10000n + 36725n - 1n) / 36725n);
    expect(aedToMicro('3.6')).toBe(980259n);
    expect(aedToMicro('4')).toBe(1089177n);
  });
  it('rejects zero, extra decimals and non-numbers', () => {
    for (const bad of ['0', '0.00', '3.6725', '-1', '1e3', '', ' 5', '5.']) expect(() => aedToMicro(bad)).toThrow();
  });
});

describe('signed quotes', () => {
  const secret = new Uint8Array(32).fill(7);
  const quote: Quote = { quoteId: 'q1', productId: 'airpods-4', priceAed: '599.00', amount: aedToMicro('599.00').toString(), source: 'recorded', checkedAt: '2026-11-19', expiresAt: 2000 };
  const token = signQuote(quote, secret);
  it('round-trips', () => {
    expect(verifyQuote(token, secret, 1000)).toEqual(quote);
  });
  it('rejects a tampered payload', () => {
    const [payload, mac] = token.split('.');
    const flipped = (payload![5] === 'A' ? 'B' : 'A');
    expect(() => verifyQuote(`${payload!.slice(0, 5)}${flipped}${payload!.slice(6)}.${mac}`, secret, 1000)).toThrow('quote: bad signature');
  });
  it('rejects another secret', () => {
    expect(() => verifyQuote(token, new Uint8Array(32).fill(8), 1000)).toThrow('quote: bad signature');
  });
  it('rejects an expired quote', () => {
    expect(() => verifyQuote(token, secret, 2000)).toThrow('quote: expired');
  });
  it('refuses to sign, and rejects a signed token, whose amount is not the conversion of priceAed', () => {
    for (const amount of ['1', 'abc', '-5', '']) expect(() => signQuote({ ...quote, amount }, secret)).toThrow('quote: malformed');
    const payload = Buffer.from(JSON.stringify({ ...quote, amount: '1' })).toString('base64url');
    const forged = `${payload}.${createHmac('sha256', secret).update(payload).digest().toString('base64url')}`;
    expect(() => verifyQuote(forged, secret, 1000)).toThrow('quote: malformed');
  });
  it('rejects garbage and a signed payload of the wrong shape', () => {
    expect(() => verifyQuote('garbage', secret, 1000)).toThrow('quote: malformed');
    expect(() => verifyQuote(signQuote({ ...quote, expiresAt: '9' } as unknown as Quote, secret), secret, 1000)).toThrow('quote: malformed');
    expect(() => verifyQuote(signQuote({ ...quote, source: 'x' } as unknown as Quote, secret), secret, 1000)).toThrow('quote: malformed');
  });
});

describe('RecordedPriceSource', () => {
  const [p] = catalog as unknown as import('../../server/shop.js').Product[];
  it('says recorded for a verified product and sample for an unverified one', async () => {
    const src = new RecordedPriceSource();
    expect((await src.quote({ ...p!, verified: true })).source).toBe('recorded');
    const sample = await src.quote({ ...p!, verified: false });
    expect(sample).toEqual({ priceAed: p!.priceAed, source: 'sample', checkedAt: p!.recordedAt });
  });
});


const NETWORK = 'eip155:11155111';
const TOKEN = '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f';
const PAY_TO = '0x1111111111111111111111111111111111111111';
const SECRET = new Uint8Array(32).fill(9);

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

// The same composition as server/lookup-service.ts: shop first, lookup behind it.
async function start(facilitator = fakeFacilitator(), extra: Partial<Parameters<typeof createShopApp>[0]> = {}) {
  const common = { facilitator: facilitator.client as never, payTo: PAY_TO, chainId: 11155111, token: TOKEN, tokenName: 'Test USDT0 copy (Turtle demo)' } as const;
  const orders: unknown[] = [];
  const root = express();
  root.disable('x-powered-by');
  root.use(createShopApp({ ...common, prices: new RecordedPriceSource(), secret: SECRET, onOrdered: o => orders.push(o), ...extra }));
  root.use(createLookupApp(common));
  const server: Server = root.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, facilitator, orders, stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
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
const getQuote = async (base: string, id = 'airpods-4') =>
  (await (await fetch(`${base}/shop/quote?id=${id}`)).json()) as { token: string; quote: Quote };
const orderUrl = (base: string, token: string) => `${base}/shop/order?quote=${encodeURIComponent(token)}`;

describe('GET /shop/search', () => {
  it('answers matching products with their USD₮0 approximation', async () => {
    const s = await start();
    try {
      const res = await fetch(`${s.base}/shop/search?q=airpods&maxAed=500`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ products: [{ id: 'airpods-4', title: 'Apple AirPods 4', url: catalog[1]!.url,
        priceAed: '429.00', approxUsdt: '116.81416', verified: false, recordedAt: '2026-11-19' }] });
      expect((await (await fetch(`${s.base}/shop/search?q=airpods&maxAed=699`)).json()).products).toHaveLength(2);
      expect((await (await fetch(`${s.base}/shop/search?q=airpods&maxAed=698.99`)).json()).products).toHaveLength(1);
    } finally { await s.stop(); }
  });
  it('refuses bad input with 400', async () => {
    const s = await start();
    try {
      for (const q of ['', '?q=', `?q=${'a'.repeat(81)}`, '?q=%07bell', '?q=airpods&maxAed=1e3', '?q=airpods&maxAed=5.123', '?q=airpods&maxAed=-1', '?q=a&q=b'])
        expect((await fetch(`${s.base}/shop/search${q}`)).status).toBe(400);
    } finally { await s.stop(); }
  });
});

describe('GET /shop/quote', () => {
  it('signs a 10-minute quote that verifies with the secret', async () => {
    const s = await start(undefined, { now: () => 1_000_000 });
    try {
      const { token, quote } = await getQuote(s.base);
      expect(quote).toMatchObject({ productId: 'airpods-4', priceAed: '429.00', amount: aedToMicro('429.00').toString(), source: 'sample', expiresAt: 1_600_000 });
      expect(verifyQuote(token, SECRET, 1_000_000)).toEqual(quote);
      expect((await getQuote(s.base)).quote.quoteId).not.toBe(quote.quoteId);
    } finally { await s.stop(); }
  });
  it('answers 404 for an unknown product', async () => {
    const s = await start();
    try { expect((await fetch(`${s.base}/shop/quote?id=toaster`)).status).toBe(404); } finally { await s.stop(); }
  });
});

describe('GET /shop/order: paid over x402 at the quoted price', () => {
  it('asks an unpaid request for exactly the quoted amount', async () => {
    const s = await start();
    try {
      const { token, quote } = await getQuote(s.base);
      const res = await fetch(orderUrl(s.base, token));
      expect(res.status).toBe(402);
      const required = JSON.parse(atob(res.headers.get('payment-required')!));
      expect(required.accepts[0]).toMatchObject({ scheme: 'exact', network: NETWORK, asset: TOKEN, amount: quote.amount, payTo: PAY_TO,
        extra: { name: 'Test USDT0 copy (Turtle demo)', version: '1' } });
      expect(required.resource.description).toBe('A demo order at Nest demo shop for Apple AirPods 4. Demo order, not shipped.');
    } finally { await s.stop(); }
  });
  it('refuses a tampered or missing token with 400, and an expired one with 409, with no payment request', async () => {
    let time = 1_000_000;
    const s = await start(undefined, { now: () => time });
    try {
      const { token } = await getQuote(s.base);
      const [payload, mac] = token.split('.');
      const tampered = `${payload!.slice(0, -2)}${payload!.endsWith('AA') ? 'BB' : 'AA'}.${mac}`;
      for (const url of [orderUrl(s.base, tampered), orderUrl(s.base, 'garbage'), `${s.base}/shop/order`]) {
        const res = await fetch(url);
        expect(res.status).toBe(400);
        expect(res.headers.get('payment-required')).toBeNull();
      }
      time += 600_000;
      const expired = await fetch(orderUrl(s.base, token));
      expect(expired.status).toBe(409);
      expect(expired.headers.get('payment-required')).toBeNull();
      expect(s.facilitator.calls.verify).toBe(0);
    } finally { await s.stop(); }
  });
  it('serves a paid order once, settles once, and refuses the same quote again with 409 before payment', async () => {
    const s = await start();
    try {
      const { token, quote } = await getQuote(s.base);
      const res = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ orderId: expect.any(String), productId: 'airpods-4', title: 'Apple AirPods 4', priceAed: '429.00',
        amount: quote.amount, note: 'Demo order, not shipped' });
      expect(s.facilitator.calls.settle).toBe(1);
      expect(s.orders).toEqual([{ orderId: body.orderId, productId: 'airpods-4', amount: quote.amount, transaction: '0xsettled' }]);
      const again = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(again.status).toBe(409);
      expect(again.headers.get('payment-required')).toBeNull();
      expect(s.facilitator.calls.settle).toBe(1);
    } finally { await s.stop(); }
  });
  it('serves no order and keeps the quote usable when settlement fails', async () => {
    const s = await start(fakeFacilitator({ settled: false }));
    try {
      const { token, quote } = await getQuote(s.base);
      const failed = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(failed.status).toBe(402);
      expect(await failed.text()).not.toContain('Demo order');
      expect(s.orders).toEqual([]);
      s.facilitator.outcome.settled = true;
      const retry = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(retry.status).toBe(200);
      expect(s.orders).toHaveLength(1);
    } finally { await s.stop(); }
  });
  it('refuses a second paid request for a quote whose payment is still settling', async () => {
    let release!: () => void;
    const facilitator = fakeFacilitator();
    const settle = facilitator.client.settle;
    facilitator.client.settle = async (p: any) => { await new Promise<void>(done => { release = done; }); return settle(p); };
    const s = await start(facilitator);
    try {
      const { token, quote } = await getQuote(s.base);
      const first = paidFetch(orderUrl(s.base, token), quote.amount);
      while (!release) await new Promise(done => setTimeout(done, 10));
      expect((await paidFetch(orderUrl(s.base, token), quote.amount)).status).toBe(409);
      release();
      expect((await first).status).toBe(200);
      expect(s.facilitator.calls.settle).toBe(1);
    } finally { await s.stop(); }
  });
});

describe('the order amount follows the price source, not the catalog', () => {
  it('asks for and settles aedToMicro of the source price', async () => {
    const live = { quote: async () => ({ priceAed: '500.00', source: 'live' as const, checkedAt: '2026-11-19T00:00:00.000Z' }) };
    const s = await start(undefined, { prices: live });
    try {
      const { token, quote } = await getQuote(s.base);
      expect(quote.amount).toBe(aedToMicro('500.00').toString());
      expect(quote.amount).not.toBe(aedToMicro('429.00').toString());
      const unpaid = await fetch(orderUrl(s.base, token));
      expect(JSON.parse(atob(unpaid.headers.get('payment-required')!)).accepts[0].amount).toBe(aedToMicro('500.00').toString());
      const paid = await paidFetch(orderUrl(s.base, token), quote.amount);
      expect(paid.status).toBe(200);
      expect(s.orders).toEqual([expect.objectContaining({ amount: aedToMicro('500.00').toString() })]);
    } finally { await s.stop(); }
  });
});

describe('CrossmintPriceSource (fake fetch, never the live API)', () => {
  const KEY = 'sk_test_SECRET_KEY_123';
  const [first] = catalog as unknown as import('../../server/shop.js').Product[];
  const product = { ...first!, verified: true };
  const run = (status: string, extra: object = {}) => ({ runId: 'run-1', status, requiredAction: null, ...extra });
  const payment = (amount: object) => run('awaiting_input', { requiredAction: { messageId: 'm1', request: { interaction: { kind: 'payment', method: 'card',
    purpose: 'checkout_payment', amount, merchant: { name: 'Amazon.ae', url: 'https://www.amazon.ae', countryCode: 'AE' } } } } });
  const exact = (value: string, currency = 'AED', kind = 'exact') => payment({ currency, kind, value });

  // gets: the answers to successive GETs (the last one repeats); createStatus: how the POST answers.
  function setup(gets: object[], opts: { createStatus?: number; getFails?: boolean; cancelFails?: boolean; timeoutMs?: number; failWith?: Error } = {}) {
    const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
    const logs: string[] = [];
    let time = 1_000_000, i = 0;
    const fetchFake = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, headers: init.headers as Record<string, string>, body: init.body as string | undefined });
      if (opts.failWith) throw opts.failWith;
      const reply = (status: number, body: object) => ({ ok: status < 300, status, json: async () => body }) as Response;
      if (init.method === 'POST' && url.endsWith('/cancel')) return opts.cancelFails ? reply(500, {}) : reply(202, { runId: 'run-1', status: 'accepted' });
      if (init.method === 'POST') return opts.createStatus && opts.createStatus >= 300 ? reply(opts.createStatus, {}) : reply(202, run('queued'));
      if (opts.getFails) return reply(500, {});
      return reply(200, gets[Math.min(i++, gets.length - 1)]!);
    }) as unknown as typeof fetch;
    const source = new CrossmintPriceSource({ key: KEY, fetch: fetchFake, now: () => time, sleep: async ms => { time += ms; }, log: l => logs.push(l),
      pollMs: 1000, timeoutMs: opts.timeoutMs ?? 120_000 });
    return { source, calls, logs, cancels: () => calls.filter(c => c.url.endsWith('/cancel')), advance: (ms: number) => { time += ms; } };
  }

  it('reuses a price for 5 minutes, so repeated quotes start one paid run', async () => {
    const t = setup([exact('431.50')]);
    const firstQuote = await t.source.quote(product);
    const again = await t.source.quote(product);
    expect(again).toEqual(firstQuote);
    expect(t.calls.filter(c => c.method === 'POST' && !c.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('shares one run between quotes that arrive while it is still checking', async () => {
    const t = setup([run('running'), exact('431.50')]);
    const [a, b] = await Promise.all([t.source.quote(product), t.source.quote(product)]);
    expect(a).toEqual(b);
    expect(t.calls.filter(c => c.method === 'POST' && !c.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('checks again once the cached price is older than 5 minutes', async () => {
    const t = setup([exact('431.50')]);
    await t.source.quote(product);
    t.advance(5 * 60_000 + 1);
    await t.source.quote(product);
    expect(t.calls.filter(c => c.method === 'POST' && !c.url.endsWith('/cancel'))).toHaveLength(2);
  });

  it('caches a fallback too, so a blocked product does not start a paid run on every quote', async () => {
    const t = setup([run('blocked')]);
    expect((await t.source.quote(product)).source).toBe('recorded');
    expect((await t.source.quote(product)).source).toBe('recorded');
    expect(t.calls.filter(c => c.method === 'POST' && !c.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('creates a cart-only run, polls twice, reads the payment total and cancels exactly once', async () => {
    const t = setup([run('running'), run('running'), exact('431.50')]);
    const quote = await t.source.quote(product);
    expect(quote).toEqual({ priceAed: '431.50', source: 'live', checkedAt: expect.any(String) });
    const [create, ...rest] = t.calls;
    expect(create).toMatchObject({ method: 'POST', url: 'https://www.crossmint.com/api/unstable/agent-checkouts' });
    expect(JSON.parse(create!.body!)).toEqual({ request: { startUrl: product.url, task: 'Add this product, quantity 1, to the cart and go to checkout. Do not pay.' },
      constraints: { maxCost: { amount: '838.80', currency: 'AED' } } }); // 699.00 + 20%
    expect(rest.filter(c => c.method === 'GET')).toHaveLength(3);
    expect(t.cancels()).toHaveLength(1);
    expect(t.cancels()[0]!.url).toBe('https://www.crossmint.com/api/unstable/agent-checkouts/run-1/cancel');
    expect(t.calls.at(-1)!.url).toMatch(/cancel$/); // cancelled only after the total was read
    expect(t.logs).toEqual([]);
  });
  it('returns a total that aedToMicro accepts', async () => {
    const quote = await setup([exact('431.50')]).source.quote(product);
    expect(() => aedToMicro(quote.priceAed)).not.toThrow();
  });
  it('falls back to the recorded price when the run is blocked, and logs why', async () => {
    const t = setup([run('running'), run('blocked', { result: { outcome: 'blocked', code: 'merchant.access_blocked', summary: 'x' } })]);
    expect(await t.source.quote(product)).toEqual(await new RecordedPriceSource().quote(product));
    expect(t.logs.join()).toContain('merchant.access_blocked');
    expect(t.cancels()).toHaveLength(0); // already over
  });
  it('falls back on a timeout and still attempts the cancel', async () => {
    const t = setup([run('running')], { timeoutMs: 5000 });
    expect(await t.source.quote(product)).toEqual(await new RecordedPriceSource().quote(product));
    expect(t.logs.join()).toContain('timed out');
    expect(t.cancels()).toHaveLength(1);
  });
  it('still returns the live total when the cancel itself fails, and logs it', async () => {
    const t = setup([exact('431.50')], { cancelFails: true });
    expect((await t.source.quote(product)).source).toBe('live');
    expect(t.logs.join()).toContain('cancel');
  });
  it('falls back, cancelling, when a poll fails', async () => {
    const t = setup([], { getFails: true });
    expect((await t.source.quote(product)).source).toBe('recorded');
    expect(t.cancels()).toHaveLength(1);
  });
  it('falls back when the create call fails, with nothing to cancel', async () => {
    const t = setup([], { createStatus: 403 });
    expect((await t.source.quote(product)).source).toBe('recorded');
    expect(t.cancels()).toHaveLength(0);
  });
  it.each([
    ['a non-AED total', exact('117.50', 'USD')], ['a maximum, not an exact total', exact('431.50', 'AED', 'maximum')],
    ['an unparseable total', exact('about 430')], ['a total with 3 decimals', exact('431.505')], ['a zero total', exact('0.00')],
    ['a missing amount', payment({})],
  ])('falls back on %s, and cancels the run', async (_name, reply) => {
    const t = setup([reply]);
    expect((await t.source.quote(product)).source).toBe('recorded');
    expect(t.logs).toHaveLength(1);
    expect(t.cancels()).toHaveLength(1);
  });
  it('sends the key only in the auth header, and never in a log line, even when an error carries it', async () => {
    const ok = setup([exact('431.50')]);
    await ok.source.quote(product);
    for (const c of ok.calls) {
      expect(c.headers['X-API-KEY']).toBe(KEY);
      expect(c.url + (c.body ?? '') + JSON.stringify({ ...c.headers, 'X-API-KEY': '' })).not.toContain(KEY);
    }
    const bad = setup([], { failWith: new Error(`connect failed with key ${KEY}`) });
    expect((await bad.source.quote(product)).source).toBe('recorded');
    expect(bad.logs).toHaveLength(1);
    expect(bad.logs[0]).not.toContain(KEY);
  });
  it('falls back within the bound when a call never answers, whichever call hangs', async () => {
    const hangs = (url: string, init: RequestInit) => new Promise<Response>((_, fail) =>
      init.signal?.addEventListener('abort', () => fail(new Error('aborted'))));
    const json = (body: object) => ({ ok: true, status: 202, json: async () => body }) as Response;
    const build = (fetchFake: typeof fetch, logs: string[]) => new CrossmintPriceSource({ key: KEY, fetch: fetchFake, log: l => logs.push(l),
      timeoutMs: 50, cancelTimeoutMs: 50, pollMs: 1 });
    const recorded = await new RecordedPriceSource().quote(product);
    for (const hung of ['create', 'poll', 'cancel']) {
      const logs: string[] = [], seen: string[] = [];
      const fetchFake = (async (url: string, init: RequestInit) => {
        const kind = init.method === 'GET' ? 'poll' : url.endsWith('/cancel') ? 'cancel' : 'create';
        seen.push(kind);
        if (kind === hung) return hangs(url, init);
        return json(kind === 'cancel' ? { runId: 'run-1', status: 'accepted' } : run('running'));
      }) as unknown as typeof fetch;
      const started = Date.now();
      const quote = await build(fetchFake, logs).quote(product);
      expect(quote).toEqual(recorded);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(logs.length).toBeGreaterThan(0);
      if (hung !== 'create') expect(seen).toContain('cancel');
    }
  });
  it('refuses to be built without a key', () => {
    expect(() => new CrossmintPriceSource({ key: '' })).toThrow('missing key');
  });
});

describe('the composed lookup service', () => {
  it('rate-limits the shop routes', async () => {
    const s = await start(undefined, { limitPerMinute: 2 });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await fetch(`${s.base}/shop/search?q=airpods`)).status);
      expect(codes).toEqual([200, 200, 429]);
    } finally { await s.stop(); }
  });
  it('leaves the lookup untouched, and unknown paths get its 404', async () => {
    const s = await start();
    try {
      const res = await fetch(`${s.base}/lookup?merchant=GITHUB`);
      expect(res.status).toBe(402);
      expect(JSON.parse(atob(res.headers.get('payment-required')!)).accepts[0].amount).toBe('10000');
      const missing = await fetch(`${s.base}/shop/nothing`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Not found' });
      expect(missing.headers.get('x-powered-by')).toBeNull();
    } finally { await s.stop(); }
  });
});
