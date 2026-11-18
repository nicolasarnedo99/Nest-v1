// Copies into the app the two things it shares with the Mac build, so the
// phone runs exactly what was measured in FINDINGS.md:
//   turtle.config.json         the prompt, the JSON schema and the settings
//   assets/turtle-adapter.gguf the fine-tuned adapter chosen on the validation rows
// Run with `npm run sync` after retraining, and before the first build.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPANIES, DEMO_ORDER, GENERATION, SYSTEM, responseFormat } from '../../classifier/lib.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
writeFileSync(here('../turtle.config.json'), JSON.stringify({
  model: 'QWEN3_1_7B_INST_Q4', order: DEMO_ORDER, companies: COMPANIES, system: SYSTEM,
  generationParams: GENERATION, responseFormat: responseFormat(DEMO_ORDER) }, null, 2) + '\n');
const adapter = here('../../classifier/adapters/run3/selected.gguf');
if (!existsSync(adapter)) throw new Error(`No adapter at ${adapter}. Train and select one first (see classifier/).`);
copyFileSync(adapter, here('../assets/turtle-adapter.gguf'));
console.log('Wrote turtle.config.json and assets/turtle-adapter.gguf');
