import { describe, expect, it } from 'vitest';
import type { Entry } from '../../mobile/lib/log.js';
import { askLine, ring, shareLine } from '../../mobile/lib/ring.js';

const TX = `0x${'ab'.repeat(32)}`;
const decision = (extra: object) => ({ at: 1, merchant: 'Careem', amount: '20 AED', model: 'm', company: null, explanation: 'x', seconds: 1, ...extra }) as unknown as Entry;
const order = (extra: object, rest: object = {}) => ({ at: 1, merchant: 'AirPods 4', model: 'Nest demo shop',
  order: { state: 'paying', productId: 'p', title: 'AirPods 4', amount: '116810000', priceAed: '429', source: 'recorded', ...extra }, ...rest }) as unknown as Entry;
const bought = { state: 'bought', confirmed: true, value: '4', transaction: TX };
const listed = { state: 'done', operator: 'Careem', listedParent: 'Uber', fee: '0.01' };
const ASKED = 'Invest 4.00 USD₮0 into Careem';

describe('askLine and shareLine: what Confirm will do, before it is tapped', () => {
  it('asks with the amount the share invests', () => {
    expect(askLine('Careem', 4_000_000n)).toBe('Invest 4.00 USD₮0 into Careem?');
    expect(askLine('Careem', null)).toBe('Note this payment at Careem?');
  });

  it('shows the share, so a share left at 88% is caught before Confirm', () => {
    expect(shareLine({ share: 20 }, '20 AED')).toBe('20 AED · 20% share');
    expect(shareLine({ share: 88 }, '20 AED')).toBe('20 AED · 88% share');
  });

  it('says when the max per buy cuts the amount, and when nothing will be bought', () => {
    expect(shareLine({ share: 50, maxBuy: '5000000' }, '20 AED')).toBe('20 AED · 50% share, cut to the 5.00 max per buy');
    expect(shareLine({ share: 10, maxBuy: '5000000' }, '20 AED')).toBe('20 AED · 10% share');
    expect(shareLine({ share: 0 }, '20 AED')).toBe('20 AED · investing is off, nothing will be bought');
    expect(shareLine({ share: 20 }, 'twenty')).toBe('twenty · the amount is unreadable, nothing will be bought');
  });
});

describe('ring: the confirmed message while the payment runs, and how it ends', () => {
  it('spins until the entry exists, and while any step is running', () => {
    expect(ring(undefined, ASKED)).toEqual({ state: 'running', text: ASKED });
    expect(ring(decision({}), ASKED).state).toBe('running');
    expect(ring(decision({ lookup: listed, pay: { state: 'mining', value: '4' } }), ASKED).state).toBe('running');
  });

  it('ends in the buy, named by the company it went to', () => {
    expect(ring(decision({ lookup: listed, pay: bought }), ASKED)).toEqual({ state: 'done', text: 'Bought 4.00 of Uber' });
  });

  it('a payment that buys nothing ends plainly, with no retry', () => {
    expect(ring(decision({ lookup: { ...listed, listedParent: null }, pay: { state: 'signing', error: 'Nothing bought: not a listed company' } }), ASKED))
      .toEqual({ state: 'ended', text: 'Nothing bought: not a listed company' });
    expect(ring(decision({ lookup: { state: 'paying', error: 'Not looked up: nothing to invest' } }), ASKED))
      .toEqual({ state: 'ended', text: 'Not looked up: nothing to invest' });
  });

  it('a failed buy retries only the buy, since the lookup was already paid', () => {
    expect(ring(decision({ lookup: listed, pay: { state: 'sending', value: '4', error: 'PAYMASTER_ERROR' } }), ASKED))
      .toEqual({ state: 'failed', text: ASKED, reason: 'PAYMASTER_ERROR', retry: 'buy' });
    expect(ring(decision({ company: 'Apple', pay: { ...bought, confirmed: false } }), ASKED))
      .toEqual({ state: 'failed', text: ASKED, reason: 'The buy failed on Sepolia', retry: 'buy' });
  });

  it('a failed lookup or model retries the whole decision, unless a fee may already have been paid', () => {
    expect(ring(decision({ lookup: { state: 'paying', error: 'Lookup unavailable: could not resolve agent #11438' } }), ASKED))
      .toEqual({ state: 'failed', text: ASKED, reason: 'Lookup unavailable: could not resolve agent #11438', retry: 'decide' });
    expect(ring(decision({ lookup: { state: 'paying', error: 'Lookup interrupted, a fee may have been paid' } }), ASKED))
      .toMatchObject({ state: 'failed', retry: null });
    expect(ring({ at: 1, merchant: 'Careem', model: 'm', error: 'model failed' } as Entry, ASKED))
      .toEqual({ state: 'failed', text: ASKED, reason: 'model failed', retry: 'decide' });
  });

  it('an order runs through its payment and its invest', () => {
    const ORDERED = 'Buy AirPods 4 · 116.81 USD₮0';
    const target = { company: 'Apple', reason: 'owner', of: 'Apple' };
    expect(ring(order({}), ORDERED).state).toBe('running');
    expect(ring(order({ state: 'done' }, { invest: target }), ORDERED).state).toBe('running');
    expect(ring(order({ state: 'done' }, { invest: target, pay: { ...bought, value: '23.36' } }), ORDERED))
      .toEqual({ state: 'done', text: 'Ordered AirPods 4 · invested 23.36 in Apple' });
    expect(ring(order({ state: 'done' }, { invest: target, pay: { state: 'signing', error: 'Nothing bought: investing is set to 0%' } }), ORDERED))
      .toEqual({ state: 'ended', text: 'Ordered AirPods 4 · nothing invested' });
    expect(ring(order({ state: 'done' }, { invest: target, pay: { state: 'sending', error: 'PAYMASTER_ERROR' } }), ORDERED))
      .toEqual({ state: 'failed', text: 'Ordered AirPods 4', reason: 'Investing in Apple failed: PAYMASTER_ERROR', retry: 'buy' });
    expect(ring(order({ error: 'That price expired, get a new quote' }), ORDERED))
      .toEqual({ state: 'failed', text: ORDERED, reason: 'That price expired, get a new quote', retry: 'order' });
  });
});
