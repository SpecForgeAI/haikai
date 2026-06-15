# Spec Requirements: Non-Reconciling Work at Reconcile Time (D6)

## Initial Description

D6 is Spec 6 of 6 (FINAL) in the discovery-completeness + net_new program. It is an EXTENSION of two ALREADY-BUILT mechanisms — it does NOT rebuild either:

1. The migration-reconciliation-and-bug-loop (prior program, BUILT + verified — AMS changeset 183, `migrationReconciliationDriver`, the disposition states, the circuit breaker).
2. The holistic-integration-e2e-test-work-items mechanism (prior program, BUILT — `holisticTestPlanningPrompt` + `holisticTestDefinitionHandler`).

D6 extends both to correctly handle the non-API / net_new world the rest of the program introduced. It does two things:

1. **net_new API endpoint → target_only = EXPECTED (not a break).** A net_new API endpoint (provenance=net_new, from D5) appears in reconciliation as a `target_only` diff (present in the migrated target, absent from the pinned current-state baseline). The built reconciler currently classifies target_only diffs as breaks for human disposition. D6 auto-recognises that a target_only diff whose operation maps to a known net_new work item is EXPECTED and auto-dispositions it (visibly + auditably) so it does not demand human toil. This CONSUMES D5's provenance marker; the oracle does NOT change (current-state always).

2. **Steer the holistic TEST mechanism to verify non-API/batch work by EFFECT.** Reconciliation is API-only, so it cannot verify non-API work (D3 operational_capability stories, D5 operational net_new). D6 steers the built holistic TEST mechanism so that for non-API / operational stories it emits EFFECT-asserting tests (run the pipeline → assert DB tables + downstream message + snapshot) — the only way to verify the batch tier reconciliation cannot touch. The emitted TEST item type stays `integration|e2e`; only the content/guidance changes.

## Problem Statement / Context

The built reconciliation mechanism is **API-only** and classifies any `target_only` diff (present in the migrated target, absent from the pinned current-state baseline) as a **break** for human disposition. This produces two correctness gaps once the rest of this program introduces deliberately-added net_new work and non-API operational work:

- **False breaks for deliberately-added endpoints.** A net_new API endpoint that was intentionally added during migration is, by definition, present in the target and absent from the pinned current-state baseline. Under today's reconciler it surfaces as a `target_only` break — a FALSE break — forcing a human to manually dispose of something the program already knows was intentional (its provenance is `net_new`).

- **Non-API work cannot be reconciled at all.** Reconciliation diffs API current-state only. Operational / batch / non-API work (D3 `operational_capability` stories, D5 operational net_new) has no API surface to diff, so reconciliation can neither confirm nor deny it was delivered correctly. The only way to verify the batch tier is by EFFECT — run the pipeline and assert the downstream outcome (DB tables, downstream message, snapshot). The built holistic TEST mechanism is the right home for that, but today it does not know which stories are operational and so does not steer toward effect assertions.

D6 closes both gaps by **extending the two built mechanisms** without changing the current-state oracle:

- It teaches the reconciler to auto-recognise a net_new `target_only` diff as EXPECTED (recording the additive endpoint, never narrowing the pinned baseline).
- It teaches the holistic reviewer to recognise operational/non-API stories and emit effect-asserting tests for them.

The oracle stays **current-state-always**; the bug loop, circuit breaker, and disposition machinery are UNTOUCHED. D6 only CONSUMES provenance (D5) and the operational marker (D3) and EXTENDS the two built mechanisms.

## Requirements Discussion

The clarifying-question phase is complete. The user reviewed and agreed with all recommendations, including the recommendation for a dedicated `expected_net_new` disposition value (rather than reusing `intentional_deviation`). The finalized, user-confirmed decisions are recorded below as Confirmed Decisions D1–D9.

### Existing Code to Reference

The following BUILT components were verified and are to be EXTENDED (not forked or rebuilt):

**The built reconciler:**
- `gateway/src/services/migrationReconciliationDriver.ts` — `triggerFullBaselineReconcile` (the `breakRows` mapping at ~lines 334–352 is the post-diff seam where the auto-disposition pass attaches), `diffItemToBreak`, `disposeBreaks`.
- `gateway/src/services/migrationReconciliationValidationClient.ts` — `isDiffItemABreak` (ALREADY counts `target_only` as a break).
- `api-migration-validation-service/src/services/diffRunner.ts` — the `target_only` block at ~lines 367–385 (emits diffs with null `source_baseline_item_id` and `pairKey` `<METHOD>|<path>|<scenario>`). This stays a PURE current-state diff with NO provenance knowledge.

**The built break store:**
- AMS changeset 183 + `MigrationReconciliationBreakStatus` (8 states including `intentional_deviation`) + `MigrationReconciliationBreakService.validateDispositionStatus`.
- `gateway/src/services/migrationReconciliationBreakClient.ts` — `BREAK_DISPOSITION`.

**Matching:**
- `InventoryReconciliationCalculator.operationKey` — produces the `<METHOD> <path>` key convention (method trimmed + upper-cased, path trimmed). This is the convention reused for the match.
- `coveredEndpointIds` (changeset 181) — model EndpointEntity UUIDs; deliberately NOT used for the match (unreliable/empty for non-endpoint stories).

**The built holistic mechanism:**
- `gateway/src/services/holisticTestPlanningPrompt.ts` + `gateway/src/services/holisticTestDefinitionHandler.ts` — `StorySpecSummary`, `assembleHolisticTestSpecBody`, `defaultLoadNode`.

**Frontend:**
- `frontend/src/components/.../MigrationDeliveryReconciliationPanel.tsx` (the built breaks-review panel) + `frontend/src/api/migrationReconciliationApi.ts`.

**Upstream program inputs D6 consumes:**
- D5: `work_item.provenance` (the net_new marker) + the D5 add-item form.
- D3: `operational_capability` (spec marker) + `source_capability_id`.

## Confirmed Decisions

### D1. net_new target_only → work-item matching

Match by a normalised **`<METHOD> <path>` string key** (reusing the existing `operationKey` convention: method trimmed + upper-cased, path trimmed) against an **EXPLICIT `net_new_operations` list** captured on the add-item form (e.g. `["POST /accounts"]`).

This beats the alternatives:
- It beats deriving from `coveredEndpointIds` (model EndpointEntity UUIDs — unreliable/empty for non-endpoint stories).
- It beats parsing the generated spec.
- It is deterministic + auditable.

**Implication:** D6 EXTENDS D5's add-item form to capture `net_new_operations` for API net_new items, stored in the `book_of_work_json` blob (NO changeset — mirroring how `source_capability_id` / `workItemId` ride the blob), and reads it at reconcile time.

**Optional nice-to-have (NOT core):** the describe→generate step could SUGGEST operations from the generated spec for the human to confirm — but the `net_new_operations` field stays the authoritative human-owned source.

### D2. Default when no match / ambiguous

- **No match** → leave exactly as today: a normal `open` break for human disposition (the safe default — never silently swallow).
- **Ambiguous** (one key matching multiple net_new items, or the operation differs) → ALSO a normal break, with the match attempt recorded in the break's `detail_json` so the human sees why it was not auto-recognised.

### D3. Auto-recognition placement + disposition value

(a) **Placement** — a POST-DIFF pass in the gateway `triggerFullBaselineReconcile`. Keep the api-migration-validation-service diff a PURE current-state diff with no provenance knowledge; the provenance-aware auto-disposition is a gateway concern.

(b) **Create-then-auto-dispose** — the `target_only` break IS created (visible + auditable in the breaks store), then immediately PATCHed to a terminal disposition with `needs_human=false` + a `detail_json` / audit note naming the matched work item.

(c) **Dedicated `expected_net_new` disposition value** (NOT reuse `intentional_deviation`):
- A net_new endpoint is ADDITIVE (brand-new functionality), not a DEVIATION (a deliberate change to existing behaviour). Conflating them loses a real distinction.
- Costs NO changeset (the disposition column is plain TEXT) — only extend `MigrationReconciliationBreakStatus.ALL` validation set + the gateway `BREAK_DISPOSITION` + the frontend label/badge map.
- Consistent with D4's dedicated `dismissed` philosophy.
- The breaks review reads "Expected — net_new endpoint" as a first-class state.

### D4. Holistic effect-test steering

Recognise an operational/non-API story by threading two already-available signals through `defaultLoadNode` → `StorySpecSummary` (which carry NEITHER today):
- `provenance` (the D5 marker).
- The operational marker — presence of `source_capability_id` (from D3) and/or the `operational_capability` spec marker.

On recognition, add:
- A PROMPT steering clause in `holisticTestPlanningPrompt`.
- A matching clause in `assembleHolisticTestSpecBody`.

…so the reviewer emits EFFECT assertions (run the pipeline → assert DB tables / downstream message / snapshot outcome).

The emitted TEST item type stays `integration|e2e` — only the content/guidance changes, NO new type.

### D5. Changeset

D6 needs NO new AMS changeset:
- `net_new_operations` rides the `book_of_work_json` blob (no DDL).
- The `expected_net_new` disposition is a TEXT value (no DDL — only the validation set + label map change).

Program changeset count stays D2=184, D4≈185, D5≈186; **D6 = NONE.**

### D6. Frontend

Minimal + additive:
- In the built `MigrationDeliveryReconciliationPanel`, surface an auto-dispositioned net_new `target_only` as VISIBLY RECOGNISED ("Expected — net_new endpoint" badge + the matched work-item reference from `detail_json`) — NOT hidden, NOT a new screen — with the existing override affordance.
- PLUS the small `net_new_operations` field on the D5 add-item form (per D1).

### D7. Human override

Yes — REUSE the existing disposition re-classify path (`disposeBreaks` / the break PATCH already moves between dispositions). A human can re-open / re-classify an auto-dispositioned net_new `target_only` if the match was wrong. NO new mechanism.

### D8. Test strategy

**Gateway jest** (LLM-guard: mock `llmClient` + `architectureModelClientMock`):
- (a) a net_new-matched `target_only` → created-then-auto-dispositioned (`expected_net_new` + audit note); an UNMATCHED `target_only` → stays a normal `open` break.
- (b) ambiguous / multi-match → normal break + recorded attempt (in `detail_json`).
- (c) a holistic-steering test: an operational story (provenance=net_new + `source_capability_id`) → effect-assertion guidance in the prompt + spec body (mock LLM).
- (d) a NO-REGRESSION test that ordinary breaks AND a non-net_new `target_only` still surface as `open`.

**AMS H2** (foreground `mvn`): the new `expected_net_new` validation round-trip.

**Frontend vitest** (`renderWithProviders` + tsc baseline): the recognised-badge render.

### D9. Scope guard

- The oracle stays CURRENT-STATE-ALWAYS (auto-disposition RECORDS the additive endpoint, NEVER narrows the pinned baseline).
- The bug loop / circuit breaker / disposition machinery are UNTOUCHED.
- D2/D3/D4/D5 stay OUT (D6 only CONSUMES provenance [D5] + the operational marker [D3] and EXTENDS the two built mechanisms — the reconciliation + bug-loop and the holistic TEST mechanism).

## Visual Assets

No visual assets provided. The `planning/visuals/` folder was checked via bash and is empty (the folder exists but contains no image files).

## Requirements Summary

### Functional Requirements

- At reconcile time, a `target_only` diff whose normalised `<METHOD> <path>` key matches an explicit `net_new_operations` entry on a net_new work item is auto-recognised as EXPECTED: the break is created (visible/auditable) then auto-dispositioned to the dedicated `expected_net_new` terminal state with `needs_human=false` and an audit note naming the matched work item.
- A `target_only` diff with no match remains a normal `open` break for human disposition (safe default).
- An ambiguous match (key matches multiple net_new items, or the operation differs) remains a normal `open` break, with the match attempt recorded in the break's `detail_json`.
- The D5 add-item form captures a `net_new_operations` list for API net_new items, stored in the `book_of_work_json` blob.
- A human can re-open / re-classify an auto-dispositioned net_new `target_only` via the existing disposition re-classify path.
- The holistic TEST mechanism recognises operational/non-API stories (via `provenance` + `source_capability_id` / `operational_capability`) and steers the reviewer to emit EFFECT-asserting `integration|e2e` tests.
- The frontend breaks-review panel surfaces an auto-dispositioned net_new `target_only` as visibly recognised ("Expected — net_new endpoint" badge + matched work-item reference), with the existing override affordance.

### Reusability Opportunities

- The reconciler post-diff seam: `triggerFullBaselineReconcile` `breakRows` mapping (~lines 334–352 in `migrationReconciliationDriver.ts`).
- `diffItemToBreak`, `disposeBreaks`, and `migrationReconciliationBreakClient.ts` `BREAK_DISPOSITION` for create-then-auto-dispose and human override.
- `isDiffItemABreak` (already counts `target_only` as a break) — unchanged.
- `InventoryReconciliationCalculator.operationKey` for the `<METHOD> <path>` key convention.
- The diffRunner `target_only` block (~lines 367–385) with its `pairKey` `<METHOD>|<path>|<scenario>` — read-only; stays a pure current-state diff.
- The holistic mechanism: `holisticTestPlanningPrompt.ts`, `holisticTestDefinitionHandler.ts` (`StorySpecSummary`, `assembleHolisticTestSpecBody`, `defaultLoadNode`).
- The frontend `MigrationDeliveryReconciliationPanel.tsx` + `migrationReconciliationApi.ts`.
- AMS `MigrationReconciliationBreakStatus` / `MigrationReconciliationBreakService.validateDispositionStatus` for the new `expected_net_new` value.

### Scope Boundaries

**In Scope:**
- Gateway: post-diff net_new `target_only` auto-disposition pass in `triggerFullBaselineReconcile`; the `<METHOD> <path>` match logic; reading `net_new_operations` from the blob; the new `expected_net_new` value in `BREAK_DISPOSITION`; extending D5's add-item handling to capture `net_new_operations`.
- Gateway: holistic effect-test steering — thread `provenance` / `source_capability_id` through `defaultLoadNode` → `StorySpecSummary` + the prompt clause + the `assembleHolisticTestSpecBody` clause.
- AMS: extend `MigrationReconciliationBreakStatus.ALL` validation to accept `expected_net_new` (NO changeset, TEXT value; no other AMS change).
- Frontend: the "Expected — net_new endpoint" badge/label + matched-work-item reference in `MigrationDeliveryReconciliationPanel`; the `net_new_operations` field on the add-item form.

**Out of Scope:**
- The provenance marker itself (D5); the carry_over completeness gate (D4); capability synthesis + spec-gen (D2/D3) — D6 only CONSUMES their outputs.
- Any new AMS changeset / DDL.
- Any new TEST item type (stays `integration|e2e`).
- Any change to the diff runner's provenance-agnostic, current-state-only behaviour.
- Any change to the bug loop, circuit breaker, or disposition machinery beyond adding the `expected_net_new` value.
- Deriving the match from `coveredEndpointIds` or by parsing the generated spec (explicitly rejected in D1).

**Optional / nice-to-have (NOT core):**
- The describe→generate step SUGGESTING operations from the generated spec for the human to confirm (the `net_new_operations` field remains the authoritative human-owned source).

### Technical Considerations

- **Owners:** gateway (the reconciler extension + the holistic effect-test steering + the `expected_net_new` value + extending D5's add-item handling) + AMS (extend the `MigrationReconciliationBreakStatus.ALL` validation set only) + frontend (the recognised badge/label + matched-work-item ref + the `net_new_operations` add-item field).
- **No new changeset:** `net_new_operations` rides the `book_of_work_json` blob; `expected_net_new` is a plain TEXT disposition value. Program changeset count stays D2=184, D4≈185, D5≈186; D6 = NONE.
- **Separation of concerns:** the api-migration-validation-service diff stays a PURE current-state diff with no provenance knowledge; the provenance-aware auto-disposition is a gateway-only concern.
- **Current-state oracle invariant:** auto-disposition RECORDS the additive endpoint, NEVER narrows the pinned baseline.
- **Repo conventions:** gateway Express/TS with jest LLM-guard (mock `llmClient`) + `architectureModelClientMock`; AMS Java/Spring with boxed PATCH-mutable types and snake_case wire (no new changeset); frontend React/TS with vitest + `renderWithProviders` + tsc baseline.
- **Directive:** EXTEND the two built mechanisms (reconciliation + bug-loop and the holistic TEST mechanism); do NOT fork or rebuild them.
