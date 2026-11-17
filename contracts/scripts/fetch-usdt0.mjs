// Downloads the verified source of the deployed USD₮0 token implementation on
// Plasma from Sourcify and stores it unmodified under vendor/usdt0/.
//
// The files are Apache-2.0 and MIT licensed (see their headers). Nothing in
// them is edited: compile.mjs builds them with the compiler version and
// settings the deployed contract was verified with, and checks the result
// against the bytecode that is live on Plasma.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const USDT0_PLASMA = {
  chainId: 9745,
  proxy: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
  implementation: '0xF555A12bfFAEf20cC201A74ae6513Cb4aaDB34B9',
  rpc: 'https://rpc.plasma.to'
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = `https://sourcify.dev/server/v2/contract/${USDT0_PLASMA.chainId}/${USDT0_PLASMA.implementation}` +
    '?fields=compilation,sources';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sourcify answered ${response.status}`);
  const body = await response.json();
  if (body.match !== 'exact_match') throw new Error(`Expected an exact source match, got ${body.match}`);

  const vendor = new URL('../vendor/usdt0/', import.meta.url);
  for (const [path, { content }] of Object.entries(body.sources)) {
    const target = fileURLToPath(new URL(`sources/${path}`, vendor));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const { name, fullyQualifiedName, compilerVersion, compilerSettings } = body.compilation;
  writeFileSync(new URL('origin.json', vendor), JSON.stringify({
    ...USDT0_PLASMA, fetchedFrom: url, fetchedAt: new Date().toISOString(), sourcifyMatch: body.match,
    contract: name, fullyQualifiedName, compilerVersion, compilerSettings, files: Object.keys(body.sources).sort()
  }, null, 2) + '\n');
  console.log(`Saved ${Object.keys(body.sources).length} files for ${name} (${compilerVersion})`);
}
