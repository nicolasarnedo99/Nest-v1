// Scores the merchant classifier on one case set, with or without a LoRA adapter.
//
//   node eval.mjs --cases=frozen --label=before [--order=reason-first]
//   node eval.mjs --cases=blind  --label=after --lora=./adapters/run2/trained-lora-adapter.gguf
//   (--dir=<name> writes under results/<name>/, used by select.mjs)
//
// Each raw response is saved before it is parsed, so verify.mjs can recompute
// every verdict from the saved file without running the model again.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadModel, completion, unloadModel, cancel, close, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { CASE_SETS, MODEL_CONFIG, GENERATION, SYSTEM, schemaFor, responseFormat, history, assess, memoryMb } from './lib.mjs';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const setName = arg('cases') ?? 'frozen';
const label = arg('label') ?? 'before';
const lora = arg('lora') ? resolve(arg('lora')) : undefined;
const order = arg('order') ?? 'decision-first';
const RESPONSE_FORMAT = responseFormat(order);
if (!CASE_SETS[setName]) throw new Error(`Unknown case set: ${setName}`);
if (lora && !existsSync(lora)) throw new Error(`Adapter not found: ${lora}`);

const cases = CASE_SETS[setName]();
const outDir = new URL(`results/${arg('dir') ? `${arg('dir')}/` : ''}`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const outPath = new URL(`${label}-${setName}.json`, outDir);
const modelConfig = lora ? { ...MODEL_CONFIG, lora } : MODEL_CONFIG;
const report = { label, caseSet: setName, order, model: 'QWEN3_1_7B_INST_Q4', modelConfig, generationParams: GENERATION,
  responseFormat: RESPONSE_FORMAT, kvCache: false, system: SYSTEM, schema: schemaFor(order),
  startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

let modelId, exitCode = 0;
try {
  const loading = performance.now();
  modelId = await loadModel({ modelSrc: QWEN3_1_7B_INST_Q4, modelType: 'llamacpp-completion', modelConfig });
  report.modelLoadSeconds = (performance.now() - loading) / 1000;
  for (const [index, [merchant, expected]] of cases.entries()) {
    const row = { index, merchant, expected, timedOut: false, pass: false };
    report.cases.push(row);
    const start = performance.now();
    let timer;
    try {
      const run = completion({ modelId, kvCache: false, stream: false, captureThinking: true,
        history: history(merchant), generationParams: GENERATION, responseFormat: RESPONSE_FORMAT });
      timer = setTimeout(() => { row.timedOut = true; cancel({ requestId: run.requestId }).catch(() => {}); }, 15_000);
      row.raw = await run.final;
      save(); // Keep the untouched response before parsing it.
      Object.assign(row, assess(row.raw, expected, row.timedOut));
    } catch (error) { row.error = String(error); }
    finally { clearTimeout(timer); row.seconds = (performance.now() - start) / 1000; save(); }
    console.log(`${String(index + 1).padStart(2)} ${row.pass ? 'pass' : 'FAIL'} ${row.seconds.toFixed(2)}s ` +
      `expected=${expected} got=${JSON.stringify(row.parsed?.company)} | ${merchant}`);
  }
  const times = report.cases.map(row => row.seconds).sort((a, b) => a - b);
  report.p95Seconds = times[Math.ceil(times.length * .95) - 1];
  report.total = report.cases.length;
  report.correct = report.cases.filter(row => row.pass).length;
  // A false buy: nothing should be bought, and a valid company came back.
  report.falseBuys = report.cases.filter(row => row.expected === null && row.schemaValid && row.parsed.company !== null).length;
  // A missed buy: a company was expected, and null came back.
  report.missedBuys = report.cases.filter(row => row.expected !== null && row.schemaValid && row.parsed.company === null).length;
  report.invalid = report.cases.filter(row => !row.schemaValid).length;
  report.memory = memoryMb();
  console.log(`\n${label}/${setName}: ${report.correct}/${report.total} correct, ${report.falseBuys} false buys, ` +
    `${report.missedBuys} missed buys, ${report.invalid} invalid, p95 ${report.p95Seconds.toFixed(2)}s`);
} catch (error) {
  report.error = String(error); exitCode = 1; console.error(error);
} finally {
  if (modelId) await unloadModel({ modelId });
  await close();
  report.finishedAt = new Date().toISOString();
  save();
}
process.exit(exitCode);
