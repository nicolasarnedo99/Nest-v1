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
web/          one page: wallet, a form to send an event, activity
spikes/qvac/  the September work on the earlier model, kept as history
tasks/        working notes
```
