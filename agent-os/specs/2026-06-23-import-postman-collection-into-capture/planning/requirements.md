# Spec Requirements: Import a Postman Collection into Capture

## Initial Description

Feature: Import a Postman Collection into the API Behaviour Baseline capture flow
-- the inverse of the existing baseline -> Postman EXPORT
(`frontend/src/utils/postmanExport.ts`).

Two modes:

- **Mode 1 (pre-capture seed):** supply a Postman collection before starting a
  capture run, via a 3-way RUN MODE selector:
  - (a) LLM only (today's behaviour, no Postman);
  - (b) Postman + LLM delta -- Postman items executed as concrete captures (the
    deterministic "given"), then the LLM tops up ONLY the scenarios not already
    covered. Delta = the code planner's candidate scenarios (`defaultScenarioSet`)
    MINUS the Postman-covered ones. Dedup = LLM-judged WITH a code pre-filter
    (heuristic removes obvious matches by archetype/method/path/param/expected-status;
    LLM then judges remaining candidates redundant-or-not against the captured
    Postman requests; bounded subtraction). Respects `MAX_SCENARIOS_PER_OP`.
  - (c) Postman only -- fire the Postman requests, record responses, NO LLM.
- **Mode 2 (post-hoc append):** append a Postman collection to an EXISTING
  capture run by looping its items through the existing manual-capture
  execute -> persist primitive (lands `manual` scenarios + un-reviewed captures
  into the normal review/baseline flow).

Architecture-match handling: per imported item, if the endpoint doesn't match a
committed architecture endpoint, warn the user and offer (1) Add to architecture
or (2) Delete the item. Reuse the existing `operations_without_model_endpoint`
coverage signal.

Existing seams to reuse: `parse-oas` inventory ingestion + `oasInventoryStore`,
`defaultScenarioSet` planner + `execute_http_request`, the `manual-capture`
concrete-request -> capture primitive, AMS `reconcile-inventory` coverage, and the
Postman v2.1 type surface from `postmanExport.ts` (a new IMPORT parser is needed).

## Requirements Discussion

This feature has already been discussed in depth with the user and grounded
against the real codebase. The block below records the items that are DECIDED
(not to be re-litigated). A short list of genuinely-open clarifying questions
follows; the user's answers will be appended under "Open Questions -- Answers"
once received.

### DECIDED Requirements (confirmed; do not re-litigate)

**D1 -- New Postman v2.1 IMPORT parser.** Only EXPORT exists today
(`frontend/src/utils/postmanExport.ts`). A NEW parser is needed, modelled on the
export's Postman Collection v2.1 type surface (`PostmanCollection`, `PostmanItem`,
`PostmanRequest`, `PostmanUrl`, `PostmanHeader`, `PostmanQueryParam`,
`PostmanBody`, `PostmanResponse`, etc.). v1 targets `application/json`. Parse
defensively (loose `Record` narrowing) exactly like the export's helpers so a
malformed/partial item degrades gracefully rather than throwing.

**D2 -- The single reusable primitive across all modes.** "Execute one concrete
request -> persist a capture", exactly as the existing `manual-capture` route does
(`POST /api/capture-sessions/:id/manual-capture`,
`api-migration-validation-service/src/routes/captureSessionActions.ts:1525`):
send via the per-session `httpExecutor` with auth re-injected from the in-memory
secret; redact once; persist a `manual`-type scenario
(`scenario_type:'manual'`, `generation_source:'manual'`) + an un-reviewed
capture with `accepted` OMITTED (AMS default null), `volatile_paths_json: null`.
This lands the imported request into the normal review -> accept/reject ->
Save-as-Baseline flow unchanged.

**D3 -- Mode 1: 3-way RUN MODE selector on `StartCaptureSessionWizard`.**
  - (a) **LLM only** -- today's behaviour (planner + `execute_http_request`
    loop, unchanged).
  - (b) **Postman + LLM delta** -- Postman items executed as concrete captures
    (the deterministic "given"); the LLM then tops up ONLY the uncovered
    scenarios. Delta = `defaultScenarioSet` candidates MINUS Postman-covered.
    Dedup is a TWO-STAGE bounded subtraction, per operation:
      1. **Code pre-filter (heuristic):** remove obvious matches by scenario
         archetype / method / path / which-param / expected-status.
      2. **LLM judge:** the LLM judges the REMAINING candidates redundant-or-not
         against the captured Postman requests for that operation.
    Respects `MAX_SCENARIOS_PER_OP` (= 12,
    `captureSessionOrchestrator.ts:926`).
  - (c) **Postman only** -- fire the Postman requests, record responses, NO LLM:
    skip the planner AND the `execute_http_request` loop entirely. Coverage is
    intentionally partial, so this path uses the EXISTING coverage-gate override
    (`coverageOverrideJustification` -> `coverage_override_*` trio on `/start`,
    `captureSessionActions.ts:581,1905`).

**D4 -- Mode 2: post-hoc append.** Append a Postman collection to an EXISTING
run by looping items through the `manual-capture` primitive (D2). Lands `manual`
scenarios + un-reviewed captures into the normal review/baseline flow.

**D5 -- Architecture-match handling.** Per imported item whose endpoint does NOT
match a committed architecture endpoint: warn, and offer "Add to architecture"
OR "Delete the item". Reuse the existing `operations_without_model_endpoint`
signal from `reconcile-inventory`
(`archModelClient.ts:312`,
`InventoryReconciliationResponse.operations_without_model_endpoint`).

**D6 -- Staged / reviewable before a run.** Imported items are staged and
reviewable before a run, showing coverage (reuse `reconcile-inventory`) and the
per-item architecture-match warning (D5).

### Seams confirmed in the codebase (for the spec-writer)

- **Postman v2.1 type surface to mirror:** `frontend/src/utils/postmanExport.ts`
  (exported interfaces + defensive `asRecord`/`asString`/`asNumber`/`toPathSegments`
  helpers; the EXPORT flattens multi-step sequence items to individual requests,
  which is the precedent for IMPORT flattening).
- **The execute -> persist primitive:** `manual-capture` route,
  `captureSessionActions.ts:1525-1691`. Note: it requires (a) live secrets in
  `secretsStore` (else 409 `SECRETS_NOT_LOADED`), (b) the target `operationId`
  to ALREADY exist for the session AND be `included=true` (else 404
  `OPERATION_NOT_FOUND` / 400 `OPERATION_NOT_INCLUDED`). It is NOT gated on
  `status==='running'` -- works on completed/failed sessions.
- **Planner:** `defaultScenarioSet(op, discoveryContext, oasOperation)`
  (`captureSessionOrchestrator.ts:983`), capped at `MAX_SCENARIOS_PER_OP=12`.
  Each candidate carries `name`, `type` (archetype), `expectedStatus`, and a
  `directive`.
- **Per-op loop:** `orchestrateCaptureSession` iterates
  `deps.persistedOperations` (skipping `included!==true`), calling
  `defaultScenarioSet` then the per-scenario `execute_http_request` path
  (`captureSessionOrchestrator.ts:1306`).
- **LLM execution gates:** `execute_http_request.ts` -- operation must be
  `included` AND (`safe_to_execute` OR session `mutating_calls_confirmed`); up to
  `LLM_HTTP_ATTEMPTS_PER_SCENARIO` attempts; every attempt auto-persisted as a
  capture. Mode 1(c) deliberately bypasses this whole path.
- **Inventory ingestion:** `parse-oas` action + `oasInventoryStore`
  (`captureSessionActions.ts:953`); `persistInventory` writes one operation row
  per operation; `synthesiseInventoryFromEndpoints` /
  `synthesiseOperationFromEndpoint` are the existing model-endpoint -> operation
  mapping that "Add to architecture" / new-endpoint append could reuse.
- **Coverage reconciliation:** `reconcile-inventory` action
  (`captureSessionActions.ts:1308`) returns the AMS calculator payload verbatim,
  including `operations_without_model_endpoint`. The reconciliation key lives in
  the AMS Java calculator only.
- **Coverage-gate override:** `coverageOverrideJustification` body field on
  `/start` -> persists `coverage_override_justification` /
  `coverage_override_unaccounted_count` / `coverage_override_at`
  (`captureSessionActions.ts:1905-1933`).
- **Mode 1 UI host:** `StartCaptureSessionWizard.tsx` -- a 6-step wizard
  (`WizardStep = 1..6`): 1 OAS source, 2 API env, 3 DB sampling, 4 endpoint
  inclusion, 5 data-type formats, 6 start summary. The run-mode selector + the
  Postman upload would be added as a step / sub-section here.

### Existing Code to Reference

**Similar Features Identified (confirmed paths):**
- Postman v2.1 type surface + defensive mapping (to mirror for IMPORT):
  `frontend/src/utils/postmanExport.ts`
- The execute -> persist primitive (Mode 2 + Mode 1 Postman captures):
  `api-migration-validation-service/src/routes/captureSessionActions.ts`
  (`manual-capture`, `parse-oas`, `start`, `reconcile-inventory`,
  `account-endpoints`)
- Planner + per-op orchestration loop (Mode 1 delta):
  `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`
  (`defaultScenarioSet`, `MAX_SCENARIOS_PER_OP`, `orchestrateCaptureSession`)
- LLM execution path + gates (what Mode 1(c) bypasses, what (b) tops up with):
  `api-migration-validation-service/src/services/tools/execute_http_request.ts`
- Mode 1 wizard host:
  `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
- AMS reconciliation client surface + `operations_without_model_endpoint`:
  `api-migration-validation-service/src/services/archModelClient.ts`
- Endpoint synthesis (for "Add to architecture" / new-endpoint append):
  `synthesiseInventoryFromEndpoints` / `synthesiseOperationFromEndpoint` in
  `captureSessionActions.ts`

### Open Questions (asked of the user)

These are the genuinely-open items. The DECIDED block above is settled and was
NOT re-asked.

**OQ1 -- Mode 2 replay semantics.** Replay live (re-execute each imported item
against the live API and capture the real response) vs import the saved example
responses from the collection (persist-without-send)? Leaning replay-live --
confirm, and is import-saved-responses in scope for v1 at all?

**OQ2 -- New-endpoint append.** `manual-capture` only works for operations
already in the session. Should Mode 2 be able to append genuinely NEW endpoints
(needs a new add-operation route), or is v1 limited to endpoints already in the
session's operation set?

**OQ3 -- Live secrets for post-hoc append.** Secrets are purged when a run
finishes. Is a "re-enter secrets" step acceptable UX, or should append be
offered only on still-live sessions?

**OQ4 -- "Add to architecture" target.** Create a committed architecture
endpoint directly, or stage a discovery candidate for the normal review/approve
flow?

**OQ5 -- Mode (b) delta granularity + unmapped items.** Is per-operation dedup
correct? And should a Postman item that maps to NO known operation still run (as
an extra capture) or be flagged for the architecture-match step instead?

**OQ6 -- UI placement.** Confirm Mode 1 upload + run-mode selector lives as a
step in `StartCaptureSessionWizard`, and Mode 2 append is launched from an
existing capture session detail view (and/or baseline detail). Any preference?

**OQ7 -- v1 scope boundaries.** application/json only? Single collection per run?
How to treat multi-step / folder-structured Postman items (flatten to individual
requests, like the export does)? Any auth-in-collection handling (ignore
collection auth, use session secrets)?

### Open Questions -- Answers

User confirmed ALL recommended answers (2026-06-23).

**A1 (OQ1) -- Mode 2 replay semantics: REPLAY LIVE.** Mode 2 re-executes each
imported item against the live API (via the `manual-capture` primitive) and
captures the REAL response from the current system. Import-saved-responses
(persist-without-send) is OUT of scope for v1 (deferred to a possible v2).

**A2 (OQ2) -- New-endpoint append: SUPPORTED in v1.** Mode 2 can append endpoints
NOT already in the session. This requires a new "add-operation" path that creates
the operation row (and stages it `included=true`) before the `manual-capture`
send. Reuse `synthesiseOperationFromEndpoint` / the `account-endpoints` precedent
for the operation-row creation shape. (An imported endpoint that also doesn't
match the architecture flows into the A4 architecture-match step.)

**A3 (OQ3) -- Live secrets for append: RE-ENTER-SECRETS STEP.** Post-hoc append
is offered on finished (completed/failed) sessions too; when secrets have been
purged, the append flow prompts the user to re-submit secrets (`POST /secrets`)
before sending. Append is NOT restricted to still-live sessions.

**A4 (OQ4) -- "Add to architecture": STAGE A DISCOVERY CANDIDATE.** "Add to
architecture" does NOT write a committed architecture endpoint directly; it
stages a discovery candidate that flows through the existing discovery
review/approve path. Reuses the established candidate-review/save-approved
mechanism rather than a new privileged direct-write.

**A5 (OQ5) -- Delta granularity + unmapped items: PER-OP DEDUP; UNMAPPED ->
ARCHITECTURE-MATCH STEP.** Mode 1(b) dedup is per-operation. A Postman item that
maps to NO known operation is NOT silently run as an extra capture -- it is routed
to the A4 architecture-match step ("Add to architecture" [stage candidate] or
"Delete the item").

**A6 (OQ6) -- UI placement: WIZARD + CAPTURE-SESSION DETAIL.** Mode 1 (Postman
upload + run-mode selector) lives as a step/sub-section in
`StartCaptureSessionWizard`. Mode 2 (append) is launched from the existing
capture-session detail view.

**A7 (OQ7) -- v1 scope boundaries: JSON-ONLY, ONE COLLECTION, FLATTEN, IGNORE
EMBEDDED AUTH.** v1 = `application/json` only; one collection per run; multi-step
/ folder-structured Postman items are FLATTENED to individual requests (matching
the export's precedent); any collection-level / item-level Postman auth is
IGNORED -- the session's in-memory secrets are the sole auth source.

### Follow-up Questions

_[If any are needed after the first round.]_

## Visual Assets

### Files Provided:

No visual assets provided. (`planning/visuals/` exists but is empty as of this
shaping pass.) A visual-asset request was extended to the user alongside the
clarifying questions.

### Visual Insights:

None -- no files to analyze.

## Requirements Summary

### Functional Requirements

- A new Postman Collection v2.1 IMPORT parser (frontend), mirroring the export's
  type surface; v1 = `application/json`.
- Mode 1 pre-capture seed with a 3-way run-mode selector (LLM only / Postman +
  LLM delta / Postman only) on `StartCaptureSessionWizard`.
- Mode 1 delta: two-stage bounded subtraction (code pre-filter heuristic + LLM
  judge), per operation, respecting `MAX_SCENARIOS_PER_OP`.
- Mode 1 Postman-only: fire imported requests, skip planner + LLM, use the
  coverage-gate override for the intentionally-partial coverage.
- Mode 2 post-hoc append of a collection to an existing run via the
  `manual-capture` execute -> persist primitive.
- Per-item architecture-match warning with "Add to architecture" / "Delete"
  actions, driven by `operations_without_model_endpoint`.
- Staged/reviewable imported items before a run, showing reconciled coverage.

### Reusability Opportunities

- Postman v2.1 types + defensive helpers from `postmanExport.ts`.
- `manual-capture` send -> redact -> persist primitive.
- `defaultScenarioSet` + `orchestrateCaptureSession` per-op loop.
- `reconcile-inventory` coverage + `operations_without_model_endpoint`.
- `coverageOverrideJustification` gate for Mode 1(c).
- `synthesiseInventoryFromEndpoints` for endpoint creation / append.

### Scope Boundaries

**In Scope (v1, OQ answers locked):**
- Postman v2.1 `application/json` import (one collection per run; folders /
  multi-step items flattened to individual requests; embedded Postman auth
  ignored -- session secrets are the sole auth source). [A7]
- The three Mode 1 run modes (LLM only / Postman + LLM delta / Postman only),
  with the delta as a two-stage per-op bounded subtraction (code pre-filter +
  LLM judge). [D3, A5]
- Mode 2 post-hoc append via the `manual-capture` REPLAY-LIVE primitive,
  including a re-enter-secrets step on finished sessions. [A1, A3]
- A new "add-operation" path so Mode 2 can append endpoints NOT already in the
  session's operation set. [A2]
- Per-item architecture-match warnings; unmatched/unmapped items routed to the
  architecture-match step, whose "Add to architecture" STAGES A DISCOVERY
  CANDIDATE (not a direct architecture write). [A4, A5]
- Staged/reviewable imported items before a run, showing reconciled coverage.

**Out of Scope / Deferred:**
- import-saved-responses (persist-without-send) -- v2. [A1]
- Non-`application/json` content types; multiple collections per run. [A7]
- Direct committed-architecture-endpoint writes (we stage a discovery candidate
  instead). [A4]
- Generating `pm.*` scripts from inter-step refs (the export deliberately does
  NOT; IMPORT matches that). [A7]

### Technical Considerations

- AMS wire format is snake_case by default; the capture DTOs used here
  (scenario/capture/operation) are snake_case on the wire.
- The `manual-capture` primitive requires live in-memory secrets and an
  already-included operation -- both constrain Mode 2 (see OQ2, OQ3).
- Mode 1(c) must explicitly engage the coverage-gate override or `/start` will
  fail-closed on unaccounted in-scope endpoints.
- IMPORT parsing must be defensive (loose Record narrowing), matching the
  export's fail-soft posture.
