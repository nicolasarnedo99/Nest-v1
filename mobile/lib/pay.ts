// The phone builds the order itself and checks it again before signing as a
// self-check: exactly the purchase asked for, on the right token, paying the
// right seller, from this wallet, expiring soon.
export type Chain = { chainId: number; token: string; seller: string; tokenName: string };
export type Typed = { primaryType: string; domain: { name: string; version: string; chainId: number; verifyingContract: string };
  message: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string } };

// The phone sets 600 s; the margin covers clock drift between the chain and the phone.
const MAX_VALIDITY_SECONDS = 900;

export function checkOrder(typed: Typed, expected: { buyer: string; value: bigint; chain: Chain; nowSeconds: number }): void {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const { domain, message } = typed;
  if (domain.chainId !== expected.chain.chainId) throw new Error('Order is for another chain');
  if (!same(domain.verifyingContract, expected.chain.token)) throw new Error('Order is for another token');
  if (!same(message.to, expected.chain.seller)) throw new Error('Order pays someone other than the seller');
  if (!same(message.from, expected.buyer)) throw new Error('Order is from another wallet');
  if (BigInt(message.value) !== expected.value) throw new Error('Order amount differs from the one asked for');
  if (message.validAfter !== '0') throw new Error('Order is not valid immediately');
  if (Number(message.validBefore) > expected.nowSeconds + MAX_VALIDITY_SECONDS) throw new Error('Order stays valid too long');
}
