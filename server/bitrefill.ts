// The mirror's Bitrefill client: wallet sign-in (free) and product detail, the only call that carries prices.
// Signs in with its own throwaway key, generated in memory at start and never logged; it never pays anything.
// Message layout as in scripts/bitrefill-spike.ts (EIP-4361, EIP-191), fixtures in tests/fixtures/bitrefill/.
import type { LocalAccount } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export const BITREFILL = 'https://api.bitrefill.com';
// Arbitrum, the chain the real purchase would pay on.
const CHAIN = 'eip155:42161';
export const SLUG = /^[a-z0-9-]{1,80}$/;
const PRICE = /^\d{1,9}(\.\d{1,18})?$/;

export type Kind = 'giftcard' | 'esim' | 'topup';
export type Package = { value: string; currency: string; priceUsd: string };
export type Detail = { slug: string; name: string; kind: Kind; inStock: boolean; packages: Package[] };

// Thrown for a package Bitrefill prices in another currency, so the mirror can say so instead of "unreachable".
export class NotSoldInUsd extends Error {}
const fail = (what: string): never => { throw new Error(`bitrefill: ${what}`); };
const record = (value: unknown, what: string) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(what);
const string = (value: unknown, what: string) => typeof value === 'string' && value.length > 0 ? value : fail(what);

// The kind comes from the categories: eSIMs are "esim", phone top-ups "refill", everything else is a gift card.
export function parseDetail(raw: unknown, slug: string): Detail {
  const body = record(raw, 'detail is not an object');
  if (body.id !== slug) fail('detail is for another product');
  if (typeof body.in_stock !== 'boolean') fail('in_stock is not a boolean');
  const categories = Array.isArray(body.categories) && body.categories.every(c => typeof c === 'string') ? body.categories as string[] : fail('categories is not a list of strings');
  if (!Array.isArray(body.packages)) fail('packages is not a list');
  const packages = (body.packages as unknown[]).map(raw => {
    const p = record(raw, 'package is not an object');
    // Only USD prices are understood; anything else cannot be quoted.
    if (p.payment_currency !== 'USD') throw new NotSoldInUsd('bitrefill: package is not priced in USD');
    const priceUsd = string(p.payment_price, 'payment_price is not a string');
    if (!PRICE.test(priceUsd)) fail('payment_price is not a decimal');
    return { value: string(p.package_value, 'package_value is not a string'), currency: string(p.package_currency, 'package_currency is not a string'), priceUsd };
  });
  const kind: Kind = categories.includes('esim') ? 'esim' : categories.includes('refill') ? 'topup' : 'giftcard';
  return { slug, name: string(body.name, 'name is not a string'), kind, inStock: body.in_stock as boolean, packages };
}

type Info = { domain: string; uri: string; version: string; nonce: string; issuedAt: string; statement?: string;
  expirationTime?: string; notBefore?: string; requestId?: string; resources?: string[] };

function challengeOf(raw: unknown): Info {
  const ext = record(record(record(raw, 'challenge is not an object').extensions, 'challenge has no extensions')['sign-in-with-x'], 'no sign-in-with-x challenge');
  const info = record(ext.info, 'challenge has no info');
  const out: Info = { domain: string(info.domain, 'domain'), uri: string(info.uri, 'uri'), version: string(info.version, 'version'),
    nonce: string(info.nonce, 'nonce'), issuedAt: string(info.issuedAt, 'issuedAt') };
  if (out.domain !== 'api.bitrefill.com' || new URL(out.uri).origin !== BITREFILL) fail('challenge not from api.bitrefill.com');
  for (const key of ['statement', 'expirationTime', 'notBefore', 'requestId'] as const)
    if (info[key] !== undefined) out[key] = string(info[key], key);
  if (info.resources !== undefined) out.resources = Array.isArray(info.resources) && info.resources.every(r => typeof r === 'string') ? info.resources as string[] : fail('resources');
  const chains = Array.isArray(ext.supportedChains) ? ext.supportedChains as unknown[] : fail('supportedChains is not a list');
  if (!chains.some(c => c && typeof c === 'object' && (c as Record<string, unknown>).chainId === CHAIN && (c as Record<string, unknown>).type === 'eip191'))
    fail(`challenge does not offer ${CHAIN}`);
  return out;
}

// EIP-4361: numeric chain id in the message, CAIP-2 in the header payload.
export function siweMessage(info: Info, address: string): string {
  const prefix = `${info.domain} wants you to sign in with your Ethereum account:\n${address}` + (info.statement ? `\n\n${info.statement}` : '\n');
  const suffix = [`URI: ${info.uri}`, `Version: ${info.version}`, `Chain ID: ${CHAIN.split(':')[1]}`, `Nonce: ${info.nonce}`, `Issued At: ${info.issuedAt}`];
  if (info.expirationTime) suffix.push(`Expiration Time: ${info.expirationTime}`);
  if (info.notBefore) suffix.push(`Not Before: ${info.notBefore}`);
  if (info.requestId) suffix.push(`Request ID: ${info.requestId}`);
  if (info.resources?.length) suffix.push(['Resources:', ...info.resources.map(r => `- ${r}`)].join('\n'));
  return `${prefix}\n\n${suffix.join('\n')}`;
}

export type BitrefillOptions = { fetch?: typeof fetch; now?: () => number; account?: LocalAccount; timeoutMs?: number };

export function createBitrefill(options: BitrefillOptions = {}) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;
  // Every request gets a deadline; a timeout rejects, which the quote route answers with 503.
  const send = (url: string, init: RequestInit) => fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const account = options.account ?? privateKeyToAccount(generatePrivateKey());
  let session: { token: string; renewAt: number } | null = null;
  // shortcut: two quotes arriving together while signed out both sign in (2 extra requests of the 30/min); add a shared in-flight promise if quotes get busy.

  async function signIn(): Promise<string> {
    const challenge = await send(`${BITREFILL}/x402/connect`, { method: 'POST', headers: { accept: 'application/json' } });
    if (challenge.status !== 402) fail(`connect answered ${challenge.status}, expected 402`);
    const info = challengeOf(await challenge.json());
    const signature = await account.signMessage({ message: siweMessage(info, account.address) });
    const header = Buffer.from(JSON.stringify({ ...info, address: account.address, chainId: CHAIN, type: 'eip191', signature })).toString('base64');
    const res = await send(`${BITREFILL}/x402/connect`, { method: 'POST', headers: { accept: 'application/json', 'sign-in-with-x': header } });
    if (res.status !== 200) fail(`sign-in answered ${res.status}`);
    const body = record(await res.json(), 'sign-in answer is not an object');
    const token = string(body.token, 'sign-in answer has no token');
    if (typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 300) fail('expires_in is not a number above 300');
    // Renew 5 minutes before Bitrefill's expiry.
    session = { token, renewAt: now() + ((body.expires_in as number) - 300) * 1000 };
    return token;
  }

  // A 401 or 402 means the token was refused: sign in again, once.
  async function get(path: string): Promise<Response> {
    const call = (token: string) => send(`${BITREFILL}${path}`, { headers: { accept: 'application/json', 'X-Access-Token': token } });
    const res = await call(session && now() < session.renewAt ? session.token : await signIn());
    if (res.status !== 401 && res.status !== 402) return res;
    session = null;
    return call(await signIn());
  }

  // shortcut: answers (and 404s) are kept 60 s per slug in memory, unbounded but slugs are validated and the process restarts on deploy; with the mirror's 20/min cap this keeps Bitrefill under its 30/min.
  const cache = new Map<string, { until: number; detail: Detail | null }>();

  return {
    // null for a product Bitrefill does not have; throws when Bitrefill cannot answer or answers something unexpected.
    async productDetail(slug: string): Promise<Detail | null> {
      if (!SLUG.test(slug)) fail('bad slug');
      const hit = cache.get(slug);
      if (hit && now() < hit.until) return hit.detail;
      const res = await get(`/x402/products/detail?slug=${encodeURIComponent(slug)}`);
      if (res.status !== 404 && res.status !== 200) fail(`detail answered ${res.status}`);
      const detail = res.status === 404 ? null : parseDetail(await res.json(), slug);
      cache.set(slug, { until: now() + 60_000, detail });
      return detail;
    },
  };
}

export type Bitrefill = ReturnType<typeof createBitrefill>;
