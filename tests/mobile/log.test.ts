import { describe, expect, it } from 'vitest';
import { LIMIT, parseLog, record, type Entry } from '../../mobile/lib/log.js';

const decision = (at: number, extra: Partial<Entry> = {}): Entry =>
  ({ at, merchant: 'APPLE.COM/BILL', amount: '4.99 EUR', company: 'Apple', explanation: 'Apple billing', seconds: 1.2, model: 'Qwen3 1.7B, fine-tuned', ...extra }) as Entry;

describe('record: newest first, capped', () => {
  it('puts the newest entry first', () => {
    expect(record([decision(1)], decision(2)).map(e => e.at)).toEqual([2, 1]);
  });

  it('keeps only the newest 200', () => {
    let list: Entry[] = [];
    for (let i = 0; i < LIMIT + 5; i++) list = record(list, decision(i));
    expect(list).toHaveLength(200);
    expect(list[0].at).toBe(204);
    expect(list.at(-1)!.at).toBe(5);
  });

  it('replaces the entry with the same timestamp, so a payment result updates its decision', () => {
    const paid = decision(1, { pay: { state: 'bought', transaction: '0xabc', confirmed: true } });
    const list = record(record([], decision(1)), paid);
    expect(list).toEqual([paid]);
  });
});

describe('parseLog: a record, never a control', () => {
  it('reads a missing file as empty, without a problem', () => {
    expect(parseLog(null)).toEqual({ entries: [] });
  });

  it('round-trips what was written, including a payment error', () => {
    const list = [decision(2, { pay: { state: 'sending', error: 'nope' } }), { at: 1, merchant: 'X', model: 'Qwen3 1.7B, untuned', error: 'bad' } as Entry];
    expect(parseLog(JSON.stringify(list))).toEqual({ entries: list });
  });

  it('reports a corrupt file as empty with a problem', () => {
    const { entries, problem } = parseLog('{not json');
    expect(entries).toEqual([]);
    expect(problem).toMatch(/unreadable/i);
  });

  it('reports JSON that is not a list', () => {
    expect(parseLog('{"a":1}').problem).toMatch(/unreadable/i);
  });

  it('turns a payment stored mid-flight into an interrupted warning, with the UserOperation if known', () => {
    const { entries } = parseLog(JSON.stringify([decision(1, { pay: { state: 'sending' } }), decision(2, { pay: { state: 'mining', userOperation: '0xop' } })]));
    expect((entries[0] as any).pay.error).toBe('Interrupted while sending, a buy may have been sent, check Etherscan');
    expect((entries[1] as any).pay.error).toBe('Interrupted while mining, a buy may have been sent, check Etherscan (UserOperation 0xop)');
  });

  it('drops malformed entries, keeps the good ones and says how many were dropped', () => {
    const { entries, problem } = parseLog(JSON.stringify([decision(1), { at: 'x' }, { ...decision(2), seconds: 'fast' }, null]));
    expect(entries.map(e => e.at)).toEqual([1]);
    expect(problem).toMatch(/3/);
  });

  it('drops a decision whose payment state is unknown, and strips unexpected fields such as secrets', () => {
    const { entries, problem } = parseLog(JSON.stringify([decision(1, { pay: { state: 'weird' } as never }), { ...decision(2), signature: '0xsecret' }]));
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('0xsecret');
    expect(problem).toMatch(/1/);
  });
});

describe('the model that decided', () => {
  it('reads an entry saved before the model choice, from its tuned flag', () => {
    const old = (tuned: boolean) => ({ at: 1, merchant: 'X', tuned, company: null, explanation: 'none', seconds: 1 });
    const { entries } = parseLog(JSON.stringify([old(true), { ...old(false), at: 2 }]));
    expect(entries.map(e => e.model)).toEqual(['Qwen3 1.7B, fine-tuned', 'Qwen3 1.7B, untuned']);
  });

  it('keeps the model of a new entry', () => {
    const entry = { at: 1, merchant: 'X', model: 'Qwen3.5 2B, as it comes', error: 'bad' };
    expect(parseLog(JSON.stringify([entry])).entries).toEqual([entry]);
  });
});

describe('a paid lookup on a decision', () => {
  it('round-trips a finished lookup unchanged', () => {
    const list = [decision(1, { company: null, lookup: { state: 'done', operator: 'GitHub', listedParent: 'Microsoft', fee: '0.01', transaction: '0xabc' } } as Partial<Entry>)];
    expect(parseLog(JSON.stringify(list))).toEqual({ entries: list });
  });

  it('turns a lookup stored mid-payment into an interrupted warning, since the fee may have been paid', () => {
    const { entries } = parseLog(JSON.stringify([decision(1, { company: null, lookup: { state: 'paying' } } as Partial<Entry>)]));
    expect((entries[0] as any).lookup).toEqual({ state: 'paying', error: 'Lookup interrupted, a fee may have been paid' });
  });

  it('drops an entry whose lookup has fields of the wrong type', () => {
    const { entries, problem } = parseLog(JSON.stringify([decision(1), decision(2, { lookup: { state: 'maybe' } } as never), decision(3, { lookup: { state: 'done', operator: 3 } } as never)]));
    expect(entries.map(e => e.at)).toEqual([1]);
    expect(problem).toMatch(/2/);
  });

  it('strips unknown fields from a stored lookup', () => {
    const { entries } = parseLog(JSON.stringify([decision(1, { company: null, lookup: { state: 'done', fee: '0.01', junk: 1 } } as never)]));
    expect((entries[0] as any).lookup).toEqual({ state: 'done', fee: '0.01' });
  });

  it('keeps the error of a lookup that failed, rather than calling it interrupted', () => {
    const { entries } = parseLog(JSON.stringify([decision(1, { company: null, lookup: { state: 'paying', error: 'Daily cap reached, not looked up' } } as Partial<Entry>)]));
    expect((entries[0] as any).lookup).toEqual({ state: 'paying', error: 'Daily cap reached, not looked up' });
  });

  it('reads an older entry without a lookup', () => {
    const old = decision(1, { company: null });
    const { entries } = parseLog(JSON.stringify([old]));
    expect(entries).toEqual([old]);
    expect('lookup' in entries[0]).toBe(false);
  });
});

describe('parseLog: amount bought', () => {
  it('keeps the amount bought and drops a value that is not a string', () => {
    const at = 1;
    const base = { at, merchant: 'GITHUB', model: 'm', company: 'Microsoft', explanation: 'x', seconds: 1 };
    const kept = parseLog(JSON.stringify([{ ...base, pay: { state: 'bought', value: '0.45', confirmed: true, transaction: '0x1' } }])).entries[0] as any;
    expect(kept.pay.value).toBe('0.45');
    const dropped = parseLog(JSON.stringify([{ ...base, pay: { state: 'bought', value: 45, confirmed: true } }])).entries[0] as any;
    expect(dropped.pay.value).toBeUndefined();
  });
  it('drops a value that is not a positive decimal but keeps the entry', () => {
    const base = { at: 1, merchant: 'GITHUB', model: 'm', company: 'Microsoft', explanation: 'x', seconds: 1 };
    for (const value of ['abc', '0', '1,5']) {
      const { entries } = parseLog(JSON.stringify([{ ...base, pay: { state: 'bought', value, confirmed: true } }]));
      expect(entries).toHaveLength(1);
      expect((entries[0] as any).pay.value).toBeUndefined();
    }
  });
});

describe('the ERC-8004 agent a lookup was resolved from', () => {
  const lookup = { state: 'done', operator: 'Carrefour', listedParent: null, fee: '0.01', transaction: '0xabc' };
  it('round-trips the agent id', () => {
    const list = [decision(1, { company: null, lookup: { ...lookup, agent: '11437' } } as Partial<Entry>)];
    expect(parseLog(JSON.stringify(list))).toEqual({ entries: list });
  });

  it('drops an agent that is not a string but keeps the entry', () => {
    const { entries, problem } = parseLog(JSON.stringify([decision(1, { company: null, lookup: { ...lookup, agent: 11437 } } as never)]));
    expect(problem).toBeUndefined();
    expect((entries[0] as any).lookup).toEqual(lookup);
  });

  it('drops an empty agent but keeps the entry', () => {
    const { entries, problem } = parseLog(JSON.stringify([decision(1, { company: null, lookup: { ...lookup, agent: '' } } as never)]));
    expect(problem).toBeUndefined();
    expect((entries[0] as any).lookup).toEqual(lookup);
  });

  it('reads an older lookup without an agent', () => {
    const { entries } = parseLog(JSON.stringify([decision(1, { company: null, lookup } as Partial<Entry>)]));
    expect('agent' in (entries[0] as any).lookup).toBe(false);
  });
});

describe('a demo order', () => {
  const order = (over: Record<string, unknown> = {}) => ({ state: 'done', productId: 'p1', title: 'Sony WH-1000XM5', priceAed: '1299.00', amount: '353700000', source: 'recorded', agent: '7', orderId: '0xaa', transaction: '0xbb', checkedAt: '2026-11-19', ...over });
  const entry = (at: number, o: Record<string, unknown> = {}) => ({ at, merchant: 'Sony WH-1000XM5', model: 'Nest demo shop', order: order(o) });

  it('round-trips', () => {
    const list = [entry(2), entry(1, { state: 'paying', error: 'Declined', agent: undefined, transaction: undefined, checkedAt: undefined })];
    expect(parseLog(JSON.stringify(list)).entries[0]).toMatchObject({ order: { checkedAt: '2026-11-19' } }); // the price date survives a reload
    expect(parseLog(JSON.stringify(list))).toEqual({ entries: list.map(e => JSON.parse(JSON.stringify(e))) });
  });

  it('turns a payment stored mid-flight into an interrupted warning, and leaves a failed one alone', () => {
    const { entries } = parseLog(JSON.stringify([entry(1, { state: 'paying' }), entry(2, { state: 'paying', error: 'Declined' })]));
    expect((entries[0] as any).order.error).toBe('Order interrupted, it may have been paid, check Etherscan');
    expect((entries[1] as any).order.error).toBe('Declined');
  });

  it.each([
    ['an unknown state', { state: 'shipped' }],
    ['an amount that is not digits', { amount: '3.5' }],
    ['an unknown source', { source: 'guess' }],
    ['a missing title', { title: undefined }],
    ['a non-string transaction', { transaction: 5 }],
    ['a non-string price date', { checkedAt: 20261119 }],
  ])('drops the entry for %s and says so', (_, over) => {
    const { entries, problem } = parseLog(JSON.stringify([entry(1, over)]));
    expect(entries).toEqual([]);
    expect(problem).toMatch(/1/);
  });

  it('keeps only known fields, and is not mistaken for a decision', () => {
    const { entries } = parseLog(JSON.stringify([{ ...entry(1), signature: '0xsecret', order: { ...order(), key: '0xsecret' } }]));
    expect(JSON.stringify(entries)).not.toContain('0xsecret');
    expect('company' in entries[0]).toBe(false);
  });

  it('leaves older decision and error entries unchanged beside orders', () => {
    const d = decision(3, { pay: { state: 'bought', confirmed: true } });
    const e = { at: 2, merchant: 'X', model: 'm', error: 'bad' };
    expect(parseLog(JSON.stringify([d, e, entry(1)])).entries.slice(0, 2)).toEqual([d, e]);
  });
});

describe('a Bitrefill purchase from the Sepolia mirror', () => {
  const wouldPay = { seller: 'Bitrefill', scheme: 'exact', network: 'eip155:42161', asset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', payTo: '0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A', amount: '2820000' };
  const order = (over: Record<string, unknown> = {}) => ({ state: 'done', seller: 'bitrefill', productId: 'noon-uae', title: 'Noon.com UAE', packageValue: '10', priceUsd: '2.82',
    amount: '2820000', wouldPay, agent: '12', orderId: 'o1', transaction: '0xbb', checkedAt: '2026-11-19T10:00:00.000Z', ...over });
  const entry = (o: Record<string, unknown> = {}) => ({ at: 1, merchant: 'Noon.com UAE', model: 'Bitrefill mirror', order: order(o) });

  it('round-trips, would-pay line included', () => {
    expect(parseLog(JSON.stringify([entry()]))).toEqual({ entries: [entry()] });
  });

  it.each([
    ['a missing would-pay', { wouldPay: undefined }],
    ['a would-pay amount that is not digits', { wouldPay: { ...wouldPay, amount: '2.82' } }],
    ['a would-pay field of the wrong type', { wouldPay: { ...wouldPay, payTo: 7 } }],
    ['a missing package', { packageValue: undefined }],
    ['an unknown seller', { seller: 'amazon' }],
  ])('drops the entry for %s', (_, over) => {
    expect(parseLog(JSON.stringify([entry(over)])).entries).toEqual([]);
  });

  it('copies only the known would-pay fields', () => {
    const { entries } = parseLog(JSON.stringify([entry({ wouldPay: { ...wouldPay, key: '0xsecret' } })]));
    expect(JSON.stringify(entries)).not.toContain('0xsecret');
  });
});

describe('category leader on a decision', () => {
  const lookup = { state: 'done', operator: 'Careem, majority-owned by e&', listedParent: null, fee: '0.01' } as const;
  it('round-trips the matched category', () => {
    const entry = decision(1, { company: null, lookup, category: { name: 'Food delivery and rides', leader: 'Uber', score: 0.51 } } as Partial<Entry>);
    expect(parseLog(JSON.stringify([entry])).entries).toEqual([entry]);
  });
  it('drops an entry whose category has the wrong shape', () => {
    const bad = { ...decision(1, { company: null }), category: { name: 'Coffee', leader: 7, score: 0.5 } };
    expect(parseLog(JSON.stringify([bad, decision(2)])).entries.map(e => e.at)).toEqual([2]);
  });
});
