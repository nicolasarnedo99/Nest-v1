import { describe, expect, it } from 'vitest';
import type { Entry, InvestTarget, Order, Pay } from '../../mobile/lib/log.js';
import { paySteps, steps, wouldPayLine } from '../../mobile/lib/steps.js';

const base = { at: 1, merchant: 'CARREFOUR UAE', amount: '8,00', model: 'Qwen3 1.7B, fine-tuned', explanation: 'x', seconds: 1 };
const e = (extra: object) => ({ ...base, company: null, ...extra }) as unknown as Entry;
const done = { state: 'done', operator: 'Majid Al Futtaim Retail', listedParent: null, fee: '0.01' };

describe('steps: which step the agent is on', () => {
  it('a listed company skips the lookup and goes straight to buying', () => {
    expect(steps(e({ company: 'Apple' }))).toEqual({ decide: 'done', lookup: 'skipped', buy: 'active' });
    expect(steps(e({ company: 'Apple', pay: { state: 'mining' } }))).toEqual({ decide: 'done', lookup: 'skipped', buy: 'active' });
    expect(steps(e({ company: 'Apple', pay: { state: 'bought', confirmed: true } }))).toEqual({ decide: 'done', lookup: 'skipped', buy: 'done' });
  });

  it('none: looking up, then matching a category and buying, then bought', () => {
    expect(steps(e({}))).toEqual({ decide: 'done', lookup: 'active', buy: 'pending' });
    expect(steps(e({ lookup: { state: 'paying' } }))).toEqual({ decide: 'done', lookup: 'active', buy: 'pending' });
    expect(steps(e({ lookup: done }))).toEqual({ decide: 'done', lookup: 'done', buy: 'active' });
    expect(steps(e({ lookup: done, pay: { state: 'bought', confirmed: true } }))).toEqual({ decide: 'done', lookup: 'done', buy: 'done' });
  });

  it('shows failures and steps that did not apply', () => {
    expect(steps(e({ lookup: { state: 'paying', error: 'Lookup unavailable' } }))).toEqual({ decide: 'done', lookup: 'failed', buy: 'skipped' });
    expect(steps(e({ lookup: { state: 'paying', error: 'Not looked up: nothing to invest' } }))).toEqual({ decide: 'done', lookup: 'skipped', buy: 'skipped' });
    expect(steps(e({ lookup: done, pay: { state: 'signing', error: 'Nothing bought: not a listed company' } }))).toEqual({ decide: 'done', lookup: 'done', buy: 'skipped' });
    expect(steps(e({ company: 'Apple', pay: { state: 'sending', error: 'cap' } })).buy).toBe('failed');
    expect(steps(e({ company: 'Apple', pay: { state: 'bought', confirmed: false } })).buy).toBe('failed');
    expect(steps({ ...base, error: 'model failed' } as unknown as Entry)).toEqual({ decide: 'failed', lookup: 'skipped', buy: 'skipped' });
  });
});

describe('paySteps: the x402 exchange of an order, step by step', () => {
  const PAY_TO = '0x1111111111111111111111111111111111112222';
  const TX = `0x${'ab'.repeat(32)}`;
  const shop = (extra: object = {}) => ({ state: 'paying', productId: 'p1', title: 'AirPods', priceAed: '999.00', amount: '272000000', source: 'recorded', ...extra }) as unknown as Order;
  const asked = { payTo: PAY_TO, scheme: 'exact', network: 'eip155:11155111' };
  const states = (order: Order) => paySteps(order).map(step => step.state);

  it('names the 402 the seller sent, with the real amount, payTo, network and scheme', () => {
    expect(paySteps(shop(asked))[0]).toEqual({ key: 'asked', state: 'done',
      text: 'Asked the Nest demo shop → 402 Payment Required: 272.00 USD₮0 to 0x1111…2222 on Sepolia (scheme exact)' });
    expect(paySteps(shop({ ...asked, network: 'eip155:1' }))[0].text).toContain('on eip155:1 (scheme exact)'); // an unknown network is shown as is
  });

  it('moves from asking, to signing, to settling, to settled with the transaction', () => {
    expect(states(shop())).toEqual(['active', 'pending', 'pending']);
    expect(paySteps(shop())[0].text).toBe('Asking the Nest demo shop…');
    expect(paySteps(shop()).slice(1).map(step => step.text)).toEqual(['Sign an EIP-3009 authorisation on this phone', "Settlement by the seller's facilitator"]);
    expect(states(shop(asked))).toEqual(['done', 'active', 'pending']);
    expect(states(shop({ ...asked, signed: true }))).toEqual(['done', 'done', 'active']);
    const settled = paySteps(shop({ ...asked, signed: true, state: 'done', transaction: TX }));
    expect(settled.map(step => step.state)).toEqual(['done', 'done', 'done']);
    expect(settled[1].text).toBe('Signed an EIP-3009 authorisation on this phone');
    expect(settled[2]).toEqual({ key: 'settled', state: 'done', text: "Settled by the seller's facilitator", transaction: TX });
  });

  it('fails the step the order stopped at, and skips the ones after', () => {
    expect(states(shop({ error: 'Refused to pay: payTo' }))).toEqual(['failed', 'skipped', 'skipped']);
    expect(paySteps(shop({ error: 'Order interrupted, it may have been paid, check Etherscan' }))[0].text).toBe('Asked the Nest demo shop → no payment terms recorded');
    expect(states(shop({ ...asked, error: 'Shopping limit reached, not ordered (200 a day)' }))).toEqual(['done', 'failed', 'skipped']);
    expect(states(shop({ ...asked, signed: true, error: 'Order interrupted, it may have been paid, check Etherscan' }))).toEqual(['done', 'done', 'failed']);
  });

  it('shows what an older entry recorded: a finished order was asked and signed, without the terms it did not keep', () => {
    const old = paySteps(shop({ state: 'done', transaction: TX }));
    expect(old.map(step => step.state)).toEqual(['done', 'done', 'done']);
    expect(old[0].text).toBe('Asked the Nest demo shop → 402 Payment Required: 272.00 USD₮0');
  });

  it('names the Sepolia mirror for a Bitrefill purchase', () => {
    const bitrefill = { state: 'paying', seller: 'bitrefill', productId: 'noon', title: 'Noon', packageValue: '10 AED', priceUsd: '2.82', amount: '2820000', wouldPay: {} } as unknown as Order;
    expect(paySteps({ ...bitrefill, ...asked } as Order)[0].text).toBe('Asked the Sepolia mirror → 402 Payment Required: 2.82 USD₮0 to 0x1111…2222 on Sepolia (scheme exact)');
  });
});

describe('paySteps: the invest after an order', () => {
  const TX = `0x${'ab'.repeat(32)}`;
  const BUY = `0x${'cd'.repeat(32)}`;
  const shop = (extra: object = {}) => ({ state: 'done', productId: 'p1', title: 'AirPods', priceAed: '999.00', amount: '272000000', source: 'recorded', signed: true, transaction: TX, ...extra }) as unknown as Order;
  const owner = { company: 'Amazon', reason: 'owner', of: 'Amazon.ae' } as const;
  const leader = { company: 'Apple', reason: 'leader', of: 'Phones and computers' } as const;
  const invest = (order: Order, target = owner as InvestTarget, pay?: Pay) => paySteps(order, target, pay)[3];

  it('has no invest step without a target, as in older entries', () => {
    expect(paySteps(shop()).map(step => step.key)).toEqual(['asked', 'signed', 'settled']);
  });

  it('comes after settled, and names the company and why: owner or category leader', () => {
    expect(paySteps(shop(), owner).map(step => step.key)).toEqual(['asked', 'signed', 'settled', 'invested']);
    expect(invest(shop())).toEqual({ key: 'invested', state: 'active', text: 'Investing in Amazon (owner of Amazon.ae)…' });
    expect(invest(shop(), owner, { state: 'mining', value: '1' })).toEqual({ key: 'invested', state: 'active', text: 'Investing 1.00 in Amazon (owner of Amazon.ae) · gasless buy…' });
    expect(invest(shop(), leader, { state: 'bought', value: '0.5', transaction: BUY, confirmed: true }))
      .toEqual({ key: 'invested', state: 'done', text: 'Invested 0.50 in Apple (leader of Phones and computers) · gasless buy', transaction: BUY });
  });

  it('names the company once when the brand is the company', () => {
    const apple = { company: 'Apple', reason: 'owner', of: 'Apple' } as const;
    expect(invest(shop(), apple, { state: 'bought', value: '1', transaction: BUY, confirmed: true }).text).toBe('Invested 1.00 in Apple · gasless buy');
  });

  it('waits for the order, and is skipped when the order fails', () => {
    expect(invest(shop({ state: 'paying', transaction: undefined }))).toMatchObject({ state: 'pending' });
    expect(invest(shop({ state: 'paying', error: 'Declined' }))).toMatchObject({ state: 'skipped' });
  });

  it('says honestly when nothing was bought or the buy failed', () => {
    expect(invest(shop(), owner, { state: 'signing', error: 'Nothing bought: investing is set to 0%' }))
      .toEqual({ key: 'invested', state: 'skipped', text: 'Nothing bought: investing is set to 0%' });
    expect(invest(shop(), owner, { state: 'sending', value: '1', error: 'bundler down' }))
      .toEqual({ key: 'invested', state: 'failed', text: 'Invest in Amazon (owner of Amazon.ae) failed: bundler down' });
    expect(invest(shop(), owner, { state: 'bought', value: '1', transaction: BUY, confirmed: false }))
      .toEqual({ key: 'invested', state: 'failed', text: 'Invest in Amazon (owner of Amazon.ae) failed on Sepolia', transaction: BUY });
  });
});

describe('wouldPayLine', () => {
  it('says where Bitrefill would be paid on Arbitrum, never that it was', () => {
    expect(wouldPayLine({ seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0xFd08', payTo: '0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A', amount: '2820000' }))
      .toBe('On Arbitrum this would be paid to Bitrefill (0x480C…846A) in USD₮0');
  });
});
