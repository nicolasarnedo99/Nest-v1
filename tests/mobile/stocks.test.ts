import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module shared with the sync script and the server
import { sellerFor, stockNames } from '../../mobile/scripts/stocks.mjs';
import { CATEGORIES } from '../../mobile/lib/categories.js';
import { LOGOS } from '../../mobile/lib/logos.js';
import config from '../../mobile/turtle.config.json';
import stockDeployment from '../../contracts/deployments/sepolia.json';
import fixture from './fixtures/brands-companies.json';

// shortcut: a hand-written subset until mobile/assets/brands.json is built; then also run these against the real list.
const { companies } = fixture;
const indexDeployment = { chainId: stockDeployment.chainId, token: stockDeployment.token, seller: '0x000000000000000000000000000000000000beef', companies: companies.length };
const INDEX_NAMES: string[] = stockNames(companies, stockDeployment.stocks);

describe('sellerFor: the seller the phone and the Mac pay', () => {
  it('stays on the stock seller, with its nine companies, until the index seller is deployed', () => {
    expect(sellerFor(stockDeployment, undefined, undefined)).toEqual({ seller: stockDeployment.seller, sellerKind: 'stock', stocks: stockDeployment.stocks.map(s => s.company),
      tickers: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'WMT', 'UBER', 'SBUX'] });
  });

  it('pays the index seller once deployed, company id = index in brands.json', () => {
    const { seller, sellerKind, stocks, tickers } = sellerFor(stockDeployment, indexDeployment, companies);
    expect([seller, sellerKind]).toEqual([indexDeployment.seller, 'index']);
    expect(stocks).toHaveLength(companies.length);
    expect(tickers).toEqual(companies.map(c => c.ticker));
    expect(stocks.indexOf('Apple')).toBe(companies.findIndex(c => c.ticker === 'AAPL'));
  });

  it('refuses an index seller deployment it cannot map to company ids', () => {
    expect(() => sellerFor(stockDeployment, indexDeployment, undefined)).toThrow('brands.json is missing');
    expect(() => sellerFor(stockDeployment, { ...indexDeployment, companies: undefined }, companies)).toThrow('lists no companies');
    expect(() => sellerFor(stockDeployment, { ...indexDeployment, companies: companies.length + 1 }, companies)).toThrow('finish or redo the listing');
    expect(() => sellerFor(stockDeployment, { ...indexDeployment, token: indexDeployment.seller }, companies)).toThrow('another chain or token');
  });
});

describe('stockNames: index seller company names', () => {
  it('keeps the names the stock seller used, so logos, categories and old buys still match', () => {
    for (const company of stockDeployment.stocks.map(s => s.company)) expect(INDEX_NAMES).toContain(company);
    for (const c of CATEGORIES) expect(INDEX_NAMES).toContain(c.leader);
    for (const company of [...config.companies, ...Object.keys(LOGOS)]) expect(INDEX_NAMES).toContain(company);
  });

  it('matches by ticker, so a second share class keeps its own name', () => {
    expect(INDEX_NAMES[companies.findIndex(c => c.ticker === 'GOOGL')]).toBe('Alphabet');
    expect(INDEX_NAMES[companies.findIndex(c => c.ticker === 'GOOG')]).toBe('Alphabet Inc. (Class C)');
    expect(INDEX_NAMES[companies.findIndex(c => c.ticker === 'NVDA')]).toBe('NVIDIA');
  });

  it('refuses a list that drops a stock seller company or names two companies alike', () => {
    expect(() => stockNames(companies.filter(c => c.ticker !== 'SBUX'), stockDeployment.stocks)).toThrow('Starbucks');
    expect(() => stockNames([...companies, { ticker: 'X', name: 'Walmart', qid: 'Q1' }], stockDeployment.stocks)).toThrow('two companies');
  });
});
