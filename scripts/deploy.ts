// Deploys the test USD₮0 copy and the stand-in stock seller, mints test tokens
// to the agent's wallet, and records the addresses for the server.
//
//   npm run deploy                 Sepolia, using .env
//   TURTLE_RPC=http://127.0.0.1:8545 TURTLE_RELAYER_KEY=<a local key> npm run deploy
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, formatEther, http, parseUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, sepolia } from 'viem/chains';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
// @ts-expect-error plain JavaScript module shared with the tests
import { deployAll, mint, TOKEN } from '../contracts/scripts/deploy-lib.mjs';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const transport = http(need('TURTLE_RPC'));
const chainId = await createPublicClient({ transport }).getChainId();
const chain = [sepolia, hardhat].find(item => item.id === chainId);
if (!chain) throw new Error(`Unsupported chain ${chainId}: this demo deploys to Sepolia or a local Hardhat chain only`);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport, account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const target = fileURLToPath(new URL(`contracts/deployments/${chain.id === sepolia.id ? 'sepolia' : 'local'}.json`, root));
if (existsSync(target) && chain.id === sepolia.id && !process.argv.includes('--again')) {
  throw new Error(`${target} exists. Pass --again to deploy a fresh set of contracts.`);
}
const funds = await publicClient.getBalance({ address: walletClient.account.address });
console.log(`Deployer ${walletClient.account.address} on ${chain.name}: ${formatEther(funds)} ETH`);
if (funds === 0n) throw new Error('The deployer has no ETH. Fund it from a Sepolia faucet first.');

const agent = new WalletAccountEvm(need('TURTLE_AGENT_SEED'), "0'/0/0");
const agentAddress = await agent.getAddress() as Address;
agent.dispose();
const fromBlock = await publicClient.getBlockNumber();
const deployment = await deployAll({ publicClient, walletClient });
const minted = '25';
const mintTransaction = await mint({ publicClient, walletClient }, deployment.token, agentAddress, parseUnits(minted, TOKEN.decimals));
mkdirSync(fileURLToPath(new URL('contracts/deployments/', root)), { recursive: true });
writeFileSync(target, JSON.stringify({ ...deployment, chain: chain.name, deployedFromBlock: fromBlock.toString(),
  agent: agentAddress, minted: `${minted} ${TOKEN.symbol}`, mintTransaction, deployedAt: new Date().toISOString() }, null, 2) + '\n');
const spent = funds - await publicClient.getBalance({ address: walletClient.account.address });
console.log(`Token ${deployment.token}\nSeller ${deployment.seller}\nMinted ${minted} ${TOKEN.symbol} to agent ${agentAddress}\nGas spent: ${formatEther(spent)} ETH\nWrote ${target}`);
