import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, verifyTypedData, type Address, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import { orderIdFor, receiveAuthorization, SignatureRejected, type Order } from './authorization.js';
import type { Inspection, PaymentAdapter, Prepared, Purchase, PurchaseIntent } from './execution.js';
// @ts-expect-error plain JavaScript module shared with the phone's sync script
import { sellerFor } from '../mobile/scripts/stocks.mjs';

export type Deployment = {
  chainId: number; token: Address; seller: Address; tokenName: string;
  // The stock seller's ERC-20 shares, one per company. Still read for holdings once the index seller is paid.
  stocks: { company: string; symbol: string; address: Address }[];
  // Set when `seller` is IndexSeller: its ERC-1155 share ids, company id = index in `companies`.
  sellerKind?: 'index'; companies?: string[];
};
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
// The index seller is paid once `indexPath` exists (scripts/deploy-index-seller.ts), with `brandsPath`'s companies as its ids.
export function loadDeployment(path: string, indexPath?: string, brandsPath?: string): Deployment {
  const stockDeployment = read(path) as Deployment;
  const indexDeployment = indexPath && existsSync(indexPath) ? read(indexPath) : undefined;
  const companies = brandsPath && existsSync(brandsPath) ? read(brandsPath).companies : undefined;
  const { seller, sellerKind, stocks } = sellerFor(stockDeployment, indexDeployment, companies);
  return sellerKind === 'index' ? { ...stockDeployment, seller, sellerKind, companies: stocks } : stockDeployment;
}

const sellerAbi = (kind?: 'index') => kind === 'index' ? indexSellerAbi : stockSellerAbi;
const stockSellerAbi = parseAbi([
  'struct Order { uint8 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }',
  'function buy(Order order, bytes signature) returns (uint256 shares)',
  'event Bought(address indexed buyer, uint8 indexed company, bytes32 indexed orderId, uint256 paid, uint256 shares)',
]);
const indexSellerAbi = parseAbi([
  'struct Order { uint16 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }',
  'function buy(Order order, bytes signature) returns (uint256 shares)',
  'event Bought(address indexed buyer, uint16 indexed company, bytes32 indexed orderId, uint256 paid, uint256 shares)',
]);
// How long a signature stays usable. Short, so an unsubmitted one dies quickly.
const VALIDITY_SECONDS = 600n;

// Two keys with two jobs. The agent's wallet is a Tether WDK account: it holds
// the USD₮0 and only ever signs a typed message. The relayer is a plain key
// holding ETH: it pays gas to submit that message and can do nothing else with
// it, because the token only honours the signature inside the seller contract.
export class WdkPayment implements PaymentAdapter {
  private readonly reader;
  private readonly relayer;

  constructor(private readonly agent: WalletAccountEvm, private readonly deployment: Deployment,
    options: { rpc: string; chain: Chain; relayerKey: Hex }) {
    if (options.chain.id !== deployment.chainId) throw new Error('Chain does not match the deployment');
    const transport = http(options.rpc, { retryCount: 0, timeout: 20_000 });
    this.reader = createPublicClient({ chain: options.chain, transport });
    this.relayer = createWalletClient({ chain: options.chain, transport, account: privateKeyToAccount(options.relayerKey) });
  }

  typedData(order: Order) {
    const { chainId, token, tokenName: name, seller } = this.deployment;
    return receiveAuthorization({ name, chainId, token }, seller, order);
  }

  // The order for any buyer, including a wallet that signs on another device.
  async orderFor(buyer: Address, intent: PurchaseIntent): Promise<Order> {
    const block = await this.reader.getBlock();
    return { company: intent.company, orderId: orderIdFor(intent.id), buyer, value: intent.amount,
      validAfter: 0n, validBefore: block.timestamp + VALIDITY_SECONDS };
  }

  async prepare(intent: PurchaseIntent): Promise<Prepared> {
    const fromBlock = await this.reader.getBlockNumber();
    const buyer = await this.agent.getAddress() as Address;
    return { balance: await this.agent.getTokenBalance(this.deployment.token), fromBlock, order: await this.orderFor(buyer, intent) };
  }

  async sign(prepared: Prepared): Promise<Hex> {
    const { domain, types, message } = this.typedData(prepared.order);
    return await this.agent.signTypedData({ domain, types, message }) as Hex;
  }

  // Checked with viem, an implementation independent of the wallet that signed.
  async verify(prepared: Pick<Prepared, 'order'>, signature: Hex): Promise<void> {
    const valid = await verifyTypedData({ ...this.typedData(prepared.order), address: prepared.order.buyer, signature });
    if (!valid) throw new SignatureRejected('Signature does not match the prepared order');
  }

  async submit(prepared: Pick<Prepared, 'order'>, signature: Hex): Promise<Hex> {
    return this.relayer.writeContract({ address: this.deployment.seller, abi: sellerAbi(this.deployment.sellerKind),
      functionName: 'buy', args: [prepared.order, signature] });
  }

  // The seller's Bought event for this order id is the proof of purchase. It
  // is looked up by order, not by transaction hash, so a purchase is found even
  // if the hash was never saved.
  async inspect(purchase: Purchase): Promise<Inspection> {
    const { order, fromBlock } = purchase.prepared;
    if (purchase.transaction) {
      await this.reader.waitForTransactionReceipt({ hash: purchase.transaction, timeout: 90_000 }).catch(() => undefined);
    }
    const logs = await this.reader.getContractEvents({ address: this.deployment.seller, abi: sellerAbi(this.deployment.sellerKind),
      eventName: 'Bought', args: { orderId: order.orderId }, fromBlock });
    const log = logs.find(item => item.args.buyer?.toLowerCase() === order.buyer.toLowerCase());
    if (log) {
      if (log.args.paid !== order.value || log.args.company !== order.company) throw new Error('On-chain purchase differs from the order');
      return { status: 'confirmed', shares: log.args.shares!, evidence: { transaction: log.transactionHash,
        blockNumber: log.blockNumber, paid: log.args.paid, relayer: this.relayer.account.address } };
    }
    return { status: (await this.reader.getBlock()).timestamp > order.validBefore ? 'expired' : 'pending' };
  }
}
