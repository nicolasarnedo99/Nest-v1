// Turns train-source.json ([merchant, company, explanation] rows) into the
// chat-format JSONL that QVAC's fine-tuning reads. Deterministic: same input,
// same files. Any row whose merchant also appears in a test set is dropped,
// so the test sets always win over the training data.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CASE_SETS, COMPANIES, ORDERS, SYSTEM, answer, history } from './lib.mjs';

const here = name => new URL(name, import.meta.url);
const rows = JSON.parse(readFileSync(here('train-source.json'), 'utf8'));
const key = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const testKeys = new Set([...CASE_SETS.frozen(), ...CASE_SETS.blind()].map(([merchant]) => key(merchant)));

const seen = new Set();
const kept = [], dropped = [];
for (const row of rows) {
  const [merchant, company, explanation] = row;
  const words = typeof explanation === 'string' ? explanation.trim().split(/\s+/).length : 0;
  const valid = Array.isArray(row) && row.length === 3 && typeof merchant === 'string' && merchant.length > 0 &&
    [...COMPANIES, null].includes(company) && words >= 3 && words <= 8 && explanation.length <= 80;
  const reason = !valid ? 'invalid' : testKeys.has(key(merchant)) ? 'in a test set'
    : seen.has(key(merchant)) ? 'duplicate' : /carrefour/i.test(merchant) ? 'reserved for the live demo' : null;
  if (reason) { dropped.push({ merchant, reason }); continue; }
  seen.add(key(merchant));
  kept.push(row);
}

// Seeded shuffle (mulberry32) so the validation split is stable across runs.
let state = 20261113;
const random = () => { state |= 0; state = state + 0x6D2B79F5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
for (let i = kept.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [kept[i], kept[j]] = [kept[j], kept[i]]; }

const line = order => ([merchant, company, explanation]) =>
  JSON.stringify({ messages: [...history(merchant), { role: 'assistant', content: answer(order, company, explanation) }] });

const evalCount = 30;
const evalRows = kept.slice(0, evalCount), trainRows = kept.slice(evalCount);
// The same rows, in the same split, written once per field order.
// data/eval.jsonl is the validation set that lib.mjs reads.
mkdirSync(here('data/'), { recursive: true });
for (const order of ORDERS) {
  const suffix = order === 'decision-first' ? '' : `.${order}`;
  writeFileSync(here(`data/train${suffix}.jsonl`), trainRows.map(line(order)).join('\n') + '\n');
  writeFileSync(here(`data/eval${suffix}.jsonl`), evalRows.map(line(order)).join('\n') + '\n');
}

const count = list => Object.fromEntries([...COMPANIES, null].map(c => [String(c), list.filter(row => row[1] === c).length]));
console.log(JSON.stringify({ source: rows.length, kept: kept.length, dropped, train: trainRows.length,
  eval: evalRows.length, trainLabels: count(trainRows), evalLabels: count(evalRows),
  systemPromptChars: SYSTEM.length }, null, 2));
