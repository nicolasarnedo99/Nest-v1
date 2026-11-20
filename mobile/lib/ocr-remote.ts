// receipt OCR: the phone sends the receipt image to POST /ocr on the lookup host, which has it read by QVAC OCR on
// Nest's server and answers { text }. One request, no retries; the image is not stored there.

// The picker hands over JPEG, and screenshots stay PNG; receiptPath has already refused anything else.
export const receiptContentType = (path: string) => /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';

// `origin` is the lookup agent's endpoint origin (lookupOrigin in faucet.ts). Errors carry the server's own `error` text.
export async function readReceiptRemote(doFetch: typeof fetch, origin: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const response = await doFetch(`${origin}/ocr`, { method: 'POST', headers: { 'Content-Type': contentType },
    body: bytes as BodyInit, signal: AbortSignal.timeout(45_000) }); // the server gives the reader 30 s
  const body = await response.json().catch(() => null) as { text?: unknown; error?: unknown } | null;
  if (response.status !== 200) throw new Error(typeof body?.error === 'string' ? body.error : `The receipt reader is unavailable (${response.status})`);
  if (typeof body?.text !== 'string') throw new Error('The receipt reader returned an unreadable answer');
  return body.text;
}
