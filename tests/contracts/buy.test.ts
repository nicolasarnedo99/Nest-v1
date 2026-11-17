// Runs the real USD₮0 token code and the seller on a local chain, with the
// buyer's signature produced by a Tether WDK account. This is the check that a
// WDK signature is accepted by USD₮0's receiveWithAuthorization as is, and that
// a relayer holding that signature cannot do anything the buyer did not sign.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseUnits, type Address, type Hex } from 'viem';
import { orderIdFor, orderNonce, receiveAuthorization, type Order } from '../../server/authorization.js';
import { startChain } from './chain.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { artifacts } from '../../contracts/scripts/deploy-lib.mjs';

let local: Awaited<ReturnType<typeof startChain>>;
beforeAll(async () => { local = await startChain(8547); }, 60_000);
afterAll(() => local?.stop());

const balanceOf = (token: Address, owner: Address) => local.publicClient.readContract({
  address: token, abi: artifacts.token.abi, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>;

async function order(company: number, eventId: string, value: bigint): Promise<Order> {
  const now = (await local.publicClient.getBlock()).timestamp;
  return { company, orderId: orderIdFor(eventId), buyer: local.buyer, value, validAfter: 0n, validBefore: now + 600n };
}
function sign(item: Order): Promise<Hex> {
  const { deployment } = local;
  const { domain, types, message } = receiveAuthorization(
    { name: deployment.tokenName, chainId: deployment.chainId, token: deployment.token }, deployment.seller, item);
  return local.agent.signTypedData({ domain, types, message }) as Promise<Hex>;
}
const buy = (item: Order, signature: Hex) => local.relayer.writeContract({
  address: local.deployment.seller, abi: artifacts.seller.abi, functionName: 'buy', args: [item, signature] });

describe('buying with a WDK-signed USD₮0 authorisation', () => {
  it('matches the contract when computing the order nonce', async () => {
    const orderId = orderIdFor('event-nonce');
    expect(await local.publicClient.readContract({ address: local.deployment.seller, abi: artifacts.seller.abi,
      functionName: 'orderNonce', args: [3, orderId] })).toBe(orderNonce(3, orderId));
  });

  it('lets a relayer complete the buy while the buyer holds no ETH', async () => {
    const item = await order(0, 'event-1', parseUnits('0.5', 6));
    const hash = await buy(item, await sign(item));
    expect((await local.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
    expect(await balanceOf(local.deployment.token, local.buyer)).toBe(parseUnits('9.5', 6));
    expect(await balanceOf(local.deployment.token, local.deployment.seller)).toBe(parseUnits('0.5', 6));
    // 0.5 paid at a placeholder price of 200 per share is 0.0025 shares.
    expect(await balanceOf(local.deployment.stocks[0]!.address, local.buyer)).toBe(parseUnits('0.0025', 18));
    expect(await local.publicClient.getBalance({ address: local.buyer })).toBe(0n);
  });

  it('rejects the same signature a second time', async () => {
    const item = await order(1, 'event-2', parseUnits('0.2', 6));
    const signature = await sign(item);
    await local.publicClient.waitForTransactionReceipt({ hash: await buy(item, signature) });
    await expect(buy(item, signature)).rejects.toThrow('auth invalid');
  });

  it('rejects a relayer that swaps the company the buyer signed for', async () => {
    const item = await order(0, 'event-3', parseUnits('0.2', 6));
    await expect(buy({ ...item, company: 4 }, await sign(item))).rejects.toThrow('invalid signature');
  });

  it('rejects a relayer that raises the amount', async () => {
    const item = await order(0, 'event-4', parseUnits('0.2', 6));
    await expect(buy({ ...item, value: parseUnits('5', 6) }, await sign(item))).rejects.toThrow('invalid signature');
  });

  it('rejects taking the payment without going through the seller', async () => {
    const item = await order(0, 'event-5', parseUnits('0.2', 6));
    const signature = await sign(item);
    // The relayer tries to redeem the authorisation for itself, directly on the token.
    await expect(local.relayer.writeContract({ address: local.deployment.token, abi: artifacts.token.abi,
      functionName: 'receiveWithAuthorization',
      args: [local.buyer, local.relayer.account.address, item.value, item.validAfter, item.validBefore,
        orderNonce(item.company, item.orderId), signature] })).rejects.toThrow('invalid signature');
  });

  it('rejects an expired authorisation', async () => {
    const item = { ...await order(0, 'event-6', parseUnits('0.2', 6)), validBefore: 1n };
    await expect(buy(item, await sign(item))).rejects.toThrow('expired');
  });
});
