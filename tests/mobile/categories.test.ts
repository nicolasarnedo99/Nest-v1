import { describe, expect, it } from 'vitest';
import { CATEGORIES, SHOP_TARGET, bitrefillTarget, categoryQuery, closestCategory, cosine } from '../../mobile/lib/categories.js';
import config from '../../mobile/turtle.config.json';
// @ts-expect-error plain JavaScript module shared with the sync script and the server
import { stockNames } from '../../mobile/scripts/stocks.mjs';
import stockDeployment from '../../contracts/deployments/sepolia.json';
import fixture from './fixtures/brands-companies.json';

// The index seller's names, from a stand-in for brands.json until it is built (see stocks.test.ts).
const INDEX_NAMES: string[] = stockNames(fixture.companies, stockDeployment.stocks);

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

describe('bitrefillTarget: what a Bitrefill purchase invests in, by fixed rule', () => {
  const card = (name: string) => bitrefillTarget({ kind: 'giftcard', name });
  it('a gift card that names a listed company or one of its brands invests in that company, as its owner', () => {
    expect(card('Apple Gift Card')).toEqual({ company: 'Apple', reason: 'owner', of: 'Apple' });
    expect(card('iTunes US')).toEqual({ company: 'Apple', reason: 'owner', of: 'iTunes' });
    expect(card('Amazon.ae')).toEqual({ company: 'Amazon', reason: 'owner', of: 'Amazon' });
    expect(card('Google Play UAE')).toEqual({ company: 'Alphabet', reason: 'owner', of: 'Google Play' });
    expect(card('YouTube Premium')).toEqual({ company: 'Alphabet', reason: 'owner', of: 'YouTube' });
    expect(card('Xbox Live')).toEqual({ company: 'Microsoft', reason: 'owner', of: 'Xbox' });
    expect(card('Microsoft 365')).toEqual({ company: 'Microsoft', reason: 'owner', of: 'Microsoft' });
    expect(card('Uber Eats UAE')).toEqual({ company: 'Uber', reason: 'owner', of: 'Uber Eats' });
    expect(card('UBER rides')).toEqual({ company: 'Uber', reason: 'owner', of: 'Uber' });
    expect(card('Starbucks')).toEqual({ company: 'Starbucks', reason: 'owner', of: 'Starbucks' });
    expect(card('Walmart')).toEqual({ company: 'Walmart', reason: 'owner', of: 'Walmart' });
    expect(card('GeForce NOW')).toEqual({ company: 'NVIDIA', reason: 'owner', of: 'GeForce' });
    expect(card('Tesla')).toEqual({ company: 'Tesla', reason: 'owner', of: 'Tesla' });
  });
  it('matches whole words only, so a lookalike name is not its owner', () => {
    expect(card("Applebee's")).toEqual({ company: 'Amazon', reason: 'leader', of: 'Online shopping' });
    expect(card('Teslaco Spa')).toEqual({ company: 'Amazon', reason: 'leader', of: 'Online shopping' });
  });
  it('any other gift card invests in the leader of online shopping', () => {
    expect(card('Noon.com UAE')).toEqual({ company: 'Amazon', reason: 'leader', of: 'Online shopping' });
  });
  it('an eSIM or a top-up invests in the leader of phones and computers, whatever its name', () => {
    expect(bitrefillTarget({ kind: 'esim', name: 'UAE 5GB' })).toEqual({ company: 'Apple', reason: 'leader', of: 'Phones and computers' });
    expect(bitrefillTarget({ kind: 'topup', name: 'Etisalat Amazon bundle' })).toEqual({ company: 'Apple', reason: 'leader', of: 'Phones and computers' });
  });
  it('a demo shop order invests in Amazon as the leader of online shopping, never as if Amazon sold it', () => {
    expect(SHOP_TARGET).toEqual({ company: 'Amazon', reason: 'leader', of: 'Online shopping' });
  });
  it('every company it can name is listed on the seller', () => {
    const names = ['Apple', 'iTunes', 'Amazon', 'Google Play', 'YouTube', 'Xbox', 'Microsoft', 'Uber Eats', 'Uber', 'Starbucks', 'Walmart', 'NVIDIA', 'GeForce', 'Tesla', 'Noon'];
    const targets = [SHOP_TARGET, ...names.map(card), bitrefillTarget({ kind: 'esim', name: 'x' })];
    for (const listed of [config.stocks, INDEX_NAMES]) for (const t of targets) expect(listed).toContain(t.company);
  });
});
