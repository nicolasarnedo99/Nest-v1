// Which WDK wallet packages are compiled into the wallet's worklet. One:
// plain EVM, the same package the Mac uses, pointed at Sepolia at runtime.
module.exports = { networks: { ethereum: { package: '@tetherto/wdk-wallet-evm' } } };
