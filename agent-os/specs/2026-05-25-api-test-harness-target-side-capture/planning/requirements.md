# Spec Requirements: API Test Harness — Target-Side Capture

## Initial Description

See `planning/raw-idea.md` for the full design. Summary: add a target-side capture flow inside the existing `api-migration-validation-service` that replays an existing current-state baseline's accepted items against a new target URL and persists the responses as a paired target baseline. Decisions already settled: replay-only (no LLM loop), same service, 1:1 source-to-target pairing, paired-only (no freestanding target captures), auto-accept on the target side.

## Validated Reuse Inventory

Spot-checks performed against the actual files referenced in the parent's inventory note.

### Reusable wholesale (zero modification needed)

- **`httpExecutor.ts`** (230 LOC) — fully self-contained per-session axios wrapper. Takes `baseURL`, `auth`, `defaultHeaders`, `timeoutMs` in its factory; nothing hardcoded about "current state". `setAuth()` already provided for re-entry. Replay loop instantiates one of these with the target URL + target auth and it just works. **No changes required.**
- **`redactor.ts`** — request/response redaction. Header-name / value redaction policy doesn't care which side it's running against. **No changes required.**
- **`runManager.ts`** (145 LOC) — in-memory live-run map, keyed by `sessionId` only. No notion of "current vs target" anywhere. `start()`, `cancel()`, `end()`, `beginScenario()` all operate kind-agnostically. **No changes required.** (The `scenarioHttpAttempts` counter is irrelevant for replay but harmless.)
- **`secretsStore.ts`** (52 LOC) — in-memory bundle map keyed by `sessionId`. Stores any `SecretsBundle`; no kind discriminator. **No changes required.**
- **`startupReconciliation.ts`** (63 LOC) — scans AMS for `status='running'` sessions on boot, marks them `failed` with `secrets_lost_during_run`. Kind-agnostic — it scans by status, not by kind. Will reconcile both current and target sessions identically. **No changes required.** (Target capture inherits the same post-restart secret-loss UX automatically.)
- **`api_behaviour_baseline_items` schema** (changeset 134) — confirmed via direct read: each row stores `method`, `path`, full `request_json` (headers, query, body), `response_status`, `response_json`. **This is everything needed to deterministically replay against a new URL.** No schema changes required to support the replay input — just the discriminator/pairing additions on the parent baseline + session tables.
- **`runScenarioLoop`** in `captureLoopRunner.ts` — NOT used by replay path. Target replay calls `httpExecutor.request()` directly, not via the LLM tool loop. The 10 LLM tools (`tools/`) are irrelevant to replay.

### Needs minor modification

- **`captureSessionOrchestrator.ts`** — not reused directly. The new `targetReplayRunner.ts` replaces it for target sessions. No edits to the existing orchestrator are required (it stays current-state-only). The dispatch decision ("which runner to invoke") happens in the route handler that fires off the background task — that's where the `kind` discriminator on the session row branches the code path.
- **`archModelClient.ts`** (28 KB) — needs new methods for the kind-filtered baseline/session list endpoints and the new pairing fields. Additive only; no edits to existing methods. Estimated +50-100 LOC.
- **`ApiBehaviourBaselineEntity`** + DTO + repository — needs `kind` (String) and `pairedWithBaselineId` (nullable UUID) fields. Existing repo's two `findBy...` methods stay; one new finder added for kind-filtering. Boxed-type / PATCH-safety check passes (both new fields are nullable references / String — no primitive-numeric/boolean drift risk per `project_primitive_double_dto_overwrite.md`).
- **`ApiBehaviourCaptureSessionEntity`** + DTO + repository — symmetric additions (`kind`, `sourceBaselineId`).

### Genuinely new

1. **`targetReplayRunner.ts`** in `api-migration-validation-service/src/services/` — ~200-300 LOC. Loads source baseline items via `archModelClient`, iterates them, re-sends each via `httpExecutor`, persists `api_behaviour_capture` rows + auto-accepted `api_behaviour_baseline_item` rows on the new target baseline. Emits diagnostics on per-item failures.
2. **2 Liquibase changesets** with **revised numbering**:
   - The raw idea proposed `135-` and `136-`, but those slots are **already taken** by `135-discovery-findings.sql` and `136-discovery-finding-links.sql` (shipped). Highest applied changeset is currently `139-generated-migration-books-of-work.sql`. **New changesets must start at `140-` and `141-`** (or whatever the highest is at implementation time — confirm immediately before writing).
   - `140-api-behaviour-baselines-kind.sql` — adds `kind TEXT NOT NULL DEFAULT 'current'` + `paired_with_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` + partial index.
   - `141-api-behaviour-capture-sessions-kind.sql` — adds `kind TEXT NOT NULL DEFAULT 'current'` + `source_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` + index.
3. **5 new route handlers** on the validation service: `POST /target-capture-sessions`, `POST /:id/test-connection`, `POST /:id/start`, `POST /:id/cancel`, `GET /:id/status`. Mounted in `src/routes/captureSessionActions.ts` or a sibling new file.
4. **Gateway proxy mirrors** in `gateway/src/routes/apiMigrationValidation.ts`.
5. **New entry button** on `ApiBaselinesListPage` ("Capture target behaviour") + a target variant of the existing `StartCaptureSessionWizard`. See open question Q1 for "separate wizard vs. mode flag".
6. **Header / banner tweak** on `BaselineDetailView` to show "Target Baseline (paired with: [source baseline name])" when `kind='target'`.
7. **AMS Java layer additions**: entity field additions, DTO field additions, mapper updates, validation in service layer (target → MUST have source; current → MUST NOT have source), new repository finders (`findByPairedWithBaselineId`, `findByProjectIdAndArchitectureIdAndKind`).

## Constraints Surfaced During Investigation

1. **Changeset numbering revision.** Raw idea says `135-/136-`; actual next free numbers are `140-/141-` (or higher at implementation time). Implementer must verify immediately before writing the changesets via `ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort | tail -5`.

2. **Frontend wizard path correction.** Parent's inventory referenced `frontend/src/components/architecture/StartCaptureSessionWizard.tsx`; the actual path is `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`. Same file, different folder. Inventory has been validated against reality.

3. **Naming collision risk: "Target Baseline".** The phrase "Create Target Baseline" already exists in the codebase as an **unrelated feature** — it's about *copying an architecture* into a new target architecture via `SelectiveCopyWizardModal` with auto-mapping (see `ManageArchitecturesModal.createTargetBaseline.test.tsx`, `SelectiveCopyWizardModal.targetBaseline.test.tsx`). Spec wording / UI labels / route names need to disambiguate. Suggested label: **"Capture target API behaviour"** (verb-first) rather than "Create target baseline" (which would clash). The DB field `paired_with_baseline_id` and `kind='target'` enum value are fine — those don't collide because they live in a different table.

4. **Wizard reuse question is real.** The existing wizard's Step 2 already takes an arbitrary `apiBaseUrl` + auth config — there is no "current state" hardcoding in steps 2-3. What it DOES bake in is Step 1 (OAS pick / file upload), Step 3 (DB sampling), and Step 4 (per-operation include toggle). For a target replay flow, Step 1 collapses to "pick source baseline" and Steps 3-4 disappear entirely. The "mode flag" approach is viable but would noisy-up an already 1,470-LOC component. Recommendation: **forked variant component** (`StartTargetReplayWizard.tsx`) that imports the shared step components from the existing wizard rather than a single `mode='current'|'target'` wizard. See question Q9.

5. **Orchestrator dispatch.** The `/start` route handler must dispatch to the correct runner based on `session.kind`. The existing route (`POST /capture-sessions/:id/start`) calls `orchestrateCaptureSession`. The new route (`POST /target-capture-sessions/:id/start`) calls `runTargetReplay`. Keeping them as two separate routes is cleaner than a single mode-aware route — matches the raw idea.

6. **No pre-existing pairing notion in the schema.** Confirmed via direct read of changeset 133 + entity: no `kind`, `paired_with_baseline_id`, or `parent_baseline_id` columns exist on `api_behaviour_baselines` today. Greenfield additions; no stub to inherit from.

7. **Mutating-call confirmation already on the session row** (`mutating_calls_confirmed BOOLEAN`). Target replay reads this flag from the new target session, not from the source baseline. Source baseline retains its own historical confirmation as part of its `api_behaviour_capture_sessions` row. Replay-time skip-logic just checks the target session's flag.

## First Round Questions (relayed to user)

See below.

### Existing Code to Reference

**Files / patterns to reuse wholesale** (from validated inventory):
- `api-migration-validation-service/src/services/httpExecutor.ts`
- `api-migration-validation-service/src/services/redactor.ts`
- `api-migration-validation-service/src/services/runManager.ts`
- `api-migration-validation-service/src/services/secretsStore.ts`
- `api-migration-validation-service/src/services/startupReconciliation.ts`
- Existing AMS controllers under `architecture-model-service/.../controller/apibehaviour/`
- `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx` (step components for reuse, not full wizard)
- `frontend/src/components/DashboardView/ApiBaselinesListPage.tsx` (entry-point location)
- `frontend/src/components/DashboardView/BaselineDetailView.tsx` (header tweak target)

**Models to mirror**:
- `discovery_run.discovery_kind` (changeset 137) — same pattern as our proposed `api_behaviour_baselines.kind`.
- `ApiBehaviourBaselineEntity` — existing boxed-Integer / PATCH-safety pattern.

## Visual Assets

### Files Provided:
None — code-only spec with no new UI surfaces beyond a button label change and a header tweak. Confirmed via bash check.

### Visual Insights:
N/A.

## Requirements Summary

### Functional Requirements

(Will be confirmed once user answers the questions below; defaults shown.)

- Target capture session lifecycle mirrors current (draft → configured → running → completed/failed/cancelled).
- Replay walks every accepted item in the source baseline; auto-accepts each replay response on the target baseline.
- Per-item failures (timeout, 5xx, network) emit a diagnostic and continue; threshold-based session abort after N consecutive failures (default 10).
- Mutating-call gate honored on the target session; source items with mutating verbs are skipped with `mutating_skipped` diagnostic when the target session has `mutating_calls_confirmed=false`.
- Target baseline detail view shows pairing link back to source baseline.
- Existing baselines / sessions list is kind-filterable.

### Reusability Opportunities (validated above)

See "Validated Reuse Inventory".

### Scope Boundaries

**In Scope:** as in raw-idea.

**Out of Scope:** as in raw-idea — particularly the diff engine (Spec #5), findings integration (Spec #6), LLM-driven target exploration (future), N:M pairing, multi-target parallelism.

### Technical Considerations

- Changesets must start at `140-` (or higher — verify at implementation time); raw idea's `135-/136-` is stale.
- "Target Baseline" naming collides with unrelated architecture-copy feature; UI labels must disambiguate ("Capture target API behaviour" recommended).
- Forked target replay wizard preferred over mode-aware single wizard.
- Two-route dispatch (existing `/capture-sessions/:id/start` and new `/target-capture-sessions/:id/start`) keeps the runners cleanly separated.
- All reused infra (`httpExecutor`, `runManager`, `secretsStore`, `startupReconciliation`, `redactor`) is kind-agnostic and needs zero modification.

## Accepted Answers (2026-05-25)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 Changeset numbering.** Use `140-api-behaviour-baselines-kind.sql` and
  `141-api-behaviour-capture-sessions-kind.sql`. Implementer verifies the
  highest changeset number immediately before writing (slots may have
  shifted by then).
- **Q2 UI label disambiguation.** Entry button on `ApiBaselinesListPage`
  reads **"Capture target API behaviour"**. `BaselineDetailView` header
  reads **"Target-side API capture (paired with: [source baseline name])"**
  when `kind='target'`. Avoids the "Target Baseline" collision with the
  unrelated architecture-copy feature.
- **Q3 Wizard: forked variant.** New `StartTargetReplayWizard.tsx`
  imports shared Step 2 sub-components from the existing
  `StartCaptureSessionWizard.tsx`. No mode flag; no ~25 conditional
  branches through the 1,470-LOC current-state wizard.
- **Q4 Auto-accept + post-hoc reject toggle.** Target captures
  accepted-by-default — no curation step in the wizard. The accept/reject
  toggle is preserved on the target-side review surface (reuses existing
  `CaptureReviewPanel` toggle component) so users can manually reject
  clearly-broken responses after the fact.
- **Q5 Pairing read endpoint timing.** Add
  `GET /api/projects/.../baselines/{sourceId}/target-baselines` in this
  spec. Keeps AMS contract complete; removes one endpoint from Spec #5's
  surface. Frontend in this spec does not call it, but it ships with
  tests.
- **Q6 Continue-on-error threshold.** Continue per-item on HTTP 4xx/5xx
  (those are data the diff engine wants). Abort the session only after
  **10 consecutive transport-level failures** (network, timeout, DNS).
  Configurable via `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT` env var
  (default 10).
- **Q7 Secret-loss recovery UX inheritance.** Target sessions inherit
  the same `secrets_lost_during_run` recovery flow as current sessions
  (clone-config + re-enter secrets). Single behavioural contract.
- **Q8 Route dispatch shape.** Two separate routes — existing
  `POST /capture-sessions/:id/start` (current) and new
  `POST /target-capture-sessions/:id/start` (target). Different payload
  schemas, clearer discriminator-to-route mapping.
- **Q9 Test cap.** 4 frontend tests (source baseline picker, target URL/
  auth validation, progress polling, manual-reject toggle); ~18-22 backend
  + ~4 gateway = ~26-30 tests total.
- **Q10 Commit boundary.** Per-layer in 5 commits:
  1. Liquibase + entity + repo
  2. AMS Java controller + service-layer validation + DTOs
  3. `targetReplayRunner.ts` + new routes + tests
  4. Gateway proxy + typed client wrapper
  5. Frontend wizard + entry button + detail-view banner
- **Q11 PATCH safety.** New fields are `String kind` and nullable
  `UUID pairedWithBaselineId` / `UUID sourceBaselineId` — all reference
  types. No primitive-type drift risk per
  `project_primitive_double_dto_overwrite.md`. Note in the spec's
  PATCH-safety section for the next maintainer.
