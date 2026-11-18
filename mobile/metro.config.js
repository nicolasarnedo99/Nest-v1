// The fine-tuned adapter ships inside the app as a .gguf file, so Metro has to
// treat that extension as an asset.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('gguf');
module.exports = config;
