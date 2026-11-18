// Which on-device model decides. The adapter was trained on Qwen3 1.7B only, so
// it is attached to that option and never to the other. `sdk` is the name of the
// QVAC constant; App.tsx maps it to the SDK export. Scores are the blind set.
export const MODELS = [
  { id: 'qwen3-1.7b-tuned', name: 'Qwen3 1.7B, fine-tuned for Turtle', label: 'Qwen3 1.7B, fine-tuned', sdk: 'QWEN3_1_7B_INST_Q4', adapter: true, score: '21/24', download: '1 GB' },
  { id: 'qwen3.5-2b', name: 'Qwen3.5 2B, as it comes', label: 'Qwen3.5 2B, as it comes', sdk: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M', adapter: false, score: '13/24', download: '1.3 GB' },
] as const;
export type ModelId = typeof MODELS[number]['id'];
export const DEFAULT_MODEL: ModelId = MODELS[0].id;

// A missing file is the default. An unusable one is also the default, but says so in `problem`.
export function parseSettings(text: string | null): { model: ModelId; problem?: string } {
  if (text === null) return { model: DEFAULT_MODEL };
  let saved: unknown;
  try { saved = JSON.parse(text); } catch { saved = null; }
  const model = MODELS.find(m => m.id === (saved as { model?: unknown } | null)?.model);
  return model ? { model: model.id } : { model: DEFAULT_MODEL, problem: `The settings file was unreadable, using ${MODELS[0].label}` };
}
