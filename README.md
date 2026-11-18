# Turtle

A card purchase comes in. A small model running on this machine decides which listed company the merchant belongs to, or that it belongs to none. If it names one, a wallet buys a little of that company's stock. The model runs through Tether's QVAC SDK and the wallet is a Tether WDK account, paying with a test copy of the USD₮0 token contract on Ethereum's Sepolia testnet.

This is a technical demo for one user on one machine. It has no login and no onboarding, and nothing in it is real money or a real share. What I learned building it, with the scores and the friction I hit, is in [FINDINGS.md](FINDINGS.md).

## How a purchase happens

```
card event ──> intake ──> model (QVAC, Qwen3 1.7B with a LoRA adapter)
                              │ a short explanation, then a company or none
                  none ──> stored as skipped, nothing is signed
               company ──> budget check in code, before any signature
                              └─> the WDK wallet signs one message
                                   └─> a relayer submits it to the seller contract
                                        └─> the test token moves, a stand-in share is issued
```

The model makes exactly one decision. Everything after it is plain code: the amount is a tenth of the card purchase, held between 0.10 and 1.00, with a cap of 5.00 a day, and those limits are enforced before the wallet is asked to sign.

The wallet never sends a transaction and never holds ETH. USD₮0 supports signed transfers (EIP-3009), so the wallet signs a message that lets the seller contract, and only that contract, pull one payment inside a ten-minute window. A second key, the relayer, pays the gas to submit it. The relayer cannot redirect the payment: the token refuses the signature anywhere but inside the seller, and the signature's nonce is the hash of the order, so it only verifies for the company and the order the wallet signed for.

## What is real and what is a stand-in

The token is the real USD₮0 code. `contracts/vendor/usdt0` holds the verified source of the implementation that is live on Plasma, unmodified, and the build fails unless the compiled bytecode is identical to what is deployed there. What I deployed on Sepolia is a copy of that code that I own and mint myself, named "Test USDT0 copy (Turtle demo)". It is not USD₮0 and has no value.

The shares are stand-ins. `StockSeller` issues a plain token at a fixed placeholder price. I looked for a tokenised stock I could honestly buy and found none: the issuers I checked restrict EEA individuals to professional or qualified investors, and I found no tokenised stock on a chain where USD₮0 is deployed, apart from a venue due to open on X Layer.

The model, the fine-tuning, the wallet, the signature and the on-chain settlement are all real.

## Run it

Node 22.17 or newer (built and tested on Node 26, Apple Silicon).

```sh
npm install
npm --prefix contracts install
npm run compile:contracts     # builds USD₮0 and checks it against Plasma
npm run setup:keys            # writes the two testnet keys to .env, prints the address to fund
```

Send a little Sepolia ETH to the relayer address it prints, then:

```sh
npm run deploy                # deploys the token copy and the seller, mints test tokens to the wallet
npm run build
npm run server                # http://127.0.0.1:4173
```

To try it with no faucet, run `npm run chain` in another terminal and deploy to it with `TURTLE_RPC=http://127.0.0.1:8545` and one of Hardhat's development keys as `TURTLE_RELAYER_KEY`, then start the server with `TURTLE_DEPLOYMENT=contracts/deployments/local.json`.

The page lets you send a simulated card event and watch it be classified and, where the model names a company, bought. Real card taps arrive from an iPhone Shortcut at `/api/notifications/apple-wallet` with a scoped token created on the page; set `TURTLE_HOST` to the machine's Tailscale address so the phone can reach it. Every other route only answers requests from the machine itself.

## Phone app

`mobile/` is the same idea as an iPhone app: the model runs on the phone through QVAC, the wallet is a WDK account in the app, and a purchase is a sponsored transaction. The wallet is an EIP-7702 account, so it holds no ETH. Candide's public Sepolia bundler and paymaster pay the gas, and the app sends `buy` to the seller contract itself. It does not need the Mac, the server or Tailscale. The phone enforces the same 0.10 to 1.00 buy limits and the 5.00 daily cap before it signs.

The app's display name is Nest. The bundle id is still `dev.nicolasarnedo.turtle`.

It needs a physical iPhone: QVAC does not run in the iOS simulator. Tested on an iPhone 17e with iOS 27.

You need Xcode (from developer.apple.com if the App Store will not connect), CocoaPods (`brew install cocoapods`), an Apple ID added in Xcode as a Personal Team, Developer Mode on the phone (Settings, Privacy & Security), and a cable.

```sh
cd mobile
npm install
npm run sync                  # copies the deployment and the trained adapter into the app
npm run typecheck
npx expo prebuild --platform ios --clean
```

`sync` needs the adapter from the commands in the next section to exist. Find the phone's id with `xcrun devicectl list devices`, then build and install:

```sh
cd ios
xcodebuild -workspace Nest.xcworkspace -scheme Nest -configuration Release \
  -destination id=<UDID> -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  -derivedDataPath build build
xcrun devicectl device install app --device <UDID> build/Build/Products/Release-iphoneos/Nest.app
```

`expo run:ios` stops at signing with a free Personal Team, which is why `xcodebuild` is called directly. A Personal Team build expires after 7 days; run the same two commands again to renew it. On first launch iOS refuses to open the app until you trust the certificate in Settings, General, VPN & Device Management. The first launch then downloads the 1 GB model; after that it loads in about 3 seconds.

On first launch, a short setup downloads the model, creates (or reopens) the wallet, picks a saving strategy and explains the Shortcut. Nothing is created online and there is no account. After setup, three tabs: Home (balance, today's spend against the cap, invested per company, recent activity and a "Try a merchant" box), Activity (every entry, with a detail sheet) and Agent (model, strategies, lookup service, wallet, Replay setup).

`node mobile/scripts/icons.mjs` regenerates the icon and the in-app mark from `mobile/assets/mark.svg` with headless Chrome.

Two version pins in `mobile/package.json` are needed for QVAC to run on iOS, and a fresh install breaks without them. `react-native-bare-kit` is pinned to exactly 0.16.0, because 0.17 no longer ships `BareKit.framework` and the app fails on the first model load. `bare-type` is overridden to 1.4.0, because 1.6.0 needs a newer Bare runtime than bare-kit 0.16.0 embeds. The WDK wallet adds two more: `bare-node-runtime` is overridden to 1.5.0, because later releases crash the app at launch on that runtime, and `expo-crypto` to `~55.0.16`, which WDK core requires. `mobile/plugins/withWdkAddons.js` links the wallet's native addons back in after QVAC's prebuild clears them.

The phone cannot run the model while the app is in the background, so a card tap is split in two. The Note Payment action, added by the app, only queues the merchant and amount and posts a notification; tapping the notification opens Nest, which decides and pays. To wire it to Apple Pay, open Shortcuts, then Automation, and create a personal automation with the Transaction trigger. Choose When I tap, pick your card, and select Run Immediately. Add the Note Payment action and map Merchant and Amount from Shortcut Input. Open Nest once first and allow notifications.

Candide documents its public sponsorship as funded by a policy and does not promise it on Sepolia. It worked without a key when this was built; if it stops, the app needs a free dashboard key and a private policy id.

## Merchant lookup service

`server/lookup-service.ts` answers "who operates this merchant" for 0.01 USD₮0 per lookup over x402. The answers are demo data from a small table. The service settles each payment on Sepolia itself: the relayer pays the gas and receives the fees. Only this route runs on the box, with no model and no agent seed.

```sh
npx tsx server/lookup-service.ts        # needs TURTLE_RELAYER_KEY; LOOKUP_PORT defaults to 4180
```

To deploy it to morty, run `scripts/deploy-lookup.sh`. It copies the service and its dependencies and restarts the unit if it exists. The unit is `deploy/lookup/turtle-lookup.service`. Its env file is `~/.config/turtle-lookup.env`, mode 600, and holds `TURTLE_RELAYER_KEY` and `TURTLE_RPC`. Use an RPC URL with no API key in it, because x402 can print the URL in its error log. Then publish the port with `sudo tailscale funnel --bg 4180`.

Check a running instance, local or public, with `npx tsx scripts/x402-smoke.ts <url>`.

## The model

`classifier/` holds the evaluation and the fine-tuning, both run through QVAC.

```sh
cd classifier
node build-train.mjs          # training and validation files from train-source.json
node eval.mjs --cases=frozen --label=before-reason-first --order=reason-first
node train.mjs --run=run3 --order=reason-first --epochs=2 --lr=3e-5 --context=320 --checkpoint=60
node select.mjs --run=run3    # picks one saved adapter using the validation rows only
node eval.mjs --cases=frozen --label=after-reason-first-run3 --order=reason-first --lora=adapters/run3/selected.gguf
node verify.mjs               # recomputes every verdict from the saved raw output
```

Adapter files are about 70 MB each and are not in the repository; the commands above rebuild them in a little over an hour on an M4 Max. The training logs, the per-checkpoint validation scores and every raw model answer are in `classifier/adapters` and `classifier/results`.

There are two test sets. `frozen` is the 36 cases from September, never used for training. `blind` is 24 cases written by a separate agent that saw neither the frozen cases nor the training data. A third set of 30 validation rows, held out of training, is used only to choose between saved adapters. The prompt and the generation settings are identical before and after; only the adapter changes. Output that is malformed or truncated counts as a failure, never as a decision to skip.

`--order` sets which of the two JSON fields the model writes first. It turned out to decide whether fine-tuning worked at all; see FINDINGS.md.

## Tests

```sh
npm test
```

The contract tests start a local chain, deploy the real USD₮0 code and the seller, and buy with a signature made by a WDK account. They check that the buyer ends with no ETH, and that a relayer holding the signature cannot reuse it, change the company, raise the amount, or take the payment for itself.

## Layout

```
classifier/   evaluation, training data, fine-tuning (QVAC)
contracts/    vendored USD₮0 source, StockSeller, build and deploy helpers
server/       intake, pipeline, purchase engine, WDK payment adapter
mobile/       the iPhone app: QVAC model, WDK wallet, sponsored buys
web/          one page: wallet, a form to send an event, activity
spikes/qvac/  the September work on the earlier model, kept as history
tasks/        working notes
```
