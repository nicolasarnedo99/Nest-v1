// A local chain with the demo's contracts deployed, shared by the contract tests.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseUnits, type Address } from 'viem';
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import type { Deployment } from '../../server/wdk-payment.js';
// @ts-expect-error plain JavaScript module shared with the deploy script
import { deployAll, mint, TOKEN } from '../../contracts/scripts/deploy-lib.mjs';

// Hardhat's well-known development mnemonic: account 0 deploys, account 1 relays.
const development = 'test test test test test test test test test test test junk';
export const RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

export async function startChain(port: number) {
  const rpc = `http://127.0.0.1:${port}`;
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain: hardhat, transport });
  const node: ChildProcess = spawn('npx', ['hardhat', 'node', '--port', String(port)], {
    cwd: fileURLToPath(new URL('../../contracts/', import.meta.url)), stdio: 'ignore' });
  for (let attempt = 0; ; attempt++) {
    try { await publicClient.getChainId(); break; }
    catch { if (attempt > 100) throw new Error('Local chain did not start'); await new Promise(done => setTimeout(done, 200)); }
  }
  const deployer = createWalletClient({ chain: hardhat, transport, account: mnemonicToAccount(development) });
  const relayer = createWalletClient({ chain: hardhat, transport, account: mnemonicToAccount(development, { addressIndex: 1 }) });
  const deployment: Deployment = await deployAll({ publicClient, walletClient: deployer });
  // A fresh wallet that never receives any ETH.
  const agent = new WalletAccountEvm(generateMnemonic(english), "0'/0/0", { provider: rpc });
  const buyer = await agent.getAddress() as Address;
  await mint({ publicClient, walletClient: deployer }, deployment.token, buyer, parseUnits('10', TOKEN.decimals));
  return { rpc, chain: hardhat, publicClient, deployer, relayer, deployment, agent, buyer,
    stop: () => { agent.dispose(); node.kill(); } };
}
