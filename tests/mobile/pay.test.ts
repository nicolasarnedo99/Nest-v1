import { describe, expect, it } from 'vitest';
import { checkOrder } from '../../mobile/lib/pay.js';

const chain = { chainId: 11155111, token: '0xc48485c9fe7f3c83cd1fef03835abc9749a7087f', seller: '0x482c123af705c74cea6e5e4a0e258e8ee64a6b7d', tokenName: 'Test USDT0 copy (Turtle demo)' };
const me = '0x2222222222222222222222222222222222222222';
const typed = () => ({ primaryType: 'ReceiveWithAuthorization',
  domain: { name: chain.tokenName, version: '1', chainId: 11155111, verifyingContract: chain.token },
  message: { from: me, to: chain.seller, value: '500000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: `0x${'ab'.repeat(32)}` } });
const expected = { buyer: me, value: 500000n, chain, nowSeconds: Math.floor(Date.now() / 1000) };

describe('checkOrder: the phone signs only what it asked for', () => {
  it('accepts the order it asked for', () => { expect(() => checkOrder(typed(), expected)).not.toThrow(); });
  it('accepts addresses in any letter case', () => {
    const t = typed(); t.message.to = chain.seller.toUpperCase().replace('0X', '0x'); expect(() => checkOrder(t, expected)).not.toThrow();
  });
  it('refuses a different payee', () => { const t = typed(); t.message.to = me; expect(() => checkOrder(t, expected)).toThrow(); });
  it('refuses a larger amount', () => { const t = typed(); t.message.value = '900000'; expect(() => checkOrder(t, expected)).toThrow(); });
  it('refuses another token or chain', () => {
    const t = typed(); t.domain.verifyingContract = me; expect(() => checkOrder(t, expected)).toThrow();
    const u = typed(); u.domain.chainId = 1; expect(() => checkOrder(u, expected)).toThrow();
  });
  it('refuses a payer other than this wallet', () => { const t = typed(); t.message.from = chain.seller; expect(() => checkOrder(t, expected)).toThrow(); });
  it('refuses a signature that stays valid for over 15 minutes', () => {
    const t = typed(); t.message.validBefore = String(expected.nowSeconds + 3600); expect(() => checkOrder(t, expected)).toThrow();
  });
});
