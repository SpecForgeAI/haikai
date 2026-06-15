# Task Breakdown: Multi-Architecture Full Clone (Spec #6)

## Overview
Total Tasks: 8 task groups. Sequenced strictly by dependency: backend service -> backend controller -> backend integration tests -> gateway proxy -> frontend API client -> frontend Clone modal -> frontend Manage modal extension -> test review and gap fill.

Each group is sized to be implementable independently by a single subagent call. Backend service work (Group 1) and the controller wiring (Group 2) can be claimed by one Java specialist in sequence; gateway work (Group 4) and frontend work (Groups 5-7) by their respective specialists.

## Task List

### Backend Layer (architecture-model-service)

#### Task Group 1: Clone service + exception + in-scope table sweep
**Dependencies:** None (relies only on shipped specs #1 and #3).

- [x] 1.0 Implement the transactional clone service
  - [x] 1.1 Write 2-8 focused unit tests for the clone service
    - Limit to 2-8 highly focused tests maximum.
    - Test only the critical service-level behaviours:
      - happy path: clone produces a new `architecture` row with the requested name/description/tags.
      - graph correctness: a duplicated dependent row (e.g. a relationship) has its FK columns rewired to point at the cloned base entity, NOT the source's entity (safety property (b) and (c)).
      - archived source path: invoking with an archived source throws `ArchivedArchitectureSourceException` (safety property (d)).
    - Skip exhaustive per-table assertions in this layer — graph-wide correctness is asserted in the integration test (Group 3).
    - Use the existing test base / `@DataJpaTest` or `@SpringBootTest` pattern from spec #3's `ArchitectureServiceTest`.
  - [x] 1.2 Sweep changeset `089-add-architecture-id-columns.sql` and compile the authoritative in-scope table list
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/089-add-architecture-id-columns.sql` (from spec #1).
    - Produce the ordered table list in dependency order: (1) base meta-model entities (applications, services, business processes, data entities, etc.), (2) dependent rows (relationships, diagrams + diagram children, app_business_points, *_relationships join tables, etc.).
    - Record this list as class-level Javadoc on the new clone service so future contributors can audit scope without re-sweeping the changeset (per requirements decision #15).
  - [x] 1.3 Create `ArchivedArchitectureSourceException`
    - New file: `architecture-model-service/src/main/java/com/example/architecturemodel/exception/ArchivedArchitectureSourceException.java`.
    - Mirror the shape of the existing `DuplicateArchitectureNameException` from spec #3 (RuntimeException subclass with a message constructor).
  - [x] 1.4 Wire `ArchivedArchitectureSourceException` into `GlobalExceptionHandler`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java`.
    - Map to HTTP 422 with body `{code: "archived_source"}`.
    - Mirror the existing pattern used for the last-architecture exception (also 422) and `DuplicateArchitectureNameException` (409).
  - [x] 1.5 Implement `ArchitectureCloneService.cloneArchitecture(projectId, sourceArchitectureId, payload)`
    - Implementer's choice: dedicated `ArchitectureCloneService` orchestrator (preferred — keeps `ArchitectureService` from ballooning) OR a method on `ArchitectureService`. The Javadoc with the in-scope table list lives wherever the implementation lives.
    - Wrap the entire body in a single Spring `@Transactional` boundary so any thrown exception triggers a full rollback (safety property (a)).
    - Steps:
      1. Load source architecture by `(projectId, sourceArchitectureId)`. 404 if missing.
      2. If `source.archived === true`, throw `ArchivedArchitectureSourceException`.
      3. Validate + trim payload via the existing `validateAndTrimName/Description/Tags` helpers from spec #3 (reuse — do NOT re-implement).
      4. Insert new `architecture` row + tag rows (relies on the unique-name index from Liquibase 092 to surface 409 via the existing `DuplicateArchitectureNameException` path).
      5. Build an in-memory `Map<UUID, UUID>` (`oldId -> newId`).
      6. For each in-scope base entity table (in the order from 1.2): load all rows where `architecture_id == sourceArchitectureId`, generate a fresh UUID for each, populate the map, insert with `architecture_id = newArchitectureId`.
      7. For each dependent table (in the order from 1.2): load all rows for the source architecture, generate a fresh UUID, look up every architecture-scoped FK column in the map and substitute the new id, insert with `architecture_id = newArchitectureId`.
      8. Return the new architecture DTO (same shape as spec #3's create response).
    - The map is per-call only — never persisted, never leaked across requests.
    - Threads (file-based) and `discovery_*` tables MUST NOT be touched (safety property (f)).
  - [x] 1.6 Ensure clone service unit tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Workaround for pre-existing broken backend test files blocking `mvn test-compile`: use `javac` direct-compile + `mvn surefire:test -Dtest=ArchitectureCloneServiceTest -Dmaven.test.skip=false -Dtests.skip=false` (per project memory).
    - Do NOT run the entire backend test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `ArchivedArchitectureSourceException` exists and `GlobalExceptionHandler` maps it to 422 `{code: "archived_source"}`.
- The clone service's class-level Javadoc enumerates every in-scope table from changeset 089.
- Clone is wrapped in a single `@Transactional` boundary.
- Threads and `discovery_*` tables are demonstrably untouched by the implementation (verified by inspection — no repository / file-IO calls into those scopes).

---

#### Task Group 2: Clone controller endpoint
**Dependencies:** Task Group 1.

- [x] 2.0 Expose the clone endpoint
  - [x] 2.1 Write 2-4 focused controller tests
    - Limit to 2-4 highly focused tests maximum (use `MockMvc` or the existing controller test pattern from spec #3).
    - Test only:
      - happy path: `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` with a valid body returns 201 + the new architecture DTO.
      - 422 on archived source: when the service throws `ArchivedArchitectureSourceException`, the response is 422 with `{code: "archived_source"}`.
    - Skip 409 / 400 controller-level coverage — those are exception-handler paths already tested by spec #3.
  - [x] 2.2 Add `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` to `ArchitectureController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ArchitectureController.java`.
    - Body shape: `{name, description?, tags?: string[]}`.
    - Returns 201 + new architecture DTO.
    - Delegate to `ArchitectureCloneService.cloneArchitecture(...)` (or `ArchitectureService.cloneArchitecture(...)` per Group 1's choice).
    - Mirror the path-segment URL pattern from spec #1's Bucket A and the request/response wiring style of spec #3's create endpoint.
  - [x] 2.3 Ensure controller tests pass
    - Run ONLY the 2-4 tests written in 2.1 (use the `javac` + surefire workaround from project memory).
    - Do NOT run the entire backend suite.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass.
- `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` returns 201 on happy path and 422 on archived source.
- 409 `duplicate_name` and 400 validation envelopes are produced by the existing `GlobalExceptionHandler` mappings (no new code required, verified by inspection).

---

#### Task Group 3: Backend integration test for graph-clone correctness
**Dependencies:** Task Groups 1 + 2.

- [x] 3.0 End-to-end graph-clone correctness test
  - [x] 3.1 Write 4-8 focused integration tests
    - Limit to 4-8 highly focused tests maximum. Use `@SpringBootTest` + a real (or testcontainers) DB so FK rewiring can be asserted.
    - Cover the safety properties exhaustively at this layer (this is the authoritative test for graph correctness):
      1. Every in-scope row is duplicated — for at least two base-entity tables and one dependent / join table (e.g. applications, business processes, *_relationships), assert row counts before vs after match.
      2. Cloned rows have fresh UUIDs distinct from source rows (safety property (b)) — assert `Set(sourceIds).intersection(Set(cloneIds))` is empty.
      3. FK rewiring: pick a relationship row whose `source_entity_id` references a base entity in the source architecture, clone, then assert the cloned relationship's `source_entity_id` is the cloned entity's id, NOT the source's (safety property (c)).
      4. Atomic rollback (safety property (a)): force an exception mid-clone (e.g. inject a repository spy that throws on the third base-entity insert) and assert zero new rows in the `architecture` table AND zero new rows in any in-scope table.
      5. 422 on archived source (safety property (d)).
      6. 409 on duplicate name (safety property (e)) — pre-create an architecture with the chosen clone name, then attempt to clone with that name, assert 409.
      7. Excluded scopes untouched (safety property (f)): assert `discovery_*` row counts are unchanged before vs after a clone, and assert no thread file is created/modified by the clone path (file-based check or absence of thread-IO mock invocations).
    - Reuse the existing integration-test base / fixtures from spec #3 wherever possible.
  - [x] 3.2 Ensure integration tests pass
    - Run ONLY the 4-8 tests written in 3.1.
    - Use the `javac` + surefire workaround.
    - Do NOT run the entire backend suite.

**Acceptance Criteria:**
- The 4-8 tests written in 3.1 pass.
- All seven safety properties listed in 3.1 have at least one direct test assertion.

---

### Gateway Layer

#### Task Group 4: Clone proxy route + client helper
**Dependencies:** Task Group 2 (the backend endpoint must exist for live integration; pure proxy tests can mock the upstream).

- [x] 4.0 Add the gateway clone proxy
  - [x] 4.1 Write 2-4 focused Jest tests
    - Limit to 2-4 highly focused tests maximum.
    - Cover:
      - URL shape: a `POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone` request hits the upstream URL `POST {architectureModelService}/api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` with the body forwarded verbatim.
      - Error envelope round-trip: a mocked upstream 422 `{code: "archived_source"}` response is returned to the client byte-for-byte (status + body) — same for 409 `duplicate_name` and 400 validation envelopes (one combined test is fine; spec #3's existing round-trip rule applies).
    - Mock the upstream HTTP call — do not start the Java service.
    - Heads-up from project memory: pre-existing failures in `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, etc. are NOT in scope; do not attempt to fix them.
  - [x] 4.2 Add `cloneArchitecture(projectId, sourceArchitectureId, payload)` to `architectureModelClient`
    - File: `gateway/src/services/architectureModelClient.ts`.
    - Mirror the shape of the existing `createArchitecture` / `updateArchitecture` helpers from spec #3.
    - Returns the upstream response body on 2xx; throws on non-2xx with the upstream status + body intact so the route handler can forward it.
  - [x] 4.3 Add the proxy route
    - File: `gateway/src/routes/architectures.ts`.
    - Route: `POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone`.
    - Pass-through proxy — no business logic in the gateway.
    - On upstream non-2xx, forward the status + body verbatim (per spec #3's error round-trip rule).
  - [x] 4.4 Ensure gateway tests pass
    - Run ONLY the 2-4 tests written in 4.1 (`npx jest gateway/src/__tests__/<your-new-file>.test.ts` or the equivalent path filter).
    - Do NOT run the entire gateway test suite.

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass.
- `cloneArchitecture` helper exists in `architectureModelClient.ts` and matches the shape of existing CRUD helpers.
- The proxy route forwards upstream 422 / 409 / 400 envelopes verbatim.

---

### Frontend Layer

#### Task Group 5: Frontend API client `cloneArchitecture`
**Dependencies:** Task Group 4 (gateway route exists).

- [x] 5.0 Add the frontend API helper
  - [x] 5.1 Write 2-4 focused Vitest tests
    - Limit to 2-4 highly focused tests maximum.
    - Cover:
      - happy path: `cloneArchitecture(projectId, sourceArchitectureId, payload)` returns the parsed `Architecture` on 201.
      - error path: a mocked 409 `{code: "duplicate_name"}` response causes a thrown `ArchitecturesApiError` carrying `{status: 409, body.code: "duplicate_name"}`.
    - Use `vi.mock()` per project conventions for `fetch`.
    - Heads-up from project memory: long pre-existing Vitest failure list — do not attempt fixes outside the new file.
  - [x] 5.2 Add `cloneArchitecture(projectId, sourceArchitectureId, payload): Promise<Architecture>`
    - File: `frontend/src/api/architecturesApi.ts`.
    - Mirror the shape of the existing `createArchitecture` / `updateArchitecture` helpers (which already throw `ArchitecturesApiError` on non-2xx — reuse, do not re-implement).
    - Hits gateway URL `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone`.
  - [x] 5.3 Ensure frontend API tests pass
    - Run ONLY the 2-4 tests written in 5.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass.
- `cloneArchitecture` exists in `architecturesApi.ts`, returns `Promise<Architecture>`, and throws `ArchitecturesApiError` with the correct shape on non-2xx.

---

#### Task Group 6: `CloneArchitectureModal` component
**Dependencies:** Task Group 5.

- [x] 6.0 Build the new clone modal
  - [x] 6.1 Write 4-8 focused Vitest tests
    - Limit to 4-8 highly focused tests maximum. Drive each test through the rendered modal (RTL).
    - Cover:
      1. Name field is pre-populated as `Copy of <source.name>` on open (e.g. `Copy of Default`).
      2. Description field is pre-populated from `source.description` on open.
      3. Tags chip area starts empty (no chips pre-loaded) — distinguishes from `EditArchitectureModal`.
      4. Submit calls `cloneArchitecture(projectId, source.id, {name, description, tags})` with the trimmed payload.
      5. Success path: after a resolved clone, calls `refreshArchitectures()`, then `setActiveArchitecture(newArch.id)` (safety property (h)), then `onClose()`.
      6. 409 `duplicate_name` surfaces inline under the Name field; modal stays open.
      7. 422 `archived_source` surfaces in the footer banner; modal stays open.
    - Mock `architecturesApi`, `ArchitectureContext` (`refreshArchitectures`, `setActiveArchitecture`), and the toast helper if present.
  - [x] 6.2 Create `CloneArchitectureModal.tsx`
    - File: `frontend/src/components/TopBar/CloneArchitectureModal.tsx`.
    - Plus matching `CloneArchitectureModal.module.css`.
    - Props: `{ open, onClose, projectId, source: Architecture }`.
    - Reuse the modal shell + tag-chip primitive from `EditArchitectureModal.tsx` (copy or extract a minimal shared helper — implementer's call). Do NOT extend `EditArchitectureModal` with a `mode='clone'` prop (locked decision #18).
    - Defaults on open:
      - Name: `Copy of <source.name>`.
      - Description: `source.description ?? ''`.
      - Tags: `[]` (empty).
    - Submit button label: `Clone` (NOT `Save changes` / NOT `Create`); disabled while invalid or in flight.
    - On submit: call `cloneArchitecture(projectId, source.id, {name, description, tags})`.
    - On success: call `refreshArchitectures()` from `useArchitectureContext()`, then `setActiveArchitecture(newArch.id)`, show a brief success toast (`Cloned <source.name> as <new-name>`) using the existing toast pattern, then `onClose()`.
    - On error: branch on the thrown `ArchitecturesApiError`:
      - 409 `duplicate_name` -> inline error under the Name field; modal stays open.
      - 422 `archived_source` -> footer error banner; modal stays open.
      - 400 validation -> footer error banner with the server message; modal stays open.
      - other -> generic footer error banner; modal stays open.
  - [x] 6.3 Ensure modal tests pass
    - Run ONLY the 4-8 tests written in 6.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 4-8 tests written in 6.1 pass.
- Defaults match decisions #2 and #3 (name `Copy of <source-name>`, description copied, tags empty).
- Success path calls `refreshArchitectures` then `setActiveArchitecture(newId)` then `onClose` (safety property (h)).
- 409 surfaces inline under the Name field; 422 surfaces in the footer.
- Component is its own file — `EditArchitectureModal` is not modified to support a `mode='clone'`.

---

#### Task Group 7: `ManageArchitecturesModal` extension — per-row Clone button
**Dependencies:** Task Group 6.

- [x] 7.0 Wire Clone into the Manage modal
  - [x] 7.1 Write 2-4 focused Vitest tests
    - Limit to 2-4 highly focused tests maximum.
    - Cover:
      1. A per-row `Clone` button is rendered for every non-archived row (alongside Edit + Archive).
      2. Clicking the Clone button on a row opens `<CloneArchitectureModal>` wired with that row's architecture as `source`.
      3. Regression check (safety property (g)): no Clone button is rendered on archived rows. Note: spec #3 already filters archived rows out of the Manage modal entirely, so this assertion is inherent — verify by ensuring the existing archived-row-filter test still passes (or extend it to also assert the Clone button is absent).
    - Update the existing `ManageArchitecturesModal.test.tsx` — do not duplicate tests already covering Edit / Archive.
    - Subagent regex-based edits warning (per project memory): if you sweep the existing test file, verify the output by reading it back — nested braces in the existing setup can break regex edits.
  - [x] 7.2 Add the Clone button to `ManageArchitecturesModal.tsx`
    - File: `frontend/src/components/TopBar/ManageArchitecturesModal.tsx`.
    - Add a third per-row action button: `Clone` (alongside Edit + Archive). Same button styling pattern as Edit / Archive (right-aligned action group).
    - Add local state: `cloningArchitecture: Architecture | null` (mirror the existing `editingArchitecture` / `archivingArchitecture` state pattern).
    - Render `<CloneArchitectureModal open={cloningArchitecture !== null} onClose={() => setCloningArchitecture(null)} projectId={projectId} source={cloningArchitecture} />` (with whatever guard pattern the file already uses for Edit / Archive modals).
    - No selector dropdown footer entry for Clone — Clone lives only in the Manage modal (locked decision #1). Do NOT add a Clone entry anywhere in `ArchitectureSelector` / dropdown components.
    - Archived-row filtering and last-architecture protection logic are untouched — Clone simply slots in as a third action.
  - [x] 7.3 Ensure Manage modal tests pass
    - Run ONLY the 2-4 tests written / updated in 7.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 2-4 tests written / updated in 7.1 pass.
- A per-row Clone button is rendered for non-archived rows in the Manage modal.
- Clicking it opens `<CloneArchitectureModal>` with the row's architecture as `source`.
- No Clone entry appears in the selector dropdown footer (regression check via inspection).
- Archived rows continue to be filtered out of the Manage modal (no behaviour change to spec #3's filter).

---

### Testing

#### Task Group 8: Test review and gap fill
**Dependencies:** Task Groups 1-7.

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests written in Task Groups 1-7
    - Group 1 (clone service): ~2-8 tests.
    - Group 2 (controller): ~2-4 tests.
    - Group 3 (integration / graph correctness): ~4-8 tests.
    - Group 4 (gateway proxy): ~2-4 tests.
    - Group 5 (frontend API client): ~2-4 tests.
    - Group 6 (Clone modal): ~4-8 tests.
    - Group 7 (Manage modal extension): ~2-4 tests.
    - Total existing tests: approximately 18-40 tests.
  - [x] 8.2 Verify all eight safety properties have direct test assertions
    - (a) Atomic rollback on forced exception -> Group 3.1 item 4.
    - (b) Cloned rows have fresh UUIDs -> Group 3.1 item 2.
    - (c) FK references rewired correctly -> Group 3.1 item 3.
    - (d) Archived source -> 422 `archived_source` -> Group 1.1 (service-level) and Group 3.1 item 5 (integration-level).
    - (e) Duplicate name -> 409 `duplicate_name` -> Group 3.1 item 6.
    - (f) Threads + Discovery runs NOT cloned -> Group 1 (inspection of implementation) + Group 3.1 item 7 (assertion).
    - (g) Clone button absent on archived rows in Manage modal -> Group 7.1 item 3 (regression check).
    - (h) Post-clone navigation: `setActiveArchitecture(newId)` called -> Group 6.1 item 5.
    - For any safety property without a direct callable test assertion, write one targeted test in 8.3.
  - [x] 8.3 Write up to 10 additional strategic tests maximum (only if 8.2 finds gaps)
    - Add a maximum of 10 new tests TOTAL to fill identified critical gaps.
    - Focus on integration points and end-to-end workflows for THIS spec only.
    - Do NOT write comprehensive coverage for all scenarios.
    - Do NOT add edge cases / performance / accessibility tests unless business-critical.
    - Do NOT attempt to fix any pre-existing failures listed in project memory (`bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, the long Vitest pre-existing failure list, etc.).
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature: the tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3.
    - Expected total: approximately 18-50 tests maximum.
    - Use the documented per-stack workarounds (`javac` + surefire for backend, scoped Jest / Vitest invocations for gateway / frontend).
    - Do NOT run the entire application test suite.
    - Verify all safety properties (a)-(h) have a passing direct assertion.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-50 tests total).
- All eight safety properties (a)-(h) have at least one direct, passing test assertion.
- No more than 10 additional tests added when filling gaps.
- Testing focused exclusively on this spec's feature requirements.
- No pre-existing failure in the project memory list was modified.

---

## Execution Order

Recommended implementation sequence (strict — each group depends on the prior):

1. Task Group 1 — Backend clone service + exception + in-scope table sweep.
2. Task Group 2 — Backend clone controller endpoint.
3. Task Group 3 — Backend integration test for graph-clone correctness.
4. Task Group 4 — Gateway proxy route + client helper.
5. Task Group 5 — Frontend API client `cloneArchitecture`.
6. Task Group 6 — `CloneArchitectureModal` component.
7. Task Group 7 — `ManageArchitecturesModal` extension.
8. Task Group 8 — Test review and gap fill.

---

## Critical Safety Properties (cross-reference)

| # | Safety property | Where tested |
|---|---|---|
| (a) | Backend clone is atomic — forced exception mid-clone rolls back the new architecture row. | Group 3.1 item 4 |
| (b) | Cloned rows have fresh UUIDs (different from source rows). | Group 3.1 item 2 |
| (c) | FK references are rewired (cloned relationship's `source_entity_id` points at the cloned entity, not the source's). | Group 3.1 item 3 |
| (d) | Archived source returns 422 `archived_source`. | Group 1.1 + Group 3.1 item 5 |
| (e) | Duplicate name returns 409 `duplicate_name`. | Group 3.1 item 6 |
| (f) | Threads + Discovery runs are NOT cloned. | Group 1 (inspection) + Group 3.1 item 7 |
| (g) | Frontend Clone button does not appear for archived rows in Manage modal (inherent — regression check). | Group 7.1 item 3 |
| (h) | Post-clone navigation: `setActiveArchitecture(newId)` called with the new architecture's id. | Group 6.1 item 5 |
