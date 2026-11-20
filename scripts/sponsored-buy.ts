// Runs the phone's payment from Node on Sepolia, end to end, with a fresh
// throwaway wallet that holds no ETH: mint it 1 test USD₮0, build and sign the
// order as the phone does, and send buy() through WDK's EIP-7702 gasless
// account, with Candide's public paymaster paying the gas. The throwaway seed
// lives only in memory and is never printed or saved.
//
//   npx tsx scripts/sponsored-buy.ts
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, erc1155Abi, erc20Abi, formatUnits, http, parseUnits, type Hex } from 'viem';
import { english, generateMnemonic, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
// @ts-expect-error plain JavaScript module shared with the tests
import { mint, TOKEN } from '../contracts/scripts/deploy-lib.mjs';
import { buildOrder, buyCall } from '../mobile/lib/order';
import { checkOrder } from '../mobile/lib/pay';
import config from '../mobile/turtle.config.json' with { type: 'json' };
// The phone's wallet package, installed only under mobile/.
// @ts-expect-error plain JavaScript package without types for this path
import WalletManagerEvm7702Gasless from '../mobile/node_modules/@tetherto/wdk-wallet-evm-7702-gasless/index.js';

const root = new URL('../', import.meta.url);
const environment = fileURLToPath(new URL('.env', root));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win
const need = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

// The same configuration the phone's worklet gets in mobile/index.ts.
const PHONE = { chainId: 11155111, provider: 'https://ethereum-sepolia-rpc.publicnode.com',
  // Candide's public Sepolia sponsorship stopped qualifying ops on 20 Nov 2026; a private key (and optional policy) from its dashboard replaces it.
  bundlerUrl: process.env.CANDIDE_BUNDLER_URL || 'https://api.candide.dev/public/v3/11155111', delegationAddress: '0xe6Cae83BdE06E4c305530e199D7217f42808555B', isSponsored: true,
  ...(process.env.CANDIDE_POLICY_ID ? { sponsorshipPolicyId: process.env.CANDIDE_POLICY_ID } : {}) };
const AMOUNT = parseUnits('0.5', TOKEN.decimals);
const COMPANY = 0;

const minterTransport = http(need('TURTLE_RPC'));
const phoneReader = createPublicClient({ chain: sepolia, transport: http(PHONE.provider) });
for (const [name, chainId] of [['TURTLE_RPC', await createPublicClient({ transport: minterTransport }).getChainId()],
  ['the phone provider', await phoneReader.getChainId()]] as const) {
  if (chainId !== sepolia.id || config.chain.chainId !== sepolia.id) throw new Error(`${name} is chain ${chainId}: this script runs on Sepolia only`);
}
const deployment = JSON.parse(readFileSync(fileURLToPath(new URL('contracts/deployments/sepolia.json', root)), 'utf8'));
const { chain } = config;
const balances = async (owner: Hex) => {
  const read = (address: Hex) => phoneReader.readContract({ address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
  // The index seller's shares are ERC-1155 ids on the seller; the stock seller's are one ERC-20 per company.
  const shares = chain.sellerKind === 'index'
    ? await phoneReader.readContract({ address: chain.seller as Hex, abi: erc1155Abi, functionName: 'balanceOf', args: [owner, BigInt(COMPANY)] })
    : await read(deployment.stocks[COMPANY].address);
  return `${formatUnits(await read(chain.token as Hex), 6)} tUSDT0, ${formatUnits(shares, 18)} ${config.stocks[COMPANY]} shares, ` +
    `${formatUnits(await phoneReader.getBalance({ address: owner }), 18)} ETH`;
};

const wallet = new WalletManagerEvm7702Gasless(generateMnemonic(english), PHONE);
const account = await wallet.getAccount(0);
const buyer = await account.getAddress() as Hex;
console.log(`Throwaway buyer ${buyer}`);

const minter = createWalletClient({ chain: sepolia, transport: minterTransport, account: privateKeyToAccount(need('TURTLE_RELAYER_KEY') as Hex) });
const minted = await mint({ publicClient: createPublicClient({ chain: sepolia, transport: minterTransport }), walletClient: minter },
  chain.token, buyer, parseUnits('1', TOKEN.decimals));
console.log(`Minted 1 tUSDT0: ${minted}\nBefore: ${await balances(buyer)}`);

const nowSeconds = Math.floor(Date.now() / 1000);
const { order, typed } = buildOrder({ chain, buyer, company: COMPANY, eventId: `smoke-${nowSeconds}`, value: AMOUNT, nowSeconds });
checkOrder(typed, { buyer, value: AMOUNT, chain, nowSeconds });
const signature = await account.signTypedData({ domain: typed.domain, types: typed.types, message: typed.message }) as Hex;
const started = Date.now();
const { hash: userOperation } = await account.sendTransaction(buyCall(chain, order, signature));
console.log(`UserOperation ${userOperation}`);

let receipt: { success: boolean; receipt: { transactionHash: Hex } } | null = null;
for (let attempt = 0; attempt < 40 && !receipt; attempt++) {
  receipt = await account.getUserOperationReceipt(userOperation);
  if (!receipt) await new Promise(done => setTimeout(done, 3000));
}
if (!receipt) throw new Error('No receipt after 120 s');
console.log(`Transaction ${receipt.receipt.transactionHash} (${receipt.success ? 'success' : 'FAILED'}, after ${(Date.now() - started) / 1000} s)`);
console.log(`After: ${await balances(buyer)}`);
console.log(`Code at the buyer: ${await phoneReader.getCode({ address: buyer })}`);
wallet.dispose();
if (!receipt.success) process.exit(1);
