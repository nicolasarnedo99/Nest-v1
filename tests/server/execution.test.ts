import { afterEach, describe, expect, it, vi } from 'vitest';
import { Execution, ExecutionStore, type PaymentAdapter, type Prepared, type PurchaseIntent } from '../../server/execution.js';

const BUYER = '0x00000000000000000000000000000000000000b1';
const BUY: PurchaseIntent = { id: 'event-1', company: 0, amount: 500_000n };
const SIGNATURE = '0x1234';
const TX = '0xabcd';
const stores: ExecutionStore[] = [];
function store() { const value = new ExecutionStore(':memory:'); stores.push(value); return value; }
const prepared = (intent: PurchaseIntent, balance = 10_000_000n): Prepared => ({ balance, fromBlock: 10n,
  order: { company: intent.company, orderId: '0x01', buyer: BUYER, value: intent.amount, validAfter: 0n, validBefore: 600n } });
function adapter(): PaymentAdapter {
  return {
    prepare: vi.fn(async intent => prepared(intent)),
    sign: vi.fn(async () => SIGNATURE as `0x${string}`),
    verify: vi.fn(async () => {}),
    submit: vi.fn(async () => TX as `0x${string}`),
    inspect: vi.fn(async () => ({ status: 'confirmed' as const, shares: 123n, evidence: { transaction: TX } })),
  };
}
afterEach(() => { for (const value of stores.splice(0)) if (value.database.open) value.close(); });

describe('purchase execution', () => {
  it('saves the reservation before signing and the signature before submitting', async () => {
    const database = store(); const chain = adapter();
    chain.sign = vi.fn(async () => {
      expect(database.get(BUY.id)!.status).toBe('preparing');
      return SIGNATURE as `0x${string}`;
    });
    chain.submit = vi.fn(async () => {
      const saved = database.get(BUY.id)!;
      expect(saved.status).toBe('signed');
      expect(saved.signature).toBe(SIGNATURE);
      return TX as `0x${string}`;
    });
    const result = await new Execution(database, chain).execute(BUY);
    expect(result).toMatchObject({ status: 'confirmed', shares: 123n, transaction: TX });
    expect(database.get(BUY.id)!.status).toBe('confirmed');
  });

  it('refuses over-cap, under-minimum and unaffordable buys before any signature exists', async () => {
    for (const [intent, balance, message] of [
      [{ ...BUY, amount: 1_000_001n }, 10_000_000n, 'Invalid budget input'],
      [{ ...BUY, amount: 99_999n }, 10_000_000n, 'Invalid budget input'],
      [BUY, 499_999n, 'Insufficient balance'],
    ] as const) {
      const database = store(); const chain = adapter();
      chain.prepare = vi.fn(async item => prepared(item, balance));
      await expect(new Execution(database, chain).execute(intent)).rejects.toThrow(message);
      expect(chain.sign).not.toHaveBeenCalled();
      expect(database.list()).toHaveLength(0);
    }
  });

  it('stops at the daily cap across separate purchases', async () => {
    const database = store(); const chain = adapter();
    const engine = new Execution(database, chain, () => new Date('2026-11-14T10:00:00Z'));
    for (let index = 0; index < 5; index++) {
      expect((await engine.execute({ id: `event-${index}`, company: 0, amount: 1_000_000n })).status).toBe('confirmed');
    }
    await expect(engine.execute({ id: 'event-6', company: 0, amount: 100_000n })).rejects.toThrow('Daily cap');
    expect(chain.sign).toHaveBeenCalledTimes(5);
  });

  it('is idempotent for the same event and rejects a changed intent', async () => {
    const database = store(); const chain = adapter(); const engine = new Execution(database, chain);
    await engine.execute(BUY);
    expect((await engine.execute(BUY)).status).toBe('confirmed');
    expect(chain.sign).toHaveBeenCalledTimes(1);
    await expect(engine.execute({ ...BUY, company: 4 })).rejects.toThrow('different intent');
  });

  it('marks a failed submission uncertain, blocks new buys, and never resubmits on reconcile', async () => {
    const database = store(); const chain = adapter(); const engine = new Execution(database, chain);
    chain.submit = vi.fn(async () => { throw new Error('relayer offline'); });
    const failed = await engine.execute(BUY);
    expect(failed).toMatchObject({ status: 'uncertain', signature: SIGNATURE });
    await expect(engine.execute({ ...BUY, id: 'event-2' })).rejects.toThrow('Unresolved purchase');

    chain.inspect = vi.fn(async () => ({ status: 'pending' as const }));
    expect((await engine.reconcile(BUY.id)).status).toBe('uncertain');
    chain.inspect = vi.fn(async () => ({ status: 'expired' as const }));
    expect((await engine.reconcile(BUY.id)).status).toBe('expired');
    expect(chain.submit).toHaveBeenCalledTimes(1);
    // An expired signature can never move money, so buying is possible again.
    expect((await engine.execute({ ...BUY, id: 'event-2' })).status).toBe('uncertain');
  });

  it('resolves an uncertain purchase as confirmed when the chain shows it went through', async () => {
    const database = store(); const chain = adapter(); const engine = new Execution(database, chain);
    chain.inspect = vi.fn(async () => { throw new Error('rpc timeout'); });
    expect((await engine.execute(BUY)).status).toBe('uncertain');
    chain.inspect = vi.fn(async () => ({ status: 'confirmed' as const, shares: 5n, evidence: { transaction: TX } }));
    expect(await engine.reconcile(BUY.id)).toMatchObject({ status: 'confirmed', shares: 5n });
  });

  it('rejects a signature that fails verification without submitting it', async () => {
    const database = store(); const chain = adapter();
    chain.verify = vi.fn(async () => { throw new Error('wrong signer'); });
    expect((await new Execution(database, chain).execute(BUY)).status).toBe('uncertain');
    expect(chain.submit).not.toHaveBeenCalled();
  });

  it('allows only one worker to hold the wallet lock', () => {
    const database = store();
    database.acquire();
    expect(() => database.acquire()).toThrow('holds the wallet lock');
    database.release();
    expect(() => database.acquire()).not.toThrow();
  });
});
