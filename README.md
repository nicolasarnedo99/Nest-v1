# Turtle

Turtle is a private Arc testnet demo: sign in, inspect an existing wallet
balance, save a labeled simulated purchase, and see that activity after a
reload. **Investments are paused.** Saving an event neither charges a card,
moves funds nor queues a future investment. Classification work is deferred.

The implemented journey uses Privy login with a server-enforced user
allowlist, read-only balances and synthetic-token holdings, test-USDC
receive instructions, and durable SQLite activity with duplicate-ID
protection. Allocation amounts are estimates for the demo, not executed
investments. Only the allowed account can read activity or manage a scoped
Shortcut token. The web server has no signing or broadcast path.

Authenticated Apple Wallet notification intake is also implemented, but
real card fields and phone-to-server delivery remain unverified. A saved
Revolut Mastercard diagnostic is ready for a future normal purchase; its
single Show Content Graph action does not send anything to Turtle. This
pending device check does not block the simulation demo.

Use the [short demo script](tasks/demo-script.md) for the verified journey.
The separate manual CLI's completed testnet buy/redemption is historical
evidence, not part of this demo or permission for another transaction.

## Run on morty

Use Node 22.23.2 or a compatible Node 22 release. Check for an existing
listener on 4173 before starting another server. From `/home/nico/turtle`:

```sh
npm ci
npm run build
npm run server
```

The app binds only to `127.0.0.1:4173`. On Nico's iPhone, connect Tailscale and
open `https://morty.tail73d5db.ts.net`; the configured Tailscale Serve proxy
forwards HTTPS to that loopback listener. The route is private to the
tailnet, and Privy authentication still protects the API. A computer's
localhost SSH forward is not reachable from the phone.

A computer can also use its own SSH forward to `http://127.0.0.1:4173`.
Production frontend and API share one origin; configure the browser origin
in Privy. For frontend development, `npm run dev` starts Vite, which proxies
`/api` to the existing backend. Building alone does not start another server.

The existing private `.env` must contain `PRIVY_APP_ID`, `PRIVY_APP_SECRET`,
and `TURTLE_ALLOWED_PRIVY_USER_ID`. The allowed ID uses the `did:privy:` prefix.
The public app ID is returned by `/api/config`; secrets and user identifiers
are not bundled into the frontend. Automatic embedded-wallet creation is off.
Never print the environment file or copy it into source control.

Startup reuses `spikes/privy-arc/.private/provision.json`, checks its pinned
user and app ownership, and refuses unresolved provisioning. Preserve this
private state. Do not provision a replacement wallet. The login is linked
server-side; it does not own the signing key. Data lives in
`data/turtle.sqlite`, using WAL and full synchronous writes. Stop the server
before a filesystem backup or use SQLite's consistent backup facilities.

## Current behavior

`POST /api/events` validates a stable UUID, merchant, decimal amount, USD/EUR
currency, and ISO timestamp. The source is always assigned as `simulation`
by the server. A new event returns 202 after persistence; an identical retry
returns 200; a changed payload with the same ID returns 409. The UI stores the submitted ID and payload in user-scoped sessionStorage
before sending. It retains that identity after a network failure, rate limit,
re-login, or reload so an explicit retry of that save cannot create a second
event within the same browser tab session. Closing the tab loses that local
draft, so check activity before re-entering an uncertain event. The API lists the latest 200 events.

Amounts use integer micro-USDC arithmetic. The planned allocation is 10%,
clamped to 0.10–1 test USDC. EUR uses an explicitly simulated rate of 1.10
USD per EUR dated 12 September 2026, not a live market rate. Each stored EUR
event records this rate. The 5 test-USDC daily cap, Europe/Madrid day boundary,
outstanding reservations, and 1 test-USDC reserve after worst-case gas have
unit-tested calculation functions. The separate manual execution engine persists its own reservations and
transaction attempts in `data/execution.sqlite`; simulation events never
enter that engine. Restart marks unsigned unfinished events `needs_retry`.
No delayed buys run on startup or after errors.

## Fund the existing wallet

After login, **Add test USDC** shows the existing Arc wallet's full receive
address and a copy action. Use the linked Circle faucet with Arc Testnet and
USDC, or transfer test USDC from your own Arc testnet wallet. Do not use real
funds or another network. No new wallet is created and Turtle does not send
the funding transaction. Check incoming funds to read the balance again;
the panel shows its opening balance and the latest observed balance. A
balance increase is not verification of one particular deposit. The wallet
explorer link lets you inspect incoming transactions. A failed read shows
an error, never a funding confirmation.

The network and faucet are listed in [Arc's RPC reference](https://docs.arc.io/arc/references/rpc-endpoints).
The wallet headline shortens long decimals to fit mobile screens and marks
them approximate. Positive amounts below 0.0001 display as less than 0.0001,
not zero. The receive panel retains the full exact balance.

Funding does not enable token purchases.

## Apple Wallet Shortcut intake

Sign in and use **Connect a card-tap Shortcut** to create an intake token.
The Authorization header is shown once in that browser session and is not
saved in browser storage. Only its SHA-256 hash is stored server-side,
bound to the configured Privy user. Replacing it invalidates the previous
token; revoking access preserves received notifications. If creation times
out, check setup state after reloading and replace a token you did not receive.

`POST /api/notifications/apple-wallet` accepts that scoped bearer token and
the same five fields as simulation intake. Source is assigned as
`apple_wallet`; clients cannot supply source, wallet, card identifiers or
extra fields. The token cannot read wallet/activity, submit simulations,
manage tokens, retry purchases or change pause state. Notifications have a
separate additive table so the original simulation table and historical
records remain intact. Both sources appear in receipt order in activity.
Stable IDs are protected across both sources: same payload/source returns
the existing receipt, and changed payload or source returns 409.

A new durable receipt returns 202; an identical retry returns 200. The
response is `{id, received: true, purchased: false, status: "needs_retry"}`.
Neither response proves bank settlement. No notification enters execution
or becomes a delayed buy. Intake allows 30 authenticated requests per minute
and a 4 kB JSON body; the rate window resets on server restart. Token hashes
and notification receipts persist across restart.

Follow [the phone setup and verification steps](tasks/apple-wallet-setup.md).
The server stays on loopback; use the private HTTPS route above from the
iPhone. Transaction was found and the Revolut Mastercard diagnostic is saved.
Actual fields, unattended execution and a real phone-to-server notification
remain pending the next normal card purchase. Inspect the received fields
before wiring them; do not infer absent merchant, amount or currency values.
Any manually supplied values must be distinguished from Wallet input.

## Verification

```sh
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:ui
```

Backend tests cover authentication rejection, durable idempotency, payload
conflicts, invalid amounts and currencies, pause/retry blocking, restart,
rate limits, fixed-point money, cap boundaries, midnight, and reserve/gas
exposure. Browser tests use a test-only Privy stub and mocked API responses
to exercise the interface and uncertain-save retry. They do not claim a
live authenticated end-to-end test. The production build never aliases the
stub. Browser screenshots are written to ignored `test-results/`.

The live Privy policy spike previously verified signing a deliberately
non-broadcast fixture and six actual `policy_violation` rejections. The
signed fixture is private, has nonce 1,000,000,000, and must never be broadcast
or imported into application execution. Ten complete per-pair policy rules
constrain the selected five companies because numeric calldata conditions
support equality but not membership. This is provider-tested policy evidence,
not proof that the application buys or redeems tokens.

## Authorized manual round trip

The one-time live check completed on 12 September 2026: the 0.10 test-USDC
buy and exact-output redemption both finalized. Final balance was
9.993153889999999688 test USDC with zero Apple synths. Full hashes, receipt
and balance evidence are in [the checkpoint](tasks/manual-roundtrip.json).
The authorization is consumed; existing commands cannot create another buy.

The CLI permits exactly one 0.10 test-USDC Apple buy, then redemption of
that buy's exact verified minted amount. It cannot enable automatic buys,
process simulation events, change assets, or reuse signing fixtures. The
wallet, policy hash, live policy, chain, registry, contract bytecode, quotes,
nonce, reserve after maximum gas, and transaction simulation are checked
before signing. Each transaction's maximum gas cost is capped at 0.10 test
USDC, in addition to the 1 test-USDC remaining-balance requirement.

```sh
npx tsx server/manual.ts preflight
npx tsx server/manual.ts prepare
npx tsx server/manual.ts status
```

These commands read chain state or prepare a quote without signing. Real
Privy login through the production browser must produce recent private
`data/browser-verification.json` evidence before either execution command.
That evidence proves authenticated API access, not that someone inspected
the rendered interface; record the user's browser confirmation separately.

```sh
npx tsx server/manual.ts buy
npx tsx server/manual.ts redeem
```

The engine writes intent and reservation before requesting a signature,
then writes signed bytes and their hash before validating and broadcasting.
It verifies finalized receipts, immutable transaction fields, mint/burn and
vault events, nonce changes, and historical native/synth balance changes.
Only the verified buy output can be redeemed. Redemption does not replenish
the gross daily buy allowance. Existing attempts are returned without new
signing or broadcasting; new IDs cannot bypass the one-time authorization.

An uncertain result retains its reservation. Inspect the persisted hash and
start with read-only reconciliation; no command automatically rebroadcasts
or re-signs. Limit receipt checks to 12 per transaction, five seconds apart.

```sh
npx tsx server/manual.ts reconcile authorized-2026-09-12-apple-buy-0.10-v1
npx tsx server/manual.ts reconcile authorized-2026-09-12-apple-redeem-v1
```

If explicit recovery is required, `broadcast-saved` accepts the same saved
attempt ID. It checks for an existing receipt, revalidates live policy,
venue, nonce, reserve, gas, and the original minimum output, then sends the
identical bytes once. It cannot request another signature or change fields.
Use it only after diagnosing the uncertain state, never as a blind retry.

Private raw bytes stay in `data/execution.sqlite`; sanitized hashes and
accounting evidence are in `data/manual-roundtrip.json`. Preserve these and
the existing provisioning state. The CLI shares the provisioning spike's
exclusive `.private/lock` and also holds a SQLite wallet lock during work.
If interrupted, do not delete the file lock blindly: inspect its saved PID
and command, establish that the process is dead and no wallet worker is
running, then reconcile saved attempts before any new action. An old empty
lock has no owner evidence and requires explicit investigation. The engine
can reclaim its own SQLite lock only when the recorded process is dead.

## Deferred work

Classification is deferred, not part of the runnable demo. QVAC can load the
pinned NVIDIA model, but the tested classifier candidates failed eligibility
checks. Before any automatic investment work, classification must pass the
original acceptance cases and negative/held-out checks without weakening
expected abstention. Both technologies remain required; no configuration
switch enables purchases. Do not restart that investigation as part of this
demo setup.

The roadmap includes verified Wallet field mapping and delivery, a passing
classifier, and separately authorized integration and end-to-end execution
verification. These are future outcomes, not features demonstrated by saving
a simulation. The device check remains pending and independent UI/documentation
work is authorized.

The manual engine has durable reservations, nonce checks, and read-only
reconciliation after ambiguous signing, broadcast, or receipt responses.
Actual browser and transaction verification results are recorded in
`tasks/todo.md`; implementing the engine alone does not prove a live round
trip. This checkpoint prepares the demo script; recording and submission
remain to be completed. Arc testnet AchRWA tokens
are synthetic price tokens, not backed shares or a production investment
product. Oracle and redemption liquidity can change. See
`tasks/implementation-plan.md`, `tasks/todo.md`, and the feasibility reports
for current evidence and constraints.

QVAC CLI 0.13.0 uses SDK 0.19.1 and llm-llamacpp 0.49.1 on morty. The model is
NVIDIA Nemotron 3 Nano 4B Q4_K_M at revision
`ba223d14e45525f7fae81db77ea8cabeb2fc6c25`. Model metadata, checksum, license
reference, and failed evaluations are recorded in `tasks/qvac-feasibility.md`.
`libatomic1` is required by the QVAC native worker. Weights stay outside source
control. Solana packages in the dependency graph satisfy Privy React's build
requirements; Turtle still targets only Arc testnet and creates no Solana wallet.

Codex assisted with implementation, tests, and documentation. Nico owns the
project decisions, manual signed commits, recording, and submission.
