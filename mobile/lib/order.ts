// The phone builds its own order now, with the same order id, nonce and typed
// data the Mac built, so one card tap can still buy only once.
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { orderIdFor, receiveAuthorization, type Order } from '../../server/authorization';
import type { Chain, Typed } from './pay';

const VALIDITY_SECONDS = 600;
const sellerAbi = parseAbi([
  'struct Order { uint8 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }',
  'function buy(Order order, bytes signature) returns (uint256 shares)',
]);

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
export const buyCall = (chain: Chain, order: Order, signature: Hex) =>
  ({ to: chain.seller, value: '0', data: encodeFunctionData({ abi: sellerAbi, functionName: 'buy', args: [order, signature] }) });
