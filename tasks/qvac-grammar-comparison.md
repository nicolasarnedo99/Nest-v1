# QVAC grammar comparison — 12 September 2026

The comparison failed. Disabling native grammar is not a sufficient
classifier fix. Both arms pass 30/36 cases; neither may be integrated for
investments. Automatic purchases remain disabled.

| Arm | Correct | False eligible | Invalid schema | Warm p95 |
| --- | ---: | ---: | ---: | ---: |
| Grammar on | 30/36 | 6 | 0 | 9.6681 s |
| Grammar off | 30/36 | 4 | 2 | 9.5002 s |

Both arms correctly classify all 18 positive cases and correctly abstain
on 12/18 negative cases. All 72 responses completed within 15 seconds and
parse as JSON. Two grammar-off responses contain the string `"null"`
instead of JSON null and fail the unchanged acceptance schema. They are
failures, not valid abstentions, and were not coerced or repaired.

With grammar on, the override injection and independent NVIDIA repairer
select NVIDIA. With grammar off, those inputs emit `"company":"null"`.
This establishes that the output constraint changes these decisions in
this controlled run. It does not establish a native converter defect or
make the model safe. Four false eligible results persist in both arms:
the forged SYSTEM Apple merchant, the independent Tesla repairer, the
ambiguous YouTube-or-Microsoft merchant, and the injected video shop.
Even accepting the two invalid null strings would leave four wrong buys.

## Frozen configuration and verification

The run used the frozen relationships-a prompt, original twenty cases and
sixteen existing regression cases in the same order. No prompt, case,
expected result, schema, dependency or model was changed. QVAC SDK 0.19.1
and llm-llamacpp 0.49.1 ran the pinned NVIDIA Nemotron 3 Nano 4B Q4_K_M on
CPU with context 2048, one slot, caching disabled, temperature zero,
64 output tokens and reasoning budget zero. The artifact SHA-256 was
reverified as be5d9a656a51922f24f1f09a759cebb694e1f5d9728bf0ef9f8c972c5a0b5ef2.

The only arm difference was responseFormat: the existing strict json_schema
request versus `{ type: 'text' }`. Both used identical local validation.
Each arm loaded the model freshly, using separate Bare processes. Model
loads took 2.5637 and 2.6024 seconds without clearing the OS page cache.
Bare high-water RSS was 3,889,688 kB and 3,888,716 kB respectively. These
are per-process high-water values, not summed simultaneous memory peaks.

Inference ran from 10:47:20 to 10:58:21 UTC: 72 distinct requests in about
11 minutes, within the 30-minute deadline. There were no retries, extra
warm-up requests, timeouts or prompt revisions. The driver exited 1 to
report the failed acceptance gate; it did not crash. Both models unloaded,
the SDK closed successfully, and no Bare worker or inference listener
remained. One paused app listener remains in tmux.

Evidence lives in spikes/qvac/grammar-comparison.json and
evaluation-grammar-on.json / evaluation-grammar-off.json. The manifest
records complete configuration, frozen inputs, hashes and request counts.
Raw responses were saved before parsing. The independent verifier,
spikes/qvac/verify-grammar.py, passed checks for all 72 request identities,
raw/parsed agreement, original case/schema preservation, frozen hashes,
per-case verdicts, latency and aggregate results. The driver's acceptance
self-checks and syntax check passed. No application code changed, so the
historical full application suites were not rerun or presented as fresh
verification. Diff whitespace checks passed.

## State reconciliation and restored app

The sole worktree is /home/nico/turtle, branch main, HEAD
d0bdc16a2b3d78ee3c572ecd146d4fd70b326b64. Existing uncommitted UI and
documentation work was preserved. Older 10-USDC/nonce-0 notes describe
earlier checkpoints, not another wallet or missing execution history.

Read-only RPC at 10:45:21 UTC verified chain 5042002 and the existing wallet
0xE0025f5afd3FD375e30E8C3679924a499eE926F4. Both known transaction receipts
match the saved successful blocks, wallet, vault and nonces. Balance was
9.993153889999999688 test USDC, latest/pending nonce 2, and Apple synth
balance zero. tasks/grammar-state-checkpoint.json preserves the reads.
SQLite contains the same two confirmed attempts and no execution lock.
The prior one-shot transaction authorization remains consumed.

Restored npm run server in the existing turtle tmux session's paused-app
window. https://morty.tail73d5db.ts.net returns 200 and is accessible on
the tailnet; protected /api/status returns 401 without authentication.
Only one app listener runs on 127.0.0.1:4173. Current code reports execution
disabled and rejects unpause and purchase retries. No authenticated login
or browser interaction was claimed from these HTTP checks.

Private fixture hashes and the execution database logical dump match the
pre-start baseline. App startup's existing INSERT OR IGNORE advanced only
the internal event_order sequence from 1 to 2. Replacing that single line
in an in-memory dump reproduces the exact pre-start hash, proving all
other application rows unchanged. The real counter was left intact.
One needs_retry simulation, zero notifications, paused=true and the scoped
credential remain preserved. No signing, transaction, wallet provisioning,
provider substitution, commit or push occurred.

## Next decision

Stop this grammar/prompt experiment line. There is no passing configuration
to document for integration. The next decision is whether to authorize a
separately budgeted change to the NVIDIA model or inference configuration
through QVAC, retaining the acceptance gate, or accept a clearly disclosed
non-autonomous demo with the classifier limitation. Neither choice is
implied by this investigation. No additional experiment, integration or
live transaction is authorized by its result.
