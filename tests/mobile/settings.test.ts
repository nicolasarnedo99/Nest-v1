import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODELS, parseSettings } from '../../mobile/lib/settings.js';

describe('parseSettings: which model decides', () => {
  it('defaults to the fine-tuned Qwen3 1.7B when nothing is saved', () => {
    expect(parseSettings(null)).toEqual({ model: DEFAULT_MODEL });
    expect(DEFAULT_MODEL).toBe('qwen3-1.7b-tuned');
  });

  it('reads back each saved choice', () => {
    for (const { id } of MODELS) expect(parseSettings(JSON.stringify({ model: id }))).toEqual({ model: id });
  });

  it('falls back to the default and says why when the file is unusable, never to the untrained 2B', () => {
    for (const text of ['not json', '[]', '{"model":"gpt"}', '{"model":3}', '{}']) {
      const read = parseSettings(text);
      expect(read.model).toBe(DEFAULT_MODEL);
      expect(read.problem).toMatch(/settings/i);
    }
  });

  it('applies the adapter to the Qwen3 1.7B option only, since it was trained on that model', () => {
    expect(MODELS.filter(m => m.adapter).map(m => m.sdk)).toEqual(['QWEN3_1_7B_INST_Q4']);
    expect(MODELS.find(m => m.sdk === 'QWEN3_5_2B_MULTIMODAL_Q4_K_M')?.adapter).toBe(false);
  });
});
