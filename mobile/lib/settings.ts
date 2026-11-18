// Which on-device model decides. The adapter was trained on Qwen3 1.7B only, so
// it is attached to that option and never to the other. `sdk` is the name of the
// QVAC constant; App.tsx maps it to the SDK export. Scores are the blind set.
export const MODELS = [
  { id: 'qwen3-1.7b-tuned', name: 'Qwen3 1.7B, fine-tuned for Turtle', label: 'Qwen3 1.7B, fine-tuned', sdk: 'QWEN3_1_7B_INST_Q4', adapter: true, score: '21/24', download: '1 GB' },
  { id: 'qwen3.5-2b', name: 'Qwen3.5 2B, as it comes', label: 'Qwen3.5 2B, as it comes', sdk: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M', adapter: false, score: '13/24', download: '1.3 GB' },
] as const;
export type ModelId = typeof MODELS[number]['id'];
export const DEFAULT_MODEL: ModelId = MODELS[0].id;

export type Strategies = { invest: boolean; roundUp: boolean };
export const DEFAULT_STRATEGIES: Strategies = { invest: true, roundUp: false };
export type Settings = { model: ModelId; strategies: Strategies; onboarded: boolean; problem?: string };

// A missing file is the default. An unusable one is also the default, but says so in `problem`.
// A file from before strategies existed has none, which means the default (invest on).
export function parseSettings(text: string | null): Settings {
  if (text === null) return { model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: false };
  let saved: unknown;
  try { saved = JSON.parse(text); } catch { saved = null; }
  const file = saved as { model?: unknown; strategies?: Partial<Record<keyof Strategies, unknown>>; onboarded?: unknown } | null;
  const model = MODELS.find(m => m.id === file?.model);
  if (!model) return { model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: false, problem: `The settings file was unreadable, using ${MODELS[0].label}` };
  const onboarded = typeof file?.onboarded === 'boolean' ? file.onboarded : true;
  if (file?.strategies === undefined) return { model: model.id, strategies: DEFAULT_STRATEGIES, onboarded };
  const { invest, roundUp } = file.strategies ?? {};
  if (typeof invest !== 'boolean' || typeof roundUp !== 'boolean') {
    return { model: model.id, strategies: DEFAULT_STRATEGIES, onboarded, problem: 'The saving strategies in the settings file were unreadable, using Invest in what I buy' };
  }
  return { model: model.id, strategies: { invest, roundUp }, onboarded };
}

// An install from before setup existed wrote settings.json only on a model or strategy change,
// so a missing file next to an activity log or a spend file means it is already set up.
export function onboardedFor(settingsText: string | null, hasOtherFiles: boolean): boolean {
  return settingsText === null ? hasOtherFiles : parseSettings(settingsText).onboarded;
}
