// The paid merchant lookup on its own: no model, no agent seed, no other routes.
// Env: TURTLE_RELAYER_KEY (testnet only; it pays settlement gas and receives the fees),
// TURTLE_RPC (Sepolia, defaults to publicnode), LOOKUP_PORT (default 4180). Listens on 127.0.0.1 only;
// Tailscale Funnel publishes it.
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createLookupApp, localFacilitator } from './lookup.js';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win

const relayerKey = process.env.TURTLE_RELAYER_KEY as Hex | undefined;
if (!relayerKey) throw new Error('Missing TURTLE_RELAYER_KEY');
const rpc = process.env.TURTLE_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const port = Number(process.env.LOOKUP_PORT ?? 4180);
const chainId = await createPublicClient({ transport: http(rpc) }).getChainId();
if (chainId !== sepolia.id) throw new Error(`TURTLE_RPC is chain ${chainId}: the lookup runs on Sepolia only`);
const { token } = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/sepolia.json', root)), 'utf8')) as { token: Address };
const payTo = privateKeyToAccount(relayerKey).address;

const app = createLookupApp({
  facilitator: localFacilitator({ chain: sepolia, rpc, relayerKey }), payTo, chainId, token,
  tokenName: 'Test USDT0 copy (Turtle demo)',
  onSettled: (merchant, transaction) => console.log(`Lookup ${JSON.stringify(merchant)} settled in ${transaction}`),
});
app.listen(port, '127.0.0.1', () => console.log(`Merchant lookup on http://127.0.0.1:${port}/lookup · payTo ${payTo}`));
