// Links the native addons the WDK wallet worklet loads into
// react-native-bare-kit. The QVAC plugin clears that folder and links only its
// own worker's addons, so this must run after it: it is listed BEFORE QVAC in
// app.json because Expo runs dangerous mods in reverse plugin order.
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');
const { readBundle, discoverLinkedAddons } = require('@tetherto/wdk-worklet-bundler');
// The bundler's own bare-link (3.x) links an addon package dir; the top-level 4.x wants an entry file.
const link = require(require.resolve('bare-link', { paths: [path.dirname(require.resolve('@tetherto/wdk-worklet-bundler/package.json'))] }));

module.exports = (config) =>
  withDangerousMod(config, ['ios', async (mod) => {
    const root = mod.modRequest.projectRoot;
    const out = path.join(path.dirname(require.resolve('react-native-bare-kit/package.json')), 'ios', 'addons');
    const addons = discoverLinkedAddons(readBundle(path.join(root, '.wdk-bundle', 'wdk-worklet.bundle.js')), root);
    for (const addon of addons) {
      for await (const _ of link(addon.dir, { hosts: ['ios-arm64', 'ios-arm64-simulator', 'ios-x64-simulator'], out })) {}
    }
    console.log(`🔗 WDK: Linked ${addons.length} native addons into react-native-bare-kit`);
    return mod;
  }]);
