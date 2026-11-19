// Paying for a resource over x402 from the phone: the official client runs in RN JS, the WDK wallet only signs. Checked before signing, counted against the daily cap once signed.
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { spend, spendShopping, type Store } from './budget';
import { parseOrder, type OrderAnswer } from './shop';

export type Requirement = { scheme: string; network: string; asset: string; amount: string; payTo: string };
export type Expected = { network: string; asset: string; maxAmount: bigint; payTo?: string };

// Refuses anything but the exact scheme, our network and token, at most `maxAmount`, to `payTo` when pinned.
export function checkRequirement(requirement: Requirement, expected: Expected): void {
  if (requirement.scheme !== 'exact') throw new Error('Refused to pay: scheme');
  if (requirement.network !== expected.network) throw new Error('Refused to pay: network');
  if (requirement.asset.toLowerCase() !== expected.asset.toLowerCase()) throw new Error('Refused to pay: asset');
  let amount: bigint;
  try { amount = BigInt(requirement.amount); } catch { throw new Error('Refused to pay: amount'); }
  if (amount <= 0n || amount > expected.maxAmount) throw new Error('Refused to pay: amount');
  if (expected.payTo !== undefined && requirement.payTo.toLowerCase() !== expected.payTo.toLowerCase())
    throw new Error('Refused to pay: payTo');
}

export type Signer = {
  address: `0x${string}`;
  signTypedData(data: { domain: unknown; types: unknown; primaryType?: string; message: Record<string, unknown> }): Promise<`0x${string}`>;
};

// The wallet bridge is JSON, so BigInts go across as strings and primaryType (which the wallet derives) is dropped.
export function walletSigner(
  address: string,
  sign: (data: { domain: unknown; types: unknown; message: Record<string, unknown> }) => Promise<string>,
): Signer {
  return {
    address: address as `0x${string}`,
    signTypedData: async ({ domain, types, message }) => {
      const plain = Object.fromEntries(Object.entries(message).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]));
      return (await sign({ domain, types, message: plain })) as `0x${string}`;
    },
  };
}

export type LookupResult = { operator: string | null; listedParent: string | null; note?: string };

export class LookupFailed extends Error {
  constructor(message: string, readonly feeMayBePaid: boolean) { super(message); this.name = 'LookupFailed'; }
}

// One paid GET over x402: the 402 is checked, counted with `count`, signed, retried; the answer is read with `parse`.
export async function paidRequest<T>(input: {
  url: URL; signer: Signer; expected: Expected; count: (amount: bigint) => { submit(): void; release(): void };
  capMessage: string; parse: (body: unknown) => T; failure: (message: string, mayBePaid: boolean) => Error;
  words: { unavailable: string; interrupted: string; unreadable: string };
  fetch?: typeof fetch; timeoutMs?: number;
}): Promise<{ result: T; amount: bigint; transaction: string | null }> {
  const { expected, failure, words } = input;
  const target = input.url;

  let spent: ReturnType<typeof input.count> | undefined;
  let amount = 0n;
  let signed = false;
  let refusal: Error | undefined; // our own reason, since the client wraps hook aborts in its own text

  const client = new x402Client();
  client.setSpendControls({ allowedAssets: [{ network: expected.network as `${string}:${string}`,asset: expected.asset, maxAmountPerPayment: expected.maxAmount.toString() }] });
  registerExactEvmScheme(client, { signer: input.signer });
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    try {
      checkRequirement(selectedRequirements as Requirement, expected);
    } catch (error) {
      refusal = failure((error as Error).message, false);
      return { abort: true as const, reason: refusal.message };
    }
    try {
      amount = BigInt(selectedRequirements.amount);
      spent = input.count(amount);
    } catch (error) {
      const capped = /would pass today's/.test((error as Error).message);
      refusal = failure(capped ? input.capMessage : (error as Error).message, false);
      return { abort: true as const, reason: refusal.message };
    }
  });
  client.onAfterPaymentCreation(async () => { signed = true; spent?.submit(); });

  try {
    const doFetch = input.fetch ?? fetch;
    const signal = AbortSignal.timeout(input.timeoutMs ?? 45_000);
    const http = new x402HTTPClient(client);
    // Not wrapFetchWithPayment: @x402/fetch pulls @x402/core/http, whose dynamic import() Hermes cannot compile.
    let response = await doFetch(target, { signal });
    if (response.status === 402) {
      let body: unknown;
      try { body = JSON.parse((await response.text()).slice(0, 65_536)); } catch { body = undefined; }
      const paymentRequired = http.getPaymentRequiredResponse(name => response.headers.get(name), body);
      const payload = await client.createPaymentPayload(paymentRequired);
      response = await doFetch(target, { headers: http.encodePaymentSignatureHeader(payload), signal });
    }
    if (response.status !== 200) throw new Error(`Answered ${response.status}`);
    let transaction: string | null = null;
    try { transaction = http.getPaymentSettleResponse(name => response.headers.get(name)).transaction || null; } catch { /* no settlement header */ }
    if (transaction !== null && !/^0x[0-9a-fA-F]{64}$/.test(transaction)) transaction = null; // only a real hash is ever linked
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    let result: T;
    try { result = input.parse(body); } catch { throw (refusal = failure(words.unreadable, true)); }
    return { result, amount, transaction };
  } catch (error) {
    spent?.release();
    if (refusal) throw refusal;
    // The client's own spend controls (or a requirement no registered scheme fits) refuse before our hook runs; nothing was signed.
    if (!signed && /^(All payment requirements were rejected|No network\/scheme registered)/.test((error as Error).message))
      throw failure(`Refused to pay: ${(error as Error).message}`, false);
    throw failure(signed ? words.interrupted : words.unavailable, signed);
  }
}

export async function paidLookup(input: {
  url: string; merchant: string; signer: Signer; expected: Expected; budget: Store;
  fetch?: typeof fetch; timeoutMs?: number; now?: () => Date;
}): Promise<{ result: LookupResult; fee: bigint; transaction: string | null }> {
  const { budget, now = () => new Date() } = input;
  const url = new URL(input.url);
  url.searchParams.set('merchant', input.merchant);
  const { result, amount, transaction } = await paidRequest({ ...input, url,
    count: fee => spend(budget, fee, now(), 'fee'), capMessage: 'Daily cap reached, not looked up',
    failure: (message, mayBePaid) => new LookupFailed(message, mayBePaid),
    words: { unavailable: 'Lookup unavailable', interrupted: 'Lookup interrupted, a fee may have been paid', unreadable: 'Lookup returned an unreadable answer' },
    parse: body => {
      const answer = body as Partial<LookupResult> | undefined;
      const text = (value: unknown) => value === null || typeof value === 'string';
      if (!answer || typeof answer !== 'object' || !text(answer.operator) || !text(answer.listedParent) || answer.operator === undefined || answer.listedParent === undefined)
        throw new Error('unreadable');
      const result: LookupResult = { operator: answer.operator!, listedParent: answer.listedParent! };
      if (typeof answer.note === 'string') result.note = answer.note;
      return result;
    } });
  return { result, fee: amount, transaction };
}

export class OrderFailed extends Error {
  constructor(message: string, readonly mayBePaid: boolean) { super(message); this.name = 'OrderFailed'; }
}

// Pays for a quoted demo order (`url` is the full order URL with ?quote=). `expected` pins the agent wallet and the quoted amount.
export async function paidOrder(input: {
  url: string; signer: Signer; expected: Expected & { payTo: string }; shopping: Store;
  fetch?: typeof fetch; timeoutMs?: number; now?: () => Date;
}): Promise<{ order: OrderAnswer; amount: bigint; transaction: string | null }> {
  const { shopping, now = () => new Date() } = input;
  const { result, amount, transaction } = await paidRequest({ ...input, url: new URL(input.url),
    count: price => spendShopping(shopping, price, now()), capMessage: 'Shopping limit reached, not ordered',
    failure: (message, mayBePaid) => new OrderFailed(message, mayBePaid), parse: parseOrder,
    words: { unavailable: 'Order unavailable', interrupted: 'Order interrupted, it may have been paid, check Etherscan', unreadable: 'Shop returned an unreadable order' } });
  return { order: result, amount, transaction };
}
