import { describe, expect, it } from 'vitest';
import { donutArcs, portfolio, shareLabel } from '../../mobile/lib/portfolio.js';
import type { Entry } from '../../mobile/lib/log.js';

let at = 0;
const bought = (value: string) => ({ state: 'bought', value, confirmed: true, transaction: '0x1' });
const decision = (over: Record<string, unknown>): Entry =>
  ({ at: at++, merchant: 'M', model: 'm', company: null, explanation: 'x', seconds: 1, ...over }) as Entry;
const shopOrder = { state: 'done', productId: 'B0D1', title: 'Apple AirPods 4', amount: '116810000', priceAed: '429.00', source: 'live' };
const order = (over: Record<string, unknown>): Entry =>
  ({ at: at++, merchant: 'Apple AirPods 4', model: 'Nest demo shop', order: shopOrder, ...over }) as Entry;
const apple = { company: 'Apple', reason: 'owner', of: 'Apple' };

describe('portfolio', () => {
  it('is empty with nothing bought', () => {
    expect(portfolio([])).toEqual({ total: 0n, slices: [] });
  });

  it('counts card decisions and order invests under the company each buy went to, largest first', () => {
    const list = [
      decision({ company: 'Apple', pay: bought('0.50') }),
      decision({ lookup: { state: 'done', operator: 'GitHub', listedParent: 'Microsoft', fee: '0.01' }, pay: bought('0.25') }),
      decision({ lookup: { state: 'done', operator: 'Carrefour', listedParent: null, fee: '0.01' }, category: { name: 'Groceries', leader: 'Walmart', score: 0.61 }, pay: bought('0.10') }),
      order({ invest: apple, pay: bought('0.15') }),
    ];
    expect(portfolio(list)).toEqual({ total: 1_000_000n, slices: [
      { company: 'Apple', invested: 650_000n, share: 65 },
      { company: 'Microsoft', invested: 250_000n, share: 25 },
      { company: 'Walmart', invested: 100_000n, share: 10 },
    ] });
  });

  it('leaves out lookup fees and buys that were unconfirmed, failed, still mining or never made', () => {
    const list = [
      decision({ company: 'Tesla', pay: bought('0.40') }),
      decision({ lookup: { state: 'done', operator: 'Careem', listedParent: null, fee: '0.01', transaction: '0xfee' }, pay: { state: 'signing', error: 'Nothing bought: not a listed company' } }),
      decision({ company: 'Apple', pay: { state: 'bought', value: '0.30', confirmed: false, transaction: '0x2' } }),
      decision({ company: 'Apple', pay: { state: 'sending', value: '0.30', error: 'Bundler unreachable' } }),
      decision({ company: 'Apple', pay: { state: 'mining', value: '0.30' } }),
      order({}),
      order({ invest: apple, pay: { state: 'signing', error: 'Nothing bought: investing is set to 0%' } }),
      { at: at++, merchant: 'X', model: 'm', error: 'bad' } as Entry,
    ];
    expect(portfolio(list)).toEqual({ total: 400_000n, slices: [{ company: 'Tesla', invested: 400_000n, share: 100 }] });
  });

  it('leaves out an old buy with no recorded amount, since it has no size to draw', () => {
    const list = [decision({ company: 'Tesla', pay: { state: 'bought', confirmed: true } }), decision({ company: 'Apple', pay: bought('0.10') })];
    expect(portfolio(list).slices).toEqual([{ company: 'Apple', invested: 100_000n, share: 100 }]);
  });

  it('rounds shares to whole percents that add up to 100, largest remainder first', () => {
    // 51.5 / 30.9 / 17.5: rounding each would give 52 + 31 + 18 = 101.
    const uneven = portfolio([decision({ company: 'Apple', pay: bought('0.50') }), decision({ company: 'Tesla', pay: bought('0.30') }), decision({ company: 'NVIDIA', pay: bought('0.17') })]);
    expect(uneven.slices.map(s => [s.company, s.share])).toEqual([['Apple', 52], ['Tesla', 31], ['NVIDIA', 17]]);
    const thirds = portfolio(['Apple', 'NVIDIA', 'Tesla'].map(company => decision({ company, pay: bought('0.10') })));
    expect(thirds.slices.map(s => s.share)).toEqual([34, 33, 33]);
  });
});

describe('shareLabel', () => {
  it('shows a slice that rounds to 0% as <1%, never 0%', () => {
    const tiny = portfolio([decision({ company: 'Apple', pay: bought('50.00') }), decision({ company: 'Tesla', pay: bought('0.10') })]);
    expect(tiny.slices.reduce((n, s) => n + s.share, 0)).toBe(100);
    expect(tiny.slices.map(s => shareLabel(s.share))).toEqual(['100%', '<1%']);
    expect(shareLabel(7)).toBe('7%');
  });
});

describe('donutArcs', () => {
  it('lays slices end to end with a gap between them', () => {
    expect(donutArcs([50, 50], 100, 2)).toEqual([{ length: 48, offset: 0 }, { length: 48, offset: 50 }]);
  });
  it('draws a single slice as a full ring, with no gap', () => {
    expect(donutArcs([100], 100, 2)).toEqual([{ length: 100, offset: 0 }]);
  });
  it('never draws a negative length', () => {
    expect(donutArcs([99, 1, 0], 100, 2)).toEqual([{ length: 97, offset: 0 }, { length: 0, offset: 99 }, { length: 0, offset: 100 }]);
  });
});
