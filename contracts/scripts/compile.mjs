// Compiles the vendored USD₮0 implementation and this repo's own contracts
// with solc 0.8.4, and writes ABI and bytecode to artifacts/.
//
// For USD₮0 it then fetches the code live on Plasma and fails if the compiled
// runtime bytecode is not identical, so "a copy of the deployed USD₮0 token"
// is a checked statement, not a claim. Pass --offline to skip that check.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { USDT0_PLASMA } from './fetch-usdt0.mjs';

const require = createRequire(import.meta.url);
const solc = require('solc');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const walk = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

function compile(sources, settings, findImports) {
  const input = { language: 'Solidity', sources,
    settings: { ...settings, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), findImports ? { import: findImports } : undefined));
  const errors = (output.errors ?? []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  return output.contracts;
}

const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
const emit = (name, contract) => writeFileSync(join(artifacts, `${name}.json`), JSON.stringify({
  contractName: name, abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}` }, null, 2) + '\n');

// 1. USD₮0, exactly as verified: every source file inline, original settings.
const origin = JSON.parse(read('vendor/usdt0/origin.json'));
if (!solc.version().startsWith(origin.compilerVersion.split('+')[0])) {
  throw new Error(`solc ${solc.version()} does not match the verified compiler ${origin.compilerVersion}`);
}
const vendorDir = join(root, 'vendor/usdt0/sources');
const vendorSources = Object.fromEntries(walk(vendorDir).map(file =>
  [relative(vendorDir, file), { content: readFileSync(file, 'utf8') }]));
const [file, name] = origin.fullyQualifiedName.split(':');
const usdt0 = compile(vendorSources, origin.compilerSettings)[file][name];
emit(name, usdt0);

if (!process.argv.includes('--offline')) {
  const response = await fetch(USDT0_PLASMA.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [USDT0_PLASMA.implementation, 'latest'] }) });
  const live = (await response.json()).result;
  const built = `0x${usdt0.evm.deployedBytecode.object}`;
  if (!live || live === '0x') throw new Error('Could not read the live USD₮0 bytecode from Plasma');
  if (live.toLowerCase() !== built.toLowerCase()) {
    throw new Error(`Compiled USD₮0 differs from the code live on Plasma (${built.length} vs ${live.length} hex chars)`);
  }
  console.log(`${name}: runtime bytecode identical to ${USDT0_PLASMA.implementation} on Plasma (${(live.length - 2) / 2} bytes)`);
}

// 2. This repo's contracts, same compiler, OpenZeppelin resolved from node_modules.
const ownSources = Object.fromEntries(['src/StockSeller.sol', 'src/Proxy.sol'].map(path => [path, { content: read(path) }]));
const findImports = path => {
  try { return { contents: readFileSync(require.resolve(path), 'utf8') }; }
  catch { return { error: `Not found: ${path}` }; }
};
const own = compile(ownSources, { optimizer: { enabled: true, runs: 200 } }, findImports);
emit('StockSeller', own['src/StockSeller.sol'].StockSeller);
emit('StandInStock', own['src/StockSeller.sol'].StandInStock);
emit('ERC1967Proxy', own['@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol'].ERC1967Proxy);
console.log('Wrote artifacts: TetherTokenOFTExtension, StockSeller, StandInStock, ERC1967Proxy');
