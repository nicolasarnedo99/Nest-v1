// THROWAWAY feasibility probe (2026-11-20): does QVAC decide (LAYA typed decisions 421M) pick a merchant's category
// at least as well as the app's EmbeddingGemma match? Delete once the result is recorded.
//
//   node --experimental-strip-types probe-decide.mjs --method=embed    (the app's method, via mobile/lib/categories.ts)
//   node --experimental-strip-types probe-decide.mjs --method=decide   (LAYA, "None of these" as a 10th criterion)
//
// Writes results/probe-decide-<method>.json; each case is right when its pick (category name or null) is in `accept`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as sdk from '@qvac/sdk';
import { CATEGORIES, categoryDocument, categoryQuery, closestCategory } from '../mobile/lib/categories.ts';
import { memoryMb } from './lib.mjs';

const method = process.argv.find(a => a.startsWith('--method='))?.split('=')[1];
if (method !== 'embed' && method !== 'decide') throw new Error('--method=embed|decide');
const cases = JSON.parse(readFileSync(new URL('probe-decide-cases.json', import.meta.url), 'utf8'));
const NONE = 'None of these';
const LISTED = CATEGORIES.map(c => c.leader); // assumption: every leader is listed on the seller contract
const QUESTION = { category: { type: 'choice', instructions: 'Which category of business is this card payment merchant?',
  criteria: { ...Object.fromEntries(CATEGORIES.map(c => [c.name, c.text])), [NONE]: 'None of the categories above fits this merchant.' } } };

let peakMb = 0;
const sample = () => { peakMb = Math.max(peakMb, memoryMb().reduce((s, p) => s + p.rssMb, 0)); };
const poll = setInterval(sample, 200);

const src = method === 'embed' ? sdk.EMBEDDINGGEMMA_300M_Q4_0 : sdk.LAYA_TYPED_DECISIONS_421M_Q8_0;
const t0 = performance.now();
const modelId = await sdk.loadModel({ modelSrc: src, modelType: method === 'embed' ? 'llamacpp-embedding' : 'llamacpp-decision' });
const loadSeconds = (performance.now() - t0) / 1000;

const rows = [];
try {
  for (const c of cases) {
    const lookup = { operator: c.operator, note: c.note };
    const start = performance.now();
    let pick, detail;
    if (method === 'embed') {
      const { embedding } = await sdk.embed({ modelId, text: [categoryQuery(c.merchant, lookup, ''), ...CATEGORIES.map(categoryDocument)] });
      const [query, ...texts] = embedding;
      const match = closestCategory(query, texts, LISTED);
      pick = match?.name ?? null; detail = match;
    } else {
      // Same facts the app's embedding query carries, without EmbeddingGemma's task prefix.
      const state = `Merchant: ${c.merchant}. Run by ${c.operator}. ${c.note}`;
      const answer = (await sdk.decide({ modelId, state, questions: QUESTION })).answers.category;
      pick = answer.choice === NONE ? null : answer.choice; detail = { p: answer.probabilities[answer.choice], probabilities: answer.probabilities };
    }
    const ms = performance.now() - start;
    const verdict = c.accept.includes(pick) ? 'correct' : pick === null ? 'wrongly none' : 'wrong category';
    rows.push({ merchant: c.merchant, accept: c.accept, pick, verdict, ms: Math.round(ms), detail });
    sample();
    console.log(`${verdict.padEnd(14)} ${String(Math.round(ms)).padStart(5)}ms ${c.merchant} -> ${pick} (accept ${JSON.stringify(c.accept)})`);
  }
} finally {
  clearInterval(poll);
  await sdk.unloadModel({ modelId });
  await sdk.close();
}

const count = v => rows.filter(r => r.verdict === v).length;
const ms = rows.map(r => r.ms).sort((a, b) => a - b);
const summary = { method, model: src.name, sizeMb: Math.round(src.expectedSize / 1e6), loadSeconds: +loadSeconds.toFixed(1),
  total: rows.length, correct: count('correct'), wrongCategory: count('wrong category'), wronglyNone: count('wrongly none'),
  medianMs: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.ceil(ms.length * 0.95) - 1], peakRssMb: peakMb };
console.log('\n' + JSON.stringify(summary));
mkdirSync(new URL('results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`results/probe-decide-${method}.json`, import.meta.url), JSON.stringify({ summary, question: method === 'decide' ? QUESTION : undefined, rows }, null, 1) + '\n');
process.exit(0);
