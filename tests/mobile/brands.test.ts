import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The brand → listed-parent table the phone searches (built by scripts/build-brands.mjs). These checks guard the data,
// not the search: a clean merchant name must lead to the right parent, and a lookalike must lead nowhere.
const file = new URL('../../mobile/assets/brands.json', import.meta.url);
type Brand = { name: string; aliases: string[]; company: string; qid?: string };
const table = JSON.parse(readFileSync(file, 'utf8')) as {
  source: Record<string, string>;
  companies: { ticker: string; name: string; qid: string }[];
  brands: Brand[];
};

// Exact name-or-alias match, case-insensitive: the parents a merchant name points to.
const parents = (merchant: string) =>
  [...new Set(table.brands.filter(b => [b.name, ...b.aliases].some(n => n.toLowerCase() === merchant.toLowerCase())).map(b => b.company))].sort();

describe('brand table', () => {
  it('holds the whole S&P 500 in a shape the phone can ship', () => {
    expect(table.companies.length).toBeGreaterThanOrEqual(495);
    expect(table.companies.length).toBeLessThanOrEqual(510);
    expect(statSync(file).size).toBeLessThan(5_000_000);
    expect(table.source.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tickers = new Set(table.companies.map(c => c.ticker));
    expect(tickers.size).toBe(table.companies.length);
    for (const c of table.companies) expect(c.qid).toMatch(/^Q\d+$/);
    for (const b of table.brands) {
      expect(tickers.has(b.company), `${b.name} → ${b.company}`).toBe(true);
      expect(b.name.length).toBeGreaterThan(0);
      expect(Array.isArray(b.aliases)).toBe(true);
    }
  });

  it('has one row per company: share classes collapse to the first ticker listed', () => {
    // The app finds a company id by name, so a second "Fox Corporation" row would be ambiguous.
    expect(new Set(table.companies.map(c => c.name)).size).toBe(table.companies.length);
    expect(new Set(table.companies.map(c => c.qid)).size).toBe(table.companies.length);
    const tickers = table.companies.map(c => c.ticker);
    expect(tickers).toEqual(expect.arrayContaining(['GOOGL', 'FOXA', 'NWSA']));
    for (const t of ['GOOG', 'FOX', 'NWS']) expect(tickers).not.toContain(t);
  });

  it('lists every company as a brand of itself', () => {
    // Share classes (GOOG/GOOGL) share one row under the first ticker, so check by Wikidata item.
    const own = new Set(table.brands.filter(b => b.qid).map(b => `${b.qid}`));
    for (const c of table.companies) expect(own.has(c.qid), c.ticker).toBe(true);
  });

  it('is sorted, so a rebuild diffs cleanly', () => {
    const keys = table.brands.map(b => [b.company, b.name.toLowerCase()]);
    const sorted = [...keys].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    expect(keys).toEqual(sorted);
  });

  it.each([
    ['YouTube', 'GOOGL'], ['YouTube Premium', 'GOOGL'], ['Fitbit', 'GOOGL'], ['Waymo', 'GOOGL'], ['Google Play', 'GOOGL'],
    ['Xbox', 'MSFT'], ['GitHub', 'MSFT'], ['LinkedIn', 'MSFT'], ['Mojang Studios', 'MSFT'], ['Activision Blizzard', 'MSFT'],
    ['Beats', 'AAPL'], ['Shazam', 'AAPL'], ['iTunes', 'AAPL'], ['App Store', 'AAPL'], ['iCloud', 'AAPL'],
    ['Whole Foods Market', 'AMZN'], ['Uber Eats', 'UBER'], ['Careem', 'UBER'], ['GeForce NOW', 'NVDA'], ['Instagram', 'META'],
    ['Prime Video', 'AMZN'], ['Peacock', 'CMCSA'], ['FACEBK', 'META'], ['VZWRLSS', 'VZ'],
  ])('%s → %s', (merchant, ticker) => {
    expect(parents(merchant)).toEqual([ticker]);
  });

  // Lookalikes and regional brands with no S&P 500 parent: buying anything for them would be a wrong buy.
  it.each(["Applebee's", 'Carrefour', 'Talabat', 'Noon'])('%s has no listed parent', merchant => {
    expect(parents(merchant)).toEqual([]);
  });
});
