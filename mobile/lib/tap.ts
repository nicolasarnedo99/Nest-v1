// What a background "Note Payment" hands the app. Merchant text is untrusted:
// it reaches the model's prompt, so it is trimmed, bounded and free of control characters.
export function tapFromIntent(params: unknown): { merchant: string; amount: string } | null {
  if (!params || typeof params !== 'object') return null;
  const { merchant, amount } = params as Record<string, unknown>;
  if (typeof merchant !== 'string' || typeof amount !== 'string') return null;
  const clean = merchant.trim().slice(0, 160);
  if (!clean || /[\x00-\x1f\x7f]/.test(clean)) return null;
  return { merchant: clean, amount: amount.trim().slice(0, 40) };
}
