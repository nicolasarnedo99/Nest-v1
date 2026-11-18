import { describe, expect, it } from 'vitest';
import { LIMIT, parseLog, record, type Entry } from '../../mobile/lib/log.js';

const decision = (at: number, extra: Partial<Entry> = {}): Entry =>
  ({ at, merchant: 'APPLE.COM/BILL', amount: '4.99 EUR', company: 'Apple', explanation: 'Apple billing', seconds: 1.2, tuned: true, ...extra }) as Entry;

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
    const list = [decision(2, { pay: { state: 'sending', error: 'nope' } }), { at: 1, merchant: 'X', tuned: false, error: 'bad' } as Entry];
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
