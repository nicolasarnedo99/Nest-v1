# Bitrefill fixtures (WS0 spike)

Captured on 19 Nov 2026 around 14:50 UTC from the Mac by `npx tsx scripts/bitrefill-spike.ts`, signing with a throwaway key generated in memory. Nothing was paid. Each `*.json` holds the request (method, URL, header names, JSON body), `capturedAt`, the status, the headers that matter, and the raw body with any `token` or `signature` replaced by `"<redacted>"`. Re-running the script overwrites them and creates one more unpaid invoice (it expires after 30 minutes).

## Calls

| Fixture | Request | Status |
|---|---|---|
| `connect-402-base.json` | `POST /x402/connect`, no headers | 402, challenge in `body.extensions["sign-in-with-x"]` |
| `connect-message-base.txt` | the EIP-4361 message signed for Base (address replaced) | — |
| `connect-200-base.json` | `POST /x402/connect` with `sign-in-with-x` header, chain `eip155:8453` | 200 |
| `connect-402-arbitrum.json`, `connect-message-arbitrum.txt`, `connect-200-arbitrum.json` | same, chain `eip155:42161` | 402, then 200 |
| `esims-search-no-token.json` | `GET /x402/esims/search?q=spain`, no token | 402, micro-fee 2000 (0.002 USD) |
| `esims-search-spain.json` | `GET /x402/esims/search?q=spain` + `X-Access-Token` | 200, 1 product |
| `gift-cards-search-noon-AE.json` | `GET /x402/gift-cards/search?q=noon&country=AE` + token | 200, 1 product (`noon-uae`) |
| `gift-cards-search-noon.json` | `GET /x402/gift-cards/search?q=noon` + token, no country | 200, 2 products (`noon-uae`, `noon_com-saudi-arabia`) |
| `topups-search-spain.json` | `GET /x402/topups/search?q=spain` + token | 200, 14 products |
| `products-detail-esim.json` | `GET /x402/products/detail?slug=bitrefill-esim-spain` + token | 200, 11 packages |
| `products-detail-noon-uae.json` | `GET /x402/products/detail?slug=noon-uae` + token | 200, 8 packages |
| `invoice-create-noon-uae.json` | `POST /x402/invoice/create` + token, `{"items":[{"product_id":"noon-uae","package_value":"10"}]}` | 200, invoice `5ce13117-d32a-49cc-9091-df0fd604f97d` (unpaid, expired) |
| `invoice-pay-402-no-payment.json` | `POST /x402/invoice/pay`, `{"invoice_id":"5ce13117-…"}`, no token, **no payment header** | 402 |

Note `invoice/pay` is `POST` (the WS0 spec said GET; the docs and the 402's own `bazaar` schema say POST).

## Sign-in

The 402 from `/x402/connect` carries `body.extensions["sign-in-with-x"] = { info, supportedChains }`. `info` has `domain` (`api.bitrefill.com`), `uri` (`https://api.bitrefill.com/x402/connect`), `version` (`"1"`), `statement`, `nonce`, `issuedAt`, `expirationTime` (issuedAt + 5 min), `resources` (`[uri]`). Check `domain` and the `uri` origin before signing.

The message layout is in `connect-message-base.txt` and `siweMessage()` in the script: numeric chain id in the message (`Chain ID: 8453`), EIP-55 address (viem's `account.address` already is), signed with EIP-191 `personal_sign`. The header `sign-in-with-x` is base64 of the JSON `{domain, address, statement, uri, version, chainId: "eip155:8453", type: "eip191", nonce, issuedAt, expirationTime, resources, signature}` — CAIP-2 chain id here. The 200 body is `{ token, token_header: "X-Access-Token", expires_in: 7200, next_step }`. Send the raw token in `X-Access-Token` (no `Bearer`).

**Chains accepted for sign-in:** `supportedChains` lists `eip155:8453` (Base), `eip155:42161` (Arbitrum, listed twice), `eip155:137` (Polygon) and Solana (`ed25519`). Both Base and Arbitrum sign-ins returned 200 with a working token. The signature is chain-agnostic EIP-191, so the chain only changes the `Chain ID` line and the payload's `chainId`.

## Fields to parse

**Search** (`gift-cards`, `esims`, `topups`): `body.products[]` with `slug`, `name`, `type` (`giftcards` | `esims` | `refills`), `currency` (the face-value currency: `AED`, `USD`, `EUR`), `countries` (array of alpha-2), `in_stock`, `categories`, `product_url`, `_id`, `keywords`. Plus `found`, `page`, `per_page`, `categories[]`, `next_step`. **Search returns no prices**; a price needs `products/detail`.

**Detail:** `body.id`, `name`, `country_code`, `currency`, `in_stock`, `recipient_required` (bool), `recipient_type` (`none` for noon, `mixed` for the eSIM), `packages[]`, `url`, `subtitles`, `descriptions`/`instructions` (HTML), `ratings`, `reviews`, `payment_methods`, `next_step` (pre-filled `invoice/create` body). Each package is `{ package_value, package_currency, payment_price, payment_currency }`, all strings: gift cards `"10"` AED → `"2.82"` USD; eSIMs `"1GB, 7 Days"` USD → `"2.53"` USD. There is **no `price_usdc` on detail**; `payment_price` (USD, 2 dp) is the number to show, and it matched the invoice exactly.

**invoice/create:** `{ invoice_id, price_usdc: "2820000" (6-decimal base units), price_usd: 2.82 (number), price_satoshi, networks[], expires_in_minutes: 30, next_step: { url: …/invoice/pay, body: { invoice_id } } }`.

## Answers

**Does the token waive fees?** Yes. Without a token `esims/search` answers 402 asking 0.002 USD; with the token search, detail and `invoice/create` all answered 200. `invoice/pay` is never waived.

**Region or rate limits?** No region block from the Mac: search worked with and without `country`. Without a country, `q=noon` returned both the UAE and the Saudi card, so pass `country=AE` when the request names one. Every 200 carries `ratelimit-policy: 30;w=60` (30 requests per minute per client).

**`invoice/pay` 402 requirements, verbatim** (`accepts[]`, x402Version 2, also base64 in the `payment-required` header, identical):

```json
{"scheme":"exact","network":"eip155:8453","amount":"2820000","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","payTo":"0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A","maxTimeoutSeconds":1800,"extra":{"name":"USD Coin","version":"2"}}
{"scheme":"exact","network":"eip155:42161","amount":"2820000","asset":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","payTo":"0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A","maxTimeoutSeconds":1800,"extra":{"name":"USD Coin","version":"2"}}
{"scheme":"exact","network":"eip155:42161","amount":"2820000","asset":"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9","payTo":"0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A","maxTimeoutSeconds":1800,"extra":{"name":"USD₮0","version":"1"}}
{"scheme":"exact","network":"eip155:137","amount":"2820000","asset":"0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","payTo":"0x480CD46E6faDe651a0437DeaddA53D5c8e7D846A","maxTimeoutSeconds":1800,"extra":{"name":"USD Coin","version":"2"}}
```

Plus two Solana `exact` entries (USDC, USDT) and a Lightning `bolt11` entry; see the fixture. **The scheme is `exact`, not `upto`** as the plan assumed: the Arbitrum USD₮0 option is an ordinary EIP-3009 `exact` payment of `price_usdc` to `payTo`, with domain name `USD₮0`, version `1`, and a 30-minute window.
