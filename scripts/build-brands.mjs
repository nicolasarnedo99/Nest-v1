#!/usr/bin/env node
// Builds mobile/assets/brands.json: every S&P 500 company and its consumer brands, for the on-phone merchant search.
//
// Sources
//   1. S&P 500 membership: the constituents table of Wikipedia's "List of S&P 500 companies" (MediaWiki parse API).
//   2. Company QIDs: the Wikipedia articles' wikibase_item page property.
//   3. Brands: Wikidata, read through the MediaWiki API (search + wbgetentities), not the SPARQL endpoint, which
//      times out on these joins and was rate-limited to 1 request/minute when this was written. Up to two hops down:
//        - items whose "parent organization" (P749) or "owned by" (P127) is the company or a first-hop item
//          (Alphabet → Google → YouTube);
//        - the company's or a first-hop item's "brand" (P1716);
//        - its "product or material produced" (P1056) only when that product names the owner as "manufacturer"
//          (P176) or "developer" (P178): a specific product (iPhone), not a generic class (automobile).
//   4. scripts/brands-manual.json: brands Nest handles that Wikidata misses, one cited source per row.
//
// Filter rules (an item is dropped when any applies)
//   - no English or default ('mul') label;
//   - dissolved or closed (P576, P3999), or of a class we never buy from (EXCLUDED_CLASSES: people, patents, buildings,
//     factories, single hotels, malls, railway lines, cruise ships, broadcast stations, exchanges, foundations,
//     sports teams, events, films and books, …; direct classes only, the API can't walk subclasses);
//   - its link to the owner is stale or minor: deprecated rank, an end time (P582) qualifier, or a P127 "owned by"
//     that is neither the only owner nor a majority share (P1107 ≥ 50%): index funds are "owners" of thousands of companies;
//   - its label reads as a legal or financial shell (SHELL: "… Holdings", "… Finance", "… Trust", "… Capital", …);
//   - it is itself an S&P 500 company (it gets its own row instead).
// Each company is also a brand row of itself. Output is sorted so diffs stay reviewable.
//
// Usage: node scripts/build-brands.mjs   (raw responses are cached gzipped in scripts/.cache/brands; delete to refresh)

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';

const ROOT = new URL('../', import.meta.url);
const CACHE = new URL('scripts/.cache/brands/', ROOT);
const OUT = new URL('mobile/assets/brands.json', ROOT);
const MANUAL = new URL('scripts/brands-manual.json', ROOT);
const UA = 'NestBrandTableBuilder/0.1 (brand table build script; Node fetch)';
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const SP500_PAGE = 'List of S&P 500 companies';
const GAP_MS = 1000; // one request a second; the API answered "too many requests" at full speed

const EXCLUDED_CLASSES = new Set([
  'Q5', // human
  'Q41176', 'Q1021645', 'Q11303', 'Q18142', 'Q1497375', 'Q811979', 'Q13226383', 'Q1048835', // buildings, structures, facilities, territories
  'Q83405', 'Q159719', 'Q820477', 'Q188913', 'Q1662011', // factory, power station, mine, plantation, industrial building
  'Q11446', 'Q11436', 'Q15056993', // ship, aircraft, aircraft family
  'Q157031', 'Q163740', 'Q708676', 'Q7210356', 'Q31855', // foundation, nonprofit, charity, political org, research institute
  'Q847017', 'Q476028', 'Q4438121', 'Q12973014', // sports club, football club, sports org, sports team
  'Q1656682', 'Q1190554', 'Q18608583', // event, occurrence, recurring event
  'Q11424', 'Q5398426', 'Q482994', 'Q571', 'Q7725634', // film, TV series, album, book, literary work
  'Q4167410', 'Q13406463', 'Q17633526', // Wikimedia disambiguation/list, Wikinews article
  'Q1076486', 'Q483110', 'Q55488', 'Q1248784', 'Q44782', 'Q2175765', // venues, railway station, airport, port, tram stop
  'Q3914', // school
  'Q43305660', 'Q253623', // United States patent, patent (companies are "owners" of tens of thousands)
  'Q27686', 'Q11315', 'Q76470', 'Q39804', 'Q728937', 'Q618123', 'Q15911738', 'Q10373548', // single hotels, malls, outlet centres, cruise ships, railway lines, sites, dams, distilleries
  'Q14350', 'Q1616075', 'Q475000', 'Q7309637', 'Q165194', // radio and TV stations, stock and regulated markets, APIs
]);
// Software and games stay: people pay for them by name (Minecraft, Microsoft 365).
const NOT_CLASSES = [...EXCLUDED_CLASSES].map(q => `P31=${q}`).join('|');
const SHELL = /\b(holdings?|finance|financing|funding|trust|capital|securities|investments?|partners|reinsurance|leasing|acquisition|treasury|properties|realty|pension|employees?|retirement|plan)\b/i;
const LEGAL_SUFFIX = /,?\s+(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|gmbh|s\.a\.s?\.?|b\.v\.|n\.v\.|plc|pty\.? ltd\.?|ag|s\.p\.a\.|co\.|corp\.?)$/i;

mkdirSync(CACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
let network = 0;

const RETRYABLE = new Set(['maxlag', 'ratelimited', 'cirrussearch-too-busy-error']);
const cached = name => new URL(name + '.json.gz', CACHE);
const readCache = file => (existsSync(file) ? JSON.parse(gunzipSync(readFileSync(file)).toString()) : undefined);

// GET a MediaWiki API URL; the raw body is cached by URL (unless `cache` is false) so reruns cost nothing.
async function api(base, params, cache = true) {
  const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })}`;
  const file = cached(createHash('sha1').update(url).digest('hex'));
  if (cache && existsSync(file)) return readCache(file);
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(Math.max(0, last + GAP_MS * (1 + attempt * attempt * 5) - Date.now()));
    last = Date.now();
    network++;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
    const text = await res.text();
    const body = text.startsWith('{') ? JSON.parse(text) : null;
    if (res.ok && body && !body.error) {
      if (cache) writeFileSync(file, gzipSync(text));
      return body;
    }
    if (body?.error && !RETRYABLE.has(body.error.code)) throw new Error(`${url}: ${body.error.code} ${body.error.info}`);
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000;
    console.error(`retry ${attempt + 1} (${res.status} ${(body?.error?.code ?? text.slice(0, 60)).replace(/\s+/g, ' ')})`);
    if (wait) await sleep(wait);
  }
  throw new Error(`gave up on ${url}`);
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// 1. Constituents table: rows of "|| {{NyseSymbol|MMM}}" then "|| [[3M]]" (or "[[Title|Shown name]]").
async function sp500() {
  const page = await api(WIKIPEDIA, { action: 'parse', page: SP500_PAGE, prop: 'wikitext|revid', section: '1' });
  const rows = [];
  for (const row of page.parse.wikitext.split(/\n\|-/).slice(1)) {
    const ticker = row.match(/\{\{\s*\w*Symbol\s*\|\s*([A-Z.]+)\s*\}\}/)?.[1];
    const link = row.match(/\n\|\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!ticker || !link) continue;
    rows.push({ ticker, title: link[1].trim(), name: (link[2] ?? link[1]).trim() });
  }
  if (rows.length < 495 || rows.length > 510) throw new Error(`expected ~503 S&P 500 rows, parsed ${rows.length}; the table layout changed`);
  return { rows, revid: page.parse.revid };
}

// 2. Wikipedia title → Wikidata QID, following redirects.
async function qidsFor(titles) {
  const out = new Map();
  for (const batch of chunks(titles, 50)) {
    const res = await api(WIKIPEDIA, { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: batch.join('|') });
    const alias = new Map();
    for (const n of [...(res.query.normalized ?? []), ...(res.query.redirects ?? [])]) alias.set(n.from, n.to);
    const byTitle = new Map(res.query.pages.map(p => [p.title, p.pageprops?.wikibase_item]));
    for (const t of batch) {
      let k = t;
      while (alias.has(k)) k = alias.get(k);
      out.set(t, byTitle.get(k));
    }
  }
  return out;
}

// 3. Wikidata entities, kept to what the rules read.
const entities = new Map();
// "proportion" (P1107) is a fraction, or a number with the percent unit (Q11229): 7.69% is 0.0769.
const shareOf = v => (v ? Number(v.amount) / (v.unit?.endsWith('/Q11229') ? 100 : 1) : NaN);
const ids = (e, p) => (e.claims?.[p] ?? []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak.datavalue?.value?.id).filter(Boolean);
// Cached one file per entity (raw wbgetentities JSON), so a changed candidate set refetches only new items.
async function fetchEntities(qids) {
  const todo = [...new Set(qids)].filter(q => !entities.has(q));
  const raw = new Map();
  for (const q of todo) { const e = readCache(cached(`entity-v2-${q}`)); if (e) raw.set(q, e); }
  const missing = todo.filter(q => !raw.has(q));
  for (const [i, batch] of chunks(missing, 50).entries()) {
    if (i % 20 === 0) console.error(`entities: ${i * 50}/${missing.length}`);
    const res = await api(WIKIDATA, { action: 'wbgetentities', ids: batch.join('|'), props: 'labels|aliases|claims', languages: 'en|mul' }, false);
    for (const [q, e] of Object.entries(res.entities)) { writeFileSync(cached(`entity-v2-${q}`), gzipSync(JSON.stringify(e))); raw.set(q, e); }
  }
  for (const [q, e] of raw) {
    const current = p => (e.claims?.[p] ?? []).filter(c => c.rank !== 'deprecated' && !c.qualifiers?.P582)
      .map(c => ({ id: c.mainsnak.datavalue?.value?.id, share: shareOf(c.qualifiers?.P1107?.[0]?.datavalue?.value) }))
      .filter(c => c.id);
    // "Owned by" lists shareholders too (an index fund owns a slice of everything): count it only as the sole owner or a majority share.
    const owned = current('P127');
    const holders = owned.filter(c => c.share >= 0.5 || (owned.length === 1 && !(c.share < 0.5)));
    entities.set(q, {
      label: (e.labels?.en ?? e.labels?.mul)?.value, // many items now keep their name only as the 'mul' default label
      aliases: [...(e.aliases?.en ?? []), ...(e.aliases?.mul ?? [])].map(a => a.value),
      classes: ids(e, 'P31'),
      closed: Boolean(e.claims?.P576 || e.claims?.P3999),
      owners: [...new Set([...current('P749'), ...holders].map(c => c.id))],
      brands: ids(e, 'P1716'),
      products: ids(e, 'P1056'),
      makers: [...ids(e, 'P176'), ...ids(e, 'P178')],
    });
  }
}

// Items naming any of `owners` as parent organization or owner (the search index has every item-valued statement).
async function childrenOf(owners) {
  const found = new Set();
  for (const batch of chunks(owners, 12)) {
    const terms = batch.flatMap(q => [`P749=${q}`, `P127=${q}`]).join('|');
    for (let offset = 0; offset !== undefined;) {
      const res = await api(WIKIDATA, { action: 'query', list: 'search', srsearch: `haswbstatement:${terms} -haswbstatement:P576 -haswbstatement:${NOT_CLASSES}`, srnamespace: '0', srlimit: '500', srprop: '', sroffset: String(offset) });
      if (res.query.searchinfo.totalhits > 10000) throw new Error(`search caps at 10,000 hits; ${batch.join(',')} has ${res.query.searchinfo.totalhits}: use smaller batches`);
      for (const hit of res.query.search) found.add(hit.title);
      offset = res.continue?.sroffset;
    }
  }
  return [...found];
}

const keep = e => e?.label && !/^(Template|Category):/.test(e.label) && !e.closed && !e.classes.some(c => EXCLUDED_CLASSES.has(c)) && !SHELL.test(e.label);
const clean = name => name.replace(LEGAL_SUFFIX, '').replace(/\s*&$/, '').trim(); // "JPMorgan Chase & Co." → "JPMorgan Chase"

async function main() {
  const manual = JSON.parse(readFileSync(MANUAL, 'utf8'));
  const { rows, revid } = await sp500();
  const qids = await qidsFor(rows.map(r => r.title));
  // brands-manual.json names the item when the list's link has no article (a red link) or redirects into another company's.
  const companies = rows.map(r => ({ ticker: r.ticker, name: r.name, qid: manual.companyQids[r.ticker]?.qid ?? qids.get(r.title) }));
  const missing = companies.filter(c => !c.qid);
  if (missing.length) throw new Error(`no Wikidata item for ${missing.map(c => c.ticker).join(', ')}: add them to companyQids in brands-manual.json`);
  // Share classes (GOOGL/GOOG, FOXA/FOX, NWSA/NWS) are one company: it keeps the first ticker listed, for its row and its brands.
  const tickerOf = new Map();
  for (const c of companies) {
    const first = companies.find(o => o.ticker === tickerOf.get(c.qid));
    if (first && first.name !== c.name) throw new Error(`${first.ticker} and ${c.ticker} resolve to one item (${c.qid}) but name different companies: add companyQids`);
    if (!first) tickerOf.set(c.qid, c.ticker);
  }
  await fetchEntities([...tickerOf.keys()]);

  const found = new Map(); // brand qid → Set(ticker)
  let frontier = new Map([...tickerOf]); // qid → ticker of the S&P company it rolls up to
  for (let hop = 1; hop <= 2; hop++) {
    const kids = await childrenOf([...frontier.keys()]);
    const forward = [...frontier.keys()].flatMap(q => [...entities.get(q).brands, ...entities.get(q).products]);
    await fetchEntities([...kids, ...forward]);
    const next = new Map();
    const add = (q, ticker) => {
      if (tickerOf.has(q) || !keep(entities.get(q))) return;
      if (!found.has(q)) found.set(q, new Set());
      if (found.get(q).has(ticker)) return;
      found.get(q).add(ticker);
      next.set(q, ticker);
    };
    for (const q of kids) for (const o of entities.get(q)?.owners ?? []) if (frontier.has(o)) add(q, frontier.get(o));
    for (const [f, ticker] of frontier) {
      const e = entities.get(f);
      for (const b of e.brands) add(b, ticker);
      for (const p of e.products) if (entities.get(p)?.makers.includes(f)) add(p, ticker);
    }
    console.error(`hop ${hop}: ${kids.length} candidates, ${next.size} kept`);
    frontier = next;
  }

  const brands = new Map(); // `${name}|${ticker}` → row
  const put = (name, aliases, ticker, qid) => {
    name = clean(name);
    const key = `${name.toLowerCase()}|${ticker}`;
    const row = brands.get(key) ?? { name, aliases: [], company: ticker, ...(qid ? { qid } : {}) };
    const seen = new Set([row.name.toLowerCase(), ...row.aliases.map(a => a.toLowerCase())]);
    for (const a of aliases.map(clean)) if (a.length > 1 && !seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); row.aliases.push(a); }
    brands.set(key, row);
  };
  for (const c of companies) {
    const e = entities.get(c.qid);
    put(c.name, [e.label, ...e.aliases].filter(Boolean), tickerOf.get(c.qid), c.qid);
  }
  for (const [q, tickers] of found) for (const t of tickers) put(entities.get(q).label, entities.get(q).aliases, t, q);

  const known = new Set(companies.map(c => c.ticker));
  for (const m of manual.brands) {
    if (!known.has(m.company)) throw new Error(`brands-manual.json: ${m.name} → ${m.company} is not an S&P 500 ticker`);
    if (!m.source) throw new Error(`brands-manual.json: ${m.name} has no source`);
    put(m.name, m.aliases ?? [], m.company, m.qid);
  }

  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const out = {
    source: {
      sp500: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(SP500_PAGE.replaceAll(' ', '_'))}&oldid=${revid}`,
      brands: 'https://www.wikidata.org (P749 parent organization, P127 owned by, P1716 brand, P1056 product with P176/P178 = owner; two hops)',
      manual: 'scripts/brands-manual.json',
      license: 'Wikidata CC0; Wikipedia list CC BY-SA 4.0',
      builtAt: new Date().toISOString().slice(0, 10),
    },
    companies: companies.filter(c => tickerOf.get(c.qid) === c.ticker).sort((a, b) => order(a.ticker, b.ticker)), // one row per company
    brands: [...brands.values()].map(r => ({ ...r, aliases: r.aliases.sort(order) }))
      .sort((a, b) => order(a.company, b.company) || order(a.name.toLowerCase(), b.name.toLowerCase()) || order(a.name, b.name)),
  };
  const json = JSON.stringify(out).replace(/\},\{/g, '},\n{'); // one row per line: compact, and diffs stay line-sized
  writeFileSync(OUT, json + '\n');
  console.error(`${out.companies.length} companies, ${out.brands.length} brand rows, ${(json.length / 1e6).toFixed(2)} MB, ${network} network requests`);
}

main().catch(err => { console.error(err); process.exit(1); });
