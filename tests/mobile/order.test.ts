import { describe, expect, it } from 'vitest';
import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { orderIdFor, orderNonce, receiveAuthorization } from '../../server/authorization.js';
import { buildOrder, buyCall } from '../../mobile/lib/order.js';
import { checkOrder } from '../../mobile/lib/pay.js';

const chain = { chainId: 11155111, token: '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f', seller: '0x482c123af705c74cea6e5e4a0e258e8ee64a6b7d', tokenName: 'Test USDT0 copy (Turtle demo)' };
const buyer = '0x7Da92992e6F318D838D7d84C4ebF328969491Ffd';
const now = 1_800_000_000;
const built = () => buildOrder({ chain, buyer, company: 3, eventId: 'phone-1-2', value: 500000n, nowSeconds: now });

describe('buildOrder: the phone builds the order the Mac used to build', () => {
  it('signs the same typed data and nonce as server/authorization.ts', () => {
    const { order, typed } = built();
    expect(order).toEqual({ company: 3, orderId: orderIdFor('phone-1-2'), buyer, value: 500000n, validAfter: 0n, validBefore: BigInt(now + 600) });
    const server = receiveAuthorization({ name: chain.tokenName, chainId: chain.chainId, token: chain.token as Address }, chain.seller as Address, order);
    expect(typed.domain).toEqual(server.domain);
    expect(typed.types).toEqual(server.types);
    expect(typed.primaryType).toBe(server.primaryType);
    // Strings, not bigints: the typed data crosses into the wallet's worklet as JSON.
    expect(typed.message).toEqual({ ...server.message, value: '500000', validAfter: '0', validBefore: String(now + 600) });
    expect(typed.message.nonce).toBe(orderNonce(3, orderIdFor('phone-1-2')));
  });

  it('builds an order the phone\'s own check accepts', () => {
    expect(() => checkOrder(built().typed, { buyer, value: 500000n, chain, nowSeconds: now })).not.toThrow();
  });

  it('gives one card tap one order id, so it can only buy once', () => {
    expect(built().order.orderId).toBe(built().order.orderId);
    expect(buildOrder({ chain, buyer, company: 3, eventId: 'phone-1-3', value: 500000n, nowSeconds: now }).order.orderId).not.toBe(built().order.orderId);
  });
});

describe('buyCall: the one call the phone sends', () => {
  it('calls the seller with buy(order, signature) and no ETH', () => {
    const { order } = built();
    const signature: Hex = `0x${'11'.repeat(65)}`;
    const call = buyCall(chain, order, signature);
    expect(call.to).toBe(chain.seller);
    expect(call.value).toBe('0');
    const decoded = decodeFunctionData({ abi: parseAbi([
      'struct Order { uint8 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }',
      'function buy(Order order, bytes signature) returns (uint256 shares)']), data: call.data });
    expect(decoded.functionName).toBe('buy');
    expect(decoded.args).toEqual([order, signature]);
  });
});
