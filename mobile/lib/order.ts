// The phone builds its own order now, with the same order id, nonce and typed
// data the Mac built, so one card tap can still buy only once.
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { orderIdFor, receiveAuthorization, type Order } from '../../server/authorization';
import type { Chain, Typed } from './pay';

const VALIDITY_SECONDS = 600;
const BUY = 'function buy(Order order, bytes signature) returns (uint256 shares)';
// The company's width changes buy's selector (not the nonce), so the call must match the configured seller.
const stockSellerAbi = parseAbi(['struct Order { uint8 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }', BUY]);
const indexSellerAbi = parseAbi(['struct Order { uint16 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }', BUY]);

// A company's name and id on the configured seller, matched by ticker: the stock seller says "Apple" where the brand table
// and the lookup say "Apple Inc.". A company the seller does not list is a clear "nothing bought", never another company.
export function onSeller(company: { ticker: string; name: string }, seller: { tickers: readonly string[]; stocks: readonly string[] }): { name: string; id: number } | { error: string } {
  const id = seller.tickers.indexOf(company.ticker);
  const name = seller.stocks[id];
  return id < 0 || name === undefined ? { error: `Nothing bought: ${company.name} (${company.ticker}) is not listed on the seller yet` } : { name, id };
}

export function buildOrder(input: { chain: Chain; buyer: string; company: number; eventId: string; value: bigint; nowSeconds: number }) {
  const { chain } = input;
  const order: Order = { company: input.company, orderId: orderIdFor(input.eventId), buyer: input.buyer as Address,
    value: input.value, validAfter: 0n, validBefore: BigInt(input.nowSeconds + VALIDITY_SECONDS) };
  const { domain, types, primaryType, message } = receiveAuthorization(
    { name: chain.tokenName, chainId: chain.chainId, token: chain.token as Address }, chain.seller as Address, order);
  // Strings, not bigints: the typed data crosses into the wallet's worklet as JSON.
  const typed: Typed & { types: typeof types } = { domain, types, primaryType, message: { ...message,
    value: message.value.toString(), validAfter: message.validAfter.toString(), validBefore: message.validBefore.toString() } };
  return { order, typed };
}

// The one call the phone's account runs: the seller pulls the signed payment and mints the shares.
export const buyCall = (chain: Chain, order: Order, signature: Hex) => ({ to: chain.seller, value: '0',
  data: encodeFunctionData({ abi: chain.sellerKind === 'index' ? indexSellerAbi : stockSellerAbi, functionName: 'buy', args: [order, signature] }) });
