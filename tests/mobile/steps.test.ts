import { describe, expect, it } from 'vitest';
import type { Entry } from '../../mobile/lib/log.js';
import { steps } from '../../mobile/lib/steps.js';

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
