import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { createBitrefill, NotSoldInUsd, parseDetail } from '../../server/bitrefill.js';

// Fixtures recorded by scripts/bitrefill-spike.ts; never the live API.
const dir = new URL('../fixtures/bitrefill/', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
const challenge = fixture('connect-402-arbitrum').body;
const esim = fixture('products-detail-esim').body;
const noon = fixture('products-detail-noon-uae').body;
// A fixed test key, so the message and signature can be checked.
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

type Seen = { url: string; headers: Record<string, string> };
// Answers the challenge, then sign-ins with tok-1, tok-2, …; detail calls get whatever `detail` returns for the token sent.
function fakeBitrefill(detail: (token: string) => { status: number; body?: unknown } = () => ({ status: 200, body: noon })) {
  const seen: Seen[] = [];
  let signIns = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFake = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.push({ url, headers });
    if (url.endsWith('/x402/connect')) return headers['sign-in-with-x'] ? json(200, { token: `tok-${++signIns}`, token_header: 'X-Access-Token', expires_in: 7200 }) : json(402, challenge);
    const answer = detail(headers['X-Access-Token']!);
    return json(answer.status, answer.body ?? { error: 'x' });
  }) as typeof fetch;
  return { fetchFake, seen, signIns: () => signIns };
}

describe('Bitrefill sign-in', () => {
  it('signs the fixture challenge as an EIP-4361 message for Arbitrum and sends the decomposed header', async () => {
    const fake = fakeBitrefill();
    await createBitrefill({ fetch: fake.fetchFake, account }).productDetail('noon-uae');
    const sent = fake.seen[1]!.headers['sign-in-with-x']!;
    const payload = JSON.parse(Buffer.from(sent, 'base64').toString('utf8'));
    const { info } = challenge.extensions['sign-in-with-x'];
    expect(payload).toEqual({ ...info, address: account.address, chainId: 'eip155:42161', type: 'eip191', signature: expect.stringMatching(/^0x[0-9a-f]{130}$/) });
    // The exact message the live sign-in accepted, with this key's address in place of the throwaway one.
    const message = readFileSync(new URL('connect-message-arbitrum.txt', dir), 'utf8').trimEnd().replace('<throwaway address>', account.address);
    expect(await verifyMessage({ address: account.address, message, signature: payload.signature })).toBe(true);
    expect(fake.seen[2]).toEqual({ url: 'https://api.bitrefill.com/x402/products/detail?slug=noon-uae', headers: { accept: 'application/json', 'X-Access-Token': 'tok-1' } });
  });
  it('reuses the token, and signs in again 5 minutes before it expires', async () => {
    let time = 0;
    const fake = fakeBitrefill();
    const client = createBitrefill({ fetch: fake.fetchFake, account, now: () => time });
    await client.productDetail('noon-uae');
    time = (7200 - 300) * 1000 - 1;
    await client.productDetail('noon-uae');
    expect(fake.signIns()).toBe(1);
    // Past the 60 s detail cache too, so the call reaches Bitrefill.
    time += 60_000;
    await client.productDetail('noon-uae');
    expect(fake.signIns()).toBe(2);
    expect(fake.seen.at(-1)!.headers['X-Access-Token']).toBe('tok-2');
  });
  it('signs in again once when the token is refused, and gives up on a second refusal', async () => {
    const fake = fakeBitrefill(token => token === 'tok-1' ? { status: 401 } : { status: 200, body: noon });
    expect((await createBitrefill({ fetch: fake.fetchFake, account }).productDetail('noon-uae'))!.slug).toBe('noon-uae');
    expect(fake.signIns()).toBe(2);
    const refused = fakeBitrefill(() => ({ status: 402 }));
    await expect(createBitrefill({ fetch: refused.fetchFake, account }).productDetail('noon-uae')).rejects.toThrow('detail answered 402');
    expect(refused.signIns()).toBe(2);
  });
  it('refuses a challenge from another domain or without Arbitrum, before signing', async () => {
    for (const change of [(c: any) => { c.extensions['sign-in-with-x'].info.domain = 'evil.example'; },
      (c: any) => { c.extensions['sign-in-with-x'].supportedChains = [{ chainId: 'eip155:8453', type: 'eip191' }]; }]) {
      const bad = structuredClone(challenge); change(bad);
      const fetchFake = (async () => new Response(JSON.stringify(bad), { status: 402 })) as unknown as typeof fetch;
      await expect(createBitrefill({ fetch: fetchFake, account }).productDetail('noon-uae')).rejects.toThrow(/bitrefill: challenge/);
    }
  });
});

describe('Bitrefill product detail', () => {
  it('parses the fixture packages with their USD prices and kind', () => {
    const detail = parseDetail(noon, 'noon-uae');
    expect(detail).toMatchObject({ slug: 'noon-uae', name: 'Noon.com UAE', kind: 'giftcard', inStock: true });
    expect(detail.packages.at(-1)).toEqual({ value: '10', currency: 'AED', priceUsd: '2.82' });
    expect(parseDetail(esim, 'bitrefill-esim-spain')).toMatchObject({ kind: 'esim', packages: expect.arrayContaining([{ value: '1GB, 7 Days', currency: 'USD', priceUsd: '2.53' }]) });
    expect(parseDetail({ ...noon, id: 'vodafone-spain', categories: ['refill'] }, 'vodafone-spain').kind).toBe('topup');
  });
  it('rejects wrong types, another product, and non-USD prices', () => {
    const pkg = noon.packages[0];
    for (const bad of [null, [], { ...noon, id: 'other' }, { ...noon, in_stock: 'yes' }, { ...noon, name: 7 }, { ...noon, categories: 'esim' },
      { ...noon, packages: {} }, { ...noon, packages: [{ ...pkg, payment_price: 2.82 }] }, { ...noon, packages: [{ ...pkg, payment_price: '2,82' }] },
      { ...noon, packages: [{ ...pkg, payment_currency: 'EUR' }] }, { ...noon, packages: [{ ...pkg, package_value: 10 }] }, { ...noon, packages: [null] }])
      expect(() => parseDetail(bad, 'noon-uae')).toThrow(/^bitrefill: /);
  });
  it('answers null for an unknown product and throws on a server error or a bad slug', async () => {
    expect(await createBitrefill({ fetch: fakeBitrefill(() => ({ status: 404 })).fetchFake, account }).productDetail('nothing')).toBeNull();
    await expect(createBitrefill({ fetch: fakeBitrefill(() => ({ status: 500 })).fetchFake, account }).productDetail('noon-uae')).rejects.toThrow('detail answered 500');
    const fake = fakeBitrefill();
    await expect(createBitrefill({ fetch: fake.fetchFake, account }).productDetail('../x')).rejects.toThrow('bad slug');
    expect(fake.seen).toEqual([]);
  });
});
describe('Bitrefill deadlines and caching', () => {
  it('fails closed when Bitrefill never answers, by aborting the request at the deadline', async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
    await expect(createBitrefill({ fetch: hang, account, timeoutMs: 20 }).productDetail('noon-uae')).rejects.toThrow();
  });
  it('sends every request with a 15 s abort signal by default', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fake = fakeBitrefill();
    await createBitrefill({ fetch: ((u: string, i: RequestInit) => { signals.push(i.signal); return fake.fetchFake(u, i); }) as typeof fetch, account }).productDetail('noon-uae');
    expect(signals).toHaveLength(3);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
  });
  it('makes one detail call for the same slug within 60 s, and asks again after', async () => {
    let time = 0;
    const fake = fakeBitrefill();
    const client = createBitrefill({ fetch: fake.fetchFake, account, now: () => time });
    const details = () => fake.seen.filter(s => s.url.includes('/products/detail')).length;
    await client.productDetail('noon-uae');
    time = 59_999;
    await client.productDetail('noon-uae');
    expect(details()).toBe(1);
    await client.productDetail('esim-other').catch(() => {});
    expect(details()).toBe(2);
    time = 60_000;
    await client.productDetail('noon-uae');
    expect(details()).toBe(3);
  });
  it('does not cache a failure', async () => {
    let status = 500;
    const fake = fakeBitrefill(() => ({ status, body: noon }));
    const client = createBitrefill({ fetch: fake.fetchFake, account });
    await expect(client.productDetail('noon-uae')).rejects.toThrow('detail answered 500');
    status = 200;
    expect((await client.productDetail('noon-uae'))!.slug).toBe('noon-uae');
  });
  it('raises NotSoldInUsd for a package priced in another currency', async () => {
    const eur = { ...noon, packages: [{ ...noon.packages[0], payment_currency: 'EUR' }] };
    await expect(createBitrefill({ fetch: fakeBitrefill(() => ({ status: 200, body: eur })).fetchFake, account }).productDetail('noon-uae')).rejects.toBeInstanceOf(NotSoldInUsd);
  });
});
