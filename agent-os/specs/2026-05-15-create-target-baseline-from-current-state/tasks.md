# Task Breakdown: Create Target Baseline from Current State

## Overview
Total Tasks: 8 task groups

This feature extends existing infrastructure heavily. The work is grouped around the natural integration seams of the stack: AMS persistence -> AMS service/orchestration -> AMS controller -> Gateway proxy -> frontend API client -> frontend UI surfaces -> cache-coherence fix -> cross-stack test gap review.

Standing constraints repeated for every implementer:
- Liquibase changesets 126 and earlier are immutable. Add NEW files only (next is `127-architecture-element-mappings.sql`).
- Do NOT edit `discovery-service/src/**` if a discovery run is active (no run currently active for this work).
- `confidence` MUST be a boxed `Double` on the JPA entity and DTO (primitive numerics silently overwrite to 0 on PATCH).
- All mapping caches/lists are fetched fresh from AMS in v1 (no source-side cache layer).

## Task List

### AMS Persistence Layer

#### Task Group 1: `architecture_element_mappings` table, JPA entity, repository
**Dependencies:** None
**Scope:** Liquibase changeset, JPA entity, Spring Data repository. No service/controller logic in this group.

- [x] 1.0 Complete AMS persistence layer for `architecture_element_mappings`
  - [x] 1.1 Write 2-8 focused tests for the persistence layer
    - One repository slice test that saves, finds-by-id, and deletes a mapping row
    - One repository test that the unique constraint on `(project_id, source_arch, target_arch, source_type, source_id, target_type, target_id, mapping_type)` rejects a duplicate insert
    - One entity test (or persistence test) that `@PrePersist` sets `createdAt` and `@PreUpdate` bumps `updatedAt`
    - One entity test that `confidence=null` round-trips correctly (boxed `Double`, not primitive)
    - Skip exhaustive coverage of every column/getter
  - [x] 1.2 Add Liquibase changeset `architecture-model-service/src/main/resources/db/changelog/sql/127-architecture-element-mappings.sql`
    - Columns per spec: `id` UUID PK, `project_id` UUID NOT NULL, `source_architecture_id` UUID NOT NULL, `target_architecture_id` UUID NOT NULL, `source_element_type` text NOT NULL, `source_element_id` text NOT NULL, `target_element_type` text NOT NULL, `target_element_id` text NOT NULL, `mapping_type` text NOT NULL, `status` text NOT NULL, `created_by_task` text NOT NULL, `created_at` timestamp NOT NULL, `updated_at` timestamp NOT NULL, `notes` text NULL, `confidence` double precision NULL
    - Unique constraint on `(project_id, source_architecture_id, target_architecture_id, source_element_type, source_element_id, target_element_type, target_element_id, mapping_type)`
    - Indexes: `(project_id, source_architecture_id, target_architecture_id)`, `(project_id, source_element_id)`, `(project_id, target_element_id)`
    - Pattern reference: `db/changelog/sql/126-discovery-run-service-id-set-null.sql` (style + author tag conventions)
  - [x] 1.3 Register the new changeset file in `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Append entry only; do NOT touch existing entries
  - [x] 1.4 Create JPA entity `ArchitectureElementMappingEntity`
    - Mirror `DiscoveryCandidateEntityMappingEntity` shape (Lombok `@Entity`, `@Builder`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`)
    - `@Table(name = "architecture_element_mappings")` with `@Index` annotations matching the migration
    - `confidence` field declared as `Double` (boxed) NOT `double` — primitive numerics silently overwrite to 0 on PATCH per `project_primitive_double_dto_overwrite.md`
    - `@PrePersist` sets `createdAt` and `updatedAt`; `@PreUpdate` bumps `updatedAt`
  - [x] 1.5 Create Spring Data repository `ArchitectureElementMappingRepository`
    - Extends `JpaRepository<ArchitectureElementMappingEntity, UUID>`
    - Derived query methods for the search filters in the controller spec: `findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId`, plus a `@Query` (or `Specification`) helper covering the optional `sourceElementType`, `targetElementType`, `mappingType`, `status`, free-text `q` filters
    - Existence check method to support the duplicate guard in the service layer (e.g. `existsByProjectIdAndSourceArchitectureIdAndTargetArchitectureIdAndSourceElementTypeAndSourceElementIdAndTargetElementTypeAndTargetElementIdAndMappingType`)
  - [x] 1.6 Ensure persistence tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify Liquibase migration applies cleanly on a fresh test schema
    - Do NOT run the full AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- New Liquibase changeset 127 is registered and applies cleanly
- Liquibase changesets 126 and earlier are unmodified
- `confidence` is a boxed `Double` on the entity
- Repository supports lookup by project + arch pair and the search filters

---

### AMS Service Layer

#### Task Group 2: `ArchitectureElementMappingService` + extension of `ArchitectureSelectiveCopyService`
**Dependencies:** Task Group 1
**Scope:** Two pieces of service-layer work:
(a) New `ArchitectureElementMappingService` for CRUD/search.
(b) Extension of the existing `ArchitectureSelectiveCopyService.commit` (or sibling `commitAndMap`) so copy + mapping inserts share one `@Transactional` boundary.

- [x] 2.0 Complete AMS service layer
  - [x] 2.1 Write 2-8 focused tests for the service layer
    - One unit test for `ArchitectureElementMappingService.create` happy path (validates required fields, sets timestamps via the entity)
    - One unit test that `create` rejects when `source_architecture_id == target_architecture_id` and when `mapping_type`/`status` are not in the v1 allowed lists
    - One unit test that `create` returns a structured duplicate error (e.g. throws a typed exception that the controller maps to `422 {code: "duplicate_mapping"}`) when the unique constraint would be violated
    - One integration test (Spring slice or `@DataJpaTest` + service) for the `commit` (or `commitAndMap`) extension: copy 2 source elements with `autoMap=true` and assert exactly 2 mapping rows are written under the same transaction, with `mapping_type=equivalent`, `status=confirmed`, `confidence=1.0`, `created_by_task=selective-copy-with-auto-map`
    - One integration test that a forced failure during mapping insert rolls back the entire copy (no orphan target entities, no orphan mapping rows)
    - Skip exhaustive validation matrix and edge-case coverage at this stage
  - [x] 2.2 Create `ArchitectureElementMappingService`
    - Mirror `DiscoveryCandidateEntityMappingService` shape (`@Service`, `@Transactional` for writes, `@Transactional(readOnly = true)` for reads)
    - Methods: `list(projectId, filters)`, `create(projectId, request)`, `update(projectId, mappingId, request)`, `delete(projectId, mappingId)`
    - Validation rules (per spec): both element type+id required; `mapping_type` and `status` in v1 allowed sets; `source_architecture_id != target_architecture_id`; both architecture ids belong to path `projectId` (reuse the `validateArchitectures` pattern from `ArchitectureSelectiveCopyService`)
    - On `update`: only `mappingType`, `status`, `notes`, `confidence` are mutable; service sets `created_by_task = mapping-review-modal-edit` server-side; `updated_at` is bumped via `@PreUpdate`
    - On `create` from manual-add path: service does NOT default `confidence` to 1.0 (1.0 is reserved for auto-map); honour the request value (which may be `null`)
  - [x] 2.3 Extend `ArchitectureSelectiveCopyService` for copy + auto-map
    - Add `boolean autoMap` to `SelectiveCopyCommitRequest` (default `false` for backward compatibility)
    - Inside the existing `@Transactional` `commit` method, after the cascading walk has produced the `sourceId -> newTargetId` map (and `entity_type`s) and BEFORE returning, write one `ArchitectureElementMappingEntity` per element actually copied when `autoMap=true`
    - Mapping defaults for the auto-map path: `mapping_type=equivalent`, `status=confirmed`, `confidence=1.0` (boxed), `created_by_task=selective-copy-with-auto-map`
    - Mapping insertion rules per spec: skipped rows produce no mapping; overwritten-without-ID-change rows produce no mapping; `duplicate` rows produce a mapping from the source element id to the new duplicate target id
    - Source/target `element_type` strings come from the existing in-scope table list (`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`) — no new registry
    - Allowed alternative if backward compat on `commit` is preferred: add a sibling `commitAndMap` method that delegates to a shared private writer; either path MUST keep copy + mapping inserts under one `@Transactional` boundary
    - Extend `SelectiveCopyCommitResponse` with `int createdMappingCount` (default 0 when `autoMap=false`)
  - [x] 2.4 Ensure service-layer tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify atomic rollback works (no orphan rows after a forced mapping insert failure)
    - Do NOT run the full AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `commit` (or `commitAndMap`) writes exactly the right mapping rows in the same transaction as the copy
- Atomic rollback on mapping-insert failure verified
- Validation rules enforced at the service layer for the v1 allowed `mapping_type` and `status` values
- Manual-add path does NOT silently default `confidence` to 1.0
- `confidence` updates via PATCH preserve `null` when omitted (no primitive wipe-to-zero)

---

### AMS Controller Layer

#### Task Group 3: `ArchitectureElementMappingController` + DTOs
**Dependencies:** Task Group 2
**Scope:** REST controller, request/response DTOs, error mapping. No business logic — delegates to the service.

- [x] 3.0 Complete AMS controller layer
  - [x] 3.1 Write 2-8 focused tests for the controller layer
    - One MockMvc test for `GET /api/projects/{projectId}/architecture-mappings` returning a filtered list (assert at least the `sourceArchitectureId` + `targetArchitectureId` filter pair is honoured)
    - One MockMvc test for `POST` happy-path returning `201` and the created DTO
    - One MockMvc test for `POST` returning `422 {code: "duplicate_mapping"}` on a duplicate
    - One MockMvc test for `PUT` updating only mutable fields (mappingType, status, notes, confidence) and returning `200` with updated DTO; verify `created_by_task` is set server-side to `mapping-review-modal-edit`
    - One MockMvc test for `DELETE` returning `204`
    - Skip exhaustive coverage of every filter combination
  - [x] 3.2 Create DTOs in the existing AMS DTO package
    - `ArchitectureElementMappingDto` (response shape: all 15 fields including timestamps and `confidence` as boxed `Double`)
    - `CreateArchitectureElementMappingRequest` (no `id`, no timestamps, no `created_by_task` — server-set)
    - `UpdateArchitectureElementMappingRequest` (only mutable fields: `mappingType`, `status`, `notes`, `confidence` — all boxed types so `null` is preserved on PATCH semantics)
  - [x] 3.3 Create `ArchitectureElementMappingController`
    - `@RequestMapping("/api/projects/{projectId}/architecture-mappings")`
    - `GET` with optional query params: `sourceArchitectureId`, `targetArchitectureId`, `sourceElementType`, `targetElementType`, `mappingType`, `status`, `q`
    - `POST` body: `CreateArchitectureElementMappingRequest`; returns `201` with `ArchitectureElementMappingDto`
    - `PUT /{mappingId}` body: `UpdateArchitectureElementMappingRequest`; returns `200` with `ArchitectureElementMappingDto`
    - `DELETE /{mappingId}` returns `204`
    - Reference shape: `ArchitectureController.java` (same `@PathVariable UUID projectId` pattern, same exception handling)
  - [x] 3.4 Map the duplicate exception thrown by the service to `422 {code: "duplicate_mapping"}`
    - Reuse the existing AMS exception-handler pattern; do not introduce a new global handler if one already covers structured error codes
  - [x] 3.5 Wire the new `autoMap` request field and `createdMappingCount` response field through the existing selective-copy controller endpoint
    - The existing `ArchitectureController` selective-copy commit handler binds the existing request DTO; confirm the new optional `autoMap` field flows through and the response DTO surfaces `createdMappingCount`
    - No new route for selective-copy commit
  - [x] 3.6 Ensure controller-layer tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the full AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- All five HTTP shapes (GET list, POST create, PUT update, DELETE, plus the extended selective-copy commit) behave per spec
- Duplicate creation returns `422 {code: "duplicate_mapping"}`
- DTO `confidence` is boxed `Double`; PATCH preserves `null`

---

### Gateway Proxy Layer

#### Task Group 4: Gateway proxy routes + typed client wrappers
**Dependencies:** Task Group 3
**Scope:** Thin proxy. No business logic. Mirrors the existing selective-copy proxy block in `gateway/src/routes/architectures.ts`.

- [x] 4.0 Complete Gateway proxy layer
  - [x] 4.1 Write 2-8 focused tests for the Gateway proxy
    - One Jest test that `GET /api/projects/:projectId/architecture-mappings` forwards query params verbatim to AMS and pass-through-returns the body and status
    - One Jest test that `POST /api/projects/:projectId/architecture-mappings` forwards the body verbatim and pass-through-returns `422 {code: "duplicate_mapping"}` when AMS returns it (verify `emitUpstreamError` path)
    - One Jest test that `PUT` and `DELETE` forward `mappingId` correctly and pass-through their AMS responses
    - One Jest test that the existing selective-copy commit proxy passes the new `autoMap` request flag and `createdMappingCount` response field through unchanged (no body shape transformation)
    - Skip coverage of every status code combination
  - [x] 4.2 Add proxy routes in `gateway/src/routes/architectures.ts`
    - `GET /api/projects/:projectId/architecture-mappings`
    - `POST /api/projects/:projectId/architecture-mappings`
    - `PUT /api/projects/:projectId/architecture-mappings/:mappingId`
    - `DELETE /api/projects/:projectId/architecture-mappings/:mappingId`
    - Use the existing `emitUpstreamError` pattern and `getModelServiceUrl()` URL construction (lines ~485-595 of the file are the verbatim template)
    - Delegate to typed client wrappers (next sub-task)
  - [x] 4.3 Add typed client wrappers in `gateway/src/services/architectureModelClient.ts`
    - `listArchitectureMappings(projectId, filters)`
    - `createArchitectureMapping(projectId, body)`
    - `updateArchitectureMapping(projectId, mappingId, body)`
    - `deleteArchitectureMapping(projectId, mappingId)`
    - Follow the same fetch + JSON + error-shape pattern used by existing selective-copy client functions
  - [x] 4.4 Confirm the existing selective-copy commit proxy needs no new route
    - The existing `POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/commit` proxy already passes the body verbatim — adding `autoMap` and surfacing `createdMappingCount` requires no route change, only confirmation in tests (covered by 4.1)
  - [x] 4.5 Ensure Gateway proxy tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the full Gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- All four new mapping proxy routes forward verbatim with status/body pass-through
- `autoMap` and `createdMappingCount` flow transparently through the existing selective-copy commit proxy
- No business logic added to the Gateway

---

### Frontend API Client + Type Layer

#### Task Group 5: `architecturesApi.ts` extensions and shared types
**Dependencies:** Task Group 4
**Scope:** Typed API client functions + shared TypeScript interfaces. No UI work.

- [x] 5.0 Complete frontend API client layer
  - [x] 5.1 Write 2-8 focused tests for the API client
    - One Vitest test for `listArchitectureMappings` that builds the correct URL with query params and parses the response
    - One Vitest test for `createArchitectureMapping` happy path
    - One Vitest test that all four new functions throw `ArchitecturesApiError` on non-2xx with `body.code` populated (e.g. `duplicate_mapping`)
    - Skip coverage of every individual function's happy path
  - [x] 5.2 Add TypeScript types in `frontend/src/services/architecturesApi.ts` (or co-located types file used by it)
    - `ArchitectureElementMappingDto` interface mirroring the AMS DTO (15 fields, `confidence: number | null`)
    - `CreateArchitectureElementMappingRequest`, `UpdateArchitectureElementMappingRequest` interfaces
    - Extend the existing `SelectiveCopyCommitRequest` interface with `autoMap?: boolean`
    - Extend the existing `SelectiveCopyCommitResponse` interface with `createdMappingCount: number`
    - String-literal union types for `MappingType` (`'equivalent' | 'renamed' | 'replaced_by' | 'split' | 'merged' | 'manual_review_required'`) and `MappingStatus` (`'confirmed' | 'proposed' | 'needs_review' | 'rejected'`)
  - [x] 5.3 Add typed exports in `architecturesApi.ts`
    - `listArchitectureMappings(projectId, filters)`
    - `createArchitectureMapping(projectId, body)`
    - `updateArchitectureMapping(projectId, mappingId, body)`
    - `deleteArchitectureMapping(projectId, mappingId)`
    - All throw `ArchitecturesApiError` on non-2xx so callers can branch on `body.code`
  - [x] 5.4 Ensure API client tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the full frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- All four new functions exported with correct TypeScript types
- `SelectiveCopyCommitRequest`/`Response` types extended with the new fields
- `ArchitecturesApiError.body.code` is exposed for `duplicate_mapping` branching

---

### Frontend UI: Wizard Extension + Entry Point

#### Task Group 6: `SelectiveCopyWizardModal` autoMap + Mapping Review step + `ManageArchitecturesModal` entry point
**Dependencies:** Task Group 5
**Scope:** Two related UI surfaces:
(a) Extend `SelectiveCopyWizardModal` to add the `autoMap` checkbox and the new in-modal Mapping Review step (4-step stepper).
(b) Add the per-row "Create Target Baseline" button in `ManageArchitecturesModal`.

- [x] 6.0 Complete wizard extension and entry-point UI
  - [x] 6.1 Write 2-8 focused tests for the new UI surfaces
    - One Vitest test that the `autoMap` checkbox renders, defaults to checked, and that toggling it changes the value passed to `commit`
    - One Vitest test that on commit success with `autoMap=true`, the wizard transitions to the Mapping Review step (does NOT close) and seeds the table from `listArchitectureMappings`
    - One Vitest test that closing/cancelling the Mapping Review step (Cancel/X) does NOT trigger any rollback API call and the success toast remains
    - One Vitest test that the Mapping Review table renders the columns and supports inline edit -> `updateArchitectureMapping` -> re-fetch
    - One Vitest test that the manual-add row sends `confidence=null` by default and `created_by_task=mapping-review-modal-add` server-side via `createArchitectureMapping`
    - One Vitest test that the new "Create Target Baseline" button in `ManageArchitecturesModal` opens `SelectiveCopyWizardModal` with the row as source, the active arch as target, and `autoMap` defaulted to `true`; the existing "Copy from..." button continues to default `autoMap` to `false`
    - Skip exhaustive interaction coverage (filters, sort orders, error toasts)
  - [x] 6.2 Extend `SelectiveCopyWizardModal.tsx`
    - Add `autoMap: boolean` to wizard state (default `false` when launched via existing "Copy from..." button; `true` when launched via new "Create Target Baseline" entry point — accept an initial value via props)
    - Add `autoMap` checkbox to step 2 (review/resolve) with label "Automatically map copied elements as equivalent (recommended)" and helper text "This is append-only. We will create new target elements and mapping rows; existing target elements are never overwritten."
    - Pass `autoMap` into the commit request body
    - Update stepper from 3 -> 4 steps: `1. Pick elements`, `2. Review & resolve`, `3. Commit`, `4. Review mappings`
    - On commit success with `autoMap=true`: do NOT auto-close. Transition into step 4 (Mapping Review), seeding from `listArchitectureMappings(projectId, { sourceArchitectureId, targetArchitectureId })`
    - On commit success with `autoMap=false`: preserve existing close-and-toast behaviour
    - Extend `buildSuccessToast` helper to append "N mappings created" segment when `createdMappingCount > 0`
    - Reuse existing `inFlightRef` token, `describeApiError`, `mergeAutoIncluded` helpers
  - [x] 6.3 Build the in-wizard Mapping Review step
    - Render inside the same `styles.content` container; new footer buttons: Close, Add manual mapping
    - Table columns: source element name, source element type, target element name, target element type, mapping type (dropdown), status (dropdown), confidence (numeric or em-dash if null), notes (inline editable text), actions (Save/Delete)
    - Filters above table: source element type, target element type, mapping type, status, free-text search (`q`)
    - Manual-add row: pickers constrained to current source and target architecture's element inventory (reuse `getElementsInventory` pattern from `SelectiveCopyElementPicker`); mapping_type dropdown; status dropdown; notes; confidence input pre-filled blank (do NOT pre-fill 1.0)
    - Edit/Delete actions call `updateArchitectureMapping` / `deleteArchitectureMapping`; each successful mutation re-fetches the list (no source-side cache layer in v1)
    - Element-name lookup: resolve element ids to display names by joining against `ElementInventoryResponse` for each architecture; fall back to raw id with type prefix when a name cannot be resolved
    - On `duplicate_mapping` error from create: surface inline error message with the body code
    - Closing/cancelling (Close button, X, Esc, click-outside) MUST NOT roll back the copy or auto-mappings; do not call any AMS rollback endpoint
  - [x] 6.4 Add "Create Target Baseline" button to `ManageArchitecturesModal.tsx`
    - Place per-row, next to the existing "Copy from..." button
    - Click handler opens `SelectiveCopyWizardModal` with `source = row architecture`, `target = active architecture`, `initialAutoMap = true`
    - Disabled with the same tooltip as "Copy from..." when the row is the active architecture
    - Existing "Copy from..." button remains unchanged and continues to default `autoMap` to `false`
    - No persona-task system integration in v1
  - [x] 6.5 Ensure wizard + entry-point tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the full frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- 4-step wizard renders correctly; step 4 only renders when `autoMap=true` after a successful commit (or when re-opened via the entry point)
- `autoMap` defaults: `true` when launched from "Create Target Baseline", `false` when launched from existing "Copy from..."
- Closing/cancelling Mapping Review does NOT call any rollback API
- Manual-add `confidence` defaults to `null` (blank input), NOT 1.0
- New entry-point button is disabled with the correct tooltip on the active architecture row

---

### Frontend Cache-Coherence Fix

#### Task Group 7: Target-architecture model cache invalidation in `ArchitectureContext` + `App.tsx` (AppShell)
**Dependencies:** Task Group 6
**Scope:** Make the AppShell per-(project, architecture) model cache coherent with backend writes that bypass the frontend dispatch path. Per `project_appshell_model_cache.md`, after a successful copy + auto-map, the target architecture cache MUST be refreshed (LOAD_MODEL if active) or invalidated (cross-arch).

- [x] 7.0 Complete cache-coherence fix for target architecture
  - [x] 7.1 Write 2-8 focused tests for the cache fix
    - One Vitest test that after `commit` returns successfully and `targetArchitectureId === activeArchitectureId`, the wizard dispatches `LOAD_MODEL` for the target architecture (assert `loadModelByProjectId` is called and `LOAD_MODEL` action is dispatched)
    - One Vitest test that when `targetArchitectureId !== activeArchitectureId`, the wizard calls a new `invalidateArchitectureModelCache(targetArchitectureId)` callback exposed via context, and that the cache entry is removed from AppShell's `cacheRef`
    - One Vitest test confirming NO source-side cache invalidation happens (source cache is untouched in v1)
    - Skip coverage of every cache-state permutation
  - [x] 7.2 Add `invalidateArchitectureModelCache(architectureId: string)` to `ArchitectureContext`
    - Expose via context value/props alongside `refreshArchitectures` and `loadModelByProjectId`
    - Implementation deletes the entry from the AppShell `cacheRef` (the underlying ref/state lives in `frontend/src/App.tsx`)
  - [x] 7.3 Wire the callback through AppShell in `App.tsx`
    - The `AppShell` owns the `cacheRef`; pass the cache-invalidation callback down through the `ArchitectureContext` provider
    - Same pattern documented in `project_appshell_model_cache.md`
  - [x] 7.4 Update the wizard's post-commit success path
    - After the existing `refreshArchitectures()` call, branch on whether `targetArchitectureId === activeArchitectureId`:
      - If equal: call `loadModelByProjectId(projectId, targetArchitectureId)` and dispatch `LOAD_MODEL` (same-arch cache reload)
      - If not equal: call `invalidateArchitectureModelCache(targetArchitectureId)` (cross-arch cache invalidation)
    - This branch runs regardless of whether `autoMap` was true (copy alone also writes new target rows that bypass the dispatch path)
    - No source-side cache invalidation
  - [x] 7.5 Ensure cache-coherence tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Do NOT run the full frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Same-arch case dispatches `LOAD_MODEL`; cross-arch case removes the entry from `cacheRef`
- Source-architecture cache is untouched
- Pattern matches `project_appshell_model_cache.md`

---

### Cross-Stack Test Gap Review

#### Task Group 8: Test review and gap analysis
**Dependencies:** Task Groups 1-7
**Scope:** Review the per-layer tests already written by groups 1-7 and add at most 10 additional strategic tests to cover end-to-end critical workflows for THIS feature only.

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 2-8 tests from each of Groups 1, 2, 3 (AMS persistence/service/controller)
    - Review the 2-8 tests from Group 4 (Gateway proxy)
    - Review the 2-8 tests from Groups 5, 6, 7 (frontend API client, UI surfaces, cache fix)
    - Total existing tests: approximately 14-56 tests across all layers
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess coverage for unrelated AMS/Gateway/frontend areas
    - Prioritize: full-stack copy + auto-map happy path, full-stack manual-add path, cross-architecture cache invalidation flow, atomic rollback observable end-to-end
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - Candidate gaps (pick the most impactful, max 10 total):
      - End-to-end: copy + auto-map via Gateway -> AMS, verify mapping rows present via `GET /architecture-mappings`
      - End-to-end: manual-add -> edit -> delete cycle through Gateway proxy
      - Wizard re-entry from `ManageArchitecturesModal` opens Mapping Review step with no fresh copy
      - Mapping Review filter combinations (one consolidated test)
      - Element-name fallback when `ElementInventoryResponse` lookup misses
      - Confidence PATCH that omits the field preserves existing value (boxed-Double regression test)
      - 422 duplicate-mapping toast surface in UI on manual-add collision
    - Do NOT write comprehensive coverage for all permutations
    - Skip accessibility, performance, and edge-case tests unless business-critical
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 24-66 tests maximum
    - Do NOT run the full AMS/Gateway/frontend test suites
    - Verify critical end-to-end workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-66 tests total across all layers)
- Critical end-to-end workflows for copy + auto-map and Mapping Review CRUD are covered
- No more than 10 additional tests added in this group
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:
1. AMS Persistence Layer (Task Group 1)
2. AMS Service Layer (Task Group 2)
3. AMS Controller Layer (Task Group 3)
4. Gateway Proxy Layer (Task Group 4)
5. Frontend API Client + Type Layer (Task Group 5)
6. Frontend UI: Wizard Extension + Entry Point (Task Group 6)
7. Frontend Cache-Coherence Fix (Task Group 7)
8. Cross-Stack Test Gap Review (Task Group 8)

Groups 5, 6, 7 may be partially overlapped if multiple frontend implementers are available, but Group 7 depends on the wizard's post-commit success path landed in Group 6 and should not start before Group 6's wizard skeleton is in place.
