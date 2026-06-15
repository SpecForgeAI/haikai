# Specification: Migration Delivery Progress and Evidence Tracking

## Goal
Add a primarily read-only Migration Delivery Dashboard that rolls up backlog-save, spec-generation, implementation-workspace, and evidence coverage for a single GeneratedMigrationBookOfWork, with three surgical workflow additions (A bulk regenerate, B persisted `workItemId` linkage, C surfaced `missingInputs[]`) to close gaps the dashboard naturally exposes.

## User Stories
- As a delivery lead, I want one screen that shows every initiative/epic/feature/story in a generated book of work with its backlog-save, spec, workspace, and evidence state so that I can see at a glance where delivery is stuck and which workstreams are progressing.
- As a product engineer, I want the needs-attention queue to expose the specific missing inputs (mappings, baselines, contracts) for insufficient-context stories and let me bulk-regenerate failed or insufficient-context specs in one click so that I can clear the backlog of low-signal generations without leaving the surface.
- As a downstream caller of the dashboard, I want hierarchy nodes to join to WorkItems by a stored `workItemId` (never by title-matching) so that renames, duplicates, and case differences do not silently break the roll-up.

## Specific Requirements

**Read-only delivery-dashboard endpoint (AMS)**
- `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard` returns a single `MigrationDeliveryDashboardDto`.
- DTO fields: `bookOfWorkId`, `projectId`, `currentArchitectureId`, `targetArchitectureId`, `title`, `status`, `generatedAt`, `summary`, `hierarchy`, `workstreamSummaries`, `specGenerationSummary`, `backlogSaveSummary`, `implementationSummary`, `evidenceSummary`, `needsAttention`, `warnings`.
- Sibling DTOs: `MigrationDeliverySummaryDto`, `MigrationDeliveryHierarchyNodeDto`, `MigrationDeliveryWorkstreamSummaryDto`, `MigrationDeliveryNeedsAttentionItemDto` (with optional `missingInputs[]`), `MigrationDeliverySpecGenerationSummaryDto`, `MigrationDeliveryImplementationSummaryDto`, `MigrationDeliveryEvidenceSummaryDto`.
- `MigrationDeliveryDashboardService` batch-fetches WorkItems, MigrationStorySpecGenerations, and WorkItemImplementWorkspaces — strictly no N+1 queries.
- This endpoint is the only NEW backend route this spec introduces; no new tables, no new mutation endpoints.

**Aggregation rules (mirrored verbatim from raw idea)**
- Hierarchy built from `book_of_work_json` of `generated_migration_books_of_work` (Liquibase changeset 139).
- WorkItem linkage strictly by stored `book_of_work_json.items[].workItemId` (Addition B); title-matching is forbidden.
- Spec generation status taken from the latest `generation_attempt_number` per WorkItem in `migration_story_spec_generations` (changeset 140); for `insufficient_context` rows surface `missing_inputs_json[]` entries verbatim (Addition C).
- Implementation workspace status derived strictly from existing `WorkItemImplementWorkspace` fields; never invent completion state.
- Evidence coverage taken from book item metadata (`evidenceReferences`, `discoveryFindingReferences`, `apiBaselineReferences`, `mappingReferences`, `architectureReferences`).
- Needs-attention priority order: `failed > insufficient_context > blocked > not_saved_to_backlog > generated_with_warnings`.

**Needs-attention thresholds (Q-1)**
- A story counts as "active" (has implementation activity) if its `WorkItem.updatedAt` is within the last 14 days at dashboard read time.
- `status=blocked` only surfaces in needs-attention when explicitly set; never inferred from other states.
- `generated_with_warnings` only surfaces in needs-attention while there is no implementation activity past `not_started`; once implementation has begun, warnings alone do not requalify the row.

**Addition A — bulk regenerate from needs-attention**
- Two buttons rendered in the needs-attention panel header: "Regenerate all failed specs" and "Regenerate all insufficient-context specs".
- Each calls the existing Spec 2 gateway endpoint `POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch` with body `{ regenerateAll: true, targetWorkItemIds: [...] }` populated from the currently filtered needs-attention rows.
- Buttons are disabled when zero matching rows are present after filters; in-flight UX matches `BatchGenerationControls.tsx` (banner + disabled state).
- Filters honoured are only the needs-attention panel's own filters (workstream selector + failed/insufficient toggle) — hierarchy tree expansion does NOT filter the bulk action (Q-4).
- No cross-surface lock or polling; the Spec 2 endpoint owns concurrency safety (Q-3).
- On batch completion, the dashboard performs a single full `GET delivery-dashboard` re-fetch (no patch/optimistic UI — Q-7).
- No new gateway or AMS endpoint is introduced for Addition A; `targetWorkItemIds` support already exists in `migrationShapeSpecGenerationHandler.ts`.

**Addition B — persisted `workItemId` linkage in save-to-backlog**
- Save-to-backlog flow writes the created WorkItem id back into `book_of_work_json.items[].workItemId` and persists the updated JSON in the same transaction as the WorkItem create.
- This is mandatory, not conditional: if the current flow does not preserve the id today, fix it as part of this spec.
- No new column, no new table — the `workItemId` field lives inside the existing `book_of_work_json` JSONB column on `generated_migration_books_of_work` (changeset 139).
- This is the ONLY write-path change introduced by this spec.

**Addition C — surfaced `missingInputs[]`**
- Needs-attention rows of `type='insufficient_context'` include `missingInputs[]` where each entry is `{ kind, id?, reason }` taken verbatim from the spec-generation row's `missing_inputs_json`.
- Hierarchy nodes for insufficient-context stories carry a `missingInputsCount` alongside the existing status/confidence/implementation/evidence fields.
- The story detail drawer renders a "Missing inputs" subsection grouped by `kind` (e.g. "Mappings (4)", "Baselines (3)", "Contracts (5)") with full `id`+`reason` per row, no truncation, and the drawer body scrolls if it overflows (Q-9).

**Orphan `workItemId` handling (Q-5)**
- At read time, AMS validates each stored `workItemId` against the WorkItem store.
- An orphan (stored id with no matching WorkItem) renders as `not_saved_to_backlog` AND appends a `warnings[]` entry naming the affected item.
- No automatic repair: AMS never nulls, retries, or rewrites the stored id.

**Partial roll-up error handling (Q-11)**
- AMS returns HTTP 200 with whichever sections succeeded; failed sub-sections are named in `warnings[]`.
- The frontend renders all sections; any section the warnings list names shows an inline "Could not load X — retry" placeholder.
- A single sub-query failure must never 5xx the entire dashboard.

**Sizing and pagination posture (Q-2, Q-6)**
- Sized for books up to ~500 stories; everything rendered client-side, no real server-side pagination, cursoring, or virtualisation in v1.
- If a book exceeds ~500 stories, render a soft warning banner ("This book contains N stories; rendering may be slow") but still return the full payload.
- Both "never saved to backlog" and "save was attempted but failed" render as a single greyed-out `not_saved_to_backlog` treatment — the (a)/(b) distinction is deferred and adds zero schema changes in v1.

**Gateway proxy + frontend client**
- Gateway: thin proxy `GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard` forwarding to AMS.
- Frontend API client: new `getMigrationDeliveryDashboard(projectId, bookId)` returning `MigrationDeliveryDashboardDto`.
- Frontend API client REUSES the existing `specGenerationApi.startBatchGeneration` for Addition A — no new client function.

**Frontend route, header, refresh, and sections (Q-8, Q-10)**
- Route: `/projects/:projectId/architectures/:architectureId/migration-books-of-work/:bookId/delivery` (architecture-scoped so it inherits AppShell chrome).
- Header includes title, status, generatedAt, manual Refresh button, and a "Last refreshed HH:mm:ss" label that updates on every successful GET (initial load, manual refresh, post-bulk-regen refresh).
- Sections (in render order): header, summary cards, workstream progress, hierarchy tree (with badges including `missingInputsCount` for insufficient-context nodes), needs-attention panel (with Addition A buttons + Addition C inline `missingInputs` rendering), story detail drawer (with Addition C "Missing inputs" subsection), navigation links back to GeneratedMigrationBookOfWork detail / backlog / generated specs / implementation workspace.

## Visual Design

No mockups were provided; `planning/visuals/` is empty by design (per shaping notes "Visual Assets"). Work from the named precedents in "Existing Code to Leverage" below.

## Existing Code to Leverage

**`gateway/src/services/migrationShapeSpecGenerationHandler.ts`**
- Exports `runShapeSpecGenerationBatch` which already supports a `targetWorkItemIds` whitelist (Spec 2 follow-up).
- Addition A invokes this path unchanged — no handler edits required.

**`gateway/src/routes/migrationShapeSpecGeneration.ts`**
- Exposes the existing `POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch` route consumed by Addition A.
- No new gateway route is added for the bulk-regenerate action.

**`frontend/src/api/specGenerationApi.ts`**
- Exports `startBatchGeneration`; Addition A reuses this client function as-is.
- No new frontend API client function is added for the bulk-regenerate action.

**`architecture-model-service/src/main/resources/db/changelog/sql/140-migration-story-spec-generations.sql`**
- Defines `missing_inputs_json` JSONB column on `migration_story_spec_generations`.
- Addition C reads this column verbatim and projects each `{ kind, id?, reason }` entry into the dashboard DTO.

**`architecture-model-service` Liquibase changeset 139 (`generated_migration_books_of_work`)**
- Defines `book_of_work_json` JSONB. Addition B writes `items[].workItemId` back into this column during save-to-backlog in the same transaction as the WorkItem create. No new column added.

**`frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationDeliveryPlanProgressSummary.tsx`** and **`MigrationBookOfWorkReviewWorkspace.tsx`**
- Spec 1 precedents for the summary-cards + breakdown layout (top of dashboard) and the hierarchy tree expansion (book → workstream → feature → story).

**`frontend/src/components/ProductManager/MigrationShapeSpecGeneration/StoryResultDrawer.tsx`, `BatchResultsTable.tsx`, `SpecGenerationFilters.tsx`, `BatchGenerationControls.tsx`**
- Spec 2 precedents for the story drawer (Esc/backdrop/X dismiss, manual-edit confirm pattern), per-row badges + clickable rows in the needs-attention table, the workstream + failed/insufficient filter panel, and the in-flight banner UX consumed by Addition A.

**`frontend/src/components/DashboardView/DashboardView.tsx`, `DiscoveryListPage.tsx`, `DiscoveryRunDetailPage.tsx`**
- Generic dashboard list + roll-up layout convention, warnings-display, and inline retry placeholders — directly applicable to Q-11's partial roll-up rendering.

## Tests — AMS (19)

1. Returns 200 with full DTO for a saved book.
2. Hierarchy built from `book_of_work_json` only (never from WorkItem-derived structure).
3. Backlog-save status joins exclusively on stored `workItemId` (never title) — Addition B coverage.
4. Save-to-backlog persists the new WorkItem id back into `book_of_work_json.items[].workItemId` in the same transaction — Addition B coverage.
5. Latest `generation_attempt_number` per WorkItem wins for spec status.
6. `missing_inputs_json` entries surfaced verbatim on insufficient-context needs-attention items — Addition C coverage.
7. `missingInputsCount` populated on hierarchy nodes for insufficient-context stories — Addition C coverage.
8. Needs-attention priority order: failed > insufficient_context > blocked > not_saved_to_backlog > generated_with_warnings.
9. `generated_with_warnings` excluded from needs-attention once implementation activity is past `not_started`.
10. 14-day active staleness window applied correctly.
11. `status=blocked` only surfaces in needs-attention when explicitly set.
12. Orphan stored `workItemId` renders as `not_saved_to_backlog` AND appends a `warnings[]` entry — no auto-repair.
13. No automatic repair: orphan id is NOT nulled, NOT retried, NOT rewritten by the service.
14. Workstream summaries roll up correctly.
15. Evidence coverage derives from book item metadata only (`evidenceReferences`, `discoveryFindingReferences`, `apiBaselineReferences`, `mappingReferences`, `architectureReferences`).
16. Batch-fetching: no N+1 across WorkItem / spec-generation / workspace queries.
17. Soft warning surfaces in `warnings[]` when story count exceeds the ~500 threshold.
18. Partial roll-up returns 200 with `warnings[]` naming each failed subsection (never 5xx).
19. DTO field set matches the contract (bookOfWorkId, projectId, currentArchitectureId, targetArchitectureId, title, status, generatedAt, summary, hierarchy, workstreamSummaries, specGenerationSummary, backlogSaveSummary, implementationSummary, evidenceSummary, needsAttention, warnings).

## Tests — Gateway (1)

20. Proxy route `GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard` forwards to AMS and returns the AMS payload unchanged (status code + body).

## Tests — Frontend (13)

21. Header renders title, status, generatedAt, and "Last refreshed HH:mm:ss" label that updates on each successful GET.
22. Summary cards render counts from `summary` / `specGenerationSummary` / `backlogSaveSummary` / `implementationSummary` / `evidenceSummary`.
23. Workstream progress section renders one row per `workstreamSummaries` entry.
24. Hierarchy tree expands initiative → epic → feature → story and renders badges including `missingInputsCount` for insufficient-context nodes.
25. Needs-attention filters (workstream selector + failed/insufficient toggle) narrow the panel.
26. Needs-attention rows of `type='insufficient_context'` render `missingInputs[]` inline — Addition C coverage.
27. Bulk-regenerate buttons disabled when zero matching rows after filters; enabled otherwise — Addition A coverage.
28. Bulk-regenerate honours ONLY the needs-attention panel filters; hierarchy tree expansion is ignored — Addition A coverage.
29. Bulk-regenerate calls `specGenerationApi.startBatchGeneration` with `{ regenerateAll: true, targetWorkItemIds }` and shows the `BatchGenerationControls`-style in-flight banner — Addition A coverage.
30. On batch completion the dashboard performs a full re-fetch (no optimistic UI / row patching).
31. Story detail drawer "Missing inputs" subsection groups entries by `kind`, shows full `id`+`reason` per row, no truncation, drawer scrolls if needed — Addition C coverage.
32. Drawer dismisses on Esc / backdrop click / X button (matches `StoryResultDrawer.tsx`).
33. Sections named in `warnings[]` render an inline "Could not load X — retry" placeholder; the rest of the page renders normally.

## Tests — Integration (5)

34. End-to-end save-to-backlog: WorkItem created AND `book_of_work_json.items[].workItemId` is persisted in the same transaction — Addition B coverage.
35. Dashboard joins to backlog by stored `workItemId` after save-to-backlog round-trip; a renamed WorkItem still joins correctly — Addition B coverage.
36. End-to-end bulk regenerate: dashboard → gateway batch endpoint → AMS spec-generation rows updated → dashboard re-fetch shows the new state — Addition A coverage.
37. End-to-end insufficient-context surfacing: spec-generation row with populated `missing_inputs_json` flows through AMS DTO → gateway → frontend drawer and needs-attention row — Addition C coverage.
38. Orphan stored `workItemId` end-to-end: storage layer has the id, WorkItem store does not; dashboard renders the item as `not_saved_to_backlog` AND surfaces a warning, with no auto-repair side-effect on the database.

## Acceptance Criteria (19, verbatim from raw idea)

1. Dashboard renders for a saved GeneratedMigrationBookOfWork at the architecture-scoped route `/projects/:projectId/architectures/:architectureId/migration-books-of-work/:bookId/delivery`.
2. Header shows title, status, generatedAt, manual Refresh button, and a "Last refreshed HH:mm:ss" label.
3. Summary cards show backlog-save, spec-generation, implementation, and evidence counts.
4. Hierarchy tree shows initiatives → epics → features → stories with backlog / spec / implementation / evidence badges.
5. Insufficient-context hierarchy nodes carry a `missingInputsCount` badge.
6. Workstream progress section rolls up by workstream.
7. Needs-attention panel lists failed, insufficient-context, blocked, not-saved-to-backlog, and generated-with-warnings items in priority order.
8. Needs-attention rows of type `insufficient_context` render the actual `missingInputs[]` inline (Addition C).
9. Story detail drawer renders a "Missing inputs" subsection grouped by `kind` with full `id`+`reason` per row, no truncation (Addition C).
10. "Regenerate all failed specs" and "Regenerate all insufficient-context specs" buttons appear in the needs-attention panel and call the existing Spec 2 gateway batch endpoint with `targetWorkItemIds` (Addition A).
11. Bulk-regenerate buttons honour the current workstream / failed-insufficient filters in the needs-attention panel; hierarchy expansion is ignored (Addition A, Q-4).
12. Bulk-regenerate buttons are disabled when zero matching rows are present (Addition A).
13. Dashboard performs a full re-fetch on batch completion (no optimistic UI in v1).
14. Save-to-backlog persists the new WorkItem id back into `book_of_work_json.items[].workItemId` in the same transaction (Addition B); dashboard joins exclusively on stored id, never title.
15. Orphan stored `workItemId` (stored id with no matching WorkItem) renders as `not_saved_to_backlog` AND adds a warning naming the affected item; AMS does not auto-repair.
16. AMS returns 200 with `warnings[]` for partial roll-up failures; failed sections render an inline "Could not load X — retry" placeholder; no 5xx for the whole dashboard.
17. Books with more than ~500 stories render a soft warning banner but still load fully client-side; no server-side pagination in v1.
18. AMS batches WorkItem / spec-generation / workspace fetches — no N+1 queries.
19. Gateway exposes only the read-only proxy `GET .../delivery-dashboard`; no other new gateway or AMS endpoints are added by this spec.

## Out of Scope

- Running Claude Code.
- Executing generated shape-specs.
- Modifying application repositories.
- Running tests.
- Running API reconciliation.
- Running database reconciliation.
- Running data migration jobs.
- Creating a first-class dependency graph model.
- Creating a new migration execution engine / replacing existing WorkItem status handling / replacing existing implementation workspace flow.
- In-product spec editor (specs continue to be edited via Claude Code or text editor); missing-input resolver flow (the dashboard surfaces missing inputs but does NOT let the user bind a mapping/baseline/contract inline and re-trigger — belongs to a future Migration Backlog Refinement spec).
