// Copies into the app the two things it shares with the Mac build, so the
// phone runs exactly what was measured in FINDINGS.md:
//   turtle.config.json         the prompt, the JSON schema, the settings and the
//                              Sepolia token and seller the phone may pay, and
//                              the ERC-8004 agents of the paid lookup and the demo shop it may call
//   assets/turtle-adapter.gguf the fine-tuned adapter chosen on the validation rows
// Run with `npm run sync` after retraining, and before the first build.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPANIES, DEMO_ORDER, GENERATION, SYSTEM, responseFormat } from '../../classifier/lib.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const { chainId, token, seller, tokenName } = JSON.parse(readFileSync(here('../../contracts/deployments/sepolia.json'), 'utf8'));
const lookupFile = here('../../contracts/deployments/lookup.json');
if (!existsSync(lookupFile)) throw new Error(`No lookup service at ${lookupFile}. Deploy it first (scripts/deploy-lookup.sh).`);
const lookup = JSON.parse(readFileSync(lookupFile, 'utf8'));
// The phone finds the URL and payTo through the registry, so only the agent is copied.
if (typeof lookup.registry !== 'string' || typeof lookup.agentId !== 'string' || !/^\d+$/.test(lookup.agentId) || lookup.chainId !== chainId)
  throw new Error(`${lookupFile} needs a registry, a numeric agentId string and chainId ${chainId}. Register the agent first (scripts/register-lookup-agent.ts).`);
const shopFile = here('../../contracts/deployments/shop.json');
if (!existsSync(shopFile)) throw new Error(`No demo shop at ${shopFile}. Deploy it first (scripts/deploy-lookup.sh).`);
const shop = JSON.parse(readFileSync(shopFile, 'utf8'));
if (typeof shop.registry !== 'string' || typeof shop.agentId !== 'string' || !/^\d+$/.test(shop.agentId) || shop.chainId !== chainId)
  throw new Error(`${shopFile} needs a registry, a numeric agentId string and chainId ${chainId}. Register the agent first (scripts/register-lookup-agent.ts --deployment contracts/deployments/shop.json).`);
writeFileSync(here('../turtle.config.json'), JSON.stringify({
  model: 'QWEN3_1_7B_INST_Q4', order: DEMO_ORDER, companies: COMPANIES, system: SYSTEM,
  generationParams: GENERATION, responseFormat: responseFormat(DEMO_ORDER),
  chain: { chainId, token, seller, tokenName }, lookup: { registry: lookup.registry, agentId: lookup.agentId, chainId: lookup.chainId },
  shop: { registry: shop.registry, agentId: shop.agentId, chainId: shop.chainId } }, null, 2) + '\n');
const adapter = here('../../classifier/adapters/run3/selected.gguf');
if (!existsSync(adapter)) throw new Error(`No adapter at ${adapter}. Train and select one first (see classifier/).`);
copyFileSync(adapter, here('../assets/turtle-adapter.gguf'));
console.log('Wrote turtle.config.json and assets/turtle-adapter.gguf');
