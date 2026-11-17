// Deploys the demo's contracts with viem. Used by scripts/deploy.mjs for
// Sepolia and by the tests for a local chain, so both exercise the same code.
import { readFileSync } from 'node:fs';
import { encodeFunctionData, parseUnits } from 'viem';

const load = name => JSON.parse(readFileSync(new URL(`../artifacts/${name}.json`, import.meta.url), 'utf8'));
export const artifacts = {
  token: load('TetherTokenOFTExtension'), proxy: load('ERC1967Proxy'),
  seller: load('StockSeller'), stock: load('StandInStock')
};
export const companies = JSON.parse(readFileSync(new URL('../companies.json', import.meta.url), 'utf8'));

// The name is part of the EIP-712 domain every signature is bound to, and it
// says plainly that this is a test copy and not USD₮0 itself.
export const TOKEN = { name: 'Test USDT0 copy (Turtle demo)', symbol: 'tUSDT0', decimals: 6 };

// A public RPC is several nodes behind one address. A transaction that depends
// on the previous one can be simulated on a node that has not seen it yet and
// be refused before it is ever sent, so sending is retried for a short while.
async function retry(send, attempts = 10) {
  for (let attempt = 1; ; attempt++) {
    try { return await send(); }
    catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise(done => setTimeout(done, 3000));
    }
  }
}

export async function deployAll({ publicClient, walletClient }) {
  const deploy = async (artifact, args = []) => {
    const hash = await retry(() => walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args }));
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
    for (let attempt = 0; !(await publicClient.getCode({ address: receipt.contractAddress })); attempt++) {
      if (attempt > 60) throw new Error(`Code not visible at ${receipt.contractAddress}`);
      await new Promise(done => setTimeout(done, 1000));
    }
    return receipt.contractAddress;
  };
  // The implementation locks its own initialiser, so the token lives at a
  // proxy that is initialised in the same transaction that creates it.
  const implementation = await deploy(artifacts.token);
  const token = await deploy(artifacts.proxy, [implementation, encodeFunctionData({
    abi: artifacts.token.abi, functionName: 'initialize', args: [TOKEN.name, TOKEN.symbol, TOKEN.decimals] })]);
  const seller = await deploy(artifacts.seller, [token, companies.map(item => item.stockName),
    companies.map(item => item.symbol), companies.map(item => parseUnits(item.priceUsd, TOKEN.decimals))]);
  const stocks = [];
  for (const [index, company] of companies.entries()) {
    const [stock] = await retry(() => publicClient.readContract({ address: seller, abi: artifacts.seller.abi,
      functionName: 'listings', args: [index] }));
    stocks.push({ company: company.name, symbol: company.symbol, address: stock });
  }
  return { chainId: await publicClient.getChainId(), token, tokenImplementation: implementation, seller, stocks,
    tokenName: TOKEN.name, tokenOwner: walletClient.account.address };
}

// Only the token's owner can mint, exactly as on the live contract.
export async function mint({ publicClient, walletClient }, token, to, amount) {
  const hash = await retry(() => walletClient.writeContract({ address: token, abi: artifacts.token.abi,
    functionName: 'mint', args: [to, amount] }));
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Mint failed: ${hash}`);
  return hash;
}
