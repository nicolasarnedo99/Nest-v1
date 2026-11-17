// Shared, frozen pieces of the merchant classifier: prompt, schema, cases and
// the pass rule. The prompt, schema and the 36 frozen cases are read from the
// original spike so they cannot drift from what was evaluated in September.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const spike = name => new URL(`../spikes/qvac/${name}`, import.meta.url);
const json = url => JSON.parse(readFileSync(url, 'utf8'));

const input = json(spike('diagnostic-input.json'));
export const SCHEMA = input.schema;
export const SYSTEM = json(spike('relationship-candidates.json'))
  .candidates.find(item => item.id === 'relationships-a').system;
export const COMPANIES = ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA'];

export const CASE_SETS = {
  // 20 original + 16 added in September. Never used for training.
  frozen: () => [...input.cases, ...json(spike('heldout-relationships.json')).cases],
  // Written on 13 Nov by an agent that saw neither the 36 nor the training data.
  blind: () => json(new URL('cases-blind.json', import.meta.url)).cases,
  // The 30 rows held out of training by build-train.mjs. Used only to choose
  // between saved adapters, so the two test sets are never used for choosing.
  validation: () => readFileSync(new URL('data/eval.jsonl', import.meta.url), 'utf8').trim().split('\n').map(line => {
    const [, user, assistant] = JSON.parse(line).messages;
    return [JSON.parse(user.content).merchant, JSON.parse(assistant.content).company];
  })
};

export const MODEL_CONFIG = { device: 'gpu', ctx_size: 1024 };
export const GENERATION = { temp: 0, predict: 64, reasoning_budget: 0 };
// The same two fields in either order. 'decision-first' is the September
// schema: the model commits to a company or null, then explains. 'reason-first'
// makes it write the explanation before it decides. The grammar built from the
// schema fixes the order, so this is the only thing that differs.
export const ORDERS = ['decision-first', 'reason-first'];
// What the running demo uses: the order the fine-tune only worked with (FINDINGS.md).
export const DEMO_ORDER = 'reason-first';
export const schemaFor = order => order === 'reason-first'
  ? { ...SCHEMA, properties: { explanation: SCHEMA.properties.explanation, company: SCHEMA.properties.company }, required: ['explanation', 'company'] }
  : SCHEMA;
export const responseFormat = order => {
  if (!ORDERS.includes(order)) throw new Error(`Unknown order: ${order}`);
  return { type: 'json_schema', json_schema: { name: 'merchant', strict: true, schema: schemaFor(order) } };
};
// Written with the spacing the model produces under the grammar, so training
// text and inference output have the same shape.
export const answer = (order, company, explanation) => order === 'reason-first'
  ? `{"explanation": ${JSON.stringify(explanation)}, "company": ${JSON.stringify(company)}}`
  : `{"company": ${JSON.stringify(company)}, "explanation": ${JSON.stringify(explanation)}}`;

export const history = merchant => [
  { role: 'system', content: SYSTEM },
  { role: 'user', content: JSON.stringify({ merchant }) }
];

// Same rule as spikes/qvac/compare-grammar.mjs: output that is malformed,
// truncated or timed out never counts as an abstention.
export function assess(raw, expected, timedOut) {
  let parsed, parseError;
  try { parsed = JSON.parse(raw.contentText); }
  catch (error) { parseError = String(error); }
  const schemaValid = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
    Object.keys(parsed).sort().join(',') === 'company,explanation' &&
    [...COMPANIES, null].includes(parsed.company) &&
    typeof parsed.explanation === 'string' && parsed.explanation.length >= 1 && parsed.explanation.length <= 80;
  const complete = raw.stopReason === undefined || raw.stopReason === 'eos';
  return { parsed, parseError, schemaValid, complete,
    pass: !timedOut && complete && schemaValid && parsed.company === expected };
}

// Resident memory of this process and its direct children (the SDK runs the
// model in a worker process), in megabytes. macOS and Linux.
export function memoryMb() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/));
  return rows.filter(([pid, ppid]) => Number(pid) === process.pid || Number(ppid) === process.pid)
    .map(([pid, , rss, ...comm]) => ({ pid: Number(pid), rssMb: Math.round(Number(rss) / 1024), command: comm.join(' ') }));
}
