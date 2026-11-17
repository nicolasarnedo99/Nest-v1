// Creates the two testnet secrets this demo needs and writes them to .env
// (which git ignores). Run once: `npm run setup:keys`.
//
//   TURTLE_AGENT_SEED   seed phrase of the agent's WDK wallet. Holds the test
//                       token, signs messages, never holds ETH.
//   TURTLE_RELAYER_KEY  a plain key that pays gas: it deploys the contracts,
//                       owns the test token (so it can mint), and relays buys.
//                       This is the only address that needs Sepolia ETH.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { english, generateMnemonic, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';

const path = fileURLToPath(new URL('../.env', import.meta.url));
const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
if (/^TURTLE_(AGENT_SEED|RELAYER_KEY)=/m.test(current)) {
  throw new Error('.env already holds Turtle keys; refusing to replace them. Remove those lines yourself to start again.');
}
const seed = generateMnemonic(english);
const relayerKey = generatePrivateKey();
const agent = new WalletAccountEvm(seed, "0'/0/0");
// Appended, so anything already in .env is left as it is.
writeFileSync(path, [
  current.replace(/\n*$/, current ? '\n\n' : ''),
  '# Turtle, testnet only. Never put real funds behind these.',
  'TURTLE_RPC=https://ethereum-sepolia-rpc.publicnode.com',
  `TURTLE_AGENT_SEED="${seed}"`,
  `TURTLE_RELAYER_KEY=${relayerKey}`,
  '# Path to the fine-tuned adapter. Remove the line to run the base model.',
  'TURTLE_LORA=classifier/adapters/run3/selected.gguf',
  '',
].join('\n').replace(/^\n/, ''), { mode: 0o600 });
console.log(`Updated .env\nAgent wallet (WDK):  ${await agent.getAddress()}  needs no ETH\nRelayer and deployer: ${privateKeyToAccount(relayerKey).address}  <- send Sepolia ETH here`);
agent.dispose();
