import { describe, expect, it } from 'vitest';
import { boughtCompany, holdings, money, summarise } from '../../mobile/lib/holdings.js';
import type { Entry } from '../../mobile/lib/log.js';

const decision = (over: Partial<Entry> & Record<string, unknown>): Entry =>
  ({ at: Math.random(), merchant: 'M', model: 'm', company: null, explanation: 'x', seconds: 1, ...over }) as Entry;

describe('holdings', () => {
  it('sums confirmed buys per company, including ones found by a lookup', () => {
    const list = [
      decision({ company: 'Apple', pay: { state: 'bought', value: '0.10', confirmed: true } }),
      decision({ company: 'Apple', pay: { state: 'bought', value: '0.25', confirmed: true } }),
      decision({ lookup: { state: 'done', operator: 'GitHub', listedParent: 'Microsoft', fee: '0.01' }, pay: { state: 'bought', value: '0.45', confirmed: true } }),
    ];
    expect(holdings(list)).toEqual([
      { company: 'Microsoft', invested: 450000n, buys: 1 },
      { company: 'Apple', invested: 350000n, buys: 2 },
    ]);
  });
  it('ignores failed, unconfirmed, interrupted and lookup-only entries', () => {
    const list = [
      decision({ company: 'Apple', pay: { state: 'bought', value: '0.10', confirmed: false } }),
      decision({ company: 'Apple', pay: { state: 'sending', value: '0.10', error: 'Interrupted while sending' } }),
      decision({ lookup: { state: 'done', operator: 'Majid Al Futtaim Retail', listedParent: null, fee: '0.01' } }),
      { at: 9, merchant: 'X', model: 'm', error: 'bad' } as Entry,
    ];
    expect(holdings(list)).toEqual([]);
  });
  it('counts an older buy without a recorded value as a buy of unknown size', () => {
    expect(holdings([decision({ company: 'Tesla', pay: { state: 'bought', confirmed: true } })])).toEqual([{ company: 'Tesla', invested: 0n, buys: 1 }]);
  });
});

describe('holdings: bad stored values', () => {
  it('counts the buy and adds nothing instead of throwing', () => {
    expect(holdings([decision({ company: 'Tesla', pay: { state: 'bought', value: 'abc', confirmed: true } })])).toEqual([{ company: 'Tesla', invested: 0n, buys: 1 }]);
  });
});

describe('money', () => {
  it('shows micro-units with at least two decimals and never drops precision', () => {
    expect([500000n, 1230000n, 10000n, 1234567n, 5000000n].map(money)).toEqual(['0.50', '1.23', '0.01', '1.234567', '5.00']);
  });
  it('pads a stored one-decimal value in the Bought line, and keeps an unparseable one as stored', () => {
    expect(summarise(decision({ company: 'Apple', pay: { state: 'bought', value: '0.5', confirmed: true } })).line).toBe('Apple · 0.50 invested');
    expect(summarise(decision({ company: 'Apple', pay: { state: 'bought', value: 'abc', confirmed: true } })).line).toBe('Apple · abc invested');
  });
});

describe('summarise', () => {
  it('labels each kind of entry', () => {
    expect(summarise(decision({ company: 'Apple', pay: { state: 'bought', value: '0.10', confirmed: true } }))).toEqual({ pill: 'Bought', line: 'Apple · 0.10 invested', company: 'Apple' });
    expect(summarise(decision({ lookup: { state: 'done', operator: 'Majid Al Futtaim Retail', listedParent: null, fee: '0.01' } }))).toEqual({ pill: 'Looked up', line: 'Majid Al Futtaim Retail · not listed', company: null });
    expect(summarise(decision({ lookup: { state: 'paying', error: 'Daily cap reached, not looked up' } })).pill).toBe('Nothing bought');
    expect(summarise(decision({ company: 'Apple', pay: { state: 'mining' } })).pill).toBe('Working');
    expect(summarise({ at: 1, merchant: 'X', model: 'm', error: 'The model returned something that is not a valid decision' } as Entry).pill).toBe('Error');
    expect(summarise(decision({})).line).toBe('No listed company');
    // App writes this when the strategies give no amount: nothing went wrong, so it is not an error.
    const none = 'Nothing bought: no amount to invest (unreadable or missing amount, a whole amount under round-up, or no strategy on)';
    expect(summarise(decision({ company: 'Apple', pay: { state: 'signing', error: none } }))).toEqual({ pill: 'Nothing bought', line: none, company: 'Apple' });
  });
  it('calls a bought but unconfirmed buy a failure, not progress', () => {
    expect(summarise(decision({ company: 'Apple', pay: { state: 'bought', confirmed: false } }))).toEqual({ pill: 'Error', line: 'The buy failed on Sepolia', company: 'Apple' });
  });
  it('falls back to the merchant when a confirmed buy has no company', () => {
    expect(summarise(decision({ merchant: 'GITHUB', pay: { state: 'bought', value: '0.45', confirmed: true } })).line).toBe('GITHUB · 0.45 invested');
  });
});

describe('demo orders', () => {
  const order = (over: Record<string, unknown> = {}) => ({ at: 1, merchant: 'Sony WH-1000XM5', model: 'Nest demo shop',
    order: { state: 'done', productId: 'p1', title: 'Sony WH-1000XM5', priceAed: '1299.00', amount: '353700000', source: 'recorded', ...over } }) as Entry;

  it('reads as Ordered as a demo order with the USD₮0 amount', () => {
    expect(summarise(order())).toEqual({ pill: 'Ordered', line: 'Demo order, not shipped · 353.70 USD₮0', company: null });
    expect(summarise(order({ amount: '5000000' })).line).toBe('Demo order, not shipped · 5.00 USD₮0');
  });
  it('is Working while paying and Error with an error', () => {
    expect(summarise(order({ state: 'paying' })).pill).toBe('Working');
    expect(summarise(order({ state: 'paying', error: 'Order interrupted' }))).toEqual({ pill: 'Error', line: 'Order interrupted', company: null });
    expect(summarise(order({ error: 'Declined' })).pill).toBe('Error');
  });
  it('is not counted in holdings', () => {
    expect(holdings([order()])).toEqual([]);
  });
  it('counts the confirmed invest after it under the company it bought', () => {
    const invested = (pay: object) => ({ ...order(), invest: { company: 'Amazon', reason: 'owner', of: 'Amazon.ae' }, pay }) as Entry;
    expect(holdings([invested({ state: 'bought', value: '1', confirmed: true })])).toEqual([{ company: 'Amazon', invested: 1_000_000n, buys: 1 }]);
    expect(holdings([invested({ state: 'bought', value: '1', confirmed: false }), invested({ state: 'signing', error: 'Nothing bought: investing is set to 0%' })])).toEqual([]);
  });
});

describe('Bitrefill purchases from the Sepolia mirror', () => {
  const entry = { at: 1, merchant: 'Noon.com UAE', model: 'Bitrefill mirror', order: { state: 'done', seller: 'bitrefill', productId: 'noon-uae', title: 'Noon.com UAE',
    packageValue: '10', priceUsd: '2.82', amount: '2820000', wouldPay: { seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0x1', payTo: '0x2', amount: '2820000' } } } as Entry;
  it('read as Ordered, a demo purchase on Sepolia, never as a shipped or issued card', () => {
    expect(summarise(entry)).toEqual({ pill: 'Ordered', line: 'Demo purchase on Sepolia · 2.82 USD₮0', company: null });
    expect(holdings([entry])).toEqual([]);
  });
});

describe('category leader buys', () => {
  it('count toward the leader they bought and are summarised under it', () => {
    const entry = { at: 9, merchant: 'CARREFOUR EXPRESS DUBAI', amount: '8.00', model: 'Qwen3 1.7B, fine-tuned', company: null, explanation: 'Unrelated retail chain', seconds: 1,
      lookup: { state: 'done', operator: 'Majid Al Futtaim Retail', listedParent: null, fee: '0.01' },
      category: { name: 'Groceries', leader: 'Walmart', score: 0.46 }, pay: { state: 'bought', transaction: '0xabc', confirmed: true, value: '0.8' } } as unknown as Entry;
    expect(holdings([entry]).map(h => h.company)).toEqual(['Walmart']);
    expect(summarise(entry).company).toBe('Walmart');
  });
});

describe('boughtCompany', () => {
  const bought = { state: 'bought', value: '0.10', confirmed: true } as const;
  const shopOrder = { state: 'done', productId: 'B0D1', title: 'Apple AirPods 4', amount: '116810000', priceAed: '429.00', source: 'live' } as const;
  it('names the company a confirmed buy went to, in the order App.tsx pays it', () => {
    expect(boughtCompany(decision({ company: 'Apple', pay: bought }))).toBe('Apple');
    expect(boughtCompany(decision({ lookup: { state: 'done', operator: 'GitHub', listedParent: 'Microsoft', fee: '0.01' }, pay: bought }))).toBe('Microsoft');
    expect(boughtCompany(decision({ category: { name: 'Groceries', leader: 'Walmart', score: 0.6 }, pay: bought }))).toBe('Walmart');
    expect(boughtCompany({ at: 1, merchant: 'Apple AirPods 4', model: 'm', order: shopOrder, invest: { company: 'Amazon', reason: 'leader', of: 'Online shopping' }, pay: bought } as Entry)).toBe('Amazon');
  });
  it('falls through an empty-string company, as bought.ts does', () => {
    expect(boughtCompany(decision({ company: '', lookup: { state: 'done', operator: 'GitHub', listedParent: 'Microsoft', fee: '0.01' }, pay: bought }))).toBe('Microsoft');
    expect(boughtCompany(decision({ company: '', lookup: { state: 'done', operator: 'X', listedParent: '', fee: '0.01' }, category: { name: 'Groceries', leader: 'Walmart', score: 0.6 }, pay: bought }))).toBe('Walmart');
  });
  it('is null when nothing was bought', () => {
    expect(boughtCompany(decision({ company: 'Apple', pay: { state: 'bought', value: '0.10', confirmed: false } }))).toBeNull();
    expect(boughtCompany(decision({ company: 'Apple', pay: { state: 'mining', value: '0.10' } }))).toBeNull();
    expect(boughtCompany(decision({ company: 'Apple', pay: { state: 'signing', error: 'Nothing bought: investing is set to 0%' } }))).toBeNull();
    expect(boughtCompany({ at: 2, merchant: 'Apple AirPods 4', model: 'm', order: shopOrder } as Entry)).toBeNull();
    expect(boughtCompany({ at: 3, merchant: 'X', model: 'm', error: 'bad' } as Entry)).toBeNull();
  });
});
