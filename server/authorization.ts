import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from 'viem';

// The order a buyer agrees to. It mirrors StockSeller.Order in the contract.
export type Order = {
  company: number; orderId: Hex; buyer: Address; value: bigint; validAfter: bigint; validBefore: bigint;
};
export type TokenDomain = { name: string; chainId: number; token: Address };

// Thrown when a signature does not match its order: a refusal, not an outage.
export class SignatureRejected extends Error {}

// One event buys at most once: the order id is derived from the event id.
export const orderIdFor = (eventId: string): Hex => keccak256(stringToHex(eventId));

// Must equal StockSeller.orderNonce: keccak256(abi.encode(uint8 company, bytes32 orderId)).
export const orderNonce = (company: number, orderId: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [company, orderId]));

// EIP-3009 "receive with authorization" as EIP-712 typed data. Signing this
// lets `seller`, and only `seller`, pull `value` from the buyer once, inside
// the validity window. The nonce ties the signature to one company and order.
export function receiveAuthorization(domain: TokenDomain, seller: Address, order: Order) {
  return {
    domain: { name: domain.name, version: '1', chainId: domain.chainId, verifyingContract: domain.token },
    types: { ReceiveWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    primaryType: 'ReceiveWithAuthorization' as const,
    message: { from: order.buyer, to: seller, value: order.value, validAfter: order.validAfter,
      validBefore: order.validBefore, nonce: orderNonce(order.company, order.orderId) },
  };
}
