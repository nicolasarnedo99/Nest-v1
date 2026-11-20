// The paid merchant lookup, the demo shop, the Bitrefill mirror and the test-funds faucet: no model, no agent seed, no other routes.
// The mirror signs in to Bitrefill with its own throwaway key, made in memory at each start (never the relayer key).
// Env: TURTLE_RELAYER_KEY (testnet only; it pays settlement gas and receives the fees),
// SHOP_QUOTE_SECRET (hex, 32+ bytes; a random one per start if unset, which voids open quotes on restart),
// CROSSMINT_SERVER_KEY (optional; when set, quotes read live Amazon.ae totals through Crossmint and fall back to recorded prices on any failure),
// OCR_UPSTREAM and OCR_TOKEN (receipt OCR: the Mac's reader over Tailscale, and its token; POST /ocr answers 503 without them),
// TURTLE_RPC (Sepolia, defaults to publicnode), LOOKUP_PORT (default 4180). Listens on 127.0.0.1 only;
// Tailscale Funnel publishes it.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createPublicClient, createWalletClient, http, parseAbi, publicActions, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createBitrefill } from './bitrefill.js';
import { createFaucetApp, serial } from './faucet.js'; // test funds
import { createLookupApp, localFacilitator } from './lookup.js';
import { createMirrorApp } from './mirror.js';
import { createOcrProxyApp } from './ocr-proxy.js'; // receipt OCR
import { createShopApp, RecordedPriceSource } from './shop.js';
import { CrossmintPriceSource } from './shop-crossmint.js';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win

const relayerKey = process.env.TURTLE_RELAYER_KEY as Hex | undefined;
if (!relayerKey) throw new Error('Missing TURTLE_RELAYER_KEY');
const secretHex = process.env.SHOP_QUOTE_SECRET;
if (secretHex !== undefined && !/^(?:[0-9a-fA-F]{2}){32,}$/.test(secretHex)) throw new Error('SHOP_QUOTE_SECRET must be hex of at least 32 bytes');
const secret = secretHex === undefined ? randomBytes(32) : Buffer.from(secretHex, 'hex');
const rpc = process.env.TURTLE_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const port = Number(process.env.LOOKUP_PORT ?? 4180);
const chainId = await createPublicClient({ transport: http(rpc) }).getChainId();
if (chainId !== sepolia.id) throw new Error(`TURTLE_RPC is chain ${chainId}: the lookup runs on Sepolia only`);
const { token } = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/sepolia.json', root)), 'utf8')) as { token: Address };
const payTo = privateKeyToAccount(relayerKey).address;

// test funds: settlements and faucet mints share the relayer key, so they go out one at a time (each waits for its receipt).
const exclusive = serial(); // test funds
const settler = localFacilitator({ chain: sepolia, rpc, relayerKey }); // test funds
const facilitator = { ...settler, settle: (...args: Parameters<typeof settler.settle>) => exclusive(() => settler.settle(...args)) }; // test funds
const common = { facilitator, payTo, chainId, token, tokenName: 'Test USDT0 copy (Turtle demo)' };
const app = express();
app.disable('x-powered-by');
const crossmintKey = process.env.CROSSMINT_SERVER_KEY;
app.use(createMirrorApp({ ...common, bitrefill: createBitrefill(), secret,
  // Bitrefill allows 30 requests a minute; one quote costs it one detail call (more only on a sign-in), so 20 quotes a minute stays under.
  limitPerMinute: 20,
  onOrdered: order => console.log(`Mirror order ${order.orderId} for ${order.slug} (${order.packageValue}) settled in ${order.transaction}`) }));
app.use(createShopApp({ ...common, prices: crossmintKey ? new CrossmintPriceSource({ key: crossmintKey }) : new RecordedPriceSource(), secret,
  onOrdered: order => console.log(`Shop order ${order.orderId} for ${order.productId} settled in ${order.transaction}`) }));
app.use(createFaucetApp({ exclusive, mint: async (to, amount) => { // test funds
  const relayer = createWalletClient({ account: privateKeyToAccount(relayerKey), chain: sepolia, transport: http(rpc, { timeout: 20_000 }) }).extend(publicActions);
  const hash = await relayer.writeContract({ address: token, abi: parseAbi(['function mint(address to, uint256 amount)']), functionName: 'mint', args: [to, amount] });
  const receipt = await relayer.waitForTransactionReceipt({ hash, timeout: 30_000 });
  if (receipt.status !== 'success') throw new Error(`Mint reverted: ${hash}`);
  console.log(`Faucet minted ${amount} to ${to} in ${hash}`);
  return hash;
} }));
app.use(createOcrProxyApp({ upstream: process.env.OCR_UPSTREAM, token: process.env.OCR_TOKEN })); // receipt OCR
app.use(createLookupApp({ ...common,
  onSettled: (merchant, transaction) => console.log(`Lookup ${JSON.stringify(merchant)} settled in ${transaction}`) }));
app.listen(port, '127.0.0.1', () => console.log(`Merchant lookup, shop and Bitrefill mirror on http://127.0.0.1:${port} · payTo ${payTo}`));
