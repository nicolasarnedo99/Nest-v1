import { describe, expect, it } from 'vitest';
import { TOUR, nextTourStep } from '../../mobile/lib/tour.js';

describe('nextTourStep: each hint waits for the thing it asks for', () => {
  it('walks receipt open → closed → portfolio → chat → activity → chat → done', () => {
    let step = 0;
    for (const event of [{ receipt: true }, { receipt: false }, { page: 0 }, { page: 1 }, { page: 2 }, { page: 1 }]) step = nextTourStep(step, event);
    expect(step).toBe(TOUR.length);
  });
  it('ignores what the current hint does not ask for', () => {
    expect(nextTourStep(0, { page: 0 })).toBe(0); // swiping before the receipt hint is done does not skip it
    expect(nextTourStep(2, { page: 2 })).toBe(2); // activity before portfolio
    expect(nextTourStep(1, { receipt: true })).toBe(1);
    expect(nextTourStep(TOUR.length, { page: 1 })).toBe(TOUR.length);
  });
});
