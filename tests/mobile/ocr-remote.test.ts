import { describe, expect, it } from 'vitest';
import { lookupOrigin } from '../../mobile/lib/faucet.js';
import { readReceiptRemote, receiptContentType } from '../../mobile/lib/ocr-remote.js';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]);
const answer = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('receiptContentType: the picker JPEG and a PNG screenshot each go with their own type', () => {
  it('maps the extension', () => {
    expect(receiptContentType('/tmp/A1.jpg')).toBe('image/jpeg');
    expect(receiptContentType('/tmp/A1.JPEG')).toBe('image/jpeg');
    expect(receiptContentType('/tmp/IMG_0001.PNG')).toBe('image/png');
  });
});

describe('readReceiptRemote', () => {
  it("posts the bytes and their type to /ocr on the lookup's origin and returns the text", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const text = await readReceiptRemote(async (url, init) => { seen = { url: String(url), init: init! }; return new Response(JSON.stringify({ text: 'CAREEM\nAED 45' })); },
      lookupOrigin('https://morty.tail73d5db.ts.net/lookup'), BYTES, 'image/png');
    expect(text).toBe('CAREEM\nAED 45');
    expect(seen?.url).toBe('https://morty.tail73d5db.ts.net/ocr');
    expect(seen?.init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'image/png' }, body: BYTES });
  });

  it("shows the server's own error text, so the chat says why", async () => {
    await expect(readReceiptRemote(answer(503, { error: 'The receipt reader is offline right now' }), 'https://x', BYTES, 'image/jpeg'))
      .rejects.toThrow('The receipt reader is offline right now');
    await expect(readReceiptRemote(answer(429, { error: 'Too many receipts from here; try again in an hour' }), 'https://x', BYTES, 'image/jpeg'))
      .rejects.toThrow('Too many receipts from here');
    await expect(readReceiptRemote(answer(502, 'Bad gateway'), 'https://x', BYTES, 'image/jpeg')).rejects.toThrow('The receipt reader is unavailable (502)');
  });

  it('refuses an answer that is not exactly { text: string }', async () => {
    for (const body of [{}, { text: 42 }, 'not json', null])
      await expect(readReceiptRemote(answer(200, body), 'https://x', BYTES, 'image/jpeg')).rejects.toThrow('unreadable answer');
  });
});
