// Deploys the index seller (IndexSeller: any number of companies, ERC-1155 shares) for the existing test USD₮0 copy and
// lists the companies in a JSON file, `--batch` per transaction. Company id = index in that file, so never reorder it.
// The old seller and sepolia.json are left alone. Repeating the command resumes: it reuses the seller already in the
// output file and only lists ids that are not listed yet.
//
//   npx tsx scripts/deploy-index-seller.ts --companies <file.json>          dry run: shows what would happen
//   npx tsx scripts/deploy-index-seller.ts --companies <file.json> --send   deploys on Sepolia → contracts/deployments/sepolia-index.json
// The file has companies.json's shape: [{ "name", "symbol", "stockName", "priceUsd" }]. On any chain other than Sepolia
// (only a local Hardhat node is accepted) also pass --token <address> and --out <file>.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, sepolia } from 'viem/chains';
// @ts-expect-error plain JavaScript module shared with the tests
import { deployIndexSeller, listCompanies } from '../contracts/scripts/deploy-lib.mjs';

const { values: args } = parseArgs({ options: {
  companies: { type: 'string' }, batch: { type: 'string', default: '100' }, token: { type: 'string' },
  out: { type: 'string' }, send: { type: 'boolean', default: false } } });
const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

if (!args.companies) throw new Error('Pass --companies <file.json>');
const list = JSON.parse(readFileSync(args.companies, 'utf8')) as { name: string; symbol: string; stockName: string; priceUsd: string }[];
if (list.length > 65536) throw new Error('Company ids are uint16');
const batch = Number(args.batch);
if (!Number.isInteger(batch) || batch < 1) throw new Error('--batch must be a positive integer');

const transport = http(need('TURTLE_RPC'));
const publicClient = createPublicClient({ transport });
const chainId = await publicClient.getChainId();
const onSepolia = chainId === sepolia.id;
if (!onSepolia && chainId !== hardhat.id) throw new Error(`Chain ${chainId} is neither Sepolia nor a local Hardhat node`);
// Only a Sepolia run may write sepolia-index.json; a local run must say where its output goes.
const target = onSepolia ? fileURLToPath(new URL('contracts/deployments/sepolia-index.json', root)) : args.out;
if (!target) throw new Error(`Chain ${chainId} is not Sepolia: pass --out <file>`);
const token = (args.token ?? (onSepolia
  ? JSON.parse(readFileSync(new URL('contracts/deployments/sepolia.json', root), 'utf8')).token : undefined)) as Address | undefined;
if (!token) throw new Error('Pass --token <address> on a chain other than Sepolia');
const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : undefined;
if (previous && previous.chainId !== chainId) throw new Error(`${target} is for chain ${previous.chainId}, not ${chainId}`);

const walletClient = createWalletClient({ chain: onSepolia ? sepolia : hardhat, transport,
  account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const funds = await publicClient.getBalance({ address: walletClient.account.address });
console.log(`Chain ${chainId}${onSepolia ? ' (Sepolia)' : ''}, token ${token}\nDeployer and owner ${walletClient.account.address}: ${formatEther(funds)} ETH`);
console.log(`${previous?.seller ? `Seller ${previous.seller} (resuming)` : 'A new seller'}: ${list.length} companies, ${batch} per transaction`);
// shortcut: per-listing gas measured locally with names up to 64 bytes (tests/contracts/index-seller.test.ts); longer names cost more.
const estimate = BigInt(previous?.seller ? 0 : 2_100_000) + BigInt(list.length) * 120_000n;
console.log(`At most ~${estimate} gas, ~${formatEther(estimate * await publicClient.getGasPrice())} ETH at today's gas price`);
if (!args.send) { console.log('Dry run only. Pass --send to deploy.'); process.exit(0); }

const clients = { publicClient, walletClient };
let state = previous ?? {};
const write = (fields: object) => { state = { ...state, ...fields }; writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`); };
const seller: Address = previous?.seller ?? await deployIndexSeller(clients, token);
// Written before listing, so a run that stops partway resumes against this seller instead of deploying another.
if (!previous?.seller) write({ chainId, token, seller, owner: walletClient.account.address, deployedAt: new Date().toISOString() });
const batches = await listCompanies(clients, seller, list, batch) as { hash: Hex; ids: [number, number]; gasUsed: bigint }[];
for (const b of batches) console.log(`  listed ${b.ids[0]}–${b.ids[1]}: ${b.gasUsed} gas, ${b.hash}`);
write({ companies: list.length, listedAt: new Date().toISOString() });
console.log(`Seller ${seller}\nGas spent: ${formatEther(funds - await publicClient.getBalance({ address: walletClient.account.address }))} ETH\nWrote ${target}`);
