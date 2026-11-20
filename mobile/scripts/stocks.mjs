// Which seller the phone and the Mac pay, and the company name behind each company id. Shared by sync.mjs and server/index.ts.
//
// The index seller (contracts/deployments/sepolia-index.json) lists brands.json's `companies` (the S&P 500, see
// scripts/build-brands.mjs), company id = index in that list. Until it exists, the stock seller (sepolia.json) stays the one paid.
// The companies the stock seller listed keep the name they had there ("Apple", not "Apple Inc."), matched by ticker: logos, categories and
// buys already in the activity log are keyed by it. Every other company keeps its brands.json name.
export function stockNames(companies, stockSellerStocks) {
  const short = new Map(stockSellerStocks.map(s => [s.symbol.replace(/^s/, ''), s.company]));
  const names = companies.map(c => short.get(c.ticker) ?? c.name);
  const missing = stockSellerStocks.filter(s => !names.includes(s.company)).map(s => s.company);
  if (missing.length) throw new Error(`brands.json has no ticker for ${missing.join(', ')}: the stock seller's companies must stay listed`);
  // The app finds a company's id by its name, so two companies with one name would buy the first.
  const repeated = names.filter((name, i) => names.indexOf(name) !== i);
  if (repeated.length) throw new Error(`brands.json names two companies ${repeated.join(', ')}`);
  return names;
}

// `indexDeployment` and `companies` are undefined until the index seller is deployed and brands.json is built.
export function sellerFor(stockDeployment, indexDeployment, companies) {
  // `tickers[i]` is company id i's ticker: the app maps a placement or a lookup to an id by ticker, never by name.
  if (!indexDeployment) return { seller: stockDeployment.seller, sellerKind: 'stock', stocks: stockDeployment.stocks.map(s => s.company),
    tickers: stockDeployment.stocks.map(s => s.symbol.replace(/^s/, '')) };
  if (indexDeployment.chainId !== stockDeployment.chainId || indexDeployment.token.toLowerCase() !== stockDeployment.token.toLowerCase())
    throw new Error('sepolia-index.json is for another chain or token than sepolia.json');
  if (!companies) throw new Error('The index seller is deployed but mobile/assets/brands.json is missing: build it (scripts/build-brands.mjs)');
  // deploy-index-seller.ts writes `companies` only once every listing landed.
  if (indexDeployment.companies !== companies.length)
    throw new Error(`The index seller lists ${indexDeployment.companies ?? 'no'} companies, brands.json has ${companies.length}: finish or redo the listing`);
  return { seller: indexDeployment.seller, sellerKind: 'index', stocks: stockNames(companies, stockDeployment.stocks), tickers: companies.map(c => c.ticker) };
}
