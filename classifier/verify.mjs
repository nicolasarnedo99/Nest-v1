// Recomputes every verdict from the raw model output saved in results/, with
// no model involved, and prints the table used in FINDINGS.md. Exits non-zero
// if any saved verdict or count disagrees with the recomputation.
import { readdirSync, readFileSync } from 'node:fs';
import { assess, CASE_SETS } from './lib.mjs';

const dir = new URL('results/', import.meta.url);
let mismatches = 0;
const rows = [];
for (const file of readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  const expected = CASE_SETS[report.caseSet]();
  const check = (condition, message) => { if (!condition) { mismatches++; console.error(`${file}: ${message}`); } };
  check(report.cases.length === expected.length, `has ${report.cases.length} cases, the set has ${expected.length}`);
  let correct = 0, falseBuys = 0, missedBuys = 0, invalid = 0;
  for (const [index, row] of report.cases.entries()) {
    const [merchant, want] = expected[index] ?? [];
    check(row.merchant === merchant && row.expected === want, `case ${index + 1} does not match the case set`);
    const verdict = row.raw ? assess(row.raw, want, row.timedOut) : { pass: false, schemaValid: false };
    check(verdict.pass === row.pass, `case ${index + 1} saved pass=${row.pass}, recomputed ${verdict.pass}`);
    if (verdict.pass) correct++;
    if (!verdict.schemaValid) invalid++;
    else if (want === null && verdict.parsed.company !== null) falseBuys++;
    else if (want !== null && verdict.parsed.company === null) missedBuys++;
  }
  for (const [name, value] of Object.entries({ correct, falseBuys, missedBuys, invalid })) {
    check(report[name] === value, `saved ${name}=${report[name]}, recomputed ${value}`);
  }
  rows.push({ run: report.label, cases: report.caseSet, order: report.order ?? 'decision-first', adapter: report.modelConfig.lora ? 'yes' : 'no',
    correct: `${correct}/${expected.length}`, falseBuys, missedBuys, invalid, p95s: report.p95Seconds?.toFixed(2) });
}
console.table(rows);
if (mismatches) { console.error(`${mismatches} mismatch(es)`); process.exit(1); }
console.log('Every saved verdict matches the recomputation.');
