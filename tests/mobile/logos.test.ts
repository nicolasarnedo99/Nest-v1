import { describe, expect, it } from 'vitest';
import config from '../../mobile/turtle.config.json';
import { CATEGORIES } from '../../mobile/lib/categories.js';
import { LOGOS, colorFor, logoFor } from '../../mobile/lib/logos.js';
// @ts-expect-error plain JavaScript module shared with the sync script and the server
import { stockNames } from '../../mobile/scripts/stocks.mjs';
import stockDeployment from '../../contracts/deployments/sepolia.json';
import fixture from './fixtures/brands-companies.json';

// The index seller's names, from a stand-in for brands.json until it is built (see stocks.test.ts).
const INDEX_NAMES: string[] = stockNames(fixture.companies, stockDeployment.stocks);

// CIE76 colour difference on sRGB hex: about 2 is just noticeable, 20 is clearly a different colour at a glance.
const lab = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [(r! * 0.4124 + g! * 0.3576 + b! * 0.1805) / 0.95047, r! * 0.2126 + g! * 0.7152 + b! * 0.0722, (r! * 0.0193 + g! * 0.1192 + b! * 0.9505) / 1.08883].map(f);
  return [116 * y! - 16, 500 * (x! - y!), 200 * (y! - z!)];
};
const deltaE = (a: string, b: string) => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!); };

describe('logos', () => {
  // The index seller lists ~500 companies; the ones Nest names on its own (the classifier's five, the category leaders) have a
  // mark, any other falls back to the plain slice colour.
  it('has a mark and a slice colour for every company Nest names on its own', () => {
    for (const company of [...config.companies, ...CATEGORIES.map(c => c.leader)]) {
      const logo = logoFor(company);
      expect(logo, company).toBeDefined();
      expect(logo!.path, company).toMatch(/^[Mm][0-9MmLlHhVvCcSsQqTtAaZz.,\s-]+$/);
      expect(logo!.color, company).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('names every mark as the configured seller and the index seller name that company', () => {
    for (const listed of [config.stocks, INDEX_NAMES]) for (const company of Object.keys(LOGOS)) expect(listed).toContain(company);
  });

  it('has a generated mark for listed companies beyond the nine, keyed by the name the app shows', () => {
    for (const company of ['Netflix', 'Visa Inc.', 'Nike, Inc.']) expect(logoFor(company)?.path, company).toMatch(/^[Mm]/);
  });

  it('gives a company without a mark a fixed colour of its own, the same every time', () => {
    expect(colorFor('Costco')).toMatch(/^hsl\(\d+, 42%, 42%\)$/);
    expect(colorFor('Costco')).toBe(colorFor('Costco'));
    expect(colorFor('Apple')).toBe(LOGOS.Apple!.color);
  });

  it('has nothing for a name that is not listed', () => {
    expect(logoFor('Careem')).toBeUndefined();
  });

  it('keeps every two slice colours clearly apart, so neighbouring slices never blur', () => {
    const entries = Object.entries(LOGOS);
    for (const [i, [a, x]] of entries.entries()) for (const [b, y] of entries.slice(i + 1)) expect(deltaE(x.color, y.color), `${a} vs ${b}`).toBeGreaterThanOrEqual(20);
  });
});
