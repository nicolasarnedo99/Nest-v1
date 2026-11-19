// Registers the paid merchant lookup once, as an agent in the ERC-8004 Identity Registry on Sepolia.
// The agent card travels on-chain as a data: URI, so nothing has to be hosted. The registry sets the
// agent wallet to the registering address, which must be the lookup's payTo (the relayer).
//
//   npx tsx scripts/register-lookup-agent.ts           dry run: prints the card and the gas estimate
//   npx tsx scripts/register-lookup-agent.ts --send    sends the transaction and records it in the deployment file (lookup.json by default)
//   --deployment <path>                                registers another service from its deployment file (default contracts/deployments/lookup.json)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, getAddress, http, isAddressEqual, parseAbi, parseEventLogs, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const registry = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
// register is overloaded; only the one-string form is listed so viem cannot pick another.
const abi = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
]);

const send = process.argv.includes('--send');
const force = process.argv.includes('--force');
const flag = process.argv.indexOf('--deployment');
const relative = flag < 0 ? 'contracts/deployments/lookup.json' : process.argv[flag + 1];
if (!relative) throw new Error('--deployment needs a path');
const lookupPath = fileURLToPath(new URL(relative, root));
const file = basename(lookupPath);
const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as Record<string, unknown> & { url: string; payTo: Hex; agentId?: string; name?: string; description?: string };

const transport = http(need('TURTLE_RPC'));
const publicClient = createPublicClient({ chain: sepolia, transport });
const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id) throw new Error(`TURTLE_RPC is chain ${chainId}: this script registers on Sepolia only`);

const card = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: lookup.name ?? 'Nest merchant lookup',
  description: lookup.description ?? 'Who operates a card-statement merchant, and which of Apple, Alphabet, Microsoft, Tesla and NVIDIA owns it, if any. Demo data. 0.01 USD₮0 per lookup over x402 on Sepolia.',
  services: [{ name: 'x402', endpoint: lookup.url, version: '2' }],
  x402Support: true,
  active: true,
};
const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString('base64')}`;

if (!(await publicClient.getCode({ address: registry }))) throw new Error(`No contract at ${registry} on Sepolia`);
const account = privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex);
const matches = isAddressEqual(account.address, lookup.payTo);
console.log(JSON.stringify(card, null, 2));
console.log(`URI length ${agentURI.length}\nRegistering ${account.address}\npayTo ${lookup.payTo} (${matches ? 'match' : 'MISMATCH'})`);
if (!matches) throw new Error(`TURTLE_RELAYER_KEY is not the payTo of ${file}: the agent wallet would be the wrong address`);
if (lookup.agentId) {
  if (!send) console.warn(`WARNING: ${file} already has agentId ${lookup.agentId}`);
  else if (!force) throw new Error(`${file} already has agentId ${lookup.agentId}; pass --force to register another`);
}

if (!send) {
  const gas = await publicClient.estimateContractGas({ address: registry, abi, functionName: 'register', args: [agentURI], account });
  console.log(`Estimated gas ${gas}\nDry run only. Pass --send to register.`);
  process.exit(0);
}

const walletClient = createWalletClient({ chain: sepolia, transport, account });
// A retry after a sent transaction failed to confirm must first check the printed hash on Etherscan: the guard only applies once agentId is recorded.
const hash = await walletClient.writeContract({ address: registry, abi, functionName: 'register', args: [agentURI] });
console.log(`Sent ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 3 });
if (receipt.status !== 'success') throw new Error(`Registration reverted: ${hash}`);
const [registered] = parseEventLogs({ abi, eventName: 'Registered', logs: receipt.logs.filter(l => isAddressEqual(l.address, registry)) });
if (!registered) throw new Error(`No Registered event in ${hash}`);
const { agentId } = registered.args;

// Confirmations above give every load-balanced backend the block before these reads.
const wallet = await publicClient.readContract({ address: registry, abi, functionName: 'getAgentWallet', args: [agentId] });
const stored = await publicClient.readContract({ address: registry, abi, functionName: 'tokenURI', args: [agentId] });
if (!isAddressEqual(wallet, lookup.payTo)) throw new Error(`Agent ${agentId} wallet is ${wallet}, expected ${lookup.payTo}`);
if (stored !== agentURI) throw new Error(`Agent ${agentId} tokenURI differs from the URI sent`);

try {
  writeFileSync(lookupPath, `${JSON.stringify({ ...lookup, registry: getAddress(registry), agentId: agentId.toString(), registerTransaction: hash }, null, 2)}\n`);
} catch (error) {
  throw new Error(`Registered agent ${agentId} in ${hash} but could not write ${file}: record agentId and registerTransaction by hand`, { cause: error });
}
console.log(`Registered agent ${agentId}, wallet ${wallet}\nhttps://sepolia.etherscan.io/tx/${hash}`);
