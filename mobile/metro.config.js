// The fine-tuned adapter ships inside the app as a .gguf file, so Metro has to
// treat that extension as an asset.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('gguf');
// The phone builds its order with the server's own code (server/authorization.ts,
// server/money.ts), which imports viem from the repository root.
const root = path.resolve(__dirname, '..');
config.watchFolders = [...(config.watchFolders ?? []), path.join(root, 'server'), path.join(root, 'node_modules')];
module.exports = config;
