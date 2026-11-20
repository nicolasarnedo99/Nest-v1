import { honest, parseIntent, type Intent } from './chat';

// A receipt read by QVAC OCR on Nest's server. Its text is untrusted (anyone can photograph anything), so it reaches
// the chat model's prompt bounded and plain; the chat's parseIntent and honest() then treat it like a typed message.

// The chat model runs with ctx_size 1024 tokens, which also holds the system prompt and the reply. A long receipt keeps its
// top (the merchant) and its bottom (the total), with a marker where the middle was cut.
export const RECEIPT_LIMIT = 1000;
const HEAD = 600, CUT = ' … ', TAIL = RECEIPT_LIMIT - HEAD - CUT.length;
const HIDDEN = /[\p{Cc}\p{Cf}]/gu; // control and format characters (bidi overrides, zero-width), never part of a receipt's words

export function cleanReceipt(text: string): string {
  const plain = text.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  return plain.length <= RECEIPT_LIMIT ? plain : `${plain.slice(0, HEAD).trimEnd()}${CUT}${plain.slice(-TAIL).trimStart()}`;
}

// "I paid" tells the model it is a payment made, which the chat reads as intent "paid".
export const receiptMessage = (text: string) => `I paid this receipt:\n${cleanReceipt(text)}`;

// A line that is only an amount with its currency code, as transaction screens show it; OCR reads the minus as ~ or a dash.
const AMOUNT = /^[~\-\u2012-\u2015\u2212]?\s*(?:([A-Z]{3})\s*)?(\d[\d,]*\.\d{2})\s*([A-Z]{3})?$/;

// Code reads a payment the receipt labels ("Merchant name" then the name, and an amount line), because the 2B drops cents
// ("96.60 AED" comes back "96"), which honest() rightly refuses. It goes through parseIntent and honest() like the model's.
// shortcut: only a labelled merchant and an amount-only line; other receipts go to the model.
export function receiptIntent(text: string): Intent | null {
  const lines = text.split('\n').map(cleanReceipt).filter(Boolean);
  const label = lines.findIndex(line => /^merchant( name)?$/i.test(line));
  const merchant = label >= 0 ? lines[label + 1] : undefined;
  const found = lines.map(line => line.match(AMOUNT)).find(m => m && !!m[1] !== !!m[3]); // exactly one currency code
  if (!merchant || !found) return null;
  const read = { intent: 'paid', query: '', maxPrice: null, currency: null, merchant, amount: `${found[2]} ${found[1] ?? found[3]}`, reply: '' };
  const intent = honest(parseIntent(JSON.stringify(read)), receiptMessage(text));
  return intent.intent === 'paid' ? intent : null;
}

// The receipt reader takes JPEG and PNG only; the picker is asked for compatible images, and anything else is refused here.
export function receiptPath(uri: string): string {
  const path = decodeURI(uri.replace(/^file:\/\//, ''));
  const type = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!type) throw new Error('That image has no file type; Nest reads JPEG or PNG');
  if (!['jpg', 'jpeg', 'png'].includes(type)) throw new Error(`That image is ${type.toUpperCase()}; Nest reads JPEG or PNG`);
  return path;
}
