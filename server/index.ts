import { existsSync, mkdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
import express from 'express';
import type { Hex } from 'viem';
import { hardhat, sepolia } from 'viem/chains';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import { COMPANIES } from '../classifier/lib.mjs';
import { createApp } from './app.js';
import { loadClassifier } from './classifier.js';
import { Execution, ExecutionStore } from './execution.js';
import { Pipeline } from './pipeline.js';
import { EventStore } from './store.js';
import { walletReader } from './wallet.js';
import { loadDeployment, WdkPayment } from './wdk-payment.js';

const root = fileURLToPath(new URL('../', import.meta.url));
process.umask(0o077);
const environment = resolve(root, '.env');
if (existsSync(environment)) loadEnvFile(environment);
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return value;
};

const deployment = loadDeployment(resolve(root, process.env.TURTLE_DEPLOYMENT ?? 'contracts/deployments/sepolia.json'));
const chain = [sepolia, hardhat].find(item => item.id === deployment.chainId);
if (!chain) throw new Error(`Unsupported chain ${deployment.chainId}`);
const rpc = need('TURTLE_RPC');
// The agent's wallet: a Tether WDK account derived from a seed phrase. It
// holds the payment token and signs messages. It is never given any ETH.
const agent = new WalletAccountEvm(need('TURTLE_AGENT_SEED'), "0'/0/0", { provider: rpc });
// TURTLE_LORA is the fine-tuned adapter. Leaving it unset runs the base model.
const lora = process.env.TURTLE_LORA ? resolve(root, process.env.TURTLE_LORA) : undefined;
console.log(`Loading Qwen3 1.7B through QVAC ${lora ? `with adapter ${lora}` : 'WITHOUT an adapter (base model)'}`);
const classifier = await loadClassifier({ lora });

// One data folder per chain, so a local test run never counts against the
// daily cap or the purchase history of the Sepolia demo.
const data = resolve(root, 'data', String(deployment.chainId));
mkdirSync(data, { recursive: true, mode: 0o700 });
const store = new EventStore(resolve(data, 'turtle.sqlite'));
const purchases = new ExecutionStore(resolve(data, 'purchases.sqlite'));
const payment = new WdkPayment(agent, deployment, { rpc, chain, relayerKey: need('TURTLE_RELAYER_KEY') as Hex });
const pipeline = new Pipeline(store, classifier, new Execution(purchases, payment), COMPANIES);

const app = createApp({ store, readWallet: walletReader(agent, deployment),
  model: { name: 'Qwen3 1.7B', adapter: lora ? basename(dirname(lora)) : null },
  onEvent: event => { void pipeline.enqueue(event).then(
    done => console.log(`${done.merchant} -> ${done.status}${done.detail.company ? ` (${done.detail.company})` : ''}${done.reason ? `: ${done.reason}` : ''}`),
    error => console.error(`Event ${event.id} failed: ${error instanceof Error ? error.message : error}`)); } });
const dist = resolve(root, 'dist');
app.use(express.static(dist, { dotfiles: 'deny' }));
app.get('/{*path}', (_request, response) => {
  if (!existsSync(resolve(dist, 'index.html'))) {
    response.status(503).type('text').send('Frontend build missing. Run npm run build.'); return;
  }
  response.sendFile(resolve(dist, 'index.html'));
});
// Bind to 127.0.0.1 by default. Set TURTLE_HOST to the Tailscale address to
// let the iPhone Shortcut reach the intake route; every other route still
// refuses anything that is not this machine.
const host = process.env.TURTLE_HOST ?? '127.0.0.1';
const server = app.listen(4173, host, async () => {
  console.log(`Turtle on http://${host}:4173 · chain ${chain.name} · agent wallet ${await agent.getAddress()}`);
});
const stop = () => { server.close(async () => {
  store.close(); purchases.close(); agent.dispose();
  // The model's worker can already be gone when the signal reaches it too.
  await classifier.close().catch(error => console.error(`Model unload: ${error instanceof Error ? error.message : error}`));
  process.exit(0);
}); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
