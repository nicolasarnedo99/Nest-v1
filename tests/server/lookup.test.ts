import { once } from 'node:events';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createLookupApp, findMerchant, normalise } from '../../server/lookup.js';
import table from '../../server/merchants.json' with { type: 'json' };

describe('findMerchant: the demo table', () => {
  it('normalises card-statement text into words', () => {
    expect(normalise("APPLEBEE'S GRILL 1123 ORLANDO FL")).toEqual(['APPLEBEES', 'GRILL', '1123', 'ORLANDO', 'FL']);
    expect(normalise('apple.com/bill')).toEqual(['APPLE', 'COM', 'BILL']);
  });
  it('names the franchise operator, not the brand, for Carrefour in Dubai', () => {
    expect(findMerchant('CARREFOUR EXPRESS DUBAI')).toMatchObject({ operator: 'Majid Al Futtaim Retail', listedParent: null });
  });
  it('prefers the more specific entry', () => {
    expect(findMerchant('CARREFOUR MADRID').operator).toBe('Carrefour SA or a local franchisee');
  });
  it('maps a subsidiary to its listed parent', () => {
    expect(findMerchant('GITHUB, INC.')).toMatchObject({ operator: 'GitHub', listedParent: 'Microsoft' });
    expect(findMerchant('GOOGLE *GOOGLE ONE')).toMatchObject({ listedParent: 'Alphabet' });
  });
  it('does not mistake a reseller or a name coincidence for Apple', () => {
    expect(findMerchant('K-TUIN MADRID')).toMatchObject({ operator: 'K-Tuin', listedParent: null });
    expect(findMerchant("APPLEBEE'S GRILL 1123 ORLANDO FL").listedParent).toBeNull();
    expect(findMerchant('APPLE.COM/BILL').listedParent).toBe('Apple');
  });
  it('returns nothing for an unknown merchant', () => {
    expect(findMerchant('CAFE DEL BARRIO')).toEqual({ operator: null, listedParent: null });
  });
  it('keeps every listed parent to the five companies', () => {
    const five = ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA', null];
    for (const entry of table) expect(five).toContain(entry.listedParent);
  });
});

const NETWORK = 'eip155:11155111';
const TOKEN = '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f';
const PAY_TO = '0x1111111111111111111111111111111111111111';

function fakeFacilitator(outcome: { valid?: boolean; settled?: boolean } = {}) {
  const calls = { verify: 0, settle: 0 };
  return { calls, client: {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }], extensions: [], signers: {} }),
    verify: async (payload: any) => { calls.verify++; return outcome.valid === false
      ? { isValid: false, invalidReason: 'invalid_exact_evm_signature' } : { isValid: true, payer: payload.payload.authorization.from }; },
    settle: async (payload: any) => { calls.settle++; return outcome.settled === false
      ? { success: false, errorReason: 'transaction_failed', transaction: '', network: NETWORK }
      : { success: true, transaction: '0xsettled', network: NETWORK, payer: payload.payload.authorization.from }; },
  } };
}

async function start(facilitator = fakeFacilitator(), extra: Partial<Parameters<typeof createLookupApp>[0]> = {}) {
  const app = createLookupApp({ facilitator: facilitator.client as never, payTo: PAY_TO, chainId: 11155111,
    token: TOKEN, tokenName: 'Test USDT0 copy (Turtle demo)', ...extra });
  const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, facilitator, stop: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
// A payment header built by the real client with a throwaway viem key: the fake facilitator never checks it.
async function paidFetch(url: string) {
  const { x402Client, wrapFetchWithPayment } = await import('@x402/fetch');
  const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
  const payer = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client();
  client.setSpendControls({ allowedAssets: [{ network: NETWORK, asset: TOKEN, maxAmountPerPayment: '10000' }] });
  registerExactEvmScheme(client, { signer: { address: payer.address, signTypedData: d => payer.signTypedData(d as never) } });
  return wrapFetchWithPayment(fetch, client)(url);
}

describe('GET /lookup: paid over x402', () => {
  it('answers an unpaid request with a 402 naming our token, price and EIP-712 domain', async () => {
    const s = await start();
    try {
      const res = await fetch(`${s.base}/lookup?merchant=GITHUB`);
      expect(res.status).toBe(402);
      const required = JSON.parse(atob(res.headers.get('payment-required')!));
      expect(required.accepts).toHaveLength(1);
      expect(required.accepts[0]).toMatchObject({ scheme: 'exact', network: NETWORK, asset: TOKEN, amount: '10000', payTo: PAY_TO,
        extra: { name: 'Test USDT0 copy (Turtle demo)', version: '1' } });
      expect(JSON.stringify(required)).not.toContain('acquired GitHub'); // no table data before payment
    } finally { await s.stop(); }
  });
  it('refuses bad merchant input before asking for payment', async () => {
    const s = await start();
    try {
      for (const q of ['', '?merchant=', `?merchant=${'A'.repeat(161)}`, '?merchant=%07BELL']) {
        const res = await fetch(`${s.base}/lookup${q}`);
        expect(res.status).toBe(400);
        expect(res.headers.get('payment-required')).toBeNull();
      }
    } finally { await s.stop(); }
  });
  it('serves the table result after a valid payment, and settles exactly once', async () => {
    const s = await start();
    try {
      const res = await paidFetch(`${s.base}/lookup?merchant=${encodeURIComponent('GITHUB, INC.')}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ merchant: 'GITHUB, INC.', operator: 'GitHub', listedParent: 'Microsoft',
        note: 'Microsoft acquired GitHub in 2018.', source: 'demo table' });
      expect(s.facilitator.calls.settle).toBe(1);
      expect(res.headers.get('payment-response')).toBeTruthy();
    } finally { await s.stop(); }
  });
  it('charges for an unknown merchant and says so', async () => {
    const s = await start();
    try {
      const unpaid = await fetch(`${s.base}/lookup?merchant=CAFE`);
      expect(JSON.parse(atob(unpaid.headers.get('payment-required')!)).resource.description).toMatch(/unknown merchant is still charged/i);
      const res = await paidFetch(`${s.base}/lookup?merchant=CAFE`);
      expect(await res.json()).toMatchObject({ operator: null, listedParent: null, source: 'demo table' });
    } finally { await s.stop(); }
  });
  it('serves nothing when verification fails', async () => {
    const s = await start(fakeFacilitator({ valid: false }));
    try {
      const res = await paidFetch(`${s.base}/lookup?merchant=GITHUB`);
      expect(res.status).toBe(402);
      expect(await res.text()).not.toContain('Microsoft');
      expect(s.facilitator.calls.settle).toBe(0);
    } finally { await s.stop(); }
  });
  it('serves nothing when settlement fails', async () => {
    const s = await start(fakeFacilitator({ settled: false }));
    try {
      const res = await paidFetch(`${s.base}/lookup?merchant=GITHUB`);
      expect(res.status).toBe(402);
      expect(await res.text()).not.toContain('Microsoft');
    } finally { await s.stop(); }
  });
  it('rate-limits the public route', async () => {
    const s = await start(undefined, { limitPerMinute: 3 });
    try {
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await fetch(`${s.base}/lookup?merchant=GITHUB`)).status);
      expect(codes).toEqual([402, 402, 402, 429]);
    } finally { await s.stop(); }
  });
  it('answers 404 for every other path', async () => {
    const s = await start();
    try { expect((await fetch(`${s.base}/api/status`)).status).toBe(404); } finally { await s.stop(); }
  });
});
