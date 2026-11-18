// Runs the real USD₮0 token code and the seller on a local chain, with the
// buyer's signature produced by a Tether WDK account. This is the check that a
// WDK signature is accepted by USD₮0's receiveWithAuthorization as is, and that
// a relayer holding that signature cannot do anything the buyer did not sign.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, http, parseUnits, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { orderIdFor, orderNonce, receiveAuthorization, type Order } from '../../server/authorization.js';
import { startChain } from './chain.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { artifacts, mint } from '../../contracts/scripts/deploy-lib.mjs';
// Simple7702Account, the delegate WDK's gasless wallet points the phone at, as deployed on Sepolia.
import delegate from './fixtures/simple7702account.json';

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

  // The phone now sends buy itself, from an EOA delegated to Simple7702Account. Its address then
  // has code, so the token checks the order signature through ERC-1271 instead of ecrecover.
  it('the buyer submits its own buy after delegating', async () => {
    const request = local.publicClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>;
    await request({ method: 'hardhat_setCode', params: [delegate.address, delegate.code] });
    const account = privateKeyToAccount(generatePrivateKey());
    await request({ method: 'hardhat_setBalance', params: [account.address, '0xde0b6b3a7640000'] });
    const { deployment, publicClient, deployer } = local;
    await mint({ publicClient, walletClient: deployer }, deployment.token, account.address, parseUnits('1', 6));
    const wallet = createWalletClient({ chain: local.chain, transport: http(local.rpc), account });

    const now = (await publicClient.getBlock()).timestamp;
    const item: Order = { company: 0, orderId: orderIdFor('event-7702'), buyer: account.address,
      value: parseUnits('0.5', 6), validAfter: 0n, validBefore: now + 600n };
    const { domain, types, message } = receiveAuthorization(
      { name: deployment.tokenName, chainId: deployment.chainId, token: deployment.token }, deployment.seller, item);
    const signature = await wallet.signTypedData({ domain, types, primaryType: 'ReceiveWithAuthorization', message });
    const authorization = await wallet.signAuthorization({ contractAddress: delegate.address as Address, executor: 'self' });
    const send = (authorizationList?: typeof authorization[]) => wallet.writeContract({ address: deployment.seller,
      abi: artifacts.seller.abi, functionName: 'buy', args: [item, signature], authorizationList });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: await send([authorization]) });
    expect(receipt.status).toBe('success');
    expect(receipt.from.toLowerCase()).toBe(account.address.toLowerCase());
    expect((await publicClient.getCode({ address: account.address }))?.toLowerCase())
      .toBe(`0xef0100${delegate.address.slice(2)}`.toLowerCase());
    const bought = await publicClient.getContractEvents({ address: deployment.seller, abi: artifacts.seller.abi,
      eventName: 'Bought', fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber }) as unknown as { args: { buyer: Address; paid: bigint } }[];
    expect(bought).toHaveLength(1);
    expect(bought[0]!.args.buyer.toLowerCase()).toBe(account.address.toLowerCase());
    expect(bought[0]!.args.paid).toBe(parseUnits('0.5', 6));
    expect(await balanceOf(deployment.token, account.address)).toBe(parseUnits('0.5', 6));
    // 0.5 paid at a placeholder price of 200 per share is 0.0025 shares.
    expect(await balanceOf(deployment.stocks[0]!.address, account.address)).toBe(parseUnits('0.0025', 18));
    await expect(send()).rejects.toThrow('auth invalid');
  });
});
