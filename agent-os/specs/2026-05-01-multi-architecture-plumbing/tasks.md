# Task Breakdown: Multi-Architecture Plumbing (Spec #1)

## Overview
Total Tasks: 6 task groups

This spec lands the end-to-end multi-architecture plumbing — data model, backend, gateway, frontend, and the discovery-service entity-fetch updates — with **zero data loss** and **zero user-visible behaviour change**. Every existing project gets one auto-created `Default` architecture via Liquibase migration, and the frontend silently routes everything through it.

**Hard constraints (from spec.md and the design note, non-negotiable):**
- Zero data loss in migration.
- Zero user-visible behaviour change after this spec ships.
- Path-segment URLs (`/projects/:projectId/architectures/:architectureId/...`) — forgetting the id MUST produce a 404, not silently route to a default.
- Threads stay project-scoped (no change to thread storage paths or thread client functions).
- Never edit applied Liquibase changesets in place — always add new changeset files.
- Only edit `discovery-service/src/**` when no discovery run is active (tsx watch auto-reloads kill in-flight runs).

## Task List

### Backend Foundation

#### Task Group 1: Architecture Entity, Schema, Migration, and List Endpoint
**Dependencies:** None
**Spec sections:** "`architecture` and `architecture_tag` schema", "Liquibase migration — zero data loss, idempotent", "In-scope tables for `architecture_id` column", "New endpoint — list architectures", "Existing Code to Leverage" (DeliveryTeamEntity / OrganisationEntity, Liquibase changesets 020–024).

- [x] 1.0 Complete the architecture-model-service foundation: schema, JPA layer, list endpoint, and zero-data-loss migration.
  - [x] 1.1 Write 2-8 focused tests for the architecture foundation.
    - Limit to 2-8 highly focused tests maximum.
    - Required tests:
      - `ArchitectureService.listForProject(projectId)` returns architectures ordered by `created_at` ascending.
      - `ArchitectureService.resolveDefault(projectId)` returns the oldest non-archived architecture (the "Default" semantic).
      - `ArchitectureService.resolveDefault(projectId)` skips archived architectures even if older.
      - **Liquibase integration test (the critical zero-data-loss test, on H2)** seeded with a fixture project + sample meta-model rows in at least 3 different in-scope tables. Asserts:
        - (a) Every in-scope meta-model row has non-null `architecture_id` after migration.
        - (b) Every project has exactly one architecture named `Default`.
        - (c) Per-table row counts unchanged before vs after.
        - (d) Re-running the migration is a no-op (idempotency — checksum-clean and zero rows changed on second run).
    - Skip exhaustive coverage of all entity / repository methods.
  - [x] 1.2 Compile the concrete in-scope table list.
    - Sweep `architecture-model-service/src/main/resources/db/changelog/sql/*.sql` and produce the authoritative list of meta-model tables that get an `architecture_id UUID NOT NULL` column.
    - Confirm against the spec's expected list (applications, application_components, services, application_points, classes, methods, packages, package_sets, business_users, business_processes, business_points, process_activities, business_logics, app_business_points, logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes, data_entity_points, data_movements, interfaces, endpoints, ui_screens, ui_components, ui_actions, ui_contracts, ui_characteristics, ui_workflow_transitions, events, states, state_transitions, activities, activity_flows, activity_partitions, activity_steps, user_journeys, user_journey_links, sequence_diagrams + sequence_* children, diagrams + diagram_* children, all *_relationships join tables, model_files).
    - Explicitly exclude: `project`, `delivery_teams`, `organisations`, `work_item*`, `project_artifact`, `product_definitions`, all `discovery_*` tables.
    - Document the final list inline in the migration changeset header comments.
  - [x] 1.3 Create new Liquibase changeset: `architecture` and `architecture_tag` tables.
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/0XX-architecture-and-tags.sql` (next sequential number).
    - `architecture`: `id UUID PK`, `project_id UUID FK NOT NULL`, `name TEXT NOT NULL`, `description TEXT NULL`, `archived BOOLEAN NOT NULL DEFAULT false`, `created_at TIMESTAMP`, `updated_at TIMESTAMP`.
    - `architecture_tag`: `architecture_id UUID FK`, `tag_value TEXT`, unique constraint on the pair.
    - Index on `architecture(project_id, archived, created_at)` to support the default-resolution query.
    - Register in `db.changelog-master.yaml`.
  - [x] 1.4 Create new Liquibase changeset: insert `Default` architecture per existing project.
    - File: `0XX-insert-default-architectures.sql`.
    - One row per existing `project.id`, `name='Default'`, deterministic UUID derived from `project.id` (use `uuid_generate_v5(project.id, 'multi-arch-default')` or equivalent H2/Postgres-compatible deterministic generation).
    - Idempotency: must be safe to re-run (use `INSERT ... WHERE NOT EXISTS` or equivalent).
  - [x] 1.5 Create new Liquibase changesets: add nullable `architecture_id` to every in-scope table.
    - One changeset per sensible batch of tables (grouped by domain, e.g. application/services, business, data, UI, events/states, activities, journeys, sequence diagrams, diagrams, relationships, model_files) for granular rollback.
    - Column: `architecture_id UUID NULL` initially.
  - [x] 1.6 Create new Liquibase changesets: backfill `architecture_id` on every in-scope table.
    - Per-table: `UPDATE <table> SET architecture_id = (SELECT id FROM architecture WHERE project_id = <table>.project_id AND name='Default')`.
    - Group into the same batches as 1.5 for rollback symmetry.
  - [x] 1.7 Create new Liquibase changesets: enforce `NOT NULL` + foreign key on `architecture_id`.
    - Per-table: `ALTER COLUMN architecture_id SET NOT NULL`, add FK to `architecture(id)`.
    - Add composite `(project_id, architecture_id)` indexes where existing query patterns warrant (use the table's existing `project_id` index list as a guide).
  - [x] 1.8 Create `ArchitectureEntity`, `ArchitectureTagEntity`, repository, mapper, DTO, service.
    - File locations:
      - `src/main/java/com/example/architecturemodel/model/entity/ArchitectureEntity.java`
      - `src/main/java/com/example/architecturemodel/model/entity/ArchitectureTagEntity.java`
      - `src/main/java/com/example/architecturemodel/repository/ArchitectureRepository.java`
      - `src/main/java/com/example/architecturemodel/service/ArchitectureService.java`
      - DTO + mapper alongside.
    - Model JPA shape on `DeliveryTeamEntity` (UUID id, project FK, `created_at`/`updated_at`, `@PrePersist` / `@PreUpdate` hooks).
    - Service exposes `listForProject(projectId)` and `resolveDefault(projectId)` (oldest non-archived).
    - Repository: `findByProjectIdOrderByCreatedAtAsc(projectId)` and a non-archived variant.
  - [x] 1.9 Create `ArchitectureController` with the single new endpoint.
    - File: `src/main/java/com/example/architecturemodel/controller/ArchitectureController.java`.
    - `GET /api/projects/{projectId}/architectures` returns `[{id, name, description, tags, archived, createdAt, updatedAt}]`.
    - No create / rename / archive / tag-management endpoints in this spec — those land in spec #3.
  - [x] 1.10 Ensure backend foundation tests pass.
    - Run ONLY the 2-8 tests written in 1.1.
    - Critically verify the Liquibase integration test's four assertions (a/b/c/d).
    - Verify the migration runs cleanly on a copy of the existing database (smoke check via local boot if practical).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass — including the four-part Liquibase integration test (zero-data-loss + idempotency).
- The full in-scope table list is documented in the migration changeset headers.
- `architecture` and `architecture_tag` tables exist with correct schema.
- One `Default` architecture exists per project after migration, with deterministic UUID.
- Every in-scope meta-model table has a `NOT NULL` `architecture_id` column with FK to `architecture(id)`.
- `GET /api/projects/{projectId}/architectures` returns the project's architectures.
- `ArchitectureService.resolveDefault(projectId)` returns the oldest non-archived architecture.
- No applied changeset has been edited in place.

---

### Backend Bucket A Refactor

#### Task Group 2: Architecture-Scoped Controllers, Services, and Repositories
**Dependencies:** Task Group 1
**Spec sections:** "Bucket A — architecture-scoped controllers", "`ModelController` URL shape" (decision #2 in requirements.md).

- [x] 2.0 Migrate every Bucket A controller, service, and repository to be architecture-scoped.
  - [x] 2.1 Write 2-8 focused tests for Bucket A controllers/services.
    - Limit to 2-8 highly focused tests maximum.
    - Required tests:
      - `ModelEntityController` (or one representative Bucket A controller) returns 200 when called with a valid `{projectId, architectureId}` pair.
      - The same controller returns 404 (Spring's `NoHandlerFoundException` / route mismatch) when `{architectureId}` is omitted from the URL — this is the core path-segment safety property.
      - Repository query for one representative entity (e.g. applications) filters by `architecture_id` in addition to `project_id` (returns rows from the matching architecture only, excludes rows from a sibling architecture in the same project).
      - `ModelController` responds at the new path `/api/model/projects/{projectId}/architectures/{architectureId}` and the old query-param form `/api/model?projectId=…` returns 404.
    - Skip exhaustive coverage of every controller and every CRUD action.
  - [x] 2.2 Update Bucket A controller URL mappings.
    - `MetaModelSummaryController`, `ModelEntityController`, `TemporaryDiagramController`, `UserJourneyDiagramController`, `UserJourneyOverviewDiagramController`, `UserJourneySyncController`: add `{architectureId}` path variable to all `@RequestMapping` / `@GetMapping` / etc.
    - URL shape: `/api/.../projects/{projectId}/architectures/{architectureId}/...`.
    - **No fallback / no default-resolution at the controller layer** — forgetting `{architectureId}` must produce a Spring 404.
  - [x] 2.3 Migrate `ModelController` from query-param to path-segment (hard cutover).
    - Old: `GET /api/model?projectId=…` — REMOVE entirely in this spec.
    - New: `GET /api/model/projects/{projectId}/architectures/{architectureId}`.
    - No back-compat layer.
  - [x] 2.4 Update Bucket A service signatures to accept `architectureId`.
    - Every Bucket A service method that takes `projectId` now also takes `architectureId`.
    - Pass `architectureId` through to repository queries.
  - [x] 2.5 Update Bucket A repository queries to filter by `architecture_id`.
    - Every existing query filtering by `project_id` adds `AND architecture_id = ?`.
    - Use the new composite indexes from 1.7 where applicable.
  - [x] 2.6 Confirm Bucket B and Bucket C controllers are untouched.
    - Bucket B (project-scoped, no URL change): `ProjectController`, `ActiveProjectController`, `ProjectSessionController`, `BootstrapController`, `DeliveryTeamController`, `WorkItemController`, `BookOfWorkController`, `WorkItemImplementContextController`, `WorkItemImplementWorkspaceController`, `ImplementContextResolutionController`, `ProjectArtifactController`, `RoadmapImportController`, `ProductDefinitionController`, `ProductSummaryController`, all `Discovery*Controller`s.
    - Bucket C (global, no change): `OrganisationController`, `PackageSetStandardsController`, `OasSpecController`, `ModelInterfacesController`, `SequenceDiagramController`.
  - [x] 2.7 Ensure Bucket A controller tests pass.
    - Run ONLY the 2-8 tests written in 2.1.
    - Critically verify the 404-on-missing-architectureId test passes for at least one representative endpoint.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass — including the path-segment 404 safety test and the `ModelController` cutover test.
- All Bucket A controller URLs include `{architectureId}` as a path variable.
- All Bucket A service methods accept `architectureId`.
- All Bucket A repository queries filter by both `project_id` and `architecture_id`.
- The old `/api/model?projectId=…` query-param form is gone.
- No Bucket B or Bucket C controller has been modified.

---

### Gateway Layer

#### Task Group 3: Gateway Proxy Routes, Architecture Model Client, and 404-Safety Verification
**Dependencies:** Task Group 2
**Spec sections:** "All Bucket A clients in the gateway and frontend are updated in lockstep", "Existing Code to Leverage" (`architectureModelClient.ts`).

- [x] 3.0 Update gateway proxy routes and client to embed `{architectureId}` for Bucket A endpoints.
  - [x] 3.1 Write 2-8 focused tests for gateway proxying.
    - Limit to 2-8 highly focused tests maximum.
    - Required tests:
      - `architectureModelClient.ts` Bucket A function (e.g. `fetchMetaModelSummary`) called with `architectureId` produces the correct upstream URL containing `/architectures/{architectureId}/`.
      - Bucket A function called WITHOUT `architectureId` (or with undefined) is a TypeScript / runtime failure — the function signature requires it.
      - **Gateway 404-safety integration test**: hit a Bucket A proxy route on the gateway WITHOUT `architectureId` in the URL → asserts 404 propagated (or gateway-side route mismatch). This is the path-segment safety property and MUST be verified end-to-end, not just trusted.
      - Bucket B function (e.g. `fetchProjectFolder`) is unchanged — does not require `architectureId`.
    - Use `jest.requireActual` spread when partially mocking `architectureModelClient.ts` per the project memory note.
    - Skip exhaustive coverage of every proxy route.
  - [x] 3.2 Update `gateway/src/services/architectureModelClient.ts`.
    - Every Bucket A function (functions that hit `MetaModelSummaryController`, `ModelEntityController`, `TemporaryDiagramController`, `UserJourneyDiagramController`, `UserJourneyOverviewDiagramController`, `UserJourneySyncController`, `ModelController`) accepts `architectureId: string` as a required parameter and embeds it in the URL.
    - Bucket B functions (`fetchProjectFolder`, `fetchProductName`, `fetchProductSummary`, threads, project metadata) are untouched.
    - Per memory: existing client functions `fetchProjectFolder`, `fetchProductName`, `fetchProductSummary`, `fetchMetaModelSummary` — `fetchMetaModelSummary` is Bucket A (gets `architectureId`), the others are Bucket B (untouched).
  - [x] 3.3 Update gateway proxy routes in `gateway/src/routes/index.ts` (and any related route files).
    - Bucket A proxy route definitions embed `:architectureId` as a path segment between `:projectId` and the rest of the path.
    - Read `architectureId` from `req.params` and pass through to the client function.
    - Bucket B proxy routes are unchanged.
  - [x] 3.4 Add new gateway proxy route for the list-architectures endpoint.
    - `GET /api/projects/:projectId/architectures` → proxies to architecture-model-service's same endpoint.
    - Returns the architectures array verbatim.
  - [x] 3.5 Update all gateway code calling Bucket A client functions.
    - Every call site that today calls a Bucket A function must extract `architectureId` from the request (`req.params.architectureId`) and pass it through.
    - If a call site lacks `architectureId` in the request shape, the route definition needs the path segment added.
  - [x] 3.6 Ensure gateway tests pass.
    - Run ONLY the 2-8 tests written in 3.1.
    - Critically verify the gateway 404-safety integration test passes (hit a Bucket A endpoint without `architectureId` → 404).
    - Do NOT run the entire gateway test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass — including the gateway 404-safety integration test.
- Every Bucket A function in `architectureModelClient.ts` requires `architectureId`.
- Every Bucket A proxy route in `gateway/src/routes/index.ts` embeds `:architectureId`.
- Every gateway call site of a Bucket A function passes `architectureId` from the request.
- The new `GET /api/projects/:projectId/architectures` proxy route exists.
- Bucket B client functions and routes are unchanged.

---

### Frontend

#### Task Group 4: ArchitectureContext Augmentation, architecturesApi, and API Client Threading
**Dependencies:** Task Group 3
**Spec sections:** "Default architecture resolution (frontend + discovery-service)", "Frontend wiring (no URL routing changes yet)", "Existing Code to Leverage" (`ProjectContext`).

- [x] 4.0 Augment frontend so every Bucket A API call threads `architectureId`, sourced from `ArchitectureContext`.
  - [x] 4.1 Write 2-8 focused tests for the frontend wiring.
    - Limit to 2-8 highly focused tests maximum (Vitest with `vi.mock()`).
    - Required tests:
      - `ArchitectureContext` resolves `activeArchitectureId` to the project's `Default` architecture (oldest non-archived) when a project loads — mock `listArchitectures` to return a fixture list and assert the context value.
      - `useActiveArchitectureId()` hook returns the resolved value.
      - One representative Bucket A API client function (e.g. `fetchMetaModelSummary` or equivalent in `frontend/src/api/`) called with `architectureId` produces a URL containing `/architectures/{architectureId}/`.
      - `architecturesApi.listArchitectures(projectId)` hits `GET /api/projects/{projectId}/architectures`.
    - Skip exhaustive coverage of every API client function.
  - [x] 4.2 Create `frontend/src/api/architecturesApi.ts`.
    - Exports `listArchitectures(projectId): Promise<Architecture[]>`.
    - Type `Architecture` mirrors the backend DTO: `{id, name, description, tags, archived, createdAt, updatedAt}`.
  - [x] 4.3 Augment `ArchitectureContext`.
    - **Augment the existing `frontend/src/contexts/ArchitectureContext.tsx`** — do NOT introduce a parallel context.
    - Add `activeArchitectureId: string | null` to the context value.
    - Add a `useEffect` initialiser (modelled on `ProjectContext`'s pattern) that, when a project loads, calls `listArchitectures(projectId)`, picks the oldest non-archived architecture, and sets `activeArchitectureId`.
    - Expose a narrow consumer hook `useActiveArchitectureId()` returning the resolved id (or null while loading).
    - Reset `activeArchitectureId` to null when the project changes.
  - [x] 4.4 Update every Bucket A frontend API client function.
    - Audit `frontend/src/api/*.ts` for every function hitting a Bucket A endpoint (meta-model summary, model entities, temporary diagrams, user journey diagrams, user journey overview diagrams, user journey sync, model load).
    - Each function accepts `architectureId: string` as a required parameter and embeds it in the URL: `/api/.../projects/{projectId}/architectures/{architectureId}/...`.
    - The model-load function specifically migrates from query-param form to path-segment form.
  - [x] 4.5 Update every call site of those API functions.
    - Every component / hook / context that calls a Bucket A API function reads `activeArchitectureId` from `ArchitectureContext` (via `useActiveArchitectureId()`) and passes it through.
    - Guard call sites where `activeArchitectureId` may still be null (project still loading) — skip the call, show a loading state, or return early. Do NOT default to a hardcoded value.
  - [x] 4.6 Confirm `react-router-dom` stays unused.
    - Per spec: URL-as-source-of-truth lands in spec #2. `react-router-dom` remains in `package.json` but is not introduced as a dependency in any code in this spec.
  - [x] 4.7 Ensure frontend tests pass.
    - Run ONLY the 2-8 tests written in 4.1.
    - Verify `ArchitectureContext` correctly resolves the Default and threads it into Bucket A calls.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- `ArchitectureContext` exposes `activeArchitectureId` and a `useActiveArchitectureId()` hook.
- `frontend/src/api/architecturesApi.ts` exists and exposes `listArchitectures`.
- Every Bucket A frontend API client function requires `architectureId` and embeds it in the URL.
- Every call site reads `activeArchitectureId` from context — no hardcoded defaults, no silent fallbacks.
- `react-router-dom` is NOT used in any code in this spec.
- No parallel `ArchitectureContext` introduced — the existing one is augmented.

---

### Discovery Service

#### Task Group 5: discovery-service Entity-Fetch Updates
**Dependencies:** Task Group 2 (the upstream URL shape must exist); can run in parallel with Task Groups 3 and 4.
**Spec sections:** "Discovery-service entity-fetch updates (the only discovery-service change)".

- [x] 5.0 Update discovery-service's three entity-fetch calls to be architecture-scoped, with a per-run cached resolver for the project's Default architecture.
  - **Constraint reminder:** only edit `discovery-service/src/**` when no discovery run is active. tsx watch auto-reloads kill in-flight runs. Confirm no run is active before starting this group.
  - [x] 5.1 Write 2-8 focused tests for the discovery-service updates.
    - Limit to 2-8 highly focused tests maximum.
    - Required tests:
      - The three entity-fetch helpers (services / applications / app_components) called with `architectureId` produce URLs of the form `/api/model/projects/{projectId}/architectures/{architectureId}/entities/<type>/<id>`.
      - The new "resolve default architecture for project" helper hits `GET /api/projects/{projectId}/architectures` and returns the oldest non-archived architecture's id.
      - The resolver caches per-project for the duration of a run — calling it twice for the same `projectId` results in only one upstream HTTP request.
    - Skip exhaustive coverage.
  - [x] 5.2 Add the per-run cached default-architecture resolver to `discovery-service/src/archModelClient.ts`.
    - New helper: `resolveDefaultArchitectureId(projectId): Promise<string>`.
    - Implementation: call `GET /api/projects/{projectId}/architectures`, pick oldest non-archived, return id.
    - Cache scope: per-project, per-run. Use a `Map<projectId, Promise<architectureId>>` keyed at the run's lifecycle. The exact lifecycle hook depends on the existing run-scoped state mechanism — match the pattern already used for other run-scoped caches in the discovery-service.
  - [x] 5.3 Update the three entity-fetch helpers in `discovery-service/src/archModelClient.ts`.
    - `getService(projectId, serviceId)` → `getService(projectId, architectureId, serviceId)` and URL changes to `/api/model/projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}`.
    - Same shape change for `getApplication` and `getAppComponent` (and corresponding URLs).
    - Update every call site within `discovery-service/src/**` to first call `resolveDefaultArchitectureId(projectId)` and pass the result.
  - [x] 5.4 Confirm discovery-service's own POST/GET/PUT/DELETE endpoints are unchanged.
    - Per spec: discovery-service's own integration with the architecture model is the entire scope of spec #4. Only the three entity-fetch calls in this client file change in this spec.
  - [x] 5.5 Ensure discovery-service tests pass.
    - Run ONLY the 2-8 tests written in 5.1.
    - Verify the per-run cache behaviour and URL shapes.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- The three entity-fetch helpers in `discovery-service/src/archModelClient.ts` take `architectureId` and embed it in the upstream URL.
- A per-project, per-run cached resolver for the default architecture exists and is used at every call site.
- No other code in `discovery-service/src/**` has been modified.
- No discovery run was active during these edits.

---

### Test Review and Gap Analysis

#### Task Group 6: Cross-Tier Test Review and Critical Gap Filling
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests across all tiers and fill critical gaps only.
  - [x] 6.1 Review tests from Task Groups 1-5.
    - Review the 2-8 tests written for backend foundation (Task 1.1) — including the four-part Liquibase integration test.
    - Review the 2-8 tests written for Bucket A controllers (Task 2.1) — including the path-segment 404 safety test and the ModelController cutover test.
    - Review the 2-8 tests written for the gateway (Task 3.1) — including the gateway 404-safety integration test.
    - Review the 2-8 tests written for the frontend (Task 4.1).
    - Review the 2-8 tests written for discovery-service (Task 5.1).
    - Total existing tests: approximately 10-40 tests.
  - [x] 6.2 Analyze test coverage gaps for THIS feature only.
    - Identify critical end-to-end workflows for multi-architecture plumbing that lack coverage.
    - Likely gap candidates (judge based on the actual review):
      - End-to-end: project loads → frontend resolves Default → Bucket A API call hits architecture-scoped backend route → returns scoped data.
      - End-to-end: discovery-service entity-fetch triggers `resolveDefaultArchitectureId` and reaches the right backend URL.
      - Sibling-architecture isolation: rows in architecture A do not leak into responses for architecture B (within the same project).
      - Idempotency-on-real-existing-DB smoke check beyond the H2 fixture.
    - Focus ONLY on gaps related to this spec's feature requirements.
    - Do NOT assess entire application test coverage.
    - Prioritize end-to-end workflows over unit test gaps.
  - [x] 6.3 Update assertions in existing test suites that touch new URL shapes.
    - Per spec: "Existing test suites (gateway Jest, frontend Vitest, architecture-model-service) continue to pass after assertions touching new URL shapes are updated."
    - This is mechanical assertion update, not new test writing — does NOT count against the 10-test budget in 6.4.
    - Find any test asserting on Bucket A URL shapes (old form: `/api/model?projectId=...`, or any meta-model URL lacking `/architectures/{architectureId}/`) and update to the new shape.
  - [x] 6.4 Write up to 10 additional strategic tests maximum.
    - Add a maximum of 10 new tests to fill identified critical gaps from 6.2.
    - Focus on integration points and end-to-end workflows.
    - Do NOT write comprehensive coverage for all scenarios.
    - Skip edge cases, performance tests, and accessibility tests unless business-critical.
  - [x] 6.5 Run feature-specific tests only.
    - Run the tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.4.
    - Run any pre-existing tests whose URL-shape assertions were updated in 6.3.
    - Expected total: approximately 20-50 tests.
    - Do NOT run the entire application test suite.
    - Verify all critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-50 tests total).
- Critical user-facing workflows for multi-architecture plumbing are covered end-to-end.
- No more than 10 additional tests added when filling testing gaps.
- Pre-existing test assertions touching new URL shapes have been updated and pass.
- Testing focused exclusively on this spec's feature requirements.
- The four critical safety properties are demonstrably tested:
  1. Liquibase migration is zero-data-loss + idempotent (Task 1.1).
  2. Bucket A endpoints 404 without `architectureId` at the controller layer (Task 2.1).
  3. Gateway proxies 404 without `architectureId` end-to-end (Task 3.1).
  4. Frontend resolves and threads `activeArchitectureId` correctly (Task 4.1).

---

## Execution Order

Recommended implementation sequence (strict dependency order):

1. **Task Group 1 — Backend Foundation** (schema, JPA, list endpoint, Liquibase migration). Migration MUST run cleanly on existing DB before anything else can be built on top.
2. **Task Group 2 — Backend Bucket A Refactor** (controllers, services, repositories take and filter by `architectureId`).
3. **Task Group 3 — Gateway Layer** (proxy routes embed `:architectureId`, client functions thread it through). Includes the gateway 404-safety integration test.
4. **Task Group 4 — Frontend** (ArchitectureContext augmentation, architecturesApi, API client threading, call-site updates). **Can run in parallel with Task Group 5.**
5. **Task Group 5 — Discovery Service** (three entity-fetch calls + per-run cached resolver). **Can run in parallel with Task Group 4.** Confirm no discovery run is active before starting.
6. **Task Group 6 — Test Review and Gap Analysis** (cross-tier review, update pre-existing URL-shape assertions, fill critical gaps with up to 10 additional tests).

**Critical safety verifications (do not let these slip):**
- Task 1.1 — the four-part Liquibase integration test (zero data loss + idempotency).
- Task 2.1 — Bucket A endpoint returns 404 without `architectureId`.
- Task 3.1 — gateway proxy returns 404 without `architectureId` end-to-end.
- Task 4.1 — `ArchitectureContext` resolves `activeArchitectureId` to the oldest non-archived.
