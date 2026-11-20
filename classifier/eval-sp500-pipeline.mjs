// Scores the index-seller merchant pipeline (mobile/lib/merchant.ts: read → retrieve → pick) on the Mac with the
// phone's models, then the paid lookup as the fallback when the phone places nothing, as the app does. Offline: the
// lookup is findMerchant from server/lookup.ts called directly, no payment. Category fallback is out of scope.
//
//   node eval-sp500-pipeline.mjs [--cases=sp500|dev] [--label=pipeline] [--brands=../mobile/assets/brands.json] [--k=8] [--veto=1]
//
// Tune on --cases=dev (cases-sp500-dev.json) only; the blind set (cases-sp500.json) is for the final score.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as sdk from '@qvac/sdk';
import { findMerchant } from '../server/lookup.ts';
import { placeMerchant, rowsOf } from '../mobile/lib/merchant.ts';
import { scoreCase, summarize } from './eval-sp500.mjs';

const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const here = path => fileURLToPath(new URL(path, import.meta.url));
const set = arg('cases', 'sp500'), label = arg('label', set === 'sp500' ? 'pipeline' : `dev-${set === 'dev' ? 'pipeline' : set}`);
const k = Number(arg('k', '8'));
// --veto=1 also asks the 2B (with the app's adapter) to confirm each pick; off by default, see placeMerchant.
const veto = arg('veto', '0') === '1';
const brandsPath = arg('brands', here('../mobile/assets/brands.json'));
const cases = JSON.parse(readFileSync(here(set === 'sp500' ? 'cases-sp500.json' : 'cases-sp500-dev.json'), 'utf8')).cases;
const raw = readFileSync(brandsPath);
const table = JSON.parse(raw);
const meta = JSON.parse(readFileSync(brandsPath.replace(/\.json$/, '.emb.json'), 'utf8'));
const bytes = readFileSync(brandsPath.replace(/\.json$/, '.emb'));
const rows = rowsOf(table);
if (rows.length !== meta.rows || createHash('sha256').update(raw).digest('hex') !== meta.brands)
  throw new Error('brand index is stale: rerun node scripts/embed-brands.mjs');
const index = { dim: meta.dim, brand: Uint32Array.from(rows, row => row.brand), vectors: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };

const config = JSON.parse(readFileSync(here('../mobile/turtle.config.json'), 'utf8'));
const lora = here('../mobile/assets/turtle-adapter.gguf');
const modelConfig = { device: 'gpu', ctx_size: 1024 };
const generationParams = { temp: 0, predict: 64, reasoning_budget: 0 };
const outDir = here('results/sp500/');
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}${label}.json`;
const report = { label, cases: set, model: config.model, lora: 'mobile/assets/turtle-adapter.gguf', embedder: 'EMBEDDINGGEMMA_300M_Q4_0',
  brands: { path: brandsPath.replace(here('../'), ''), rows: rows.length, brands: table.brands.length, dim: meta.dim, indexBytes: bytes.byteLength },
  k, veto, modelConfig, generationParams, startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

let llm, embedder, exitCode = 0;
try {
  if (veto) llm = await sdk.loadModel({ modelSrc: sdk[config.model], modelType: 'llamacpp-completion', modelConfig: { ...modelConfig, lora } });
  embedder = await sdk.loadModel({ modelSrc: sdk.EMBEDDINGGEMMA_300M_Q4_0, modelType: 'llamacpp-embedding' });
  const calls = [];
  const complete = async (history, responseFormat) => {
    const run = sdk.completion({ modelId: llm, kvCache: false, stream: false, history, generationParams, responseFormat });
    const timer = setTimeout(() => sdk.cancel({ requestId: run.requestId }).catch(() => {}), 15_000);
    try {
      const final = await run.final;
      calls.push(final.contentText);
      if (final.stopReason && final.stopReason !== 'eos') throw new Error(`completion stopped: ${final.stopReason}`);
      return final.contentText;
    } finally { clearTimeout(timer); }
  };
  const embed = async text => (await sdk.embed({ modelId: embedder, text })).embedding;

  for (const [i, c] of cases.entries()) {
    const row = { index: i, descriptor: c.descriptor, kind: c.kind, expected: c.expected, pick: null, step: null };
    report.cases.push(row);
    calls.length = 0;
    const start = performance.now();
    try {
      const placed = await placeMerchant(c.descriptor, { embed, table, index, k, ...(veto ? { complete } : {}) });
      row.seconds = (performance.now() - start) / 1000;
      Object.assign(row, { merchant: placed.merchant, step: placed.step, explanation: placed.explanation,
        candidates: placed.candidates.map(x => `${x.name} → ${x.company?.ticker ?? '-'} ${x.score.toFixed(3)}`) });
      if (placed.company) row.pick = placed.company.ticker;
      else if (placed.step !== 'instruction') {
        // As the app: the phone placed nothing, so the paid lookup (now with S&P 500 parents) gets the raw line.
        // Never for an instruction: nothing is paid to look up text that is not a merchant.
        row.lookup = findMerchant(c.descriptor);
        if (row.lookup.ticker) { row.pick = row.lookup.ticker; row.step = 'lookup'; }
      }
    } catch (error) { row.error = String(error); row.seconds ??= (performance.now() - start) / 1000; }
    row.raw = [...calls];
    Object.assign(row, scoreCase(c.expected, row.pick));
    save();
    console.log(`${String(i + 1).padStart(3)} ${row.correct ? 'ok   ' : row.wrongBuy ? 'WRONG' : 'miss '} ${row.seconds.toFixed(2)}s ${c.kind.padEnd(8)} ` +
      `want=${c.expected?.ticker ?? null} got=${row.pick} (${row.step ?? 'error'}) | ${c.descriptor} → ${row.merchant ?? '∅'}${row.explanation ? ` «${row.explanation}»` : ''}` +
      `${row.error ? ` ERR ${row.error}` : ''}${!row.correct && row.candidates?.length ? ` [${row.candidates.join('; ')}]` : ''}`);
  }
  const times = report.cases.map(row => row.seconds).sort((a, b) => a - b);
  const steps = {};
  for (const row of report.cases) steps[row.step ?? 'error'] = (steps[row.step ?? 'error'] ?? 0) + 1;
  report.summary = { ...summarize(report.cases), errors: report.cases.filter(row => row.error).length, bySteps: steps,
    p95Seconds: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] };
  console.log('\n' + JSON.stringify(report.summary, null, 2));
} catch (error) {
  report.error = String(error); exitCode = 1; console.error(error);
} finally {
  if (llm) await sdk.unloadModel({ modelId: llm });
  if (embedder) await sdk.unloadModel({ modelId: embedder });
  await sdk.close();
  report.finishedAt = new Date().toISOString();
  save();
}
process.exit(exitCode);
