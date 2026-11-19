// THROWAWAY probe (probe-2b-finetune): scores the chat extraction the way the app runs it
// (mobile/App.tsx: CHAT_SYSTEM, {message} as JSON, predict 192, chatResponseFormat, ctx 1024, no kv cache),
// then through parseIntent + honest() from mobile/lib/chat.ts. Delete after the probe.
//
//   node probe-chat-eval.mjs --cases=heldout|validation --label=x [--model=QWEN3_5_2B_MULTIMODAL_Q4_K_M] [--lora=path] [--dir=probe-2b]
//
// Also samples the resident memory of the model worker every 500 ms and records the peak.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as sdk from '@qvac/sdk';
import { CHAT_SYSTEM, chatResponseFormat, parseIntent, honest } from '../mobile/lib/chat.ts';
import { memoryMb } from './lib.mjs';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const setName = arg('cases') ?? 'heldout';
const label = arg('label') ?? 'chat';
const model = arg('model') ?? 'QWEN3_5_2B_MULTIMODAL_Q4_K_M';
const lora = arg('lora') ? resolve(arg('lora')) : undefined;
if (!sdk[model]) throw new Error(`Unknown model constant: ${model}`);
if (lora && !existsSync(lora)) throw new Error(`Adapter not found: ${lora}`);
const cases = JSON.parse(readFileSync(new URL(`data/probe-chat-${setName}.json`, import.meta.url), 'utf8'));
const outDir = new URL(`results/${arg('dir') ?? 'probe-2b'}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const outPath = new URL(`${label}-chat-${setName}.json`, outDir);
const GENERATION = { temp: 0, predict: 192, reasoning_budget: 0 }; // turtle.config.json generationParams + App.tsx predict
const modelConfig = { device: 'gpu', ctx_size: 1024, ...(lora ? { lora } : {}) };

const norm = s => s.toLowerCase().replace(/(\d+)\s*gb/g, '$1gb').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = s => (s.match(/\d+/g) ?? []).join(',');
export function score(e, got, raw) {
  const intentOk = got.intent === e.intent;
  let fieldsOk = intentOk;
  if (intentOk && e.intent === 'search') {
    const words = new Set(norm(got.query).split(' '));
    fieldsOk = norm(e.query).split(' ').every(w => words.has(w)) && got.maxPrice === e.maxPrice && got.currency === e.currency;
  }
  if (intentOk && e.intent === 'paid') fieldsOk = got.merchant.toLowerCase() === e.merchant.toLowerCase() && digits(got.amount) === digits(e.amount);
  // An invented price: the user gave none and one survives (after honest) / came out of the model (raw).
  const noPrice = e.intent === 'search' && e.maxPrice === null;
  return { intentOk, fieldsOk, invented: noPrice && got.maxPrice !== null, inventedRaw: noPrice && raw?.maxPrice != null };
}
// Self-check of the scorer.
{
  const e = { intent: 'search', query: '15GB eSIM Vietnam', maxPrice: null, currency: null };
  const s = score(e, { intent: 'search', query: 'Vietnam eSIM 15 GB', maxPrice: 20, currency: 'USD' }, { maxPrice: 20 });
  if (!s.intentOk || s.fieldsOk || !s.invented || !s.inventedRaw) throw new Error('scorer self-check failed');
  const p = score({ intent: 'paid', merchant: 'Bolt', amount: '$7' }, { intent: 'paid', merchant: 'bolt', amount: '7 USD' });
  if (!p.fieldsOk) throw new Error('scorer self-check failed (paid)');
}

const report = { label, caseSet: setName, model, modelConfig, generationParams: GENERATION, startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
let peak = 0;
const sample = () => { const mb = memoryMb().filter(r => r.command.includes('bare')).reduce((a, r) => a + r.rssMb, 0); peak = Math.max(peak, mb); };
const sampler = setInterval(sample, 500);

let modelId, exitCode = 0;
try {
  const t0 = performance.now();
  modelId = await sdk.loadModel({ modelSrc: sdk[model], modelType: 'llamacpp-completion', modelConfig });
  report.modelLoadSeconds = (performance.now() - t0) / 1000;
  for (const [index, { message, expected }] of cases.entries()) {
    const row = { index, message, expected };
    report.cases.push(row);
    const start = performance.now();
    try {
      const final = await sdk.completion({ modelId, kvCache: false, stream: false,
        history: [{ role: 'system', content: CHAT_SYSTEM }, { role: 'user', content: JSON.stringify({ message }) }],
        generationParams: GENERATION, responseFormat: chatResponseFormat }).final;
      row.text = final.contentText;
      let raw; try { raw = JSON.parse(final.contentText); } catch {}
      row.parsed = parseIntent(final.contentText);
      row.parseFailed = row.parsed.reply.startsWith("Sorry, I didn't get that");
      row.got = honest(row.parsed, message);
      Object.assign(row, score(expected, row.got, raw));
    } catch (error) { row.error = String(error); }
    row.seconds = (performance.now() - start) / 1000;
    save();
    console.log(`${String(index + 1).padStart(2)} ${row.fieldsOk ? 'pass' : 'FAIL'} ${row.got?.intent}/${expected.intent} ` +
      `q=${JSON.stringify(row.got?.query)} p=${row.got?.maxPrice} m=${JSON.stringify(row.got?.merchant)} a=${JSON.stringify(row.got?.amount)} | ${message}`);
  }
  const n = report.cases.length, count = key => report.cases.filter(r => r[key]).length;
  const noPrice = report.cases.filter(r => r.expected.intent === 'search' && r.expected.maxPrice === null).length;
  Object.assign(report, { total: n, intentCorrect: count('intentOk'), fullCorrect: count('fieldsOk'), parseFailed: count('parseFailed'),
    noPriceSearches: noPrice, invented: count('invented'), inventedRaw: count('inventedRaw'),
    byIntent: Object.fromEntries(['search', 'paid', 'other'].map(i => [i, `${report.cases.filter(r => r.expected.intent === i && r.fieldsOk).length}/${report.cases.filter(r => r.expected.intent === i).length}`])) });
  sample();
  report.peakWorkerRssMb = peak;
  console.log(`\n${label}/${setName}: intent ${report.intentCorrect}/${n}, full ${report.fullCorrect}/${n}, ` +
    `invented ${report.invented}/${noPrice} (raw ${report.inventedRaw}), parse failures ${report.parseFailed}, peak RSS ${peak} MB, ${JSON.stringify(report.byIntent)}`);
} catch (error) {
  report.error = String(error); exitCode = 1; console.error(error);
} finally {
  clearInterval(sampler);
  if (modelId) await sdk.unloadModel({ modelId });
  await sdk.close();
  report.finishedAt = new Date().toISOString();
  save();
}
process.exit(exitCode);
