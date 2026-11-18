# Turtle preparation

## Tether stack rebuild, 13 to 15 Nov (branch tether-stack)

Plan: ~/.claude/plans/all-thrhe-set-high-cuddly-blossom.md. QVAC decides, WDK
pays in a copy of USD₮0 on Sepolia. Send to Tether on Sunday 15 Nov.

- [x] Branch, QVAC SDK 0.23.0 on Node 26, Qwen3 1.7B smoke completion
- [x] Baseline on Qwen3: frozen 18/36, blind 9/24, every null is a false buy
- [x] 300 training rows and 24 blind cases written by separate agents
- [x] Fine-tuning and adapter with JSON schema confirmed working
- [x] Training run 1 stopped: loss rose in the second pass, no adapter saved
- [x] Training run 2 (decision first): never learned to abstain selectively
- [x] Training run 3 (explanation first): frozen 36/36, blind 21/24, 3 false buys
- [x] Tuned demo on Sepolia: Carrefour and an independent garage skipped, Apple and Tesla bought
- [x] USD₮0 source vendored, compiled, bytecode identical to Plasma
- [x] StockSeller and local-chain tests with a WDK signature (7 pass)
- [x] Engine rewritten around a signed authorisation
- [x] WDK payment adapter and relayer
- [x] Classifier wired to execution, Privy removed
- [x] Deploy to Sepolia (needs Sepolia ETH from Nico)
- [x] Bridge fee quote and UI labels
- [x] First real buy on Sepolia (base model, Apple): 0x2106eb2d9f59b25f0932cb8deb826e87813facdce50fb5cf093d0ceb7b8e0edb
- [ ] Real Carrefour tap from the iPhone Shortcut
- [x] FINDINGS.md and README
- [ ] Nico: review FINDINGS.md wording, record the demo, commit

## Completed checkpoint — state reconciliation and grammar comparison

Authorized 12 September 2026 at 10:44 UTC for up to 60 minutes, ending
11:44 UTC. Restore the paused app after read-only reconciliation, then run
one grammar-on/off comparison with unchanged QVAC/NVIDIA, relationships-a,
all 36 cases and strict validation. Inference has its own 30-minute and
72-request ceiling. No retries, prompt edits, application integration,
signing, broadcasts, wallet changes, commits or pushes. Automatic purchases
remain disabled. A passing result permits configuration documentation and
an integration plan only; failure requires a new explicit decision.

- [x] Reconcile repository, wallet receipts and database history
- [x] Restore and verify one persistent paused application
- [x] Run and independently verify both frozen comparison arms
- [x] Preserve evidence and record the next decision

Read-only RPC at 10:45:21 UTC confirms the saved wallet on Arc 5042002,
native balance 9.993153889999999688 test USDC, latest/pending nonce 2,
and zero Apple synths. Both known receipts match the saved successful
blocks and transaction nonces. SQLite holds exactly two confirmed manual
attempts, no execution lock, one needs_retry simulation, zero notifications
and paused=true. See tasks/grammar-state-checkpoint.json. This is main at
d0bdc16 in the sole /home/nico/turtle worktree; 10 USDC/nonce 0 notes are
historical checkpoints, not a different wallet or missing round trip.
Existing uncommitted UI/docs work is preserved. A private logical database
and fixture hash baseline is saved before service restoration.

Restored the existing app with npm run server in the turtle tmux session's
paused-app window. Exactly one listener is on 127.0.0.1:4173, PID 1017245.
Local and tailnet HTTPS root return 200; unauthenticated /api/status returns
401. The accessible URL is https://morty.tail73d5db.ts.net with Tailscale
connected. The execution database and all private fixture hashes match the
pre-start baseline. App startup advanced only SQLite's event_order sequence
counter from 1 to 2 through its existing INSERT OR IGNORE. Reversing that
single line in an in-memory dump reproduces the exact pre-start hash; all
event, setting, credential and history rows are unchanged. The actual
database was not reset. No authenticated write or new event was needed.

The isolated compare-grammar.mjs driver passed syntax and strict acceptance
self-checks. It preserves raw output before parsing, counts requests before
dispatch, writes exclusively created reports and retains invalid outputs as
failed cases. One worker ran both arms sequentially with a fresh
model load per arm, guarded by a 30-minute process timeout. The pinned model
SHA-256 was reverified. No original prompt, case, schema or report changed.
Inference started at 10:47:20 UTC; its deadline is 11:17:20 UTC.

Grammar-on control completed at 10:52:51 UTC: 30/36 correct, six false
eligible decisions, zero invalid responses, warm p95 9.6681 seconds.
This reproduces the saved relationships-a accuracy. Its model was unloaded
before the grammar-off arm started with a fresh load. The gate remains closed.

Final checkpoint: both arms completed at 10:58:21 UTC, after exactly 72
requests in about 11 minutes. Grammar on: 30/36, six false eligible results,
zero invalid responses, p95 9.6681 seconds. Grammar off: 30/36, four false
eligible results and two invalid string-null responses, p95 9.5002 seconds.
All eighteen positives pass in both arms; only twelve of eighteen negatives
correctly abstain. No timeout, truncation, repair or retry occurred.
The grammar hypothesis does not yield a sufficient fix. See
tasks/qvac-grammar-comparison.md and the three new JSON reports in spikes/qvac.

Independent verification passed for all raw outputs, unchanged frozen inputs,
72 distinct requests, verdicts and metrics. Workers closed successfully;
the app remains reachable with purchases disabled and one listener.
Final preservation checks confirm unchanged private fixtures, execution
history and app rows except the documented internal startup counter.
No application integration or transaction occurred. The session finishes
within its 60-minute ceiling, with no commits or pushes.

Next decision: authorize a separately budgeted NVIDIA model/configuration
change through QVAC with the same acceptance gate, or accept a disclosed
non-autonomous demo. Do not repeat this comparison or another prompt-only
attempt without a new scope. No passing integration configuration exists.

## Current scope — classifier diagnosis and proposal, 12 September 2026

Nico authorized a 30-minute diagnosis and proposal, superseding the saved
classification deferral below. UI/demo preparation is complete. The next
priority is reliable QVAC/NVIDIA classification, then a simulated purchase
that produces a real Arc investment. This checkpoint proposes the smallest
isolated change first; it does not enable automatic investments or consume
historical transaction authorization. App implementation and chain changes
remain gated by the current session.

- [x] Read rules, profile scope, task history and implementation plan
- [x] Inspect current code and all QVAC diagnosis and evaluation evidence
- [x] Verify saved results and prepare one concrete fix proposal

Proposal completed within the 30-minute ceiling. See
tasks/qvac-fix-proposal.md. The demonstrated cache fix is insufficient;
recommend one frozen comparison of native grammar on/off with the same
strict JSON acceptance validator and all 36 regression cases. No new prompt
experiment, inference request or application integration was performed.

Recomputed all seven result files and verified all 118 preserved SDK raw
responses against parsed values. Original cases and schema remain intact.
The classifier gate still fails. Current code keeps event intake separate
from execution; the manual engine's one-shot buy authorization is consumed.
No listeners on 4173, 5173 or 11435 and no Bare worker were found. No service
was changed. Existing edits, wallet/history and fixtures were preserved;
no wallet queries, signing, broadcasting, commits or pushes occurred.

## Current scope — coherent demo journey, 12 September 2026, 09:48 UTC

Nico authorized up to 60 minutes, ending at 10:48 UTC, for the existing demo
journey and documentation. Inspect login, funding balance, simulation,
persisted activity and the investment-paused explanation; make only needed
UI changes, verify mobile layout, reload, empty and error states, then
prepare README and a short demo script separating implemented behavior
from future work. Root owns documentation and backend verification; a
focused agent owns UI inspection, surgical fixes and isolated browser tests.

- [x] Inspect and finish the existing demo journey
- [x] Verify mobile layout, reload persistence, empty and error states
- [x] Prepare README and a short demo script
- [x] Verify preserved state and record results with one next task

Apple Wallet field verification is pending because Nico cannot make a normal
card purchase today. It does not block independent work. The saved Revolut
Show Content Graph diagnostic remains ready for a future purchase; it sends
nothing to Turtle. Classification is explicitly deferred. Automatic
investments stay disabled. Preserve all existing wallet, token and activity
state; no production simulations, transfers, commits or pushes in this scope.

Preflight: production listens on 127.0.0.1:4173 (PID 1008293); no listener on
5173 or 11435. Do not start duplicate production services. Saved a private
preservation baseline for provision, execution DB and app tables under
data/checkpoints/demo-review-preservation.json. Existing task edits and
untracked tasks/iphone-transaction-research.md are preserved.

Completed at 09:54 UTC, within the 60-minute ceiling. The demo now has a
clear Investments are paused explanation without the redundant Confirm
pause button. Activity follows the simulation form; optional Shortcut setup
comes after holdings. Long wallet balances use a visibly approximate compact
headline while exact balances remain in the receive panel. Tiny positive
balances display < 0.0001 instead of zero. No allocation or execution logic
changed. Shortcut copy marks real fields/delivery pending and forbids
invented Wallet values; the setup guide now uses the verified private HTTPS
route. README separates implemented features from deferred work, and
tasks/demo-script.md provides a roughly 90-second walkthrough using the
existing event to avoid changing production history.

Verification: all 110 backend tests and 16 browser tests passed, along with
TypeScript and the production build. Browser coverage includes login,
funding reads, labeled save/reload, empty activity and holdings, wallet and
activity failures, rejected saves and stable-ID network retries. Layout
checks pass at 320, 390, 430 and 1280 pixels; login, empty, error and populated
screenshots were inspected. Balance boundary checks cover true zero and
one native base unit. The existing large-chunk build warning remains.

Browser tests use isolated auth/API fixtures; they do not re-verify real
Privy login or actual phone notification delivery. Earlier live iPhone
login and simulation-reload evidence remains preserved. Production HTTPS
now serves the new build through the existing listener; no restart or
second production server was needed. Protected status, activity, token
creation and notification routes all reject unauthenticated requests with
401. The served bundle contains the updated pause explanation and no
browser-test authentication token.

Final preservation checks match the private baseline for the wallet
provision, execution database, original simulation rows, notifications,
activity ordering, pause settings and scoped credential. No production
event, wallet transfer, signing, classifier run, commit or push occurred.
The UI agent finished and no test server remains active. Documentation
links and git diff whitespace checks passed. Existing task changes and
untracked research were preserved.

Apple Wallet field verification remains pending the next normal purchase,
not blocking independent work. Classification remains deferred and automatic
investments disabled. Suggested next task: record the short walkthrough in
tasks/demo-script.md using the existing saved simulation.

## Current checkpoint — Revolut diagnostic configured, 12 September 2026

Nico corrected the checkpoint: Transaction was found. He selected Revolut
Mastercard, all categories and Run Immediately. The automation contains
Show Content Graph with Shortcut Input and has reached the final save step.
Saving is confirmed by the screenshot described below. No actual tap data
has been inspected.
This diagnostic sends nothing to Turtle.

Implementation is already approved. Classification is explicitly deferred;
do not restart classifier work or request blanket implementation approval.
The current authorized work is guided inspection on Nico's next normal
Apple Pay purchase, then mapping observed fields into the existing
authenticated notification endpoint, one manual step at a time. This resumes
device guidance after the historical timed sessions below. Keep automatic
investments disabled. No commits, pushes or wallet changes.

- [x] Find Transaction and select Revolut Mastercard
- [x] Select all categories and Run Immediately
- [x] Add Show Content Graph using Shortcut Input
- [x] Confirm the diagnostic automation is saved
- [ ] Inspect input from the next normal Apple Pay purchase
- [ ] Record which fields are genuinely supplied by the trigger
- [ ] Wire verified fields into authenticated notification intake
- [ ] Verify durable activity and an identical-request retry

Screenshot /home/nico/turtle-automation-saved-113317.png confirms a saved
“When I tap my Revolut Mastercard card” automation with one action. Nico
reports a confirmation prompt; its wording and whether it was a save-time
or run-time prompt are not established. The screenshot does not show the
Run Immediately setting or actual input fields. Do not claim unattended
execution is verified.

Next manual step: wait for a normal purchase; do not make a purchase solely for
testing. Inspect field names and types before mapping anything. Do not invent
missing merchant, amount or currency fields, infer settlement from a tap,
or request tokens or login codes in chat. Generated UUIDs and timestamps,
and any explicitly entered values, must be distinguished from Wallet data.

Verified simulation evidence below is preserved: one manual 500 USD event,
Simulation / Not purchased display after refresh, durable SQLite row and
42 passing isolated API tests. Those tests do not prove real device delivery
or replay. Existing HTTPS, login and scoped-token verification remain valid
checkpoints. The blocker is now uninspected actual tap input, not a missing
Transaction trigger or missing implementation approval.

## Authorized simulation fallback — 12 September 2026, 09:12 UTC

Nico approved another ten minutes for the labeled simulation fallback;
stop at 09:22 UTC. Use the existing authenticated iPhone UI. All submitted
merchant, amount and currency values are manual test inputs, not Wallet
fields or payment evidence. Purchases remain disabled.

- [x] Save one labeled simulation from iPhone
- [x] Verify its durable row and visible Simulation label
- [x] Reload and confirm one unchanged activity entry
- [x] Verify duplicate protection with clearly scoped evidence
- [x] Confirm wallet and prior execution history preservation

First device step: enter merchant SIMULATION iPhone 0912, amount 1.00,
and currency EUR in Try a simulated purchase, then tap Save simulation once.
No new Shortcut token or real transaction is needed.

Completed fallback at 09:15 UTC, inside the extended window. Nico submitted
Aplle store madrid, amount 500, currency USD at 09:13:13 UTC instead of the
suggested sample. Preserve his exact input. These are manually supplied
simulation values; none came from Apple Wallet. A read-only database check
found exactly one row with source simulation and status needs_retry. Nico
confirmed that Safari refresh still shows one Simulation / Not purchased
entry. A subsequent database read confirms that row persists unchanged.

Focused API suites passed 42/42 tests across app.test.ts and shortcut.test.ts.
They verify concurrent identical requests persist once (202 then 200),
changed-payload conflicts return 409, and Shortcut duplicate receipts remain
idempotent across restart. These are isolated HTTP/SQLite tests with mocked
Privy verification and wallet reads, not an actual iPhone request replay.
Refreshing Safari proves persistent display, not duplicate POST protection.
No live replay using Nico's credentials was performed. The real Shortcut
notification and identical-request retry remain pending device verification.

Production still has zero Apple Wallet notifications and paused=true.
Wallet provision and execution database hashes match the pre-session
baseline. No wallet transaction or model run occurred; no app code changed.
Existing history was preserved and only the user-requested simulation was
added. The scoped token remains enabled; its raw value was never requested
or read by the agent. HTTPS and the app remain available on the tailnet.

Remaining real-device work: inspect actual Revolut Mastercard trigger
fields on the next normal purchase, record each
field's provenance, configure the private Shortcut and verify one delivery
plus an identical retry. No conclusion about Revolut/iOS support or card
settlement can be drawn from the completed simulation.

## Real iPhone verification — 12 September 2026, 08:16 UTC

Nico authorized HTTPS access and guided real-device verification on the
existing app committed in d0bdc16. The 30-minute window ends at 08:46 UTC.
Proceed one manual step at a time, keeping Privy authentication enforced,
automatic purchases disabled, and the wallet and existing history intact.
No commits or pushes. Never request credentials or login codes in chat.

- [x] Read the task record and Apple Wallet setup instructions
- [x] Verify commit d0bdc16 and inspect the existing authentication paths
- [x] Enable tailnet HTTPS and verify server-side TLS and authentication
- [x] Verify the HTTPS URL from iPhone Safari
- [x] Verify the allowed Privy login on iPhone
- [x] Create the scoped Shortcut token privately on the device
- [ ] Inspect real Revolut Mastercard payment-trigger fields
- [ ] Verify durable activity and an identical-request retry
- [x] Record field provenance or verify the labeled simulation fallback

Ports 4173 and 443 were unused at preflight. Tailscale is connected with
MagicDNS name morty.tail73d5db.ts.net. The intended URL is
https://morty.tail73d5db.ts.net, accessible with iPhone Tailscale connected
to the same tailnet. No computer localhost forwarding is required.

First blocker: `tailscale serve --bg --https=443 http://127.0.0.1:4173`
reports `Serve is not enabled on your tailnet.` The command supplied an
account-side enablement link and is waiting. HTTPS is not established yet;
Nico must complete that account action. No app service has been started.
After enablement, start the existing server, verify HTTPS and unauthenticated
API rejection, then ask Nico to open the URL. Preserve database history
before startup and record only non-secret verification evidence.

At 08:30 UTC, Nico completed account enablement. The unprivileged Serve
command was denied locally; sudo configured the authorized proxy successfully.
Tailscale obtained a valid certificate after an initial issuance delay.
HTTPS / returns 200; unauthenticated status, token creation and Shortcut
intake return 401 through HTTPS. The existing app is running on loopback
4173, with tailnet-only HTTPS at https://morty.tail73d5db.ts.net.
A private SQLite backup and preservation baseline were saved under
data/checkpoints; wallet provisioning, execution database and existing
activity hashes match after startup. No tokens were created. Next manual
step: connect iPhone Tailscale and open the URL in Safari, reporting whether
the Turtle login page loads. Deadline remains 08:46 UTC.

At 08:42 UTC, Nico confirmed the iPhone page loads and the authenticated
screen shows purchases paused with Confirm pause. Server evidence at
08:42:38 UTC confirms pinnedUserMatched=true and API access status 200.
The pause button only reaffirms the existing disabled state. Next step is
private scoped-token creation in Connect a card-tap Shortcut. Real payment
fields, notification delivery and duplicate verification are still pending.

Nico confirmed the Authorization header was copied privately. A read-only
check confirms the scoped credential exists; no credential value was read
or printed. Revolut trigger availability is the next device check.

At the next reply (08:50 UTC), the 08:46 UTC deadline had passed. Stopped
further device setup at the time-box boundary as detected on resume. HTTPS,
iPhone access, pinned Privy login and scoped-token creation are verified.
No actual payment trigger has been inspected or delivered. This is a time
limit, not evidence that Revolut or iOS omits fields or cannot deliver.
Durable device activity, duplicate protection and the labeled simulation
fallback remain unverified in this session. Continuing needs an extended
window. The next bounded fallback is one labeled simulation through the
existing authenticated UI, followed by reload and durable-row verification.
For a real-trigger continuation, first check Transaction > When I tap for
the Revolut Mastercard, then inspect Shortcut Input before mapping fields.
The tailnet HTTPS proxy and app remain available; purchases stay disabled.

At 09:10 UTC, reviewed the two 11:08 iPhone screenshots. Nico reached
Personal Automation; a Search field is visible at the bottom. The visible
list shows Time of Day, Alarm, Sleep, Arrive, Leave, Email and Message;
it does not prove Transaction is unavailable. Next device action is to
search Transaction in that field. No Revolut card or trigger payload has
been observed, and no delivery, duplicate or simulation verification is
claimed. Nico approved a 15-minute extension after the first stop; that
extension has now elapsed as well. Further guided testing needs more time.

Historical report, resolved by the current checkpoint above: Nico
reiterated that Transaction could not be found. At that time, real-trigger setup
was blocked by the reported device navigation/availability issue; do not
repeat the same search instruction. The cause is not established, and no
claim is made that Revolut or this iOS version lacks support. Next proposed
check is the agreed labeled simulation fallback, with an explicit time
extension because both previous windows have elapsed.

Actual card fields and delivery remain unverified. A tap is not settlement.
Use only observed Wallet fields; record manual values separately. If actual
fields or delivery are unavailable within the window, document the exact
limitation and verify an explicitly labeled simulation instead.

## Current preparation-only checkpoint — 12 September 2026, 08:14 UTC

Nico's current instruction supersedes the saved funding, classifier and
implementation authorizations below for future work. Preparation only is
active; app implementation and chain selection require explicit approval.
Preserve the existing Arc wallet, completed round trip and signing fixtures.
Historical approvals do not authorize another experiment or transaction.

Scope: one documentation and local-listener review, capped at 15 minutes.

- [x] Read coding rules, skill map, and profile Parts I and III
- [x] Read the handoff, task history, classifier results and phone setup guide
- [x] Check local listeners and reconcile the current gates

At 08:14 UTC, ports 4173, 5173 and 11435 had no listeners. The earlier
running-server checkpoint is historical; phone delivery cannot be tested
until service access is restored within an authorized scope. No service
was started or stopped. The working tree was clean before this doc update.

QVAC/NVIDIA remains blocked: the latest two relationship candidates had
six and eighteen false eligible decisions respectively. The cache comparison
already ran; do not repeat the older proposed investigation as if untouched.
A new bounded classifier replan needs authorization before execution.
Automatic purchases remain disabled in the saved checkpoint.

The next device check is already prepared in tasks/apple-wallet-setup.md:
verify real card fields, one notification and an identical retry. It needs
Nico's iPhone and reachable service. Existing funding, authenticated login
and the manual round trip are completed evidence, not unresolved setup work.
Balances and transaction state were not queried in this review. No app code,
wallet APIs, model runs, signing, broadcast, commits or pushes were involved.

## Funding and Apple Wallet notification flows — 12 September 2026

Nico's latest scope supersedes classification-first ordering. Prioritize
funding the existing app wallet and Apple Wallet Shortcut intake, confirmed
in the follow-up answer. The classifier remains failed and automatic
purchases remain disabled. Preserve the wallet and transaction history.

Scope budget: 90 minutes for a receive-funds panel, scoped authenticated
Shortcut setup and durable notification intake, followed by focused API,
browser and build verification. Funding means manual test-USDC receipt and
an honest balance refresh, not an automatic transfer or real-money onramp.
Shortcut receipt means an unverified card-tap notification, not bank
settlement or a token purchase. Actual iPhone field availability must be
verified on Nico's device. No QVAC runs, signing, broadcasting or wallet
provisioning are needed. No commits or pushes.

- [x] Read task records and current frontend/backend code
- [x] Confirm Apple Wallet Shortcut intake as the notification priority
- [x] Check service listeners before starting anything
- [x] Add funding instructions for the existing Arc wallet
- [x] Add scoped Shortcut setup and durable idempotent notification intake
- [x] Verify both flows and preserve execution safeguards
- [x] Record the runnable checkpoint and required phone verification

Preflight found no listeners on 4173, 5173 or 11435. Existing working-tree
research and task edits are preserved. Root owns integration and Shortcut
UI; separate agents own funding UI and backend intake with isolated files.

Completed checkpoint: 110 backend tests and 11 browser tests passed, along
with TypeScript and the production build. Desktop and 390px mobile views
were inspected; overflow checks passed. The build retains the existing
dependency chunk-size warning. Browser tests use isolated Privy/API mocks;
actual iPhone notification fields and delivery still require device testing.

Funding shows the existing address, Arc testnet/USDC instructions, copy
fallback, faucet/explorer links and before/after observed balances. A failed
refresh cannot claim receipt. A fresh read at 08:02:42 UTC found exactly
9.993153889999999688 test USDC and zero holdings for all five synths; see
tasks/funding-checkpoint.json. No funding transfer was initiated.

Apple Wallet setup creates an intake-only token shown once, stored hashed
and bound to the allowed login. Rotation, revocation, restart, strict fields,
rate/size limits and global event-ID conflicts are tested. Notifications
persist in an additive table and appear with their source; no event reaches
the execution engine. The wallet provision file, execution database and
all old simulation rows matched their pre-start preservation hashes.
A consistent app database backup is retained privately in data/checkpoints.

One production listener now runs at http://127.0.0.1:4173, PID 1005929,
through the existing SSH-forward workflow. No QVAC listener or second app
listener was started. Live protected routes, including Shortcut intake,
reject unauthenticated requests with 401. No production Shortcut credential
or synthetic notification was created during verification. No commits or
pushes. Next manual action: sign in on iPhone, create the Shortcut token,
follow tasks/apple-wallet-setup.md and verify actual input fields and one
notification plus an identical retry. Automatic purchases remain disabled.

## Direct-relationship investigation — 12 September 2026

Nico authorized one further 30-minute investigation with at most two
candidates. Cache stays disabled; QVAC and the pinned NVIDIA model remain.
Clarify direct brand/service ownership, including YouTube Premium to
Alphabet and Tesla service to Tesla. Preserve the original twenty tests
and add independently prepared held-out paraphrases and unrelated repair
and video merchants. Freeze both prompts before reading held-out results.
Require every original positive and zero false eligible decisions; retain
schema, completion, timeout and latency checks. No transactions, automatic
execution or application integration is part of this investigation.

- [x] Read the saved diagnosis and freeze two candidate prompts
- [x] Freeze held-out merchant cases independently
- [x] Evaluate at most two candidates within 30 minutes
- [x] Record results and stop all investigation workers

Both prompts are fixed in relationship-candidates.json before model runs.
A separate agent prepared sixteen held-out cases, eight direct matches and
eight negatives, without seeing those prompts. Neither prompt will be tuned
from held-out results. The evaluator records file hashes, raw output and
original/held-out groups, refuses repeated candidate output paths, and has
an absolute request-start cutoff of 08:03:44 UTC inside the 30-minute scope.

Candidate relationships-a completed 36 cases: all ten original positives
and all eight held-out positives correct, but six false eligible decisions.
Two are original injections; held-out failures include independent Tesla
and NVIDIA repairers, competing owners and an injected video merchant.
Warm p95 is 9.4575 seconds. Gate failed. Run only the already frozen second
candidate; do not adapt it to the held-out failures or start a third.

Final checkpoint: both frozen candidates completed; neither passes the
zero-false-buy gate. Candidate A scores 30/36 with six false eligible
decisions; candidate B scores 18/36 with eighteen. Both recover every
original positive and every held-out positive, including the direct
YouTube and Tesla service relationships. All 72 outputs are schema-valid,
complete, within the request deadline, and equal to parsing their raw text.
Warm p95 is 9.4575 seconds for A and 9.6652 for B. Held-out tests expose
independent repair/video merchants being mistaken for product owners.

Original tests and schema are unchanged. Frozen prompt and held-out hashes
match both reports. Both SDK workers were unloaded and closed; neither
4173 nor 11435 has a listener, and no Bare process remains. Stopped inside
the 30-minute budget after exactly two candidates. No application changes,
transactions or automatic execution. See tasks/qvac-relationships.md.

## Authorized classifier diagnosis and offline integration — 12 September 2026

Nico authorized QVAC/NVIDIA diagnosis, followed only after classification
passes by integration with the existing durable execution engine. This
supersedes preparation-only scope for that work on the existing Arc setup.
Live automatic purchases require passing offline end-to-end tests and a
separate approval. No live signing, broadcasting, wallet replacement,
unrelated UI work, commits, or pushes are authorized here.

Budget: 30 minutes for diagnosis and at most two failed experimental
repetitions; then up to 90 minutes for integration and offline verification
if classification passes. Compare raw responses, schema, parsing and fixed
expectations before changing the demonstrated cause. Preserve all 20 cases.

- [x] Read rules, implementation plan, task history, spike code and results
- [x] Identify the cache-path failure and evaluate two bounded candidates
- [ ] Pass the complete QVAC/NVIDIA classification gate
- [ ] Integrate passing classification with durable execution offline
- [ ] Test supported, unsupported, duplicate, timeout, cap and reserve paths
- [ ] Record verified evidence and the next manual action

HEAD is 8095472. Existing documentation edits were preserved. Neither 4173
nor 11435 has a listener at preflight. Historical login and round-trip
evidence remain valid checkpoints, not authorization for more transactions.

Controlled cached/uncached comparison proves the cache path changes the
result with identical prompt and schema: Mercadona and the override injection
abstain only when caching is disabled. First full uncached run passes 18/20,
with all ten positives correct and warm p95 6.9531 seconds. Remaining failures
are competing company names and a forged SYSTEM label with a buy command.
Raw and parsed output agree. One final bounded candidate explicitly puts
those rejection rules first; expectations and schema stay unchanged. If it
fails, stop without integration. Evidence: tasks/qvac-diagnosis.md and the
new spike reports. No funded execution worker has been started.

Stopped after the second failed candidate. The explicit rejection prompt
passes all ten negatives but incorrectly skips GOOGLE *YouTube Premium and
Tesla servicio Barcelona: 18/20 overall, warm p95 8.8285 seconds. Both runs
return valid, complete JSON for all twenty cases; raw text, parsed values
and evaluator expectations were compared directly. Neither complete gate
passes. No third candidate or application integration was attempted.

The cache-disable fix is demonstrated in the isolated SDK spike; the
production classifier is not integrated. No app files, wallet identity,
transaction history or signing fixtures were modified. QVAC was unloaded
and its SDK worker closed after each run. Next manual action: authorize a
new bounded prompt replan that retains both supported-brand coverage and
all negative rejection rules. Live automatic purchases remain disabled.

## Latest preparation-only review — 12 September 2026

Scope: one documentation and local-state review, capped at 15 minutes.
Success means recording the latest gates while preserving completed work
and preparing the next investigation without application changes.

Nico's latest instruction supersedes saved implementation and chain
approvals for future work. App implementation and chain selection remain
explicit gates. The completed manual round trip below remains historical
evidence; its one-buy authorization is consumed. Browser verification and
manual transaction recovery are recorded as completed, not current blockers.

- [x] Read coding rules, skill map, and profile Parts I and III
- [x] Reconcile the latest scope with saved checkpoints
- [x] Check local listeners and review the saved classifier investigation
- [ ] Obtain explicit authorization before app implementation or chain selection

Local listener inspection found neither port 4173 nor 11435 listening.
No service was started or stopped. Wallet and transaction state were not
queried; the balances below are saved evidence, not fresh readings. No app
code, wallet state, or signing fixtures changed.

QVAC/NVIDIA classification remains the technical blocker: both saved runs
misclassified all ten negative cases. The next prepared investigation is
the existing 30-minute isolated cached HTTP versus uncached SDK comparison,
using the same model and inputs, with two failed repetitions maximum. It
has not run. Automatic purchases remain disabled; no further transaction
is authorized by this preparation request.

## Verified manual round trip — 12 September 2026, 07:09 UTC

The authorized round trip is complete. Its one-buy authorization is consumed;
no further buy or redemption is pending. Automatic purchases remain disabled.
Nico confirmed real browser login; the server independently verified the
pinned Privy user and successful authenticated wallet API access. Browser
appearance was not inspected through Nico's session.

Bought Apple pair 1 with 0.10 test USDC, nonce 0, finalized block 61694020:
`0xa49d1bf52aafa0a6fe750f65d64f984e0e49f83cffc16be02d4e0fd559103f20`.
Minted exactly 300057182411893 synth units, or 0.000300057182411893 tokens.
Native balance changed from 10 to 9.896733088 test USDC, including gas.

Redeemed that exact minted amount, nonce 1, finalized block 61694270:
`0x4d38d417cb4e8f3155804dddee3eebc8ae459a21030e29f6bbf99525486abd79`.
Received 0.099400899999999688 test USDC before redemption gas. Final native
balance is 9.993153889999999688; synth balance returned to zero. Total native
cost was 0.006846110000000312 test USDC, including both fees, gas and rounding.
The 1 test-USDC reserve held throughout. Gross daily buy principal remains
0.10 test USDC; redemption does not restore that allowance.

Redemption signature validation initially stopped before broadcast because
viem represents an RLP zero value as undefined. A failing regression proved
the issue; normalizing numeric zero fixed it without weakening any other
field check. Recovery revalidated live policy, nonce, original minimum, gas,
venue and reserve, then broadcast the original saved bytes once. No second
signature, changed nonce, changed fees, or changed minimum was used. Each
transaction needed one read-only reconciliation after its initial receipt
check. Both receipts, vault events, mint/burn events, finalized blocks, and
historical native/synth deltas were verified.

Current evidence is in tasks/manual-roundtrip.json. Private bytes remain in
data/execution.sqlite; never-broadcast spike fixtures were untouched. A fresh
read at 07:09:32 UTC found latest/pending nonce 2, zero synths, unchanged live
policy, and the final native balance above. SQLite contains exactly two
confirmed attempts and no execution lock. The shared file lock is absent.
One application listener remains on 127.0.0.1:4173, PID 995101; no QVAC listener
or funded execution worker remains.

Verification: 85 backend tests, 3 browser tests, TypeScript and production
build passed. The browser suite uses its existing isolated auth stub; the
real login proof is Nico's confirmation plus production API verification.
The production build retains its existing dependency chunk-size warning.
No commits or pushes were made. QVAC diagnosis has not resumed.

Remaining gate: mandatory QVAC/NVIDIA classification still fails negative
cases. The manual engine is isolated from simulated events; no event is
queued for delayed execution. Classification integration and submission
materials remain future work. Checkpoint complete before QVAC diagnosis.

## Current authorized execution — 12 September 2026

Nico explicitly authorized browser verification, a durable manual engine,
and one 0.10 test USDC buy and redemption on the existing Arc setup. This
supersedes the preparation-only checkpoint below. Automatic purchases remain
disabled. Use Apple pair 1, the previously policy-tested positive fixture's
asset; never broadcast that fixture. Preserve the existing wallet.

Scope budget: 60 minutes for the engine and adapter, 20 minutes for browser
evidence, then one reviewed round trip and checkpoint. Stop on uncertain
transaction state; no blind retries or duplicate workers. Read-only receipt
checks are bounded to 12 checks per transaction at five-second intervals.

- [x] Verify current code, wallet policy, balance, nonce, and venue state
- [x] Verify the real authenticated browser session
- [x] Implement and test durable manual execution and recovery
- [x] Execute one 0.10 test USDC buy and redeem its exact output
- [x] Record hashes, verified balance changes, and remaining gates


## Current preparation checkpoint — 12 September 2026

Scope: one documentation and local-state review, capped at 15 minutes.
Success means the current gates are explicit, prior evidence is preserved,
and the next feasibility investigation is concrete without app changes.
Nico's latest preparation-only instruction supersedes historical approvals
below. App implementation and chain selection require explicit authorization.
No signing, broadcasting, provisioning, or application restart is in scope.

- [x] Read coding rules, skill map, and profile Parts I and III
- [x] Review saved handoffs and reconcile current authorization
- [x] Check local service listeners and prepare the next investigation
- [ ] Resolve the app implementation and chain selection gates

Local inspection found no listeners on ports 4173 or 11435. The earlier
running-server checkpoint is historical. Wallet balances and transaction
state were not queried again; the last saved check is not a fresh balance.

The saved QVAC evaluations failed all ten negative cases on both attempts.
The next proposed feasibility investigation is a 30-minute isolated spike:
inspect the installed SDK's cache controls, compare identical inputs through
cached HTTP and uncached SDK execution with the same pinned NVIDIA model,
and change only the cache path. Start with a known positive, an unknown
merchant, and a prompt injection. Only if that discriminates the hypothesis,
repeat the unchanged 20-case acceptance set and record cold load, warm p95,
and memory. Stop after two failed repetitions; no deterministic substitute
or wallet access. This is a prepared replan, not an executed third attempt.

Saved remaining blockers are real authenticated browser login, durable
transaction reservations and recovery, and a verified buy/redeem round trip.
Those app and execution steps remain gated. Existing wallet state and
never-broadcast signing fixtures must be preserved. No app files changed,
no services started, and no transactions were signed or broadcast here.

## Historical checkpoints

- [x] Review the plan and current API documentation
- [x] Install Codex CLI on morty
- [x] Clone Turtle on morty
- [x] Verify the phone launcher
- [x] Complete ChatGPT login on morty
- [x] Select Arc testnet AchRWA synthetic tokens
- [x] Approve the staged implementation plan

- [ ] Prove QVAC runs the NVIDIA model on morty
- [ ] Verify Privy policy restrictions and Arc vault execution
- [x] Fund the verified app wallet
- [ ] Build authenticated event intake and durable execution
- [ ] Verify retries, limits, reservations, and restart behavior
- [ ] Build the minimal responsive interface
- [ ] Prepare the verified demo and submission materials

Implementation approved in the interactive session on 11 September 2026.
`implementation-plan.md` is authoritative. Work only on morty, execution
before UI. Stop for wallet funding or unresolved blockers. Never commit or
push. Initial feasibility checkpoints are 30 minutes for QVAC and 60 minutes
for Privy/Arc; stop after two failed repetitions of an approach.

## Paused checkpoint — 11 September 2026

Nico requested a safe pause and session restart. Do not resume automatically.
Implementation remains approved when Nico resumes: QVAC/NVIDIA feasibility
and Privy/Arc policy verification first, execution before UI. Stop for wallet
funding or unresolved blockers. Never commit or push. Work only on morty.

Completed in this session: read coding-rules.md, skill-map.md, the current
implementation plan, and historical handoff; reconciled the remote task
records without deleting history. Codex authentication is already complete.
Nico explicitly deferred Privy secret rotation until after submission; this
supersedes the plan's rotation prerequisite. Never print .env or credentials.

QVAC CLI 0.13.0 is installed locally under spikes/qvac with a package lock.
Resolved SDK 0.19.1 and llm-llamacpp backend 0.49.1. CLI serve flags and model
configuration types were inspected. Morty has four AMD EPYC CPU cores,
7745 MiB RAM, approximately 6552 MiB available at inspection, and no swap.
Downloaded the NVIDIA Q4_K_M artifact (2837072864 bytes) into ignored data/models.
Repository: nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF.
Revision: ba223d14e45525f7fae81db77ea8cabeb2fc6c25.
File: NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf.
Verified SHA-256: be5d9a656a51922f24f1f09a759cebb694e1f5d9728bf0ef9f8c972c5a0b5ef2.
The model's custom NVIDIA license still needs explicit review.
spikes/qvac/qvac.config.json selects CPU, 2048 context, one slot and disabled
reasoning. Configuration is prepared, not proven: no model server was started,
no model load or inference ran, and the 20-case evaluation is not yet written.
Installation and download processes completed; no QVAC service was launched.

Privy/Arc read-only work and scripts live under spikes/privy-arc; see
tasks/privy-arc-feasibility.md for the delegated checkpoint. No Privy policy
or wallet was created, no transaction was signed or broadcast, and no funds
were moved. No UI or application execution code was built.

Critical plan correction found in the saved onchain registry: Tesla is pair
7, not pair 8. Pair 8 is Natural Gas. The intended five-company allowlist is
[1, 2, 6, 7, 9]. Tesla synth is
0xf1f19cE22Fb971a61B12F9494D100E72F9C3956E.
Evidence: spikes/privy-arc/registry.json, cross-checked during checkpoint.
The authoritative implementation plan is not edited at this pause; reconcile
its Tesla ID before any policy creation or signing. Never authorize pair 8.

## Resume order

- [x] Read this checkpoint and the Privy/Arc feasibility report
- [x] Reconcile the verified Tesla pair ID in the implementation plan
- [x] Review the pinned NVIDIA artifact license
- [x] Start QVAC on 127.0.0.1:11435 and prove model loading
- [ ] Run 20 fixed classifier cases and measure latency and memory
- [ ] Verify app ownership defaults and exact Privy policy API behavior
- [x] Create and persist one restricted app wallet and test actual policy rejection
- [ ] Stop for Nico to fund the verified wallet address
- [ ] Verify a tiny buy and redemption before building application execution

Start command from /home/nico/turtle after resume:
`spikes/qvac/node_modules/.bin/qvac serve --openai --host 127.0.0.1 --port 11435 --config spikes/qvac/qvac.config.json`

Use a 30-minute QVAC checkpoint and 60-minute Privy/Arc checkpoint; no more
than two failed repetitions before replanning. Preserve 8–10 focused hours
as the implementation scope ceiling, plus the submission buffer described
in the plan. No feasibility success is claimed by this checkpoint.

Environment caveat: sandbox operations failed before execution with
`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, including
apply_patch. Approved escalated commands worked. Request normal tool
escalation when needed; do not treat the failed sandbox call as execution.
The profile selector used this session was too permissive and emitted some
extra subsection text. On restart, only select exact top-level PART I and
PART III boundaries; never reopen Parts II or IV.

Subagent shutdown confirmed: privy_arc completed its checkpoint and reports
no live processes or Privy API requests. No policy files were generated.
The saved read-only probe still uses the original pair 8 to preserve the
discovery evidence; correct it to pair 7 and add symbol/category/address
assertions before rerunning. Tesla-specific quote checks remain unverified.

## Resumed

Nico explicitly requested continuation. Resume the approved feasibility gates.
The authoritative plan now uses verified Tesla pair 7. QVAC checkpoint is
30 minutes of active work; Privy/Arc checkpoint is 60 minutes.

## Latest resume — 11 September, 17:44 UTC

Nico resumed with unrestricted tool permissions; omit sandbox escalation.
QVAC first failed because libatomic.so.1 was absent. Installed Ubuntu
libatomic1 14.2.0-4ubuntu2~24.04.1. On the second start the NVIDIA model
loaded successfully through QVAC. The server and Bare child were stopped
cleanly for the intervening pause; resuming evaluation now. No inference
request has run yet. The attempted evaluator write was interrupted and
spikes/qvac/evaluate.py does not exist yet. No cold-load timing was captured.
NVIDIA's pinned card links the NVIDIA Nemotron Open Model License dated
December 15, 2025; reviewed its use and redistribution provisions. Model
weights stay in ignored data and are not included in source distribution.
Allowed Privy user ID remains missing; user was asked and has not answered.

## Stopped at unresolved gates — 11 September, 17:51 UTC

Two bounded QVAC/NVIDIA evaluations completed. Both returned schema-valid
output for 20/20 cases and correct supported-company results for 10/10,
but falsely selected companies for all 10 negative cases, including prompt
injections. First warm p95: 8.8603 seconds; second: 8.7386 seconds. The runtime
loads the model, but classification is unsafe and the feasibility gate FAILS.
No third attempt or application execution work started. QVAC was stopped
cleanly after evaluation. See tasks/qvac-feasibility.md and both JSON reports
under spikes/qvac. Measured process snapshots are in runtime.json; startup
load time has not been measured. Current output explanations also run into
the grammar's character limit, so valid JSON alone is insufficient.

Arc's corrected read-only probe passed all five identities and quotes,
including Tesla pair 7. The plan and probe now use the correct IDs. Privy
credentials passed read-only HTTP 200 preflight; zero wallets were listed.
Concrete policy.json and verify-policy.mjs are prepared, but no policy or
wallet was created and no transaction was signed or broadcast. The script's
missing-user guard was exercised; root reviewed it and suppressed possible
signed-byte exposure from decoder error messages. Live policy tests remain
unverified. The Privy subagent finished; no subagent worker remains active.

Blocked on TURTLE_ALLOWED_PRIVY_USER_ID, which Nico must provide out of band
or set in morty's .env. The pending question has not been answered. Never
infer the owner from the first caller. Secret rotation remains explicitly
deferred until after submission. No commits or pushes were made.

Next work requires a replan for the failed classifier gate: investigate
QVAC's cached system-prompt path against uncached QVAC SDK execution while
retaining the NVIDIA model. This is a hypothesis, not a confirmed defect.
Resolve that gate and the pinned user ID before any funded execution or UI.

## Privy identity supplied

Nico supplied the allowed user identifier. Stored its did:privy form privately
in TURTLE_ALLOWED_PRIVY_USER_ID. Resume only the independent Privy policy
gate, bounded to 30 minutes; classifier remains blocked. No broadcast.

Privy policy replan: the first request failed because rule names exceeded
50 characters. The corrected request failed because uint256 calldata fields
do not support `in` (actual invalid_policy_format). Replace the two membership
rules with ten complete per-pair equality rules, each retaining every chain,
vault, method, value and minimum-output condition. This preserves exactly
the same allowed transactions. Make one bounded attempt with that new shape;
stop if another provider restriction blocks it. Both rejected requests are
recorded privately and created no wallet.

## Privy signing gate passed — 11 September, 18:16 UTC

Nico supplied the allowed user ID; its did:privy form is configured privately
in TURTLE_ALLOWED_PRIVY_USER_ID and verified through the Privy user endpoint.
One unrelated owner-controlled wallet appeared after login. It was preserved;
provisioning now refuses an existing Turtle external ID or app-controlled
wallet while allowing unrelated owner-controlled wallets after full listing.

Created exactly one app-owned wallet:
0xE0025f5afd3FD375e30E8C3679924a499eE926F4.
Private durable state links this wallet to the pinned login. The provider
reports owner_id null, no additional signers, and the exact attached policy.
Wallet ID, policy ID, request keys, and fixture bytes remain in ignored
spikes/privy-arc/.private/. Reuse this state; never create another wallet.

Actual provider restrictions required two corrections: rule names have a
50-character maximum, and uint256 calldata fields do not support `in`.
The accepted policy has ten complete equality rules, one buy and one redeem
per allowed pair, preserving every common restriction in each rule. Two
rejected policy requests were reconciled and archived before changing shape.
No restrictions were weakened. Signing requires hexadecimal fee strings;
the rejected decimal-string fixture was archived before the corrected test.

policy-results.json proves a valid buy fixture signed and its recovered
signer and immutable fields matched. Wrong chain, destination, method, pair
8, excessive value and zero minimum each returned actual policy_violation.
No fixture was broadcast. The deliberately distant fixture nonce is not an
execution nonce; never broadcast these saved fixtures. Only Apple positive
buy signing was exercised, not every pair or the redeem rule.

Arc read-only balance is zero and pending nonce is zero. Stop for Nico to
fund this address on Arc testnet, chain 5042002. Seven test USDC provides room
for the planned cap/reserve tests with gas headroom; never request real funds.
QVAC classification remains blocked as previously recorded. No app execution
or UI built, no live buy or redemption executed, no commit or push.

Next: resolve the QVAC classifier gate, verify funding, then implement the
small buy/redeem round-trip with durable signing/broadcast records. Do not
rerun sign-tests against existing fixtures or clear uncertain state blindly.

## Funding verified — 11 September 2026

Nico reported funding 10 USDC. Read-only Arc RPC verification confirmed chain
5042002 and exactly 10000000000000000000 native units (10 test USDC) at the
persisted app wallet 0xE0025f5afd3FD375e30E8C3679924a499eE926F4. Pending nonce
is zero. Funding blocker is resolved. No transaction signed or broadcast in
this funding check. QVAC classification remains the unresolved gate; keep
execution stopped until that gate is resolved. Recheck balance before use.

## Independent application work — 12 September 2026

Nico explicitly authorized backend, safeguards, and UI work while QVAC stays
blocked. This supersedes the earlier instruction to stop all app work until
classification passes. Automatic purchases remain disabled with no runtime
switch to bypass the failed gate. No signing or broadcasting in this scope.

Process/transaction preflight: no Turtle or QVAC server running; unrelated
services preserved. Arc balance is still 10 test USDC, latest/pending nonce
0, no pending provisioning. The sole signed fixture (nonce 1000000000) has
no receipt and remains marked neverBroadcast; it must never enter execution.
Saved read-only evidence in tasks/transaction-checkpoint.json.

Scope budget: backend and safeguards up to two hours, UI up to one hour,
then integration checks. Root owns UI and project setup; backend agent owns
server and its tests. Build authenticated durable simulated-event intake,
read-only real wallet/holdings, tested money/cap/reservation logic, and an
honest responsive interface showing why execution is blocked. The demo EUR
conversion is fixed at 1.10 USD/EUR dated 2026-09-12, not a market quote.

- [x] Build and test backend intake, authentication, and safeguards
- [x] Build the responsive login, wallet, simulation, and activity interface
- [x] Verify production build, API behavior, and disabled execution
- [x] Save runnable setup and remaining gate instructions


## Runnable paused application checkpoint — 12 September 2026, 06:45 UTC

The independent backend and interface are implemented. The server is running
on morty at http://127.0.0.1:4173, accessible through an SSH port forward.
Use `npm run server` after a restart; build first if source files change.
README.md contains setup and the precise limits of this checkpoint.

Verification: all 30 backend tests and all 3 browser tests passed. The final
TypeScript/Vite production build passed. Desktop and 390px mobile screenshots
were inspected, and measured horizontal overflow was fixed. Browser tests use
an isolated test-only authentication stub and mocked API; they are not live
Privy login verification. The real production login rendered with no page
errors. Live unauthenticated and invalid-token API requests returned 401.
Requests for private paths returned only the SPA HTML, not private files.

The UI preserves an uncertain simulation's UUID and payload in user-scoped
sessionStorage through reload and re-login; explicit retries reuse that ID.
Failed activity reads show unavailable rather than an empty history. Purchases
and purchase retries remain blocked in server code. The application contains
no signing or broadcast path, and no automatic wallet creation is enabled.

A final read-only Arc check at 06:44:49 UTC confirmed chain 5042002, balance
10 test USDC, and latest/pending nonce 0. No funds moved. Existing private
provisioning and signing fixtures were preserved. No commit or push occurred.
The backend agent finished implementation and review; no subagent remains active.

Build limitations: Privy's dependency graph produces a chunk-size warning.
Dependency audit has 23 moderate advisories and no high or critical findings;
no forced dependency downgrade was applied. Test screenshots are ignored under
test-results/, including production-login.png, dashboard.png and mobile.png.

Remaining work:

- [ ] Resolve and re-evaluate the mandatory QVAC/NVIDIA classifier gate.
- [ ] Build durable reservations and transaction attempts, nonce reconciliation,
      receipt handling, and recovery from ambiguous RPC responses. Current
      fixed-point cap/reserve functions are tested but do not reserve funds.
- [ ] Verify the single allowed Privy login in a real authenticated browser.
- [ ] Once execution gates pass, perform the authorized small testnet buy and
      redemption round trip with durable records; never use signing fixtures.
- [ ] Complete submission recording and other plan deliverables.

Automatic purchases must stay disabled. No delayed buys are queued. Secret
rotation remains deferred by Nico until after submission. Recheck running
processes and transaction state before resuming any execution work.

## Phone, Phase 1 (2026-11-18)

iPhone 17e (iPhone18,5), iOS 27, Release build signed with a Personal Team (expires after 7 days). Qwen3 1.7B Q4 through QVAC 0.23.0, in the Expo app in `mobile/`.

Two version pins were needed before QVAC would run: `react-native-bare-kit` exactly 0.16.0 (0.17 no longer ships BareKit.framework, and the app failed at runtime with "Bare Kit is not available"), and `bare-type` overridden to 1.4.0 (QVAC's prebuild verifier: bare-type 1.6.0 needs Bare 1.37, bare-kit 0.16.0 embeds Bare 1.33.4). QVAC's verifier suggested the second fix itself.

Load: first launch about 65 s including the 1 GB download; after that 2.9 s with the adapter, 3.1 s without.

| Input | Adapter on | Adapter off |
|---|---|---|
| CARREFOUR EXPRESS DUBAI / CARREFOUR | none, 1.27 s | none, 0.96 s |
| APPLE.COM/BILL | Apple, 0.74 s | Apple, 0.64 s |
| APPLEBEE'S GRILL 1123 ORLANDO FL / APPLEBEE'S | none, 0.72 s | **Apple**, 0.58 s |
| TESLA SUPERCHARGER ES MADRID / TESLA | Tesla, 0.79 s | Tesla, 0.78 s |

The adapter changes the Applebee's decision on the device, as on the Mac. Caveat: the adapter-off run used shorter typed inputs, not the chips. Explanations are unreliable even when the decision is right (adapter on, Carrefour: "Unrelated car rental operator"); untuned explanations break the 3–8 word format.

## Phone, Phase 2 (2026-11-18)

Tether's WDK wallet (`@tetherto/wdk-react-native-core` 1.0.0-beta.24, plain `@tetherto/wdk-wallet-evm`) now runs in its own Bare worklet beside QVAC's, on the same `react-native-bare-kit` 0.16.0 (Bare 1.33.4). The phone's wallet address is `0x7Da92992e6F318D838D7d84C4ebF328969491Ffd`; the same address came back after a force-quit and relaunch, and the model still loaded (3.8 s) and decided Carrefour (none, 0.9 s) with the wallet open.

Three things were needed beyond the install. `bare-node-runtime` is overridden to 1.5.0 for the whole tree: from 1.5.2 on its global setup loads `bare-worker`, which traverses its own thread code at startup and cannot resolve linked addons on Bare 1.33.4 (`ModuleTraverseError: ADDON_NOT_FOUND ... bare-channel/binding.js`, an uncaught rejection that aborts the app); 1.5.5 also pulls `bare-module` 7.5.2, which needs Bare 1.35. `expo-crypto` is overridden to ~55.0.16, as WDK core needs below 57. And `mobile/plugins/withWdkAddons.js` links the wallet worklet's 22 native addons into bare-kit, because QVAC's prebuild clears that folder and links only its own; it is listed before QVAC in `app.json` because Expo runs dangerous mods in reverse order.

## Phone, Phase 2 (2026-11-18)

The phone's WDK wallet (`0x7Da92992e6F318D838D7d84C4ebF328969491Ffd`) bought on Sepolia: APPLE.COM/BILL decided as Apple on the phone, the phone fetched the order from the Mac over Tailscale, checked it with `checkOrder`, signed it with WDK, and the Mac's relayer (`0x30AB…8048`) submitted it. Transaction `0x07a0e611608171458c3943ee102f2611f17c428f6cf7ef2bf57f2a1de8f5496b`, block 12162259, status success: paid 0.50 tUSDT0, issued 0.0025 sAAPL to the phone. Afterwards the phone holds 0 ETH, 9.5 tUSDT0, 0.0025 sAAPL. Funded earlier with 10 tUSDT0 by `scripts/fund-phone.ts`.

Signing worked with `bare-node-runtime` pinned to 1.5.0, which was the open risk from Task 3.

## Phone, Phase 3 (2026-11-18)

"Note Payment" run by hand from the Shortcuts app with Turtle closed: the local notification appeared and Turtle stayed closed. Tapping it opened Turtle, which loaded the model (6.0 s), decided APPLE.COM/BILL · 1.00€ as Apple (0.81 s), signed on the phone and paid: Sepolia tx `0xccdf4d0a86cfc06e3731715b4312afc714ff063501cde5a0e669c9ed504d7c81` (0.50 tUSDT0, company 0). Phone still holds 0 ETH. Still to do: the reopen check (no second payment) and a real Apple Pay tap through the Transaction automation.

## Phone, Phase 3b (2026-11-18)

The phone now pays without the Mac. Its WDK wallet worklet uses `@tetherto/wdk-wallet-evm-7702-gasless` 1.0.0-beta.13 (EIP-7702, delegate Simple7702Account `0xe6Ca…555B`), sending `buy(order, signature)` to the seller as a UserOperation through Candide's public Sepolia bundler, whose paymaster pays the gas. The phone builds the order itself with `server/authorization.ts`, checks it with `checkOrder`, and enforces the 5.00 daily cap (Madrid day, `Documents/turtle-spent.json`). The worklet bundled and ran on Bare 1.33.4 with the existing pins and no new overrides.

Smoke test from Node with a throwaway wallet (`scripts/sponsored-buy.ts`): UserOperation `0x7e1614515024932f8028042911efde4d097fa42fb35a4338a0bfc43e02fa1184`, transaction `0x36796494cd546df0e8475d586dd648ffb9513f2beff7ea34fc74b76d4fbb01f7`, included after 13 s, sent by the bundler `0x3cfd…7a89` to the EntryPoint; the buyer went from 1 tUSDT0 to 0.5 tUSDT0 and 0.0025 sAAPL with 0 ETH throughout. On the iPhone the wallet address is unchanged (`0x7Da92992e6F318D838D7d84C4ebF328969491Ffd`), the fine-tuned model loaded (5.0 s), and `getUserOperationReceipt` returned that receipt through the worklet. Still to do: a buy from the phone with the Mac's server stopped (Step 5).
