// The paid merchant lookup: who operates a merchant, and which of the five listed
// companies owns it, if any. The answer comes from a small curated table (demo data).
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { createWalletClient, http, publicActions, type Address, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer } from '@x402/core/server';
import type { FacilitatorClient } from '@x402/core/server';
import type { SupportedResponse } from '@x402/core/types';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme as FacilitatorScheme } from '@x402/evm/exact/facilitator';
import { ExactEvmScheme as ServerScheme } from '@x402/evm/exact/server';
import { paymentMiddleware } from '@x402/express';
import merchants from './merchants.json' with { type: 'json' };

export const LOOKUP_PRICE = '10000'; // 0.01 of a 6-decimal token

export type Merchant = { match: string[]; operator: string; listedParent: string | null; note: string };
export type Found = { operator: string | null; listedParent: string | null; note?: string };

export const normalise = (text: string) =>
  text.replace(/['’]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Every word of a match string must appear as a whole word; the match with the most words wins.
export function findMerchant(text: string, table: Merchant[] = merchants): Found {
  const words = new Set(normalise(text));
  let best: { entry: Merchant; size: number } | null = null;
  for (const entry of table) for (const phrase of entry.match) {
    const needed = normalise(phrase);
    if (needed.every(word => words.has(word)) && (!best || needed.length > best.size)) best = { entry, size: needed.length };
  }
  if (!best) return { operator: null, listedParent: null };
  const { operator, listedParent, note } = best.entry;
  return { operator, listedParent, note };
}

export type LookupOptions = {
  facilitator: FacilitatorClient; payTo: Address; chainId: number; token: Address; tokenName: string;
  now?: () => number; limitPerMinute?: number;
  // Called once per lookup that was paid, settled and served.
  onSettled?: (merchant: string, transaction: string) => void;
};

export function createLookupApp(options: LookupOptions) {
  const app = express();
  const now = options.now ?? Date.now;
  const limit = options.limitPerMinute ?? 60;
  const network = `eip155:${options.chainId}` as const;
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  let windowStart = 0, count = 0;
  const rateLimit: RequestHandler = (_request, response, next) => {
    const time = now();
    if (time - windowStart >= 60_000) { windowStart = time; count = 0; }
    if (++count > limit) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'Lookup limit reached; wait one minute' }); return;
    }
    next();
  };
  const validMerchant: RequestHandler = (request, response, next) => {
    const raw = request.query.merchant;
    const merchant = typeof raw === 'string' ? raw.trim() : '';
    if (merchant.length < 1 || merchant.length > 160 || /[\x00-\x1f\x7f]/.test(merchant)) {
      response.status(400).json({ error: 'merchant must be 1 to 160 characters of text' }); return;
    }
    response.locals.merchant = merchant;
    next();
  };
  // verify → handler (buffered by @x402/express) → settle → response; a failed settle discards the body, so nothing is served unpaid.
  const paywall = paymentMiddleware({ 'GET /lookup': { accepts: [{ scheme: 'exact', network, payTo: options.payTo,
    price: { amount: LOOKUP_PRICE, asset: options.token, extra: { name: options.tokenName, version: '1', decimals: 6 } },
    maxTimeoutSeconds: 120 }],
    description: 'Who operates a merchant, and which of Apple, Alphabet, Microsoft, Tesla and NVIDIA owns it, if any. Demo data from a small table; an unknown merchant is still charged.',
    mimeType: 'application/json' } },
    new x402ResourceServer(options.facilitator).register(network, new ServerScheme()));
  app.get('/lookup', rateLimit, validMerchant, paywall, (_request, response) => {
    const merchant = response.locals.merchant as string;
    response.on('finish', () => {
      const header = response.getHeader('payment-response');
      if (response.statusCode === 200 && typeof header === 'string')
        options.onSettled?.(merchant, JSON.parse(Buffer.from(header, 'base64').toString()).transaction);
    });
    response.json({ merchant, ...findMerchant(merchant), source: 'demo table' });
  });
  app.use((_request, response) => { response.status(404).json({ error: 'Not found' }); });
  const failed: ErrorRequestHandler = (_error, _request, response, _next) => { response.status(500).json({ error: 'Request failed' }); };
  app.use(failed);
  return app;
}

// Verifies and settles in this process with the relayer key, so no hosted facilitator is needed.
export function localFacilitator(options: { chain: Chain; rpc: string; relayerKey: Hex }): FacilitatorClient {
  const account = privateKeyToAccount(options.relayerKey);
  const client = createWalletClient({ account, chain: options.chain, transport: http(options.rpc, { timeout: 20_000 }) }).extend(publicActions);
  const signer = toFacilitatorEvmSigner({ ...client, address: account.address,
    readContract: (a: any) => client.readContract(a as never), writeContract: (a: any) => client.writeContract(a as never), getCode: (a: any) => client.getCode(a),
    verifyTypedData: (a: any) => client.verifyTypedData(a as never), sendTransaction: (a: any) => client.sendTransaction(a as never),
    waitForTransactionReceipt: (a: any) => client.waitForTransactionReceipt(a) } as never);
  const facilitator = new x402Facilitator().register(`eip155:${options.chain.id}`, new FacilitatorScheme(signer));
  return { getSupported: async () => facilitator.getSupported() as SupportedResponse, verify: (p, r) => facilitator.verify(p, r), settle: (p, r) => facilitator.settle(p, r) };
}
