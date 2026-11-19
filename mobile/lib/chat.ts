// In Chat the model only reads a message into a search or a payment the user made. It never decides or pays: code does the rest.
export const CHAT_SYSTEM = 'Read the message and output only the JSON. Intent "search": a short product query to find. Intent "paid": the user already paid; merchant as named, amount as stated. Otherwise "other". Unused fields are empty or null. Set maxPrice and currency only when the message states a price, and never mention a price the message did not give. Never promise a purchase; the reply only says what you will do.';

const AED_PER_USD_E4 = 36725n; // 3.6725, the same rate the order sheet shows

export type Intent = { intent: 'search' | 'paid' | 'other'; query: string; maxPrice: number | null; currency: 'AED' | 'USD' | null; merchant: string; amount: string; reply: string };

export const chatResponseFormat = { type: 'json_schema', json_schema: { name: 'shop_intent', strict: true, schema: {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['search', 'paid', 'other'] },
    query: { type: 'string', maxLength: 80 },
    maxPrice: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    currency: { anyOf: [{ type: 'string', enum: ['AED', 'USD'] }, { type: 'null' }] },
    merchant: { type: 'string', maxLength: 80 },
    amount: { type: 'string', maxLength: 40 },
    reply: { type: 'string', maxLength: 160 },
  },
  required: ['intent', 'query', 'maxPrice', 'currency', 'merchant', 'amount', 'reply'],
  additionalProperties: false,
} } };

const FALLBACK: Intent = { intent: 'other', query: '', maxPrice: null, currency: null, merchant: '', amount: '', reply: "Sorry, I didn't get that. Try 'find me headphones under 300 dirhams'." };
const KEYS = ['amount', 'currency', 'intent', 'maxPrice', 'merchant', 'query', 'reply'];
const CONTROL = /[\u0000-\u001f\u007f]/;
// The merchant reaches the savings model's prompt like a card tap's, so it is bounded and free of control characters too.
const plain = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !CONTROL.test(v);
const MAX_PRICE = 1e9; // keeps toFixed out of exponent notation

export function parseIntent(text: string): Intent {
  let v: any;
  try { v = JSON.parse(text); } catch { return FALLBACK; }
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join() !== KEYS.join()) return FALLBACK;
  // 0 is allowed: a maximum of nothing finds nothing, and the schema says minimum 0.
  const ok = (v.intent === 'search' || v.intent === 'paid' || v.intent === 'other') &&
    plain(v.query, 80) && plain(v.merchant, 80) && plain(v.amount, 40) &&
    typeof v.reply === 'string' && v.reply.length <= 160 &&
    (v.maxPrice === null || (typeof v.maxPrice === 'number' && Number.isFinite(v.maxPrice) && v.maxPrice >= 0 && v.maxPrice <= MAX_PRICE)) &&
    (v.currency === null || v.currency === 'AED' || v.currency === 'USD');
  return ok ? { intent: v.intent, query: v.query, maxPrice: v.maxPrice, currency: v.currency, merchant: v.merchant, amount: v.amount, reply: v.reply } : FALLBACK;
}

// shortcut: any number in the message ("one eSIM", "50 GB") keeps the model's price; upgrade: compare the stated amounts with maxPrice.
const NUMBER = /\p{Nd}|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/iu;

const ASK_PAID: Intent = { ...FALLBACK, reply: 'How much did you pay, and where?' };
const ASK_WHAT: Intent = { ...FALLBACK, reply: 'What are you looking for?' };
// The numbers in a text as plain digits: Arabic-Indic digits as 0-9, separators and a cents part of zeros dropped ("1,000" and "45.00" read 1000 and 45).
const numbers = (text: string) => (text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) & 0xf)).match(/\d[\d.,]*/g) ?? [])
  .map(n => n.replace(/[.,]$/, '').replace(/[.,]0{1,2}$/, '').replace(/[.,]/g, ''));

// Words too common to name a thing, so they need not come from the message.
const FILLER = new Set(['gift', 'card', 'for', 'the', 'a', 'an', 'of', 'cheap', 'best', 'new', 'buy', 'find', 'me', 'i', 'need', 'want']);
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const naming = (word: string) => word.length > 2 && !FILLER.has(word);
// A word the user said, allowing a cut-off ("airpod" for "airpods") or a plural, but not a longer name ("apple" for "app"),
// or written without the user's spaces and dashes ("wh1000xm5" for "WH-1000XM5").
const saidIn = (message: string) => {
  const said = words(message).filter(w => w.length > 2), joined = message.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return (word: string) => said.some(w => w.startsWith(word) || (word.startsWith(w) && /^e?s$/.test(word.slice(w.length)))) || (word.length >= 4 && joined.includes(word));
};

// Code, not the model, decides whether a price was given: a 2B model fills one in unasked.
// The same for a payment: it needs a number the user said and a merchant, and the reply is code's, so it never claims a buy.
// Names must be the user's too: the model also decides merchants, and carries names like "NVIDIA" from that task into chat.
export function honest(intent: Intent, message: string): Intent {
  const said = saidIn(message);
  if (intent.intent === 'paid') {
    const merchant = intent.merchant.trim(), amount = intent.amount.trim();
    const digits = numbers(amount).join(''); // an amount in digits must be one the message has, not one the model made up
    const stated = digits ? numbers(message).includes(digits) : NUMBER.test(message);
    const named = words(merchant).filter(naming).every(said);
    return stated && named && merchant && amount ? { ...intent, merchant, amount, reply: `Note ${amount} at ${merchant}?` } : ASK_PAID;
  }
  if (intent.intent === 'search') {
    const kept = intent.query.split(/\s+/).filter(part => words(part).every(w => !naming(w) || said(w)));
    if (!kept.some(part => words(part).some(naming))) return ASK_WHAT;
    const query = kept.join(' ');
    intent = { ...intent, query, reply: `Searching for ${query}.` }; // the reply is code's too, so a name in it alone never shows
  }
  return NUMBER.test(message) ? intent : { ...intent, maxPrice: null, currency: null };
}

// A maximum must never widen, so both paths round down to 2 decimals, in integers (1e-8 units).
export function maxAedFor({ maxPrice, currency }: Intent): string | null {
  if (maxPrice === null) return null;
  const units = BigInt(maxPrice.toFixed(8).replace('.', ''));
  const cents = (currency === 'USD' ? units * AED_PER_USD_E4 / 10_000n : units) / 1_000_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
