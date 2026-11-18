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
  it('does not look up once the cap is reached', async () => {
    const s = await start(); const budget = memory();
    budget.write(JSON.stringify({ day: madridDay(new Date()), spent: '5000000' }));
    try {
      const failure = await paidLookup({ url: `${s.base}/lookup`, merchant: 'GITHUB', signer: payer(), expected, budget }).catch(e => e);
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure.message).toBe('Daily cap reached, not looked up');
      expect(failure.feeMayBePaid).toBe(false);
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
  it('reports an unreachable service without counting anything', async () => {
    const budget = memory();
    const failure = await paidLookup({ url: 'http://127.0.0.1:9/lookup', merchant: 'GITHUB', signer: payer(), expected, budget, timeoutMs: 2000 }).catch(e => e);
    expect(failure.message).toBe('Lookup unavailable');
    expect(budget.text).toBeNull();
  });
});
