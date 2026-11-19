import { describe, expect, it } from 'vitest';
import { CHAT_SYSTEM, chatResponseFormat, maxAedFor, parseIntent, type Intent } from '../../mobile/lib/chat.js';

const FALLBACK: Intent = { intent: 'other', query: '', maxPrice: null, currency: null, reply: "Sorry, I didn't get that. Try 'find me headphones under 300 dirhams'." };
const good: Intent = { intent: 'search', query: 'headphones', maxPrice: 300, currency: 'AED', reply: 'Looking for headphones under 300 AED.' };
const parse = (o: unknown) => parseIntent(JSON.stringify(o));

describe('parseIntent: strict, anything else is the fallback', () => {
  it('accepts a valid answer, including null price and currency, and a zero price', () => {
    expect(parse(good)).toEqual(good);
    expect(parse({ ...good, maxPrice: null, currency: null })).toEqual({ ...good, maxPrice: null, currency: null });
    expect(parse({ ...good, maxPrice: 0 }).maxPrice).toBe(0); // 0 is allowed: a maximum of nothing just finds nothing
  });

  it.each([
    ['an extra key', { ...good, extra: 1 }],
    ['a missing key', { intent: 'search', query: 'x', maxPrice: null, currency: null }],
    ['a bad intent', { ...good, intent: 'buy' }],
    ['a negative price', { ...good, maxPrice: -1 }],
    ['a price as a string', { ...good, maxPrice: '300' }],
    ['a huge price', { ...good, maxPrice: 1e21 }],
    ['a bad currency', { ...good, currency: 'EUR' }],
    ['a query over 80', { ...good, query: 'a'.repeat(81) }],
    ['a reply over 160', { ...good, reply: 'a'.repeat(161) }],
    ['a query with a control character', { ...good, query: 'head\nphones' }],
    ['a non-object', [good]],
  ])('rejects %s', (_, value) => expect(parse(value)).toEqual(FALLBACK));

  it('rejects non-JSON and a NaN-like price', () => {
    expect(parseIntent('not json')).toEqual(FALLBACK);
    expect(parseIntent('{"intent":"search","query":"x","maxPrice":null,"currency":null,"reply":1}')).toEqual(FALLBACK);
  });
});

describe('maxAedFor: a maximum is never widened', () => {
  const at = (maxPrice: number | null, currency: Intent['currency']) => maxAedFor({ ...good, maxPrice, currency });
  it('converts USD to AED at 3.6725', () => expect(at(100, 'USD')).toBe('367.25'));
  it('rounds down, not to nearest', () => expect(at(0.99, 'USD')).toBe('3.63')); // 3.636 -> 3.63
  it('truncates AED to 2 decimals', () => { expect(at(299.999, 'AED')).toBe('299.99'); expect(at(0.29, 'AED')).toBe('0.29'); });
  it('treats no currency as AED and no price as null', () => { expect(at(300, null)).toBe('300.00'); expect(at(null, 'USD')).toBeNull(); });
});

describe('the prompt', () => {
  it('is short, promises nothing, never says private or Tether', () => {
    expect(CHAT_SYSTEM.length).toBeLessThan(500);
    expect(CHAT_SYSTEM).not.toMatch(/private|tether/i);
    expect(CHAT_SYSTEM).toMatch(/never promise/i);
  });
  it('asks for strict JSON with exactly the five keys', () => {
    const f = chatResponseFormat as any;
    expect(f.type).toBe('json_schema');
    expect(f.json_schema.strict).toBe(true);
    expect(Object.keys(f.json_schema.schema.properties).sort()).toEqual(['currency', 'intent', 'maxPrice', 'query', 'reply']);
    expect(f.json_schema.schema.additionalProperties).toBe(false);
  });
});
