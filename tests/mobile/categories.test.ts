import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryQuery, closestCategory, cosine } from '../../mobile/lib/categories.js';

// A one-hot vector per category stands in for real embeddings, so each test controls exactly how close things are.
const axis = (i: number, value = 1) => CATEGORIES.map((_, j) => (j === i ? value : 0));
const docs = CATEGORIES.map((_, i) => axis(i));
const at = (name: string) => CATEGORIES.findIndex(c => c.name === name);
const mix = (weights: Record<string, number>) => CATEGORIES.map(c => weights[c.name] ?? 0);
const LISTED = ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA', 'Amazon', 'Walmart', 'Uber', 'Starbucks'];

describe('category leader: invest in the listed leader of the closest category', () => {
  it('every leader is a company the seller lists', () => {
    for (const c of CATEGORIES) expect(LISTED).toContain(c.leader);
  });

  it('picks the closest category and its leader', () => {
    expect(closestCategory(axis(at('Food delivery and rides')), docs, LISTED)).toEqual({ name: 'Food delivery and rides', leader: 'Uber', score: 1 });
  });

  it('buys nothing when the best match is too weak', () => {
    // cosine with Groceries is 1/√(1 + 4) ≈ 0.45 against four equal axes: under a 0.5 threshold, nothing is bought.
    expect(closestCategory(mix({ Groceries: 1, Coffee: 1, Uber: 0, 'Online shopping': 1, 'Cars and charging': 1 }), docs, LISTED, 0.5)).toBeNull();
  });

  it('buys nothing when two categories are too close to call', () => {
    expect(closestCategory(mix({ Groceries: 1, Coffee: 0.98 }), docs, LISTED)).toBeNull();
    expect(closestCategory(mix({ Groceries: 1, Coffee: 0.5 }), docs, LISTED)?.leader).toBe('Walmart');
  });

  it('skips a category whose leader is not listed on the seller', () => {
    expect(closestCategory(mix({ Coffee: 1, Groceries: 0.9 }), docs, LISTED.filter(n => n !== 'Starbucks'))?.leader).toBe('Walmart');
  });

  it('refuses embeddings that do not line up', () => {
    expect(() => closestCategory([1, 0], docs, LISTED)).toThrow();
    expect(() => closestCategory(axis(0), docs.slice(1), LISTED)).toThrow();
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it('describes the merchant with what the paid lookup knows, not the small model\'s guess', () => {
    expect(categoryQuery('CAREEM', { operator: 'Careem, majority-owned by e&', note: 'Ride hailing and food delivery.' }, 'Unrelated care home operator'))
      .toBe('task: classification | query: CAREEM. Run by Careem, majority-owned by e&. Ride hailing and food delivery.');
    expect(categoryQuery('TALABAT', { operator: null }, 'Unrelated food delivery service')).toBe('task: classification | query: TALABAT. food delivery service');
    expect(categoryQuery('TALABAT', null, 'Unrelated food delivery service')).toBe('task: classification | query: TALABAT. food delivery service');
  });
});
