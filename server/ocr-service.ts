// receipt OCR: the receipt reader on Nico's Mac. QVAC OCR stays loaded here; morty's POST /ocr forwards the phone's image to it.
// Env: OCR_TOKEN (required; morty sends the same value as x-ocr-token), OCR_PORT (default 8190; not 4190, which fetch refuses as a "bad port").
// Listens on 0.0.0.0 so morty can reach it over Tailscale; the token keeps everyone else on the network out.
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadModel, ocr, OCR_LATIN } from '@qvac/sdk';
import { createOcrReaderApp } from './ocr-proxy.js';

const environment = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(environment)) loadEnvFile(environment); // values already in the environment win

const token = process.env.OCR_TOKEN;
if (!token) throw new Error('Missing OCR_TOKEN');
const port = Number(process.env.OCR_PORT ?? 8190);

const started = Date.now();
// Measured on the M4 Max, a full-height iPhone screenshot: the default canvas (2560, magRatio 1.5) read in 8–12 s,
// canvasSize 1280 with magRatio 1 in 2.5–4.4 s with the same key text.
const modelId = await loadModel({ modelSrc: OCR_LATIN, modelConfig: { langList: ['en'], canvasSize: 1280, magRatio: 1 } });
console.log(`QVAC OCR ready in ${Date.now() - started} ms`);

// `as never`: the SDK types `image` with its own Buffer declaration, which Node's generic Buffer does not match; it is the same object at runtime.
const read = async (image: Buffer) =>
  (await ocr({ modelId, image: image as never, options: { paragraph: false } }).blocks).map(block => block.text).join('\n');
createOcrReaderApp({ token, read }).disable('x-powered-by')
  .listen(port, '0.0.0.0', () => console.log(`Receipt reader on http://0.0.0.0:${port}/ocr`));
