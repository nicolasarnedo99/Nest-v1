// The index seller on a local chain with the real USD₮0 code and a WDK-signed authorisation: the same
// security model as StockSeller (buy.test.ts), plus owner-only batch listing for the S&P 500.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, encodeAbiParameters, http, keccak256, parseUnits, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { orderIdFor, receiveAuthorization, type Order } from '../../server/authorization.js';
import { startChain } from './chain.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { artifacts, deployIndexSeller, listCompanies, mint } from '../../contracts/scripts/deploy-lib.mjs';
import delegate from './fixtures/simple7702account.json';

const abi = artifacts.indexSeller.abi;
// 503 companies, as the S&P 500 has; names as long as a real "Stand-in … share (Turtle demo)".
const sp500 = Array.from({ length: 503 }, (_, i) => ({
  stockName: `Stand-in Company Number ${i} Incorporated share (Turtle demo)`, symbol: `sC${i}`, priceUsd: String(50 + i) }));

let local: Awaited<ReturnType<typeof startChain>>;
let seller: Address;
let batches: { gasUsed: bigint; ids: [number, number] }[];
beforeAll(async () => {
  local = await startChain(8550);
  const clients = { publicClient: local.publicClient, walletClient: local.deployer };
  seller = await deployIndexSeller(clients, local.deployment.token);
  batches = await listCompanies(clients, seller, sp500, 120);
}, 120_000);
afterAll(() => local?.stop());

// server/authorization.ts encodes the company as uint8; index seller ids go past 255, so the nonce is built here.
const indexNonce = (company: number, orderId: Hex) =>
  keccak256(encodeAbiParameters([{ type: 'uint16' }, { type: 'bytes32' }], [company, orderId]));

async function order(company: number, eventId: string, value: bigint, buyer = local.buyer): Promise<Order> {
  const now = (await local.publicClient.getBlock()).timestamp;
  return { company, orderId: orderIdFor(eventId), buyer, value, validAfter: 0n, validBefore: now + 600n };
}
function typed(item: Order) {
  const { deployment } = local;
  // company 0 only keeps the helper's uint8 encoder happy; the nonce is replaced right after.
  const data = receiveAuthorization({ name: deployment.tokenName, chainId: deployment.chainId, token: deployment.token }, seller, { ...item, company: 0 });
  return { ...data, message: { ...data.message, nonce: indexNonce(item.company, item.orderId) } };
}
const sign = (item: Order) => local.agent.signTypedData(typed(item)) as Promise<Hex>;
const buy = (item: Order, signature: Hex) => local.relayer.writeContract({ address: seller, abi, functionName: 'buy', args: [item, signature] });
const shares = (owner: Address, company: number) =>
  local.publicClient.readContract({ address: seller, abi, functionName: 'balanceOf', args: [owner, company] }) as Promise<bigint>;

describe('the index seller', () => {
  it('lists 503 companies in batches of 120 that each fit one transaction', async () => {
    const block = await local.publicClient.getBlock();
    expect(batches.map(b => b.ids)).toEqual([[0, 119], [120, 239], [240, 359], [360, 479], [480, 502]]);
    // Since Fusaka (EIP-7825) Sepolia refuses any transaction above 2^24 gas, whatever the block limit.
    for (const b of batches) expect(b.gasUsed).toBeLessThan(2n ** 24n);
    const total = batches.reduce((sum, b) => sum + b.gasUsed, 0n);
    console.log(`list(): ${batches.map(b => b.gasUsed).join(', ')} gas; ${total} total, ${total / 503n} per listing; block limit ${block.gasLimit}`);
    const [price, name, symbol] = await local.publicClient.readContract({ address: seller, abi, functionName: 'listings', args: [502] }) as [bigint, string, string];
    expect([price, name, symbol]).toEqual([parseUnits('552', 6), sp500[502]!.stockName, 'sC502']);
    // A repeated run (say, after a dropped batch on Sepolia) sends nothing for ids already listed.
    expect(await listCompanies({ publicClient: local.publicClient, walletClient: local.deployer }, seller, sp500, 120)).toEqual([]);
  });

  it('matches StockSeller.orderNonce below id 256, where the phone can keep its uint8 encoding', async () => {
    const orderId = orderIdFor('nonce');
    expect(await local.publicClient.readContract({ address: seller, abi, functionName: 'orderNonce', args: [300, orderId] })).toBe(indexNonce(300, orderId));
    expect(await local.publicClient.readContract({ address: seller, abi, functionName: 'orderNonce', args: [3, orderId] }))
      .toBe(await local.publicClient.readContract({ address: local.deployment.seller, abi: artifacts.seller.abi, functionName: 'orderNonce', args: [3, orderId] }));
  });

  it('lets a relayer buy a company past uint8 and mints its ERC-1155 balance', async () => {
    const item = await order(300, 'index-1', parseUnits('0.7', 6));
    const receipt = await local.publicClient.waitForTransactionReceipt({ hash: await buy(item, await sign(item)) });
    expect(receipt.status).toBe('success');
    // 0.7 paid at 350 per share (50 + 300) is 0.002 shares.
    expect(await shares(local.buyer, 300)).toBe(parseUnits('0.002', 18));
    expect(await shares(local.buyer, 301)).toBe(0n);
    const [bought] = await local.publicClient.getContractEvents({ address: seller, abi, eventName: 'Bought',
      fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber }) as unknown as { args: { company: number; paid: bigint } }[];
    expect(bought!.args).toMatchObject({ company: 300, paid: parseUnits('0.7', 6) });
  });

  it('rejects a relayer that swaps the company the buyer signed for', async () => {
    const item = await order(300, 'index-2', parseUnits('0.2', 6));
    await expect(buy({ ...item, company: 301 }, await sign(item))).rejects.toThrow('invalid signature');
    // 300 and 44 share the low byte: a uint8 truncation anywhere would make these collide.
    await expect(buy({ ...item, company: 44 }, await sign(item))).rejects.toThrow('invalid signature');
  });

  it('rejects the same order a second time', async () => {
    const item = await order(5, 'index-3', parseUnits('0.2', 6));
    const signature = await sign(item);
    await local.publicClient.waitForTransactionReceipt({ hash: await buy(item, signature) });
    await expect(buy(item, signature)).rejects.toThrow('auth invalid');
  });

  it('rejects an id that is not listed', async () => {
    const item = await order(503, 'index-4', parseUnits('0.2', 6));
    await expect(buy(item, await sign(item))).rejects.toThrow('unknown company');
  });

  it('only lets the owner list or reprice, and never relists an id', async () => {
    const list = (wallet: typeof local.deployer, ids: number[], prices = ids.map(() => 1n)) => wallet.writeContract({
      address: seller, abi, functionName: 'list', args: [ids, ids.map(() => 'n'), ids.map(() => 's'), prices] });
    await expect(list(local.relayer, [600])).rejects.toThrow('caller is not the owner');
    await expect(local.relayer.writeContract({ address: seller, abi, functionName: 'setPrice', args: [0, 1n] }))
      .rejects.toThrow('caller is not the owner');
    await expect(list(local.deployer, [7])).rejects.toThrow('already listed');
    await expect(list(local.deployer, [600, 600])).rejects.toThrow('already listed');
    await expect(list(local.deployer, [600], [0n])).rejects.toThrow('zero price');
    await expect(local.deployer.writeContract({ address: seller, abi, functionName: 'list', args: [[600], ['n'], [], [1n]] }))
      .rejects.toThrow('length mismatch');
    await expect(local.deployer.writeContract({ address: seller, abi, functionName: 'setPrice', args: [600, 1n] }))
      .rejects.toThrow('unknown company');
  }, 30_000); // each refused call takes about a second on the local node

  it('prices new buys at the updated price', async () => {
    await local.publicClient.waitForTransactionReceipt({ hash: await local.deployer.writeContract({
      address: seller, abi, functionName: 'setPrice', args: [9, parseUnits('100', 6)] }) });
    const item = await order(9, 'index-5', parseUnits('1', 6));
    await local.publicClient.waitForTransactionReceipt({ hash: await buy(item, await sign(item)) });
    expect(await shares(local.buyer, 9)).toBe(parseUnits('0.01', 18));
  });

  // The phone sends buy itself from an EOA delegated to Simple7702Account. That address has code, so
  // ERC-1155 minting calls onERC1155Received on it, which Simple7702Account implements.
  it('mints to a buyer delegated to Simple7702Account', async () => {
    const request = local.publicClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>;
    await request({ method: 'hardhat_setCode', params: [delegate.address, delegate.code] });
    const account = privateKeyToAccount(generatePrivateKey());
    await request({ method: 'hardhat_setBalance', params: [account.address, '0xde0b6b3a7640000'] });
    const { deployment, publicClient, deployer } = local;
    await mint({ publicClient, walletClient: deployer }, deployment.token, account.address, parseUnits('1', 6));
    const wallet = createWalletClient({ chain: local.chain, transport: http(local.rpc), account });
    const item = await order(400, 'index-7702', parseUnits('0.45', 6), account.address);
    const signature = await wallet.signTypedData(typed(item));
    const authorization = await wallet.signAuthorization({ contractAddress: delegate.address as Address, executor: 'self' });
    const hash = await wallet.writeContract({ address: seller, abi, functionName: 'buy', args: [item, signature], authorizationList: [authorization] });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
    // 0.45 paid at 450 per share is 0.001 shares.
    expect(await shares(account.address, 400)).toBe(parseUnits('0.001', 18));
  });
});
