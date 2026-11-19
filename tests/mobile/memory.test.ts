import { describe, expect, it } from 'vitest';
import { gb, metric, reading, track } from '../../mobile/lib/memory.js';

const supported = (value: number) => ({ status: 'supported', value, provenance: { source: 'os' } });
const sample = (used: number, available: number) => ({ capabilities: { memoryTotalBytes: supported(8e9) },
  sample: { sampledAt: 1, process: { processUsedBytes: supported(used), processAvailableBytes: supported(available) } } });

describe('memory readout', () => {
  it('reads supported metrics wherever they sit, and nothing from unavailable ones', () => {
    expect(reading(sample(2e9, 3e9))).toEqual({ used: 2e9, available: 3e9, total: 8e9 });
    expect(metric({ a: { processUsedBytes: { status: 'unavailable', reason: 'no' } } }, 'processUsedBytes')).toBeNull();
    expect(reading(null)).toEqual({ used: null, available: null, total: null });
  });

  it('keeps the peak use and least headroom, with the models loaded at the time', () => {
    let log = track(null, reading(sample(1e9, 4e9)), 'savings');
    log = track(log, reading(sample(2.5e9, 2e9)), 'chat + Whisper');
    log = track(log, reading(sample(1.5e9, 3e9)), 'savings + category');
    expect(log).toMatchObject({ peakUsed: 2.5e9, peakWith: 'chat + Whisper', leastAvailable: 2e9, leastWith: 'chat + Whisper', now: { used: 1.5e9 } });
  });

  it('formats bytes as GiB', () => {
    expect(gb(1024 ** 3 * 1.5)).toBe('1.50 GB');
    expect(gb(null)).toBe('n/a');
  });
});
