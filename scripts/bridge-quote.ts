// Asks, without sending anything, what it would cost to turn USD₮ on Ethereum
// into USD₮0 on Plasma. Read-only: no transaction is signed or broadcast.
//
// 1. Through WDK's own bridge module (quoteBridge), with a wallet that holds
//    no USD₮. The outcome, success or error, is recorded as it happens.
// 2. Directly from the USD₮0 adapter contract on Ethereum (LayerZero's
//    quoteSend), which needs no balance and gives the messaging fee.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, formatEther, formatGwei, http, pad, parseAbi, parseUnits, type Address } from 'viem';
import { english, generateMnemonic } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import Usdt0ProtocolEvm from '@tetherto/wdk-protocol-bridge-usdt0-evm';

const RPC = 'https://ethereum-rpc.publicnode.com';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const OFT_ADAPTER = '0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee'; // docs.usdt0.to deployments, Ethereum
const PLASMA_EID = 30383;
const amount = parseUnits('5', 6);

// A throwaway wallet: the quote must not depend on anyone's real funds.
const account = new WalletAccountEvm(generateMnemonic(english), "0'/0/0", { provider: RPC });
const recipient = await account.getAddress() as Address;
const result: Record<string, unknown> = { askedAt: new Date().toISOString(), route: 'Ethereum USD₮ -> Plasma USD₮0', amount: '5 USD₮' };

try {
  const quote = await new Usdt0ProtocolEvm(account).quoteBridge({ targetChain: 'plasma', recipient, token: USDT, amount });
  result.wdkQuoteBridge = { ok: true, gasFeeEth: formatEther(quote.fee), bridgeFeeEth: formatEther(quote.bridgeFee) };
} catch (error) {
  result.wdkQuoteBridge = { ok: false, error: error instanceof Error ? error.message.split('\n')[0]!.slice(0, 300) : String(error) };
}
account.dispose();

const client = createPublicClient({ chain: mainnet, transport: http(RPC) });
const abi = parseAbi([
  'struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }',
  'struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }',
  'function quoteSend(SendParam sendParam, bool payInLzToken) view returns (MessagingFee)',
]);
const fee = await client.readContract({ address: OFT_ADAPTER, abi, functionName: 'quoteSend', args: [
  { dstEid: PLASMA_EID, to: pad(recipient), amountLD: amount, minAmountLD: amount, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' }, false] });
const gasPrice = await client.getGasPrice();
result.direct = { contract: OFT_ADAPTER, messagingFeeEth: formatEther(fee.nativeFee), gasPriceGwei: formatGwei(gasPrice) };

const target = fileURLToPath(new URL('../contracts/deployments/bridge-quote.json', import.meta.url));
writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
