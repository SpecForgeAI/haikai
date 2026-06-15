# Specification: Non-Reconciling Work at Reconcile Time (D6)

## Goal
Extend the two already-built mechanisms (the migration reconciliation + bug loop, and the holistic integration/E2E TEST mechanism) so that deliberately-added `net_new` API endpoints are auto-recognised as EXPECTED at reconcile time rather than surfacing as false breaks, and so that non-API / operational stories are tested by EFFECT. The current-state oracle is unchanged; D6 only CONSUMES D5 provenance + the D3 operational marker.

## User Stories
- As a migration engineer reviewing reconciliation breaks, I want a `net_new` endpoint's `target_only` diff auto-recognised as "Expected — net_new endpoint" (with the matched work item named) so that I do not have to manually dispose of something the program already knows was intentional.
- As a migration engineer, I want operational / non-API stories tested by their downstream effect (DB / message / snapshot) so that batch-tier work — which reconciliation cannot diff — is still verified.

## Specific Requirements

**Capture `net_new_operations` on the add-item form (extends D5)**
- Extend the D5 add-item modal (`MigrationDeliveryAddItemModal`) with a small optional `net_new_operations` field, shown for `provenance=net_new` + `kind=api` items, accepting one `<METHOD> <path>` entry per line (e.g. `POST /accounts`).
- Thread the captured list through `AddItemFormValues` → the dashboard `AddBookItemInput` client → the gateway `add-item` route body → the AMS `add-item` endpoint, where it rides the `book_of_work_json` blob item (NO changeset; mirroring how `provenance` / `kind` / `source_capability_id` / `workItemId` already ride the blob).
- `net_new_operations` is the AUTHORITATIVE, human-owned match source — NOT `coveredEndpointIds` (model UUIDs, unreliable/empty for non-endpoint stories), NOT spec-parsing.
- Optional/non-core: the describe→generate step MAY suggest operations for the human to confirm later; out of scope for this spec.

**Post-diff net_new `target_only` auto-disposition pass (gateway)**
- Add a POST-DIFF pass inside `triggerFullBaselineReconcile`, at the `breakRows` mapping seam, AFTER `runHeadlessReconcile` returns and the breaks are created — keep the api-migration-validation-service diff a PURE current-state diff with no provenance knowledge.
- For each created break whose diff item is `target_only` (null `source_baseline_item_id`), compute its normalised `<METHOD> <path>` key (reusing the `operationKey` convention: method trimmed + upper-cased, path trimmed) and attempt a match against the `net_new_operations` keys read from the book-of-work blob's `net_new` items.
- CREATE-THEN-AUTO-DISPOSE: the `target_only` break is still created (visible + auditable), then on a unique match immediately PATCHed (via `patchReconciliationBreak`) to the terminal `expected_net_new` disposition with `needs_human=false` and a `detail_json` / audit note naming the matched work item.
- Read the `net_new_operations` lists from the run's book of work once per reconcile and build a lookup of key → owning work item(s); only `provenance=net_new` items contribute.

**Dedicated `expected_net_new` disposition value**
- Add `expected_net_new` as a NEW terminal disposition (a net_new endpoint is ADDITIVE, not a DEVIATION — do NOT reuse `intentional_deviation`).
- Extend the gateway `BREAK_DISPOSITION` constant (`migrationReconciliationBreakClient.ts`), the AMS `MigrationReconciliationBreakStatus.ALL` validation set (and `validateDispositionStatus` accepts it), and the frontend `BREAK_DISPOSITION` + label/badge maps.
- It is a plain TEXT value — NO changeset / DDL; only the validation set + the label/badge maps change.

**No-match and ambiguous defaults (safe, never silently swallowed)**
- No match → leave the break exactly as today: a normal `open` break for human disposition.
- Ambiguous (one key matching multiple `net_new` items, or the operation differs) → ALSO a normal `open` break, with the match attempt recorded in the break's `detail_json` so the human sees why it was not auto-recognised.

**Holistic effect-test steering — recognise operational stories**
- Thread two already-available blob signals through the holistic loader `defaultLoadNode` → `LoadedHolisticChild` / `StorySpecSummary` (which carry NEITHER today): `provenance` (the D5 marker) and the operational marker (`source_capability_id` from D3 and/or the `operational_capability` spec marker / `kind=operational`).
- A child is "operational / non-API" when it carries the operational marker (mirrors the existing `isManualAdd` + `ManualAddFlavour` resolution in `migrationShapeSpecGenerationHandler.ts`, but routed through the holistic node loader).

**Holistic effect-test steering — emit EFFECT assertions**
- Add a PROMPT steering clause in `holisticTestPlanningPrompt` (`buildHolisticTestPlanningPrompt`): when reviewed children are operational/non-API, instruct the reviewer to emit EFFECT-asserting tests (run the pipeline → assert DB tables / downstream message / snapshot outcome) — the only way to verify the batch tier reconciliation cannot touch.
- Add a matching clause in `assembleHolisticTestSpecBody` so the generated TEST item's spec body carries the effect-assertion guidance.
- The emitted TEST item type STAYS `integration|e2e` — content / guidance only, NO new type.

**Human override (reuse existing path)**
- A human can re-open / re-classify an auto-dispositioned `expected_net_new` break via the existing disposition re-classify path (`disposeBreaks` / the break PATCH) — NO new mechanism.

**Frontend recognition badge (minimal + additive)**
- In `MigrationDeliveryReconciliationPanel`, render an auto-dispositioned `expected_net_new` break as VISIBLY RECOGNISED — an "Expected — net_new endpoint" label/badge plus the matched work-item reference read from `detail_json` — NOT hidden, NOT a new screen, retaining the existing override (select → re-dispose) affordance.
- Add `expected_net_new` to `dispositionLabel`, `dispositionBadgeClass`, and `TERMINAL_BREAK_STATES`.

## Existing Code to Leverage

**`gateway/src/services/migrationReconciliationDriver.ts`**
- `triggerFullBaselineReconcile` `breakRows` mapping (~lines 334–352) is the post-diff seam where the auto-disposition pass attaches; `diffItemToBreak` already builds the `detail_json.operation` = `<METHOD> <path>`.
- `disposeBreaks` + the `patchReconciliationBreak` dep are the create-then-auto-dispose + human-override write path (extend `VALID_NON_SENT_DISPOSITIONS` to include `expected_net_new`).

**`gateway/src/services/migrationReconciliationValidationClient.ts` + `migrationReconciliationBreakClient.ts`**
- `isDiffItemABreak` already counts `target_only` as a break — UNCHANGED; the `ReconciliationDiffItem` carries `method`/`path`/`source_baseline_item_id` for the match. `BREAK_DISPOSITION` is the constant to extend with `expected_net_new`.

**`api-migration-validation-service/src/services/diffRunner.ts` (~lines 367–385)**
- The `target_only` block emits diffs with null `source_baseline_item_id` + `status_classification='target_only'`; read-only — stays a pure, provenance-agnostic current-state diff.

**`InventoryReconciliationCalculator.operationKey` (AMS, ~line 169)**
- Produces the `<METHOD> <path>` key (method trimmed + upper-cased, path trimmed) — the convention the gateway match replicates.

**`gateway/src/services/holisticTestPlanningPrompt.ts` + `holisticTestDefinitionHandler.ts`**
- `defaultLoadNode` builds `LoadedHolisticChild` from the blob (add `provenance` / `source_capability_id` reads); `StorySpecSummary` + `buildStorySpecSummary` + `buildHolisticTestPlanningPrompt` + `assembleHolisticTestSpecBody` are the prompt + spec-body steering points. `migrationShapeSpecGenerationHandler.ts` `isManualAdd` / `ManualAddFlavour` is the reference for recognising operational items off the blob.

**Frontend `MigrationDeliveryReconciliationPanel.tsx` + `migrationReconciliationApi.ts` + `MigrationDeliveryAddItemModal.tsx`**
- The panel's `dispositionLabel` / `dispositionBadgeClass` / breaks table is where the recognition badge + matched-work-item ref attach; the API's `BREAK_DISPOSITION` / `TERMINAL_BREAK_STATES` get the new value; the add-item modal + `AddBookItemInput` get the `net_new_operations` field. AMS `MigrationReconciliationBreakStatus.ALL` + `validateDispositionStatus` accept the new value.

## Out of Scope
- The provenance marker itself (D5), the carry_over completeness gate (D4), capability synthesis + spec-gen (D2/D3) — D6 only CONSUMES their outputs.
- Any new AMS changeset / DDL (`net_new_operations` rides the blob; `expected_net_new` is a TEXT value).
- Any new TEST item type — stays `integration|e2e`.
- Any change to the diff runner's provenance-agnostic, current-state-only behaviour.
- Any change to the bug loop, circuit breaker, or disposition machinery beyond adding the `expected_net_new` value.
- Deriving the match from `coveredEndpointIds` or by parsing the generated spec.
- Narrowing or otherwise mutating the pinned current-state oracle — auto-disposition only RECORDS the additive endpoint.
- The describe→generate "suggest operations from the spec" nice-to-have (the `net_new_operations` field stays the authoritative source).
