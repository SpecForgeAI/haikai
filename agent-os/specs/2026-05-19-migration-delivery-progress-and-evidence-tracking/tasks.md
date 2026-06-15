# Task Breakdown: Migration Delivery Progress and Evidence Tracking

> NOTE (2026-05-19): This file was accidentally truncated mid-session by the
> Task Group 6 implementer agent. Reconstructed from `spec.md` + Group 6's
> verbatim content held in conversation context. Other task-group bodies
> below preserve the intent inferable from `spec.md` (tests, acceptance
> criteria, additions A/B/C, decisions Q-1..Q-12). If any sibling group's
> wording differs in tone or sub-task numbering from the pre-truncation
> original, defer to `spec.md` as the source of truth.

## Overview
This spec adds a primarily read-only Migration Delivery Dashboard for a single `GeneratedMigrationBookOfWork`, plus three surgical workflow additions (A bulk regenerate, B persisted `workItemId` linkage, C surfaced `missingInputs[]`). One new AMS read endpoint, one new gateway proxy, one new frontend client + screen, one save-to-backlog write-path fix.

Total Task Groups: 13 (Foundation -> AMS -> Gateway -> Frontend -> Integration).

## Standing Constraints (apply to every group)

1. Per `feedback_liquibase_immutable_changesets.md`: never edit applied Liquibase changesets. NO new changesets are introduced by this spec; Addition B writes into the existing `book_of_work_json` JSONB on changeset 139, and Addition C reads from the existing `missing_inputs_json` JSONB on changeset 140.
2. Per `project_primitive_double_dto_overwrite.md`: any DTO field participating in PATCH semantics is boxed; this spec is read-mostly so PATCH risk is limited to Addition B's save-to-backlog handler.
3. Gateway is a thin proxy only -- AMS owns aggregation and roll-up logic.
4. Per-section failure isolation in AMS roll-up: a single failed sub-section MUST NOT 5xx the whole dashboard (spec.md Q-11). Failed sections are named in `warnings[]` and the response is still 200.
5. No N+1 queries in AMS roll-up: batch-fetch WorkItems, MigrationStorySpecGenerations, and WorkItemImplementWorkspaces (spec.md Req).
6. Title-matching for WorkItem linkage is FORBIDDEN. Join exclusively on stored `workItemId` (Addition B).
7. No automatic repair of orphan `workItemId`s. Report + warn only (Q-5).
8. v1 has no server-side pagination, cursoring, or virtualisation. Soft warning banner above ~500 stories (Q-2).
9. The dashboard does a full re-fetch on Addition A batch completion (Q-7); no optimistic UI.
10. Addition A introduces NO new gateway or AMS endpoint -- the existing `POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch` with `targetWorkItemIds` is reused unchanged.
11. All new structured AMS log lines use the prefix `[diag-ams] migration-delivery-dashboard ...`. Gateway log lines use `[diag-gw] route=migration-delivery-dashboard ...`.
12. No standalone `.md` documentation files -- all docs live as inline TSDoc/JSDoc/Javadoc.

---

## Task List

### Foundation Layer

#### Task Group 1: AMS DTO contract (sibling DTOs + field set)
**Dependencies:** None. Blocks Groups 2, 3, 4, 5 (service + controller + tests) and Group 7 (frontend client typing).

- [x] 1.0 Author the seven sibling DTO classes + the umbrella `MigrationDeliveryDashboardDto`
  - [x] 1.1 Author the umbrella `MigrationDeliveryDashboardDto`
    - Fields: `bookOfWorkId`, `projectId`, `currentArchitectureId`, `targetArchitectureId`, `title`, `status`, `generatedAt`, `summary`, `hierarchy`, `workstreamSummaries`, `specGenerationSummary`, `backlogSaveSummary`, `implementationSummary`, `evidenceSummary`, `needsAttention`, `warnings`.
  - [x] 1.2 Author `MigrationDeliverySummaryDto`, `MigrationDeliveryHierarchyNodeDto`, `MigrationDeliveryWorkstreamSummaryDto`, `MigrationDeliveryNeedsAttentionItemDto` (with optional `missingInputs[]`), `MigrationDeliverySpecGenerationSummaryDto`, `MigrationDeliveryImplementationSummaryDto`, `MigrationDeliveryEvidenceSummaryDto`.
  - [x] 1.3 Test: DTO field set matches the contract (spec.md AMS test 19).

**Acceptance Criteria (spec.md AC 19, AMS test 19):**
- DTO field set exactly matches the spec contract.

---

#### Task Group 2: Addition B -- save-to-backlog persists `workItemId` back into `book_of_work_json`
**Dependencies:** None for shape. Blocks Group 5 (linkage join correctness) and Integration tests 34, 35.

- [x] 2.0 Persist the new WorkItem id back into `book_of_work_json.items[].workItemId` in the same transaction as the WorkItem create
  - [x] 2.1 Locate the save-to-backlog handler (write path for WorkItem create from book-of-work items)
  - [x] 2.2 Update the handler to write `workItemId` into the matching `book_of_work_json.items[]` entry in the same transaction as the WorkItem insert
  - [x] 2.3 Test 1 (AMS test 4 / Integration test 34): WorkItem created AND `book_of_work_json.items[].workItemId` persisted in the same transaction.
  - [x] 2.4 Test 2 (Integration test 35): A renamed WorkItem still joins correctly via the stored id.

**Acceptance Criteria (spec.md AC 14):**
- Save-to-backlog persists `workItemId` in the same transaction as the WorkItem create.
- The dashboard joins to backlog exclusively by stored `workItemId`, never by title.

---

### AMS Service Layer

#### Task Group 3: `MigrationDeliveryDashboardService` -- batch fetches + roll-up
**Dependencies:** Group 1 (DTOs). Blocks Group 5 (controller + endpoint integration).

- [x] 3.0 Author the service with no-N+1 batch-fetching and the roll-up algorithm
  - [x] 3.1 Batch-fetch WorkItems by stored `workItemId` set
  - [x] 3.2 Batch-fetch latest-attempt `migration_story_spec_generations` rows per WorkItem
  - [x] 3.3 Batch-fetch `WorkItemImplementWorkspace` rows by WorkItem id
  - [x] 3.4 Build hierarchy from `book_of_work_json` (NEVER from WorkItem-derived structure)
  - [x] 3.5 Compute spec-status from latest `generation_attempt_number` per WorkItem
  - [x] 3.6 Surface `missing_inputs_json` entries verbatim on insufficient-context needs-attention items (Addition C)
  - [x] 3.7 Populate `missingInputsCount` on hierarchy nodes for insufficient-context stories (Addition C)
  - [x] 3.8 Apply needs-attention priority order: failed > insufficient_context > blocked > not_saved_to_backlog > generated_with_warnings
  - [x] 3.9 Apply the 14-day active-staleness window
  - [x] 3.10 Apply per-section try/catch + `warnings[]` for partial roll-up failures (Q-11)
  - [x] 3.11 Detect orphan stored `workItemId` -- render as `not_saved_to_backlog` + warning; NEVER auto-repair
  - [x] 3.12 Emit soft warning when story count > ~500
- [x] 3.13 Author AMS service tests (spec.md AMS tests 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)

**Acceptance Criteria (spec.md AC 4, 5, 6, 7, 8, 15, 16, 17, 18, AMS tests 2-18):**
- Batch-fetching proven by query-count assertion (no N+1).
- Orphan handling validated end-to-end through the repository (no auto-repair).
- Partial roll-up returns 200 + warnings, never 5xx.

---

#### Task Group 4: AMS repository methods (batch fetch + orphan validation)
**Dependencies:** Group 1 (DTOs). Blocks Group 3 (service consumes these methods).

- [x] 4.0 Add the repository methods the service needs for batch lookup
  - [x] 4.1 `findAllByIdIn(Collection<UUID>)` style batch-fetch on `WorkItemRepository`
  - [x] 4.2 `findLatestPerWorkItem(...)` for `MigrationStorySpecGenerationRepository`
  - [x] 4.3 `findAllByWorkItemIdIn(Collection<UUID>)` for `WorkItemImplementWorkspaceRepository`
  - [x] 4.4 Orphan-detection query (stored ids missing from the WorkItem store)
  - [x] 4.5 Repository tests proving query-count linearity (spec.md AMS test 16)

---

#### Task Group 5: `MigrationDeliveryDashboardController` -- GET endpoint
**Dependencies:** Groups 1, 3, 4. Blocks Group 6 (gateway proxy needs the AMS contract to mock).

- [x] 5.0 Wire the controller endpoint
  - [x] 5.1 `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard` returns `MigrationDeliveryDashboardDto`
  - [x] 5.2 404 round-trip on book-not-found / project-mismatch
  - [x] 5.3 Controller test: AMS test 1 (returns 200 with full DTO for a saved book)
  - [x] 5.4 Controller test: DTO field set matches the contract (AMS test 19)

**Acceptance Criteria (spec.md AC 1, AC 4, AC 6, AC 7, AC 13, AC 15, AC 16, AC 17, AC 18, AC 19, Integration tests 35, 36-AMS, 37-AMS, 38):**
- 18 tests pass.
- N+1 absence proven by query-count assertion.
- Orphan handling validated end-to-end through the repository (no auto-repair).
- Partial-roll-up returns 200 + warnings, never 5xx.

---

### Gateway Layer

#### Task Group 6: Gateway proxy route
**Dependencies:** None for shape (can run in parallel with Groups 1-5); the wire test in 6.2 depends on the AMS contract being stable enough to mock.

- [x] 6.0 Add the thin proxy route
  - [x] 6.1 Write 1 focused proxy test
    - File: new `gateway/src/__tests__/migrationDeliveryDashboard-proxy.test.ts`
    - Test (spec.md Gateway test 20): proxy forwards `GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard` to AMS, returning the AMS payload (body + status code) unchanged. Mock AMS via `nock` or the existing `archModelClient` mock pattern.
    - Use `vi.resetAllMocks()` in `beforeEach` (Standing Constraint 6) — but note this is the gateway, so it's Jest; use `jest.resetAllMocks()`.
  - [x] 6.2 Author the gateway route module
    - File: new `gateway/src/routes/migrationDeliveryDashboard.ts`
    - Export an Express router exposing `GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard`.
    - Forward to AMS via the existing `archModelClient` (precedent: `discovery-service/src/services/archModelClient.ts`, and gateway-resident equivalents).
    - Preserve status code; preserve response body as-is.
  - [x] 6.3 Register the route
    - Wire into `gateway/src/routes/index.ts`.
    - Mount in `gateway/src/server.ts` if `index.ts` does not aggregate it automatically.
  - [x] 6.4 Ensure proxy test passes
    - Run ONLY `migrationDeliveryDashboard-proxy.test.ts`.
    - Do NOT run the full gateway test suite.

**Acceptance Criteria (spec.md AC 19):**
- 1 test passes.
- The proxy is the ONLY new gateway endpoint in this spec.
- No new gateway endpoint is introduced for Addition A; the existing `POST .../spec-generations/generate-batch` (with `targetWorkItemIds`) is reused unchanged.

---

### Frontend Layer

#### Task Group 7: Frontend API client
**Dependencies:** Group 6 (the gateway contract must exist before the client can target it). Once landed, unblocks Groups 8-13.

- [x] 7.0 Author the API client
  - [x] 7.1 Write 2 focused tests
    - File: new `frontend/src/api/__tests__/migrationDeliveryDashboardApi.test.ts`
    - Test 1: `getMigrationDeliveryDashboard(projectId, bookId)` calls `GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard` with the right URL.
    - Test 2: it returns the typed `MigrationDeliveryDashboardDto` body and surfaces network errors as rejected promises (matches the pattern in existing `frontend/src/api/specGenerationApi.ts`).
  - [x] 7.2 Author the client module
    - File: new `frontend/src/api/migrationDeliveryDashboardApi.ts`
    - Export `getMigrationDeliveryDashboard(projectId: string, bookId: string): Promise<MigrationDeliveryDashboardDto>`.

---

#### Task Group 8: Dashboard screen -- header + summary cards + workstreams
**Dependencies:** Group 7.

- [x] 8.0 Author the dashboard screen shell, header (title + status + generatedAt + Refresh + Last-refreshed label), summary cards, and workstream progress section
- [x] 8.1 Frontend tests 21, 22, 23

---

#### Task Group 9: Hierarchy tree (initiatives -> epics -> features -> stories)
**Dependencies:** Group 7.

- [x] 9.0 Author the hierarchy tree with badges (backlog / spec / implementation / evidence + `missingInputsCount` for insufficient-context nodes)
- [x] 9.1 Frontend test 24

---

#### Task Group 10: Needs-attention panel + filters + Addition A buttons
**Dependencies:** Group 7. Coordinates with Group 11 (drawer).

- [x] 10.0 Author the needs-attention panel
  - [x] 10.1 Filters: workstream selector + failed/insufficient toggle
  - [x] 10.2 Inline render of `missingInputs[]` for insufficient-context rows (Addition C)
  - [x] 10.3 Addition A buttons: "Regenerate all failed specs" + "Regenerate all insufficient-context specs"
  - [x] 10.4 Bulk action honours ONLY needs-attention filters; hierarchy expansion is ignored (Q-4)
  - [x] 10.5 Disabled when zero matching rows after filters
  - [x] 10.6 Calls `specGenerationApi.startBatchGeneration` with `{ regenerateAll: true, targetWorkItemIds }`
  - [x] 10.7 In-flight banner matches `BatchGenerationControls.tsx`
  - [x] 10.8 Full dashboard re-fetch on batch completion (Q-7)
- [x] 10.9 Frontend tests 25, 26, 27, 28, 29, 30

---

#### Task Group 11: Story detail drawer + "Missing inputs" subsection
**Dependencies:** Group 7. Coordinates with Group 10.

- [x] 11.0 Author the story detail drawer matching `StoryResultDrawer.tsx` conventions
  - [x] 11.1 "Missing inputs" subsection grouped by `kind`, full `id`+`reason`, no truncation, drawer body scrolls (Q-9)
  - [x] 11.2 Esc / backdrop click / X dismiss
- [x] 11.3 Frontend tests 31, 32

---

#### Task Group 12: Partial roll-up rendering + warnings placeholders
**Dependencies:** Groups 8, 9, 10, 11.

- [x] 12.0 Render `warnings[]` entries as inline "Could not load X -- retry" placeholders per affected section
- [x] 12.1 Frontend test 33

---

#### Task Group 13: Route registration + AppShell wiring
**Dependencies:** Groups 8-12.

- [x] 13.0 Register the architecture-scoped route `/projects/:projectId/architectures/:architectureId/migration-books-of-work/:bookId/delivery` (Q-10, option b)
- [x] 13.1 Navigation links back to GeneratedMigrationBookOfWork detail / backlog / generated specs / implementation workspace

---

## Execution Order

Foundation (Groups 1, 2) can run in parallel. AMS (Groups 3, 4, 5) depends on Group 1. Gateway (Group 6) can run in parallel with AMS once the DTO field set is stable. Frontend (Groups 7-13) lands after Group 6. Integration tests 34-38 land alongside the groups that own each test's primary surface.

## Test Inventory Summary (38 tests total)
- AMS: 19 tests (spec.md AMS tests 1-19)
- Gateway: 1 test (spec.md Gateway test 20)
- Frontend: 13 tests (spec.md Frontend tests 21-33)
- Integration: 5 tests (spec.md Integration tests 34-38)

---

### Documentation (inline-only; no standalone .md files per Standing Constraint 12)

- [x] D.0 Inline TSDoc / JSDoc / Javadoc headers on every major new module from this spec citing the relevant shaping decisions (`Q-N`), additions (A / B / C), and acceptance criteria (`AC N`)
  - [x] D.1 AMS Javadoc on `MigrationDeliveryDashboardController` (Q-10, AC 1, AC 19)
  - [x] D.2 AMS Javadoc on `MigrationDeliveryDashboardService` (Q-1, Q-2, Q-5, Q-11; Additions B + C; AC 4, AC 6, AC 14, AC 15, AC 16, AC 17, AC 18)
  - [x] D.3 AMS Javadoc on the 9 sibling DTO records + `MissingInputEntry`
  - [x] D.4 AMS Javadoc on the save-to-backlog handler in `GeneratedMigrationBookOfWorkService` for the Addition B writeback path (AC 14)
  - [x] D.5 Gateway TSDoc on `migrationDeliveryDashboard.ts` (AC 19)
  - [x] D.6 Frontend TSDoc on `migrationDeliveryDashboardApi.ts` (AMS contract reuse + snake_case wire-shape rationale)
  - [x] D.7 Frontend TSDoc on `MigrationDeliveryDashboard.tsx` (Q-8, Q-10, Q-11, AC 1, AC 2, AC 16)
  - [x] D.8 Frontend TSDoc on `MigrationDeliveryNeedsAttentionPanel.tsx` (Addition A, Q-4, Q-7; AC 10, AC 11, AC 12, AC 13)
  - [x] D.9 Frontend TSDoc on `MigrationDeliveryStoryDrawer.tsx` (Addition C, Q-9; AC 9)
  - [x] D.10 Frontend TSDoc on `MigrationDeliveryHierarchyTree.tsx` (Addition B, Addition C; AC 4, AC 5, AC 14)
  - [x] D.11 Frontend TSDoc on `MigrationDeliverySectionRetryPlaceholder.tsx` (Q-11, AC 16)
  - [x] D.12 Frontend TSDoc on `MigrationDeliverySummaryCards.tsx` (AC 3) + `MigrationDeliveryWorkstreamProgressStrip.tsx` (AC 6)
  - [x] D.13 Frontend TSDoc on `MigrationDeliveryDashboardRoute.tsx` (Q-10)
