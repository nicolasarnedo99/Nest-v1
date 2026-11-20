// Demo stand-in for an onramp: asks the lookup service's faucet to mint 1,000 test USD₮0 to this wallet. One request, no retries.
export type TestFunds = { amount: string; transaction: `0x${string}` };

// The faucet (and the receipt reader) sit beside the lookup on the same host, so their URLs start at the lookup endpoint's origin.
export const lookupOrigin = (lookupEndpoint: string) => new URL(lookupEndpoint).origin;
export const faucetUrl = (lookupEndpoint: string) => `${lookupOrigin(lookupEndpoint)}/faucet`;

export async function requestTestFunds(url: string, address: string, doFetch: typeof fetch = fetch): Promise<TestFunds> {
  const response = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }), signal: AbortSignal.timeout(150_000) }); // the server waits for the mint's receipt
  const body = await response.json().catch(() => null) as { amount?: unknown; transaction?: unknown; error?: unknown } | null;
  if (response.status !== 200) throw new Error(typeof body?.error === 'string' ? body.error : `Test funds unavailable (${response.status})`);
  if (typeof body?.amount !== 'string' || !/^\d+$/.test(body.amount) || typeof body.transaction !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.transaction))
    throw new Error('Test funds returned an unreadable answer');
  return { amount: body.amount, transaction: body.transaction as `0x${string}` };
}
