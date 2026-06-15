# Specification: API Test Harness — Target-Side Capture

## Goal

Add a target-side capture flow inside the existing `api-migration-validation-service` that replays an existing current-state API Behaviour Baseline's accepted items against a new target service URL and persists the responses as a paired target baseline (`kind='target'`, `paired_with_baseline_id=<source>`). End-to-end the user picks a source baseline, configures target URL + auth, starts a deterministic replay, watches progress, and ends up with a paired target baseline carrying one auto-accepted item per replayed source item — providing the data shape the diff engine in Spec #5 consumes.

## User Stories

- As an Architect validating a target migration build deployed to UAT, I want to replay every accepted current-state capture against the target service URL and persist the responses as a paired target baseline, so that I have matched evidence on both sides for the diff engine to compare without manually rebuilding scenarios.
- As a Test Engineer reviewing a target replay, I want target responses auto-accepted by default but with a manual reject toggle preserved on each item, so that I can flag clearly-broken responses without curating every single capture.
- As an Architect dealing with a flaky UAT environment, I want per-item replay failures to continue capturing data (HTTP 4xx/5xx are still informative for the diff engine) and the session to abort only after 10 consecutive transport-level failures, so that one transient hiccup does not invalidate a run.

## Specific Requirements

**AMS persistence — two Liquibase changesets (additive only)**
- Verify the highest applied changeset immediately before writing (`ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort | tail -5`); raw idea's `135-/136-` slots are already taken by `135-discovery-findings.sql` / `136-discovery-finding-links.sql`. Expected next free slots are `140-` and `141-`.
- `140-api-behaviour-baselines-kind.sql`: `ALTER TABLE api_behaviour_baselines ADD COLUMN kind TEXT NOT NULL DEFAULT 'current'` + `ADD COLUMN paired_with_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` + `CREATE INDEX api_behaviour_baselines_paired_idx ON api_behaviour_baselines(paired_with_baseline_id) WHERE paired_with_baseline_id IS NOT NULL`. Register as a new `changeSet` block in `db.changelog-master.yaml`; never edit prior changesets.
- `141-api-behaviour-capture-sessions-kind.sql`: `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'current'` + `ADD COLUMN source_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` + index on `source_baseline_id`. Existing rows pick up `kind='current'` and `source_baseline_id=NULL` via the column defaults — no separate backfill changeset needed.
- No changes to `api_behaviour_operations`, `api_behaviour_scenarios`, `api_behaviour_captures`, `api_behaviour_baseline_items`, `api_behaviour_diagnostics` — they are kind-neutral and already carry everything the replay loop needs.

**AMS Java layer — entity + DTO + repository extensions**
- `ApiBehaviourBaselineEntity` gains `String kind` and `UUID pairedWithBaselineId` (nullable). `ApiBehaviourCaptureSessionEntity` gains `String kind` and `UUID sourceBaselineId` (nullable).
- DTOs `ApiBehaviourBaselineDto` and `ApiBehaviourCaptureSessionDto` extend with the same fields; preserve existing constructor signatures via delegating constructors (8-arg / 10-arg / 11-arg pattern from `ArchitectureDto`) so existing call sites compile unchanged.
- Service-layer validation (no DB enum): on baseline create/update, target baselines MUST have non-null `pairedWithBaselineId` and current baselines MUST have it null; on session create/update, target sessions MUST have non-null `sourceBaselineId` and current sessions MUST have it null. `kind` must be `current` or `target`.
- New repository finders: `findByPairedWithBaselineId(UUID sourceId)` on the baseline repo, `findByProjectIdAndArchitectureIdAndKind(UUID, UUID, String)` on both baseline and session repos.
- New AMS controller endpoint: `GET /api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines` returning the list of target baselines paired with the source. Ships with controller + service + repository tests in this spec; frontend in this spec does not consume it (the diff UI in Spec #5 will).

**PATCH safety for the new fields**
- New DTO fields are `String kind`, `UUID pairedWithBaselineId`, `UUID sourceBaselineId` — all reference types, no primitive-type drift risk per `project_primitive_double_dto_overwrite.md`.
- No new boxed-numeric or boxed-boolean fields introduced. PATCH handlers null-guard the new fields the same way they null-guard existing nullable references.
- Note this explicitly in the relevant DTO Javadoc so the next maintainer adding fields knows the rule (`Boxed types for any numeric/boolean field that participates in PATCH semantics`).

**New `targetReplayRunner.ts` in `api-migration-validation-service/src/services/`**
- ~200-300 LOC. Loads the source baseline + its accepted `api_behaviour_baseline_items` via `archModelClient.ts`.
- For each source item: rebuilds an HTTP request from the persisted `method` / `path` / `request_json` (headers, query, body); substitutes the target base URL; applies target-side auth from the in-memory `secretsStore` bundle; sends via the existing `httpExecutor.ts` (kind-agnostic — no edits needed).
- Persists the target response as a new `api_behaviour_captures` row tied to the target session, then auto-accepts it by creating an `api_behaviour_baseline_items` row on the new target baseline (manual reject is available post-hoc on the review surface).
- Mutating-call gate honoured: if the source item's method is mutating (`POST|PUT|PATCH|DELETE`) AND the target session has `mutating_calls_confirmed=false`, the item is skipped and a `mutating_skipped` diagnostic is emitted (no HTTP call made).
- Does NOT invoke the LLM tool loop. Does NOT use any of the 10 LLM tools. No scenario regeneration. Replay is fully deterministic.
- On terminal status, marks the session `completed`, finalises the target baseline (`status='active'`), purges the in-memory secrets bundle.

**Consecutive-failure abort policy**
- HTTP 4xx and 5xx responses are NOT failures — the diff engine wants that data. Persist, emit a `replay_non_2xx` diagnostic, continue to the next item.
- Transport-level failures (network error, DNS error, connection refused, timeout) ARE counted as consecutive failures. A successful HTTP response (any status) resets the counter to zero.
- Abort the session with `error_message='target_unreachable'` after **10 consecutive transport-level failures**. Configurable via env var `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT` (default `10`) in `src/config.ts`.

**New routes on `api-migration-validation-service`**
- Mount under the same `/api-migration-validation` router. Keep target routes separate from current routes (per Q8 — different payload schemas, clearer dispatch).
- `POST /target-capture-sessions` — create a target session in `draft` status. Body: `{ projectId, architectureId, sourceBaselineId, targetApiBaseUrl, authType, authConfigRedactedJson, defaultHeadersRedactedJson, mutatingCallsConfirmed }`. Server sets `kind='target'`.
- `POST /target-capture-sessions/:id/test-connection` — same request/response shape as the existing current-state test-api-connection action.
- `POST /target-capture-sessions/:id/start` — moves session to `running`, fires `targetReplayRunner.runTargetReplay(sessionId)` as a background task, returns `{ runId }` immediately.
- `POST /target-capture-sessions/:id/cancel` — cancels the in-flight loop via `runManager.cancel(sessionId)`, marks session `cancelled`, purges secrets.
- `GET /target-capture-sessions/:id/status` — polling endpoint returning `{ status, itemsTotal, itemsCompleted, itemsFailed, itemsSkipped, lastDiagnostic }`.
- Reuses `runManager.ts`, `secretsStore.ts`, `redactor.ts`, `startupReconciliation.ts` unchanged. The `/start` route handler dispatches to `runTargetReplay` (not `orchestrateCaptureSession`).

**Gateway proxy mirrors**
- Add to `gateway/src/routes/apiMigrationValidation.ts` mirroring the existing current-state proxy pattern:
  - `POST /api/v1/api-migration-validation/target-capture-sessions`
  - `POST /api/v1/api-migration-validation/target-capture-sessions/:id/test-connection`
  - `POST /api/v1/api-migration-validation/target-capture-sessions/:id/start`
  - `POST /api/v1/api-migration-validation/target-capture-sessions/:id/cancel`
  - `GET /api/v1/api-migration-validation/target-capture-sessions/:id/status`
- AMS-direct proxy for the new pairing read endpoint: `GET /api/v1/architecture-model/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines` (verbatim forward).
- Typed client wrappers in `gateway/src/services/apiMigrationValidationClient.ts` (or wherever the current-state typed wrappers live) — additive only.

**New `StartTargetReplayWizard.tsx` (forked variant)**
- New file at `frontend/src/components/ApiBehaviour/StartTargetReplayWizard.tsx`. Imports shared Step 2 sub-components (target URL field, auth-type selector, default-headers editor, mutating-confirmation toggle) directly from the existing `StartCaptureSessionWizard.tsx` rather than carrying a `mode` flag through the 1,470-LOC current-state wizard.
- 3 distinct steps: (1) source baseline picker — lists `kind='current', status='active'` baselines for the project + architecture, single-select; (2) target environment config — base URL, auth type, auth config, default headers, mutating-calls confirmation (reuses existing Step 2 sub-components verbatim); (3) confirm — shows source baseline name + item count + target URL + mutating-confirm state, with a single "Start replay" button.
- Progress + review are handled on the existing `CaptureSessionDetailView` and `CaptureReviewPanel` — the wizard does not own those surfaces. After "Start replay" the wizard closes and routes to the session detail page.
- No OAS upload step. No DB sampling step. No per-operation include toggle. The source baseline already encodes the operation/scenario set.

**Entry button on `ApiBaselinesListPage`**
- Label: **"Capture target API behaviour"** (verb-first; avoids the "Target Baseline" name collision with the unrelated architecture-copy feature in `SelectiveCopyWizardModal`).
- Disabled when no `kind='current', status='active'` baseline exists for the project + architecture; tooltip explains "Capture a current-state baseline first".
- On click: opens `StartTargetReplayWizard` pre-bound to the row's `projectId` + `architectureId`.

**`BaselineDetailView` header banner for `kind='target'`**
- When the loaded baseline has `kind='target'`, render a header banner: **"Target-side API capture (paired with: [source baseline name])"** where `[source baseline name]` is fetched via the existing baseline-by-id client and links to the source baseline's detail view.
- Current-state baselines (default) render the existing header unchanged.

**Target review surface — auto-accept with manual reject toggle**
- Reuses `CaptureReviewPanel.tsx` as-is. The accept/reject toggle on each item is preserved; the only difference for target baselines is that items arrive with `accepted=TRUE` (the runner auto-accepts) rather than `FALSE`.
- No bulk "accept all" CTA on the target side (every item is already accepted); the user only interacts here to manually reject items they spot as broken.

**Secret-loss recovery — inherited verbatim**
- Target sessions inherit the existing `startupReconciliation.ts` behaviour: any session that was `running` at process restart (current or target) is marked `failed` with `error_message='secrets_lost_during_run'`. Same "Clone configuration" + "Re-enter secrets and start a new run" UX on the detail view applies to both kinds.
- No new reconciliation code. Confirm with a single AMS test asserting `startupReconciliation` picks up `kind='target'` sessions identically.

## Visual Design

No visual assets were provided in `planning/visuals/` — this is a code-only spec. New UI surfaces are limited to (a) a new entry button on an existing page, (b) a forked wizard that reuses Step 2 sub-components from the existing wizard, and (c) a header banner on an existing detail view. No new design system primitives required.

## Existing Code to Leverage

**`api-migration-validation-service/src/services/httpExecutor.ts`**
- Per-session axios wrapper factory taking `baseURL`, `auth`, `defaultHeaders`, `timeoutMs`. Already kind-agnostic — `setAuth()` available for re-entry. The replay runner instantiates one with the target URL + target auth bundle. **No modification needed.**

**`api-migration-validation-service/src/services/{runManager.ts, secretsStore.ts, redactor.ts, startupReconciliation.ts}`**
- All four are kind-agnostic and key on `sessionId` only. The target replay loop uses them identically to the current-state loop. **No modification needed.** `startupReconciliation` automatically picks up `kind='target'` sessions because it scans by `status='running'`.

**`api-migration-validation-service/src/services/{archModelClient.ts, gatewayClient.ts}`**
- `archModelClient.ts` gets additive methods for the new pairing endpoints and kind-filtered list endpoints (~50-100 LOC). Existing methods untouched.
- `gatewayClient.ts` unchanged — target replay doesn't talk to the LLM provider.

**`api-migration-validation-service/src/services/captureSessionOrchestrator.ts`**
- NOT reused for target sessions. The `targetReplayRunner.ts` replaces it. The orchestrator stays current-state-only. The dispatch happens at the route handler: `/capture-sessions/:id/start` calls `orchestrateCaptureSession`; `/target-capture-sessions/:id/start` calls `runTargetReplay`.

**`frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`**
- The 1,470-LOC current-state wizard is the source of the reusable Step 2 sub-components (target URL field, auth selector, default-headers editor, mutating-confirmation toggle). `StartTargetReplayWizard.tsx` imports those sub-components directly. The wizard shell, Step 1 (OAS pick / upload), Step 3 (DB sampling), Step 4 (per-operation include toggle) are NOT reused — they don't apply to replay.

**`frontend/src/components/ApiBehaviour/{CaptureReviewPanel.tsx, BaselineDetailView.tsx, BaselineDetailPage.tsx, CaptureSessionDetailView.tsx}`**
- All four are reused as-is. The only addition is the kind-conditional header banner on `BaselineDetailView` (paired-with link). The review panel's accept/reject toggle, the detail view's polling cadence, the captured-item rendering — all unchanged.

**`frontend/src/components/DashboardView/ApiBaselinesListPage.tsx`**
- Host for the new "Capture target API behaviour" entry button. Add the button alongside the existing "Capture current behaviour" entry; disabled-state logic checks for a `kind='current', status='active'` baseline via the existing baseline-list client.

**Existing AMS controllers under `architecture-model-service/.../controller/apibehaviour/`**
- Style template for the new pairing-read endpoint. Match the existing route prefix `/api/projects/{projectId}/api-behaviour/...`, the existing DTO response shape, the existing service-layer validation pattern. Per-project / per-architecture scoping is already enforced upstream.

**`gateway/src/routes/apiMigrationValidation.ts`**
- Pattern for the 5 new proxy routes + the 1 new AMS-direct proxy. Reuse the existing `:projectId` / `:architectureId` URL safety properties (missing path param produces a 404 at the Express layer with no fallback resolution).

## Out of Scope

- The diff engine itself — comparing the paired baselines and producing structured drift output lives in Spec #5.
- Discovery Findings integration for diff results — lives in Spec #6.
- LLM-driven target-side scenario regeneration or new-endpoint exploration — deferred to a future spec; v1 is replay-only.
- N:M baseline pairing (one source baseline captured against multiple target environments in a single session).
- Multi-target replay parallelism — v1 replays sequentially within a session.
- Capturing target behaviour without a source baseline — flow is paired-only by design; freestanding target capture uses the existing current-state flow with the target URL.
- Per-operation override of the mutating-call exclusion — session-level toggle only (mirrors the current-state v1 decision).
- Sybase DB adapter support — irrelevant to this spec since replay doesn't touch the DB; the stub stays as-is.
- OAS upload / new OAS parsing work — the source baseline already encodes the operation set.
- Source baseline backfill beyond the `kind='current'` Liquibase column default.
- Any behavioural change to the existing current-state capture flow.
- `@JsonNaming` audit for the new DTOs — follow the existing apibehaviour convention (`@CamelCaseWire` when the consumer is camelCase, per-field `@JsonProperty` otherwise); no sweep in this spec.

## Dependencies

- `2026-05-15-api-behaviour-baseline-capture-service` (shipped) — provides the current-state capture machinery, the 7 AMS tables, the wizard shell, `httpExecutor.ts`, `runManager.ts`, `secretsStore.ts`, `redactor.ts`, `startupReconciliation.ts`, `archModelClient.ts`, `gatewayClient.ts`. This spec extends that surface; without it, nothing here makes sense.
- `2026-05-16-api-behaviour-capture-fixes` (shipped) — fixes that this spec inherits by virtue of reusing the same loop infrastructure.
- `2026-05-25-ams-test-infrastructure-cleanup` (shipped) — `mvn test` works again; this spec adds AMS Java test surface.
- `2026-05-25-ams-dto-json-naming-audit-sweep` (shipped) — `@CamelCaseWire` annotation available for new DTOs whose consumers are camelCase; new apibehaviour DTOs follow the existing per-field `@JsonProperty` convention.

No new functional dependencies introduced.

## Commit Boundary

Per-layer, 5 commits:

1. **Liquibase + entity + repository** — `140-` and `141-` changesets, entity field additions, DTO field additions with delegating constructors, new repository finders (`findByPairedWithBaselineId`, `findByProjectIdAndArchitectureIdAndKind`), entity + repo tests.
2. **AMS Java controller + service-layer validation** — new pairing-read endpoint (`GET .../baselines/{sourceId}/target-baselines`), service-layer validation of the `kind` discriminator and FK-pairing invariants, controller + service tests.
3. **`targetReplayRunner.ts` + new validation-service routes + tests** — the replay loop, the 5 new routes, the consecutive-failure abort policy, the `mutating_skipped` diagnostic path, Jest tests for source-load + per-item replay + persistence + failure-counter + mutating-skip.
4. **Gateway proxy + typed client wrapper** — 5 proxy routes + 1 AMS-direct proxy + typed wrappers, gateway tests.
5. **Frontend wizard + entry button + detail-view banner** — `StartTargetReplayWizard.tsx`, the "Capture target API behaviour" button on `ApiBaselinesListPage`, the `kind='target'` header banner on `BaselineDetailView`, Vitest tests (4 frontend tests per the test cap).
