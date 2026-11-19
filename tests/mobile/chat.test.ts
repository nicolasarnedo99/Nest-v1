import { describe, expect, it } from 'vitest';
import { CHAT_SYSTEM, chatResponseFormat, honest, maxAedFor, parseIntent, type Intent } from '../../mobile/lib/chat.js';

const FALLBACK: Intent = { intent: 'other', query: '', maxPrice: null, currency: null, merchant: '', amount: '', reply: "Sorry, I didn't get that. Try 'find me headphones under 300 dirhams'." };
const good: Intent = { intent: 'search', query: 'headphones', maxPrice: 300, currency: 'AED', merchant: '', amount: '', reply: 'Looking for headphones under 300 AED.' };
const paid: Intent = { intent: 'paid', query: '', maxPrice: null, currency: null, merchant: 'Careem', amount: '45 AED', reply: 'Noting 45 AED at Careem.' };
const parse = (o: unknown) => parseIntent(JSON.stringify(o));

describe('parseIntent: strict, anything else is the fallback', () => {
  it('accepts a valid answer, including null price and currency, and a zero price', () => {
    expect(parse(good)).toEqual(good);
    expect(parse({ ...good, maxPrice: null, currency: null })).toEqual({ ...good, maxPrice: null, currency: null });
    expect(parse({ ...good, maxPrice: 0 }).maxPrice).toBe(0); // 0 is allowed: a maximum of nothing just finds nothing
    expect(parse(paid)).toEqual(paid);
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
    ['a merchant over 80', { ...paid, merchant: 'a'.repeat(81) }],
    ['an amount over 40', { ...paid, amount: '1'.repeat(41) }],
    ['a merchant with a control character', { ...paid, merchant: 'Car\u0000eem' }],
    ['an amount with a control character', { ...paid, amount: '45\nAED' }],
    ['a merchant that is not a string', { ...paid, merchant: null }],
    ['a non-object', [good]],
  ])('rejects %s', (_, value) => expect(parse(value)).toEqual(FALLBACK));

  it('rejects non-JSON and a NaN-like price', () => {
    expect(parseIntent('not json')).toEqual(FALLBACK);
    expect(parseIntent('{"intent":"search","query":"x","maxPrice":null,"currency":null,"merchant":"","amount":"","reply":1}')).toEqual(FALLBACK);
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
  it('asks for a paid intent with the merchant and the amount', () => {
    expect(CHAT_SYSTEM).toMatch(/"paid"/);
    const { properties } = (chatResponseFormat as any).json_schema.schema;
    expect(properties.intent.enum).toEqual(['search', 'paid', 'other']);
    expect(properties.merchant).toEqual({ type: 'string', maxLength: 80 });
    expect(properties.amount).toEqual({ type: 'string', maxLength: 40 });
  });
  it('asks for strict JSON with exactly the seven keys', () => {
    const f = chatResponseFormat as any;
    expect(f.type).toBe('json_schema');
    expect(f.json_schema.strict).toBe(true);
    expect(Object.keys(f.json_schema.schema.properties).sort()).toEqual(['amount', 'currency', 'intent', 'maxPrice', 'merchant', 'query', 'reply']);
    expect(f.json_schema.schema.required.slice().sort()).toEqual(['amount', 'currency', 'intent', 'maxPrice', 'merchant', 'query', 'reply']);
    expect(f.json_schema.schema.additionalProperties).toBe(false);
  });
});

describe('honest: the model may not invent a price the user never gave', () => {
  const invented: Intent = { intent: 'search', query: 'eSIM Spain', maxPrice: 100, currency: 'USD', merchant: '', amount: '', reply: 'Looking for an eSIM for Spain with a maximum price of $100.' };
  it('drops the price and the price talk when the message has no number', () => {
    expect(honest(invented, 'I need an eSIM for Spain')).toEqual({ ...invented, maxPrice: null, currency: null, reply: 'Searching for eSIM Spain.' });
  });
  it('keeps a neutral reply when the user gave no number', () => {
    const r = { ...invented, maxPrice: null, currency: null, reply: 'Looking for an eSIM for Spain.' };
    expect(honest(r, 'I need an eSIM for Spain')).toEqual(r);
  });
  it.each(['headphones under 300 dirhams', 'a laptop for under fifty dollars', 'a gift card, a hundred max', 'a bike below twenty'])(
    'leaves the intent alone when the message has a number or number word: %s', m => expect(honest(good, m)).toEqual(good));
  it('does not read a number word inside another word', () => {
    expect(honest(invented, 'I need someone to phone me').maxPrice).toBeNull();
  });
  it('leaves a non-search reply alone, including the parse fallback', () => {
    expect(honest(parseIntent('garbage'), 'hello')).toEqual(FALLBACK);
    const other: Intent = { intent: 'other', query: '', maxPrice: null, currency: null, merchant: '', amount: '', reply: 'I only know prices of shop items.' };
    expect(honest(other, 'hello')).toEqual(other);
  });
  it('counts Arabic-Indic digits as a number', () => {
    expect(honest(good, 'سماعات تحت ٣٠٠')).toEqual(good);
  });
});

// The model only reads "I paid X at Y"; code decides whether that is a payment Nest may act on, and what the reply says.
describe('honest: a payment needs an amount the user said and a merchant', () => {
  const ask: Intent = { intent: 'other', query: '', maxPrice: null, currency: null, merchant: '', amount: '', reply: 'How much did you pay, and where?' };
  it.each(['I just paid 45 dirhams at Careem for food', 'bought lunch on Careem, 45 AED', 'paid 45.00 dirhams at Careem', 'دفعت ٤٥ درهم في كريم'])(
    'keeps a payment whose message has a number: %s', m => expect(honest(paid, m)).toEqual({ ...paid, reply: 'Note 45 AED at Careem?' }));
  it('asks again when the message has no number, whatever the model filled in', () => {
    expect(honest(paid, 'I just paid at Careem')).toEqual(ask);
    expect(honest(paid, 'I paid someone')).toEqual(ask); // "one" inside a word is not a number
  });
  it('keeps an amount in words when the message has a number word', () => {
    const words = { ...paid, amount: 'forty five dirhams' };
    expect(honest(words, 'paid forty five dirhams on Careem')).toEqual({ ...words, reply: 'Note forty five dirhams at Careem?' });
  });
  it('asks again when the amount has digits the user never said', () => {
    expect(honest(paid, 'I paid 4 AED at Careem')).toEqual(ask); // the model made 4 into 45
    expect(honest(paid, 'I paid 450 AED at Careem')).toEqual(ask); // or dropped a digit
    expect(honest(paid, 'paid forty five dirhams on Careem')).toEqual(ask); // or turned words into digits
    expect(honest(paid, 'I paid at Careem for 2 people')).toEqual(ask); // a number elsewhere is not the amount
  });
  it('matches the amount across separators and Arabic-Indic digits', () => {
    expect(honest({ ...paid, amount: '1,000 AED' }, 'paid 1000 AED at Careem').intent).toBe('paid');
    expect(honest({ ...paid, amount: '45,50 AED' }, 'paid 45.50 at Careem').intent).toBe('paid');
    expect(honest({ ...paid, amount: '٤٥ درهم' }, 'paid 45 at Careem').intent).toBe('paid');
  });
  it('asks again when the merchant or the amount is blank', () => {
    expect(honest({ ...paid, merchant: '   ' }, 'I paid 45 AED')).toEqual(ask);
    expect(honest({ ...paid, amount: ' ' }, 'I paid 45 at Careem')).toEqual(ask);
  });
  it('trims the merchant and the amount it keeps', () => {
    expect(honest({ ...paid, merchant: ' Careem ', amount: ' 45 AED ' }, 'paid 45 AED at Careem')).toMatchObject({ merchant: 'Careem', amount: '45 AED' });
  });
});
