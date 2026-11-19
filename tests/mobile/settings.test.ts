import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_STRATEGIES, MODELS, onboardedFor, parseSettings } from '../../mobile/lib/settings.js';

describe('parseSettings: which model decides', () => {
  it('defaults to the fine-tuned Qwen3.5 2B when nothing is saved', () => {
    expect(parseSettings(null)).toEqual({ model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: false });
    expect(DEFAULT_MODEL).toBe('qwen3.5-2b-tuned');
  });

  it('reads the removed fine-tuned 1.7B as the new default, with no problem shown', () => {
    expect(parseSettings(JSON.stringify({ model: 'qwen3-1.7b-tuned', strategies: { share: 25 } }))).toEqual({ model: DEFAULT_MODEL, strategies: { share: 25 }, onboarded: true });
  });

  it('reads back each saved choice', () => {
    for (const { id } of MODELS) expect(parseSettings(JSON.stringify({ model: id }))).toEqual({ model: id, strategies: DEFAULT_STRATEGIES, onboarded: true });
  });

  it('falls back to the default and says why when the file is unusable, never to the untrained 2B', () => {
    for (const text of ['not json', '[]', '{"model":"gpt"}', '{"model":3}', '{}']) {
      const read = parseSettings(text);
      expect(read.model).toBe(DEFAULT_MODEL);
      expect(read.problem).toMatch(/settings/i);
    }
  });

  it('offers the 2B with the adapter and as it comes, and nothing else', () => {
    expect(MODELS.map(m => [m.id, m.sdk, m.adapter])).toEqual([
      ['qwen3.5-2b-tuned', 'QWEN3_5_2B_MULTIMODAL_Q4_K_M', true], ['qwen3.5-2b', 'QWEN3_5_2B_MULTIMODAL_Q4_K_M', false]]);
  });
});

describe('parseSettings: how much of each purchase is invested', () => {
  it('invests 10% by default', () => {
    expect(DEFAULT_STRATEGIES).toEqual({ share: 10 });
  });

  it('reads an old file, written before strategies existed, as the default with no problem', () => {
    expect(parseSettings('{"model":"qwen3.5-2b"}')).toEqual({ model: 'qwen3.5-2b', strategies: DEFAULT_STRATEGIES, onboarded: true });
  });

  it('keeps a saved share from 0 to 100', () => {
    for (const n of [0, 1, 10, 55, 100]) expect(parseSettings(JSON.stringify({ model: DEFAULT_MODEL, strategies: { share: n } })).strategies).toEqual({ share: n });
  });

  it('reads the old on/off strategies: invest or round-up on is 10%, both off is 0%', () => {
    const old = (invest: boolean, roundUp: boolean) => parseSettings(JSON.stringify({ model: DEFAULT_MODEL, strategies: { invest, roundUp } })).strategies;
    expect(old(true, false)).toEqual({ share: 10 });
    expect(old(false, true)).toEqual({ share: 10 });
    expect(old(false, false)).toEqual({ share: 0 });
  });

  it('falls back to the default and says why when the share is malformed, keeping the model', () => {
    for (const strategies of [null, 'on', { share: -1 }, { share: 101 }, { share: 2.5 }, { share: '10' }, { invest: 'yes', roundUp: false }, {}]) {
      const read = parseSettings(JSON.stringify({ model: 'qwen3.5-2b', strategies }));
      expect(read.model).toBe('qwen3.5-2b');
      expect(read.strategies).toEqual(DEFAULT_STRATEGIES);
      expect(read.problem).toMatch(/invest/i);
    }
  });

  it('uses the default when the whole file is unusable', () => {
    expect(parseSettings('not json').strategies).toEqual(DEFAULT_STRATEGIES);
  });
});

describe('parseSettings: onboarded', () => {
  it('marks a fresh install as not onboarded', () => { expect(parseSettings(null).onboarded).toBe(false); });
  it('treats a settings file from before setup existed as onboarded', () => {
    expect(parseSettings(JSON.stringify({ model: 'qwen3-1.7b-tuned', strategies: { share: 10 } })).onboarded).toBe(true);
  });
  it('reads the onboarded flag', () => {
    expect(parseSettings(JSON.stringify({ model: 'qwen3-1.7b-tuned', strategies: { share: 10 }, onboarded: false })).onboarded).toBe(false);
  });
  it('runs setup again after a corrupt file', () => { const s = parseSettings('{oops'); expect(s.onboarded).toBe(false); expect(s.problem).toBeTruthy(); });
});

describe('onboardedFor: whether setup shows', () => {
  it('shows setup on a fresh install', () => {
    expect(onboardedFor(null, false)).toBe(false);
  });

  it('skips setup for an older install that never wrote settings but has a log or spend file', () => {
    expect(onboardedFor(null, true)).toBe(true);
  });

  it('follows the saved flag when there is a settings file, whatever else exists', () => {
    expect(onboardedFor(JSON.stringify({ model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: false }), true)).toBe(false);
    expect(onboardedFor(JSON.stringify({ model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: true }), false)).toBe(true);
  });
});
