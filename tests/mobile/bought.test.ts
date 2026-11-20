import { describe, expect, it } from 'vitest';
import { boughtLine, showExplanation } from '../../mobile/lib/bought.js';

const base = { at: 1, merchant: 'CAREEM', model: 'm', explanation: 'x', seconds: 1 };
const e = (extra: object) => ({ ...base, company: null, ...extra }) as unknown as Parameters<typeof boughtLine>[0];
const pay = { state: 'bought', confirmed: true, value: '1' };

describe('boughtLine: the company the buy went to, mirroring App.tsx', () => {
  it('the model named it', () => {
    expect(boughtLine(e({ company: 'Apple', pay }))).toEqual({ title: 'Bought 1.00 of Apple', reason: 'named by the on-phone model' });
  });
  it('placed on the phone in the brand table (entries with a placement step)', () => {
    expect(boughtLine(e({ company: 'Apple', placement: 'picked', pay }))).toEqual({ title: 'Bought 1.00 of Apple', reason: 'matched on this phone in the S&P 500 brand table' });
  });
  it('the lookup found a listed owner', () => {
    expect(boughtLine(e({ pay, lookup: { state: 'done', operator: 'Careem', listedParent: 'Uber' } }))).toEqual({ title: 'Bought 1.00 of Uber', reason: 'owner of Careem' });
  });
  it('the category leader when nothing is listed', () => {
    expect(boughtLine(e({ pay, lookup: { state: 'done', operator: 'X', listedParent: null }, category: { name: 'Food delivery and rides', leader: 'Uber', score: 0.5 } })))
      .toEqual({ title: 'Bought 1.00 of Uber', reason: 'leader of Food delivery and rides' });
  });
  it('says nothing for a failed, unconfirmed or missing buy', () => {
    expect(boughtLine(e({ company: 'Apple', pay: { ...pay, confirmed: false } }))).toBeNull();
    expect(boughtLine(e({ company: 'Apple', pay: { state: 'mining' } }))).toBeNull();
    expect(boughtLine(e({ company: 'Apple' }))).toBeNull();
  });
  it('drops the amount when the buy recorded none', () => {
    expect(boughtLine(e({ company: 'Apple', pay: { state: 'bought', confirmed: true } }))?.title).toBe('Bought Apple');
  });
});

describe('showExplanation: hide the small model\'s guess once the lookup named the operator', () => {
  it('hides it after a successful lookup that named one', () => {
    expect(showExplanation({ state: 'done', operator: 'Careem' })).toBe(false);
  });
  it('keeps it with no lookup, a failed lookup, or no operator', () => {
    expect(showExplanation(undefined)).toBe(true);
    expect(showExplanation({ state: 'paying', error: 'nope', operator: 'Careem' })).toBe(true);
    expect(showExplanation({ state: 'done', operator: null })).toBe(true);
    expect(showExplanation({ state: 'done', operator: '' })).toBe(true);
  });
});
