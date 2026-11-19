// Memory on the phone, read from QVAC's getSystemResources: how much the app uses and how much iOS will still give it.
// Measured to choose the one-model plan (Qwen3.5 2B or 4B) on real numbers. Display only.

export type MemoryReading = { used: number | null; available: number | null; total: number | null };
export type MemoryLog = { now: MemoryReading; peakUsed: number | null; peakWith: string; leastAvailable: number | null; leastWith: string };

// QVAC reports each metric as { status: 'supported', value } or a status saying why it is missing; the field sits a few
// levels down, so this finds the first supported one by name.
export function metric(tree: unknown, name: string): number | null {
  if (!tree || typeof tree !== 'object') return null;
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    if (key === name && value && typeof value === 'object') {
      const m = value as { status?: unknown; value?: unknown };
      if (m.status === 'supported' && typeof m.value === 'number' && Number.isFinite(m.value)) return m.value;
    }
    const inner = metric(value, name);
    if (inner !== null) return inner;
  }
  return null;
}

export const reading = (resources: unknown): MemoryReading => ({
  used: metric(resources, 'processUsedBytes'), available: metric(resources, 'processAvailableBytes'), total: metric(resources, 'memoryTotalBytes') });

// Keeps the highest use and the lowest headroom seen since launch, with which models were loaded at the time.
export function track(log: MemoryLog | null, now: MemoryReading, loaded: string): MemoryLog {
  const higher = now.used !== null && (log?.peakUsed == null || now.used > log.peakUsed);
  const lower = now.available !== null && (log?.leastAvailable == null || now.available < log.leastAvailable);
  return { now, peakUsed: higher ? now.used : log?.peakUsed ?? null, peakWith: higher ? loaded : log?.peakWith ?? '',
    leastAvailable: lower ? now.available : log?.leastAvailable ?? null, leastWith: lower ? loaded : log?.leastWith ?? '' };
}

export const gb = (bytes: number | null) => bytes === null ? 'n/a' : `${(bytes / 1024 ** 3).toFixed(2)} GB`;
