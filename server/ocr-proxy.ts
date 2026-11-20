// receipt OCR: the phone's receipt image goes to POST /ocr on the lookup host (morty), which forwards it over Tailscale
// to the OCR reader on the Mac (server/ocr-service.ts), where QVAC OCR stays loaded. Both ends share the checks below.
// Neither end ever logs the image or its text: only sizes, durations and statuses.
import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { serial } from './faucet.js';

export const OCR_TYPES = ['image/jpeg', 'image/png'];
export const OCR_MAX_BYTES = 6 * 1024 * 1024;
export const OCR_TIMEOUT_MS = 30_000;
const HOUR = 60 * 60_000;

// The image routes: a JPEG or PNG body of at most 6 MB, read raw into a Buffer; anything else is refused before `handler` runs.
function imageApp(...handlers: RequestHandler[]) {
  const app = express();
  const typed: RequestHandler = (request, response, next) => {
    if (!request.is(OCR_TYPES)) { response.status(415).json({ error: 'Send a JPEG or PNG image' }); return; }
    next();
  };
  app.post('/ocr', typed, ...handlers.slice(0, -1), express.raw({ type: OCR_TYPES, limit: OCR_MAX_BYTES }), handlers.at(-1)!);
  const failed: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = (error as { status?: number }).status;
    if (status === 413) { response.status(413).json({ error: 'The image is over 6 MB' }); return; }
    response.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: 'Request failed' });
  };
  app.use(failed);
  return app;
}

// Constant-time, whatever the lengths: both sides are hashed to 32 bytes first.
export function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// The Mac side. `read` runs QVAC OCR on the image; reads go one at a time, and a request waits at most 30 s, queue included.
export function createOcrReaderApp(options: { token: string; read: (image: Buffer) => Promise<string>; timeoutMs?: number }) {
  const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
  const exclusive = serial();
  const authorized: RequestHandler = (request, response, next) => {
    if (!sameToken(request.get('x-ocr-token'), options.token)) { response.status(401).json({ error: 'Unauthorized' }); return; }
    next();
  };
  return imageApp(authorized, async (request, response) => {
    const image = request.body as Buffer, started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // shortcut: a timed-out read keeps running and holds the queue until it ends; QVAC has no cancel for one OCR call.
      const text = await Promise.race([exclusive(() => options.read(image)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
      console.log(`OCR read ${image.length} bytes in ${Date.now() - started} ms`);
      response.json({ text });
    } catch (error) {
      const timedOut = error instanceof Error && error.message === 'timeout';
      console.error(`OCR ${timedOut ? 'timed out' : 'failed'} on ${image.length} bytes after ${Date.now() - started} ms`);
      response.status(timedOut ? 504 : 500).json({ error: timedOut ? 'The read took over 30 s' : 'The OCR failed' });
    } finally { clearTimeout(timer); }
  });
}

// The public side on morty. Per-IP limit in memory (a restart resets it); `upstream` unset means the reader is not configured.
export function createOcrProxyApp(options: { upstream?: string; token?: string; perHour?: number; now?: () => number;
  timeoutMs?: number; doFetch?: typeof fetch }) {
  const now = options.now ?? Date.now, perHour = options.perHour ?? 30;
  const timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS, doFetch = options.doFetch ?? fetch;
  const recent = new Map<string, number[]>(); // ip → times of its requests in the last hour
  const limited: RequestHandler = (request, response, next) => {
    const time = now(), ip = request.ip ?? 'unknown';
    for (const [known, times] of recent) if (times.every(at => time - at >= HOUR)) recent.delete(known);
    const times = (recent.get(ip) ?? []).filter(at => time - at < HOUR);
    if (times.length >= perHour) { response.status(429).json({ error: 'Too many receipts from here; try again in an hour' }); return; }
    recent.set(ip, [...times, time]);
    next();
  };
  const app = imageApp(limited, async (request, response) => {
    const { upstream, token } = options;
    if (!upstream || !token) { response.status(503).json({ error: 'The receipt reader is not configured' }); return; }
    const image = request.body as Buffer, started = Date.now();
    let answer: Response;
    try {
      answer = await doFetch(upstream, { method: 'POST', headers: { 'Content-Type': request.get('content-type')!, 'x-ocr-token': token },
        body: new Uint8Array(image), signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      console.error(`OCR upstream unreachable or slow after ${Date.now() - started} ms (${image.length} bytes)`);
      response.status(503).json({ error: 'The receipt reader is offline right now' }); return;
    }
    const body = await answer.json().catch(() => null) as { text?: unknown; error?: unknown } | null;
    console.log(`OCR upstream ${answer.status} for ${image.length} bytes in ${Date.now() - started} ms`);
    if (answer.status === 200 && typeof body?.text === 'string') { response.json({ text: body.text }); return; }
    // A 401 means the two OCR_TOKEN values differ: a setup fault the user cannot fix, so it reads as not configured.
    if (answer.status === 401) { response.status(502).json({ error: 'The receipt reader is not configured right' }); return; }
    response.status(502).json({ error: typeof body?.error === 'string' ? body.error : `The receipt reader failed (${answer.status})` });
  });
  // Tailscale Funnel reaches the service from loopback with X-Forwarded-For, so request.ip is the phone's address.
  app.set('trust proxy', 'loopback');
  return app;
}
