# Task Breakdown: Model-Seeded Capture Inventory — Guaranteed Operation-Capture Completeness

## Overview

Total Tasks: 5 task groups (28 sub-tasks)

Make the committed architecture-model endpoint set the enumerator-of-record
for capture sessions: extract the existing AMS reconciliation computation into
a shared calculator (single source of truth with readiness gate C), expose it
via a new AMS reconciliation endpoint that also emits session-linked
reconciliation findings (delete-before-emit idempotent), add the validation
service's `reconcile-inventory` / `account-endpoints` configure-time actions
and the fail-closed `/start` hard block with persisted justified override,
register the two gateway action paths, and extend wizard Step 4 + session
detail + baseline surfaces so every in-scope committed endpoint ends up with
an operation row or an explicit exclusion-with-reason — nothing silently
absent.

**Cross-cutting constraints (apply to every group):**

- **The Java calculator is the ONLY home of the identity key + comparison.**
  REST → `<METHOD> <path>` (trimmed, method upper-cased); SOAP →
  `soap::<soap_action|request_root_element>` from `protocol_metadata_json`
  with fallback `soap::<endpoint id>`; harness operations always key on
  `<METHOD> <path>`. NO TypeScript reimplementation of the key or the
  comparison anywhere — the validation service and frontend only consume the
  AMS endpoint's payload.
- **Never edit applied Liquibase changesets.** Latest applied is `177`; the
  new columns arrive via NEW files `178-...` and `179-...` under
  `architecture-model-service/src/main/resources/db/changelog/sql/`. The
  changeset-179 origin-CHECK replacement (DROP + re-ADD as three-way
  exactly-one-of) follows the changeset-160 second-origin precedent exactly.
- **AMS wire format:** the new reconciliation endpoint and all new DTO fields
  use the default snake_case wire — NO `@CamelCaseWire` (consumers are the
  validation service's snake_case-typed `archModelClient` and the frontend).
- **Boxed/nullable everywhere:** every new column/DTO field is nullable and
  every Java numeric is boxed (`Integer`, never `int`) so PATCH semantics
  never wipe values to 0; mirror nullability into `archModelClient.ts` and
  `apiBehaviourClient.ts` types.
- **Readiness gate behaviour is FROZEN.** Coverage gate C delegates to the
  extracted calculator and derives its existing two counts from the detailed
  result; `DISCOVERY_HARNESS_INVENTORY_MISMATCH` semantics and ALL existing
  readiness tests stay green — refactor only.
- **Accounted = has a matching operation row, regardless of `included`.** An
  excluded-with-reason row (`included = false` + `exclusion_reason`) counts
  as accounted; persistence IS the accounting record — no extra state.
- **Null scope = whole architecture.** When neither the request nor the
  session row carries `scope_interface_ids`, the WHOLE architecture's
  endpoint set is in scope — nothing silently absent.
- **Gate fails closed; findings fail soft.** An AMS reconciliation error at
  `/start` returns a 502-style failure (never silently skips the gate);
  per-finding emission failures inside the AMS endpoint log + skip (mirroring
  diffRunner) and never fail the reconciliation response.
- **No retroactive gating:** completed/active sessions and existing baselines
  are untouched and render normally with all new fields null; Activate
  informs but never re-blocks (D3).
- **Out of scope (do not build):** replacing `parse-oas`/`extract-endpoints`;
  any readiness-gate behaviour change; Activate re-blocking; backfill of
  existing sessions/baselines; discovery re-scan trigger from the finding;
  schema/LLM enrichment of auto-created operations; per-endpoint scope UI;
  any change to `targetCaptureSessionActions.ts`.
- **Four test stacks:** AMS = JUnit (`mvn test -Dtest=...`),
  api-migration-validation-service + gateway = Jest, frontend = Vitest. Each
  group runs ONLY its own newly-written tests; never whole suites.
- **Frontend `tsc` baseline:** verify net-zero NEW errors from this spec's
  changes; do NOT chase the pre-existing baseline.

## Task List

### AMS — Calculator, Endpoint, Schema, Findings

#### Task Group 1: Shared reconciliation calculator + reconciliation endpoint + changesets 178/179 + finding emission
**Dependencies:** None

The single-source-of-truth layer: extract the existing key/comparison code
out of `MigrationDiscoveryContextService` into a shared static calculator
(readiness gate keeps passing byte-for-byte behaviourally), add the new
session reconciliation endpoint with scope partition + coverage math +
persist-scope, land the two new changesets, and put the session-linked
finding emission INSIDE the endpoint as the single write path.

- [x] 1.0 Complete the AMS reconciliation layer
  - [x] 1.1 Write 2-8 focused tests for the calculator and endpoint
    - Limit to 2-8 highly focused tests maximum (JUnit, following the
      existing `controller/apibehaviour` + `service/migration` test
      conventions).
    - Cover ONLY: (a) calculator detailed result — a REST endpoint matches an
      operation on `<METHOD> <path>` and a SOAP endpoint matches on
      `soap::<soap_action>` with the `request_root_element` and
      `soap::<endpoint id>` fallbacks, both directions populated with full
      refs + matched counts; (b) endpoint scope partition — endpoints whose
      `interface_id` is outside the scope set land in
      `excluded_by_scope_endpoints`, and an excluded-with-reason operation
      row still ACCOUNTS for its endpoint; (c) null-scope fallback chain —
      request null → session `scope_interface_ids_json` → whole architecture;
      (d) coverage math — `in_scope_coverage_pct` and
      `architecture_coverage_pct` with numerators/denominators, empty
      denominator → 100; (e) `persist_scope: true` writes
      `scope_interface_ids_json` to the session row; (f) findings
      delete-then-emit idempotence — two `refresh_findings: true` calls leave
      exactly one finding per operation-without-model-endpoint with the
      correct shape, and `refresh_findings: false` writes nothing; (g) a
      finding row with `api_behaviour_capture_session_id` set (other origins
      null) satisfies the three-way CHECK and a two-origin row is rejected;
      (h) readiness gate C still derives its existing
      `discoveredNotCaptured`/`capturedNotDiscovered` counts unchanged via
      the calculator.
    - Skip exhaustive key-permutation and validation coverage.
  - [x] 1.2 Create the two NEW Liquibase changesets (178, 179)
    - `178-...`: `api_behaviour_capture_sessions` gains nullable
      `scope_interface_ids_json JSONB`, `coverage_override_justification
      TEXT`, `coverage_override_unaccounted_count INTEGER`,
      `coverage_override_at TIMESTAMPTZ`; `api_behaviour_operations` gains
      nullable `exclusion_reason TEXT`.
    - `179-...`: `discovery_findings` gains nullable
      `api_behaviour_capture_session_id UUID` FK →
      `api_behaviour_capture_sessions(id) ON DELETE CASCADE` with a partial
      index; DROP `discovery_finding_exactly_one_origin` and re-ADD as a
      three-way exactly-one-of CHECK over `run_id` /
      `api_behaviour_diff_id` / `api_behaviour_capture_session_id`
      (changeset-160 template).
    - Mirror the new fields into the AMS session/operation/finding
      entities + DTOs with boxed types (`Integer`), snake_case wire.
  - [x] 1.3 Extract `InventoryReconciliationCalculator`
    - Move `computeInventoryReconciliation`, `endpointKey`, `operationKey`,
      `soapDiscriminator`, and `isSoapEndpoint` from
      `MigrationDiscoveryContextService.java` (~lines 1341–1434) into a new
      static calculator class in the same `service/migration` package.
    - The calculator returns the DETAILED result: endpoints-without-operation
      (full endpoint refs), operations-without-endpoint (full operation
      refs), and matched counts — identity keys byte-identical to today.
    - `MigrationDiscoveryContextService` coverage gate C delegates to the
      calculator and derives its existing two integers from the detailed
      result; existing readiness tests pass unmodified.
  - [x] 1.4 Build the reconciliation endpoint
    - `POST /api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}/inventory-reconciliation`
      as a new controller in `controller/apibehaviour` following
      `ApiBehaviourCaptureSessionController` conventions.
    - Loads the session row, the architecture's endpoints (via
      `resolveModelFileId` + `endpointRepository.findByModelFileId`, as gate
      C does), and the session's operation rows from AMS repositories.
    - Request (snake_case): `{ scope_interface_ids: string[] | null,
      persist_scope: boolean, refresh_findings: boolean }` with the
      request → session-row → whole-architecture scope fallback chain.
    - Response (snake_case): `in_scope_unaccounted_endpoints[]`
      (`endpoint_id`, `interface_id`, `key`, `name`, `method`, `path`,
      `protocol`, `soap_action`, `request_root_element`),
      `operations_without_model_endpoint[]` (`operation_row_id`,
      `operation_id`, `method`, `path`, `key`),
      `excluded_by_scope_endpoints[]` (`endpoint_id`, `interface_id`, `key`,
      `name`), plus both coverage percentages with numerator/denominator
      counts (empty denominators → 100; excluded-by-scope lowers the
      whole-architecture figure by design, per D7).
    - `persist_scope: true` + provided ids → write
      `scope_interface_ids_json` to the session row.
  - [x] 1.5 Implement session-linked finding emission inside the endpoint
    - When `refresh_findings: true` (the default): delete ALL prior findings
      with this session's `api_behaviour_capture_session_id`, then emit one
      finding per operation-without-model-endpoint (delete-before-emit
      idempotence, diffRunner precedent).
    - Finding shape: origin `api_behaviour_capture_session_id` = session id
      (other two origins null); `category: 'reconciliation'`;
      `finding_type: 'operation_without_model_endpoint'`;
      `severity: 'medium'`; `status: 'new'`;
      `source: 'capture_inventory_reconciliation'`; title/summary carrying
      method + path (or SOAP key); `detail_json` with operation row id,
      `operation_id`, and reconciliation key.
    - Per-finding failures are fail-soft (log + skip); the reconciliation
      response is never failed by an emission error. `refresh_findings:
      false` (display-only callers) writes nothing.
  - [x] 1.6 Ensure the AMS tests pass
    - Run ONLY the 2-8 tests written in 1.1 (`mvn test -Dtest=...`) plus the
      EXISTING readiness-gate tests touching gate C (refactor safety net).
    - Verify changesets 178 + 179 apply cleanly on a fresh context start (no
      checksum errors on ≤177).
    - Do NOT run the entire AMS suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; existing readiness-gate tests pass
  unmodified; changesets 178/179 apply cleanly.
- Identity keys are byte-identical to the pre-extraction behaviour; the
  detailed result carries full refs both directions.
- Re-running reconciliation never accumulates duplicate findings; the
  three-way origin CHECK holds.
- All new DTO fields are boxed/nullable, snake_case wire, no
  `@CamelCaseWire`.

### Validation Service — Actions + Start Gate

#### Task Group 2: `reconcile-inventory`, `account-endpoints`, parse-oas scope persistence, `/start` hard block + override
**Dependencies:** Task Group 1

All changes in `api-migration-validation-service/src/routes/
captureSessionActions.ts` (+ `archModelClient.ts`): the configure-time
reconcile action, the bulk include/exclude accounting action reusing the
existing endpoint→operation mapping, the persisted scope from `parse-oas`,
and the fail-closed Start gate with justified override.

- [x] 2.0 Complete the validation-service actions and gate
  - [x] 2.1 Write 2-8 focused tests for the actions and gate
    - Limit to 2-8 highly focused tests maximum (Jest, following
      `captureSessionActions.test.ts` patterns, AMS client mocked).
    - Cover ONLY: (a) `reconcile-inventory` loads the session, calls the new
      AMS endpoint via the new `archModelClient` method, and returns the AMS
      payload verbatim; (b) `account-endpoints` INCLUDE auto-creates a
      schema-less operation row from endpoint metadata — REST mapping
      (`operation_id` fallback chain, validated `operation_verb`,
      `path_or_address`, `included = true`, `safe_to_execute = null`, null
      schemas, `x-amvs-source: 'model-endpoint-reconciliation'`) AND the
      SOAP variant (default `post`, `x-amvs-soap` block + `x-amvs-soap-root`
      placeholders, namespace badge); (c) EXCLUDE persists the identity row
      with `included = false` + `exclusion_reason`, and a missing/empty
      reason → 400; (d) included rows are appended to the session's cached
      `oasInventoryStore` inventory; (e) `/start` with a non-empty
      `in_scope_unaccounted_endpoints` and no override → 409
      `code: 'INVENTORY_UNACCOUNTED_ENDPOINTS'` with the count and the
      embedded list capped at 50 + total; (f) `/start` with
      `coverageOverrideJustification` PATCHes
      `coverage_override_justification` /
      `coverage_override_unaccounted_count` / `coverage_override_at` then
      proceeds; (g) the gate fails CLOSED — an AMS reconciliation error →
      502-style failure, never a silent skip; (h) `parse-oas`
      interface-selected branch persists the request's `interfaceIds` to
      `scope_interface_ids_json` via session PATCH.
    - Skip exhaustive mapping-permutation coverage.
  - [x] 2.2 Add the `archModelClient` reconciliation method + mirrored types
    - New method calling the AMS inventory-reconciliation endpoint;
      `CaptureSessionDto`, `PatchCaptureSessionRequest`, `OperationDto`,
      `CreateOperationRequest` gain the new nullable snake_case fields
      (`scope_interface_ids_json`, override trio, `exclusion_reason`).
  - [x] 2.3 Persist scope from `parse-oas` + add the `reconcile-inventory` action
    - `parse-oas` stays the schema-enrichment path unchanged EXCEPT the
      interface-selected branch persists `interfaceIds` to the session's
      `scope_interface_ids_json` (session PATCH).
    - New action `POST /api/capture-sessions/:id/reconcile-inventory`
      following the existing action-route shape (projectId extraction,
      `fail()` envelope): load session → call AMS → return payload verbatim.
  - [x] 2.4 Add the `account-endpoints` bulk action
    - `POST /api/capture-sessions/:id/account-endpoints` with body
      `{ items: [{ endpoint_id, action: 'include' | 'exclude',
      reason?: string }] }` — bulk-capable; `exclude` REQUIRES a non-empty
      `reason` (400 otherwise).
    - Refactor `synthesiseInventoryFromEndpoints` (~line 393) to expose a
      single-endpoint variant; INCLUDE reuses it (operation_id =
      `soap_action` ?? endpoint name ?? `<METHOD>_<path>`; method =
      validated `operation_verb` else `post` for SOAP; path =
      `path_or_address`; summary/description from endpoint
      name/description + SOAP namespace badge; `included = true`;
      `safe_to_execute = null`; null schemas except SOAP `x-amvs-soap-root`
      placeholders; `oas_operation_json` stub with
      `x-amvs-source: 'model-endpoint-reconciliation'` + `x-amvs-soap`
      block). EXCLUDE creates the same identity-mapped row with
      `included = false` + `exclusion_reason`.
    - Append included rows to the cached `oasInventoryStore` inventory so
      scenario generation sees them at `/start`; VERIFY during build that
      scenario generation tolerates schema-less operations (it already
      tolerates `included = null` rows) — fix forward if not.
    - Respond with the created/updated operation rows so the wizard can
      refresh Step 4 without a separate list call.
  - [x] 2.5 Add the `/start` hard block + override
    - After the existing status/secrets/inventory guards, call the AMS
      reconciliation endpoint with `refresh_findings: true` (re-runs
      reconciliation at Start, catching model drift — D8).
    - Non-empty `in_scope_unaccounted_endpoints` + no override → 409
      `code: 'INVENTORY_UNACCOUNTED_ENDPOINTS'` with unaccounted count +
      embedded list capped at 50 entries plus total count.
    - `StartCaptureBody` gains `coverageOverrideJustification?: string`
      (camelCase, matching `includeDiscoveryContext`/`discoveryRunIds`);
      when present and non-empty: PATCH the session's override trio, then
      proceed to start.
    - AMS call error → fail-closed 502-style response with a clear message
      (the deliberately fail-soft discovery-context fetch is unchanged). No
      retroactive gating; null persisted scope = whole-architecture scope.
  - [x] 2.6 Ensure the validation-service tests pass
    - Run ONLY the 2-8 tests written in 2.1.
    - Do NOT run the entire validation-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- Include/exclude both persist accounting as operation rows (exclude =
  `included false` + reason); exclude without reason is rejected.
- `/start` blocks with the exact 409 code + capped list, persists the
  override trio on justified override, and fails closed on AMS error.
- No reconciliation key or comparison logic exists in TypeScript.

### Gateway — Action Proxies

#### Task Group 3: Register the two new action paths
**Dependencies:** Task Group 2

Two list entries in the existing auto-registering action-path loop — no new
proxy code.

- [x] 3.0 Complete the gateway proxy additions
  - [x] 3.1 Write 2-4 focused tests for the action proxies
    - Limit to 2-4 highly focused tests maximum (Jest, following the
      existing `apiMigrationValidation` action-proxy test patterns).
    - Cover ONLY: (a) `reconcile-inventory` proxies through as a plain JSON
      action to the validation service and round-trips the response;
      (b) `account-endpoints` proxies through likewise (no multipart
      handling on either).
  - [x] 3.2 Add `reconcile-inventory` and `account-endpoints` to
        `API_BEHAVIOUR_ACTION_PATHS`
    - In `gateway/src/routes/apiMigrationValidation.ts` — two list entries
      in the existing loop; nothing else.
  - [x] 3.3 Ensure the gateway tests pass
    - Run ONLY the 2-4 tests written in 3.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass.
- Both new actions proxy as plain JSON through the existing loop; no bespoke
  proxy code added.

### Frontend — Wizard Step 4, Override Flow, Detail + Baseline Surfaces

#### Task Group 4: Step 4 reconciliation extension, coverage display, 409 override dialog, override banner, baseline coverage note
**Dependencies:** Task Groups 2, 3

Extend the existing Step 4 inclusion table in
`StartCaptureSessionWizard.tsx` (NOT a new step), following
`StartCaptureSessionWizard.module.css` styling throughout, plus the
`CaptureSessionDetailView` / `BaselinesList` surfaces. No visual assets
exist — follow the named existing conventions.

- [x] 4.0 Complete the frontend surfaces
  - [x] 4.1 Write 2-8 focused tests for the UI
    - Limit to 2-8 highly focused tests maximum (Vitest, API modules
      mocked, alongside the existing wizard/detail-view tests).
    - Cover ONLY: (a) after advancing to Step 4 the wizard calls
      `reconcile-inventory` (selected interface ids, `persist_scope: true`)
      and renders the unmatched-endpoints section from the payload;
      (b) INCLUDE and "Include all" call `account-endpoints` and refresh
      the operations list + reconciliation state from the response, and
      EXCLUDE keeps its submit disabled until a non-empty reason is
      entered; (c) the "Discovery gaps" section lists
      `operations_without_model_endpoint` with the recorded-finding note,
      and the collapsed "Excluded by scope" group renders the bulk reason;
      (d) both coverage figures (selected-scope % and whole-architecture %)
      display from the payload; (e) a 409
      `INVENTORY_UNACCOUNTED_ENDPOINTS` on start renders the remaining
      unaccounted list + justification textarea, "Start anyway (override)"
      stays disabled while the justification is empty, and re-submit passes
      `coverageOverrideJustification`; (f) `CaptureSessionDetailView` shows
      the override banner (justification, unaccounted count, timestamp)
      when `coverage_override_justification` is non-null and nothing when
      null; (g) the baseline surface shows the read-only coverage figure
      (fetched with `refresh_findings: false`) + override note without
      altering the Activate control.
    - Skip exhaustive state and styling coverage.
  - [x] 4.2 Extend `apiBehaviourClient.ts`
    - Typed snake_case wrappers for `reconcile-inventory` and
      `account-endpoints` (copying the `parseOas` action-wrapper
      conventions); session/operation types gain the new nullable fields
      (`scope_interface_ids_json`, override trio, `exclusion_reason`);
      `StartCaptureBody` type gains `coverageOverrideJustification`.
  - [x] 4.3 Wire reconciliation into Step 4 advance
    - In `handleAdvanceToStep4` of `StartCaptureSessionWizard.tsx`, after
      `parse-oas`: call `reconcile-inventory` with the selected interface
      ids and `persist_scope: true`; store the result in Step 4 state.
  - [x] 4.4 Build the Step 4 reconciliation sections
    - Below the existing inclusion table, an "Unmatched committed
      endpoints" section: one row per `in_scope_unaccounted_endpoints`
      entry (name/method/path or SOAP action) with an INCLUDE button, an
      EXCLUDE control requiring a reason, and an "Include all" bulk
      affordance — all via `account-endpoints`, refreshing the operations
      list + reconciliation state from the action response on success.
    - A "Discovery gaps" informational section listing
      `operations_without_model_endpoint` entries with a note that a
      reconciliation finding has been recorded (rendered straight from the
      reconciliation response — no separate findings fetch).
    - A collapsed "Excluded by scope" group showing
      `excluded_by_scope_endpoints` in bulk under the single reason
      "excluded by scope (interface not selected)".
    - Both coverage figures displayed prominently (selected-scope % and
      whole-architecture %), with `StartCaptureSessionWizard.module.css`
      styling throughout.
  - [x] 4.5 Build the 409 override flow on final start submit
    - When `/start` returns 409 `INVENTORY_UNACCOUNTED_ENDPOINTS`: render
      the remaining unaccounted endpoints (embedded capped list + total),
      a justification textarea, and a "Start anyway (override)" re-submit
      passing `coverageOverrideJustification`; empty justification keeps
      the button disabled.
  - [x] 4.6 Surface override + coverage on detail and baseline views
    - `CaptureSessionDetailView.tsx`: override banner (justification,
      unaccounted count at override time, timestamp) when
      `coverage_override_justification` is non-null.
    - `BaselinesList.tsx` / baseline detail: alongside the existing
      Activate action (~line 60), show the coverage figure fetched
      read-only via `reconcile-inventory` with `refresh_findings: false`
      against the baseline's `session_id`, plus the override note when the
      source session carries one — purely informational, Activate
      transition logic untouched (D3).
    - Existing sessions/baselines with all-null new fields render exactly
      as today.
  - [x] 4.7 Ensure the UI tests pass
    - Run ONLY the 2-8 tests written in 4.1.
    - Confirm net-zero NEW `tsc` errors from this group's changes.
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; no new `tsc` errors beyond the
  baseline.
- Step 4 shows unmatched endpoints with one-click include /
  exclude-with-reason / include-all, discovery gaps, the excluded-by-scope
  group, and both coverage figures — nothing silently absent.
- The 409 override flow requires a non-empty justification before "Start
  anyway" enables; the override surfaces on the session detail view.
- Baseline Activate is informational-only; legacy rows render unchanged.

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the tests from each group: AMS calculator/endpoint/findings
      (1.1), validation-service actions + gate (2.1), gateway proxies
      (3.1), frontend surfaces (4.1).
    - Total existing tests: approximately 8-28 across JUnit, Jest, and
      Vitest.
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Priority end-to-end candidates (mocked-service level):
      (a) configure-to-start lifecycle through the validation service —
      reconcile shows unaccounted → include one + exclude one with reason →
      re-reconcile shows them accounted (excluded row still accounted) →
      `/start` passes the gate; (b) the block-then-override path —
      `/start` 409 with the capped list → re-submit with justification →
      override trio persisted → session starts; (c) reverse-direction
      flow — an operation-without-model-endpoint produces exactly one
      session-linked reconciliation finding across repeated reconcile
      calls (idempotence through the real AMS write path) and the wizard
      renders the gap from the response; (d) staleness — a model endpoint
      added between configure and Start is caught by the Start-time
      re-reconciliation (gate blocks despite a clean configure-time pass);
      (e) coverage math agreement — the two percentages match the
      partition counts after a mixed include/exclude/out-of-scope state.
    - Focus ONLY on gaps related to this spec's requirements; do NOT
      assess whole-application coverage.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Fill the identified critical gaps only — integration points and
      end-to-end workflows over unit gaps.
    - Skip edge cases, performance tests, and accessibility tests unless
      business-critical.
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (those from 1.1, 2.1, 3.1, 4.1,
      and 5.3) — expected total approximately 18-38 tests.
    - Do NOT run the entire test suite of any of the four services.
    - Verify the critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass across AMS (JUnit),
  validation-service + gateway (Jest), and frontend (Vitest).
- The reconcile → include/exclude → start-gate → override and the
  reverse-direction-finding workflows are covered end-to-end at the
  mocked-service level.
- No more than 10 additional tests added.
- Testing stays scoped to this spec's feature.

## Execution Order

Recommended implementation sequence (dependency-ordered):

1. **AMS Reconciliation Layer** (Task Group 1) — calculator extraction
   (readiness gate frozen), changesets 178/179, the reconciliation endpoint,
   and idempotent finding emission; defines the wire contract everything
   downstream consumes.
2. **Validation-Service Actions + Start Gate** (Task Group 2) —
   `reconcile-inventory`, `account-endpoints` include/exclude, parse-oas
   scope persistence, fail-closed `/start` block + justified override.
3. **Gateway Proxies** (Task Group 3) — two `API_BEHAVIOUR_ACTION_PATHS`
   entries.
4. **Frontend** (Task Group 4) — Step 4 reconciliation sections, coverage
   display, 409 override dialog, detail-view banner, baseline coverage note.
5. **Test Review & Gap Analysis** (Task Group 5).

## Notes

- **One wire contract, defined once in Group 1:** the reconciliation
  response shape (three lists + two coverage pairs) is consumed verbatim by
  the validation-service action (2.3), the `/start` gate (2.5), and every
  frontend surface (4.3-4.6) — Groups 2-4 must not reshape or re-derive any
  of it; the validation service returns the AMS payload verbatim.
- **Two call sites, one write path:** configure-time (`reconcile-inventory`,
  default `refresh_findings: true`) and Start-time (gate, `refresh_findings:
  true`) both hit the same AMS endpoint; display-only callers (baseline
  coverage figure) pass `refresh_findings: false`. Findings emission lives
  ONLY inside the AMS endpoint.
- **Accounting is operation-row persistence:** the Start gate reads
  persisted operation rows via the same calculator — include AND exclude
  verdicts are both visible to it with zero extra state; never invent a
  separate accounting store.
- **Schema-less tolerance check is load-bearing:** 2.4 explicitly verifies
  scenario generation tolerates the auto-created schema-less operations at
  `/start`; if it does not, fixing it is in scope for this group (no
  deferring).
- **Readiness untouched by design (D6):** overridden sessions keep
  `DISCOVERY_HARNESS_INVENTORY_MISMATCH` visible by construction — do not
  "fix" that during build; it is intended behaviour.
- **`tsx` watch caution (repo rule):** do not edit `discovery-service/src/**`
  while a discovery run is active (this spec should not need to touch it at
  all).
