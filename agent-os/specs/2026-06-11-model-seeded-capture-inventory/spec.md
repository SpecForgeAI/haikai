# Specification: Model-Seeded Capture Inventory — Guaranteed Operation-Capture Completeness

## Goal

Make the committed architecture-model endpoint set the enumerator-of-record for capture sessions: after the existing `parse-oas` enrichment path runs, every in-scope committed endpoint must be reconciled into an operation row or an explicit exclusion-with-reason, with a hard block at session Start (override requires a persisted justification) and auto-emitted discovery findings for operations the model doesn't know about.

## User Stories

- As a migration engineer, I want the capture wizard to show me every committed endpoint my session's operations DON'T cover, so a stale or partial OAS/WADL file can never silently punch holes in the behavioural baseline.
- As a migration engineer, I want session Start blocked while in-scope endpoints are unaccounted — with a one-click include, an exclude-with-reason, or an explicit justified override — so baseline completeness is a code guarantee, not a convention.
- As an architect, I want operations the harness knows but the model doesn't to surface as reconciliation findings linked to the session, so discovery gaps become visible work items instead of silent drift.

## Specific Requirements

**Extract the reconciliation computation into a shared AMS component (no behaviour change to readiness)**
- Extract `computeInventoryReconciliation`, `endpointKey`, `operationKey`, `soapDiscriminator`, and `isSoapEndpoint` from `MigrationDiscoveryContextService.java` (~lines 1341–1434) into a new static calculator class in the same `service/migration` package (e.g. `InventoryReconciliationCalculator`).
- The calculator returns a DETAILED result: endpoints-without-operation (full endpoint refs), operations-without-endpoint (full operation refs), and matched counts — not just the two integers today's `InventoryReconciliation` record carries.
- Identity keys are unchanged and remain the single source of truth: REST → `<METHOD> <path>` (trimmed, method upper-cased); SOAP → `soap::<soap_action|request_root_element>` from `protocol_metadata_json`, falling back to `soap::<endpoint id>`; harness operations always key on `<METHOD> <path>`.
- `MigrationDiscoveryContextService` coverage gate C delegates to the calculator and derives its existing `discoveredNotCaptured`/`capturedNotDiscovered` counts from the detailed result; `DISCOVERY_HARNESS_INVENTORY_MISMATCH` behaviour and all existing readiness tests stay green.
- NO TypeScript reimplementation of the key or the comparison anywhere.

**New AMS reconciliation endpoint**
- `POST /api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}/inventory-reconciliation`, implemented as a new controller in `controller/apibehaviour` following `ApiBehaviourCaptureSessionController` conventions; AMS loads the session row, the architecture's endpoints (via the model-file lookup `resolveModelFileId` + `endpointRepository.findByModelFileId`, as gate C does), and the session's operation rows from its own repositories.
- Request body (snake_case): `{ "scope_interface_ids": string[] | null, "persist_scope": boolean, "refresh_findings": boolean }`. When `scope_interface_ids` is omitted/null, fall back to the session's persisted `scope_interface_ids_json`; when that is also null (ad-hoc upload sessions, legacy sessions), the WHOLE architecture's endpoint set is in scope — nothing silently absent.
- In-scope partition: endpoints whose `interface_id` is in the scope set; all other endpoints are "excluded by scope". An endpoint is ACCOUNTED iff its reconciliation key matches at least one of the session's operation rows, regardless of the row's `included` value (an excluded-with-reason row counts as accounted).
- Response (snake_case, AMS global default — consumers are the validation service's snake_case-typed client and the frontend; NO `@CamelCaseWire`): `in_scope_unaccounted_endpoints[]` (`endpoint_id`, `interface_id`, `key`, `name`, `method`, `path`, `protocol`, `soap_action`, `request_root_element`), `operations_without_model_endpoint[]` (`operation_row_id`, `operation_id`, `method`, `path`, `key`), `excluded_by_scope_endpoints[]` (`endpoint_id`, `interface_id`, `key`, `name`), plus counts and coverage.
- Coverage computation: `in_scope_coverage_pct` = accounted in-scope endpoints / total in-scope endpoints × 100; `architecture_coverage_pct` = accounted endpoints across ALL architecture endpoints / total architecture endpoints × 100 (excluded-by-scope endpoints lower the whole-architecture figure by design, per D7). Return both percentages and their numerator/denominator counts; empty denominators return 100.
- When `persist_scope` is true and `scope_interface_ids` was provided, write it to the session row's `scope_interface_ids_json`.
- When `refresh_findings` is true (the default), the endpoint refreshes session-linked reconciliation findings as a side effect (see the findings requirement); display-only callers pass `false`.

**New Liquibase changesets (latest applied is 177 — NEVER edit applied changesets)**
- Changeset 178: `api_behaviour_capture_sessions` gains nullable `scope_interface_ids_json JSONB`, `coverage_override_justification TEXT`, `coverage_override_unaccounted_count INTEGER`, `coverage_override_at TIMESTAMPTZ`; `api_behaviour_operations` gains nullable `exclusion_reason TEXT`.
- Changeset 179: `discovery_findings` gains nullable `api_behaviour_capture_session_id UUID` FK → `api_behaviour_capture_sessions(id) ON DELETE CASCADE` with a partial index, and the existing `discovery_finding_exactly_one_origin` CHECK is DROPPED and re-ADDED as a three-way exactly-one-of constraint over `run_id` / `api_behaviour_diff_id` / `api_behaviour_capture_session_id` — directly following the changeset-160 second-origin precedent.
- All new DTO fields are boxed/nullable end-to-end (Java `Integer`, never `int`) so PATCH semantics never wipe them; mirror the fields into the AMS session entity/DTO, `archModelClient.ts` (`CaptureSessionDto`, `PatchCaptureSessionRequest`, `OperationDto`, `CreateOperationRequest`), and the frontend `apiBehaviourClient.ts` types.

**Validation-service reconcile action (configure-time UX) + scope persistence in parse-oas**
- `parse-oas` stays the schema-enrichment path unchanged, EXCEPT the interface-selected branch now persists the request's `interfaceIds` to the session's `scope_interface_ids_json` (via session PATCH) so Start-time reconciliation knows the scope.
- New action `POST /api/capture-sessions/:id/reconcile-inventory` in `captureSessionActions.ts`, following the existing action-route shape (projectId extraction, `fail()` envelope): loads the session, calls the new AMS reconciliation endpoint via a new `archModelClient` method, and returns the AMS payload verbatim.
- Gateway: add `reconcile-inventory` and `account-endpoints` to `API_BEHAVIOUR_ACTION_PATHS` in `gateway/src/routes/apiMigrationValidation.ts` (plain JSON actions, no multipart handling).
- Frontend `apiBehaviourClient.ts` gains matching typed wrappers.

**One-click INCLUDE / EXCLUDE-WITH-REASON action**
- New action `POST /api/capture-sessions/:id/account-endpoints` with body `{ items: [{ endpoint_id, action: 'include' | 'exclude', reason?: string }] }` — bulk-capable so "Include all" is one round trip; `exclude` REQUIRES a non-empty `reason` (400 otherwise).
- INCLUDE auto-creates a schema-less operation row from the endpoint's metadata by reusing the existing `synthesiseInventoryFromEndpoints` mapping in `captureSessionActions.ts` (refactored to expose a single-endpoint variant): `operation_id` = `soap_action` ?? endpoint name ?? `<METHOD>_<path>`; `method` = validated `operation_verb` (else `post` for SOAP); `path` = `path_or_address`; `summary`/`description` from endpoint name/description (+ namespace badge for SOAP); `included = true`; `safe_to_execute = null`; null schemas except the SOAP `x-amvs-soap-root` placeholder objects; `oas_operation_json` stub with `x-amvs-source: 'model-endpoint-reconciliation'` and the `x-amvs-soap` block.
- EXCLUDE creates the same identity-mapped operation row with `included = false` and `exclusion_reason` set — persistence IS the accounting record, so the Start-time gate (which reads persisted operation rows) sees both verdicts without extra state.
- Included rows are also appended to the session's cached `oasInventoryStore` inventory so the orchestrator's scenario generation sees them at `/start`; verify during build that scenario generation tolerates schema-less operations (it already tolerates `included=null` rows).
- The action responds with the created/updated operation rows so the wizard can refresh its Step 4 table without a separate list call.

**Hard-block at `/start` with justified override**
- The `/start` handler in `captureSessionActions.ts`, after the existing status/secrets/inventory guards, calls the AMS reconciliation endpoint (`refresh_findings: true`) — this RE-RUNS reconciliation at Start, catching model drift since configure (D8).
- If `in_scope_unaccounted_endpoints` is non-empty and no override is supplied: respond 409 with `code: 'INVENTORY_UNACCOUNTED_ENDPOINTS'`, the unaccounted count, and the unaccounted list (cap the embedded list at 50 entries plus total count) so the wizard can render the gap without a second call.
- Override: `StartCaptureBody` gains `coverageOverrideJustification?: string` (camelCase, matching the existing `includeDiscoveryContext`/`discoveryRunIds` body fields). When present and non-empty, the handler PATCHes the session with `coverage_override_justification`, `coverage_override_unaccounted_count` (the count at override time), and `coverage_override_at`, then proceeds to start.
- The gate FAILS CLOSED: if the AMS reconciliation call itself errors, `/start` returns a 502-style failure with a clear message rather than silently skipping the gate (unlike the deliberately fail-soft discovery-context fetch, which is unchanged).
- No retroactive gating: completed/active sessions and existing baselines are never touched; any session started after this ships goes through the gate, with null persisted scope meaning whole-architecture scope.

**Auto-emitted reconciliation findings (operation-without-model-endpoint)**
- Emission lives INSIDE the AMS reconciliation endpoint (single write path serving both configure-time and Start-time calls): when `refresh_findings` is true, delete all prior findings with this session's `api_behaviour_capture_session_id`, then emit one finding per operation-without-model-endpoint — the delete-before-emit idempotence is load-bearing exactly as in the diffRunner precedent (reconciliation re-runs must never accumulate duplicates).
- Finding shape: origin `api_behaviour_capture_session_id` = session id (`run_id` and `api_behaviour_diff_id` null, satisfying the three-way CHECK); `category: 'reconciliation'`; `finding_type: 'operation_without_model_endpoint'`; `severity: 'medium'`; `status: 'new'`; `source: 'capture_inventory_reconciliation'`; title/summary carrying the operation's method + path (or SOAP key); `detail_json` with the operation row id, `operation_id`, and reconciliation key.
- Per-finding emission failures are fail-soft (log + skip, mirroring diffRunner); the reconciliation response is never failed by an emission error.
- The wizard renders the discovery-gap list directly from the reconciliation response (no separate findings fetch); findings surface everywhere discovery findings already display.

**Wizard Step 4 extension (extend the existing inclusion table — NOT a new step)**
- After `parse-oas` in `handleAdvanceToStep4` of `StartCaptureSessionWizard.tsx`, call `reconcile-inventory` (passing the selected interface ids, `persist_scope: true`) and store the result in Step 4 state.
- Below the existing parsed-operations inclusion table, add an "Unmatched committed endpoints" section: one row per `in_scope_unaccounted_endpoints` entry showing name/method/path (or SOAP action) with an INCLUDE button and an EXCLUDE control that requires a reason; both call `account-endpoints` and refresh the operations list + reconciliation state on success; provide "Include all" bulk affordance.
- Add a "Discovery gaps" informational section listing `operations_without_model_endpoint` entries with a note that a reconciliation finding has been recorded.
- Add a collapsed "Excluded by scope" group showing `excluded_by_scope_endpoints` in bulk under the single reason "excluded by scope (interface not selected)" — visible, never silently absent.
- Display both coverage figures prominently: selected-scope coverage % and whole-architecture coverage %.
- On the final start submit, when `/start` returns 409 `INVENTORY_UNACCOUNTED_ENDPOINTS`, render the remaining unaccounted endpoints plus a justification textarea and a "Start anyway (override)" re-submit that passes `coverageOverrideJustification`; an empty justification keeps the button disabled.
- Follow existing `StartCaptureSessionWizard.module.css` styling throughout.

**Override + coverage surfacing on session detail and baseline (Activate informs, never re-blocks)**
- `CaptureSessionDetailView.tsx`: when `coverage_override_justification` is non-null, show an override banner with the justification, the unaccounted count at override time, and the timestamp.
- `BaselinesList.tsx` / baseline detail: alongside the existing Activate action, show the coverage figure (fetched read-only via `reconcile-inventory` with `refresh_findings: false` against the baseline's `session_id`) and the override note when the source session carries one; purely informational — the Activate transition logic is untouched (D3).
- Existing sessions/baselines render normally with all new fields null (no migration, no retroactive checks).

**Testing across all four stacks**
- AMS: JUnit tests for the extracted calculator's detailed result (REST + SOAP keys, fallbacks, both directions), the new controller (scope partition, null-scope whole-architecture fallback, coverage math, persist-scope, findings delete-then-emit idempotence, three-way origin CHECK), and unchanged readiness-gate counts.
- Validation service: Jest tests for `reconcile-inventory`, `account-endpoints` (include mapping incl. SOAP block, exclude-requires-reason, inventory-cache append), and the `/start` gate (block, override persistence, fail-closed on AMS error) following `captureSessionActions.test.ts` patterns.
- Gateway: action-proxy tests for the two new action paths.
- Frontend: Vitest for the Step 4 sections, the 409-override flow, the detail-view banner, and the baseline coverage display.

## Visual Design

No visual assets provided (`planning/visuals/` is empty). Follow the existing capture-wizard styling (`StartCaptureSessionWizard.tsx` / `StartCaptureSessionWizard.module.css`) for the Step 4 extensions, and `CaptureSessionDetailView` / `BaselinesList` conventions for the override and coverage surfaces.

## Existing Code to Leverage

**`MigrationDiscoveryContextService.computeInventoryReconciliation` + key helpers (AMS, ~lines 1341–1434)**
- The SOAP-aware identity key and both-directions comparison already used by readiness coverage gate C.
- Extract into the shared calculator; the new reconciliation endpoint and the readiness gate both call it — single source of truth, never duplicated in TypeScript.
- Reuse the adjacent `resolveModelFileId` + `endpointRepository.findByModelFileId` pattern for loading the architecture's endpoint set.

**`captureSessionActions.ts` action plumbing + `synthesiseInventoryFromEndpoints` (validation service)**
- The action-route shape (projectId extraction, `fail()` envelope, `oasInventoryStore`, `archModelClient`) is the template for `reconcile-inventory` and `account-endpoints`.
- `synthesiseInventoryFromEndpoints` (~line 393) already maps endpoint rows → operation rows including the seven-field SOAP metadata block and placeholder schemas; the one-click INCLUDE reuses this mapping rather than reinventing it.
- The `/start` handler's guard chain and 409 `code` conventions are the extension point for the hard block.

**diffRunner finding emission + changeset 160 origin pattern**
- `diffRunner.ts` (~lines 442–518) demonstrates delete-before-emit idempotence, fail-soft per-finding emission, and the finding field vocabulary (`source`, `created_by_stage`, `detail_json`).
- `160-discovery-findings-api-behaviour-diff-origin.sql` is the exact template for adding the third origin column, partial index, and the exactly-one-of-origin CHECK replacement.

**`StartCaptureSessionWizard.tsx` Step 4 + `apiBehaviourClient.ts`**
- The Step 4 inclusion table, `operationIncluded` state, and the post-`parse-oas` `listOperations` refresh flow are extended in place; the existing skipped-interface prepopulation hint shows where reconciliation messaging belongs.
- `apiBehaviourClient.ts` already types the session/operation snake_case wire and the action wrappers (`parseOas`, etc.) to copy for the two new actions.

**Gateway action proxies + display surfaces**
- `gateway/src/routes/apiMigrationValidation.ts` `API_BEHAVIOUR_ACTION_PATHS` loop auto-registers new JSON actions — two list entries, no new proxy code.
- `CaptureSessionDetailView.tsx` and `BaselinesList.tsx` (Activate transition at ~line 60) are the established surfaces for the override banner and the coverage figure.

## Out of Scope

- Replacing `parse-oas` / `extract-endpoints` as the schema-enrichment paths — they stay; reconciliation runs after them.
- Any behavioural change to the advisory readiness gate `DISCOVERY_HARNESS_INVENTORY_MISMATCH` (refactor-only delegation to the shared calculator).
- Re-blocking or gating at baseline Activate (it informs only).
- Retroactive gating, backfill, or migration of existing sessions/baselines.
- A discovery re-scan trigger from the reconciliation finding (finding + wizard display is the surface; re-scan stays a user action).
- Schema inference or LLM enrichment for auto-created operation rows (they stay schema-less beyond the existing SOAP root-element placeholders).
- Sub-interface (per-endpoint) scope selection UI — per-interface selection remains the scope mechanism.
- Any TypeScript reimplementation of the reconciliation key or comparison.
- Editing any applied Liquibase changeset (≤ 177).
- Changes to the target-replay session flow (`targetCaptureSessionActions.ts`) — target sessions inherit their inventory from the source baseline.
