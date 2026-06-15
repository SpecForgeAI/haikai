# Task Breakdown: Non-Reconciling Work at Reconcile Time (D6)

## Overview
Total Tasks: 6 task groups (D6 of 6 — FINAL). D6 EXTENDS two already-built mechanisms
(the migration-reconciliation-and-bug-loop and the holistic integration/E2E TEST
mechanism). It does NOT rebuild either, and adds NO new AMS changeset anywhere:
`net_new_operations` rides the `book_of_work_json` blob, and `expected_net_new` is a
plain TEXT disposition value. D6 only CONSUMES D5 `work_item.provenance` + the D3
operational marker (`source_capability_id` / `operational_capability` / `kind=operational`).

Two features:
1. A `net_new` API endpoint's `target_only` reconciliation diff is auto-recognised as
   EXPECTED (auto-dispositioned to a dedicated `expected_net_new` terminal state with an
   audit note naming the matched work item) instead of surfacing as a false break.
2. The holistic TEST mechanism is steered so operational / non-API stories emit
   EFFECT-asserting `integration|e2e` tests (run the pipeline → assert DB / message /
   snapshot), the only way to verify the batch tier reconciliation cannot diff.

**Scope invariants (D9) that hold across EVERY group:**
- The current-state oracle stays CURRENT-STATE-ALWAYS — auto-disposition RECORDS the
  additive endpoint, it NEVER narrows the pinned baseline.
- The api-migration-validation-service diff stays a PURE, provenance-agnostic
  current-state diff — the provenance-aware auto-disposition is a GATEWAY-ONLY concern.
- The bug loop / circuit breaker / disposition machinery are UNTOUCHED beyond adding the
  one new `expected_net_new` value.
- The emitted holistic TEST item type stays `integration|e2e` — content/guidance only,
  NO new type.
- NO new AMS changeset / DDL anywhere (program changeset count stays D2=184, D4≈185,
  D5=186; D6 = NONE).

## Task List

### AMS Layer

#### Task Group 1: `expected_net_new` Disposition Value (AMS validation set)
**Dependencies:** None
**Owner:** AMS (Java/Spring Boot, `architecture-model-service`)
**Anchors:** `architecture-model-service/.../model/entity/MigrationReconciliationBreakStatus.java`
(the `ALL` set at lines 72-81 currently holds 8 values; `validateDispositionStatus` in
`MigrationReconciliationBreakService` is the ONLY AMS validation gate, per the requirements
audit). NO changeset — `disposition_status` is plain TEXT with no DB enum / CHECK.

- [x] 1.0 Add the `expected_net_new` terminal disposition value to the AMS validation set
  - [x] 1.1 Write 2-3 focused tests for the new value
    - One test: a break PATCH/disposition round-trip to `expected_net_new` is ACCEPTED
      by `validateDispositionStatus` (the value persists and reads back).
    - One test: an unknown/garbage disposition is still REJECTED (the validation gate is
      not weakened — guards against accidentally accepting everything).
    - Limit to 2-3 tests maximum; do NOT re-test the existing 8 dispositions.
  - [x] 1.2 Add `EXPECTED_NET_NEW = "expected_net_new"` constant to
    `MigrationReconciliationBreakStatus`
    - Add it as a NEW `public static final String` alongside `INTENTIONAL_DEVIATION`.
    - Add it to the `ALL` `Set.of(...)` (the validation set — this is what
      `validateDispositionStatus` checks).
    - Decide whether it belongs in `TERMINAL_HUMAN_DISPOSITIONS`: it IS terminal
      (never re-run) but is set by the gateway auto-disposition (machine), not a human.
      Add it to `TERMINAL_HUMAN_DISPOSITIONS` (or an equivalent terminal set) so the
      idempotent-callback short-circuit treats it as terminal — confirm against how that
      set is consumed before finalising. Update the class Javadoc to describe it as the
      ADDITIVE-endpoint terminal state (distinct from `intentional_deviation`, which is a
      DEVIATION from existing behaviour).
  - [x] 1.3 Confirm NO changeset is added
    - The column is plain TEXT; only the constants holder + validation set change.
    - Do NOT touch any Liquibase changeset (existing changesets are immutable).
  - [x] 1.4 Ensure AMS Group 1 tests pass — FOREGROUND `mvn` (H2)
    - Run ONLY the 2-3 tests written in 1.1 (targeted `mvn -Dtest=...` against the H2
      test profile), in the FOREGROUND.
    - Verify the `expected_net_new` PATCH round-trip validates and persists.
    - Do NOT run the entire AMS suite at this stage.

**Acceptance Criteria:**
- The 2-3 tests written in 1.1 pass under foreground `mvn` (H2).
- A break can be PATCHed to `expected_net_new` and reads back; unknown values still 400.
- NO new changeset; only the constants/validation set changed.

### Gateway Layer

#### Task Group 2: Capture `net_new_operations` on the Add-Item Path (extends D5)
**Dependencies:** Task Group 1
**Owner:** Gateway (Express/TypeScript, `gateway`) + AMS add-item endpoint (extend, do not rebuild)
**Anchors:** the D5 add-item chain already exists end-to-end —
`gateway/src/routes/migrationShapeSpecGeneration.ts` add-item route (~line 626, body parse
~630-640 reads `provenance` / `kind` / `title` / `description`) → AMS `AddWorkItemRequest`
record + the AMS add-item endpoint (`GeneratedMigrationBookOfWorkController` /
`GeneratedMigrationBookOfWorkService`) which stamps `provenance` (column + blob) and `kind`
(blob). Extend BOTH to accept + stamp `net_new_operations` onto the `book_of_work_json` blob
item, mirroring how `provenance` / `kind` / `source_capability_id` / `workItemId` already
ride the blob. NO changeset.

- [x] 2.0 Thread `net_new_operations` through the add-item request into the blob
  - [x] 2.1 Write 2-4 focused tests for the add-item `net_new_operations` capture
    - One test: an add-item request with `provenance=net_new` + `kind=api` +
      `net_new_operations: ["POST /accounts"]` stamps that list onto the blob item.
    - One test: the list is ignored / not stamped (or harmlessly absent) when
      `provenance` is NOT `net_new` (scoped to net_new + api only).
    - Split as needed across the gateway route test and the AMS endpoint/service test.
    - Limit to 2-4 tests maximum; do NOT re-test the existing D5 add-item behaviour.
  - [x] 2.2 Extend the gateway add-item route body type + forwarding
    (`migrationShapeSpecGeneration.ts`)
    - Add an optional `net_new_operations?: string[]` (or the agreed wire field name)
      to the route's `body` type at ~line 630.
    - Forward it verbatim to the AMS add-item endpoint (the route already JSON-stringifies
      `req.body` to AMS — confirm the field passes through and is not stripped).
    - Keep the existing title-required 400 guard and verbatim non-2xx round-trip unchanged.
  - [x] 2.3 Extend the AMS add-item DTO + endpoint to accept + stamp `net_new_operations`
    - Add a `net_new_operations` field to `AddWorkItemRequest` (snake_case wire via
      `@JsonProperty("net_new_operations")`, matching the existing fields).
    - In `GeneratedMigrationBookOfWorkService` (the add-item handler), stamp the list onto
      the `book_of_work_json` blob item alongside `provenance` / `kind` — NOT a column
      (NO changeset). Persist only when present; tolerate null/empty.
    - Scope: only meaningful for `provenance=net_new` + `kind=api`. Stamp defensively (an
      empty/absent list is fine); the reconcile-time reader (Group 3) is the gate.
  - [x] 2.4 Ensure Group 2 tests pass — targeted gateway jest + AMS check
    - Gateway: run ONLY the 2.1 gateway tests with the LLM guard (mock `llmClient`) +
      `architectureModelClientMock` helper, then `npx tsc --noEmit` on the gateway.
    - AMS: run ONLY the 2.1 AMS add-item test(s) FOREGROUND (H2).
    - Do NOT run the entire suites at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass (gateway jest under the LLM guard; AMS foreground H2).
- A `net_new` + `api` add-item carries `net_new_operations` onto the blob item; a
  non-`net_new` item does not.
- `npx tsc --noEmit` is clean on the gateway; NO new changeset on AMS.

#### Task Group 3: Post-Diff `net_new` `target_only` Auto-Disposition Pass (gateway)
**Dependencies:** Task Groups 1, 2
**Owner:** Gateway (Express/TypeScript, `gateway`)
**Anchors:** `gateway/src/services/migrationReconciliationDriver.ts` —
`triggerFullBaselineReconcile` `breakRows` mapping is the POST-DIFF seam at lines ~335-337
(right after `runHeadlessReconcile` returns; breaks are persisted via
`createReconciliationBreaks` just below at ~342). `diffItemToBreak` (line 177) already writes
`detail_json.operation = "<METHOD> <path>"` (line 192). `patchReconciliationBreak` is the
write dep (declared ~line 98/148). `disposeBreaks` (line 541) + `VALID_NON_SENT_DISPOSITIONS`
(line 523) are the human-override + create-then-dispose write path.
`migrationReconciliationValidationClient.ts` `isDiffItemABreak` (~line 489) ALREADY counts
`target_only` as a break — UNCHANGED. `BREAK_DISPOSITION` in `migrationReconciliationBreakClient.ts`
(line 46) gets the new value. The `<METHOD> <path>` key convention mirrors AMS
`InventoryReconciliationCalculator.operationKey` (line 169: method trimmed + upper-cased,
path trimmed). The api-migration-validation-service `diffRunner.ts` `target_only` block
(~lines 367-394: null `source_baseline_item_id` + `status_classification='target_only'`)
stays a PURE current-state diff with NO provenance knowledge.

- [x] 3.0 Add the gateway post-diff auto-disposition pass + the `expected_net_new` constant
  - [x] 3.1 Write 3-5 focused tests for the auto-disposition pass
    - One test: a `target_only` break whose normalised `<METHOD> <path>` key UNIQUELY
      matches a `net_new` item's `net_new_operations` is created THEN auto-dispositioned
      to `expected_net_new` with `needs_human=false` and a `detail_json` audit note naming
      the matched work item.
    - One test: a `target_only` break with NO match stays a normal `open` break.
    - One test: an AMBIGUOUS match (key matches multiple `net_new` items, or the operation
      differs) stays a normal `open` break, with the match attempt recorded in
      `detail_json`.
    - One NO-REGRESSION test: ordinary (non-`target_only`) breaks AND a non-`net_new`
      `target_only` still surface as `open` (the pass never touches them).
    - Limit to 3-5 tests maximum; mock the break client writes / `patchReconciliationBreak`.
  - [x] 3.2 Add `expected_net_new` to the gateway disposition constants
    - Add `EXPECTED_NET_NEW: 'expected_net_new'` to `BREAK_DISPOSITION`
      (`migrationReconciliationBreakClient.ts`, line 46).
    - Add `expected_net_new` to `VALID_NON_SENT_DISPOSITIONS`
      (`migrationReconciliationDriver.ts`, line 523) so `disposeBreaks` (and the human
      override path) can move a break INTO and OUT OF it.
  - [x] 3.3 Build the `net_new_operations` lookup from the run's book of work
    - Read the run's book-of-work blob ONCE per reconcile and build a lookup of normalised
      `<METHOD> <path>` key → owning work item(s). ONLY `provenance=net_new` items
      contribute (reuse the proven blob-read shape from
      `migrationShapeSpecGenerationHandler.ts` lines ~818-832 / `isManualAdd`).
    - Normalise each `net_new_operations` entry with the `operationKey` convention (method
      trimmed + upper-cased, path trimmed) so it lines up with `diffItemToBreak`'s
      `detail_json.operation`.
  - [x] 3.4 Add the post-diff auto-disposition pass in `triggerFullBaselineReconcile`
    - After the `breakRows` mapping (~lines 335-337) AND after breaks are created
      (`createReconciliationBreaks`, ~line 342), iterate the created `target_only` breaks
      (those whose diff item had null `source_baseline_item_id`).
    - For each, compute its normalised `<METHOD> <path>` key (reuse `detail_json.operation`
      already written by `diffItemToBreak`) and look it up.
    - UNIQUE match → CREATE-THEN-AUTO-DISPOSE: the break is already created; immediately
      PATCH it (via `patchReconciliationBreak`) to `expected_net_new` with
      `needs_human=false` + a `detail_json` audit note naming the matched work item.
    - NO match → leave the break exactly as today: a normal `open` break.
    - AMBIGUOUS (multiple matches / operation differs) → leave it `open`, but record the
      match attempt in `detail_json` so the human sees why it was not auto-recognised.
    - Keep the api-migration-validation-service diff untouched (PURE current-state, no
      provenance). The oracle is UNCHANGED — this pass only RECORDS the additive endpoint.
  - [x] 3.5 Ensure Group 3 tests pass — targeted gateway jest + tsc
    - Run ONLY the 3.1 tests with the LLM guard (mock `llmClient`) +
      `architectureModelClientMock`, then `npx tsc --noEmit` on the gateway.
    - Verify create-then-dispose, no-match, ambiguous, and no-regression paths.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass (gateway jest under the LLM guard).
- A uniquely-matched `net_new` `target_only` is created then auto-dispositioned to
  `expected_net_new` with an audit note; no-match and ambiguous stay `open` (ambiguous
  records the attempt); ordinary + non-`net_new` `target_only` breaks are untouched.
- The api-migration-validation-service diff is unchanged; the oracle is not narrowed.
- `npx tsc --noEmit` is clean on the gateway.

#### Task Group 4: Holistic Effect-Test Steering for Operational Stories (gateway)
**Dependencies:** Task Group 2 (the `provenance` / operational signals on the blob)
**Owner:** Gateway (Express/TypeScript, `gateway`)
**Anchors:** `gateway/src/services/holisticTestDefinitionHandler.ts` —
`LoadedHolisticChild` (line 130) + `defaultLoadNode` (line 274; builds children from the
blob at ~line 305) carry NEITHER `provenance` NOR the operational marker today;
`buildStorySpecSummary` (line 532) maps a child → `StorySpecSummary`;
`assembleHolisticTestSpecBody` (line 570) builds the TEST item spec body.
`gateway/src/services/holisticTestPlanningPrompt.ts` — `StorySpecSummary` interface (line 66,
no provenance/operational fields today) + `buildHolisticTestPlanningPrompt` (line 192) is the
prompt assembler. The blob-read + operational-recognition reference is
`migrationShapeSpecGenerationHandler.ts` `isManualAdd` (line 1308) + `ManualAddFlavour` /
`resolveManualAddFlavour` (lines 1318-1328: `kind=operational` → operational). The emitted
TEST item type STAYS `integration|e2e` — content/guidance only.

- [x] 4.0 Recognise operational stories in the holistic loader + steer toward EFFECT tests
  - [x] 4.1 Write 2-4 focused tests for the holistic steering (mock LLM)
    - One test: an operational story (`provenance=net_new` + `source_capability_id` present,
      and/or `kind=operational` / `operational_capability` marker) produces EFFECT-assertion
      steering in the assembled holistic prompt (run pipeline → assert DB / message /
      snapshot).
    - One test: the generated TEST item's spec body (`assembleHolisticTestSpecBody`) carries
      the effect-assertion guidance for an operational child, while the TEST item type stays
      `integration|e2e`.
    - Optionally one test: a NON-operational (plain API) child does NOT get the effect-only
      steering (the clause is conditional).
    - Limit to 2-4 tests maximum; mock the LLM so no live call is made.
  - [x] 4.2 Thread `provenance` + the operational marker through the holistic loader
    - Add `provenance` + the operational signal (`source_capability_id` presence and/or
      `operational_capability` / `kind`) reads to `defaultLoadNode` → `LoadedHolisticChild`,
      reusing the `migrationShapeSpecGenerationHandler.ts` blob-read pattern
      (lines ~818-832) and the `isManualAdd` / `resolveManualAddFlavour` recognition shape.
    - Add the corresponding fields to `StorySpecSummary` (and populate them in
      `buildStorySpecSummary`). A child is "operational / non-API" when it carries the
      operational marker.
  - [x] 4.3 Add the EFFECT-assertion steering clause to the prompt
    - In `buildHolisticTestPlanningPrompt` (`holisticTestPlanningPrompt.ts`), add a PROMPT
      steering clause: when reviewed children are operational / non-API, instruct the
      reviewer to emit EFFECT-asserting tests (run the pipeline → assert DB tables /
      downstream message / snapshot outcome) — the only way to verify the batch tier
      reconciliation cannot touch. Make it conditional on at least one operational child.
  - [x] 4.4 Add the matching clause to the spec-body assembler
    - In `assembleHolisticTestSpecBody` (`holisticTestDefinitionHandler.ts`), add a matching
      clause so an operational/non-API story's generated TEST item spec body carries the
      effect-assertion guidance. The TEST item type STAYS `integration|e2e` — NO new type;
      the validated `tests[]` array stays as-is (guidance lives in the spec prose).
  - [x] 4.5 Ensure Group 4 tests pass — targeted gateway jest + tsc
    - Run ONLY the 4.1 tests with the LLM guard (mock `llmClient`) +
      `architectureModelClientMock`, then `npx tsc --noEmit` on the gateway.
    - Verify operational stories get effect steering in both the prompt and the spec body,
      and the TEST item type is unchanged.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass (gateway jest, LLM mocked).
- Operational/non-API children are recognised via `provenance` + the operational marker and
  steer the prompt AND the spec body toward EFFECT assertions; the TEST item type stays
  `integration|e2e`.
- `npx tsc --noEmit` is clean on the gateway.

### Frontend Layer

#### Task Group 5: Recognised Badge + `net_new_operations` Add-Item Field (frontend)
**Dependencies:** Task Groups 2, 3 (the new disposition value + the audit-note `detail_json`;
the add-item `net_new_operations` capture)
**Owner:** Frontend (React/TypeScript, `frontend`)
**Anchors:** `frontend/src/api/migrationReconciliationApi.ts` — `BREAK_DISPOSITION` (line 53),
the disposition union type (~line 70), `TERMINAL_BREAK_STATES` (line 76).
`frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryReconciliationPanel.tsx`
— `dispositionLabel` / `dispositionBadgeClass` live INSIDE this panel (and a copy in
`MigrationDeliveryPlan/DbMigrationPackView.tsx` — keep them consistent if shared) and drive
the breaks table; the existing override affordance (select → re-dispose) is already here and
must be RETAINED. The add-item form is `MigrationDeliveryAddItemModal.tsx` with the dashboard
client `addWorkItem` / `AddWorkItemInput` in `migrationDeliveryDashboardApi.ts` (lines
~1086-1098) — extend BOTH with the optional `netNewOperations`. Respect the frontend tsc
baseline (515). The existing panel test
(`__tests__/MigrationDeliveryReconciliationPanel.test.tsx`) already mocks
`migrationReconciliationApi` + uses `BREAK_DISPOSITION` constants — copy that mock shape.

- [x] 5.0 Add the recognised badge + the add-item `net_new_operations` field
  - [x] 5.1 Write 2-4 focused tests (vitest + `renderWithProviders`)
    - One test: the panel renders an auto-dispositioned `expected_net_new` `target_only`
      break as VISIBLY RECOGNISED — an "Expected — net_new endpoint" label/badge plus the
      matched work-item reference read from `detail_json` — NOT hidden, with the override
      affordance still present.
    - One test: the add-item modal shows the `net_new_operations` input ONLY for
      `provenance=net_new` + `kind=api`, and submits the entered operations through
      `addWorkItem`.
    - Limit to 2-4 tests maximum; copy the `migrationReconciliationApi` mock shape from the
      existing panel test.
  - [x] 5.2 Add `expected_net_new` to the frontend disposition maps
    - Add `EXPECTED_NET_NEW: 'expected_net_new'` to `BREAK_DISPOSITION`, extend the
      disposition union type, and add it to `TERMINAL_BREAK_STATES`
      (`migrationReconciliationApi.ts`).
    - Add `expected_net_new` to `dispositionLabel` (label: "Expected — net_new endpoint")
      and `dispositionBadgeClass` (a distinct badge style) in
      `MigrationDeliveryReconciliationPanel.tsx` (and keep the `DbMigrationPackView.tsx`
      copy consistent if it shares the maps).
  - [x] 5.3 Surface the recognised break in the panel
    - In `MigrationDeliveryReconciliationPanel`, render an auto-dispositioned
      `expected_net_new` break with the "Expected — net_new endpoint" badge AND the matched
      work-item reference read from `detail_json` — NOT hidden, NOT a new screen.
    - RETAIN the existing override affordance (select → re-dispose) so a human can re-open /
      re-classify a wrongly-matched break (reuses the existing disposition path).
  - [x] 5.4 Add the `net_new_operations` field to the D5 add-item form
    - Add a small optional `netNewOperations` input to `MigrationDeliveryAddItemModal`
      (`AddItemFormValues`), shown ONLY for `provenance=net_new` + `kind=api`, accepting one
      `<METHOD> <path>` entry per line (e.g. `POST /accounts`).
    - Thread it through the `addWorkItem` / `AddWorkItemInput` client
      (`migrationDeliveryDashboardApi.ts`, lines ~1086-1138) into the gateway add-item route
      body as the agreed wire field (the gateway/AMS read side is Group 2). Parse newline
      entries into a string array; trim/drop blanks.
  - [x] 5.5 Ensure Group 5 tests pass — targeted vitest + tsc baseline
    - Run ONLY the 5.1 tests with `renderWithProviders`.
    - Run `npx tsc --noEmit` (frontend) and confirm the error count does NOT exceed the
      515 baseline.
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass (vitest + `renderWithProviders`).
- The panel shows an auto-dispositioned `expected_net_new` break as "Expected — net_new
  endpoint" with the matched work-item ref and the override affordance retained; the
  add-item form captures `net_new_operations` for `net_new` + `api` items only.
- The frontend tsc error count stays at or below the 515 baseline.

### Testing

#### Task Group 6: Test Review & Strategic Gap Analysis
**Dependencies:** Task Groups 1-5
**Owner:** Cross-stack (gateway jest / AMS H2 / frontend vitest)

- [x] 6.0 Review existing tests and fill critical gaps only (≤10 additional tests)
  - [x] 6.1 Review the tests written in Groups 1-5
    - AMS (1.1): `expected_net_new` validation round-trip + rejection guard.
    - Gateway (2.1): add-item `net_new_operations` capture (net_new+api only).
    - Gateway (3.1): create-then-auto-dispose, no-match, ambiguous, no-regression.
    - Gateway (4.1): holistic effect-test steering (prompt + spec body), type unchanged.
    - Frontend (5.1): recognised badge render + the add-item `net_new_operations` field.
    - Total existing: roughly 11-20 tests.
  - [x] 6.2 Analyse coverage gaps for THIS feature only (the D8 matrix)
    - Confirm the D8 scenarios are all covered exactly once across Groups 1-5:
      (a) net_new-matched `target_only` → created-then-auto-dispositioned `expected_net_new`
      + matched-work-item audit note; an UNMATCHED `target_only` → normal `open` break;
      (b) AMBIGUOUS / multi-match → normal `open` break + recorded attempt in `detail_json`;
      (c) holistic steering — an operational story (`provenance=net_new` +
      `source_capability_id`) → effect-assertion guidance (mock LLM);
      (d) NO-REGRESSION — ordinary breaks AND a non-`net_new` `target_only` still surface as
      `open`;
      plus the human-override re-classify of an auto-dispositioned break, and the frontend
      recognised-badge + add-item field.
    - Focus ONLY on this spec's requirements. Do NOT assess whole-application coverage.
  - [x] 6.3 Write up to 10 additional strategic tests maximum (only if a D8 scenario is
    genuinely uncovered)
    - Prioritise: the human-override path (re-open / re-classify an auto-dispositioned
      `expected_net_new` break via the existing `disposeBreaks` / PATCH path) if not already
      asserted; an end-to-end gateway slice (matched `net_new` → auto-dispose) if only unit
      slices exist.
    - Maximum 10 new tests. Do NOT add edge-case, performance, or accessibility tests unless
      business-critical. Do NOT duplicate a scenario already covered in 1.1-5.1.
  - [x] 6.4 Run feature-specific tests only (per stack)
    - Gateway: run the 2.1/3.1/4.1 tests + any 6.3 gateway tests, with the LLM guard (mock
      `llmClient`) + `architectureModelClientMock`, then `npx tsc --noEmit` (gateway clean).
    - AMS: run the 1.1 tests + any 6.3 AMS tests FOREGROUND (H2); NO new changeset.
    - Frontend: run the 5.1 tests + any 6.3 frontend tests with `renderWithProviders`, then
      `npx tsc --noEmit` (frontend) at or below the 515 baseline.
    - Do NOT run the entire application test suites; expected total roughly 16-30 tests.

**Acceptance Criteria:**
- All feature-specific tests pass per stack (roughly 16-30 tests total).
- Every D8 scenario is covered exactly once; the human-override path is asserted.
- No more than 10 additional tests added; testing stays exclusively on D6's requirements.
- Gateway + frontend `tsc --noEmit` are clean / at-or-below the 515 baseline; AMS green on
  foreground H2; NO new changeset anywhere.

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. **AMS — `expected_net_new` value** (Task Group 1) — the disposition the gateway pass will
   write must validate first.
2. **Gateway — `net_new_operations` capture** (Task Group 2) — the human-owned match source
   on the blob must exist before the match pass can read it.
3. **Gateway — post-diff auto-disposition pass** (Task Group 3) — consumes Groups 1 + 2.
4. **Gateway — holistic effect-test steering** (Task Group 4) — independent of Group 3;
   depends only on the Group 2 blob signals.
5. **Frontend — recognised badge + add-item field** (Task Group 5) — consumes the Group 3
   disposition/audit-note + the Group 2 capture.
6. **Test Review & Gap Analysis** (Task Group 6).

## Cross-Cutting Reminders
- NO new AMS changeset anywhere — `net_new_operations` rides the `book_of_work_json` blob;
  `expected_net_new` is a plain TEXT disposition value.
- The api-migration-validation-service `diffRunner` stays a PURE, provenance-agnostic
  current-state diff — the auto-disposition is gateway-only.
- The oracle stays current-state-always — auto-disposition RECORDS the additive endpoint,
  never narrows the pinned baseline.
- The emitted holistic TEST item type stays `integration|e2e` — content/guidance only.
- The bug loop / circuit breaker / disposition machinery are UNTOUCHED beyond the one new
  value. D2/D3/D4/D5 are CONSUMED, not modified.
- Verification: AMS targeted FOREGROUND `mvn` (H2); gateway targeted jest with the live-LLM
  guard + `architectureModelClientMock` and `npx tsc --noEmit`; frontend targeted vitest with
  `renderWithProviders` and `npx tsc --noEmit` at or below the 515 baseline.
