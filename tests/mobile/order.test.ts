import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { orderIdFor, orderNonce, receiveAuthorization } from '../../server/authorization.js';
import { buildOrder, buyCall, onSeller } from '../../mobile/lib/order.js';
import config from '../../mobile/turtle.config.json';
import { checkOrder } from '../../mobile/lib/pay.js';

const BUY = 'function buy(Order order, bytes signature) returns (uint256 shares)';
const ABIS = {
  8: parseAbi(['struct Order { uint8 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }', BUY]),
  16: parseAbi(['struct Order { uint16 company; bytes32 orderId; address buyer; uint256 value; uint256 validAfter; uint256 validBefore; }', BUY]) };
const buyAbi = (bits: 8 | 16) => ABIS[bits];
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
    expect(decodeFunctionData({ abi: buyAbi(8), data: call.data }).args).toEqual([order, signature]);
  });

  it('calls the index seller with its uint16 order once the config names it', () => {
    const { order } = built();
    const call = buyCall({ ...chain, sellerKind: 'index' }, order, `0x${'11'.repeat(65)}`);
    expect(decodeFunctionData({ abi: buyAbi(16), data: call.data }).args[0]).toEqual(order);
    // The selector is what differs: the stock seller has no buy for a uint16 order.
    expect(() => decodeFunctionData({ abi: buyAbi(8), data: call.data })).toThrow();
  });
});

describe('company ids past 255 (the index seller)', () => {
  const indexChain = { ...chain, sellerKind: 'index' };
  const order300 = () => buildOrder({ chain: indexChain, buyer, company: 300, eventId: 'phone-1-2', value: 500000n, nowSeconds: now });

  it('signs the nonce IndexSeller.orderNonce computes: keccak256(abi.encode(uint16, bytes32))', () => {
    const orderId = orderIdFor('phone-1-2');
    expect(order300().typed.message.nonce).toBe(keccak256(encodeAbiParameters([{ type: 'uint16' }, { type: 'bytes32' }], [300, orderId])));
    // 300 and 44 share their low byte: a uint8 truncation would sign one company and buy the other.
    expect(order300().typed.message.nonce).not.toBe(orderNonce(44, orderId));
  });

  it('keeps the stock seller\'s nonce for ids below 256', () => {
    expect(orderNonce(3, orderIdFor('x'))).toBe(keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [3, orderIdFor('x')])));
  });

  it('encodes the full id in the buy call', () => {
    const { order } = order300();
    const decoded = decodeFunctionData({ abi: buyAbi(16), data: buyCall(indexChain, order, `0x${'11'.repeat(65)}`).data });
    expect(decoded.args[0].company).toBe(300);
  });
});

describe('onSeller: a company to its id on the seller, by ticker', () => {
  const stock = { tickers: config.tickers, stocks: config.stocks };
  it('maps the brand table\'s name to the seller\'s by ticker, and the id is the seller\'s position', () => {
    expect(onSeller({ ticker: 'AAPL', name: 'Apple Inc.' }, stock)).toEqual({ name: 'Apple', id: config.stocks.indexOf('Apple') });
    expect(onSeller({ ticker: 'UBER', name: 'Uber Technologies' }, stock)).toEqual({ name: 'Uber', id: config.stocks.indexOf('Uber') });
  });
  it('buys nothing, and says so, for a company the seller does not list, never another company', () => {
    // The stock seller's nine, fixed: the live config lists the whole index once the index seller is deployed.
    const nine = { tickers: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'WMT', 'UBER', 'SBUX'],
      stocks: ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA', 'Amazon', 'Walmart', 'Uber', 'Starbucks'] };
    expect(onSeller({ ticker: 'COST', name: 'Costco' }, nine)).toEqual({ error: 'Nothing bought: Costco (COST) is not listed on the seller yet' });
    expect(onSeller({ ticker: 'GOOG', name: 'Alphabet Inc. (Class C)' }, stock)).toHaveProperty('error'); // one row per company: GOOGL only
  });
  it('lists every seller company under a ticker, one per id', () => {
    expect(config.tickers).toHaveLength(config.stocks.length);
    expect(new Set(config.tickers).size).toBe(config.tickers.length);
  });
});
