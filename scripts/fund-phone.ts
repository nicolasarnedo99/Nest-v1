// Mints test USD₮0 to the phone's wallet on Sepolia, so it has something to
// pay with. The relayer key owns the token; the phone never gets any ETH.
//
//   npx tsx scripts/fund-phone.ts <address> [amount=10]
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, isAddress, parseUnits, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
// @ts-expect-error plain JavaScript module shared with the tests
import { mint, TOKEN } from '../contracts/scripts/deploy-lib.mjs';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const [to, amount = '10'] = process.argv.slice(2);
if (!to || !isAddress(to)) throw new Error('Usage: npx tsx scripts/fund-phone.ts <address> [amount=10]');
const transport = http(need('TURTLE_RPC'));
const chainId = await createPublicClient({ transport }).getChainId();
if (chainId !== sepolia.id) throw new Error(`TURTLE_RPC is chain ${chainId}: this script funds the phone on Sepolia only`);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const { token } = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/sepolia.json', root)), 'utf8'));
const hash = await mint({ publicClient, walletClient }, token, to, parseUnits(amount, TOKEN.decimals));
console.log(`Minted ${amount} ${TOKEN.symbol} to ${to}\nTransaction ${hash}`);
