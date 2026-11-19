// Bitrefill's free browsing over its x402 REST API: one wallet sign-in (EIP-4361, EIP-191) yields an access token, then search and detail cost nothing.
// Nothing here pays: invoice/pay is never called. Every answer is parsed strictly; secrets never appear in thrown messages.
import { getAddress } from 'viem';

export type MessageSigner = { address: string; sign(message: string): Promise<string> };
export type BitrefillItem = { kind: 'giftcard' | 'esim' | 'topup'; slug: string; name: string; country: string | null;
  packages: { value: string; priceUsd: string }[]; fromUsd: string | null };

const BASE = 'https://api.bitrefill.com';
const CHAIN = 'eip155:42161'; // Arbitrum: the chain a purchase would use
const REFRESH_MARGIN_MS = 5 * 60_000;
const UNREADABLE = 'Bitrefill returned an unreadable answer';
const PATH = { giftcard: 'gift-cards', esim: 'esims', topup: 'topups' } as const;

type Fields = Record<string, unknown>;
const object = (value: unknown): Fields => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(UNREADABLE);
  return value as Fields;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') throw new Error(UNREADABLE);
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error(UNREADABLE);
  return value;
};
const SLUG = /^[a-z0-9_-]{1,80}$/; // underscores are real: noon_com-saudi-arabia
const MAX_NAME = 120;
const slug = (value: unknown): string => { const s = text(value); if (!SLUG.test(s)) throw new Error(UNREADABLE); return s; };
const name = (value: unknown): string => { const s = text(value); if (s.length > MAX_NAME) throw new Error(UNREADABLE); return s; };
const body = async (response: Response): Promise<unknown> => { try { return await response.json(); } catch { throw new Error(UNREADABLE); } };
const price = (value: unknown): string => {
  const s = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : value;
  if (typeof s !== 'string' || !/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(UNREADABLE);
  return s;
};

// Same layout as scripts/bitrefill-spike.ts: numeric chain id in the message, CAIP-2 in the payload.
function siweMessage(info: Fields, address: string, chainId: number): string {
  const statement = info.statement === undefined ? '' : text(info.statement);
  let message = `${text(info.domain)} wants you to sign in with your Ethereum account:\n${address}`;
  message += statement ? '\n\n' + statement : '\n';
  const lines = [`URI: ${text(info.uri)}`, `Version: ${text(info.version)}`, `Chain ID: ${chainId}`, `Nonce: ${text(info.nonce)}`, `Issued At: ${text(info.issuedAt)}`];
  if (info.expirationTime !== undefined) lines.push(`Expiration Time: ${text(info.expirationTime)}`);
  if (info.notBefore !== undefined) lines.push(`Not Before: ${text(info.notBefore)}`);
  if (info.requestId !== undefined) lines.push(`Request ID: ${text(info.requestId)}`);
  if (info.resources !== undefined) {
    const resources = list(info.resources).map(text);
    if (resources.length) lines.push(['Resources:', ...resources.map(r => `- ${r}`)].join('\n'));
  }
  return message + '\n\n' + lines.join('\n');
}

const base64 = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));

function parseDetail(value: unknown): BitrefillItem {
  const d = object(value);
  const packages = list(d.packages).map(raw => {
    const p = object(raw);
    if (p.payment_currency !== 'USD') throw new Error(UNREADABLE);
    return { value: text(p.package_value), priceUsd: price(p.payment_price) };
  });
  const categories = list(d.categories).map(text);
  const country = d.country_code === undefined || d.country_code === null || d.country_code === '' ? null : text(d.country_code);
  return {
    kind: categories.includes('esim') ? 'esim' : categories.includes('refill') ? 'topup' : 'giftcard',
    slug: slug(d.id), name: name(d.name), country, packages,
    fromUsd: packages.length ? packages.map(p => p.priceUsd).reduce((a, b) => (Number(b) < Number(a) ? b : a)) : null,
  };
}

export class BitrefillSession {
  private token: { value: string; expiresAt: number } | null = null;
  private signingIn: Promise<void> | null = null; // one sign-in at a time: parallel calls share it (30 requests a minute)
  constructor(private signer: MessageSigner, private doFetch: typeof fetch = fetch, private now: () => number = Date.now) {}

  signIn(): Promise<void> {
    return this.signingIn ??= this.connect().finally(() => { this.signingIn = null; });
  }

  private async connect(): Promise<void> {
    this.token = null;
    const address = getAddress(this.signer.address); // EIP-4361 needs the EIP-55 form
    const first = await this.doFetch(`${BASE}/x402/connect`, { method: 'POST', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (first.status !== 402) throw new Error(`Bitrefill sign-in answered ${first.status}`);
    const ext = object(object(object(await body(first)).extensions)['sign-in-with-x']);
    const info = object(ext.info);
    if (info.domain !== 'api.bitrefill.com' || new URL(text(info.uri)).origin !== BASE) throw new Error('Bitrefill sign-in challenge is not from api.bitrefill.com');
    const chain = list(ext.supportedChains).map(object).find(c => c.chainId === CHAIN && c.type === 'eip191');
    if (!chain) throw new Error('Bitrefill sign-in does not accept Arbitrum');
    const signature = text(await this.signer.sign(siweMessage(info, address, Number(CHAIN.split(':')[1]))));
    // The same optional fields as the signed message, so the two never disagree.
    const optional = Object.fromEntries(['statement', 'expirationTime', 'notBefore', 'requestId', 'resources'].filter(k => info[k] !== undefined).map(k => [k, info[k]]));
    const payload = { domain: info.domain, address, uri: info.uri, version: info.version, chainId: CHAIN, type: 'eip191', nonce: info.nonce, issuedAt: info.issuedAt, ...optional, signature };
    const second = await this.doFetch(`${BASE}/x402/connect`, {
      method: 'POST', headers: { accept: 'application/json', 'sign-in-with-x': base64(JSON.stringify(payload)) }, signal: AbortSignal.timeout(15_000),
    });
    if (second.status !== 200) throw new Error(`Bitrefill sign-in answered ${second.status}`);
    const answer = object(await body(second));
    if (typeof answer.expires_in !== 'number' || !(answer.expires_in > 300)) throw new Error(UNREADABLE);
    this.token = { value: text(answer.token), expiresAt: this.now() + answer.expires_in * 1000 };
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${BASE}/x402/${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      if (!this.token || this.now() >= this.token.expiresAt - REFRESH_MARGIN_MS) await this.signIn();
      const response = await this.doFetch(url, { headers: { accept: 'application/json', 'X-Access-Token': this.token!.value }, signal: AbortSignal.timeout(15_000) });
      // A revoked token may answer 401 or 402: sign in again once. A 402 is never paid.
      if ((response.status === 401 || response.status === 402) && attempt === 0) { this.token = null; continue; }
      if (response.status !== 200) throw new Error(`Bitrefill answered ${response.status}`);
      return body(response);
    }
  }

  async search(kind: BitrefillItem['kind'], query: string, country?: string): Promise<BitrefillItem[]> {
    const params: Record<string, string> = { q: query };
    if (country) params.country = country;
    const products = list(object(await this.get(`${PATH[kind]}/search`, params)).products).map(object);
    return products.filter(p => p.in_stock === true).slice(0, 5).map(p => {
      const countries = list(p.countries).map(text); // search carries no prices; detail does
      return { kind, slug: slug(p.slug), name: name(p.name), country: countries[0] ?? null, packages: [], fromUsd: null };
    });
  }

  async detail(id: string): Promise<BitrefillItem> {
    const item = parseDetail(await this.get('products/detail', { slug: id }));
    if (item.slug !== id) throw new Error(UNREADABLE);
    return item;
  }
}

export function bitrefillKind(query: string): Array<BitrefillItem['kind']> {
  if (/\b(esims?|data|roaming|sim)\b/i.test(query)) return ['esim'];
  if (/\b(top[- ]?ups?|airtime|credit)\b/i.test(query)) return ['topup'];
  return ['giftcard'];
}
