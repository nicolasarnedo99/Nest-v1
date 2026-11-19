// Live spike against Bitrefill's agent API (x402 REST), from a throwaway key.
// Signs in with the wallet (free), browses with the access token, and saves
// every raw response to tests/fixtures/bitrefill/ with secrets redacted.
// Never pays: invoice/pay is called once with no payment header, only to
// record the 402 requirements it would ask for.
//
// Reference for WS1/WS2. Message layout follows bitrefill/agents
// skills/bitrefill/scripts/siwx_build_message.js (EIP-4361, EIP-191 sign).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const BASE = 'https://api.bitrefill.com';
const OUT = fileURLToPath(new URL('../tests/fixtures/bitrefill/', import.meta.url));
const KEPT_HEADERS = /^(content-type|payment-required|x-payment-response|payment-response|retry-after|x-ratelimit-.*|ratelimit.*|www-authenticate|cf-ipcountry|x-request-id)$/i;
const SECRET_KEYS = new Set(['token', 'signature', 'access_token', 'accessToken', 'jwt']);

// A throwaway signer generated in memory: never printed, never saved.
const account = privateKeyToAccount(generatePrivateKey());

type Call = { status: number; headers: Record<string, string>; body: unknown };

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.has(k) ? '<redacted>' : redact(v)]));
  return value;
}

function decodeBase64Json(value: string): unknown {
  try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')); } catch { return undefined; }
}

async function call(name: string, method: 'GET' | 'POST', path: string, init: { headers?: Record<string, string>; json?: unknown } = {}): Promise<Call> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  const kept = Object.fromEntries([...res.headers].filter(([k]) => KEPT_HEADERS.test(k)));
  const fixture: Record<string, unknown> = {
    request: { method, url: BASE + path, headers: Object.keys(headers), json: init.json },
    capturedAt: new Date().toISOString(),
    status: res.status,
    headers: kept,
    body: redact(body),
  };
  const pr = kept['payment-required'];
  if (pr) fixture.paymentRequiredDecoded = redact(decodeBase64Json(pr));
  writeFileSync(OUT + name + '.json', JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${name.padEnd(28)} ${method} ${path} -> ${res.status} ${summary(body)}`);
  return { status: res.status, headers: kept, body };
}

function summary(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const k of ['products', 'results', 'data', 'items', 'packages'])
      if (Array.isArray(b[k])) return `${k}: ${(b[k] as unknown[]).length}`;
    return `keys: ${Object.keys(b).slice(0, 8).join(',')}`;
  }
  return String(body).slice(0, 80);
}

type Challenge = { info: Record<string, any>; supportedChains: { chainId: string; type?: string }[] };

function challengeOf(body: any): Challenge {
  const ext = body?.extensions?.['sign-in-with-x'];
  if (!ext?.info) throw new Error('402 has no sign-in-with-x challenge');
  if (ext.info.domain !== 'api.bitrefill.com' || new URL(ext.info.uri).origin !== BASE) throw new Error('challenge not from api.bitrefill.com');
  return ext;
}

// EIP-4361. Numeric chain id in the message, CAIP-2 in the payload.
function siweMessage(info: Record<string, any>, address: string, chainId: number): string {
  let prefix = `${info.domain} wants you to sign in with your Ethereum account:\n${address}`;
  prefix += info.statement ? '\n\n' + info.statement : '\n';
  const suffix = [`URI: ${info.uri}`, `Version: ${info.version}`, `Chain ID: ${chainId}`, `Nonce: ${info.nonce}`, `Issued At: ${info.issuedAt}`];
  if (info.expirationTime) suffix.push(`Expiration Time: ${info.expirationTime}`);
  if (info.notBefore) suffix.push(`Not Before: ${info.notBefore}`);
  if (info.requestId) suffix.push(`Request ID: ${info.requestId}`);
  if (info.resources?.length) suffix.push(['Resources:', ...info.resources.map((r: string) => `- ${r}`)].join('\n'));
  return prefix + '\n\n' + suffix.join('\n');
}

async function signIn(caip2: string, label: string): Promise<string | undefined> {
  const challenge = await call(`connect-402-${label}`, 'POST', '/x402/connect');
  if (challenge.status !== 402) throw new Error(`connect: expected 402, got ${challenge.status}`);
  const { info, supportedChains } = challengeOf(challenge.body);
  const chain = supportedChains.find((c) => c.chainId === caip2) ?? { chainId: caip2, type: 'eip191' };
  const message = siweMessage(info, account.address, Number(caip2.split(':')[1]));
  const signature = await account.signMessage({ message });
  const payload = {
    domain: info.domain, address: account.address, statement: info.statement, uri: info.uri, version: info.version,
    chainId: chain.chainId, type: chain.type ?? 'eip191', nonce: info.nonce, issuedAt: info.issuedAt,
    expirationTime: info.expirationTime, resources: info.resources,
  };
  writeFileSync(OUT + `connect-message-${label}.txt`, message.replace(account.address, '<throwaway address>') + '\n');
  const res = await call(`connect-200-${label}`, 'POST', '/x402/connect', {
    headers: { 'sign-in-with-x': Buffer.from(JSON.stringify({ ...payload, signature })).toString('base64') },
  });
  const token = (res.body as any)?.token;
  return res.status === 200 && typeof token === 'string' ? token : undefined;
}

mkdirSync(OUT, { recursive: true });

const token = await signIn('eip155:8453', 'base');
if (!token) throw new Error('sign-in on Base failed; see connect-200-base.json');
// Does sign-in also accept Arbitrum? Free; the token is discarded.
await signIn('eip155:42161', 'arbitrum');

const auth = { headers: { 'X-Access-Token': token } };
await call('esims-search-no-token', 'GET', '/x402/esims/search?q=spain');
const esims = await call('esims-search-spain', 'GET', '/x402/esims/search?q=spain', auth);
await call('gift-cards-search-noon-AE', 'GET', '/x402/gift-cards/search?q=noon&country=AE', auth);
await call('gift-cards-search-noon', 'GET', '/x402/gift-cards/search?q=noon', auth);
await call('topups-search-spain', 'GET', '/x402/topups/search?q=spain', auth);

const esimSlug = (esims.body as any)?.products?.[0]?.slug;
if (typeof esimSlug !== 'string') throw new Error('no eSIM slug in esims search');
await call('products-detail-esim', 'GET', `/x402/products/detail?slug=${encodeURIComponent(esimSlug)}`, auth);
const gift = await call('products-detail-noon-uae', 'GET', '/x402/products/detail?slug=noon-uae', auth);

// invoice/create for the smallest noon package. A 402 here means the token
// does not waive the fee: record it and stop, never pay it.
const packages = (gift.body as any)?.packages as { package_value: string }[] | undefined;
if (!packages?.length) throw new Error('no packages on noon-uae');
const smallest = [...packages].sort((a, b) => Number(a.package_value) - Number(b.package_value))[0].package_value;
const created = await call('invoice-create-noon-uae', 'POST', '/x402/invoice/create', {
  ...auth, json: { items: [{ product_id: 'noon-uae', package_value: smallest }] },
});
const invoiceId = (created.body as any)?.invoice_id ?? (created.body as any)?.id;
if (created.status !== 200 || typeof invoiceId !== 'string') {
  console.log('invoice/create did not return an invoice; skipping invoice/pay');
} else {
  // No payment header, ever: this only records the 402 requirements.
  await call('invoice-pay-402-no-payment', 'POST', '/x402/invoice/pay', { json: { invoice_id: invoiceId } });
}
