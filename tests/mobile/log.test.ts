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
