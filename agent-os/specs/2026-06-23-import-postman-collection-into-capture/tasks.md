# Task Breakdown: Import a Postman Collection into Capture

## Overview
Total Tasks: 9 task groups

Implements Postman Collection v2.1 (JSON) import into the API Behaviour Baseline
capture flow -- the inverse of the existing export. Spans all three services:
`frontend` (React/TS, vitest), `api-migration-validation-service` / AMVS (Node/TS,
jest), and `architecture-model-service` / AMS (Spring Boot/Java + Liquibase,
JUnit/MockMvc). Covers spec requirements R1-R8 and decisions D1-D6 / A1-A7.

## CRITICAL IMPLEMENTATION CONSTRAINT (read before starting any group)

Many tasks below MODIFY large, existing, in-production files:
- `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
- `frontend/src/api/apiBehaviourClient.ts`
- `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx`
  (and/or `CaptureSessionDetailPage.tsx`)
- `api-migration-validation-service/src/routes/captureSessionActions.ts`
- `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`
- AMS controllers under `architecture-model-service/`

For every such file you MUST make ANCHORED, SURGICAL edits (insert/replace at a
known anchor line or symbol) and NEVER regenerate or overwrite the whole file.
After each edit, re-verify the surrounding symbols and check for mojibake /
dropped characters. Net-new code (the import parser, new shared components, new
AMVS actions/routes, new orchestrator helpers) goes in NEW files; only the wiring
seam into the existing file is an anchored edit. This constraint is load-bearing
and applies to ALL groups -- it is repeated in-group where the risk is highest.

Wire-format rule (R8): AMS DTOs (scenario/capture/operation/reconciliation) are
snake_case on the wire by default; the new add-operation action follows the
`account-endpoints` snake_case create shape. The `manualCapture` request body stays
camelCase (existing `ManualCaptureRequest` contract); the route maps to snake_case
AMS shapes server-side. Reuse existing frontend clients (`manualCapture`,
`reconcileInventory`, `accountEndpoints`, `isSecretsNotLoadedError`) rather than
adding new fetch shims.

## Task List

### Frontend -- Foundational Parser

#### Task Group 1: Postman v2.1 IMPORT parser (R1)
**Dependencies:** None
**Service:** frontend (vitest)

NET-NEW FILE ONLY -- a pure function with no deps. This unblocks everything else.

- [x] 1.0 Build the defensive Postman v2.1 import parser
  - [x] 1.1 Write 2-8 focused tests for `postmanImport.ts`
    - Limit to 2-8 highly focused tests maximum (new file `postmanImport.test.ts`)
    - Cover only critical behaviours: well-formed collection -> `ImportedRequest[]`
      with `{ method, path, query, headers, body, sourceItemName }`; folder /
      multi-step (`sequence`) FLATTEN preserving order; malformed/partial item
      degrades (fields skipped) and NEVER throws; `{{baseUrl}}` / host stripped
      (path + query kept); non-`application/json` body flagged unsupported (not
      silently sent); embedded `auth` blocks IGNORED
    - Skip exhaustive coverage of every Postman field variant
  - [x] 1.2 Create `frontend/src/utils/postmanImport.ts` (NEW)
    - Import the v2.1 type surface from `frontend/src/utils/postmanExport.ts`
      (`PostmanCollection`, `PostmanItem`, `PostmanRequest`, `PostmanUrl`,
      `PostmanHeader`, `PostmanQueryParam`, `PostmanBody`) -- do NOT redeclare
    - Define and export the `ImportedRequest` type:
      `{ method, path, query, headers, body, sourceItemName, unsupportedReason? }`
  - [x] 1.3 Implement defensive narrowing mirroring the export
    - Reuse/mirror `asRecord` / `asString` / `asNumber` / `toPathSegments` posture;
      input is `Record<string, unknown>`, fail-soft, never throws
  - [x] 1.4 Implement folder + multi-step flatten (export precedent)
    - Recurse `item[]` folders and `sequence` multi-step items into a flat list,
      preserving order
  - [x] 1.5 Implement request resolution
    - Resolve `method` + `path` (strip `{{baseUrl}}` / host, keep path + query);
      `application/json` bodies only; non-JSON bodies flagged per-item via
      `unsupportedReason`; IGNORE all collection-level and item-level `auth`
    - Do NOT generate `pm.*` scripts or resolve inter-step `response_refs`
  - [x] 1.6 Ensure parser tests pass
    - Run ONLY the 2-8 tests from 1.1 (vitest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass
- Pure function: no fetch / DOM / server call
- Malformed input degrades gracefully and never throws
- Folders / multi-step items flatten in order; JSON-only bodies; auth ignored

### Frontend -- Client Surface

#### Task Group 2: Frontend client wiring for import flows (R2, R8)
**Dependencies:** Task Group 1
**Service:** frontend (vitest)

Reuse existing clients; add only the new client functions the AMVS work requires.

- [x] 2.0 Establish the frontend client surface for import
  - [x] 2.1 Write 2-8 focused tests for client surface
    - Cover only critical behaviours: `manualCapture(...)` body stays camelCase
      (`ManualCaptureRequest`); `isSecretsNotLoadedError` detects 409
      `SECRETS_NOT_LOADED`; the new add-operation client posts the snake_case
      create shape and parses a snake_case response
  - [x] 2.2 Confirm and reuse existing clients (ANCHORED edits only if needed)
    - `manualCapture` (`apiBehaviourClient.ts:1825`), `reconcileInventory`
      (`:1740`), `accountEndpoints` (`:1793`), `isSecretsNotLoadedError` (`:382`)
    - Do NOT add new fetch shims where one already exists
  - [x] 2.3 Add the new add-operation client function (ANCHORED edit)
    - Add to `apiBehaviourClient.ts` alongside `accountEndpoints`; camelCase
      request in, maps to the AMVS add-operation action; snake_case AMS shape
      handled server-side (R7/R8)
  - [x] 2.4 Confirm `reconcile-inventory` response typing
    - Ensure `InventoryReconciliationResponse.operations_without_model_endpoint`
      (`archModelClient.ts:312`) is exposed to the staging UI verbatim (snake_case)
  - [x] 2.5 Ensure client tests pass
    - Run ONLY the 2-8 tests from 2.1 (vitest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass
- `manualCapture` body camelCase; new add-operation client uses snake_case AMS shape
- Existing clients reused, not re-shimmed

### Frontend -- Shared Staging UI

#### Task Group 3: Import staging + reconciled review component (R3, D6)
**Dependencies:** Task Groups 1, 2
**Service:** frontend (vitest)

NET-NEW shared component used by BOTH Mode 1 (wizard) and Mode 2 (detail modal).

- [x] 3.0 Build the shared Postman import staging component
  - [x] 3.1 Write 2-8 focused tests for the staging component
    - Cover only critical behaviours: renders per-item resolved method/path,
      mapped session operation (or "no match"), and architecture-match status;
      maps imported item -> session operation by `(method, path)`; renders the
      returned `InventoryReconciliationResponse` verbatim; unmatched items are
      surfaced (routed to R5), never silently runnable
  - [x] 3.2 Create `frontend/src/components/ApiBehaviour/PostmanImportStaging.tsx`
    (NEW) + its `.module.css`
    - Props accept `ImportedRequest[]`, the session operation rows, and the
      reconciliation payload; emits per-item resolution + actions
  - [x] 3.3 Implement item->operation mapping by `(method, path)`
    - Match against session operation rows; unmatched -> flagged for R5
  - [x] 3.4 Wire reconciled coverage display
    - Call `reconcileInventory(...)` and render the returned
      `InventoryReconciliationResponse` verbatim (do not re-derive coverage)
  - [x] 3.5 Surface architecture-match status per item
    - Use `operations_without_model_endpoint` from the reconciliation payload to
      mark each item matched / unmatched (feeds Group 4)
  - [x] 3.6 Ensure staging component tests pass
    - Run ONLY the 2-8 tests from 3.1 (vitest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass
- Per-item method/path, mapped operation, and arch-match status render correctly
- Reconciliation payload rendered verbatim; unmatched items flagged, not runnable

### Frontend -- Architecture-Match Step

#### Task Group 4: Architecture-match warning + discovery-candidate staging (R5, D5, A2, A4, A5)
**Dependencies:** Task Group 3
**Service:** frontend (vitest)

Routes unmatched/unmapped items to a warning step. "Add to architecture" STAGES A
DISCOVERY CANDIDATE through the existing discovery review/approve path -- it MUST
NOT write a committed architecture endpoint directly.

- [x] 4.0 Build the architecture-match handling step
  - [x] 4.1 Write 2-8 focused tests for the arch-match step
    - Cover only critical behaviours: an item whose endpoint does NOT match a
      committed architecture endpoint (per `operations_without_model_endpoint`)
      AND any item mapping to NO known operation is routed to the warning step;
      "Add to architecture" calls the discovery-candidate staging path (NOT a
      direct architecture write); "Delete the item" drops it from the import set;
      a kept unmatched item triggers add-operation (Group 5/6) before any send
  - [x] 4.2 Create the arch-match warning UI (NEW component or sub-section)
    - Two actions per flagged item: "Add to architecture" and "Delete the item"
  - [x] 4.3 Wire "Add to architecture" to stage a discovery candidate
    - Use `frontend/src/api/discoveryReviewApi.ts` (existing discovery
      review/approve path); MUST NOT write a committed architecture endpoint
  - [x] 4.4 Wire "Delete the item"
    - Remove the item from the staged import set
  - [x] 4.5 Wire kept-and-run path to add-operation
    - For an unmatched item the user chooses to keep & run, ensure the operation
      row is created first (via the add-operation client from Group 2/AMVS Group 6)
      before any `manual-capture` send
  - [x] 4.6 Ensure arch-match tests pass
    - Run ONLY the 2-8 tests from 4.1 (vitest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass
- Unmatched / unmapped items always routed to the warning step (never silent)
- "Add to architecture" stages a discovery candidate; no direct architecture write
- Kept-and-run items create the operation row before sending

### AMS -- Discovery-Candidate Staging (Java)

#### Task Group 5: AMS discovery-candidate staging support (R5, A4) -- ONLY IF Java changes required
**Dependencies:** Task Group 4 (consumer shape known)
**Service:** architecture-model-service (JUnit/MockMvc, Liquibase)

Scope check FIRST: if the existing discovery review/approve endpoint already
accepts the candidate shape "Add to architecture" needs, this group is a no-op --
confirm and skip. Only do Java work if the staging path needs a new/extended
endpoint or field. Make ANCHORED edits to AMS controllers; never regenerate them.

- [x] 5.0 Confirm / extend AMS discovery-candidate staging
  - [x] 5.1 Spike: confirm whether the existing discovery-candidate staging
    endpoint covers the "Add to architecture" payload from Task 4.3
    - If fully covered: mark this group N/A, document the endpoint used, and skip
      5.2-5.6
  - [x] 5.2 Write 2-8 focused tests (MockMvc) for the staging endpoint -- only if 5.1 found a gap
    - Cover only critical behaviours: candidate persisted in un-approved state;
      snake_case wire shape (R8); validation of required fields
  - [x] 5.3 Extend the controller via ANCHORED edit -- only if needed
    - Follow existing snake_case DTO convention (R8); apply `@CamelCaseWire` ONLY
      if a camelCase consumer requires it (default is snake_case -- no annotation)
  - [x] 5.4 Add Liquibase changeset -- only if a new column/table is required (N/A -- no schema change needed; existing discovery_candidate + discovery_run schema sufficed)
    - Add indexes / FKs as the existing discovery-candidate schema dictates
  - [x] 5.5 Wire DTO <-> entity mapping -- only if needed
  - [x] 5.6 Ensure AMS staging tests pass
    - Run ONLY the 2-8 tests from 5.2 (JUnit/MockMvc); verify any migration runs.
      Do NOT run the entire AMS suite.

**Acceptance Criteria:**
- Either: confirmed the existing endpoint suffices (group marked N/A), OR
- The 2-8 tests from 5.2 pass; candidate staged un-approved in snake_case; any
  migration runs cleanly

### AMVS -- Import Mapping, Add-Operation, Postman-Only Run

#### Task Group 6: AMVS import->operations mapping, add-operation path, Postman-only run (R2, R4c, R7, R8)
**Dependencies:** Task Group 2 (client contract), Task Group 1 (parser shape)
**Service:** api-migration-validation-service (jest)

ANCHORED edits to `captureSessionActions.ts` (huge file). New action handlers are
net-new code added at a known anchor; reuse the `manual-capture`, `parse-oas`,
`account-endpoints`, and `start` precedents verbatim.

- [x] 6.0 Build the AMVS server paths for import
  - [x] 6.1 Write 2-8 focused tests for the AMVS import paths
    - Cover only critical behaviours: add-operation action creates the operation
      row with `included=true` and appends to `oasInventoryStore` so `/start` sees
      it without a re-parse; add-operation reuses
      `synthesiseOperationFromEndpoint` (`captureSessionActions.ts:438`) and the
      `account-endpoints` `createOperation` snake_case shape (`:1454-1476`);
      `manual-capture` enforced pre-conditions honoured (409 `SECRETS_NOT_LOADED`,
      404 `OPERATION_NOT_FOUND`, 400 `OPERATION_NOT_INCLUDED`); Postman-only
      `/start` carries `coverageOverrideJustification` so the coverage gate does
      not fail closed (`:581,1905`)
  - [x] 6.2 Add the new add-operation action (NET-NEW handler, ANCHORED insert) (R7/A2)
    - Creates the operation row (`included=true`) BEFORE any `manual-capture` send;
      reuse `synthesiseOperationFromEndpoint` and `account-endpoints` shape; append
      to `oasInventoryStore`; snake_case AMS create shape (R8)
  - [x] 6.3 Confirm `manual-capture` reuse for all import sends (R2)
    - All three modes physically send each imported request through the existing
      `manual-capture` route (`:1525`); do NOT fork the send/redact/persist logic;
      route works on completed/failed sessions (not gated on `status==='running'`)
  - [x] 6.4 Wire the Postman-only run path (R4c)
    - On Postman-only `/start`, skip planner AND the `execute_http_request` loop;
      require `coverageOverrideJustification` -> `coverage_override_*` trio
      (`:581,1905`) so the coverage gate does not fail closed
    - ANCHORED edit at the `/start` handler only; do not regenerate it
  - [x] 6.5 Confirm import->operations mapping uses existing seams
    - Reconcile imported items against `oasInventoryStore` operation rows; reuse
      `reconcile-inventory` (`:1308`) for coverage; unmatched -> client R5 step
  - [x] 6.6 Ensure AMVS import-path tests pass
    - Run ONLY the 2-8 tests from 6.1 (jest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 6.1 pass
- Add-operation creates `included=true` row visible to `/start` without re-parse
- All sends go through the unchanged `manual-capture` primitive
- Postman-only `/start` requires and persists the coverage-override trio

### AMVS -- Mode 1(b) Delta

#### Task Group 7: Mode 1(b) two-stage per-op bounded subtraction (R6, D3, A5)
**Dependencies:** Task Group 6 (Postman captures land first)
**Service:** api-migration-validation-service (jest)

The delta logic. NEW helper functions in net-new files; the per-op loop seam in
`captureSessionOrchestrator.ts` is an ANCHORED edit only -- never regenerate that
file.

- [x] 7.0 Implement the two-stage bounded subtraction
  - [x] 7.1 Write 2-8 focused tests for the delta
    - Cover only critical behaviours: Stage-1 code pre-filter removes candidates
      that obviously match an imported (captured) request for that operation by
      archetype (`type`) / method / path / which-param / `expectedStatus`; Stage-2
      LLM judge (mocked) marks remaining candidates redundant-or-not against that
      op's captured Postman requests; delta = `defaultScenarioSet` MINUS (Stage-1
      + Stage-2 redundant), capped at `MAX_SCENARIOS_PER_OP=12` INCLUDING the
      already-captured Postman scenarios; computed PER OPERATION
  - [x] 7.2 Create the Stage-1 code pre-filter helper (NEW file)
    - Pure heuristic over `defaultScenarioSet(op, discoveryContext, oasOperation)`
      candidates (`captureSessionOrchestrator.ts:983`) vs the op's captured Postman
      requests
  - [x] 7.3 Create the Stage-2 LLM-judge helper (NEW file)
    - Judges remaining candidates redundant-or-not against captured Postman
      requests for that operation; returns non-redundant survivors only
  - [x] 7.4 Wire the delta into the per-op loop (ANCHORED edit)
    - At `captureSessionOrchestrator.ts:1306`, pass a per-operation Postman-covered
      set into the loop so it subtracts BEFORE generating; only survivors top up
      via the existing `execute_http_request` path; enforce `MAX_SCENARIOS_PER_OP`
      (`:926`) including already-captured Postman scenarios
    - ANCHORED edit only at the loop seam; do not regenerate the orchestrator
  - [x] 7.5 Ensure delta tests pass
    - Run ONLY the 2-8 tests from 7.1 (jest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 7.1 pass
- Two-stage subtraction is per-operation and respects `MAX_SCENARIOS_PER_OP`
- Cap counts already-captured Postman scenarios; only survivors top up via LLM

### Frontend -- Mode 1 Wizard & Mode 2 Append

#### Task Group 8: Mode 1 wizard run-mode selector + Mode 2 detail-view append (R4, R7, D3, A1, A3, A6)
**Dependencies:** Task Groups 3, 4, 6, 7
**Service:** frontend (vitest)

ANCHORED edits to `StartCaptureSessionWizard.tsx` and the capture-session detail
view (`CaptureSessionDetailView.tsx` / `CaptureSessionDetailPage.tsx`) -- large
existing files; never regenerate. Both modes embed the Group 3 staging component
and the Group 4 arch-match step.

- [x] 8.0 Wire Mode 1 and Mode 2 UI orchestration
  - [x] 8.1 Write 2-8 focused tests for the two entry points
    - Cover only critical behaviours: wizard run-mode selector offers LLM only /
      Postman + LLM delta / Postman only; Mode 1(a) unchanged (planner +
      `execute_http_request`, no Postman); Mode 1(b) fires imported items
      post-`/start` then triggers delta top-up; Mode 1(c) sends `/start` with
      `coverageOverrideJustification`; Mode 2 append from detail view replays live
      via `manual-capture`; on 409 `SECRETS_NOT_LOADED` the append flow prompts a
      re-enter-secrets step (`POST /secrets`) before sending
  - [x] 8.2 Add the run-mode selector + Postman upload to the wizard (ANCHORED edit) (R4)
    - Add a sub-section / step to `StartCaptureSessionWizard.tsx` (existing
      `WizardStep = 1..6`, host at `:95`/`:223`); embed the Group 3 staging
      component and Group 4 arch-match step
  - [x] 8.3 Implement Mode 1 send orchestration (R4a/b/c)
    - (a) LLM only: unchanged. (b) after `/start`, fire imported items as concrete
      captures via `manualCapture` (operations exist + `included=true`), then run
      the Group 7 delta top-up. (c) fire imported items, skip planner + LLM loop;
      `/start` carries `coverageOverrideJustification`
    - Items with no matching operation must pass through Group 4 before they can send
  - [x] 8.4 Launch Mode 2 append from the capture-session detail view (ANCHORED edit) (R7/A6)
    - Add an append entry point + modal to the detail view; embed the Group 3
      staging component and Group 4 arch-match step; replay live via `manualCapture`
  - [x] 8.5 Implement the re-enter-secrets step (R7/A3)
    - On finished (completed/failed) sessions with purged secrets, detect 409
      `SECRETS_NOT_LOADED` via `isSecretsNotLoadedError` (`apiBehaviourClient.ts:382`)
      and prompt a re-enter-secrets step (`POST /secrets`) before sending
  - [x] 8.6 Wire add-operation for appended new endpoints (R7/A2)
    - Mode 2 (and Mode 1 staging) append of endpoints NOT in the session calls the
      add-operation client (Group 2/6) to create the `included=true` row BEFORE
      the `manual-capture` send; unmatched-to-architecture appended endpoints flow
      through Group 4
  - [x] 8.7 Ensure Mode 1 / Mode 2 tests pass
    - Run ONLY the 2-8 tests from 8.1 (vitest). Do NOT run the whole suite.

**Acceptance Criteria:**
- The 2-8 tests from 8.1 pass
- 3-way selector present; Mode 1(a) unchanged; (b) fires imports then delta; (c)
  carries the coverage override
- Mode 2 append replays live and prompts re-enter-secrets on purged sessions
- Appended new endpoints create the operation row before sending

### End-to-End Verification

#### Task Group 9: End-to-end wiring, gap analysis, and verification (R1-R8)
**Dependencies:** Task Groups 1-8
**Service:** all (frontend vitest, AMVS jest, AMS JUnit as needed)

- [x] 9.0 Review existing tests and fill critical gaps only
  - [x] 9.1 Review tests from Task Groups 1-8
    - Review the 2-8 tests written per group (parser, client, staging, arch-match,
      AMS staging, AMVS import paths, delta, Mode 1/2). Total existing: ~14-64 tests
  - [x] 9.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage; focus ONLY on this
      spec's requirements. Do NOT assess whole-application coverage. Prioritize:
      (i) Mode 1(b) end-to-end -- import -> capture -> delta top-up -> review;
      (ii) Mode 2 append on a finished session through the re-enter-secrets step;
      (iii) unmatched item -> arch-match -> "Add to architecture" stages a
      discovery candidate (no direct architecture write)
  - [x] 9.3 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps; focus on the
      three end-to-end workflows in 9.2. Do NOT write comprehensive coverage; skip
      edge cases / performance / accessibility unless business-critical
  - [x] 9.4 Manual end-to-end wiring pass
    - Verify: parser -> staging -> arch-match -> add-operation -> `manual-capture`
      send -> review/baseline flow is connected for all three Mode 1 paths and
      Mode 2; snake_case AMS shapes vs camelCase `manualCapture` body are correct
      (R8); JSON-only / one-collection / flatten / ignore-auth scope holds (A7)
  - [x] 9.5 Run feature-specific tests only
    - Run ONLY tests related to this spec (Groups 1-8 plus 9.3). Expected total:
      ~24-74 tests. Do NOT run the entire application suite per service.

**Acceptance Criteria:**
- All feature-specific tests pass (~24-74 tests total across services)
- The three critical end-to-end workflows in 9.2 are covered
- No more than 10 additional tests added to fill gaps
- "Add to architecture" verified to stage a discovery candidate, never a direct
  architecture write; out-of-scope items (saved-responses, non-JSON, multi-collection)
  confirmed not implemented

## Execution Order

Recommended implementation sequence:
1. Postman v2.1 IMPORT parser (Task Group 1) -- foundational, no deps
2. Frontend client surface (Task Group 2)
3. Import staging + reconciled review component (Task Group 3)
4. Architecture-match warning + discovery-candidate staging UI (Task Group 4)
5. AMS discovery-candidate staging support (Task Group 5) -- only if Java changes needed
6. AMVS import mapping, add-operation, Postman-only run (Task Group 6)
7. Mode 1(b) two-stage per-op delta (Task Group 7)
8. Mode 1 wizard + Mode 2 detail-view append (Task Group 8)
9. End-to-end wiring + gap analysis + verification (Task Group 9)

Note: Groups 5 and 6/7 are independent of each other once Group 4 is done and may
run in parallel by service team. Group 8 integrates all upstream work and must
come last before verification.
