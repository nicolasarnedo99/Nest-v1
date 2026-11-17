// Hardhat is used only as a local chain (`npm run node`). Contracts are
// compiled by scripts/compile.mjs so the USD₮0 build stays byte-exact.
module.exports = { solidity: '0.8.4', networks: { hardhat: { chainId: 31337 } } };
