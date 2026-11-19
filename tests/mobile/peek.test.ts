import { describe, expect, it } from 'vitest';
import { ago, peek } from '../../mobile/lib/peek.js';
import type { Entry } from '../../mobile/lib/log.js';

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const decision = (over: Record<string, unknown>): Entry =>
  ({ at: NOW - 2 * 60_000, merchant: 'Careem', model: 'm', company: null, explanation: 'x', seconds: 1, ...over }) as Entry;
const shopOrder = { state: 'done', productId: 'B0D1', title: 'Apple AirPods 4', amount: '116810000', priceAed: '429.00', source: 'live' };
const order = (over: Record<string, unknown>): Entry =>
  ({ at: NOW - 10_000, merchant: 'Apple AirPods 4', model: 'Nest demo shop', order: shopOrder, ...over }) as Entry;
const apple = { company: 'Apple', reason: 'owner', of: 'Apple' };

describe('peek', () => {
  it('says so when there is nothing yet', () => {
    expect(peek([], NOW)).toBe('Activity · nothing yet');
  });

  it('shows a confirmed buy with what it bought', () => {
    expect(peek([decision({ merchant: 'UBER *TRIP', company: 'Uber', pay: { state: 'bought', value: '1.00', confirmed: true } })], NOW)).toBe('Bought 1.00 of Uber · 2 min ago');
    expect(peek([decision({ merchant: 'GITHUB', lookup: { state: 'done', operator: 'GitHub', listedParent: 'Microsoft', fee: '0.01' }, pay: { state: 'bought', value: '0.45', confirmed: true } })], NOW))
      .toBe('Bought 0.45 of Microsoft · 2 min ago');
  });

  it('shows an order with its price, and the invest after it once that is bought', () => {
    expect(peek([order({})], NOW)).toBe('Demo order · Apple AirPods 4 · 116.81 USD₮0 · just now');
    expect(peek([order({ invest: apple, pay: { state: 'bought', value: '0.12', confirmed: true } })], NOW)).toBe('Demo order · Apple AirPods 4 · invested 0.12 in Apple · just now');
    expect(peek([order({ invest: apple, pay: { state: 'mining', value: '0.12' } })], NOW)).toBe('Demo order · Apple AirPods 4 · 116.81 USD₮0 · just now');
  });

  it('keeps the demo qualifier for a Bitrefill order', () => {
    expect(peek([order({ order: { ...shopOrder, seller: 'bitrefill' } })], NOW)).toBe('Demo purchase · Apple AirPods 4 · 116.81 USD₮0 · just now');
  });

  it('shows an order still being paid', () => {
    expect(peek([order({ order: { ...shopOrder, state: 'paying' } })], NOW)).toBe('Ordering · Apple AirPods 4 · just now');
  });

  it('shows nothing bought, including a lookup that was not run', () => {
    expect(peek([decision({ lookup: { state: 'done', operator: 'Careem', listedParent: null, fee: '0.01' }, pay: { state: 'signing', error: 'Nothing bought: not a listed company' } })], NOW))
      .toBe('Nothing bought · Careem · 2 min ago');
    expect(peek([decision({ lookup: { state: 'paying', error: 'Not looked up: nothing to invest' } })], NOW)).toBe('Nothing bought · Careem · 2 min ago');
  });

  it('shows failures', () => {
    expect(peek([{ at: NOW - 60_000, merchant: 'Careem', model: 'm', error: 'The model returned something that is not a valid decision' } as Entry], NOW)).toBe('Failed · Careem · 1 min ago');
    expect(peek([decision({ company: 'Uber', pay: { state: 'bought', confirmed: false, transaction: '0x1' } })], NOW)).toBe('Failed · Careem · 2 min ago');
    expect(peek([decision({ company: 'Uber', pay: { state: 'sending', error: 'Bundler unreachable' } })], NOW)).toBe('Failed · Careem · 2 min ago');
    expect(peek([order({ order: { ...shopOrder, error: 'Order unavailable: timeout' } })], NOW)).toBe('Failed · Apple AirPods 4 · just now');
  });

  it('shows the step in progress', () => {
    expect(peek([decision({ lookup: { state: 'paying' } })], NOW)).toBe('Looking up · Careem · 2 min ago');
    expect(peek([decision({ merchant: 'APPLE.COM/BILL', company: 'Apple' })], NOW)).toBe('Buying · APPLE.COM/BILL · 2 min ago');
    expect(peek([decision({ merchant: 'APPLE.COM/BILL', company: 'Apple', pay: { state: 'mining' } })], NOW)).toBe('Buying · APPLE.COM/BILL · 2 min ago');
  });

  it('reads the newest entry whatever the list order', () => {
    const old = decision({ at: NOW - 3 * 3_600_000, company: 'Uber', pay: { state: 'bought', value: '1.00', confirmed: true } });
    const fresh = order({});
    expect(peek([old, fresh], NOW)).toBe('Demo order · Apple AirPods 4 · 116.81 USD₮0 · just now');
    expect(peek([fresh, old], NOW)).toBe('Demo order · Apple AirPods 4 · 116.81 USD₮0 · just now');
  });
});

describe('ago', () => {
  it('buckets the time since an entry', () => {
    expect(ago(NOW, NOW)).toBe('just now');
    expect(ago(NOW - 59_000, NOW)).toBe('just now');
    expect(ago(NOW - 60_000, NOW)).toBe('1 min ago');
    expect(ago(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
    expect(ago(NOW - 3_600_000, NOW)).toBe('1 h ago');
    expect(ago(NOW - 23 * 3_600_000 - 59 * 60_000, NOW)).toBe('23 h ago');
    expect(ago(NOW - 3 * 86_400_000, NOW)).toBe('17 Nov');
  });
  it('reads a time just after now, from a clock step, as just now', () => {
    expect(ago(NOW + 5_000, NOW)).toBe('just now');
  });
});
