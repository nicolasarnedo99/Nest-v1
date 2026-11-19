import { once } from 'node:events';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseDetail } from '../../server/bitrefill.js';
import { createMirrorApp } from '../../server/mirror.js';
import { OrderFailed, walletSigner } from '../../mobile/lib/x402.js';
import { bitrefillSearches, mirrorOrderUrl, packageLabel, paidMirrorOrder, parseMirrorOrder, parseMirrorQuote, quoteMirror } from '../../mobile/lib/mirror.js';
import type { Intent } from '../../mobile/lib/chat.js';

const NETWORK = 'eip155:11155111';
const TOKEN = '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f';
const PAY_TO = '0x1111111111111111111111111111111111111111';
const SETTLED = `0x${'ab'.repeat(32)}`;
const NOTE = 'Demo purchase on Sepolia · the card is not issued';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/bitrefill/${name}.json`, import.meta.url), 'utf8')).body;

// The real mirror app, with Bitrefill and the facilitator faked.
async function startMirror() {
  const calls = { verify: 0, settle: 0 };
  const facilitator = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }], extensions: [], signers: {} }),
    verify: async (p: any) => { calls.verify++; return { isValid: true, payer: p.payload.authorization.from }; },
    settle: async (p: any) => { calls.settle++; return { success: true, transaction: SETTLED, network: NETWORK, payer: p.payload.authorization.from }; },
  };
  const detail = parseDetail(fixture('products-detail-noon-uae'), 'noon-uae');
  const app = createMirrorApp({ facilitator: facilitator as never, payTo: PAY_TO, chainId: 11155111, token: TOKEN, tokenName: 'Test USDT0 copy (Turtle demo)',
    secret: new Uint8Array(32).fill(3), bitrefill: { productDetail: async slug => (slug === 'noon-uae' ? detail : null) } });
  const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}/mirror/bitrefill`, calls, stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
const payer = () => { const a = privateKeyToAccount(generatePrivateKey()); const signer = { signs: 0, ...walletSigner(a.address, d => {
  signer.signs++; return a.signTypedData({ ...d, primaryType: 'TransferWithAuthorization' } as never); }) }; return signer; };

describe('the Bitrefill mirror, end to end', () => {
  it('quotes the chosen package, then pays exactly that amount on Sepolia', async () => {
    const m = await startMirror(); const signer = payer();
    try {
      const q = await quoteMirror(m.base, 'noon-uae', '10');
      expect(q.quote).toMatchObject({ slug: 'noon-uae', title: 'Noon.com UAE', kind: 'giftcard', packageValue: '10', packageCurrency: 'AED', priceUsd: '2.82', amount: '2820000' });
      expect(q.wouldPay).toEqual({ seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        payTo: '0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A', amount: '2820000' });
      const out = await paidMirrorOrder({ url: mirrorOrderUrl(m.base, q.token), signer,
        expected: { network: NETWORK, asset: TOKEN, maxAmount: BigInt(q.quote.amount), payTo: PAY_TO } });
      expect(out).toMatchObject({ amount: 2_820_000n, transaction: SETTLED, order: { slug: 'noon-uae', packageValue: '10', amount: '2820000', note: NOTE } });
      expect(signer.signs).toBe(1);
    } finally { await m.stop(); }
  });

  it('refuses a 402 for more than the quote, signing nothing', async () => {
    const m = await startMirror(); const signer = payer();
    try {
      const q = await quoteMirror(m.base, 'noon-uae', '10');
      const failure = await paidMirrorOrder({ url: mirrorOrderUrl(m.base, q.token), signer,
        expected: { network: NETWORK, asset: TOKEN, maxAmount: 2_819_999n, payTo: PAY_TO } }).catch(e => e);
      expect(failure).toBeInstanceOf(OrderFailed);
      expect(failure.message).toMatch(/^Refused to pay/);
      expect([signer.signs, m.calls.verify]).toEqual([0, 0]);
    } finally { await m.stop(); }
  });

  it('reports the mirror status on an unknown product, before anything is paid', async () => {
    const m = await startMirror();
    try { await expect(quoteMirror(m.base, 'steam-usa', '10')).rejects.toThrow('Bitrefill mirror answered 404'); }
    finally { await m.stop(); }
  });
});

describe('strict parsing of mirror answers', () => {
  const wouldPay = { seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0xFd', payTo: '0x48', amount: '2820000' };
  const quote = { quoteId: 'q', slug: 'noon-uae', title: 'Noon.com UAE', kind: 'giftcard', packageValue: '10', packageCurrency: 'AED', priceUsd: '2.82',
    amount: '2820000', checkedAt: '2026-11-19T10:00:00.000Z', expiresAt: 1 };
  const answer = (over: Record<string, unknown> = {}, w: Record<string, unknown> = {}) => ({ token: 't', quote: { ...quote, ...over }, wouldPay: { ...wouldPay, ...w }, extra: 'dropped' });

  it('copies only the known fields', () => {
    expect(parseMirrorQuote(answer(), 'noon-uae', '10')).toEqual({ token: 't', quote, wouldPay });
  });
  it.each([
    ['a quote for another item', answer({ slug: 'noon_com-saudi-arabia' })],
    ['a quote for another package', answer({ packageValue: '100' })],
    ['a would-pay amount unlike the quote', answer({}, { amount: '1' })],
    ['an amount that is not digits', answer({ amount: '2.82' })],
    ['a zero amount', answer({ amount: '0' }, { amount: '0' })],
    ['an unknown kind', answer({ kind: 'car' })],
    ['an expiry that is not a number', answer({ expiresAt: '1' })],
    ['a missing would-pay', { token: 't', quote }],
  ])('refuses %s', (_, value) => {
    expect(() => parseMirrorQuote(value, 'noon-uae', '10')).toThrow('Bitrefill mirror returned an unreadable answer');
  });
  it('reads an order, and refuses one without its would-pay line', () => {
    const order = { orderId: 'o', slug: 'noon-uae', title: 'Noon.com UAE', packageValue: '10', amount: '2820000', note: NOTE };
    expect(parseMirrorOrder({ ...order, wouldPay })).toEqual({ ...order, wouldPay });
    expect(() => parseMirrorOrder(order)).toThrow('unreadable');
    expect(() => parseMirrorOrder({ ...order, amount: 5, wouldPay })).toThrow('unreadable');
  });
});

it('labels a face value with its currency and a plan as it is', () => {
  expect(packageLabel('10', 'AED')).toBe('10 AED');
  expect(packageLabel('1GB, 7 Days', 'USD')).toBe('1GB, 7 Days');
});

describe('bitrefillSearches', () => {
  const intent = (query: string, currency: Intent['currency'] = null): Intent => ({ intent: 'search', query, maxPrice: null, currency, merchant: '', amount: '', reply: '' });
  it('drops the words that only name the kind, and asks the UAE store for gift cards priced in dirhams', () => {
    expect(bitrefillSearches(intent('eSIM for Spain'), ['esim'])).toEqual([{ kind: 'esim', query: 'Spain' }]);
    expect(bitrefillSearches(intent('noon gift card', 'AED'), ['giftcard'])).toEqual([{ kind: 'giftcard', query: 'noon', country: 'AE' }]);
    expect(bitrefillSearches(intent('noon gift card', 'USD'), ['giftcard'])).toEqual([{ kind: 'giftcard', query: 'noon' }]);
    expect(bitrefillSearches(intent('eSIM', 'AED'), ['esim'])).toEqual([{ kind: 'esim', query: 'eSIM' }]); // nothing left: search as asked
  });
});
