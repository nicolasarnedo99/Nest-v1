import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BitrefillSession, bitrefillKind } from '../../mobile/lib/bitrefill.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/bitrefill/${name}.json`, import.meta.url), 'utf8')).body;
const message = readFileSync(new URL('../fixtures/bitrefill/connect-message-arbitrum.txt', import.meta.url), 'utf8').trimEnd();
const ADDRESS = '0x1111111111111111111111111111111111111111';
const SIGNATURE = '0xSIGNATURE-SECRET';
const TOKEN = 'TOKEN-SECRET';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// A fake Bitrefill: connect hands out the fixture challenge, then a token; other paths come from `routes`.
function fake(routes: Record<string, () => Response>, connectStatus = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const signed: string[] = [];
  const doFetch = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    if (url.endsWith('/x402/connect')) {
      if (!headers['sign-in-with-x']) return json(fixture('connect-402-arbitrum'), 402);
      return connectStatus === 200 ? json({ token: TOKEN, token_header: 'X-Access-Token', expires_in: 7200 }) : json({}, connectStatus);
    }
    const route = Object.entries(routes).find(([path]) => url.includes(path));
    if (!route) throw new Error(`unexpected ${url}`);
    return route[1]();
  }) as unknown as typeof fetch;
  const signer = { address: ADDRESS, sign: async (m: string) => { signed.push(m); return SIGNATURE; } };
  return { calls, signed, doFetch, signer };
}

describe('Bitrefill sign-in', () => {
  it('signs the fixture challenge byte for byte and sends the header the spike sends', async () => {
    const f = fake({ 'gift-cards/search': () => json(fixture('gift-cards-search-noon-AE')) });
    await new BitrefillSession(f.signer, f.doFetch).search('giftcard', 'noon', 'AE');
    expect(f.signed).toEqual([message.replace('<throwaway address>', ADDRESS)]);
    const header = JSON.parse(Buffer.from(f.calls[1].headers['sign-in-with-x'], 'base64').toString('utf8'));
    const info = fixture('connect-402-arbitrum').extensions['sign-in-with-x'].info;
    expect(header).toEqual({
      domain: info.domain, address: ADDRESS, statement: info.statement, uri: info.uri, version: info.version, chainId: 'eip155:42161', type: 'eip191',
      nonce: info.nonce, issuedAt: info.issuedAt, expirationTime: info.expirationTime, resources: info.resources, signature: SIGNATURE,
    });
  });

  it('refuses a challenge from another domain, without signing', async () => {
    const bad = fixture('connect-402-arbitrum');
    bad.extensions['sign-in-with-x'].info.uri = 'https://evil.example/x402/connect';
    const f = fake({});
    const doFetch = (async () => json(bad, 402)) as unknown as typeof fetch;
    await expect(new BitrefillSession(f.signer, doFetch).signIn()).rejects.toThrow('not from api.bitrefill.com');
    expect(f.signed).toEqual([]);
  });

  it('reuses the token across searches, and signs in again 5 minutes before it expires', async () => {
    let time = 0;
    const f = fake({ 'esims/search': () => json(fixture('esims-search-spain')) });
    const session = new BitrefillSession(f.signer, f.doFetch, () => time);
    await session.search('esim', 'spain');
    await session.search('esim', 'spain');
    expect(f.signed).toHaveLength(1);
    time = (7200 - 301) * 1000;
    await session.search('esim', 'spain');
    expect(f.signed).toHaveLength(1);
    time = (7200 - 300) * 1000;
    await session.search('esim', 'spain');
    expect(f.signed).toHaveLength(2);
  });

  it('signs in again once on a 401, then throws on a second 401', async () => {
    let n = 0;
    const once = fake({ 'esims/search': () => (n++ === 0 ? json({}, 401) : json(fixture('esims-search-spain'))) });
    expect(await new BitrefillSession(once.signer, once.doFetch).search('esim', 'spain')).toHaveLength(1);
    expect(once.signed).toHaveLength(2);

    const always = fake({ 'esims/search': () => json({}, 401) });
    await expect(new BitrefillSession(always.signer, always.doFetch).search('esim', 'spain')).rejects.toThrow('Bitrefill answered 401');
    expect(always.signed).toHaveLength(2);
  });

  it('keeps the token and signature out of errors', async () => {
    const f = fake({ 'esims/search': () => json({ products: 'nope' }) });
    const errors = await Promise.all([
      new BitrefillSession(f.signer, f.doFetch).search('esim', 'spain').catch(e => String(e)),
      new BitrefillSession(fake({}, 500).signer, fake({}, 500).doFetch).signIn().catch(e => String(e)),
    ]);
    for (const e of errors) { expect(e).not.toContain(TOKEN); expect(e).not.toContain(SIGNATURE); }
    expect(errors[0]).toContain('unreadable');
  });
});

describe('Bitrefill review fixes', () => {
  it('signs in once for parallel calls', async () => {
    const f = fake({ 'products/detail?slug=noon-uae': () => json(fixture('products-detail-noon-uae')) });
    const s = new BitrefillSession(f.signer, f.doFetch);
    await Promise.all(Array.from({ length: 5 }, () => s.detail('noon-uae')));
    expect(f.signed).toHaveLength(1);
    expect(f.calls.filter(c => c.url.endsWith('/x402/connect'))).toHaveLength(2); // one challenge, one signed answer
  });

  it('signs in again once on a 402, and never pays it', async () => {
    let n = 0;
    const f = fake({ 'esims/search': () => (n++ === 0 ? json(fixture('esims-search-no-token'), 402) : json(fixture('esims-search-spain'))) });
    expect(await new BitrefillSession(f.signer, f.doFetch).search('esim', 'spain')).toHaveLength(1);
    expect(f.signed).toHaveLength(2);
    expect(f.calls.some(c => Object.keys(c.headers).some(h => /payment/i.test(h)))).toBe(false);
  });

  it('refuses a detail for another slug, a bad search slug and an overlong name', async () => {
    const other = fake({ 'products/detail': () => json(fixture('products-detail-noon-uae')) });
    await expect(new BitrefillSession(other.signer, other.doFetch).detail('steam-usa')).rejects.toThrow('unreadable');
    for (const over of [{ slug: '../evil' }, { slug: 'A'.repeat(81) }, { name: 'x'.repeat(121) }]) {
      const body = fixture('gift-cards-search-noon-AE');
      Object.assign(body.products[0], over);
      const f = fake({ 'gift-cards/search': () => json(body) });
      await expect(new BitrefillSession(f.signer, f.doFetch).search('giftcard', 'noon', 'AE')).rejects.toThrow('unreadable');
    }
  });

  it('signs with the EIP-55 address and throws on a non-JSON answer', async () => {
    const lower = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
    const f = fake({ 'esims/search': () => new Response('<html>', { status: 200 }) });
    const s = new BitrefillSession({ ...f.signer, address: lower }, f.doFetch);
    await expect(s.search('esim', 'spain')).rejects.toThrow('Bitrefill returned an unreadable answer');
    expect(f.signed[0]).toContain('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
  });
});

describe('Bitrefill search and detail', () => {
  it('hits each kind path with the token header, and carries no prices from search', async () => {
    const f = fake({
      'gift-cards/search': () => json(fixture('gift-cards-search-noon-AE')),
      'esims/search': () => json(fixture('esims-search-spain')),
      'topups/search': () => json(fixture('topups-search-spain')),
    });
    const s = new BitrefillSession(f.signer, f.doFetch);
    expect(await s.search('giftcard', 'noon', 'AE')).toEqual([{ kind: 'giftcard', slug: 'noon-uae', name: 'Noon.com UAE', country: 'AE', packages: [], fromUsd: null }]);
    expect((await s.search('esim', 'spain'))[0]).toMatchObject({ kind: 'esim', slug: 'bitrefill-esim-spain', country: 'ES', fromUsd: null });
    expect((await s.search('topup', 'spain')).length).toBeLessThanOrEqual(5);
    const paths = f.calls.slice(2).map(c => c.url);
    expect(paths).toEqual([
      'https://api.bitrefill.com/x402/gift-cards/search?q=noon&country=AE',
      'https://api.bitrefill.com/x402/esims/search?q=spain',
      'https://api.bitrefill.com/x402/topups/search?q=spain',
    ]);
    for (const c of f.calls.slice(2)) expect(c.headers['X-Access-Token']).toBe(TOKEN);
  });

  it('keeps only in-stock products', async () => {
    const body = fixture('gift-cards-search-noon');
    body.products[0].in_stock = false;
    const f = fake({ 'gift-cards/search': () => json(body) });
    expect((await new BitrefillSession(f.signer, f.doFetch).search('giftcard', 'noon')).map(i => i.slug)).toEqual(['noon_com-saudi-arabia']);
  });

  it('reads packages and prices from detail', async () => {
    const f = fake({ 'products/detail?slug=noon-uae': () => json(fixture('products-detail-noon-uae')), 'products/detail?slug=bitrefill-esim-spain': () => json(fixture('products-detail-esim')) });
    const s = new BitrefillSession(f.signer, f.doFetch);
    const noon = await s.detail('noon-uae');
    expect(noon).toMatchObject({ kind: 'giftcard', slug: 'noon-uae', country: 'AE', fromUsd: '2.82' });
    expect(noon.packages).toHaveLength(8);
    expect(noon.packages).toContainEqual({ value: '10', priceUsd: '2.82' });
    const esim = await s.detail('bitrefill-esim-spain');
    expect(esim).toMatchObject({ kind: 'esim', fromUsd: '2.53' });
    expect(esim.packages).toContainEqual({ value: '1GB, 7 Days', priceUsd: '2.53' });
    expect(esim.packages).toHaveLength(11);
  });

  it('throws on unreadable answers and on a fee instead of paying it', async () => {
    const detail = fixture('products-detail-noon-uae');
    const cases: [string, () => Response][] = [
      ['products not a list', () => json({ products: {} })],
      ['not an object', () => json([])],
      ['product without slug', () => json({ products: [{ name: 'x', countries: [], in_stock: true }] })],
    ];
    for (const [, route] of cases) {
      const f = fake({ 'esims/search': route });
      await expect(new BitrefillSession(f.signer, f.doFetch).search('esim', 'x')).rejects.toThrow('Bitrefill returned an unreadable answer');
    }
    for (const bad of ['1,5', '-1', 'free', null, {}]) {
      const body = { ...detail, packages: [{ ...detail.packages[0], payment_price: bad }] };
      const f = fake({ 'products/detail': () => json(body) });
      await expect(new BitrefillSession(f.signer, f.doFetch).detail('noon-uae')).rejects.toThrow('unreadable');
    }
    const f = fake({ 'esims/search': () => json(fixture('esims-search-no-token'), 402) });
    await expect(new BitrefillSession(f.signer, f.doFetch).search('esim', 'x')).rejects.toThrow('Bitrefill answered 402');
  });

  it('turns numeric prices into 2-decimal strings', async () => {
    const detail = fixture('products-detail-noon-uae');
    const body = { ...detail, packages: [{ ...detail.packages[0], payment_price: 3 }] };
    const f = fake({ 'products/detail': () => json(body) });
    expect((await new BitrefillSession(f.signer, f.doFetch).detail('noon-uae')).packages[0].priceUsd).toBe('3.00');
  });
});

describe('bitrefillKind', () => {
  it('routes requests to the right search', () => {
    expect(bitrefillKind('eSIM for Spain')).toEqual(['esim']);
    expect(bitrefillKind('mobile data for Japan')).toEqual(['esim']);
    expect(bitrefillKind('top up my du number')).toEqual(['topup']);
    expect(bitrefillKind('noon gift card')).toEqual(['giftcard']);
    expect(bitrefillKind('Netflix')).toEqual(['giftcard']);
  });
});
