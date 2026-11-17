import { formatUnits } from 'viem';
import type { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import type { Deployment } from './wdk-payment.js';

export type WalletSnapshot = { address: string; chainId: number; balance: string; ethBalance: string;
  token: string; holdings: Array<{ symbol: string; balance: string; address: string }> };

// Reads everything through the WDK account: its payment-token balance, the
// stand-in shares it holds, and its ETH balance, which stays at zero because
// the agent never pays gas.
export function walletReader(agent: WalletAccountEvm, deployment: Deployment): () => Promise<WalletSnapshot> {
  let inFlight: Promise<WalletSnapshot> | undefined;
  const read = async (): Promise<WalletSnapshot> => {
    const stocks = deployment.stocks.map(item => item.address);
    const balances = await agent.getTokenBalances([deployment.token, ...stocks]);
    const balance = (address: string) => balances[address] ?? balances[address.toLowerCase()] ?? 0n;
    return { address: await agent.getAddress(), chainId: deployment.chainId, token: deployment.token,
      balance: formatUnits(balance(deployment.token), 6), ethBalance: formatUnits(await agent.getBalance(), 18),
      holdings: deployment.stocks.map(item => ({ symbol: item.symbol, address: item.address, balance: formatUnits(balance(item.address), 18) })) };
  };
  return () => {
    if (!inFlight) inFlight = read().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
