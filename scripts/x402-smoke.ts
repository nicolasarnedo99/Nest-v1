// Runs one paid merchant lookup end to end on Sepolia: a throwaway wallet (key in memory only, never
// printed or saved) is minted 0.05 tUSDT0, then pays the lookup service 0.01 over x402 through the
// phone's own paidLookup, with the fee passing the same budget rule. The relayer pays the gas.
//
//   npx tsx scripts/x402-smoke.ts <lookup-url> [merchant=GITHUB]
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
// @ts-expect-error plain JavaScript module shared with the tests
import { mint, TOKEN } from '../contracts/scripts/deploy-lib.mjs';
import { LookupFailed, paidLookup, walletSigner } from '../mobile/lib/x402';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const [url, merchant = 'GITHUB'] = process.argv.slice(2);
if (!url) { console.error('Usage: npx tsx scripts/x402-smoke.ts <lookup-url> [merchant=GITHUB]'); process.exit(2); }
// Before any RPC call or mint, so a typo costs no gas.
try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('protocol'); }
catch { console.error(`Not an http(s) URL: ${url}`); process.exit(2); }

const transport = http(need('TURTLE_RPC'));
const publicClient = createPublicClient({ chain: sepolia, transport });
const chainId = await publicClient.getChainId();
if (chainId !== sepolia.id) throw new Error(`TURTLE_RPC is chain ${chainId}: this script runs on Sepolia only`);
const { token } = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/sepolia.json', root)), 'utf8')) as { token: Hex };

const account = privateKeyToAccount(generatePrivateKey());
const balance = async () => await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
console.log(`Throwaway buyer ${account.address}`);

const relayer = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const minted = await mint({ publicClient, walletClient: relayer }, token, account.address, parseUnits('0.05', TOKEN.decimals)) as Hex;
console.log(`Minted 0.05 tUSDT0: ${minted}`);
// publicnode load-balances backends; give every backend the mint before the server verifies the balance.
await publicClient.waitForTransactionReceipt({ hash: minted, confirmations: 3 });
const before = await balance();

let text: string | null = null;
const budget = { read: () => text, write: (next: string) => { text = next; } };
try {
  const { result, fee, transaction } = await paidLookup({ url, merchant, budget,
    expected: { network: `eip155:${sepolia.id}`, asset: token, maxAmount: 10000n },
    signer: walletSigner(account.address, d => account.signTypedData({ ...d, primaryType: 'TransferWithAuthorization' } as never)) });
  // Same lag as after the mint: give every backend the settlement before reading the balance.
  const settled = transaction ? await publicClient.waitForTransactionReceipt({ hash: transaction as Hex, confirmations: 3 }) : null;
  const after = await balance();
  console.log(`${merchant} → ${result.listedParent ?? 'no listed parent'}${result.operator ? ` (operator ${result.operator})` : ''}${result.note ? ` [${result.note}]` : ''}`);
  console.log(`Fee ${formatUnits(fee, TOKEN.decimals)} tUSDT0, settlement ${transaction ? `https://sepolia.etherscan.io/tx/${transaction}` : 'not reported'}`);
  console.log(`Buyer balance ${formatUnits(before, TOKEN.decimals)} → ${formatUnits(after, TOKEN.decimals)} (${formatUnits(after - before, TOKEN.decimals)})`);
  if (before - after !== 10000n || fee !== 10000n || !transaction || settled?.status !== 'success') {
    console.error(`Smoke test FAILED: expected a 0.01 debit and a settlement transaction (debit ${before - after}, fee ${fee}, transaction ${transaction}, status ${settled?.status})`);
    process.exit(1);
  }
} catch (error) {
  if (!(error instanceof LookupFailed)) throw error;
  console.error(`Lookup failed: ${error.message} (fee may be paid: ${error.feeMayBePaid})\nBuyer balance ${formatUnits(before, TOKEN.decimals)} → ${formatUnits(await balance(), TOKEN.decimals)}`);
  process.exit(1);
}
