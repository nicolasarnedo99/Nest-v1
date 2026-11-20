// The Mac's payment adapter, the phone's order and the wallet reader against the index seller on a local chain, with the stock seller
// still deployed: a buy past id 255 on the index seller, and holdings read from both sellers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { erc1155Abi, parseUnits, type Address, type Hex } from 'viem';
import { Execution, ExecutionStore } from '../../server/execution.js';
import { walletReader } from '../../server/wallet.js';
import { WdkPayment, type Deployment } from '../../server/wdk-payment.js';
import { buildOrder, buyCall } from '../../mobile/lib/order.js';
import { RELAYER_KEY, startChain } from './chain.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { deployIndexSeller, listCompanies } from '../../contracts/scripts/deploy-lib.mjs';

// Ids past 255 are the point; every company at 100 per share.
const LISTED = Array.from({ length: 302 }, (_, i) => ({ stockName: `Stand-in ${i}`, symbol: `sC${i}`, priceUsd: '100' }));

let local: Awaited<ReturnType<typeof startChain>>;
let indexDeployment: Deployment;
const stores: ExecutionStore[] = [];
const engine = (deployment: Deployment) => {
  const store = new ExecutionStore(':memory:'); stores.push(store);
  return new Execution(store, new WdkPayment(local.agent, deployment, { rpc: local.rpc, chain: local.chain, relayerKey: RELAYER_KEY }));
};
beforeAll(async () => {
  local = await startChain(8551);
  const clients = { publicClient: local.publicClient, walletClient: local.deployer };
  const seller: Address = await deployIndexSeller(clients, local.deployment.token);
  await listCompanies(clients, seller, LISTED, 160);
  indexDeployment = { ...local.deployment, seller, sellerKind: 'index', companies: LISTED.map((_, i) => `Company ${i}`) };
}, 120_000);
afterAll(() => { for (const store of stores) store.close(); local?.stop(); });
const shares = (owner: Address, id: number) => local.publicClient.readContract({ address: indexDeployment.seller, abi: erc1155Abi, functionName: 'balanceOf', args: [owner, BigInt(id)] });

describe('the index seller from the Mac and the phone', () => {
  it('the Mac buys company 300 on the index seller, confirmed by its uint16 Bought event', async () => {
    const result = await engine(indexDeployment).execute({ id: 'index-mac', company: 300, amount: parseUnits('0.35', 6) });
    expect(result.status).toBe('confirmed');
    expect(result.shares).toBe(parseUnits('0.0035', 18));
    expect(await shares(local.buyer, 300)).toBe(parseUnits('0.0035', 18));
    expect(await shares(local.buyer, 44)).toBe(0n); // 300's low byte
  });

  it('the phone\'s order and call for company 301 are accepted by the index seller', async () => {
    const chain = { chainId: indexDeployment.chainId, token: indexDeployment.token, seller: indexDeployment.seller, tokenName: indexDeployment.tokenName, sellerKind: 'index' };
    const nowSeconds = Number((await local.publicClient.getBlock()).timestamp);
    const { order, typed } = buildOrder({ chain, buyer: local.buyer, company: 301, eventId: 'index-phone', value: parseUnits('0.2', 6), nowSeconds });
    const signature = await local.agent.signTypedData({ domain: typed.domain, types: typed.types, message: typed.message }) as Hex;
    const { to, data } = buyCall(chain, order, signature);
    const hash = await local.relayer.sendTransaction({ to: to as Address, data });
    expect((await local.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
    expect(await shares(local.buyer, 301)).toBe(parseUnits('0.002', 18));
  });

  it('reads holdings bought on the stock seller (ERC-20) and on the index seller (ERC-1155) together', async () => {
    expect((await engine(local.deployment).execute({ id: 'stock-mac', company: 3, amount: parseUnits('0.35', 6) })).status).toBe('confirmed');
    const snapshot = await walletReader(local.agent, indexDeployment, local.publicClient)();
    const held = snapshot.holdings.filter(h => !/^0(\.0+)?$/.test(h.balance));
    expect(held).toEqual([
      { symbol: 'sTSLA', address: local.deployment.stocks[3]!.address, balance: '0.001' },
      { symbol: 'Company 300', address: indexDeployment.seller, balance: '0.0035' },
      { symbol: 'Company 301', address: indexDeployment.seller, balance: '0.002' },
    ]);
    // The index seller's unheld companies are left out; the stock seller's nine are always listed, as before.
    expect(snapshot.holdings).toHaveLength(local.deployment.stocks.length + 2);
  });
});
