# Specification: Product Manager Migration Delivery Plan + Draft Book-of-Work Generation

## Goal
Add a Product Manager task `product-manager--migration-delivery-plan` that consumes Migration Discovery Context plus related current/target architecture inputs and produces a hierarchical draft book of work (Initiatives → Epics → Features → Stories) with per-item confidence, readiness, traceability, and quality assessment — saved as a reviewable draft artifact that can be selectively pushed into the existing WorkItem backlog. This spec covers draft generation + the review workspace only; per-story shape-spec generation is a future Spec 2.

## User Stories
- As a Product Manager preparing a like-for-like migration, I want to launch a guided workflow that loads all available migration context and generates a hierarchical book of work so I can move from discovery to a planning-grade backlog without hand-authoring every item.
- As a reviewer of the generated draft, I want to see per-item confidence, readiness, traceability, and gap explanations so I can decide which items are ready to push to the backlog now and which need more focused refinement before Spec 2.
- As a delivery lead, I want to selectively save all/selected/high-confidence/ready-for-spec items into the existing WorkItem hierarchy with idempotent retries and no destructive overwrite of curated tags, so partial saves are safe and resumable.

## Specific Requirements

**Gateway task config (Q-11, Q-12, Q-17)**
- New task config `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`, key-for-key matching the shape of `product-manager--backlog.json`.
- `personaId = "product-manager"`, `mode = "discovery"` (guided workflow), `menuLabel = "Create Migration Delivery Plan"`.
- `contextNeeds` array MUST include the migration-discovery-context resolver alongside any pre-existing PM-task entries (e.g. `mission`); spec-writer / implementer matches the exact resolver identifier used in `gateway/src/services/contextResolvers.ts` and the `migrationDiscoveryContextClient.ts` wrapper.
- `responseFormat` references the `GeneratedMigrationBookOfWork` structured response (full hierarchy + per-item metadata + quality assessment + generation summary); see "Structured response contract" below.
- `persistence` scope is keyed by `(projectId, currentArchitectureId, targetArchitectureId)` so regenerate-on-same-tuple semantics are honoured (Q-6).
- Auth / role gating is taken verbatim from `product-manager--backlog.json` (Q-17) — no new role, permission flag, or gating layer.
- `availableFrom` mirrors the existing PM tasks so the entry surfaces in the same menus.

**Gateway prompt (Q-13)**
- New markdown task prompt under `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md` (filename matches the existing PM-task convention; spec-writer confirmed PM prompts live in `config/prompts/` as `*.task.md`, not `*.prompt.ts`).
- Prompt rules, restated verbatim from raw-idea + shaping-notes, each as a numbered hard constraint:
  1. Functional equivalence is **mandatory** — never ask the user, never propose a non-equivalent target.
  2. Generate a **book of work**, not a migration plan document.
  3. Use only the provided evidence; **do not invent** contracts, mappings, or data details.
  4. Where detail is missing, create **prerequisite / refinement stories** and mark readiness accordingly (`needs_focused_context`, `needs_user_decision`, or `blocked`).
  5. Order work to respect **practical delivery dependencies** via `sequenceOrder`.
  6. Generate migration test pack work as **backlog items**, not as immediate test artifacts.
  7. Include `traceabilitySummary` + `confidence` + `readiness` on every item.
  8. Workstream `unknown` is used **only** when no other workstream applies — never as a guess or hedge (Q-7).

**Gateway orchestration (Q-1, Q-15)**
- Gateway is the sole orchestrator. Sequence:
  1. Resolve context (Migration Discovery Context resolver via existing `contextResolvers.ts` + `migrationDiscoveryContextClient.ts`).
  2. Apply token-budget cap and truncation cascade (see below).
  3. Make a **single synchronous LLM call**; no token streaming.
  4. Validate the structured response against the `GeneratedMigrationBookOfWork` schema.
  5. POST the validated JSON to AMS at `POST /api/projects/{projectId}/migration-books-of-work`.
  6. Return `{ draftId, summary }` to the frontend.
- The optional AMS `/generate` endpoint listed in the raw idea is **dropped** (Q-1). AMS persists only.
- Persistence path is **gateway → AMS direct REST** (Q-3); MCP-server is not in the loop unless inspection of existing PM-task save flows reveals an MCP routing pattern already in use, in which case match that to avoid drift.
- Frontend "generation progress" is a scripted client-side stage indicator driven by the gateway request lifecycle (Q-15): `Loading context… → Calling generator… → Validating schema… → Saving draft…`.

**Token cap helper (Q-4)**
- Reuse the Phase 2 token-capping helper (spec-writer locates the exact module during implementation; pattern mirrored from `2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2`).
- Soft cap **~120k tokens** for assembled context.
- Truncation cascade (applied in order, only as needed):
  1. Drop oldest discovery evidence bodies first (IDs always retained).
  2. Compress API Behaviour Baseline details to summaries.
  3. Compress mapping rationale text.
- **Always retained, never truncated**: Product Definition, Current Architecture entity list, Target Architecture entity list, all current-to-target mappings, all Discovery Finding IDs.
- If still over budget after the cascade, **fail loudly** with an error naming what overflowed. Never silently truncate an always-retained item.

**Structured response contract — `GeneratedMigrationBookOfWork`**
- Top-level fields: `title`, `summary`, `generationSummary` (counts + coverage stats), `qualityAssessment` (whole-book + per-level rubric scores + rationale), `bookOfWork` (the hierarchy as a flat array with `parentId` references).
- Each `MigrationBookOfWorkItem` carries: `id` (temp), `type ∈ initiative|epic|feature|story`, `parentId|null`, `title`, `description`, `acceptanceCriteria[]`, `workstream` (14-value enum per Q-7), `sequenceOrder`, `tags[]`, `confidence ∈ high|medium|low`, `readiness ∈ ready_for_spec|needs_focused_context|needs_user_decision|blocked`, `readinessReasons[]`, `missingInputs[]`, `recommendedNextAction`, `traceabilitySummary`.
- Lightweight reference arrays (IDs only): `evidenceReferences[]`, `architectureReferences[]`, `apiBaselineReferences[]`, `discoveryFindingReferences[]`, `mappingReferences[]`, `sourceContextRefs[]`.
- `saveState ∈ draft|selected|excluded|saved|failed` — frontend-state only during review per Q-16, persisted to `book_of_work_json` only on explicit Save Draft or save-to-backlog.
- Hierarchy validation: a malformed hierarchy (orphaned `parentId`, wrong child type, type cycle) MUST be rejected at gateway validation time before any AMS write.

**Workstream vocabulary (Q-7)**
- 14 values total: the 13 from raw-idea — `target_service_api_implementation`, `target_frontend_implementation`, `target_database_schema_implementation`, `target_infrastructure_environment_implementation`, `data_migration`, `api_soap_integration_compatibility`, `migration_test_pack`, `reconciliation_reporting`, `cutover_rollback_decommission`, `architecture_refinement`, `discovery_gap_resolution`, `test_strategy`, `other` — plus `unknown` as a sentinel.
- Prompt restricts `unknown` usage; review-workspace filter surfaces it so reviewers can find and reclassify those items.

**AMS entity + table (Q-14)**
- New JPA entity `GeneratedMigrationBookOfWorkEntity` mapped to a new table `generated_migration_books_of_work`.
- Columns: `id` (UUID PK), `project_id`, `current_architecture_id`, `target_architecture_id`, `status` (text, enum-constrained), `title`, `summary`, four sibling JSONB columns (all nullable, all `JsonType`-mapped per `project_jira_sync_dynamic_mapping`/`fix-hibernate-jsonb-mapping` precedent): `generation_inputs_json`, `generation_summary_json`, `quality_assessment_json`, `book_of_work_json`. Audit columns: `created_at`, `updated_at`, `created_by_task` (default `'product-manager--migration-delivery-plan'`), `saved_to_backlog_at` (nullable), `error_message` (nullable).
- `status` constrained to `draft | reviewed | partially_saved | saved | archived | failed`.
- Repository / service / controller / mapper trio modelled on the `DiscoveryRunController` / `DiscoveryRunEntity` / `DiscoveryRunService` trio (closest project-scoped artifact precedent).

**AMS Liquibase changesets**
- New changeset id `139-generated-migration-books-of-work` (next free slot after the SOAP Phase 1 changeset `138`) creates `generated_migration_books_of_work` with all columns and indexes (`(project_id, current_architecture_id, target_architecture_id, status)`).
- Per `feedback_liquibase_immutable_changesets.md`: NEVER edit applied changesets; only add new ones.
- **WorkItemType audit (Q-2)**: spec-writer / implementer inspects `WorkItemEntity` — the `type` column is currently a free-text string. Confirm whether existing rows already use `'initiative' | 'epic' | 'feature' | 'story'` casing. If yes, save-to-backlog is a direct 1:1 string mapping. If a constrained enum is later introduced and is missing values, extend via a sibling NEW changeset (`140-work-item-type-extension` or similar) within this spec. No runtime mapping table is introduced either way.

**AMS endpoints**
- `POST /api/projects/{projectId}/migration-books-of-work` — create from generated JSON; returns `GeneratedMigrationBookOfWorkDto` with the new `draftId`. On create, any existing **active** draft for the same `(projectId, currentArchitectureId, targetArchitectureId)` tuple is automatically transitioned to `status='archived'` (Q-6); the new row is created as `status='draft'`.
- `GET /api/projects/{projectId}/migration-books-of-work` — list. Defaults to active drafts (status not in `{archived}`); `?includeArchived=true` returns archived rows too.
- `GET /api/projects/{projectId}/migration-books-of-work/{bookId}` — full detail (entity + all four JSONB blobs).
- `PUT /api/projects/{projectId}/migration-books-of-work/{bookId}` — update editable fields: `title`, `summary`, `status`, plus replacement of `book_of_work_json` (so an "explicit Save Draft" from the review workspace can persist `saveState` deltas per Q-16). Other JSONB columns are not editable post-create.
- `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog` — save selected items into the existing `work_item` hierarchy (see below).
- Optional `/generate` endpoint is dropped per Q-1.

**Save-to-backlog behaviour (Q-5, Q-8, Q-10)**
- Request body: `selectedItemIds[]` (optional), `excludedItemIds[]` (optional), `saveMode ∈ all | selected | high_confidence_only | ready_for_spec_only`, `statusForCreatedItems` (default `'proposed'` or whatever the existing WorkItem default is), `includeTraceabilityInDescription` (bool), `includeReadinessInDescription` (bool), `tagPrefix` (optional).
- Save-mode filter semantics (Q-8):
  - `all` — every item not in `excludedItemIds`.
  - `selected` — exactly `selectedItemIds`.
  - `high_confidence_only` — admit only items with `confidence === 'high'`.
  - `ready_for_spec_only` — admit only items with `readiness === 'ready_for_spec'`.
  - **Parent-inclusion rule**: when a child item passes the filter, its ancestor chain is auto-included even if those ancestors would not pass on their own (work items need their hierarchy).
- Atomicity (Q-5):
  - Each item save runs in its own transaction.
  - On success → `saveState='saved'` and the new `workItemId` is captured on the draft item.
  - On failure → `saveState='failed'` + populate per-item `error_message`.
  - Re-running save-to-backlog is **idempotent**: items already `saveState='saved'` are skipped.
  - The whole batch is an orchestration loop over per-item commits; never a single mega-transaction.
- Tag merge semantics (Q-10): same tag already present → no-op; different tag with the same `tagPrefix` already present → add the new tag alongside it; NEVER remove or overwrite existing tags under any circumstance.
- Hierarchy fidelity: preserve `parentId` chain and `sequenceOrder` when materialising into `work_item`. No destructive overwrite of existing work items — saves always create new rows with `statusForCreatedItems`.
- Traceability / readiness materialisation: if `includeTraceabilityInDescription` is true, append the item's `traceabilitySummary` to the saved work item's description with a stable marker; if `includeReadinessInDescription` is true, append `readiness` + `readinessReasons[]` similarly. Optional `tagPrefix` is prepended to each non-conflicting saved tag.
- Final draft status reconciliation: when all admitted items succeed, draft → `saved`. When some succeed and some fail, draft → `partially_saved` and `saved_to_backlog_at` is set. When all admitted items fail, draft remains at its prior status with `error_message` populated. The post-save call returns the updated `book_of_work_json` with `saveState` and `workItemId` per item so the frontend can render the post-save view.

**Frontend — wizard (7 conversation stages)**
- New PM task launcher entry labelled **"Create Migration Delivery Plan"** in the existing PM task menu (Q-18), grouped alongside the existing PM tasks (spec-writer / implementer inspects the current PM menu component to confirm grouping convention).
- Sibling entry **"Migration Delivery Plans"** opens the draft list view (active by default, "show archived" toggle).
- Wizard stages (all driven by the gateway guided-discovery contract):
  1. **Input selection + context check** — confirms Product Definition, Current/Target Architecture, Discovery runs, API Behaviour Baselines, and mappings are available; renders the Migration Discovery Context readiness summary.
  2. **Migration intent** — multi-select (functional equivalence is NOT asked; it is mandatory).
  3. **Delivery streams** — multi-select; defaulted from context.
  4. **Migration style** — single-select; recommended from context.
  5. **Data and cutover assumptions** — concise questions only where relevant.
  6. **Migration Test Pack expectations** — multi-select; defaulted from context.
  7. **Generate draft book of work** — produces the full hierarchy + summary + quality/readiness + traceability + gaps + recommended next actions.

**Frontend — generation progress (Q-15)**
- Scripted client-side stage markers tied to the gateway request lifecycle (or simple time-bucket scripting if no progressive milestones are exposed): `Loading context…`, `Calling generator…`, `Validating schema…`, `Saving draft…`.
- No real LLM token streaming. The single synchronous response from gateway flips the indicator to "complete" and routes to the review workspace.

**Frontend — review workspace**
- Top-level summary: total items per type, confidence breakdown, readiness breakdown, findings addressed / not addressed, contracts/baselines/data entities/infrastructure covered, mappings used, unresolved gaps.
- Hierarchy tree (Initiatives → Epics → Features → Stories) with per-item badges: confidence, readiness, workstream, saved/excluded state, gap count.
- Filters: workstream (including `unknown`), confidence, readiness, blocking gaps, low confidence, API / data / infra / test work, finding reference.
- Item detail drawer: title, type, description, acceptance criteria, workstream, confidence, readiness + reasons, missing inputs, recommended next action, "Why this exists" traceability summary, all reference lists (evidence, architecture, API baseline, discovery finding, mapping, source context).
- Selection controls: select all/none, subtree select, exclude/include, save all, save selected, save high-confidence only, save ready-for-spec only.
- Save-to-backlog confirmation dialog: counts + warnings + traceability/readiness inclusion toggles + tag-prefix input. Post-save view shows created counts and per-item `saveState`/`workItemId`.
- `saveState` persistence (Q-16): lives in frontend state during the review session; persists to draft `book_of_work_json` only on explicit "Save Draft" PUT or via save-to-backlog write-back. UI surfaces an **"unsaved review changes"** indicator when frontend state has diverged from persisted draft state.

**Frontend — draft list view (Q-6, Q-18)**
- Columns: title, current arch, target arch, status, created date, item counts, confidence/readiness summary, last-saved-to-backlog timestamp.
- Defaults to active drafts (`status != 'archived'`); "show archived" toggle reveals the archived rows produced by regenerate (Q-6).
- Opening a draft routes to the review workspace; archived drafts are read-only.

**Tests — gateway (8 cases per raw-idea)**
- Task config exists with `id="product-manager--migration-delivery-plan"`, persona `"product-manager"`, mode `"discovery"`, label `"Create Migration Delivery Plan"`.
- Gateway request flow invokes the Migration Discovery Context resolver with the provided current/target architecture IDs.
- Prompt contains the functional-equivalence mandate verbatim (assertable string from the markdown task prompt).
- Prompt instructs the LLM to output a book of work (Initiatives → Epics → Features → Stories), not a migration plan document.
- Structured response validation accepts a well-formed `GeneratedMigrationBookOfWork`.
- Structured response validation rejects a malformed hierarchy (orphan `parentId`, wrong child type, cycle).
- Gateway POSTs the validated JSON to AMS at `POST /api/projects/{projectId}/migration-books-of-work` and returns `{ draftId, summary }`.
- When migration-discovery-context returns sparse / missing inputs, the LLM output (verified against fixture) produces prerequisite/refinement stories with appropriate `readiness` values, NOT invented detail.

**Tests — AMS (12 cases per raw-idea)**
- CRUD round-trip on `generated_migration_books_of_work` covering all four JSONB columns.
- List defaults to active drafts; `?includeArchived=true` returns archived rows.
- Regenerate-on-same-tuple archives the prior active row and creates a new `draft` row (Q-6).
- Save-all writes every admitted item to `work_item` and updates `saveState='saved'` per item.
- Save-selected writes only `selectedItemIds`.
- Parent-child hierarchy is preserved on save (Initiative → Epic → Feature → Story `parentId` resolves correctly in `work_item`).
- `sequenceOrder` is preserved on save.
- Re-running save-to-backlog is idempotent: items already `saveState='saved'` are skipped (Q-5).
- Save-to-backlog with `includeTraceabilityInDescription=true` and `includeReadinessInDescription=true` materialises the expected description segments and tags on the created `work_item` rows.
- Per-item failure flips that item to `saveState='failed'` with `error_message`, but neighbouring items in the same batch still commit.
- Tag-prefix conflict handling: same tag → no-op; different tag with the same prefix → additive; existing tags never removed/overwritten (Q-10).
- Save-mode filters honour the parent-inclusion rule (`high_confidence_only` and `ready_for_spec_only` admit ancestor items required to anchor admitted descendants) (Q-8).

**Tests — frontend (14 cases per raw-idea)**
- Wizard renders all 7 stages and advances per the gateway guided contract.
- Architecture select step lets the user pick `currentArchitectureId` + `targetArchitectureId`.
- Discovery run + baseline select step surfaces the available Migration Discovery Context inputs.
- Stage-by-stage question flow renders the LLM's `questions[]` and submits answers back.
- Generation progress flips through the four scripted stage markers (`Loading context…`, `Calling generator…`, `Validating schema…`, `Saving draft…`).
- Draft summary card renders counts + confidence/readiness breakdowns + gaps + coverage + blocking issues.
- Hierarchy tree renders Initiatives → Epics → Features → Stories with confidence/readiness/workstream badges.
- Filters narrow the tree (workstream including `unknown`, confidence, readiness, blocking gaps, finding reference).
- Item drawer renders title, description, AC, workstream, confidence, readiness + reasons, missing inputs, recommended next action, traceability summary, and reference lists.
- Select / exclude toggles update frontend `saveState` and surface the "unsaved review changes" indicator (Q-16).
- Save All triggers the save-to-backlog call with `saveMode='all'`.
- Save Selected triggers it with `saveMode='selected'` and the chosen IDs.
- Post-save view marks each saved item with `saveState='saved'` and surfaces failures with `error_message`.
- Reopening a draft from the draft list view rehydrates the persisted `saveState` from `book_of_work_json`.

**Tests — integration (6 cases per raw-idea + Q-9 fixture)**
- End-to-end happy path: wizard → generate → review → save all → all `work_item` rows present.
- End-to-end selective save: generate → review → save high-confidence-only → only `confidence='high'` items (plus ancestor chains) land in `work_item`.
- Sparse-context path: missing API Behaviour Baseline / mappings → prerequisite stories are generated with `readiness='needs_focused_context'` and saved correctly.
- Regenerate cycle: generate → archive on second generate → both rows visible with `?includeArchived=true`.
- Partial-failure retry: simulate one item-save failure → first run shows `partially_saved` with one `failed`; second save-to-backlog skips already-saved rows and retries the failed one (Q-5 idempotency).
- Token-budget cascade: oversize context triggers the truncation cascade in the expected order; over-budget after cascade fails loudly (Q-4).
- Fixture (Q-9): build `planning/visuals/fixture-migration-delivery-plan-scenario.json` — a monolith service split into 2 target services + 1 data migration + 1 contract change + 2 unresolved findings. The fixture cites the Phase 1, Phase 2, and Phase 3 reference fixtures it draws from but is purpose-built for the PM flow (not reused verbatim).

**Acceptance signals (all 20 from raw-idea)**
1. The Product Manager can launch the new "Create Migration Delivery Plan" workflow from the PM task menu.
2. Workflow lets the user select current and target architectures.
3. Workflow consumes Migration Discovery Context plus the documented related inputs.
4. Workflow generates a hierarchical Initiative → Epic → Feature → Story book of work.
5. Generated work is ordered to respect practical delivery dependencies via `sequenceOrder`.
6. Each item carries a planning-grade description.
7. Each item carries a `traceabilitySummary` explanation.
8. Each item carries `confidence` and `readiness`.
9. The review workspace surfaces a draft summary (counts + breakdowns + gaps + coverage + blocking issues).
10. The review workspace surfaces the hierarchy tree with per-item badges.
11. The review workspace surfaces filters across workstream / confidence / readiness / gaps / finding references.
12. The review workspace surfaces an item detail drawer with full per-item metadata.
13. The user can save all generated items to the backlog.
14. The user can save selected items to the backlog.
15. The user can save high-confidence-only items to the backlog.
16. The user can save ready-for-spec-only items to the backlog.
17. Saves are non-destructive — new `work_item` rows are created; existing rows are never overwritten.
18. The generator never fabricates contracts, mappings, or data details — sparse context produces prerequisite stories instead.
19. The resulting draft is suitable for assessing generation quality (whole-book + per-level quality assessment fields populated).
20. The resulting draft is ready to feed Spec 2 (focused detail / shape-spec generation), because readiness + evidence references are persisted in `book_of_work_json`.

**Implementation notes (verbatim from raw-idea)**
- Draft-generation and review feature; don't try to make every story shape-spec-ready.
- No first-class dependencies / traceability tables in v1.
- No standalone Migration Plan document.
- Treat readiness/confidence as generation-quality metadata, not normal backlog status.
- Store generation metadata in the draft JSON; optionally copy concise notes to saved work items.
- Prefer safe preview + selective save over auto-creating hundreds of work items.
- Review workspace focuses on summary, coverage, confidence, and exceptions — not line-by-line editing.
- Use deterministic context and evidence references wherever possible.
- Future Spec 2 uses readiness values + evidence references to retrieve focused context and generate detailed shape-specs.

## Visual Design

No mockups, wireframes, or screenshots were supplied for any surface in this spec (generation wizard, review workspace, hierarchy tree, item drawer, save-to-backlog confirmation dialog, draft list view). `planning/visuals/` was confirmed empty at shaping time. Frontend implementers work from the textual surface descriptions above and lean on the existing PM-task UX patterns and the most analogous review-workspace precedent (Discovery Findings review surface, or the `api-migration-validation-service` review UI) for visual consistency. The single artifact under `planning/visuals/` for this spec is the Q-9 test fixture (`fixture-migration-delivery-plan-scenario.json`), authored as part of the test deliverables — not a UI mockup.

## Existing Code to Leverage

**`gateway/src/config/tasks/product-manager--backlog.json` + `gateway/src/config/prompts/product-manager.backlog.task.md`**
- Closest precedent for the task config + markdown task prompt shape.
- New task config and prompt match this pair key-for-key, only contents differ.
- `contextNeeds`, `responseFormat`, `persistence`, and `availableFrom` conventions all come from this pair.
- Auth gating is copied verbatim (Q-17).

**`gateway/src/services/contextResolvers.ts` + `gateway/src/services/migrationDiscoveryContextClient.ts`**
- Existing Migration Discovery Context resolver, used **verbatim** (Q-12) — no modifications.
- The client wraps `POST /api/projects/{projectId}/migration-discovery-context` and returns the DTO that the gateway prompt builder consumes.

**`architecture-model-service/.../controller/DiscoveryRunController.java` + `model/entity/DiscoveryRunEntity.java` + `service/DiscoveryRunService.java`**
- Strongest project-scoped artifact precedent. The new `GeneratedMigrationBookOfWorkController` / `Entity` / `Service` / `Repository` / `Mapper` quintet follows this exact pattern.
- `DiscoveryRunEntity` is also the precedent for JSONB column mapping via `JsonType` (the four sibling JSONB blobs).

**`mcp-server/src/services/candidateSaveBackService.ts`**
- Closest precedent for per-item-commit save-back with `saveState` markers and idempotent retry (Q-5).
- Logic patterns (per-item transaction, success/failure marker write-back, skip-already-saved) are mirrored in the new AMS `save-to-backlog` flow.
- The actual persistence path in this spec stays gateway → AMS direct REST (Q-3); MCP-server is not in the loop.

**`architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (changesets `137`, `138`)**
- Template for the new changeset entry (`139-generated-migration-books-of-work`). Same `preConditions` + `sqlFile` structure.
- Confirms next free changeset id is `139`; never edit applied changesets per `feedback_liquibase_immutable_changesets.md`.

## Out of Scope
- Generating fully detailed, shape-spec-ready specs for every story (Spec 2's job).
- Focused story-level deep context retrieval.
- First-class work-item dependency model (`sequenceOrder` is the v1 substitute).
- First-class traceability tables (lives inside `book_of_work_json`).
- Target API reconciliation.
- Database reconciliation.
- Actual data migration.
- Migration test harness implementation.
- Cutover execution.
- Standalone "Migration Plan" document.
- Architecture model changes from this task.
- Replacing existing roadmap/backlog generation tasks.
