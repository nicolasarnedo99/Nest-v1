// THROWAWAY probe (phase 4): hand-rolled signed-byte cosine (mobile/lib/merchant.ts topBrands) against QVAC's
// createVectorIndex on the same EmbeddingGemma vectors, over the dev set queries only. Reports top-k agreement,
// recall of the expected brand's company in the top k, and per-query search time.
//
//   node probe-vector-index.mjs [--brands=../mobile/assets/brands.json] [--k=8]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as sdk from '@qvac/sdk';
import { brandDocument, brandQuery, readLine, rowsOf, topBrands } from '../mobile/lib/merchant.ts';

const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const here = path => fileURLToPath(new URL(path, import.meta.url));
const brandsPath = arg('brands', here('../mobile/assets/brands.json')), k = Number(arg('k', '8'));
const table = JSON.parse(readFileSync(brandsPath, 'utf8'));
const meta = JSON.parse(readFileSync(brandsPath.replace(/\.json$/, '.emb.json'), 'utf8'));
const bytes = readFileSync(brandsPath.replace(/\.json$/, '.emb'));
const rows = rowsOf(table);
const index = { dim: meta.dim, brand: Uint32Array.from(rows, r => r.brand), vectors: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
const cases = JSON.parse(readFileSync(here('cases-sp500-dev.json'), 'utf8')).cases;

const embedder = await sdk.loadModel({ modelSrc: sdk.EMBEDDINGGEMMA_300M_Q4_0, modelType: 'llamacpp-embedding' });
const out = {};
try {
  // QVAC's index gets full-precision vectors of every row (re-embedded here; the asset only keeps signed bytes).
  const full = [];
  for (let at = 0; at < rows.length; at += 64)
    full.push(...(await sdk.embed({ modelId: embedder, text: rows.slice(at, at + 64).map(r => brandDocument(r.text)) })).embedding);
  const truncate = v => { const p = v.slice(0, meta.dim); const n = Math.hypot(...p); return p.map(x => x / n); };
  for (const storage of [sdk.VectorIndexStorage.F32, sdk.VectorIndexStorage.Q8]) {
    const vi = await sdk.createVectorIndex({ dim: meta.dim, storage });
    // One add of all 12,934 rows crashed the worker; batches of 1,000 work.
    for (let at = 0; at < rows.length; at += 1000)
      await vi.add({ ids: rows.slice(at, at + 1000).map((_, i) => String(at + i)), vectors: full.slice(at, at + 1000).map(truncate) });
    let agree = 0, recallHand = 0, recallVi = 0, total = 0;
    const tHand = [], tVi = [];
    for (const c of cases) {
      const { merchant } = readLine(c.descriptor);
      if (!merchant) continue;
      const [q] = (await sdk.embed({ modelId: embedder, text: [brandQuery(merchant)] })).embedding;
      let t = performance.now();
      const hand = topBrands(q, index, table, k);
      tHand.push(performance.now() - t);
      t = performance.now();
      const hits = await vi.search({ query: truncate(q), k: k * 3 });
      tVi.push(performance.now() - t);
      const viBrands = [...new Set(hits.map(h => index.brand[Number(h.id)]))].slice(0, k);
      const handBrands = hand.map(h => h.brand);
      agree += handBrands.filter(b => viBrands.includes(b)).length / k;
      total++;
      if (c.expected) {
        const want = c.expected.ticker, tickerOf = b => { const co = table.brands[b].company; return co === null ? null : typeof co === 'number' ? table.companies[co].ticker : co; };
        recallHand += handBrands.some(b => tickerOf(b) === want);
        recallVi += viBrands.some(b => tickerOf(b) === want);
      }
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    out[storage] = { queries: total, topKAgreement: +(agree / total).toFixed(3), recallAtK: { hand: recallHand, vectorIndex: recallVi },
      msPerQuery: { hand: +mean(tHand).toFixed(2), vectorIndex: +mean(tVi).toFixed(2) } };
    await vi.dispose();
  }
  console.log(JSON.stringify({ rows: rows.length, dim: meta.dim, k, ...out }, null, 2));
} catch (error) { console.error("probe failed:", error); } finally {
  await sdk.unloadModel({ modelId: embedder }).catch(() => {});
  await sdk.close();
}
process.exit(0);
