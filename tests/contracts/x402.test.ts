// Settles a phone-style x402 lookup payment on the real USD₮0 token code, with the buyer's signature
// from a WDK account and from a 7702-delegated EOA (whose signature the token checks through ERC-1271).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createWalletClient, http, parseUnits, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createLookupApp, localFacilitator } from '../../server/lookup.js';
import { paidLookup, walletSigner, type Expected } from '../../mobile/lib/x402.js';
import { startChain, RELAYER_KEY } from './chain.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { artifacts, mint } from '../../contracts/scripts/deploy-lib.mjs';
import delegate from './fixtures/simple7702account.json';

let local: Awaited<ReturnType<typeof startChain>>;
let server: Server;
let url: string;
let expected: Expected;
beforeAll(async () => {
  local = await startChain(8549);
  const { token, tokenName, chainId } = local.deployment;
  const app = createLookupApp({ facilitator: localFacilitator({ chain: local.chain, rpc: local.rpc, relayerKey: RELAYER_KEY }),
    payTo: local.relayer.account.address, chainId, token, tokenName });
  server = await new Promise<Server>(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/lookup`;
  expected = { network: `eip155:${chainId}`, asset: token, maxAmount: 10000n };
}, 60_000);
afterAll(() => { server?.close(); local?.stop(); });

const balanceOf = (owner: Address) => local.publicClient.readContract({
  address: local.deployment.token, abi: artifacts.token.abi, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>;
const memoryStore = () => { let text: string | null = null; return { read: () => text, write: (next: string) => { text = next; } }; };

describe('paying for a lookup over x402 on the real USD₮0 code', () => {
  it('settles a WDK-signed lookup payment and serves the answer', async () => {
    const [buyerBefore, relayerBefore] = [await balanceOf(local.buyer), await balanceOf(local.relayer.account.address)];
    const { result, transaction } = await paidLookup({ url, merchant: 'GITHUB', budget: memoryStore(), expected,
      signer: walletSigner(local.buyer, d => local.agent.signTypedData(d as never)) });
    expect(result.listedParent).toBe('Microsoft');
    expect(await balanceOf(local.buyer)).toBe(buyerBefore - 10000n);
    expect(await balanceOf(local.relayer.account.address)).toBe(relayerBefore + 10000n);
    expect(transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await local.publicClient.getTransactionReceipt({ hash: transaction as `0x${string}` })).status).toBe('success');
    expect(await local.publicClient.getBalance({ address: local.buyer })).toBe(0n);
  });

  it('rejects the same authorisation twice', async () => {
    let header: string | undefined;
    const recording: typeof fetch = (input, init) => {
      const sent = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
      if (sent) header = sent;
      return fetch(input, init);
    };
    await paidLookup({ url, merchant: 'GITHUB', budget: memoryStore(), expected, fetch: recording,
      signer: walletSigner(local.buyer, d => local.agent.signTypedData(d as never)) });
    expect(header).toBeDefined();
    const before = await balanceOf(local.buyer);
    const replay = await fetch(`${url}?merchant=GITHUB`, { headers: { 'PAYMENT-SIGNATURE': header! } });
    // Observed: 402 invalid_exact_evm_transaction_simulation_failed, from verify's simulation of the already-used nonce.
    const text = await replay.text();
    expect(replay.status).toBe(402);
    expect(text).toContain('invalid_exact_evm_transaction_simulation_failed');
    expect(text).not.toContain('listedParent');
    expect(await balanceOf(local.buyer)).toBe(before);
  });

  it('settles from a 7702-delegated payer', async () => {
    const request = local.publicClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>;
    await request({ method: 'hardhat_setCode', params: [delegate.address, delegate.code] });
    const account = privateKeyToAccount(generatePrivateKey());
    await request({ method: 'hardhat_setBalance', params: [account.address, '0xde0b6b3a7640000'] });
    await mint({ publicClient: local.publicClient, walletClient: local.deployer }, local.deployment.token, account.address, parseUnits('1', 6));
    const wallet = createWalletClient({ chain: local.chain, transport: http(local.rpc), account });
    const hash = await wallet.sendTransaction({ to: account.address, data: '0x',
      authorizationList: [await wallet.signAuthorization({ contractAddress: delegate.address as Address, executor: 'self' })] });
    await local.publicClient.waitForTransactionReceipt({ hash });
    expect((await local.publicClient.getCode({ address: account.address }))?.toLowerCase())
      .toBe(`0xef0100${delegate.address.slice(2)}`.toLowerCase());

    const relayerBefore = await balanceOf(local.relayer.account.address);
    const { result, transaction } = await paidLookup({ url, merchant: 'GITHUB', budget: memoryStore(), expected,
      signer: walletSigner(account.address, d => account.signTypedData({ ...d, primaryType: 'TransferWithAuthorization' } as never)) });
    expect(result.listedParent).toBe('Microsoft');
    expect(await balanceOf(account.address)).toBe(parseUnits('1', 6) - 10000n);
    expect(await balanceOf(local.relayer.account.address)).toBe(relayerBefore + 10000n);
    expect((await local.publicClient.getTransactionReceipt({ hash: transaction as `0x${string}` })).status).toBe('success');
  });
});
