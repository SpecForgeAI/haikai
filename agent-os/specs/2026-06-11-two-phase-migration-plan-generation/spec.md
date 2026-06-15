# Specification: Two-Phase Migration Delivery Plan Generation (Skeleton → Expand) with Inventory Batching + Template Stamping

## Goal

Split migration delivery plan generation into a phase-1 skeleton (initiative → epic → feature, no stories) and a user-triggered phase-2 per-epic expansion with deterministic inventory batching and template+exception stamping, so every individual LLM call stays comfortably under the Azure OpenAI relay's hard ~300s request cap regardless of inventory size (100+ endpoints/tables).

## User Stories

- As a PM, I want Generate to quickly produce a reviewable plan skeleton so that I can validate the high-level backlog shape before spending tokens (and minutes) on detailed stories.
- As a PM, I want to expand epics into detailed stories on demand (per epic or all at once), with visible per-epic progress and retryable failures, so that a single failure never costs me the rest of the plan.
- As a PM, I want every endpoint/table in the model guaranteed a story (with verified facts) so that the book of work provably covers the full migration inventory.

## Specific Requirements

**Phase 1 — skeleton generation on the existing wizard Generate path**

- Modify `generateMigrationBookOfWork` in `gateway/src/services/migrationBookOfWorkHandler.ts`: when delivery streams are selected, each per-stream call requests ONLY initiative → epic → feature items (titles + one-line descriptions; no stories, no acceptance criteria).
- Add a skeleton-mode section to the per-stream user prompt (extend `buildUserPrompt`) and a corresponding instruction block in `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`; the existing hard constraints (workstream vocabulary, `[decision:<code>]` tags, sequenceOrder) still apply at skeleton granularity.
- Keep the existing per-stream machinery unchanged: `<stream>:<id>` namespacing, `STREAM_SEQUENCE_RANK` ordering, global `sequenceOrder` renumbering, deterministic counts, worst-of `qualityAssessment`, per-item `stream:<name>` tags, one-retry-per-stream, atomic AMS write via the existing create endpoint.
- Per-stream skeleton calls MUST run through the new shared bounded-concurrency pool (not bare `Promise.all`).
- Each epic in the skeleton initialises expansion state `not_expanded` inside `book_of_work_json` (see state-machine requirement); small streams (e.g. `cutover_rollback_decommission`, `reconciliation_reporting`) may be expanded in a single non-batched call — no batching machinery where one call already fits.
- The legacy no-streams-selected combined path is untouched and keeps producing a full single-call plan (back-compat, including the single-call invariant tests).

**Bounded-concurrency LLM pool with first-class env configuration**

- Build a small generic bounded-concurrency pool utility in the gateway (confirmed: none exists today); shared by phase-1 skeleton calls and ALL phase-2 calls (expansion batches, judge passes, bespoke rewrites).
- `MIGRATION_PLAN_LLM_CONCURRENCY` — max in-flight LLM requests, default 4, MUST be tunable down to 1 (fully serial) via env alone, no code change. Behaviour against the internal relay is unknown; this knob is a hard user requirement.
- `MIGRATION_PLAN_EXPANSION_BATCH_SIZE` — inventory items per expansion call, default 12.
- Both knobs are read in `gateway/src/config.ts` via the existing `parseIntEnv` pattern and documented alongside the other gateway env vars.
- ONE pool instance is shared across all epics during "Expand all" — total in-flight requests never exceeds the configured limit regardless of how many epics expand concurrently.

**AMS server-side atomic append/merge endpoint (no Liquibase change)**

- New endpoint `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append` on `GeneratedMigrationBookOfWorkController`, implemented in `GeneratedMigrationBookOfWorkService` as a single `@Transactional` server-side merge into `GeneratedMigrationBookOfWorkEntity.bookOfWorkJson` (the `book_of_work_json` jsonb column).
- Request carries: the epic id being expanded, the story (and any feature) items to append, and the epic's new expansion state; the service merges items + per-epic expansion state into the existing JSON atomically — never a client read-modify-write — so concurrent per-epic appends during "Expand all" cannot lose each other's writes.
- Explicitly NO Liquibase change: no new columns, no new `chk_gmbw_status` values; expansion state rides inside `book_of_work_json` per epic.
- Validation: appended items must reference an existing epic/feature parent in the stored hierarchy; reject (400) appends targeting an unknown epic id or a non-draft book.
- Wire format follows the existing migration-books-of-work DTO conventions (the create path already accepts camelCase keys — match whatever `SaveGeneratedMigrationBookOfWorkRequest`/`GeneratedMigrationBookOfWorkDto` do, per the repo `@CamelCaseWire` rules).
- Gateway proxies this via a new route in `gateway/src/routes/migrationBookOfWork.ts`, reusing its existing error-mapping conventions (AMS errors round-trip status + body).

**Per-epic expansion state machine, persisted in the draft document**

- States: `not_expanded` → `expanding` → `expanded` | `failed` (retryable); stored per epic inside `book_of_work_json` so the draft document is the single source of truth for resume/retry across page reloads.
- Expansion is atomic per epic: stories land via one append call per epic only after that epic's full pipeline (all batches + verification) succeeds; a `failed` epic leaves every other epic's stories intact and re-expands without regenerating the rest.
- Retrying a `failed` epic re-runs only that epic's expansion; an `expanded` epic is not re-expandable (no per-story regeneration in this spec).
- Stale `expanding` state (e.g. gateway restart mid-expansion) must be recoverable — treat as retryable from the UI.

**Phase 2 — gateway expansion orchestration**

- New gateway route(s) in `gateway/src/routes/migrationBookOfWork.ts`: expand one epic, and expand all unexpanded/failed epics for a book; handler logic lives in/alongside `migrationBookOfWorkHandler.ts`.
- Pipeline per inventory-driven epic: fetch real inventory → deterministic partition into batches → per-batch LLM expansion call (template(s) + standard/exceptional classification + bespoke stories for exceptions) → code stamping → referential checks → judge pass per stamped batch → bespoke rewrites for flagged items → single atomic append to AMS.
- Per-batch LLM calls retry once on failure (mirroring the existing one-retry-per-stream convention); a batch failing after retry puts the epic in `failed`.
- Expanded stories must validate against the `GeneratedMigrationBookOfWorkItem` schema and keep the hierarchy rules of `validateBookOfWorkHierarchy` (stories parent to the epic's features/epic; ids namespaced consistently with the `<stream>:<id>` convention).
- Emit `[diag-gateway]` stage-marker logs per epic/batch consistent with the existing `pm_migration_delivery_plan stage=...` convention.
- Non-inventory epics (e.g. cutover, reconciliation) expand via a single LLM call for the whole epic — same state machine, no batching/stamping.

**Deterministic inventory batching from the real AMS model**

- The gateway fetches the authoritative endpoint/table inventory from the AMS architecture model via `gateway/src/services/architectureModelClient.ts` (the same model source the shape-spec stage draws on) — the Migration Discovery Context stays summary-level and is NOT the batching source.
- Partition deterministically (stable ordering, e.g. by id/path) into batches of `MIGRATION_PLAN_EXPANSION_BATCH_SIZE` BEFORE any LLM call — predictive sizing from counts, never reactive timeout discovery.
- Each expansion call is scoped to one batch under the skeleton's existing epic/feature ids; the prompt forbids inventing items outside the supplied batch.
- Coverage check in code: after stamping, every inventory item for the epic must have exactly one story — code cannot drop item 73 of 100.

**Template + exception stamping**

- Per inventory epic, the LLM produces: story template(s) per work type, a standard-vs-exceptional classification of the batch's inventory items, and full bespoke stories ONLY for exceptions.
- The gateway stamps templates across standard items in code, substituting real model facts (method/path, baseline id, data-effect entities/mappings) drawn from the SAME model data the referential checks validate — a passing check guarantees a correct stamp.
- Stamped story = full `MigrationBookOfWorkItem` shape + a SMALL set of templated acceptance criteria per work type (e.g. "Behavioural parity with baseline {id} for {METHOD} {path}"); deep implementation detail stays with the downstream shape-spec stage.
- Every phase-2 item gets a provenance tag distinguishing stamped vs generated (e.g. `provenance:stamped` / `provenance:generated`), alongside the existing `stream:<name>` per-item tag convention.

**Layered verification with hard failure semantics**

- Layer 1 (blocking, deterministic): code-level referential checks on every stamped item — endpoint exists in the model, baseline resolves, data-effect entities/mappings resolve.
- Layer 2 (code overrides): items with attached findings, live conflicts, missing baselines, complex SOAP message schemas, or anything not `ready_for_spec` are ALWAYS routed to the bespoke LLM path regardless of the LLM's classification.
- Layer 3 (LLM judge): one verdict-only judge call per stamped batch reviewing stamped stories against their endpoints' contracts/baselines/findings; model the validator on `gateway/src/services/architectConversation/techStackPrefillResponseValidator.ts` (hand-rolled rules, `{ ok, value | errors }`); flagged items are re-routed to the bespoke path and rewritten individually.
- Failure semantics: judge call failing after one retry → epic `failed` (retryable); a flagged item's bespoke rewrite failing after retry → epic `failed` (retryable). Unverified stamped content NEVER silently lands in the draft.
- Layer 4 is the existing downstream per-story shape-spec stage — unchanged; cite it in code comments as the implementation-correctness safety net, build nothing for it.

**Review workspace phase-2 UI**

- `frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationBookOfWorkReviewWorkspace.tsx`: add an "Expand epic" action per epic row AND an "Expand all epics" bulk control (product rule: never individual-only actions); follow existing workspace styling (`MigrationBookOfWork.module.css`).
- Per-epic expansion-state badge in `MigrationBookOfWorkHierarchyTree.tsx` (not_expanded / expanding / expanded / failed); failed badge offers retry.
- Live progress during expansion (poll the draft — expansion state is in `book_of_work_json` — or update from expand-response payloads); state survives page reload because it persists in the draft.
- Save-to-backlog on a partially expanded draft is ALLOWED: `MigrationBookOfWorkSaveToBacklogDialog.tsx` shows a NON-BLOCKING warning when the selection includes an unexpanded epic.
- New functions in `frontend/src/api/migrationDeliveryPlanApi.ts` for expand-epic / expand-all, following its existing request/response typing conventions.

**Wizard, progress, and draft-list UI updates**

- `MigrationDeliveryPlanWizard.tsx` Generate step: one-line note that detailed stories are expanded later in the review workspace.
- `MigrationDeliveryPlanProgressSummary.tsx` ProgressOverlay: copy updated for skeleton generation (faster, no stories yet).
- `MigrationDeliveryPlanProgressSummary.tsx` DraftSummary: show skeleton counts + an "X of Y epics expanded" line derived from per-epic expansion state.
- `MigrationBookOfWorkDraftListView.tsx`: aggregate expansion indicator per draft row (e.g. "3/7 epics expanded").

## Visual Design

No visual assets provided (`planning/visuals/` is empty).

- Follow the existing review-workspace styling (`MigrationBookOfWorkReviewWorkspace.tsx` + `MigrationBookOfWork.module.css`) for all new controls, badges, indicators, and the partial-save warning.

## Existing Code to Leverage

**`gateway/src/services/migrationBookOfWorkHandler.ts` — per-stream split + deterministic assembly (2026-06-11, uncommitted)**
- Already implements per-stream LLM calls, `buildUserPrompt` stream scoping, `<stream>:<id>` namespacing, `STREAM_SEQUENCE_RANK`, deterministic counts/worst-of quality, one-retry, atomic AMS write.
- This spec modifies its per-stream prompt to skeleton scope and routes its calls through the new concurrency pool; phase-2 orchestration extends this module rather than building parallel machinery.

**`gateway/src/services/generatedMigrationBookOfWorkSchema.ts` + `gateway/src/routes/migrationBookOfWork.ts`**
- `MigrationBookOfWorkItem`, `validateMigrationBookOfWork`, `validateBookOfWorkHierarchy` (orphans/cycles/level-jumps/duplicate ids) — reuse for validating expanded stories and the post-append hierarchy.
- Route file's error mapping (422 token overflow / 502 schema / 500 generic / AMS round-trip) is the convention for the new expand and append-proxy routes.

**AMS `GeneratedMigrationBookOfWorkController` / `GeneratedMigrationBookOfWorkService` / `GeneratedMigrationBookOfWorkEntity`**
- Controller already mounts `/api/projects/{projectId}/migration-books-of-work` with create/get/list/update/save-to-backlog/repair-orphan; add the `items/append` endpoint here.
- Service's existing `@Transactional` patterns and the entity's `book_of_work_json` jsonb column are the persistence surface — expansion state merges into that JSON; no DDL.

**`gateway/src/services/architectConversation/techStackPrefillResponseValidator.ts`**
- The validated-LLM-pass precedent: hand-rolled per-rule checks, `{ ok, value | errors }` shape, no schema library — model the judge-pass response validator (and the expansion-response validator) on it.

**`gateway/src/services/architectureModelClient.ts` + frontend MigrationDeliveryPlan components**
- `architectureModelClient` is the authoritative model-inventory source for batching/stamping (e.g. the `getElementsInventory` pattern for fetching element inventories per architecture).
- Frontend: `MigrationDeliveryPlanWizard.tsx`, `MigrationBookOfWorkReviewWorkspace.tsx`, `MigrationBookOfWorkHierarchyTree.tsx`, `MigrationBookOfWorkSaveToBacklogDialog.tsx`, `MigrationBookOfWorkDraftListView.tsx`, `MigrationDeliveryPlanProgressSummary.tsx`, and `frontend/src/api/migrationDeliveryPlanApi.ts` are the exact surfaces to extend.

## Out of Scope

- The downstream per-story shape-spec generation stage — unchanged (it remains verification layer 4 by existing behaviour).
- Jira upload — unchanged.
- The legacy no-streams-selected combined path — must keep producing a full plan in one call exactly as today (back-compat).
- Per-story regeneration UI beyond the existing item drawer (`MigrationBookOfWorkItemDrawer.tsx`).
- Any AMS schema (Liquibase) change — no new columns, no new `chk_gmbw_status` values.
- Re-expanding an already-`expanded` epic.
- Token streaming or server-sent progress events — progress stays draft-state-driven, consistent with the existing scripted-stage approach.
- Changes to `migrationDiscoveryContextClient` / the Migration Discovery Context shape (it stays summary-level).
- A general-purpose gateway job/queue framework — the concurrency pool is a small purpose-built utility.
- Raising or working around the Azure relay ~300s cap itself — the design assumes it as a hard constraint.
