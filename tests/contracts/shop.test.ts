// Settles a quoted demo shop order over x402 on the real USD₮0 token code, signed by a WDK account.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseUnits, type Address } from 'viem';
import { localFacilitator } from '../../server/lookup.js';
import { createShopApp, RecordedPriceSource } from '../../server/shop.js';
import { paidOrder, walletSigner } from '../../mobile/lib/x402.js';
import { orderUrl, quoteShop } from '../../mobile/lib/shop.js';
import { startChain, RELAYER_KEY } from './chain.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { artifacts, mint } from '../../contracts/scripts/deploy-lib.mjs';

let local: Awaited<ReturnType<typeof startChain>>;
let server: Server;
let base: string;
beforeAll(async () => {
  local = await startChain(8550);
  const { token, tokenName, chainId } = local.deployment;
  await mint({ publicClient: local.publicClient, walletClient: local.deployer }, token, local.buyer, parseUnits('300', 6));
  const app = createShopApp({ facilitator: localFacilitator({ chain: local.chain, rpc: local.rpc, relayerKey: RELAYER_KEY }),
    payTo: local.relayer.account.address, chainId, token, tokenName, prices: new RecordedPriceSource(), secret: new Uint8Array(32).fill(3) });
  server = await new Promise<Server>(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(() => { server?.close(); local?.stop(); });

const balanceOf = (owner: Address) => local.publicClient.readContract({
  address: local.deployment.token, abi: artifacts.token.abi, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>;

const memoryStore = () => { let text: string | null = null; return { read: () => text, write: (next: string) => { text = next; } }; };

describe('a quoted demo shop order on the real USD₮0 code', () => {
  it('settles a WDK-signed order above 100 USD₮0 for exactly the quoted amount', async () => {
    const { token, quote } = await quoteShop(`${base}/shop`, 'airpods-pro-2');
    expect(BigInt(quote.amount)).toBeGreaterThan(100_000000n);
    const [buyerBefore, relayerBefore] = [await balanceOf(local.buyer), await balanceOf(local.relayer.account.address)];
    const { order, amount, transaction } = await paidOrder({ url: orderUrl(`${base}/shop`, token), shopping: memoryStore(),
      expected: { network: `eip155:${local.deployment.chainId}`, asset: local.deployment.token, maxAmount: BigInt(quote.amount), payTo: local.relayer.account.address },
      signer: walletSigner(local.buyer, d => local.agent.signTypedData(d as never)) });
    expect(order).toMatchObject({ productId: 'airpods-pro-2', amount: quote.amount, note: 'Demo order, not shipped' });
    expect(amount).toBe(BigInt(quote.amount));
    expect((await local.publicClient.getTransactionReceipt({ hash: transaction as `0x${string}` })).status).toBe('success');
    expect(await balanceOf(local.buyer)).toBe(buyerBefore - BigInt(quote.amount));
    expect(await balanceOf(local.relayer.account.address)).toBe(relayerBefore + BigInt(quote.amount));
  });
});
