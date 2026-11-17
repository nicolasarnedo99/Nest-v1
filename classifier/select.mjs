// Chooses one adapter from a training run, using only the validation rows.
//
//   node select.mjs --run=run2
//
// Every saved checkpoint, and the final adapter, is scored on the 30 rows held
// out of training. The rule was fixed before any score was seen: most correct,
// then fewest false buys, then the earliest step (the least-trained adapter
// that does the job). The winner is copied to adapters/<run>/selected.gguf.
// The test sets play no part in this.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const run = process.argv.find(item => item.startsWith('--run='))?.split('=')[1];
if (!run) throw new Error('Pass --run=<name>');
const here = name => fileURLToPath(new URL(name, import.meta.url));
const checkpoints = here(`adapters/${run}/checkpoints/`);
const candidates = readdirSync(checkpoints).filter(name => /^checkpoint_step_\d+$/.test(name)).sort()
  .map(name => ({ step: Number(name.split('_').pop()), path: `${checkpoints}${name}/model.gguf` }));
const final = here(`adapters/${run}/trained-lora-adapter.gguf`);
if (existsSync(final)) candidates.push({ step: Infinity, path: final });

const order = JSON.parse(readFileSync(here(`adapters/${run}/options.json`), 'utf8')).order ?? 'decision-first';
const scores = [];
for (const candidate of candidates) {
  const label = `${run}-${Number.isFinite(candidate.step) ? `step${String(candidate.step).padStart(4, '0')}` : 'final'}`;
  const result = here(`results/selection/${label}-validation.json`);
  if (!existsSync(result)) {
    execFileSync('node', [here('eval.mjs'), '--cases=validation', `--label=${label}`, '--dir=selection', `--order=${order}`, `--lora=${candidate.path}`], { stdio: 'ignore' });
  }
  const report = JSON.parse(readFileSync(result, 'utf8'));
  if (report.error || report.total === undefined) throw new Error(`${label}: evaluation did not complete`);
  scores.push({ label, step: candidate.step, path: candidate.path, correct: report.correct, total: report.total,
    falseBuys: report.falseBuys, missedBuys: report.missedBuys, invalid: report.invalid });
  console.log(`${label}: ${report.correct}/${report.total}, ${report.falseBuys} false buys, ${report.missedBuys} missed, ${report.invalid} invalid`);
}
const [best] = [...scores].sort((a, b) => b.correct - a.correct || a.falseBuys - b.falseBuys || a.step - b.step);
copyFileSync(best.path, here(`adapters/${run}/selected.gguf`));
writeFileSync(here(`adapters/${run}/selection.json`), JSON.stringify({
  rule: 'most correct on the 30 validation rows, then fewest false buys, then earliest step',
  selected: best.label, order, scores: scores.map(({ path, ...rest }) => ({ ...rest, step: Number.isFinite(rest.step) ? rest.step : 'final' })) }, null, 2) + '\n');
console.log(`Selected ${best.label} -> adapters/${run}/selected.gguf`);
