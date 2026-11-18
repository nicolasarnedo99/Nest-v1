// Which WDK wallet packages are compiled into the wallet's worklet. One: the
// EIP-7702 gasless EVM wallet, which keeps the plain EVM wallet's address for
// the same seed and sends sponsored UserOperations on Sepolia.
module.exports = { networks: { ethereum: { package: '@tetherto/wdk-wallet-evm-7702-gasless' } } };
