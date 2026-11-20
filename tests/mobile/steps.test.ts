import { describe, expect, it } from 'vitest';
import type { Entry, InvestTarget, Order, Pay } from '../../mobile/lib/log.js';
import { orderTimeline, paySteps, steps, timeline, wouldPayLine } from '../../mobile/lib/steps.js';

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
    expect(states(shop({ ...asked, error: 'Refused to pay: amount' }))).toEqual(['done', 'failed', 'skipped']);
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

describe('timeline: the entry sheet story, one headline and one muted detail per step', () => {
  const TX = `0x${'cd'.repeat(32)}`;
  const LOOKUP_TX = `0x${'ef'.repeat(32)}`;
  const t = (extra: object) => timeline(e(extra) as Parameters<typeof timeline>[0]);
  const keys = (extra: object) => t(extra).map(step => step.key);
  const bought = { state: 'bought', confirmed: true, value: '4', transaction: TX };

  it('a company found on the phone is two steps: decide, then buy', () => {
    const [decide, buy] = t({ company: 'Starbucks', seconds: 0.31, pay: bought });
    expect(t({ company: 'Starbucks', pay: bought })).toHaveLength(2);
    expect(decide).toEqual({ key: 'decide', state: 'done', title: 'Starbucks', detail: '“x” · 0.31 s · Qwen3 1.7B, fine-tuned' });
    expect(buy).toEqual({ key: 'buy', state: 'done', title: 'Bought 4.00 of Starbucks', detail: 'signed on this phone · gas paid by the paymaster', transaction: TX });
  });

  it('a brand-table placement says why it bought and where it was matched, with no model quote', () => {
    const [decide] = t({ company: 'Uber', explanation: 'Names Careem', placement: 'picked', seconds: 0.02, pay: bought });
    expect(decide).toEqual({ key: 'decide', state: 'done', title: 'Uber', detail: 'Names Careem · S&P 500 brand table on this phone · 0.02 s' });
  });

  it('the lookup step names where the answer came from, and older entries without it read as demo data', () => {
    const done = { state: 'done', operator: 'Careem (Uber)', listedParent: 'Uber', fee: '0.01', agent: '11438' };
    const detail = (lookup: object) => t({ company: null, lookup, pay: bought }).find(step => step.key === 'lookup')!.detail;
    expect(detail({ ...done, source: 'data provider' })).toBe('agent #11438 · x402 · data provider');
    expect(detail(done)).toBe('agent #11438 · x402 · demo data');
  });

  it('an unlisted merchant tells the whole story: decide, paid lookup, owner, category, buy', () => {
    const steps = t({ lookup: { state: 'done', operator: 'Delivery Hero', listedParent: null, fee: '0.01', agent: '11438', transaction: LOOKUP_TX },
      category: { name: 'Food delivery', leader: 'Uber', score: 0.823 }, pay: bought });
    expect(steps.map(step => step.key)).toEqual(['decide', 'lookup', 'owner', 'category', 'buy']);
    const [decide, lookup, owner, category, buy] = steps;
    expect(decide!.title).toBe('No listed company');
    expect(decide!.detail).toBe('1.00 s · Qwen3 1.7B, fine-tuned'); // the lookup named the operator, so the model's guess is dropped
    expect(lookup).toEqual({ key: 'lookup', state: 'done', title: 'Paid the lookup · 0.01 USD₮0', detail: 'agent #11438 · x402 · demo data', transaction: LOOKUP_TX });
    expect(owner).toEqual({ key: 'owner', state: 'done', title: 'Not a listed company', detail: 'operated by Delivery Hero' });
    expect(category).toEqual({ key: 'category', state: 'done', title: 'Food delivery → its leader, Uber', detail: 'matched on this phone · score 0.82' });
    expect(buy!.title).toBe('Bought 4.00 of Uber');
  });

  it('a listed owner names the owner once, and the buy does not repeat why', () => {
    const steps = t({ lookup: { state: 'done', operator: 'Careem', listedParent: 'Uber', fee: '0.01' }, pay: bought });
    expect(steps.map(step => step.key)).toEqual(['decide', 'lookup', 'owner', 'buy']);
    expect(steps[1]!.detail).toBe('x402 · demo data');
    expect(steps[2]).toEqual({ key: 'owner', state: 'done', title: 'Owned by Uber', detail: 'operated by Careem · S&P 500' });
    expect(steps[3]!.detail).not.toMatch(/owner/);
  });

  it('runs live: the lookup spins with the buy greyed out after it, then the buy spins', () => {
    expect(t({}).map(step => [step.key, step.state])).toEqual([['decide', 'done'], ['lookup', 'active'], ['buy', 'pending']]);
    expect(t({ lookup: { state: 'paying' } })[1]!.title).toBe('Paying the lookup · 0.01 USD₮0');
    expect(t({ company: 'Apple' })[1]).toEqual({ key: 'buy', state: 'active', title: 'Buying Apple', detail: 'about to sign on this phone' });
    expect(t({ company: 'Apple', pay: { state: 'mining', value: '4' } })[1]).toEqual({ key: 'buy', state: 'active', title: 'Buying 4.00 of Apple', detail: 'waiting for Sepolia to include it' });
  });

  it('a failed lookup shows its reason and hides the buy that never ran', () => {
    expect(t({ lookup: { state: 'paying', error: 'Lookup unavailable' } })).toEqual([
      expect.objectContaining({ key: 'decide' }),
      { key: 'lookup', state: 'failed', title: 'Lookup unavailable', detail: 'x402 · demo data' },
    ]);
    expect(keys({ lookup: { state: 'paying', error: 'Not looked up: nothing to invest' } })).toEqual(['decide', 'lookup']);
    expect(t({ lookup: { state: 'paying', error: 'Not looked up: nothing to invest' } })[1]!.state).toBe('skipped');
  });

  it('says honestly when nothing was bought, the buy failed, or Sepolia reverted it', () => {
    const owner = { lookup: { state: 'done', operator: 'X', listedParent: null, fee: '0.01' } };
    expect(t({ ...owner, pay: { state: 'signing', error: 'Nothing bought: not a listed company' } }).at(-1)).toEqual(
      { key: 'buy', state: 'skipped', title: 'Nothing bought: not a listed company', detail: '' });
    expect(t({ company: 'Apple', pay: { state: 'sending', error: 'PAYMASTER_ERROR' } }).at(-1)).toEqual(
      { key: 'buy', state: 'failed', title: 'Buying Apple failed', detail: 'PAYMASTER_ERROR' });
    expect(t({ company: 'Apple', pay: { ...bought, confirmed: false } }).at(-1)).toEqual(
      { key: 'buy', state: 'failed', title: 'The buy failed on Sepolia', detail: 'Apple · reverted', transaction: TX });
  });

  it('a model that failed is one failed step', () => {
    expect(timeline({ ...base, error: 'model failed' } as unknown as Parameters<typeof timeline>[0])).toEqual([
      { key: 'decide', state: 'failed', title: 'model failed', detail: 'Qwen3 1.7B, fine-tuned' }]);
  });
});

describe('orderTimeline: an order in the entry sheet, found → paid → invested', () => {
  const TX = `0x${'ab'.repeat(32)}`;
  const bitrefill = (extra: object = {}) => ({ seller: 'bitrefill', state: 'done', productId: 'ocean-basket', title: 'Ocean Basket', packageValue: '1 ZAR',
    priceUsd: '0.07', amount: '70000', checkedAt: '2026-11-20T21:35:00Z', agent: '11442', transaction: TX,
    wouldPay: { network: 'eip155:42161', seller: 'Bitrefill', payTo: '0x480C000000000000000000000000000000846A' }, ...extra }) as unknown as Order;
  it('says what was found and paid in two headlines, with the transaction on the paid step', () => {
    expect(orderTimeline({ order: bitrefill() })).toEqual([
      { key: 'found', state: 'done', title: 'Found on Bitrefill', detail: '1 ZAR · 0.07 USD, checked 2026-11-20' },
      { key: 'paid', state: 'done', title: 'Paid 0.07 USD₮0', detail: 'x402 · agent #11442 · signed on this phone', transaction: TX },
    ]);
  });
  it('shows a failed order as its error, and an unsettled one as paying', () => {
    expect(orderTimeline({ order: bitrefill({ state: 'paying', error: 'Order unavailable' }) })[1]).toMatchObject({ state: 'failed', title: 'Order unavailable' });
    expect(orderTimeline({ order: bitrefill({ state: 'paying', signed: true, transaction: undefined }) })[1])
      .toEqual({ key: 'paid', state: 'active', title: 'Paying 0.07 USD₮0', detail: "signed, waiting for the seller's settlement" });
  });
  it('adds the invest as its own step', () => {
    const steps = orderTimeline({ order: bitrefill(), invest: { company: 'Apple', reason: 'leader', of: 'Phones and computers' },
      pay: { state: 'bought', value: '0.10', confirmed: true, transaction: TX } as Pay });
    expect(steps[2]).toMatchObject({ key: 'invested', state: 'done', title: 'Invested 0.10 in Apple (leader of Phones and computers)', detail: 'gasless buy' });
  });
});
