// The paid merchant lookup and the demo shop: no model, no agent seed, no other routes.
// Env: TURTLE_RELAYER_KEY (testnet only; it pays settlement gas and receives the fees),
// SHOP_QUOTE_SECRET (hex, 32+ bytes; a random one per start if unset, which voids open quotes on restart),
// CROSSMINT_SERVER_KEY (optional; when set, quotes read live Amazon.ae totals through Crossmint and fall back to recorded prices on any failure),
// TURTLE_RPC (Sepolia, defaults to publicnode), LOOKUP_PORT (default 4180). Listens on 127.0.0.1 only;
// Tailscale Funnel publishes it.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createLookupApp, localFacilitator } from './lookup.js';
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

const facilitator = localFacilitator({ chain: sepolia, rpc, relayerKey });
const common = { facilitator, payTo, chainId, token, tokenName: 'Test USDT0 copy (Turtle demo)' };
const app = express();
app.disable('x-powered-by');
const crossmintKey = process.env.CROSSMINT_SERVER_KEY;
app.use(createShopApp({ ...common, prices: crossmintKey ? new CrossmintPriceSource({ key: crossmintKey }) : new RecordedPriceSource(), secret,
  onOrdered: order => console.log(`Shop order ${order.orderId} for ${order.productId} settled in ${order.transaction}`) }));
app.use(createLookupApp({ ...common,
  onSettled: (merchant, transaction) => console.log(`Lookup ${JSON.stringify(merchant)} settled in ${transaction}`) }));
app.listen(port, '127.0.0.1', () => console.log(`Merchant lookup and shop on http://127.0.0.1:${port} · payTo ${payTo}`));
