// Runs one demo shop order end to end on Sepolia: a throwaway wallet (key in memory only, never
// printed or saved) is minted the price of the cheapest product matching the query plus 1 tUSDT0,
// then searches, quotes and pays the shop over x402 through the phone's own paidOrder, within the
// same shopping limit. The relayer pays the gas.
//
//   npx tsx scripts/shop-smoke.ts <shop-url> [query=cable]
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
// @ts-expect-error plain JavaScript module shared with the tests
import { mint, TOKEN } from '../contracts/scripts/deploy-lib.mjs';
import { OrderFailed, paidOrder, walletSigner } from '../mobile/lib/x402';
import { orderUrl, quoteShop, searchShop } from '../mobile/lib/shop';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const [base, query = 'cable'] = process.argv.slice(2);
if (!base) { console.error('Usage: npx tsx scripts/shop-smoke.ts <shop-url> [query=cable]'); process.exit(2); }
// Before any RPC call or mint, so a typo costs no gas.
try { if (!['https:', 'http:'].includes(new URL(base).protocol)) throw new Error('protocol'); }
catch { console.error(`Not an http(s) URL: ${base}`); process.exit(2); }

const products = await searchShop(base, query, null);
if (products.length === 0) { console.error(`No product matches "${query}"`); process.exit(2); }
const product = products[0]; // cheapest first
console.log(`Product ${product.id}: ${product.title}, ${product.priceAed} AED (≈ ${product.approxUsdt})`);

const transport = http(need('TURTLE_RPC'));
const publicClient = createPublicClient({ chain: sepolia, transport });
const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id) throw new Error(`TURTLE_RPC is chain ${chainId}: this script runs on Sepolia only`);
const { token } = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/sepolia.json', root)), 'utf8')) as { token: Hex };
const shop = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/shop.json', root)), 'utf8')) as { payTo: Hex };

const account = privateKeyToAccount(generatePrivateKey());
const balance = async () => await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
console.log(`Throwaway buyer ${account.address}`);

const relayerClient = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const funding = parseUnits(product.approxUsdt, TOKEN.decimals) + parseUnits('1', TOKEN.decimals);
const minted = await mint({ publicClient, walletClient: relayerClient }, token, account.address, funding) as Hex;
console.log(`Minted ${formatUnits(funding, TOKEN.decimals)} tUSDT0: ${minted}`);
// publicnode load-balances backends; give every backend the mint before the server verifies the balance.
await publicClient.waitForTransactionReceipt({ hash: minted, confirmations: 3 });
const before = await balance();

// Quote after the mint wait, so the 10-minute quote can't expire while the mint confirms.
const { token: quoteToken, quote } = await quoteShop(base, product.id);
console.log(`Quote ${quote.quoteId}: ${quote.amount} (${quote.source}), expires ${new Date(quote.expiresAt).toISOString()}`);

let text: string | null = null;
const shopping = { read: () => text, write: (next: string) => { text = next; } };
try {
  const started = Date.now();
  const { order, amount, transaction } = await paidOrder({ url: orderUrl(base, quoteToken), shopping, timeoutMs: 90_000,
    expected: { network: `eip155:${sepolia.id}`, asset: token, maxAmount: BigInt(quote.amount), payTo: shop.payTo },
    signer: walletSigner(account.address, d => account.signTypedData({ ...d, primaryType: 'TransferWithAuthorization' } as never)) });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  // Same lag as after the mint: give every backend the settlement before reading the balance.
  const settled = transaction ? await publicClient.waitForTransactionReceipt({ hash: transaction as Hex, confirmations: 3 }) : null;
  const after = await balance();
  console.log(`Order ${order.orderId}: ${order.title}, ${order.priceAed} AED, paid ${formatUnits(amount, TOKEN.decimals)} tUSDT0 in ${seconds} s [${order.note}]`);
  console.log(`Settlement ${transaction ? `https://sepolia.etherscan.io/tx/${transaction}` : 'not reported'}`);
  console.log(`Buyer balance ${formatUnits(before, TOKEN.decimals)} → ${formatUnits(after, TOKEN.decimals)} (${formatUnits(after - before, TOKEN.decimals)})`);
  const want = BigInt(quote.amount);
  if (before - after !== want || amount !== want || order.amount !== quote.amount || !transaction || settled?.status !== 'success') {
    console.error(`Smoke test FAILED: expected a debit of exactly ${want} and a settlement (debit ${before - after}, paid ${amount}, order ${order.amount}, transaction ${transaction}, status ${settled?.status})`);
    process.exit(1);
  }
  console.log('Smoke order passed.');
} catch (error) {
  if (!(error instanceof OrderFailed)) throw error;
  console.error(`Order failed: ${error.message} (may be paid: ${error.mayBePaid})\nBuyer balance ${formatUnits(before, TOKEN.decimals)} → ${formatUnits(await balance(), TOKEN.decimals)}`);
  process.exit(1);
}
