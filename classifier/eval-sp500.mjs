// Scores a merchant pipeline on the blind set cases-sp500.json, offline (no payments).
//
//   node eval-sp500.mjs [--label=baseline] [--limit=N]
//
// The baseline is today's phone pipeline: step A, the five-company decision prompt from
// mobile/turtle.config.json on QWEN3_5_2B_MULTIMODAL_Q4_K_M with the adapter the app bundles
// (mobile/assets/turtle-adapter.gguf); step B, when A says null, findMerchant from server/lookup.ts
// on server/merchants.json, kept only if its listed parent is one of the app's companies (as App.tsx does).
// Category fallback is out of scope. Phase 4 imports `scoreCase` and `summarize` to score the new pipeline.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export const loadCases = () => JSON.parse(readFileSync(new URL('cases-sp500.json', import.meta.url), 'utf8')).cases;

// Share classes of one company count as the same pick.
const SAME = { GOOG: 'GOOGL', FOXA: 'FOX', NWSA: 'NWS' };
const norm = ticker => ticker ? (SAME[ticker.toUpperCase()] ?? ticker.toUpperCase()) : null;

// expected: { ticker, name } | null; pick: a ticker string or null.
export function scoreCase(expected, pick) {
  const want = norm(expected?.ticker), got = norm(pick);
  return { correct: want === got, wrongBuy: got !== null && got !== want, missed: want !== null && got === null };
}

// rows: [{ kind, expected, pick, seconds? }] → totals overall and by kind.
export function summarize(rows) {
  const tally = list => {
    const s = list.map(row => scoreCase(row.expected, row.pick));
    const times = list.map(row => row.seconds).filter(Number.isFinite);
    return { total: list.length, correct: s.filter(x => x.correct).length, wrongBuys: s.filter(x => x.wrongBuy).length,
      nulls: list.filter(row => norm(row.pick) === null).length, missed: s.filter(x => x.missed).length,
      meanSeconds: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null };
  };
  const byKind = {};
  for (const kind of [...new Set(rows.map(row => row.kind))]) byKind[kind] = tally(rows.filter(row => row.kind === kind));
  return { ...tally(rows), byKind };
}

// Self-check of the scoring rule.
{
  const a = { ticker: 'AMZN', name: 'Amazon' };
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!eq(scoreCase(a, 'AMZN'), { correct: true, wrongBuy: false, missed: false })) throw new Error('scoreCase: hit');
  if (!eq(scoreCase(a, null), { correct: false, wrongBuy: false, missed: true })) throw new Error('scoreCase: miss');
  if (!eq(scoreCase(a, 'AAPL'), { correct: false, wrongBuy: true, missed: false })) throw new Error('scoreCase: wrong');
  if (!eq(scoreCase(null, 'AAPL'), { correct: false, wrongBuy: true, missed: false })) throw new Error('scoreCase: false buy');
  if (!eq(scoreCase(null, null), { correct: true, wrongBuy: false, missed: false })) throw new Error('scoreCase: abstain');
  if (!scoreCase({ ticker: 'GOOGL' }, 'GOOG').correct) throw new Error('scoreCase: share class');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await runBaseline();

async function runBaseline() {
  const sdk = await import('@qvac/sdk');
  const { findMerchant } = await import('../server/lookup.ts');
  const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const label = arg('label') ?? 'baseline';
  const config = JSON.parse(readFileSync(new URL('../mobile/turtle.config.json', import.meta.url), 'utf8'));
  const lora = fileURLToPath(new URL('../mobile/assets/turtle-adapter.gguf', import.meta.url));
  // The five demo companies, by the names the model and the lookup table use.
  const TICKER = { Apple: 'AAPL', Alphabet: 'GOOGL', Microsoft: 'MSFT', Tesla: 'TSLA', NVIDIA: 'NVDA' };
  const cases = loadCases().slice(0, arg('limit') ? Number(arg('limit')) : undefined);
  const outDir = new URL('results/sp500/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const outPath = new URL(`${label}.json`, outDir);
  const report = { label, model: config.model, lora: 'mobile/assets/turtle-adapter.gguf', modelConfig: { device: 'gpu', ctx_size: 1024 },
    generationParams: config.generationParams, system: config.system, startedAt: new Date().toISOString(), cases: [] };
  const save = () => writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  // Same strict rule as parseDecision in App.tsx: anything else is an error, which buys nothing.
  const parseDecision = text => {
    const parsed = JSON.parse(text);
    const valid = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
      Object.keys(parsed).sort().join(',') === 'company,explanation' &&
      (parsed.company === null || config.companies.includes(parsed.company)) &&
      typeof parsed.explanation === 'string' && parsed.explanation.length >= 1 && parsed.explanation.length <= 80;
    if (!valid) throw new Error('not a valid decision');
    return parsed;
  };

  let modelId, exitCode = 0;
  try {
    const loading = performance.now();
    modelId = await sdk.loadModel({ modelSrc: sdk[config.model], modelType: 'llamacpp-completion', modelConfig: { ...report.modelConfig, lora } });
    report.modelLoadSeconds = (performance.now() - loading) / 1000;
    for (const [index, c] of cases.entries()) {
      const row = { index, descriptor: c.descriptor, kind: c.kind, expected: c.expected, pick: null, step: null };
      report.cases.push(row);
      const start = performance.now();
      let timer;
      try {
        const run = sdk.completion({ modelId, kvCache: false, stream: false,
          history: [{ role: 'system', content: config.system }, { role: 'user', content: JSON.stringify({ merchant: c.descriptor.trim() }) }],
          generationParams: config.generationParams, responseFormat: config.responseFormat });
        timer = setTimeout(() => { row.timedOut = true; sdk.cancel({ requestId: run.requestId }).catch(() => {}); }, 15_000);
        row.raw = await run.final;
        row.seconds = (performance.now() - start) / 1000;
        const decision = parseDecision(row.raw.contentText);
        row.modelCompany = decision.company; row.explanation = decision.explanation;
        if (decision.company) { row.pick = TICKER[decision.company]; row.step = 'model'; }
        else {
          // App.tsx keeps a lookup's listed parent only if it is one of its companies.
          row.lookup = findMerchant(c.descriptor);
          const listed = row.lookup.listedParent && config.companies.includes(row.lookup.listedParent) ? row.lookup.listedParent : null;
          if (listed) { row.pick = TICKER[listed]; row.step = 'lookup'; }
        }
      } catch (error) { row.error = String(error); row.seconds ??= (performance.now() - start) / 1000; }
      finally { clearTimeout(timer); }
      Object.assign(row, scoreCase(c.expected, row.pick));
      save();
      console.log(`${String(index + 1).padStart(3)} ${row.correct ? 'ok   ' : row.wrongBuy ? 'WRONG' : 'miss '} ${row.seconds.toFixed(2)}s ` +
        `${c.kind.padEnd(8)} want=${c.expected?.ticker ?? null} got=${row.pick}${row.step ? ` (${row.step})` : ''}${row.error ? ' ERR' : ''} | ${c.descriptor}`);
    }
    report.summary = { ...summarize(report.cases), errors: report.cases.filter(row => row.error).length,
      byStep: { model: report.cases.filter(row => row.step === 'model').length, lookup: report.cases.filter(row => row.step === 'lookup').length } };
    console.log('\n' + JSON.stringify(report.summary, null, 2));
  } catch (error) {
    report.error = String(error); exitCode = 1; console.error(error);
  } finally {
    if (modelId) await sdk.unloadModel({ modelId });
    await sdk.close();
    report.finishedAt = new Date().toISOString();
    save();
  }
  process.exit(exitCode);
}
