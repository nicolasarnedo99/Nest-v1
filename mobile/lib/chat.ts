// The chat model only reads a shopping request into a search. It never decides or pays: code does the rest.
export const CHAT_SYSTEM = 'You help find products in a shop. Read the message and output only the JSON. Use intent "search" with a short product query and an optional maximum price, otherwise "other". Set maxPrice and currency only when the message states a price, otherwise null, and never mention a price in the reply unless the message gave one. Never promise a purchase; the reply only says what you will look for.';

const AED_PER_USD_E4 = 36725n; // 3.6725, the same rate the order sheet shows

export type Intent = { intent: 'search' | 'other'; query: string; maxPrice: number | null; currency: 'AED' | 'USD' | null; reply: string };

export const chatResponseFormat = { type: 'json_schema', json_schema: { name: 'shop_intent', strict: true, schema: {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['search', 'other'] },
    query: { type: 'string', maxLength: 80 },
    maxPrice: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    currency: { anyOf: [{ type: 'string', enum: ['AED', 'USD'] }, { type: 'null' }] },
    reply: { type: 'string', maxLength: 160 },
  },
  required: ['intent', 'query', 'maxPrice', 'currency', 'reply'],
  additionalProperties: false,
} } };

const FALLBACK: Intent = { intent: 'other', query: '', maxPrice: null, currency: null, reply: "Sorry, I didn't get that. Try 'find me headphones under 300 dirhams'." };
const KEYS = ['currency', 'intent', 'maxPrice', 'query', 'reply'];
const MAX_PRICE = 1e9; // keeps toFixed out of exponent notation

export function parseIntent(text: string): Intent {
  let v: any;
  try { v = JSON.parse(text); } catch { return FALLBACK; }
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== KEYS.join()) return FALLBACK;
  // 0 is allowed: a maximum of nothing finds nothing, and the schema says minimum 0.
  const ok = (v.intent === 'search' || v.intent === 'other') &&
    typeof v.query === 'string' && v.query.length <= 80 && !/[\u0000-\u001f\u007f]/.test(v.query) &&
    typeof v.reply === 'string' && v.reply.length <= 160 &&
    (v.maxPrice === null || (typeof v.maxPrice === 'number' && Number.isFinite(v.maxPrice) && v.maxPrice >= 0 && v.maxPrice <= MAX_PRICE)) &&
    (v.currency === null || v.currency === 'AED' || v.currency === 'USD');
  return ok ? { intent: v.intent, query: v.query, maxPrice: v.maxPrice, currency: v.currency, reply: v.reply } : FALLBACK;
}

// shortcut: any number in the message ("one eSIM", "50 GB") keeps the model's price; upgrade: compare the stated amounts with maxPrice.
const NUMBER = /\p{Nd}|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/iu;
const PRICE_TALK = /\p{Nd}|[$€£]|\b(aed|usd|dirhams?|dollars?|price|budget|under|maximum)\b/iu;

// Code, not the model, decides whether a price was given: a 2B model fills one in unasked.
export function honest(intent: Intent, message: string): Intent {
  if (NUMBER.test(message)) return intent;
  return { ...intent, maxPrice: null, currency: null, reply: intent.intent === 'search' && intent.query && PRICE_TALK.test(intent.reply) ? `Searching for ${intent.query}.` : intent.reply };
}

// A maximum must never widen, so both paths round down to 2 decimals, in integers (1e-8 units).
export function maxAedFor({ maxPrice, currency }: Intent): string | null {
  if (maxPrice === null) return null;
  const units = BigInt(maxPrice.toFixed(8).replace('.', ''));
  const cents = (currency === 'USD' ? units * AED_PER_USD_E4 / 10_000n : units) / 1_000_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
