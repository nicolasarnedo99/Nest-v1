// Deploys a new stand-in stock seller for the existing test USD₮0 copy, with the companies in contracts/companies.json,
// and points contracts/deployments/sepolia.json at it. A seller's companies are fixed at deployment, so listing more
// companies needs a new seller; the token, its balances and the old seller's holdings are unchanged.
//
//   npx tsx scripts/deploy-seller.ts           dry run: shows what would change
//   npx tsx scripts/deploy-seller.ts --send    deploys on Sepolia and rewrites sepolia.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, formatEther, http, isAddressEqual, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
// @ts-expect-error plain JavaScript module shared with the tests
import { companies, deploySeller } from '../contracts/scripts/deploy-lib.mjs';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const target = fileURLToPath(new URL('contracts/deployments/sepolia.json', root));
const current = JSON.parse(readFileSync(target, 'utf8'));
const listed = (current.stocks as { company: string }[]).map(s => s.company);
const names = (companies as { name: string }[]).map(c => c.name);
// The app and the classifier address companies by index, so the existing ones must keep theirs.
if (listed.some((name, index) => names[index] !== name)) throw new Error(`companies.json reorders the listed companies: ${listed.join(', ')} → ${names.join(', ')}`);
console.log(`Token ${current.token} (unchanged)\nSeller ${current.seller} → a new seller listing ${names.join(', ')}`);

const transport = http(need('TURTLE_RPC'));
const publicClient = createPublicClient({ chain: sepolia, transport });
if (await publicClient.getChainId() !== sepolia.id) throw new Error('TURTLE_RPC is not Sepolia');
const walletClient = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const funds = await publicClient.getBalance({ address: walletClient.account.address });
console.log(`Deployer ${walletClient.account.address}: ${formatEther(funds)} ETH`);
if (!process.argv.includes('--send')) { console.log('Dry run only. Pass --send to deploy.'); process.exit(0); }

const { seller, stocks } = await deploySeller({ publicClient, walletClient }, current.token);
for (const [index, stock] of (current.stocks as { address: Hex }[]).entries())
  if (isAddressEqual(stocks[index].address, stock.address)) throw new Error('unexpected: a new seller reused an old stock address');
writeFileSync(target, `${JSON.stringify({ ...current, seller, stocks, sellerDeployedAt: new Date().toISOString(),
  previousSellers: [...(current.previousSellers ?? []), current.seller] }, null, 2)}\n`);
console.log(`Seller ${seller}\n${stocks.map((s: { company: string; address: string }) => `  ${s.company} ${s.address}`).join('\n')}\nGas spent: ${formatEther(funds - await publicClient.getBalance({ address: walletClient.account.address }))} ETH\nWrote ${target}`);
