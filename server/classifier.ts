import { loadModel, completion, unloadModel, close, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { assess, COMPANIES, DEMO_ORDER, GENERATION, MODEL_CONFIG, responseFormat, history } from '../classifier/lib.mjs';

export type Company = typeof COMPANIES[number];
export type Decision = { company: Company | null; explanation: string; seconds: number };
export interface Classifier {
  classify(merchant: string): Promise<Decision>;
  close(): Promise<void>;
}

// The model runs on this machine through Tether's QVAC SDK. The prompt, schema
// and settings are the ones the scores in FINDINGS.md were measured with. The
// model writes its explanation first and its decision second; the only thing
// that changes between "before" and "after" is the LoRA adapter.
export async function loadClassifier(options: { lora?: string } = {}): Promise<Classifier> {
  const modelConfig = options.lora ? { ...MODEL_CONFIG, lora: options.lora } : MODEL_CONFIG;
  const modelId = await loadModel({ modelSrc: QWEN3_1_7B_INST_Q4, modelType: 'llamacpp-completion', modelConfig });
  return {
    async classify(merchant) {
      const start = performance.now();
      // The cache stays off: with it on, the system prompt was dropped in the
      // September diagnosis (tasks/qvac-diagnosis.md).
      const raw = await completion({ modelId, kvCache: false, stream: false,
        history: history(merchant), generationParams: GENERATION, responseFormat: responseFormat(DEMO_ORDER) }).final;
      // Same strict rule as the evaluation: malformed or truncated output is an
      // error, never an abstention and never a purchase.
      const result = assess(raw, null, false);
      if (!result.schemaValid || !result.complete || !result.parsed) throw new Error('Unusable classifier output');
      return { company: result.parsed.company as Company | null, explanation: result.parsed.explanation,
        seconds: (performance.now() - start) / 1000 };
    },
    async close() { await unloadModel({ modelId }); await close(); },
  };
}
