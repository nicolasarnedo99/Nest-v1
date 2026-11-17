export const SYSTEM: string;
export const SCHEMA: Record<string, unknown>;
export const COMPANIES: readonly ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA'];
export const MODEL_CONFIG: { device: string; ctx_size: number };
export const GENERATION: { temp: number; predict: number; reasoning_budget: number };
export const DEMO_ORDER: 'decision-first' | 'reason-first';
export function responseFormat(order: string): { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
export function history(merchant: string): { role: 'system' | 'user'; content: string }[];
export function assess(raw: { contentText: string; stopReason?: string }, expected: string | null, timedOut: boolean): {
  parsed?: { company: string | null; explanation: string }; schemaValid: boolean; complete: boolean; pass: boolean };
