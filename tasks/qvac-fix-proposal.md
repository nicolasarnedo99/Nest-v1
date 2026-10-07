# Classifier fix proposal — 12 September 2026

Executed once under subsequent authorization. Both arms failed at 30/36;
see tasks/qvac-grammar-comparison.md. This proposal is now historical,
not an instruction to rerun the comparison.

The smallest demonstrated fix remains QVAC SDK `kvCache: false`. It fixes
the observed cache-path failure, but does not pass classification acceptance.
There is no verified complete classifier fix in the saved evidence.

The recommended next action is one controlled comparison that disables
native output grammar while retaining the exact JSON acceptance validator.
Use the existing frozen relationships-a prompt and pinned NVIDIA model.
The candidate changes only `responseFormat` to `{ type: 'text' }`; caching
stays disabled. This is a proposed fix candidate, not a proven grammar bug
or permission to integrate it into the application.

## Evidence reviewed

Read all three QVAC reports, both evaluator scripts, configuration, frozen
prompts, original and additional cases, and all seven saved result files.
Recomputed case verdicts and checked that all 118 saved SDK responses agree
with JSON parsing of their preserved raw full text. The extracted original
twenty cases, schema and prompt match evaluate.py. All four full SDK
evaluation reports preserve the original cases and schema.

The uncached original prompt passes 18/20 with two false eligible decisions.
Explicit rejection rules pass 18/20 with no false eligible decisions but
reject YouTube Premium and Tesla service. Relationships A passes 30/36
with six false eligible decisions; B passes 18/36 with eighteen. Neither
prompt is suitable for investments.

Some outputs contain an eligible company alongside an explanation that
rejects that relationship. B labels CAFETERIA EL SOL as Apple while saying
“Independent café, not Apple-owned”. A labels the override injection as
NVIDIA while saying “Untrusted merchant ignored rules”. This motivates
isolating constrained decoding; it does not prove that grammar causes the
mistakes. Null already appears in other runs, so null is not impossible to
generate. Do not interpret explanation keywords as an eligibility filter.

Installed source confirms the proposed switch is supported:
`@qvac/inference/dist/schemas/completion-stream.js:71` accepts text format;
`dist/utils/response-format.js:12` returns no schema for that format;
`dist/plugins/builtin/llamacpp-completion/ops/completion-stream.js:205`
forwards a supplied schema into native GBNF conversion and at line 259
passes the complete history when caching is disabled. CLI chat still
hardcodes caching at `@qvac/cli/dist/serve/extensions/openai/routes/chat.js:151`.
No installed package was patched.

[QVAC documentation](https://docs.qvac.tether.io/ai-capabilities/text-generation/)
also demonstrates the uncached SDK path. The
[pinned NVIDIA card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF/blob/ba223d14e45525f7fae81db77ea8cabeb2fc6c25/README.md)
identifies English as supported and notes accuracy tradeoffs with reasoning
disabled. Neither observation justifies dropping Spanish cases, enabling
reasoning in this comparison, or replacing the model.

## Proposed bounded verification

Run one isolated worker, with a fresh model load for each of two sequential
arms: existing schema-constrained A and text-format A. Freeze their inputs
before inference. Keep all 36 merchant strings and expected outcomes, the
same order, model, prompt, context, temperature zero, 64 output tokens and
reasoning budget zero. The previous sixteen held-out cases are now known
regressions; do not describe them as a new blind evaluation.

Cap the comparison at 30 minutes and 72 requests, with no prompt revisions
or retries. Preserve the existing 15-second request deadline and warm p95
limit of 10 seconds. Use new exclusively created report paths, retain raw
output before parsing, and record model-load time and memory. Shut down the
worker on completion or deadline; do not overwrite historical reports or
reuse the expired candidate driver deadline.

Both arms must use the same strict local acceptance schema. Invalid JSON,
extra fields, wrong types, incomplete output and timeouts are failures,
including on negative cases. No JSON repair, markdown extraction, fallback
classification or coercion to null is allowed. Require all 18 positives
correct and all 18 negatives to return null. A partial improvement does not
open the classifier gate. Stop and report if the candidate fails.

## Application boundary and checkpoint

Current code in server/index.ts, server/app.ts and server/store.ts has no
classifier or execution call from event intake. Events persist as
needs_retry; status reports execution disabled and retry returns 423.
server/execution.ts is deliberately restricted to the already consumed
one-shot Apple 0.10 test-USDC authorization. The completed manual round
trip does not prove a simulated event can execute, and that consumed
authorization must not be reset or repurposed.

After a classifier passes, connecting authenticated simulation to durable
execution still requires the gated application work and offline tests.
A new real Arc investment needs explicit authorization for that action.
Keep automatic investments disabled and preserve existing events, wallet,
execution records and never-broadcast fixtures.

This diagnosis and proposal made no inference requests, application edits,
wallet API calls, database writes, transactions or service changes. Local
inspection found no listeners on 4173, 5173 or 11435 and no Bare worker;
the saved running-app checkpoint is historical. App access must be restored
before a future live walkthrough. No commit or push occurred.
