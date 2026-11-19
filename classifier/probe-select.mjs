// THROWAWAY probe (probe-2b-finetune): select.mjs for the mixed adapter. Delete after the probe.
//
//   node probe-select.mjs --run=run-2b-mixed --model=QWEN3_5_2B_MULTIMODAL_Q8_0
//
// Scores every checkpoint and the final adapter on the 30 decision validation rows plus the 30 chat
// validation rows (never the blind or held-out sets). Rule, fixed before any score was seen: most
// decisions correct + chat rows fully correct, then fewest false buys, then the earliest step.
// Copies the winner to adapters/<run>/selected.gguf.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=')[1];
const run = arg('run'), model = arg('model') ?? 'QWEN3_5_2B_MULTIMODAL_Q8_0';
if (!run) throw new Error('Pass --run=<name>');
const here = name => fileURLToPath(new URL(name, import.meta.url));
const checkpoints = here(`adapters/${run}/checkpoints/`);
const candidates = readdirSync(checkpoints).filter(name => /^checkpoint_step_\d+$/.test(name)).sort()
  .map(name => ({ step: Number(name.split('_').pop()), path: `${checkpoints}${name}/model.gguf` }));
const final = here(`adapters/${run}/trained-lora-adapter.gguf`);
if (existsSync(final)) candidates.push({ step: Infinity, path: final });

const scores = [];
for (const c of candidates) {
  const label = `${run}-${Number.isFinite(c.step) ? `step${String(c.step).padStart(4, '0')}` : 'final'}`;
  const dec = here(`results/probe-2b-selection/${label}-validation.json`), chat = here(`results/probe-2b-selection/${label}-chat-validation.json`);
  if (!existsSync(dec)) execFileSync('node', [here('eval.mjs'), '--cases=validation', `--label=${label}`, '--dir=probe-2b-selection', `--model=${model}`, `--lora=${c.path}`], { stdio: 'ignore' });
  if (!existsSync(chat)) execFileSync('node', [here('probe-chat-eval.mjs'), '--cases=validation', `--label=${label}`, '--dir=probe-2b-selection', `--model=${model}`, `--lora=${c.path}`], { stdio: 'ignore' });
  const d = JSON.parse(readFileSync(dec, 'utf8')), h = JSON.parse(readFileSync(chat, 'utf8'));
  if (d.error || d.total === undefined || h.error || h.total === undefined) throw new Error(`${label}: evaluation did not complete`);
  scores.push({ label, step: c.step, path: c.path, decisions: d.correct, falseBuys: d.falseBuys, chat: h.fullCorrect, invented: h.invented, total: d.correct + h.fullCorrect });
  console.log(`${label}: decisions ${d.correct}/30 (${d.falseBuys} false buys), chat ${h.fullCorrect}/30, invented ${h.invented}`);
}
const [best] = [...scores].sort((a, b) => b.total - a.total || a.falseBuys - b.falseBuys || a.step - b.step);
copyFileSync(best.path, here(`adapters/${run}/selected.gguf`));
writeFileSync(here(`adapters/${run}/selection.json`), JSON.stringify({
  rule: 'most decision validation correct + chat validation fully correct, then fewest false buys, then earliest step',
  selected: best.label, scores: scores.map(({ path, ...r }) => ({ ...r, step: Number.isFinite(r.step) ? r.step : 'final' })) }, null, 2) + '\n');
console.log(`Selected ${best.label} -> adapters/${run}/selected.gguf`);
