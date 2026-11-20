// Which on-device model decides, and also reads Chat. The adapter was trained on Qwen3.5 2B, so it is
// attached to the tuned option and never to the other. `sdk` is the name of the
// QVAC constant; App.tsx maps it to the SDK export. Scores are the blind set.
export const MODELS = [
  { id: 'qwen3.5-2b-tuned', name: 'Qwen3.5 2B, fine-tuned for Nest', label: 'Qwen3.5 2B, fine-tuned', sdk: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M', adapter: true, score: '20/24', download: '1.3 GB' },
  { id: 'qwen3.5-2b', name: 'Qwen3.5 2B, as it comes', label: 'Qwen3.5 2B, as it comes', sdk: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M', adapter: false, score: '10/24', download: '1.3 GB' },
] as const;
// The fine-tuned 1.7B is gone (its adapter is no longer bundled); a file that chose it gets the fine-tuned 2B.
const RENAMED: Record<string, string> = { 'qwen3-1.7b-tuned': 'qwen3.5-2b-tuned' };
export type ModelId = typeof MODELS[number]['id'];
export const DEFAULT_MODEL: ModelId = MODELS[0].id;

import { MINIMUM_BUY } from '../../server/money';

// The share of each purchase that is invested, in whole percent from 0 (off) to 100. The two limits are optional, absent means no
// limit, and are micro-units as digits: `maxBuy` caps one stock buy, `maxOrder` caps one chat order.
export type Strategies = { share: number; maxBuy?: string; maxOrder?: string };
export const DEFAULT_STRATEGIES: Strategies = { share: 10 };
export type Settings = { model: ModelId; strategies: Strategies; onboarded: boolean; problem?: string };

// A limit as the user types it ("1.50"): micro-units as digits, null when it is not a positive amount of at most two decimals or is under `least`.
export function limitFromText(text: string, least = 0n): string | null {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text.trim())) return null;
  const [whole, cents = ''] = text.trim().split('.');
  const micro = BigInt(whole!) * 1_000_000n + BigInt(cents.padEnd(2, '0')) * 10_000n;
  return micro > 0n && micro >= least ? micro.toString() : null;
}
export const limitText = (micro: bigint) => (Number(micro) / 1e6).toFixed(2);
// shortcut: a corrupt limit reads as no limit (fails open); only the app writes this file, so change it to refuse the file if anything else can ever write it.
// Absent or null is no limit; anything else must be a valid limit, or the whole value is unreadable.
const readLimit = (value: unknown, least: bigint): string | undefined | 'bad' =>
  value === undefined || value === null ? undefined : typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) % 10_000n === 0n
    && limitFromText(limitText(BigInt(value)), least) === value ? value : 'bad';

// A missing file is the default. An unusable one is also the default, but says so in `problem`.
// A file from before strategies existed has none, which means the default (10%). The old on/off strategies read as
// 10% when invest or round-up was on, and 0% when both were off.
export function parseSettings(text: string | null): Settings {
  if (text === null) return { model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: false };
  let saved: unknown;
  try { saved = JSON.parse(text); } catch { saved = null; }
  const file = saved as { model?: unknown; strategies?: Partial<Record<keyof Strategies, unknown>>; onboarded?: unknown } | null;
  const model = MODELS.find(m => m.id === (RENAMED[file?.model as string] ?? file?.model));
  if (!model) return { model: DEFAULT_MODEL, strategies: DEFAULT_STRATEGIES, onboarded: false, problem: `The settings file was unreadable, using ${MODELS[0].label}` };
  const onboarded = typeof file?.onboarded === 'boolean' ? file.onboarded : true;
  if (file?.strategies === undefined) return { model: model.id, strategies: DEFAULT_STRATEGIES, onboarded };
  const fields = (file.strategies ?? {}) as Record<string, unknown>;
  const { share, invest, roundUp } = fields;
  const maxBuy = readLimit(fields.maxBuy, MINIMUM_BUY), maxOrder = readLimit(fields.maxOrder, 0n);
  const limits = { ...(typeof maxBuy === 'string' && maxBuy !== 'bad' ? { maxBuy } : {}), ...(typeof maxOrder === 'string' && maxOrder !== 'bad' ? { maxOrder } : {}) };
  const limitProblem = maxBuy === 'bad' || maxOrder === 'bad' ? 'A limit was unreadable in the settings file, using no limit' : undefined;
  const withProblem = (problem: string | undefined) => (problem ? { problem } : {});
  if (typeof share === 'number' && Number.isInteger(share) && share >= 0 && share <= 100) return { model: model.id, strategies: { share, ...limits }, onboarded, ...withProblem(limitProblem) };
  if (share === undefined && typeof invest === 'boolean' && typeof roundUp === 'boolean') return { model: model.id, strategies: { share: invest || roundUp ? 10 : 0, ...limits }, onboarded, ...withProblem(limitProblem) };
  return { model: model.id, strategies: { ...DEFAULT_STRATEGIES, ...limits }, onboarded, problem: 'How much to invest was unreadable in the settings file, using 10%' };
}

// An install from before setup existed wrote settings.json only on a model or strategy change,
// so a missing file next to an activity log or a spend file means it is already set up.
export function onboardedFor(settingsText: string | null, hasOtherFiles: boolean): boolean {
  return settingsText === null ? hasOtherFiles : parseSettings(settingsText).onboarded;
}
