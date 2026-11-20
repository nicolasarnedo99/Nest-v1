import { once } from 'node:events';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createLookupApp } from '../../server/lookup.js';
import { madridDay } from '../../server/money.js';
import type { Store } from '../../mobile/lib/budget.js';
import { checkRequirement, LookupFailed, paidLookup, walletSigner, type Expected } from '../../mobile/lib/x402.js';

const memory = (): Store & { text: string | null } => {
  const store = { text: null as string | null, read: () => store.text, write: (text: string) => { store.text = text; } };
  return store;
};

const NETWORK = 'eip155:11155111';
const TOKEN = '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f';
const PAY_TO = '0x1111111111111111111111111111111111111111';

const SETTLED = `0x${'ab'.repeat(32)}`;
function fakeFacilitator(outcome: { valid?: boolean; settled?: boolean; transaction?: string } = {}) {
  const calls = { verify: 0, settle: 0 };
  return { calls, client: {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }], extensions: [], signers: {} }),
    verify: async (payload: any) => { calls.verify++; return outcome.valid === false
      ? { isValid: false, invalidReason: 'invalid_exact_evm_signature' } : { isValid: true, payer: payload.payload.authorization.from }; },
    settle: async (payload: any) => { calls.settle++; return outcome.settled === false
      ? { success: false, errorReason: 'transaction_failed', transaction: '', network: NETWORK }
      : { success: true, transaction: outcome.transaction ?? SETTLED, network: NETWORK, payer: payload.payload.authorization.from }; },
  } };
}

async function start(facilitator = fakeFacilitator(), extra: Partial<Parameters<typeof createLookupApp>[0]> = {}) {
  const app = createLookupApp({ facilitator: facilitator.client as never, payTo: PAY_TO, chainId: 11155111,
    token: TOKEN, tokenName: 'Test USDT0 copy (Turtle demo)', ...extra });
  const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, facilitator, stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
const expected: Expected = { network: 'eip155:11155111', asset: TOKEN, maxAmount: 10000n };
const good = { scheme: 'exact', network: 'eip155:11155111', asset: TOKEN.toUpperCase().replace('0X', '0x'), amount: '10000', payTo: PAY_TO };

describe('checkRequirement', () => {
  it('accepts our token at 0.01, whatever the address case', () => { expect(() => checkRequirement(good, expected)).not.toThrow(); });
  it.each([
    ['scheme', { scheme: 'upto' }], ['network', { network: 'eip155:1' }], ['asset', { asset: PAY_TO }],
    ['amount', { amount: '10001' }], ['amount', { amount: 'abc' }],
  ])('refuses a different %s', (field, change) => {
    expect(() => checkRequirement({ ...good, ...change }, expected)).toThrow(`Refused to pay: ${field}`);
  });
  it.each(['0x2710', ' 10000 ', '1e4', '+10000'])('refuses an amount that is not plain digits (%j), so only digits are ever stored', amount => {
    expect(() => checkRequirement({ ...good, amount }, expected)).toThrow('Refused to pay: amount');
  });
  it('pins payTo only when told to', () => {
    expect(() => checkRequirement(good, { ...expected, payTo: '0x2222222222222222222222222222222222222222' })).toThrow('Refused to pay: payTo');
  });
});

describe('walletSigner', () => {
  it('hands the wallet strings, not BigInts, and drops primaryType', async () => {
    let seen: any;
    const signer = walletSigner(PAY_TO, async data => { seen = data; return '0xsig'; });
    await signer.signTypedData({ domain: { chainId: 11155111 }, types: {}, primaryType: 'TransferWithAuthorization',
      message: { value: 10000n, validAfter: 0n, validBefore: 99n, nonce: '0x01' } });
    expect(seen.message).toEqual({ value: '10000', validAfter: '0', validBefore: '99', nonce: '0x01' });
    expect(JSON.stringify(seen)).not.toContain('primaryType');
  });
});

describe('paidLookup', () => {
  const payer = () => { const a = privateKeyToAccount(generatePrivateKey());
    return walletSigner(a.address, d => a.signTypedData({ ...d, primaryType: 'TransferWithAuthorization' } as never)); };
  it('pays 0.01, counts it, and returns the answer and settlement', async () => {
    const s = await start(); const budget = memory();
    try {
      const out = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget });
      expect(out.result).toMatchObject({ operator: 'GitHub', listedParent: 'Microsoft' });
      expect(out.fee).toBe(10000n);
      expect(out.transaction).toBe(SETTLED);
      expect(JSON.parse(budget.text!).spent).toBe('10000');
    } finally { await s.stop(); }
  });
  it('drops a settlement transaction that is not a 32-byte hash, so the app never links it', async () => {
    const s = await start(fakeFacilitator({ transaction: '0xsettled' })); const budget = memory();
    try {
      const out = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget });
      expect(out.result).toMatchObject({ operator: 'GitHub', listedParent: 'Microsoft' });
      expect(out.transaction).toBeNull();
      expect(JSON.parse(budget.text!).spent).toBe('10000');
    } finally { await s.stop(); }
  });
  it('signs nothing and counts nothing when the 402 pays someone else', async () => {
    const s = await start(); const budget = memory();
    try {
      const failure = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), budget,
        expected: { ...expected, payTo: '0x2222222222222222222222222222222222222222' } }).catch(e => e);
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure.message).toContain('Refused to pay: payTo');
      expect(failure.feeMayBePaid).toBe(false);
      expect(budget.text).toBeNull();
      expect(s.facilitator.calls.verify).toBe(0);
    } finally { await s.stop(); }
  });
  it('still looks up when today already spent past 5.00, as savings have no daily cap', async () => {
    const s = await start(); const budget = memory();
    budget.write(JSON.stringify({ day: madridDay(new Date()), spent: '5000000' }));
    try {
      await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget });
      expect(JSON.parse(budget.text!).spent).toBe('5010000');
    } finally { await s.stop(); }
  });
  it('keeps the fee counted when settlement fails after signing', async () => {
    const s = await start(fakeFacilitator({ settled: false })); const budget = memory();
    try {
      const failure = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget }).catch(e => e);
      expect(failure.feeMayBePaid).toBe(true);
      expect(JSON.parse(budget.text!).spent).toBe('10000');
    } finally { await s.stop(); }
  });
  it('names a 402 above the cap a refusal, not an outage, and counts nothing', async () => {
    const s = await start(); const budget = memory();
    try {
      const failure = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), budget,
        expected: { ...expected, maxAmount: 9999n } }).catch(e => e);
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure.message).toMatch(/^Refused to pay/);
      expect(failure.feeMayBePaid).toBe(false);
      expect(budget.text).toBeNull();
      expect(s.facilitator.calls.verify).toBe(0);
    } finally { await s.stop(); }
  });
  it('keeps the fee counted when the connection drops after signing', async () => {
    const s = await start(); const budget = memory();
    let calls = 0;
    const flaky = (async (input: any, init: any) => {
      if (++calls === 1) return fetch(input, init);
      throw new TypeError('network error');
    }) as typeof fetch;
    try {
      const failure = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget, fetch: flaky }).catch(e => e);
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure.message).toBe('Lookup interrupted, a fee may have been paid');
      expect(failure.feeMayBePaid).toBe(true);
      expect(JSON.parse(budget.text!).spent).toBe('10000');
    } finally { await s.stop(); }
  });
  it('reads the ticker and the source', async () => {
    const s = await start();
    try {
      const out = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget: memory() });
      expect(out.result).toEqual({ operator: 'GitHub', listedParent: 'Microsoft', ticker: 'MSFT', note: 'Microsoft acquired GitHub in 2018.', source: 'demo data' });
    } finally { await s.stop(); }
  });
  it.each([
    ['an unknown source', { listedParent: 'Microsoft', ticker: 'MSFT', source: 'demo table' }],
    ['a missing source', { listedParent: 'Microsoft', ticker: 'MSFT', source: undefined }],
    ['a missing ticker', { listedParent: 'Microsoft', ticker: undefined, source: 'demo data' }],
    ['a ticker with no listed parent', { listedParent: null, ticker: 'MSFT', source: 'demo data' }],
    ['a malformed ticker', { listedParent: 'Microsoft', ticker: 'msft; DROP', source: 'demo data' }],
  ])('calls an answer with %s unreadable, with the fee counted', async (_name, answer) => {
    const s = await start(undefined, { backend: async () => ({ operator: 'GitHub', ...answer }) as never }); const budget = memory();
    try {
      const failure = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget }).catch(e => e);
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure.message).toBe('Lookup returned an unreadable answer');
      expect(failure.feeMayBePaid).toBe(true);
      expect(JSON.parse(budget.text!).spent).toBe('10000');
    } finally { await s.stop(); }
  });
  it('reports an unreachable service without counting anything', async () => {
    const budget = memory();
    const failure = await paidLookup({ url: 'http://127.0.0.1:9/lookup', merchant: 'GITHUB', signer: payer(), expected, budget, timeoutMs: 2000 }).catch(e => e);
    expect(failure.message).toBe('Lookup unavailable');
    expect(budget.text).toBeNull();
  });
});

// Appended for the shop: imports stay down here so the lookup tests above are untouched.
import { createShopApp, RecordedPriceSource } from '../../server/shop.js';
import { OrderFailed, countOrder, paidOrder } from '../../mobile/lib/x402.js';
import { orderUrl, quoteShop } from '../../mobile/lib/shop.js';

describe('paidOrder', () => {
  async function startShop(facilitator = fakeFacilitator()) {
    const app = createShopApp({ facilitator: facilitator.client as never, payTo: PAY_TO, chainId: 11155111, token: TOKEN,
      tokenName: 'Test USDT0 copy (Turtle demo)', prices: new RecordedPriceSource(), secret: new Uint8Array(32).fill(5) });
    const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}/shop`;
    const { token, quote } = await quoteShop(base, 'airpods-pro-2');
    return { url: orderUrl(base, token), amount: BigInt(quote.amount), facilitator,
      stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
  }
  // Counts every signature, so a refusal can prove nothing was signed.
  const payer = () => { const a = privateKeyToAccount(generatePrivateKey()); const signer = { signs: 0, ...walletSigner(a.address, d => {
    signer.signs++; return a.signTypedData({ ...d, primaryType: 'TransferWithAuthorization' } as never); }) }; return signer; };
  const pinned = (amount: bigint) => ({ network: NETWORK, asset: TOKEN, maxAmount: amount, payTo: PAY_TO });

  it('pays exactly the quoted amount, and returns the order', async () => {
    const s = await startShop(); const signer = payer();
    try {
      const out = await paidOrder({ url: s.url, signer, expected: pinned(s.amount) });
      expect(s.amount).toBeGreaterThan(100_000_000n);
      expect(out.amount).toBe(s.amount);
      expect(out.order).toMatchObject({ productId: 'airpods-pro-2', amount: s.amount.toString(), note: 'Demo order, not shipped' });
      expect(out.transaction).toBe(SETTLED);
      expect(signer.signs).toBe(1);
    } finally { await s.stop(); }
  });
  it('reports the checked 402 requirement, then the signing, in that order', async () => {
    const s = await startShop(); const signer = payer(); const seen: unknown[] = [];
    try {
      await paidOrder({ url: s.url, signer, expected: pinned(s.amount),
        onRequirement: requirement => seen.push({ requirement, signs: signer.signs }), onSigned: () => seen.push({ signed: signer.signs }) });
      expect(seen).toEqual([
        { requirement: { scheme: 'exact', network: NETWORK, asset: expect.stringMatching(new RegExp(TOKEN, 'i')), amount: s.amount.toString(), payTo: expect.stringMatching(new RegExp(PAY_TO, 'i')) }, signs: 0 },
        { signed: 1 }]);
    } finally { await s.stop(); }
  });
  it('reports neither when the 402 is refused', async () => {
    const s = await startShop(); const signer = payer(); const seen: string[] = [];
    const watch = { onRequirement: () => seen.push('requirement'), onSigned: () => seen.push('signed') };
    try {
      await paidOrder({ url: s.url, signer, expected: pinned(s.amount - 1n), ...watch }).catch(() => {});
      expect(seen).toEqual([]);
      expect(signer.signs).toBe(0);
    } finally { await s.stop(); }
  });
  it('still pays when the signing callback throws', async () => {
    const s = await startShop();
    try {
      const out = await paidOrder({ url: s.url, signer: payer(), expected: pinned(s.amount), onSigned: () => { throw new Error('sheet gone'); } });
      expect(out.transaction).toBe(SETTLED);
    } finally { await s.stop(); }
  });
  it('refuses a 402 asking more than expected, signing nothing', async () => {
    const s = await startShop(); const signer = payer();
    try {
      const failure = await paidOrder({ url: s.url, signer, expected: pinned(s.amount - 1n) }).catch(e => e);
      expect(failure).toBeInstanceOf(OrderFailed);
      expect(failure.message).toMatch(/^Refused to pay/);
      expect(failure.mayBePaid).toBe(false);
      expect(signer.signs).toBe(0);
      expect(s.facilitator.calls.verify).toBe(0);
    } finally { await s.stop(); }
  });
  it('refuses a 402 that pays someone other than the agent wallet', async () => {
    const s = await startShop(); const signer = payer();
    try {
      const failure = await paidOrder({ url: s.url, signer,
        expected: { ...pinned(s.amount), payTo: '0x2222222222222222222222222222222222222222' } }).catch(e => e);
      expect(failure).toBeInstanceOf(OrderFailed);
      expect(failure.message).toBe('Refused to pay: payTo');
      expect(signer.signs).toBe(0);
    } finally { await s.stop(); }
  });
  it('pays order after order in one day with no daily total', async () => {
    const s = await startShop(); const more = await startShop(); const signer = payer();
    try {
      const first = await paidOrder({ url: s.url, signer, expected: pinned(s.amount) });
      const second = await paidOrder({ url: more.url, signer, expected: pinned(more.amount) });
      expect(first.amount + second.amount).toBeGreaterThan(200_000_000n);
      expect(signer.signs).toBe(2);
    } finally { await s.stop(); await more.stop(); }
  });
  it('refuses an order price of 0 or less, before signing', () => {
    expect(() => countOrder(0n)).toThrow('Each order must be above 0');
    expect(() => countOrder(-1n)).toThrow('Each order must be above 0');
    expect(() => countOrder(500_000_000n)).not.toThrow();
    expect(() => countOrder(200_000_001n).release()).not.toThrow();
  });
  it('refuses an order above the max per purchase, before signing, and allows at or below it or with no max', async () => {
    expect(() => countOrder(1_500_001n, 1_500_000n)).toThrow('Above your 1.50 limit per purchase; change it in Settings');
    expect(() => countOrder(1_500_000n, 1_500_000n)).not.toThrow();
    expect(() => countOrder(1n, 1_500_000n)).not.toThrow();
    expect(() => countOrder(900_000_000n)).not.toThrow();
    const s = await startShop(); const signer = payer();
    try {
      const failure = await paidOrder({ url: s.url, signer, expected: pinned(s.amount), maxOrder: s.amount - 1n }).catch(e => e);
      expect(failure).toBeInstanceOf(OrderFailed);
      expect(failure.message).toMatch(/^Above your \d+\.\d\d limit per purchase; change it in Settings$/);
      expect(failure.mayBePaid).toBe(false);
      expect(signer.signs).toBe(0);
      expect((await paidOrder({ url: s.url, signer, expected: pinned(s.amount), maxOrder: s.amount })).amount).toBe(s.amount); // at the max is paid
    } finally { await s.stop(); }
  });
  it('reports a dropped connection after signing as interrupted', async () => {
    const s = await startShop();
    let calls = 0;
    const flaky = (async (input: any, init: any) => {
      if (++calls === 1) return fetch(input, init);
      throw new TypeError('network error');
    }) as typeof fetch;
    try {
      const failure = await paidOrder({ url: s.url, signer: payer(), expected: pinned(s.amount), fetch: flaky }).catch(e => e);
      expect(failure).toBeInstanceOf(OrderFailed);
      expect(failure.message).toBe('Order interrupted, it may have been paid, check Etherscan');
      expect(failure.mayBePaid).toBe(true);
    } finally { await s.stop(); }
  });
  it('reports a used quote as unavailable', async () => {
    const s = await startShop();
    try {
      await paidOrder({ url: s.url, signer: payer(), expected: pinned(s.amount) });
      const failure = await paidOrder({ url: s.url, signer: payer(), expected: pinned(s.amount) }).catch(e => e);
      expect(failure.message).toBe('Order unavailable');
      expect(failure.mayBePaid).toBe(false);
    } finally { await s.stop(); }
  });
  it('names an unreadable order', async () => {
    const s = await startShop();
    const garbled = (async (input: any, init: any) => {
      const response = await fetch(input, init);
      return response.status === 200 ? new Response('{"orderId":1}', { status: 200, headers: response.headers }) : response;
    }) as typeof fetch;
    try {
      const failure = await paidOrder({ url: s.url, signer: payer(), expected: pinned(s.amount), fetch: garbled }).catch(e => e);
      expect(failure.message).toBe('Shop returned an unreadable order');
      expect(failure.mayBePaid).toBe(true);
    } finally { await s.stop(); }
  });
});
