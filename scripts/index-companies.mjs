#!/usr/bin/env node
// Writes contracts/index-companies.json, the listing file for scripts/deploy-index-seller.ts: brands.json's companies in
// brands.json order (company id = index), named the way the app names them (mobile/scripts/stocks.mjs).
//
//   node scripts/index-companies.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { stockNames } from '../mobile/scripts/stocks.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const { companies } = read('mobile/assets/brands.json');
const stockDeployment = read('contracts/deployments/sepolia.json');
const stockPrices = new Map(read('contracts/companies.json').map(c => [c.symbol, c.priceUsd]));
const names = stockNames(companies, stockDeployment.stocks);

// shortcut: one placeholder price for every company the stock seller did not list; use real quotes if prices ever matter.
const PLACEHOLDER_USD = '100';
const listing = companies.map((c, i) => {
  const symbol = `s${c.ticker.replace(/[^A-Z0-9]/gi, '')}`;
  return { name: names[i], symbol, stockName: `Stand-in ${names[i]} share (Nest demo)`, priceUsd: stockPrices.get(symbol) ?? PLACEHOLDER_USD };
});
if (new Set(listing.map(l => l.symbol)).size !== listing.length) throw new Error('two companies share a symbol');
writeFileSync(new URL('../contracts/index-companies.json', import.meta.url), JSON.stringify(listing, null, 2) + '\n');
console.log(`${listing.length} companies → contracts/index-companies.json`);
