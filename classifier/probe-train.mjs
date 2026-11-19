// THROWAWAY probe (probe-2b-finetune): train.mjs with --model=<QVAC constant>. Delete after the probe.
// LoRA fine-tunes Qwen3 1.7B on the merchant decision with QVAC.
//
//   node train.mjs --run=run1 [--order=reason-first] [--epochs=3] [--lr=1e-4] [--rank=16] [--alpha=32] [--checkpoint=90]
//                             [--train=data/train.jsonl] [--eval=data/eval.jsonl]
//
// Writes adapters/<run>/trained-lora-adapter.gguf and adapters/<run>/log.jsonl.
// Training holds the model exclusively, so nothing else can use it meanwhile.
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as sdk from '@qvac/sdk';
const { loadModel, finetune, unloadModel, close } = sdk;
import { memoryMb } from './lib.mjs';

const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
// The worker resolves relative paths against its own working directory, so
// every path handed to the SDK is absolute.
const abs = name => fileURLToPath(new URL(name, import.meta.url));
const run = arg('run');
const model = arg('model', 'QWEN3_5_2B_MULTIMODAL_Q4_K_M');
if (!sdk[model]) throw new Error(`Unknown model constant: ${model}`);
if (!run) throw new Error('Pass --run=<name>');
const outDir = abs(`adapters/${run}/`);
if (existsSync(outDir)) throw new Error(`${outDir} exists; pick a new --run name so results are never overwritten`);
mkdirSync(outDir, { recursive: true });

const contextLength = Number(arg('context', 512));
// Which field order the training file uses; select.mjs and eval.mjs read it back from options.json.
const order = arg('order', 'decision-first');
const suffix = order === 'decision-first' ? '' : `.${order}`;
const options = {
  trainDatasetDir: abs(arg('train', `data/train${suffix}.jsonl`)),
  validation: { type: 'dataset', path: abs(arg('eval', `data/eval${suffix}.jsonl`)) },
  outputParametersDir: outDir,
  checkpointSaveDir: abs(`adapters/${run}/checkpoints/`),
  assistantLossOnly: true, // learn only from the answer, not from the prompt
  numberOfEpochs: Number(arg('epochs', 3)),
  learningRate: Number(arg('lr', 1e-4)),
  lrMin: 1e-6,
  contextLength,
  batchSize: contextLength,
  microBatchSize: contextLength,
  loraRank: Number(arg('rank', 16)),
  loraAlpha: Number(arg('alpha', 32)),
  loraModules: 'attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down',
  // Saves the adapter every N steps so the best one can be chosen on the validation rows.
  checkpointSaveSteps: Number(arg('checkpoint', 0))
};
writeFileSync(`${outDir}options.json`, JSON.stringify({ model, order, options }, null, 2) + '\n');
const log = entry => appendFileSync(`${outDir}log.jsonl`, JSON.stringify(entry) + '\n');

let modelId, exitCode = 0;
const started = performance.now();
try {
  modelId = await loadModel({ modelSrc: sdk[model], modelType: 'llamacpp-completion',
    modelConfig: { device: 'gpu', ctx_size: contextLength } });
  const handle = finetune({ modelId, options });
  let last = 0;
  for await (const tick of handle.progressStream) {
    log({ t: Math.round((performance.now() - started) / 1000), ...tick });
    if (performance.now() - last > 10_000 || !tick.is_train) {
      last = performance.now();
      console.log(`epoch ${tick.current_epoch + 1} step ${tick.global_steps} batch ${tick.current_batch}/${tick.total_batches} ` +
        `${tick.is_train ? 'train' : 'val'} loss=${tick.loss?.toFixed(4)} acc=${tick.accuracy?.toFixed(4)} eta=${Math.round((tick.eta_ms ?? 0) / 1000)}s`);
    }
  }
  const result = await handle.result;
  const summary = { result, seconds: Math.round((performance.now() - started) / 1000), memory: memoryMb() };
  log({ summary });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  log({ error: String(error) }); console.error(error); exitCode = 1;
} finally {
  if (modelId) await unloadModel({ modelId, clearStorage: false });
  await close();
}
process.exit(exitCode);
