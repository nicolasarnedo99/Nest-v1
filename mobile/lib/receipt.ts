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

// The receipt reader takes JPEG and PNG only; the picker is asked for compatible images, and anything else is refused here.
export function receiptPath(uri: string): string {
  const path = decodeURI(uri.replace(/^file:\/\//, ''));
  const type = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!type) throw new Error('That image has no file type; Nest reads JPEG or PNG');
  if (!['jpg', 'jpeg', 'png'].includes(type)) throw new Error(`That image is ${type.toUpperCase()}; Nest reads JPEG or PNG`);
  return path;
}
