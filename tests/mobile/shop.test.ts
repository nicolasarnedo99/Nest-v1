import { once } from 'node:events';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createShopApp, RecordedPriceSource } from '../../server/shop.js';
import { orderUrl, quoteShop, searchShop } from '../../mobile/lib/shop.js';

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

async function start() {
  const app = createShopApp({ facilitator: {} as never, payTo: '0x1111111111111111111111111111111111111111', chainId: 11155111,
    token: '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f', tokenName: 'Test', prices: new RecordedPriceSource(), secret: new Uint8Array(32).fill(1) });
  const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}/shop`, stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}

const product = { id: 'a', title: 'A', url: 'https://www.amazon.ae/x', priceAed: '1.00', approxUsdt: '0.27', verified: true, recordedAt: '2026-11-19' };
const quote = { quoteId: 'q', productId: 'a', priceAed: '1.00', amount: '272295', source: 'recorded', checkedAt: '2026-11-19', expiresAt: 1 };

describe('searchShop and quoteShop, against the shop', () => {
  it('finds products under a price, and quotes one', async () => {
    const s = await start();
    try {
      expect((await searchShop(s.base, 'airpods', '698.99')).map(p => p.id)).toEqual(['airpods-4']);
      const quoted = await quoteShop(s.base, 'airpods-pro-2');
      expect(quoted.quote).toMatchObject({ productId: 'airpods-pro-2', source: expect.stringMatching(/^(recorded|sample)$/) });
      expect(orderUrl(s.base, quoted.token)).toBe(`${s.base}/order?quote=${encodeURIComponent(quoted.token)}`);
    } finally { await s.stop(); }
  });
  it('throws when the shop says no', async () => {
    const s = await start();
    try { await expect(quoteShop(s.base, 'no-such-thing')).rejects.toThrow(); } finally { await s.stop(); }
  });
});

describe('every shop answer is parsed strictly', () => {
  it('accepts well-formed answers', async () => {
    expect(await searchShop('http://shop', 'x', null, answer({ products: [product] }))).toEqual([product]);
    expect(await quoteShop('http://shop', 'a', answer({ token: 't', quote }))).toEqual({ token: 't', quote });
  });
  it.each([
    ['no products', {}], ['products not a list', { products: 'x' }], ['verified a string', { products: [{ ...product, verified: 'yes' }] }],
    ['a missing price', { products: [{ ...product, priceAed: undefined }] }], ['a number title', { products: [{ ...product, title: 1 }] }],
  ])('search refuses %s', async (_name, body) => {
    await expect(searchShop('http://shop', 'x', null, answer(body))).rejects.toThrow();
  });
  it.each([
    ['no token', { quote }], ['an unknown source', { token: 't', quote: { ...quote, source: 'guess' } }],
    ['a decimal amount', { token: 't', quote: { ...quote, amount: '1.5' } }], ['expiresAt a string', { token: 't', quote: { ...quote, expiresAt: '1' } }],
    ['no quote', { token: 't' }],
  ])('quote refuses %s', async (_name, body) => {
    await expect(quoteShop('http://shop', 'a', answer(body))).rejects.toThrow();
  });
  it('refuses a non-JSON body and a non-200 status', async () => {
    const html = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(searchShop('http://shop', 'x', null, html)).rejects.toThrow();
    await expect(searchShop('http://shop', 'x', null, answer({ products: [] }, 500))).rejects.toThrow();
  });
});
