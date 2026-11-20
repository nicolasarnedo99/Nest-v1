import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createOcrProxyApp, createOcrReaderApp, OCR_MAX_BYTES, sameToken } from '../../server/ocr-proxy.js';

const TOKEN = 'test-token';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let stops: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(stops.map(stop => stop())); stops = []; });

async function serve(app: Express) {
  const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  stops.push(() => new Promise(done => { server.closeAllConnections(); server.close(() => done()); }));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/ocr`;
}
const post = (url: string, body: BodyInit, type = 'image/jpeg', headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': type, ...headers }, body });

// A fake reader standing in for QVAC: records what reached it and answers a fixed text.
async function fakeReader(read: (image: Buffer) => Promise<string> = async () => 'CAREEM\nTotal AED 45.00') {
  const seen: Buffer[] = [];
  const url = await serve(createOcrReaderApp({ token: TOKEN, timeoutMs: 200, read: async image => { seen.push(image); return read(image); } }));
  return { url, seen };
}

describe('sameToken', () => {
  it('accepts only the exact token, whatever the length of the guess', () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken('test-toke', TOKEN)).toBe(false);
    expect(sameToken(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(sameToken(undefined, TOKEN)).toBe(false);
  });
});

describe('the Mac reader: POST /ocr', () => {
  it('reads the raw image with the right token and answers its text', async () => {
    const { url, seen } = await fakeReader();
    const response = await post(url, JPEG, 'image/jpeg', { 'x-ocr-token': TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'CAREEM\nTotal AED 45.00' });
    expect(seen).toEqual([JPEG]);
  });

  it('refuses a missing or wrong token without reading', async () => {
    const { url, seen } = await fakeReader();
    expect((await post(url, JPEG)).status).toBe(401);
    expect((await post(url, JPEG, 'image/jpeg', { 'x-ocr-token': 'nope' })).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('refuses other types (415) and images over 6 MB (413)', async () => {
    const { url, seen } = await fakeReader();
    expect((await post(url, JPEG, 'image/heic', { 'x-ocr-token': TOKEN })).status).toBe(415);
    expect((await post(url, 'text', 'text/plain', { 'x-ocr-token': TOKEN })).status).toBe(415);
    expect((await post(url, new Uint8Array(OCR_MAX_BYTES + 1), 'image/png', { 'x-ocr-token': TOKEN })).status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('reads one image at a time', async () => {
    let running = 0, most = 0;
    const { url } = await fakeReader(async () => { most = Math.max(most, ++running); await new Promise(r => setTimeout(r, 20)); running--; return 'x'; });
    const answers = await Promise.all([1, 2, 3].map(() => post(url, JPEG, 'image/jpeg', { 'x-ocr-token': TOKEN })));
    expect(answers.map(a => a.status)).toEqual([200, 200, 200]);
    expect(most).toBe(1);
  });

  it('answers 504 when the read takes too long', async () => {
    const { url } = await fakeReader(() => new Promise(r => setTimeout(() => r('late'), 1000)));
    expect((await post(url, JPEG, 'image/jpeg', { 'x-ocr-token': TOKEN })).status).toBe(504);
  });
});

describe("morty's proxy: POST /ocr", () => {
  it('forwards the body and the token to the reader and passes the text back', async () => {
    const { url: upstream, seen } = await fakeReader();
    const url = await serve(createOcrProxyApp({ upstream, token: TOKEN }));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    const response = await post(url, png, 'image/png');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'CAREEM\nTotal AED 45.00' });
    expect(seen).toEqual([png]); // reaching the reader at all proves the token was sent
  });

  it('refuses other types (415) and images over 6 MB (413) before forwarding', async () => {
    const { url: upstream, seen } = await fakeReader();
    const url = await serve(createOcrProxyApp({ upstream, token: TOKEN }));
    expect((await post(url, JPEG, 'image/gif')).status).toBe(415);
    expect((await post(url, new Uint8Array(OCR_MAX_BYTES + 1))).status).toBe(413);
    expect(seen).toEqual([]);
  });

  it('turns a token mismatch at the reader (401) into a 502 the phone can show', async () => {
    const { url: upstream } = await fakeReader();
    const url = await serve(createOcrProxyApp({ upstream, token: 'wrong' }));
    const response = await post(url, JPEG);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The receipt reader is not configured right' });
  });

  it('answers 503 when OCR_UPSTREAM is not set', async () => {
    const url = await serve(createOcrProxyApp({ token: TOKEN }));
    const response = await post(url, JPEG);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The receipt reader is not configured' });
  });

  it('answers 503 when the reader is down or too slow', async () => {
    const down = await serve(createOcrProxyApp({ upstream: 'http://127.0.0.1:1/ocr', token: TOKEN }));
    const response = await post(down, JPEG);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The receipt reader is offline right now' });
    const slow = await serve(createOcrProxyApp({ upstream: 'http://127.0.0.1:1/ocr', token: TOKEN, timeoutMs: 50,
      doFetch: (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))) }));
    expect((await post(slow, JPEG)).status).toBe(503);
  });

  it('limits each address per hour (429), and frees it after the hour', async () => {
    let time = 0;
    const { url: upstream } = await fakeReader();
    const url = await serve(createOcrProxyApp({ upstream, token: TOKEN, perHour: 2, now: () => time }));
    expect((await post(url, JPEG)).status).toBe(200);
    expect((await post(url, JPEG)).status).toBe(200);
    expect((await post(url, JPEG)).status).toBe(429);
    time += 60 * 60_000;
    expect((await post(url, JPEG)).status).toBe(200);
  });
});
