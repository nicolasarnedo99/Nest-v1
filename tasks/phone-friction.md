# Phone build: friction log (raw notes for FINDINGS.md)

Running notes from building Turtle as an iPhone app, kept so Nico can rewrite the useful ones into `FINDINGS.md` in his own voice. Facts only, each with how it showed up. Nothing here goes to Tether as written.

## QVAC on iOS

- **It runs on a physical iPhone, and fast.** iPhone 17e, Qwen3 1.7B Q4 with the fine-tuned LoRA adapter, through `@qvac/sdk` 0.23.0 in an Expo SDK 58 app. A decision takes 0.6 to 1.3 seconds (about 0.2 on the Mac). After the first 1 GB download the model loads in about 3 seconds, with or without the adapter. The adapter changes decisions on the device the same way it does on the Mac (Applebee's: none with it, Apple without). QVAC's own `docs/system-resources-support-matrix.md` lists iOS as "no physical-device acceptance", so this is a data point they may not have.
- **The SDK's peer range lets in a react-native-bare-kit that breaks it at runtime.** `@qvac/sdk` declares `react-native-bare-kit >=0.16.0`, so a fresh install takes 0.17.x. From 0.17 the package no longer ships `BareKit.framework` (its README says to add it with `bare-stow` or `expo-bare-kit`). The app builds, installs and opens, then fails on the first model load with "Bare Kit is not available, so make sure the application includes bare-kit-swift or bare-kit-kotlin". During prebuild the SDK printed that 0.17.1 was "not in the built-in table" but carried on. The SDK's own table stops at 0.16.0, and its verifier code assumes the framework ships inside the npm package. Fix: pin `react-native-bare-kit` to exactly 0.16.0. Suggestion: cap the peer range below 0.17, or fail prebuild when the framework is missing rather than at the first load on the device.
- **A transitive dependency needed a newer Bare runtime, and QVAC's verifier caught it.** With bare-kit 0.16.0 (Bare 1.33.4), prebuild failed: `bare-type@1.6.0 requires bare >=1.37.0`. The verifier named the mismatch and proposed the exact fix, `"overrides": { "bare-type": "1.4.0" }`, which worked. Good tooling; the gap is that a default install needs two manual pins before it runs on iOS, and neither is in the setup steps.
- **Device only.** QVAC does not run in the iOS simulator (documented), so every test is a signed build over a cable.
- **The adapter travels inside the app.** 70 MB, bundled as an asset and handed to `modelConfig.lora` as a file path. Worked first time.
- **Explanations are not reliable even when the decision is.** On the phone, with the adapter, Carrefour was skipped correctly "because" it is an "unrelated car rental operator". Untuned, explanations ignore the 3 to 8 word limit.

## WDK in a React Native app

- **Tether's starter and QVAC cannot share an app as-is.** `tetherto/wdk-starter-react-native` pins `react-native-bare-kit` 0.14.5; QVAC 0.23 needs at least 0.16.0. The starter's `docs/ENVIRONMENT.md` says Expo SDK 55 is required, while its `package.json` asks for `expo ^58` with `~55` Expo modules. So Turtle adds `@tetherto/wdk-react-native-core` to its own app and uses the starter as a reference. Suggestion: a note in the starter on adding a second Bare worklet (such as QVAC) and which bare-kit versions core supports.
- **`@tetherto/wdk-react-native-core` accepts bare-kit >=0.14.5 and `expo-crypto` below 57.** On Expo 58 that needs an `overrides` pin for `expo-crypto`, as the starter does.
- **WDK and QVAC run side by side on the phone.** Two Bare worklets in one Expo app: the WDK wallet creates and keeps its address across a force-quit and relaunch, and the model still loads (3.8 s) and decides (0.9 s) beside it. About 30 minutes of work once the pins below were found.
- **WDK's runtime layer needed the older release Tether's starter uses.** Every `bare-node-runtime` after 1.5.0 crashed the app at launch on the Bare runtime inside bare-kit 0.16.0 (`ModuleTraverseError: ADDON_NOT_FOUND … bare-channel/binding.js`). The WDK packages ask for `^1.5.2`; pinning 1.5.0 with `overrides` fixed it. Not yet tested: signing with that pin (next task).
- **A WDK signature made on the phone is accepted on chain unchanged.** `useAccount(...).extension().signTypedData(...)` produced an EIP-3009 authorisation that USD₮0's `receiveWithAuthorization` accepted as is, with amounts passed as decimal strings. Sepolia tx `0x07a0e611…496b`; the phone's wallet has never held ETH. The `extension()` proxy is the route to any account method the hooks don't wrap.
- **The two SDKs each link native addons, and QVAC's prebuild removes WDK's.** QVAC's Expo plugin regenerates the addon folder and links only its own, so the wallet's 22 addons had to be linked back by a small config plugin of our own. Suggestion: a documented way for both SDKs to add addons to the same app.

## Card taps without opening the app

- **iOS stops a background app from using the GPU, so the model cannot decide in the background.** Apple documents that Metal work from the background is refused; Private LLM's FAQ says CPU-only inference is more than 10× slower. Turtle splits the job instead: a Shortcuts "Transaction" automation runs a small App Intent ("Note Payment", added with `expo-app-intents`) that only queues the merchant and amount and posts a local notification. Tapping the notification opens Turtle, which decides on the GPU and pays. Hand-tested on the phone: notification without the app showing, then decided and paid on Sepolia (tx `0xccdf4d0a…7c81`).
- **`expo-app-intents` (alpha) worked first build.** Its docs only show `openAppWhenRun`; running in the background needed `supportedModes = .background` from the iOS SDK. Its JS side is a queue the app drains when opened, which is exactly what this design needs.
- **Apps cannot create the payment automation themselves.** The user builds the Transaction automation once, by hand; the app can only guide them there.

## Apple and Expo toolchain (not Tether's, but cost time)

- The Mac App Store could not connect; Xcode came from developer.apple.com as a `.xip`.
- CocoaPods was not installed; `brew install cocoapods`.
- `expo run:ios --device` stopped at signing with a free Personal Team ("No profiles … Automatic signing is disabled"). Calling `xcodebuild` with `-allowProvisioningUpdates -allowProvisioningDeviceRegistration` created the profile. A Personal Team build expires after 7 days.
- iOS refuses to open the app until the developer certificate is trusted in Settings → General → VPN & Device Management.
