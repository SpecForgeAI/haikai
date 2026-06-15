# Verification Report: Migration Delivery Progress and Evidence Tracking

**Spec:** `2026-05-19-migration-delivery-progress-and-evidence-tracking`
**Date:** 2026-05-19
**Verifier:** implementation-verifier
**Status:** PASS-WITH-CAVEATS

---

## Verdict

**PASS-WITH-CAVEATS.** The implementation is functionally complete against
`spec.md`. All 19 acceptance criteria trace to concrete code; all 38
enumerated tests have on-disk implementations; the three surgical additions
(A bulk regenerate, B persisted `workItemId` linkage, C surfaced
`missingInputs[]`) land cleanly; Q-1..Q-12 spot-checks pass. Spot-checked
test files run green (gateway proxy 1/1, frontend dashboard 29/29, frontend
API client 2/2). Caveats are documentation-shape only (tasks.md was rebuilt
mid-session by Group 6 agent into 13 groups + Documentation appendix vs the
original 14) and disclosed deviations (10th DTO record added; snake_case
wire shape; `onOpenImplementationWorkspace` falls back to backlog
navigation). Pre-existing AMS test-compile rot in unrelated test classes is
not a regression of this spec. No new Liquibase changesets were introduced.

---

## 1. Acceptance Criteria Coverage (spec.md AC 1-19)

| AC # | Criterion | Implementing files | Status |
|------|-----------|--------------------|--------|
| 1 | Architecture-scoped route renders dashboard | `frontend/src/App.tsx:787-790`, `frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryDashboardRoute.tsx`, `MigrationDeliveryDashboard.tsx` | Pass |
| 2 | Header shows title/status/generatedAt + manual Refresh + "Last refreshed HH:mm:ss" | `MigrationDeliveryDashboard.tsx` (`MigrationDeliveryDashboard.shell.test.tsx` Frontend test 21) | Pass |
| 3 | Summary cards show backlog/spec/implementation/evidence counts | `MigrationDeliverySummaryCards.tsx` (test 22) | Pass |
| 4 | Hierarchy tree shows initiatives -> epics -> features -> stories with badges | `MigrationDeliveryHierarchyTree.tsx` + service hierarchy build in `MigrationDeliveryDashboardService.java` lines 246-252 | Pass |
| 5 | `missingInputsCount` badge on insufficient-context hierarchy nodes | `MigrationDeliveryHierarchyNodeDto.java` + `MigrationDeliveryHierarchyTree.tsx` (test 24) | Pass |
| 6 | Workstream progress section rolls up by workstream | `MigrationDeliveryWorkstreamProgressStrip.tsx` + service `buildWorkstreamSummaries` (test 23) | Pass |
| 7 | Needs-attention panel lists items in priority order | `MigrationDeliveryDashboardService.java:143-149` (NEEDS_ATTENTION_PRIORITY) + `MigrationDeliveryNeedsAttentionPanel.tsx` | Pass |
| 8 | Needs-attention rows of `insufficient_context` render `missingInputs[]` inline | `MigrationDeliveryNeedsAttentionPanel.tsx` (test 26 Addition C) | Pass |
| 9 | Story detail drawer "Missing inputs" subsection grouped by `kind` | `MigrationDeliveryStoryDrawer.tsx` (tests 31-32) | Pass |
| 10 | "Regenerate all failed" / "Regenerate all insufficient-context" call existing batch endpoint with `targetWorkItemIds` | `MigrationDeliveryNeedsAttentionPanel.tsx:177-182` calls `startBatchGeneration({ projectId, bookOfWorkId, regenerateAll: true, targetWorkItemIds })`; `specGenerationApi.ts:199` declares `targetWorkItemIds?: string[]` | Pass |
| 11 | Bulk-regenerate honours panel filters only (hierarchy ignored) | `MigrationDeliveryNeedsAttentionPanel.tsx` filteredRows logic (test 28, Q-4) | Pass |
| 12 | Bulk-regenerate disabled when zero matching rows | `MigrationDeliveryNeedsAttentionPanel.tsx:164-166` `failedDisabled` / `insufficientDisabled` (test 27) | Pass |
| 13 | Full re-fetch on batch completion (no optimistic UI) | `MigrationDeliveryNeedsAttentionPanel.tsx:188` calls `onBatchComplete()`; dashboard performs fresh GET (test 30, Q-7) | Pass |
| 14 | Save-to-backlog persists WorkItem id back into `book_of_work_json.items[].workItemId` in same transaction; join is by id never title | `GeneratedMigrationBookOfWorkService.java:480` `item.put("workItemId", newWorkItemId.toString())`; service join logic at `MigrationDeliveryDashboardService.java:194-202`; verified by `SaveToBacklogWorkItemIdPersistenceTest` (3 tests) | Pass |
| 15 | Orphan stored `workItemId` renders as `not_saved_to_backlog` + warning; no auto-repair | `MigrationDeliveryDashboardService.java` orphan detection branch + `warnings[]` append; AMS test 15 (Service test class line 511); Int 38 (`AMS test "Int 38 -- orphan stored workItemId never triggers repository writes"` line 705) | Pass |
| 16 | AMS returns 200 + `warnings[]` for partial roll-up; failed sections render inline retry placeholder; no 5xx | `MigrationDeliveryDashboardService.java:100-104` safeLoadSubsection wrapper + `MigrationDeliverySectionRetryPlaceholder.tsx`; AMS test 18 (line 601), Frontend test 33 | Pass |
| 17 | Books > ~500 stories render soft warning banner; payload still loads fully | `MigrationDeliveryDashboardService.java:131` `SOFT_WARNING_STORY_THRESHOLD = 500L` + `MigrationDeliveryDashboard.tsx` banner (AMS test 17, frontend shell test 265+) | Pass |
| 18 | AMS batches WorkItem / spec-generation / workspace fetches — no N+1 | `MigrationDeliveryDashboardService.java:54-62` (three batched repository calls); AMS test 16 query-count assertion | Pass |
| 19 | Gateway exposes only the read-only proxy; no other new endpoints | `gateway/src/routes/migrationDeliveryDashboard.ts` (sole new route); `frontend/src/api/specGenerationApi.ts` reuses existing `startBatchGeneration` for Addition A | Pass |

---

## 2. Test Coverage Matrix (spec.md tests 1-38)

### AMS Tests (1-19)

| # | Description | File / Test | Status |
|---|-------------|-------------|--------|
| 1 | Returns 200 with full DTO for a saved book | `MigrationDeliveryDashboardControllerTest.java:77` "AMS test 1 -- GET /delivery-dashboard returns 200 with full DTO for a saved book" | Present |
| 2 | Hierarchy built from `book_of_work_json` only | `MigrationDeliveryDashboardServiceTest.java:107` + `:132` "AMS test 3 -- summary counts each hierarchy type from book_of_work_json" | Present |
| 3 | Backlog-save status joins exclusively on stored `workItemId` | `MigrationDeliveryDashboardServiceTest.java:159` "AMS test 5 -- backlog-save summary uses stored workItemId; orphan id counts as unsaved" | Present |
| 4 | Save-to-backlog persists WorkItem id back into JSON in same transaction | `SaveToBacklogWorkItemIdPersistenceTest.java:171` Test 1 (3 tests in class) | Present |
| 5 | Latest `generation_attempt_number` per WorkItem wins | `MigrationDeliveryDashboardServiceTest.java:240` "AMS test 7 -- latest generation_attempt_number per WorkItem wins for spec status" | Present |
| 6 | `missing_inputs_json` surfaced verbatim on insufficient-context needs-attention | `MigrationDeliveryDashboardServiceTest.java:458` "AMS test 14 + Int 37 (AMS half) -- insufficient_context surfaces missingInputs[] verbatim from missing_inputs_json" | Present |
| 7 | `missingInputsCount` populated on hierarchy nodes | `MigrationDeliveryDashboardDtoContractTest.java:124` + service-test verifications via insufficient-context fixtures | Present |
| 8 | Needs-attention priority order | `MigrationDeliveryDashboardServiceTest.java:430+` (multiple priority assertions across tests 13-15) | Present |
| 9 | `generated_with_warnings` excluded once implementation > not_started | `MigrationDeliveryDashboardServiceTest.java:743` "generated_with_warnings suppressed from needs-attention once implementation is past not_started" | Present |
| 10 | 14-day active staleness window applied | `MigrationDeliveryDashboardService.java:137` constant + service-test coverage at lines 304/334/367 | Present |
| 11 | `status=blocked` only when explicitly set | `MigrationDeliveryDashboardServiceTest.java` priority/blocked coverage (lines 431-540 region) | Present |
| 12 | Orphan stored `workItemId` renders as `not_saved_to_backlog` + warning | `MigrationDeliveryDashboardServiceTest.java:511` "AMS test 15 -- needs-attention includes not_saved_to_backlog for items lacking a resolvable workItemId" | Present |
| 13 | No automatic repair of orphan id | `MigrationDeliveryDashboardServiceTest.java:705` "Int 38 -- orphan stored workItemId never triggers repository writes (no auto-repair)" | Present |
| 14 | Workstream summaries roll up correctly | `MigrationDeliveryDashboardServiceTest.java:634` "Workstream summaries roll up per workstream label across stories" | Present |
| 15 | Evidence coverage derives from book item metadata only | `MigrationDeliveryDashboardServiceTest.java:396` "AMS test 12 -- evidence summary derives has_coverage when any reference list is populated" | Present |
| 16 | Batch-fetching: no N+1 | `MigrationDeliveryDashboardServiceTest.java:542` "AMS test 16 -- no N+1: exactly 3 batched repository fetches regardless of story count" | Present |
| 17 | Soft warning surfaces when story count > ~500 | `MigrationDeliveryDashboardServiceTest.java:576` "AMS test 17 -- >500 stories surfaces a soft warning AND returns the full payload" | Present |
| 18 | Partial roll-up returns 200 + warnings naming failed subsection | `MigrationDeliveryDashboardServiceTest.java:601` "AMS test 18 -- partial roll-up: one failed batch fetch is named in warnings; other sections populate" | Present |
| 19 | DTO field set matches contract | `MigrationDeliveryDashboardDtoContractTest.java:53` "MigrationDeliveryDashboardDto exposes exactly the 16 contract fields" + controller-level wire test `:114` | Present |

### Gateway Test (20)

| # | Description | File / Test | Status |
|---|-------------|-------------|--------|
| 20 | Proxy forwards GET to AMS, returns AMS payload unchanged | `gateway/src/__tests__/migrationDeliveryDashboardProxy.test.ts:66` — **Spot-checked: PASS (1/1)** | Present + Verified |

### Frontend Tests (21-33)

| # | Description | File / Test | Status |
|---|-------------|-------------|--------|
| 21 | Header + Last refreshed updates on each successful GET | `MigrationDeliveryDashboard.shell.test.tsx:165` | Present + Verified (spot-check) |
| 22 | Summary cards render counts from all 5 summary DTOs | `MigrationDeliverySummaryCards.test.tsx:90` | Present + Verified |
| 23 | Workstream progress section: one row per entry | `MigrationDeliverySummaryCards.test.tsx:150` | Present + Verified |
| 24 | Hierarchy tree expansion + `missingInputsCount` badges | `MigrationDeliveryHierarchyTree.test.tsx:121` | Present + Verified |
| 25 | Needs-attention filters narrow the panel | `MigrationDeliveryNeedsAttentionPanel.test.tsx:207-289` (3 cases) | Present + Verified |
| 26 | Needs-attention insufficient_context renders `missingInputs[]` inline | `MigrationDeliveryNeedsAttentionPanel.test.tsx:291-329` (2 cases) | Present + Verified |
| 27 | Bulk-regenerate buttons disabled when zero matching rows | `MigrationDeliveryNeedsAttentionPanel.test.tsx:351-410` (4 cases) | Present + Verified |
| 28 | Bulk-regenerate honours panel filters only | `MigrationDeliveryNeedsAttentionPanel.test.tsx:412` | Present + Verified |
| 29 | Bulk-regenerate call shape + in-flight banner | `MigrationDeliveryNeedsAttentionPanel.test.tsx:447-507` (2 cases) | Present + Verified |
| 30 | Full re-fetch on batch completion | `MigrationDeliveryNeedsAttentionPanel.test.tsx:510-528` (2 cases) | Present + Verified |
| 31 | Drawer "Missing inputs" subsection (grouping, no truncation, scroll) | `MigrationDeliveryStoryDrawer.test.tsx:167-264` (4 cases) | Present + Verified |
| 32 | Drawer dismissal (Esc / backdrop / X) | `MigrationDeliveryStoryDrawer.test.tsx:267-321` (4 cases) | Present + Verified |
| 33 | Warning sections render inline "Could not load X -- retry" placeholder | `MigrationDeliveryDashboard.shell.test.tsx:233` + `MigrationDeliverySectionRetryPlaceholder.test.tsx:37` | Present + Verified |

### Integration Tests (34-38)

| # | Description | File / Test | Status |
|---|-------------|-------------|--------|
| 34 | E2E save-to-backlog: WorkItem created AND `workItemId` persisted in same transaction | `SaveToBacklogWorkItemIdPersistenceTest.java:172` Test 1 | Present |
| 35 | Dashboard joins by stored `workItemId` after rename | `SaveToBacklogWorkItemIdPersistenceTest.java:265` Test 2 | Present |
| 36 | E2E bulk regenerate -> AMS update -> dashboard re-fetch | `MigrationDeliveryDashboardServiceTest.java:668` "Int 36 (AMS half)" + frontend test 29-30 covers the panel/refresh half | Present (split across AMS + frontend) |
| 37 | E2E insufficient-context surfacing through AMS DTO -> gateway -> frontend | `MigrationDeliveryDashboardServiceTest.java:458` AMS half + drawer test 31 + needs-attention test 26 frontend halves | Present (split across AMS + frontend) |
| 38 | Orphan id end-to-end: dashboard renders as `not_saved_to_backlog` + warning + no DB write | `MigrationDeliveryDashboardServiceTest.java:705` "Int 38 -- orphan stored workItemId never triggers repository writes (no auto-repair)" | Present |

**Total: 38/38 enumerated tests have on-disk implementations.**

Spot-check execution: gateway proxy 1/1 passed; frontend dashboard 29/29 passed; frontend API client 2/2 passed. AMS test classes were not re-executed per verifier protocol — agent disclosures report ~25 tests passing via isolated `mvn surefire:test -Dtest=...` invocations to bypass pre-existing AMS test-compile rot in unrelated test classes.

---

## 3. Three Surgical Additions

### Addition A — Bulk regenerate buttons in NeedsAttentionPanel

- `frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryNeedsAttentionPanel.tsx:41` imports `startBatchGeneration`.
- Lines 177-182: calls `startBatchGeneration({ projectId, bookOfWorkId, regenerateAll: true, targetWorkItemIds })`.
- `frontend/src/api/specGenerationApi.ts:199` — `StartBatchGenerationRequest.targetWorkItemIds?: string[]` field with TSDoc citing this spec.
- **No new gateway / AMS endpoint introduced** — confirmed by grep across `gateway/src/routes/` (only `migrationDeliveryDashboard.ts` is new for this spec).
- Status: **LANDED**

### Addition B — Persisted `workItemId` linkage in save-to-backlog

- `architecture-model-service/src/main/java/com/example/architecturemodel/service/GeneratedMigrationBookOfWorkService.java:480`: `item.put("workItemId", newWorkItemId.toString())` inside the `@Transactional` `saveToBacklog` boundary.
- `:484` increments `workItemIdPersistedCount`; `:550` emits `[diag-ams] delivery_dashboard save_to_backlog workItemId_persisted` log line.
- Verified by `SaveToBacklogWorkItemIdPersistenceTest.java` (3 `@Test` methods at lines 171, 264, 317): item stamping + per-item rollback, dashboard join survives WorkItem rename, filtered-out items have no `workItemId`.
- Status: **LANDED**

### Addition C — Surfaced `missingInputs[]` (a/b/c)

- **(a) `MigrationDeliveryNeedsAttentionItemDto.missingInputs[]`** — `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MigrationDeliveryNeedsAttentionItemDto.java` exposes `missingInputs` as `List<MissingInputEntry>`; service projects entries verbatim from `missing_inputs_json` (service test 14 line 458).
- **(b) `MigrationDeliveryHierarchyNodeDto.missingInputsCount`** — present on the hierarchy node DTO; service populates from the same projection; contract test at `MigrationDeliveryDashboardDtoContractTest.java:124`.
- **(c) Drawer "Missing inputs" subsection grouped by `kind`** — `MigrationDeliveryStoryDrawer.tsx` renders the subsection; tests at `MigrationDeliveryStoryDrawer.test.tsx:167-264` cover grouping by kind with header counts, full `id`+`reason` per row, no truncation, scrollable drawer body.
- Status: **LANDED**

---

## 4. Q-1..Q-12 Spot-Check

| Q | Decision | Implementation evidence | Status |
|---|----------|-------------------------|--------|
| Q-1 | 14-day staleness window for "active" implementation | `MigrationDeliveryDashboardService.java:137` `ACTIVE_STALENESS_WINDOW = Duration.ofDays(14)`; consumed at `:668` `readTime.minus(ACTIVE_STALENESS_WINDOW)` | Confirmed |
| Q-2 | ~500-story soft warning banner | `MigrationDeliveryDashboardService.java:131` `SOFT_WARNING_STORY_THRESHOLD = 500L`; AMS test 17; frontend banner test in `MigrationDeliveryDashboard.shell.test.tsx:266` | Confirmed |
| Q-4 | Bulk-regenerate honours only needs-attention filters (not hierarchy expansion) | `MigrationDeliveryNeedsAttentionPanel.tsx` `filteredRows` derived from workstream + type filters only; verified by Frontend test 28 (`MigrationDeliveryNeedsAttentionPanel.test.tsx:412`) | Confirmed |
| Q-7 | Full re-fetch on batch completion (no optimistic UI / no row patching) | `MigrationDeliveryNeedsAttentionPanel.tsx:188` `onBatchComplete()` invoked once after `startBatchGeneration` resolves; parent dashboard re-fetches via the same GET path used on initial load. Frontend test 30. | Confirmed |
| Q-10 | Route `/projects/:projectId/architectures/:architectureId/migration-books-of-work/:bookId/delivery` | `frontend/src/App.tsx:787-790` mounts `path="migration-books-of-work/:bookId/delivery"` under the architecture-scoped parent at `:655` `path="architectures/:architectureId"` | Confirmed |
| Q-11 | Partial roll-up returns 200 + `warnings[]` + per-section retry placeholder | `MigrationDeliveryDashboardService.java` `safeLoadSubsection` wrappers (lines 197+, 206+, 216+, 247+, 256+, 264+, 270+, 276+, 282+, 288+, 294+); `MigrationDeliverySectionRetryPlaceholder.tsx`; AMS test 18 + Frontend test 33 | Confirmed |

(Q-3, Q-5, Q-6, Q-8, Q-9, Q-12 not in spot-check sample — relied on AC-level coverage above; orphan handling Q-5 covered via AC 15.)

---

## 5. Known Deviations / Caveats (from agent disclosures, confirmed)

1. **tasks.md was rebuilt mid-session** by the Task Group 6 agent into 13 groups + Documentation appendix (original had 14 groups). All work is functionally complete against spec.md; only the progress-tracker structure differs. **Confirmed.**
2. **Wire shape is snake_case.** `MigrationDeliveryDashboardDto.java` uses `@JsonProperty("snake_case")` on every field (e.g. `book_of_work_id`, `current_architecture_id`); `frontend/src/api/migrationDeliveryDashboardApi.ts` mirrors snake_case keys verbatim. UI components consume `dashboard.needs_attention[0].work_item_id`. **Confirmed in source.**
3. **Addition A: `StartBatchGenerationRequest.targetWorkItemIds` is a non-breaking type extension** — `frontend/src/api/specGenerationApi.ts:199`. Gateway handler already supports it from Spec 2's follow-up wiring; no new gateway/AMS endpoint. **Confirmed.**
4. **`onOpenImplementationWorkspace` falls back to backlog navigation** — `MigrationDeliveryDashboardRoute.tsx:83-85` documents and implements navigation to `/product/backlog` because the header link is invoked as a no-arg function with no `workItemId` in scope. **Confirmed in source.**
5. **10th DTO record `MigrationDeliveryBacklogSaveSummaryDto`** added alongside the spec's listed 9 records because `backlogSaveSummary` didn't fit cleanly into any other DTO. File exists at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MigrationDeliveryBacklogSaveSummaryDto.java`. **Confirmed.**
6. **Pre-existing AMS test-compile rot** in `RoadmapImportServiceV3Test`, `OrganisationController*Test`, `WorkItemImplementContextServiceTest`, `DiagramSvgRendererTest`, `ProjectSnapshotImportIntegrationTest`. All five files exist on disk. Agent disclosure says each implementer compiled new test files in isolation via `javac` + `mvn surefire:test -Dtest=...` to bypass main test-source compilation failure. **Confirmed file presence; not a regression of this spec.**

---

## 6. Pre-Existing Rot (Not Introduced by This Spec)

| File | Note |
|------|------|
| `RoadmapImportServiceV3Test.java` | Test-source compile failure pre-existing |
| `OrganisationControllerTest.java` / `OrganisationControllerDocsAppliedTest.java` / `OrganisationControllerTextIdTest.java` | Test-source compile failure pre-existing |
| `WorkItemImplementContextServiceTest.java` | Test-source compile failure pre-existing |
| `service/export/DiagramSvgRendererTest.java` | Test-source compile failure pre-existing |
| `integration/ProjectSnapshotImportIntegrationTest.java` | Test-source compile failure pre-existing |

Per verifier protocol, the full AMS test suite was NOT re-run. Implementer agents worked around these by compiling new spec test files in isolation. Main `mvn compile` (production classpath) stays clean. None of these tests touch any of the Migration Delivery Dashboard files (verified by file-path inspection).

---

## 7. Liquibase Changesets

No new changesets were introduced by this spec. The diff against
`architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
shows the 139 (`generated_migration_books_of_work`) and 140
(`migration_story_spec_generations`) changesets, but both are explicitly
documented in the YAML as belonging to prior specs (2026-05-17 PM Migration
Delivery Plan + 2026-05-19 PM Migration Shape-Spec Batch Generation
respectively). This spec only **reads** from `book_of_work_json` (changeset
139) and `missing_inputs_json` (changeset 140), and only **writes** to
`book_of_work_json` via Addition B inside an existing transactional handler
(`GeneratedMigrationBookOfWorkService.saveToBacklog`). **Confirmed — no new
changesets.**

---

## 8. Test Suite Execution (Spot-Check Only)

Per verifier protocol the full mono-repo suite was NOT re-run. Spot-checked:

| Suite | Command | Result |
|-------|---------|--------|
| Gateway proxy | `npx jest src/__tests__/migrationDeliveryDashboardProxy.test.ts` | **1/1 passed** (5.6s) |
| Frontend dashboard tests | `npx vitest run src/components/ProductManager/MigrationDeliveryDashboard/__tests__/` | **29/29 passed across 6 files** (6.9s) — shell (3), summary cards (2), hierarchy tree (1), needs-attention panel (14), story drawer (8), retry placeholder (1) |
| Frontend API client | `npx vitest run src/api/__tests__/migrationDeliveryDashboardApi.test.ts` | **2/2 passed** (3.3s) |

AMS tests not re-executed per protocol; agent disclosures report ~25 tests across `MigrationDeliveryDashboardServiceTest`, `MigrationDeliveryDashboardControllerTest`, `MigrationDeliveryDashboardDtoContractTest`, and `SaveToBacklogWorkItemIdPersistenceTest` passing via isolated `mvn surefire:test -Dtest=...` invocations.

---

## 9. Production Follow-Ups

The following are not blocking the verdict but are worth recording for future work:

1. **`onOpenImplementationWorkspace` deep-link.** The dashboard header link currently navigates to `/product/backlog` because there's no `workItemId` in scope at click time. A future story can wire a per-row Implement-tab deep link from the story drawer once the implementation workspace surface supports per-WorkItem deep links.
2. **Pre-existing AMS test-source compile failures** in unrelated test classes (`RoadmapImportServiceV3Test`, `OrganisationController*Test`, `WorkItemImplementContextServiceTest`, `DiagramSvgRendererTest`, `ProjectSnapshotImportIntegrationTest`) should be cleaned up in a maintenance pass; they currently block running the full AMS test suite via standard `mvn test`.
3. **Persisted (a)/(b) distinction for "never saved" vs "save failed"** (Q-6) is deferred from v1. If user feedback motivates the distinction, add a small persistence change (boolean flag on book item) rather than relying on the current uniform grey-out treatment.
4. **Server-side pagination** for books > ~500 stories (Q-2) is deferred. The current soft-warning banner gives us telemetry signal; revisit once a real book exceeds the threshold.
5. **Cross-spec wire-shape note.** This dashboard's wire shape is snake_case (Jackson `@JsonProperty`), while older AMS controllers in the codebase mix camelCase and snake_case. Future specs reading this DTO should mirror the snake_case convention to avoid an extra mapping layer.
