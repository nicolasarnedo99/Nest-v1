#!/usr/bin/env node
// Writes mobile/lib/logos-sp500.json: a Simple Icons mark and brand colour for each S&P 500 company it has one for, keyed by the
// name the app shows (mobile/scripts/stocks.mjs). The nine hand-checked marks in mobile/lib/logos.ts win over these.
//
//   npm pack simple-icons@16.37.0 && tar -xzf simple-icons-16.37.0.tgz      (CC0 path data; the marks stay their owners' trademarks)
//   node scripts/build-logos.mjs --icons <unpacked>/package
//
// A logo is taken only when Simple Icons has the company's own name, or a brand of the company that starts its name (Meta for Meta
// Platforms), or a named flagship below: looser brand matches put the wrong mark on a parent (BlackRock → BT, Walmart → ASDA).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { stockNames } from '../mobile/scripts/stocks.mjs';

const { values: { icons: dir } } = parseArgs({ options: { icons: { type: 'string' } } });
if (!dir) throw new Error('Pass --icons <unpacked simple-icons package>');
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const { companies, brands } = read('mobile/assets/brands.json');
const names = stockNames(companies, read('contracts/deployments/sepolia.json').stocks);
const icons = JSON.parse(readFileSync(`${dir}/data/simple-icons.json`, 'utf8'));

const FLAGSHIP = { GOOGL: 'Google', JPM: 'Chase', UPS: 'UPS', AMD: 'AMD', ADP: 'ADP', DE: 'John Deere', GE: 'General Electric', CHTR: 'Spectrum' };
const SKIP = new Set(['MRK']); // Simple Icons' Merck is Merck KGaA, a different company

const norm = t => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\b(the|inc|incorporated|corp|corporation|co|company|companies|plc|ltd|limited|holdings?|group|n v|nv|s a|sa|ag|se|lp|llc|class [a-c])\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const byName = new Map();
for (const i of icons) for (const t of [i.title, ...(i.aliases?.aka ?? [])]) { const k = norm(t); if (k && !byName.has(k)) byName.set(k, i); }
const own = new Map(); // ticker → its brand names
for (const b of brands) {
  const t = typeof b.company === 'number' ? companies[b.company]?.ticker : b.company;
  if (t) own.set(t, [...(own.get(t) ?? []), b.name, ...(b.aliases ?? [])]);
}

const out = {};
companies.forEach((c, i) => {
  if (SKIP.has(c.ticker)) return;
  const first = norm(c.name).split(' ')[0];
  const fromBrand = () => (own.get(c.ticker) ?? []).map(n => byName.get(norm(n))).filter(Boolean)
    .sort((a, b) => a.title.length - b.title.length).find(icon => norm(icon.title).split(' ')[0] === first);
  const icon = byName.get(norm(c.name)) ?? (FLAGSHIP[c.ticker] ? icons.find(x => x.title === FLAGSHIP[c.ticker]) : fromBrand());
  if (!icon) return;
  const path = readFileSync(`${dir}/icons/${icon.slug}.svg`, 'utf8').match(/ d="([^"]+)"/)?.[1];
  if (path) out[names[i]] = { color: `#${icon.hex}`, path };
});
writeFileSync(new URL('../mobile/lib/logos-sp500.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))) + '\n');
console.log(`${Object.keys(out).length} logos → mobile/lib/logos-sp500.json`);
