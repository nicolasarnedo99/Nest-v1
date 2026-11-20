import { describe, expect, it } from 'vitest';
import { faucetUrl, requestTestFunds } from '../../mobile/lib/faucet.js';

const HASH = `0x${'ab'.repeat(32)}`;
const ADDRESS = '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359';
const answer = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, doFetch };
};

describe('faucetUrl', () => {
  it('is the lookup endpoint origin plus /faucet', () => {
    expect(faucetUrl('https://morty.tail73d5db.ts.net/lookup')).toBe('https://morty.tail73d5db.ts.net/faucet');
    expect(faucetUrl('https://x.test:8443/a/b?c=d')).toBe('https://x.test:8443/faucet');
  });
});

describe('requestTestFunds', () => {
  it('POSTs the address once and reads the amount and transaction', async () => {
    const { calls, doFetch } = answer(200, { amount: '100', transaction: HASH });
    await expect(requestTestFunds('https://x.test/faucet', ADDRESS, doFetch)).resolves.toEqual({ amount: '100', transaction: HASH });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ address: ADDRESS });
  });

  it('shows the server message as is, e.g. the 429 limit text', async () => {
    const { calls, doFetch } = answer(429, { error: 'This wallet already got test funds today; try again in 24 hours' });
    await expect(requestTestFunds('https://x.test/faucet', ADDRESS, doFetch)).rejects.toThrow('This wallet already got test funds today; try again in 24 hours');
    expect(calls).toHaveLength(1); // no retries
  });

  it('names the status when the error body is not readable', async () => {
    await expect(requestTestFunds('https://x.test/faucet', ADDRESS, answer(502, '<html>').doFetch)).rejects.toThrow('Test funds unavailable (502)');
  });

  it.each([
    ['no transaction', { amount: '100' }],
    ['a short transaction', { amount: '100', transaction: '0xabc' }],
    ['a numeric amount', { amount: 100, transaction: HASH }],
    ['not JSON', 'ok'],
  ])('rejects a 200 with %s', async (_name, body) => {
    await expect(requestTestFunds('https://x.test/faucet', ADDRESS, answer(200, body).doFetch)).rejects.toThrow('unreadable');
  });
});
