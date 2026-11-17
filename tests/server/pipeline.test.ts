import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Classifier, Decision } from '../../server/classifier.js';
import { Execution, ExecutionStore, type PaymentAdapter } from '../../server/execution.js';
import { Pipeline } from '../../server/pipeline.js';
import { EventStore } from '../../server/store.js';

const COMPANIES = ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA'] as const;
const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

function setup(decide: (merchant: string) => Decision | Error) {
  const events = new EventStore(':memory:');
  const purchases = new ExecutionStore(':memory:');
  closers.push(() => events.close(), () => purchases.close());
  const classifier: Classifier = { close: async () => {},
    classify: vi.fn(async merchant => { const result = decide(merchant); if (result instanceof Error) throw result; return result; }) };
  const payment: PaymentAdapter = {
    prepare: vi.fn(async intent => ({ balance: 10_000_000n, fromBlock: 1n, order: { company: intent.company, orderId: '0x01' as const,
      buyer: '0x00000000000000000000000000000000000000b1' as const, value: intent.amount, validAfter: 0n, validBefore: 600n } })),
    sign: vi.fn(async () => '0x1234' as const), verify: vi.fn(async () => {}), submit: vi.fn(async () => '0xabcd' as const),
    inspect: vi.fn(async () => ({ status: 'confirmed' as const, shares: 2_500_000_000_000_000n, evidence: { transaction: '0xabcd' } })),
  };
  const pipeline = new Pipeline(events, classifier, new Execution(purchases, payment), COMPANIES);
  let count = 0;
  const run = (merchant: string, amount = '5.00') => pipeline.enqueue(events.intake({ id: `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
    merchant, amount, currency: 'USD', timestamp: '2026-11-14T10:00:00Z' }).event);
  return { events, purchases, classifier, payment, run };
}
const decision = (company: Decision['company'], explanation: string): Decision => ({ company, explanation, seconds: 0.2 });

describe('from card event to purchase', () => {
  it('skips, without signing anything, when the model finds no listed company', async () => {
    const { run, payment, purchases } = setup(() => decision(null, 'Unrelated supermarket chain'));
    const result = await run('CARREFOUR EXPRESS MADRID');
    expect(result).toMatchObject({ status: 'skipped', reason: 'Unrelated supermarket chain', detail: { company: null } });
    expect(payment.prepare).not.toHaveBeenCalled();
    expect(payment.sign).not.toHaveBeenCalled();
    expect(purchases.list()).toEqual([]);
  });

  it('buys a tenth of the card amount in the company the model named', async () => {
    const { run, payment } = setup(() => decision('Tesla', "Tesla's own charging network"));
    const result = await run('TESLA SUPERCHARGER', '7.00');
    expect(result).toMatchObject({ status: 'bought', principal: '0.7',
      detail: { company: 'Tesla', transaction: '0xabcd', shares: '2500000000000000', purchaseStatus: 'confirmed' } });
    // Tesla is company 3 on chain, and 10% of 7.00 is 0.7 in 6-decimal units.
    expect(payment.prepare).toHaveBeenCalledWith(expect.objectContaining({ company: 3, amount: 700_000n }));
  });

  it('never treats unusable model output as a skip or as a buy', async () => {
    const { run, payment } = setup(() => new Error('Unusable classifier output'));
    expect((await run('APPLE.COM/BILL')).status).toBe('failed');
    expect(payment.sign).not.toHaveBeenCalled();
  });

  it('classifies but does not buy while paused', async () => {
    const { run, events, payment } = setup(() => decision('Apple', "Apple's own billing service"));
    events.setPaused(true);
    expect(await run('APPLE.COM/BILL')).toMatchObject({ status: 'blocked', reason: 'Purchases are paused.', detail: { company: 'Apple' } });
    expect(payment.sign).not.toHaveBeenCalled();
  });

  it('blocks at the daily cap before signing, and says why', async () => {
    const { run, payment } = setup(() => decision('Apple', "Apple's own store"));
    for (let index = 0; index < 5; index++) expect((await run('Apple Store', '10.00')).status).toBe('bought');
    expect(await run('Apple Store', '10.00')).toMatchObject({ status: 'blocked', reason: 'Daily cap exceeded', detail: { company: 'Apple' } });
    expect(payment.sign).toHaveBeenCalledTimes(5);
  });

  it('reports an unresolved purchase as uncertain and blocks the next buy', async () => {
    const { run, payment } = setup(() => decision('NVIDIA', "NVIDIA's own store"));
    payment.submit = vi.fn(async () => { throw new Error('relayer offline'); });
    expect((await run('NVIDIA STORE')).status).toBe('uncertain');
    expect(await run('NVIDIA STORE')).toMatchObject({ status: 'blocked', reason: 'Unresolved purchase blocks new execution' });
  });

  it('handles events one at a time in arrival order', async () => {
    const order: string[] = [];
    const { run } = setup(merchant => { order.push(merchant); return decision(null, 'Unrelated local shop'); });
    await Promise.all([run('first'), run('second'), run('third')]);
    expect(order).toEqual(['first', 'second', 'third']);
  });
});
