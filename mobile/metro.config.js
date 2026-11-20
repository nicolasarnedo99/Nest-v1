// The fine-tuned adapter ships inside the app as a .gguf file and the brand index
// as a .emb file (raw signed bytes), so Metro has to treat those extensions as assets.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('gguf', 'emb');
// The phone builds its order with the server's own code (server/authorization.ts,
// server/money.ts), which imports viem from the repository root.
const root = path.resolve(__dirname, '..');
config.watchFolders = [...(config.watchFolders ?? []), path.join(root, 'server'), path.join(root, 'node_modules')];
module.exports = config;
