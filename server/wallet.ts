import { erc1155Abi, formatUnits, type Address, type PublicClient } from 'viem';
import type { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import type { Deployment } from './wdk-payment.js';

export type WalletSnapshot = { address: string; chainId: number; balance: string; ethBalance: string;
  token: string; holdings: Array<{ symbol: string; balance: string; address: string }> };

// Reads through the WDK account its payment-token balance, the stock seller's
// stand-in shares (ERC-20) and its ETH balance, which stays at zero because
// the agent never pays gas. The index seller's shares are ERC-1155 balances on the
// seller, which WDK does not read, so `reader` reads them in one call.
export function walletReader(agent: WalletAccountEvm, deployment: Deployment, reader: Pick<PublicClient, 'readContract'>): () => Promise<WalletSnapshot> {
  let inFlight: Promise<WalletSnapshot> | undefined;
  const read = async (): Promise<WalletSnapshot> => {
    const stocks = deployment.stocks.map(item => item.address);
    const balances = await agent.getTokenBalances([deployment.token, ...stocks]);
    const balance = (address: string) => balances[address] ?? balances[address.toLowerCase()] ?? 0n;
    const address = await agent.getAddress() as Address;
    const { companies } = deployment;
    const shares = deployment.sellerKind === 'index' && companies ? await reader.readContract({ address: deployment.seller, abi: erc1155Abi,
      functionName: 'balanceOfBatch', args: [companies.map(() => address), companies.map((_, id) => BigInt(id))] }) : [];
    return { address, chainId: deployment.chainId, token: deployment.token,
      balance: formatUnits(balance(deployment.token), 6), ethBalance: formatUnits(await agent.getBalance(), 18),
      holdings: [...deployment.stocks.map(item => ({ symbol: item.symbol, address: item.address, balance: formatUnits(balance(item.address), 18) })),
        // Only the companies held: a row for each of ~500 listings would be all zeros.
        ...shares.flatMap((held, id) => held > 0n ? [{ symbol: companies![id]!, address: deployment.seller, balance: formatUnits(held, 18) }] : [])] };
  };
  return () => {
    if (!inFlight) inFlight = read().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
