// Frozen inference-only comparison. No wallet or application imports.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

function assess(raw, expected, timedOut) {
  let parsed, parseError;
  try { parsed = JSON.parse(raw.contentText); }
  catch (error) { parseError = String(error); }
  const schemaValid = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
    Object.keys(parsed).sort().join(',') === 'company,explanation' &&
    ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA', null].includes(parsed.company) &&
    typeof parsed.explanation === 'string' && parsed.explanation.length >= 1 && parsed.explanation.length <= 80;
  const complete = raw.stopReason === undefined || raw.stopReason === 'eos';
  return { parsed, parseError, schemaValid, complete,
    pass: !timedOut && complete && schemaValid && parsed.company === expected };
}

if (process.argv.includes('--self-test')) {
  const valid = { company: null, explanation: 'Independent merchant' };
  const output = value => ({ contentText: JSON.stringify(value), stopReason: 'eos' });
  assert(assess(output(valid), null, false).pass);
  assert(assess(output({ ...valid, company: 'Apple' }), 'Apple', false).pass);
  for (const value of [null, [], { ...valid, extra: true }, { ...valid, company: false },
    { ...valid, company: 'null' }, { ...valid, explanation: '' },
    { ...valid, explanation: 'x'.repeat(81) }, { company: null }]) {
    assert.equal(assess(output(value), null, false).pass, false);
  }
  assert.equal(assess({ contentText: '```json\n{}\n```' }, null, false).pass, false);
  assert.equal(assess({ ...output(valid), stopReason: 'length' }, null, false).pass, false);
  assert.equal(assess({ ...output(valid), stopReason: 'cancelled' }, null, false).pass, false);
  assert.equal(assess(output(valid), null, true).pass, false);
  assert.equal(assess(output({ ...valid, company: 'Apple' }), null, false).pass, false);
  console.log('Acceptance checks passed: invalid output never counts as abstention.');
  process.exit(0);
}

const { loadModel, completion, unloadModel, cancel, close } = await import('@qvac/sdk');
const startedAt = Date.now();
const deadline = Math.min(startedAt + 30 * 60_000, Date.parse('2026-09-12T11:44:00Z'));
if (deadline - startedAt < 20_000) throw new Error('Authorized session expired');
const base = name => new URL(name, import.meta.url);
const names = ['diagnostic-input.json', 'heldout-relationships.json', 'relationship-candidates.json', 'qvac.config.json'];
const bytes = Object.fromEntries(names.map(name => [name, readFileSync(base(name))]));
const hashes = Object.fromEntries(names.map(name => [name, createHash('sha256').update(bytes[name]).digest('hex')]));
const input = JSON.parse(bytes['diagnostic-input.json']);
const cases = [...input.cases, ...JSON.parse(bytes['heldout-relationships.json']).cases];
const system = JSON.parse(bytes['relationship-candidates.json']).candidates.find(item => item.id === 'relationships-a').system;
const config = JSON.parse(bytes['qvac.config.json']);
const model = config.serve.models['turtle-nemotron'];
assert.equal(cases.length, 36);
assert.equal(cases.filter(item => item[1] === null).length, 18);
const generationParams = { temp: 0, predict: 64, reasoning_budget: 0 };
const manifest = { startedAt: new Date(startedAt).toISOString(), deadline: new Date(deadline).toISOString(),
  hashes, system, schema: input.schema, cases, model, generationParams, kvCache: false,
  maxRequests: 72, requestsStarted: 0, arms: [], pass: false };
const manifestPath = base('grammar-comparison.json');
const lockPath = base('.grammar-comparison.lock');
writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt }), { flag: 'wx' });
let modelId, manifestCreated = false;
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
function memory() {
  const children = readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
  return [process.pid, ...children].map(pid => ({ pid: Number(pid),
    status: readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').filter(line => /^(Name|VmRSS|VmHWM):/.test(line)) }));
}
try {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  manifestCreated = true;
  for (const arm of ['on', 'off']) {
    const responseFormat = arm === 'on'
      ? { type: 'json_schema', json_schema: { name: 'merchant', strict: true, schema: input.schema } }
      : { type: 'text' };
    const reportPath = base(`evaluation-grammar-${arm}.json`);
    const report = { arm, hashes, system, schema: input.schema, model, generationParams,
      responseFormat, kvCache: false, cases: [], pass: false };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    const saveReport = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    manifest.arms.push({ arm, report: `evaluation-grammar-${arm}.json`, status: 'running' }); save();
    try {
      const loading = performance.now();
      modelId = await loadModel({ modelSrc: model.src, modelType: 'llamacpp-completion', modelConfig: model.config });
      report.modelLoadSeconds = (performance.now() - loading) / 1000;
      for (const [index, [merchant, expected]] of cases.entries()) {
        if (Date.now() + 20_000 >= deadline || manifest.requestsStarted >= 72) throw new Error('Comparison budget exhausted');
        manifest.requestsStarted++; save();
        const row = { index, group: index < 20 ? 'original' : 'regression', merchant, expected,
          timedOut: false, pass: false, startedAt: new Date().toISOString() };
        report.cases.push(row); saveReport();
        const start = performance.now();
        let timer;
        try {
          const run = completion({ modelId, kvCache: false, stream: false, captureThinking: true,
            history: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ merchant }) }],
            generationParams, responseFormat });
          row.requestId = run.requestId;
          timer = setTimeout(() => {
            row.timedOut = true; saveReport();
            cancel({ requestId: run.requestId }).catch(error => { row.cancelError = String(error); saveReport(); });
          }, 15_000);
          row.raw = await run.final;
          row.seconds = (performance.now() - start) / 1000;
          row.timedOut ||= row.seconds >= 15;
          saveReport(); // Preserve the untouched response before attempting JSON parsing.
          Object.assign(row, assess(row.raw, expected, row.timedOut));
        } catch (error) { row.error = String(error); row.pass = false; }
        finally { clearTimeout(timer); row.seconds = (performance.now() - start) / 1000; saveReport(); }
        console.log(JSON.stringify({ arm, case: index + 1, pass: row.pass, seconds: row.seconds }));
      }
      const times = report.cases.map(row => row.seconds).sort((a, b) => a - b);
      report.warmP95Seconds = times[Math.ceil(times.length * .95) - 1];
      report.correct = report.cases.filter(row => row.pass).length;
      report.falseEligible = report.cases.filter(row => row.expected === null && row.schemaValid && row.parsed.company !== null).length;
      report.invalid = report.cases.filter(row => !row.schemaValid).length;
      report.pass = report.cases.length === 36 && report.cases.every(row => row.pass) && report.warmP95Seconds <= 10;
      report.memory = memory();
    } catch (error) { report.error = String(error); throw error; }
    finally {
      if (modelId) { await unloadModel({ modelId }); modelId = undefined; }
      report.finishedAt = new Date().toISOString(); saveReport();
      Object.assign(manifest.arms.at(-1), { status: report.error ? 'error' : 'complete', pass: report.pass }); save();
    }
  }
  manifest.pass = manifest.arms.find(item => item.arm === 'off')?.pass === true;
  if (!manifest.pass) process.exitCode = 1;
} catch (error) {
  manifest.error = String(error); process.exitCode = 1;
} finally {
  try { if (modelId) await unloadModel({ modelId }); await close(); manifest.closed = true; }
  catch (error) { manifest.closeError = String(error); process.exitCode = 1; }
  manifest.finishedAt = new Date().toISOString();
  if (manifestCreated) save();
  unlinkSync(lockPath);
}
