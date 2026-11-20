#!/usr/bin/env node
// Precomputes the on-phone brand index: one EmbeddingGemma 300M (Q4_0, the phone's model) embedding per brand name and
// alias of mobile/assets/brands.json, cut to the first --dim dimensions (Matryoshka), normalised and stored as signed
// bytes in mobile/assets/brands.emb. mobile/assets/brands.emb.json records how it was built so the app can check it.
// Row order is rowsOf() in mobile/lib/merchant.ts, so the app rebuilds the row → brand map from brands.json.
//
//   node scripts/embed-brands.mjs [--brands=mobile/assets/brands.json] [--out=mobile/assets/brands.emb] [--dim=256]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { close, embed, loadModel, unloadModel, EMBEDDINGGEMMA_300M_Q4_0 } from '@qvac/sdk';
import { brandDocument, quantise, rowsOf } from '../mobile/lib/merchant.ts';

const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const brandsPath = arg('brands', 'mobile/assets/brands.json'), out = arg('out', 'mobile/assets/brands.emb'), dim = Number(arg('dim', '256'));
const raw = readFileSync(brandsPath);
const rows = rowsOf(JSON.parse(raw));
const vectors = new Int8Array(rows.length * dim);

const modelId = await loadModel({ modelSrc: EMBEDDINGGEMMA_300M_Q4_0, modelType: 'llamacpp-embedding' });
try {
  const started = performance.now();
  for (let at = 0; at < rows.length; at += 64) {
    const { embedding } = await embed({ modelId, text: rows.slice(at, at + 64).map(row => brandDocument(row.text)) });
    embedding.forEach((vector, i) => vectors.set(quantise(vector, dim), (at + i) * dim));
    process.stderr.write(`\r${Math.min(at + 64, rows.length)}/${rows.length}`);
  }
  process.stderr.write('\n');
  writeFileSync(out, vectors);
  const meta = { model: 'EMBEDDINGGEMMA_300M_Q4_0', document: brandDocument('{name}'), dim, rows: rows.length,
    brands: createHash('sha256').update(raw).digest('hex'), seconds: Math.round((performance.now() - started) / 100) / 10 };
  writeFileSync(`${out}.json`, JSON.stringify(meta, null, 2) + '\n');
  console.log(`${rows.length} rows × ${dim} → ${out} (${(vectors.byteLength / 1024).toFixed(0)} KiB) in ${meta.seconds} s`);
} finally {
  await unloadModel({ modelId });
  await close();
}
