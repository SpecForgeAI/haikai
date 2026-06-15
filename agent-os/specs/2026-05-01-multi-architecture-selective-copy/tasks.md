# Task Breakdown: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)

## Overview
Total Tasks: 11 task groups. Sequenced strictly by dependency: backend inventory service -> backend selective-copy service (preflight + commit) + new exception -> backend controller endpoints (3) -> backend integration test -> gateway proxy routes (3) + client helpers -> frontend API client (3 functions) -> element picker component -> conflict resolution component -> wizard modal shell -> Manage modal extension (Copy from button) -> test review and gap fill.

Each group is sized to be implementable independently by a single subagent call. Backend service work (Groups 1 + 2) and controller wiring (Group 3) can be claimed by one Java specialist in sequence. Frontend Groups 7-10 build the wizard from inside-out — picker, then resolution component, then wizard shell, then the Manage modal entry point.

This spec reuses spec #6's `ArchitectureCloneService` per-table generic copy mechanism (with an added id-filter argument), the `Map<UUID, UUID>` FK-rewiring strategy, the `ArchivedArchitectureSourceException` -> 422 mapping, and the `CloneArchitectureModal` shell pattern — none of these need re-implementing.

## Task List

### Backend Layer (architecture-model-service)

#### Task Group 1: Element inventory service + endpoint
**Dependencies:** None (relies only on shipped specs #1, #3, #6).

- [x] 1.0 Implement the read-only element inventory service + endpoint
  - [x] 1.1 Write 2-8 focused unit tests for `ArchitectureElementInventoryService`
    - Limit to 2-8 highly focused tests maximum.
    - Test only:
      - Domain ordering: returned `domains` list is in the canonical order `[Applications, Data, Business, UI, Behavioural, Diagrams]`.
      - Type grouping: instances of the same entity type collapse under one `type` node within a domain.
      - Empty-architecture path: an architecture with zero rows still returns the six domain shells (no nulls / no missing keys).
    - Skip exhaustive per-table coverage — Group 4's integration test exercises the full graph.
    - Use the `@DataJpaTest` or `@SpringBootTest` pattern from spec #3's `ArchitectureServiceTest`.
  - [x] 1.2 Create `ArchitectureElementInventoryService`
    - New file: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java`.
    - Method: `getInventory(UUID projectId, UUID architectureId): ElementInventoryResponse`.
    - Returns the shape `{domains: [{name, types: [{name, instances: [{id, name, archived?}]}]}]}` per spec.
    - Domain assignments: Applications (applications, services, components, etc.), Data (data entities), Business (business processes, capabilities), UI (ui elements), Behavioural (behaviours, interactions), Diagrams (all diagram tables). Cross-reference the in-scope table list from `ArchitectureCloneService`'s class-level Javadoc (compiled in spec #6).
    - 404 if either `projectId` or `architectureId` is missing within the project — throw whatever exception type `ArchitectureService` already throws for missing entities (mapped by `GlobalExceptionHandler`).
  - [x] 1.3 Create the response DTO
    - New file: `architecture-model-service/src/main/java/com/example/architecturemodel/dto/ElementInventoryResponse.java` (with nested `Domain`, `Type`, `Instance` records or POJOs as the codebase prefers).
    - Match the shape exactly: `{domains: [{name, types: [{name, instances: [{id, name, archived?}]}]}]}`.
  - [x] 1.4 Add `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory` to `ArchitectureController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ArchitectureController.java`.
    - Returns 200 + `ElementInventoryResponse` on happy path.
    - Returns 404 (via existing `GlobalExceptionHandler` mapping) if either id is missing.
    - Mirror the path-segment URL pattern from spec #1's Bucket A and the request/response wiring style of spec #3's GET endpoints.
  - [x] 1.5 Ensure inventory tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Workaround for pre-existing broken backend test files blocking `mvn test-compile`: use `javac` direct-compile + `mvn surefire:test -Dtest=ArchitectureElementInventoryServiceTest -Dmaven.test.skip=false -Dtests.skip=false` (per project memory).
    - Do NOT run the entire backend test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `ArchitectureElementInventoryService` returns the canonical 6-domain shell for any valid architecture.
- `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory` returns 200 + the inventory shape on happy path and 404 on missing ids.
- Excluded scopes (threads, `discovery_*`, project-scoped tables) are demonstrably absent from the inventory by inspection — no repository / file-IO calls into those scopes (safety property (g)).

---

#### Task Group 2: Selective-copy service (preflight + commit) + new exception
**Dependencies:** Task Group 1.

- [x] 2.0 Implement the transactional selective-copy service
  - [x] 2.1 Write 4-8 focused unit tests for `ArchitectureSelectiveCopyService`
    - Limit to 4-8 highly focused tests maximum.
    - Test only:
      1. Preflight conflict detection: when an elementId in the user's selection already exists in the target by UUID match, the response includes a `same_uuid` conflict for that element (safety property (b)).
      2. Preflight smart cascading - missing reference path: when a selected element references an element absent from the target, the missing reference is added to `autoIncluded` with `includedBecause: '<parent name>'` (safety property (d) - missing branch).
      3. Preflight smart cascading - UUID match path: when a selected element references an element ALREADY present in the target by UUID match, the reference is silently reused — NO entry in `conflicts` and NO entry in `autoIncluded` (safety property (d) - reuse branch).
      4. Same-architecture refusal: invoking preflight or commit with `sourceArchitectureId === targetArchitectureId` throws `SameArchitectureCopyException` (safety property (f)).
      5. Archived source refusal: invoking preflight or commit with an archived source throws `ArchivedArchitectureSourceException` (safety property (e)).
    - Skip exhaustive resolution-action coverage at this layer — Group 4's integration test exercises skip / overwrite / duplicate semantics on real data.
  - [x] 2.2 Create `SameArchitectureCopyException`
    - New file: `architecture-model-service/src/main/java/com/example/architecturemodel/exception/SameArchitectureCopyException.java`.
    - Mirror the shape of `ArchivedArchitectureSourceException` from spec #6 (RuntimeException subclass with a message constructor).
  - [x] 2.3 Wire `SameArchitectureCopyException` into `GlobalExceptionHandler`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java`.
    - Map to HTTP 422 with body `{code: "same_architecture", message: "Cannot selectively copy into the same architecture"}`.
    - Mirror the existing pattern used for `ArchivedArchitectureSourceException` (also 422).
    - Also add a `missing_reference` 422 mapping (will be thrown by the commit path) - body `{code: "missing_reference"}`. Implementer's choice: a dedicated `UnresolvedMissingReferenceException` mirroring the same pattern, OR an existing generic exception with a `code` field — prefer the dedicated exception for symmetry with the rest of the codebase.
  - [x] 2.4 Create the request + response DTOs
    - New files in `architecture-model-service/src/main/java/com/example/architecturemodel/dto/`:
      - `SelectiveCopyPreflightRequest` — `{sourceArchitectureId: UUID, elementIds: List<UUID>}`.
      - `SelectiveCopyPreflightResponse` — `{conflicts: List<Conflict>, autoIncluded: List<AutoIncluded>, summary: Summary}` with nested records for each.
      - `SelectiveCopyCommitRequest` — `{sourceArchitectureId: UUID, elementIds: List<UUID>, resolutions: List<Resolution>}` where `Resolution = {elementId: UUID, action: 'skip'|'overwrite'|'duplicate'}`.
      - `SelectiveCopyCommitResponse` — `{copied: int, skipped: int, overwritten: int, duplicated: int, autoIncluded: int}`.
    - Match shapes exactly per the spec.
  - [x] 2.5 Implement `ArchitectureSelectiveCopyService.preflight(...)`
    - New file: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java`.
    - Method: `preflight(UUID projectId, UUID targetArchitectureId, SelectiveCopyPreflightRequest request): SelectiveCopyPreflightResponse`.
    - Steps:
      1. Load source + target architectures by `(projectId, *ArchitectureId)`. 404 if either missing.
      2. If `source.id == target.id`, throw `SameArchitectureCopyException`.
      3. If `source.archived === true`, throw `ArchivedArchitectureSourceException`.
      4. Resolve the user's `elementIds` set + walk FK references (BFS / DFS from each selected element). For each referenced id:
         - If the referenced id exists in the target by UUID match -> silently reuse (no entry).
         - If the referenced id is missing in the target AND not already in the user's selection -> add to the working "auto-included" set with the parent's name.
      5. For every elementId in the resolved set (selected + auto-included): query the corresponding architecture-scoped table for an existing target row with the same id. If present -> add to `conflicts` with `conflictReason: 'same_uuid'`.
      6. Compute the `summary` counts and return.
    - NO state mutation — preflight is read-only.
    - Class-level Javadoc references the same in-scope table list documented in `ArchitectureCloneService` (per spec).
  - [x] 2.6 Implement `ArchitectureSelectiveCopyService.commit(...)`
    - Method: `commit(UUID projectId, UUID targetArchitectureId, SelectiveCopyCommitRequest request): SelectiveCopyCommitResponse`.
    - Wrap the entire body in a single Spring `@Transactional` boundary so any thrown exception triggers a full rollback (safety property (a)).
    - Steps:
      1. Re-validate (steps 1-3 from `preflight`) — defence in depth.
      2. Re-run the cascading walk to compute the resolved id set + auto-include set (same logic as preflight). If any selected element still has a missing reference at this point (e.g. user un-ticked an auto-included element), throw the missing-reference exception (mapped to 422 `missing_reference` by Group 2.3).
      3. Build the per-call `Map<UUID, UUID>` (`oldId -> newId`) for elements receiving a fresh UUID via the `duplicate` action (any other element keeps its existing id — `skip` and `overwrite` and `auto-include-without-conflict` all preserve ids).
      4. For each in-scope base entity table (in the order from `ArchitectureCloneService`'s Javadoc): for each row in the source whose pk is in the resolved id set, apply the per-element resolution:
         - `skip` -> do nothing (the element will not be inserted; FK refs from other copied elements pointing at this id remain pointing at the existing target row, by definition of the conflict).
         - `overwrite` -> UPDATE the target row in place using the source row's column values; id preserved (safety property (c)).
         - `duplicate` -> INSERT a new row with a freshly generated UUID and the source row's other column values; populate the FK rewire map.
         - no-conflict (`autoIncluded` or selected-without-conflict) -> INSERT verbatim with the source's id preserved.
      5. For each dependent table (in the order from `ArchitectureCloneService`'s Javadoc): same as step 4, but additionally rewire every architecture-scoped FK column via the `oldId -> newId` map for `duplicate`-action rows from OTHER elements in the copy set. Refs from non-copied target elements are NOT updated (out of scope by design — local rewiring only).
      6. Return `SelectiveCopyCommitResponse` with counts.
    - Reuse spec #6's `ArchitectureCloneService` per-table generic JdbcTemplate + `DatabaseMetaData` mechanism — extend the existing private copy method (or add a sibling method) that accepts an id-filter set + a mode flag (`insert` / `update` / `skip-by-id`).
    - The FK rewire map is per-call only — never persisted, never leaked across requests.
    - Threads (file-based) and `discovery_*` tables MUST NOT be touched (safety property (g)).
  - [x] 2.7 Ensure selective-copy service unit tests pass
    - Run ONLY the 4-8 tests written in 2.1.
    - Use the `javac` + surefire workaround per project memory.
    - Do NOT run the entire backend test suite at this stage.

**Acceptance Criteria:**
- The 4-8 tests written in 2.1 pass.
- `SameArchitectureCopyException` exists and `GlobalExceptionHandler` maps it to 422 `{code: "same_architecture"}`.
- `missing_reference` -> 422 mapping is in place (dedicated exception or shared mapping per implementer choice).
- `ArchitectureSelectiveCopyService.preflight(...)` is read-only and returns the spec'd response shape.
- `ArchitectureSelectiveCopyService.commit(...)` is wrapped in a single `@Transactional` boundary.
- `commit` reuses `ArchitectureCloneService`'s per-table generic copy mechanism with an id-filter argument.
- Threads + `discovery_*` tables are demonstrably untouched by the implementation (verified by inspection).

---

#### Task Group 3: Selective-copy controller endpoints (preflight + commit)
**Dependencies:** Task Group 2.

- [x] 3.0 Expose the preflight + commit endpoints
  - [x] 3.1 Write 2-6 focused controller tests
    - Limit to 2-6 highly focused tests maximum (use `MockMvc` or the existing controller test pattern from spec #3 / spec #6).
    - Test only:
      1. Happy path preflight: `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight` with a valid body returns 200 + the preflight response shape.
      2. Happy path commit: `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit` with a valid body returns 200 + the commit response shape.
      3. 422 on same-architecture: when the service throws `SameArchitectureCopyException`, the response is 422 with `{code: "same_architecture"}` (safety property (f)).
      4. 422 on archived source: when the service throws `ArchivedArchitectureSourceException`, the response is 422 with `{code: "archived_source"}` (safety property (e)).
    - Skip 404 / 400 controller-level coverage — those are exception-handler paths already tested by specs #3 and #6.
  - [x] 3.2 Add `POST .../selective-copy/preflight` to `ArchitectureController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ArchitectureController.java`.
    - Body: `SelectiveCopyPreflightRequest`.
    - Returns 200 + `SelectiveCopyPreflightResponse`.
    - Delegate to `ArchitectureSelectiveCopyService.preflight(...)`.
  - [x] 3.3 Add `POST .../selective-copy/commit` to `ArchitectureController`
    - Same file.
    - Body: `SelectiveCopyCommitRequest`.
    - Returns 200 + `SelectiveCopyCommitResponse`.
    - Delegate to `ArchitectureSelectiveCopyService.commit(...)`.
  - [x] 3.4 Ensure controller tests pass
    - Run ONLY the 2-6 tests written in 3.1 (use the `javac` + surefire workaround from project memory).
    - Do NOT run the entire backend suite.

**Acceptance Criteria:**
- The 2-6 tests written in 3.1 pass.
- Both `POST .../selective-copy/preflight` and `POST .../selective-copy/commit` exist and return their spec'd response shapes on happy path.
- 422 `same_architecture` and 422 `archived_source` are produced by the existing `GlobalExceptionHandler` mappings.
- 404 (missing architecture) is produced by the existing handler (no new code required, verified by inspection).

---

#### Task Group 4: Backend integration test for selective-copy correctness
**Dependencies:** Task Groups 1 + 2 + 3.

- [x] 4.0 End-to-end selective-copy correctness test
  - [x] 4.1 Write 6-10 focused integration tests
    - Limit to 6-10 highly focused tests maximum. Use `@SpringBootTest` + H2 (or the existing testcontainers setup) so FK rewiring + UPDATE semantics can be asserted.
    - Cover the safety properties exhaustively at this layer (this is the authoritative test for selective-copy graph correctness):
      1. Atomic commit (safety property (a)): force an exception mid-commit (e.g. inject a repository spy that throws on the third base-entity insert) and assert ZERO new rows in any in-scope table for the target architecture, AND assert no UPDATEs persisted from earlier `overwrite` actions either (full rollback).
      2. Conflict detection (safety property (b)): pre-seed the target with a row sharing a UUID with one of the selected elements; preflight returns that elementId in `conflicts` with `conflictReason: 'same_uuid'`.
      3. `skip` resolution semantics (safety property (c) - skip): commit with `skip` for a conflicting element. Assert: target row is unchanged; no new row was inserted; FK refs from OTHER copied elements pointing at this id still resolve to the (untouched) existing target row.
      4. `overwrite` resolution semantics (safety property (c) - overwrite): commit with `overwrite` for a conflicting element. Assert: target row's column values now match the source row; id is preserved (UPDATE, not INSERT); downstream references unchanged.
      5. `duplicate` resolution semantics (safety property (c) - duplicate): commit with `duplicate` for a conflicting element. Assert: a NEW row with a freshly generated UUID exists in the target; FK refs from OTHER elements in the copy set pointing at the original id are rewired to the new id; refs from non-copied target elements are NOT updated.
      6. Smart cascading - missing branch (safety property (d) - missing): select a relationship whose source/target entity is absent from the target. Preflight returns the missing entity in `autoIncluded` with the relationship's name in `includedBecause`. Commit succeeds and inserts both the entity and the relationship.
      7. Smart cascading - reuse branch (safety property (d) - reuse): select a relationship whose source/target entity is ALREADY present in the target by UUID match. Preflight does NOT add the entity to `autoIncluded` and does NOT add it to `conflicts`. Commit inserts the relationship with its FK pointing at the (untouched) existing target entity.
      8. Refuse archived source (safety property (e)): pre-seed an archived source; preflight + commit both return 422 `{code: "archived_source"}`.
      9. Refuse same-architecture (safety property (f)): preflight + commit with `sourceArchitectureId === targetArchitectureId` both return 422 `{code: "same_architecture"}`.
      10. Excluded scopes untouched (safety property (g)): assert `discovery_*` row counts are unchanged before vs after a selective copy, and assert no thread file is created/modified by the commit path (file-based check or absence of thread-IO mock invocations).
    - Reuse the existing integration-test base / fixtures from spec #6 wherever possible.
  - [x] 4.2 Ensure integration tests pass
    - Run ONLY the 6-10 tests written in 4.1.
    - Use the `javac` + surefire workaround.
    - Do NOT run the entire backend suite.

**Acceptance Criteria:**
- The 6-10 tests written in 4.1 pass.
- Safety properties (a)-(g) all have at least one direct test assertion at this layer.

---

### Gateway Layer

#### Task Group 5: Gateway proxy routes (3) + client helpers (3)
**Dependencies:** Task Group 3 (the backend endpoints must exist for live integration; pure proxy tests can mock the upstream).

- [x] 5.0 Add the gateway selective-copy proxies + client helpers
  - [x] 5.1 Write 2-6 focused Jest tests
    - Limit to 2-6 highly focused tests maximum.
    - Cover:
      1. URL shape preflight: `POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/preflight` hits the upstream URL with the same path and forwards the body verbatim.
      2. URL shape commit: same for `.../selective-copy/commit`.
      3. URL shape inventory: `GET /api/projects/:projectId/architectures/:architectureId/elements-inventory` hits the upstream URL with the same path.
      4. Error envelope round-trip: a mocked upstream 422 `{code: "archived_source"}` response is returned to the client byte-for-byte (status + body) — also covers 422 `same_architecture`, 422 `missing_reference`, 404, 409, and 400 validation envelopes (one combined parameterised test is fine; spec #3's existing round-trip rule applies).
    - Mock the upstream HTTP call — do not start the Java service.
    - Heads-up from project memory: pre-existing failures in `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, etc. are NOT in scope; do not attempt to fix them.
    - New test file: `gateway/src/__tests__/multiArchitectureSelectiveCopyProxy.test.ts`.
  - [x] 5.2 Add three helpers to `architectureModelClient.ts`
    - File: `gateway/src/services/architectureModelClient.ts`.
    - Helpers:
      - `selectiveCopyPreflight(projectId, targetArchitectureId, payload)`.
      - `selectiveCopyCommit(projectId, targetArchitectureId, payload)`.
      - `getElementsInventory(projectId, architectureId)`.
    - Mirror the shape of the existing `cloneArchitecture` helper from spec #6.
    - Returns the upstream response body on 2xx; throws on non-2xx with the upstream status + body intact so the route handler can forward it.
  - [x] 5.3 Add the three proxy routes
    - File: `gateway/src/routes/architectures.ts`.
    - Routes:
      - `POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/preflight`.
      - `POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/commit`.
      - `GET /api/projects/:projectId/architectures/:architectureId/elements-inventory`.
    - Pass-through proxies — no business logic in the gateway.
    - On upstream non-2xx, forward the status + body verbatim (per spec #3's error round-trip rule).
  - [x] 5.4 Ensure gateway tests pass
    - Run ONLY the 2-6 tests written in 5.1 (`npx jest gateway/src/__tests__/multiArchitectureSelectiveCopyProxy.test.ts` or an equivalent path filter).
    - Do NOT run the entire gateway test suite.

**Acceptance Criteria:**
- The 2-6 tests written in 5.1 pass.
- Three helpers (`selectiveCopyPreflight`, `selectiveCopyCommit`, `getElementsInventory`) exist in `architectureModelClient.ts` and match the shape of existing CRUD helpers.
- All three proxy routes forward upstream 422 / 409 / 400 / 404 envelopes verbatim.

---

### Frontend Layer

#### Task Group 6: Frontend API client (3 functions)
**Dependencies:** Task Group 5 (gateway routes exist).

- [x] 6.0 Add the three frontend API helpers
  - [x] 6.1 Write 2-6 focused Vitest tests
    - Limit to 2-6 highly focused tests maximum.
    - Cover:
      1. Happy path inventory: `getElementsInventory(projectId, architectureId)` returns the parsed inventory shape on 200.
      2. Happy path preflight: `selectiveCopyPreflight(projectId, targetArchitectureId, payload)` returns the parsed preflight response on 200.
      3. Happy path commit: `selectiveCopyCommit(projectId, targetArchitectureId, payload)` returns the parsed commit response on 200.
      4. Error path: a mocked 422 `{code: "same_architecture"}` response causes a thrown `ArchitecturesApiError` carrying `{status: 422, body.code: "same_architecture"}` (representative — covers all branches the wizard switches on).
    - Use `vi.mock()` per project conventions for `fetch`.
    - Heads-up from project memory: long pre-existing Vitest failure list — do not attempt fixes outside the new file.
  - [x] 6.2 Add three functions to `architecturesApi.ts`
    - File: `frontend/src/api/architecturesApi.ts`.
    - Functions:
      - `getElementsInventory(projectId, architectureId): Promise<ElementInventoryResponse>`.
      - `selectiveCopyPreflight(projectId, targetArchitectureId, payload): Promise<SelectiveCopyPreflightResponse>`.
      - `selectiveCopyCommit(projectId, targetArchitectureId, payload): Promise<SelectiveCopyCommitResponse>`.
    - Mirror the shape of the existing `cloneArchitecture` helper from spec #6 (already throws `ArchitecturesApiError` on non-2xx — reuse, do not re-implement).
    - Add typed response interfaces (`ElementInventoryResponse`, `SelectiveCopyPreflightResponse`, `SelectiveCopyCommitResponse`, `Conflict`, `AutoIncluded`, `Resolution`, etc.) matching the backend DTOs.
    - Hits gateway URLs identically to the backend paths.
  - [x] 6.3 Ensure frontend API tests pass
    - Run ONLY the 2-6 tests written in 6.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 2-6 tests written in 6.1 pass.
- Three functions exist in `architecturesApi.ts`, return their spec'd typed shapes, and throw `ArchitecturesApiError` with the correct shape on non-2xx.
- Typed response interfaces match the backend DTOs exactly.

---

#### Task Group 7: `SelectiveCopyElementPicker` component
**Dependencies:** Task Group 6.

- [x] 7.0 Build the element picker tree component
  - [x] 7.1 Write 4-8 focused Vitest tests
    - Limit to 4-8 highly focused tests maximum. Drive each test through the rendered component (RTL).
    - Cover:
      1. Tree renders the canonical 6 domain groups (Applications, Data, Business, UI, Behavioural, Diagrams) when given a populated inventory.
      2. Tri-state propagation downward: checking a domain checkbox checks all its types and all their instances.
      3. Tri-state propagation upward: checking some-but-not-all instances within a type renders the type's checkbox in indeterminate state; the parent domain also renders indeterminate.
      4. Search filtering: typing into the search box filters tree nodes by name across all domains client-side (no API round-trip).
      5. Auto-included badge: an element passed in the `autoIncluded` prop renders with the `auto-included` badge + tooltip text including its parent's name.
      6. Un-tick auto-included: un-ticking an auto-included element fires the `onSelectionChange` callback with that element removed from the selection set.
    - Mock no external dependencies — the picker is a pure presentation component receiving inventory + selection state via props.
  - [x] 7.2 Create `SelectiveCopyElementPicker.tsx`
    - File: `frontend/src/components/TopBar/SelectiveCopyElementPicker.tsx`.
    - Plus matching `SelectiveCopyElementPicker.module.css`.
    - Props: `{ inventory: ElementInventoryResponse, selectedIds: Set<string>, autoIncluded: AutoIncluded[], onSelectionChange: (newSelection: Set<string>) => void }`.
    - Tree structure: top-level domain groups (Applications, Data, Business, UI, Behavioural) + Diagrams as a separate bottom group. Each domain expands to entity types; each type expands to instances.
    - Tri-state checkboxes at every internal node — descendant state computes the parent's `indeterminate` vs `checked` vs `unchecked` render. Use the standard React indeterminate-checkbox pattern (`ref` setting the DOM `indeterminate` property after render).
    - Search box at the top filters tree nodes client-side by name across all domains and types. No API round-trip.
    - Auto-included elements receive a visual badge + tooltip (`"Auto-included because referenced by <parent>"`).
    - Tree rows are read-only metadata views — clicking an instance name does not navigate; only the checkbox is interactive.
  - [x] 7.3 Ensure element picker tests pass
    - Run ONLY the 4-8 tests written in 7.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 4-8 tests written in 7.1 pass.
- Tree renders the 6 canonical domains in the spec'd order.
- Tri-state checkbox propagation works in both directions (downward via `onSelectionChange`, upward via computed parent state).
- Search filter is client-side — no `fetch` calls during typing.
- Auto-included badge + tooltip appear for elements in the `autoIncluded` prop.

---

#### Task Group 8: `SelectiveCopyConflictResolution` component
**Dependencies:** Task Group 6 (only types are shared from the API client; this component does not call the API directly).

- [x] 8.0 Build the conflict resolution component
  - [x] 8.1 Write 4-8 focused Vitest tests
    - Limit to 4-8 highly focused tests maximum.
    - Cover:
      1. Default-Skip: on first render with N conflicts, the resolution map emitted upward sets every conflict's action to `skip` (safety property (i) - default).
      2. Bulk action `Overwrite all`: clicking the bulk button updates every row's action to `overwrite`; the emitted map reflects this.
      3. Bulk action `Duplicate all`: clicking the bulk button updates every row's action to `duplicate`.
      4. Per-row override: after a bulk action, changing one row's radio to a different action updates only that row in the emitted map; other rows remain at the bulk default.
      5. Soft "many conflicts" banner: when `conflictCount > 10`, the banner renders above the list with the spec'd copy. The banner is dismissible; commit is NOT blocked (safety property (j)).
      6. No banner under threshold: when `conflictCount <= 10`, the banner does NOT render.
      7. Auto-included rendering: elements from the `autoIncluded` prop render in a clearly-labelled separate group above (or alongside) the conflict list per the spec.
    - Mock no external dependencies — this is a pure presentation component receiving preflight result + emitting a resolution map.
  - [x] 8.2 Create `SelectiveCopyConflictResolution.tsx`
    - File: `frontend/src/components/TopBar/SelectiveCopyConflictResolution.tsx`.
    - Plus matching `SelectiveCopyConflictResolution.module.css`.
    - Props: `{ conflicts: Conflict[], autoIncluded: AutoIncluded[], onResolutionChange: (resolutions: Map<string, 'skip'|'overwrite'|'duplicate'>) => void }`.
    - Header strip with three bulk-action buttons: `Skip all` / `Overwrite all` / `Duplicate all` — applies the chosen action to every row's default in one click.
    - Per-row: element name, type, conflict reason, and a three-radio-button group (`Skip` / `Overwrite` / `Duplicate`) overriding the bulk default for that row.
    - Default state on first render: all conflicts pre-set to `skip` (locked decision).
    - Soft banner above the list when `conflicts.length > 10`: *"Many conflicts detected (N). Consider cancelling and refining your selection — this often means the target already overlaps significantly with the source."* Banner is dismissible (local component state) and informational — does NOT block the commit.
    - Auto-included elements rendered in their own labelled group (no resolution radios — they will be inserted verbatim with source ids preserved).
    - Emits the resolution map up to the wizard via `onResolutionChange` whenever the local map changes.
  - [x] 8.3 Ensure conflict resolution tests pass
    - Run ONLY the 4-8 tests written in 8.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 4-8 tests written in 8.1 pass.
- Default-Skip behaviour is the first-render state (safety property (i)).
- Bulk actions + per-row overrides both work and emit the correct resolution map.
- Soft "many conflicts" banner appears above 10 conflicts and does NOT block the commit (safety property (j)).
- Auto-included elements render in a separate labelled group.

---

#### Task Group 9: `SelectiveCopyWizardModal` shell
**Dependencies:** Task Groups 6 + 7 + 8.

- [x] 9.0 Build the multi-step wizard modal
  - [x] 9.1 Write 4-8 focused Vitest tests
    - Limit to 4-8 highly focused tests maximum.
    - Cover:
      1. Step 1 header: renders `Copying from <source.name> into <activeTarget.name>` based on props + `useArchitectureContext().activeArchitectureId`.
      2. Step progression: clicking `Next` on step 1 advances to step 2 (picker). After a non-empty selection, clicking `Run preflight` calls `selectiveCopyPreflight(...)` and advances to step 3 (preflight summary + conflict resolution).
      3. Fast-path skip: when preflight returns `conflictCount === 0 && autoIncludedCount === 0`, the wizard skips step 3 entirely and advances directly to a commit-confirmation state.
      4. Commit success path: clicking `Commit copy` calls `selectiveCopyCommit(...)` with the resolved payload; on success, the wizard fires the toast, calls `refreshArchitectures()`, and calls `onClose()`.
      5. Post-copy toast contents (safety property (k)): the toast text matches `Copied N elements from <source.name> (skipped: X, overwrote: Y, duplicated: Z)` with counts pulled from the commit response.
      6. Auto-included badge plumbing: after a preflight returning auto-includes, the picker (step 2 if revisited) receives the `autoIncluded` array and renders badges on the affected elements.
      7. 422 `missing_reference` after un-ticking: the wizard surfaces the error in a footer banner; modal stays open (regression for the un-tick-then-commit path).
    - Mock `architecturesApi`, `ArchitectureContext` (`refreshArchitectures`, `activeArchitectureId`), the toast helper, and the child components (`SelectiveCopyElementPicker`, `SelectiveCopyConflictResolution`) where appropriate to keep tests focused on wizard flow.
  - [x] 9.2 Create `SelectiveCopyWizardModal.tsx`
    - File: `frontend/src/components/TopBar/SelectiveCopyWizardModal.tsx`.
    - Plus matching `SelectiveCopyWizardModal.module.css`.
    - Props: `{ open, onClose, projectId, source: Architecture }`.
    - Reuse the modal shell from spec #6's `CloneArchitectureModal.tsx` (portal overlay + header + scrollable content + footer with Cancel / primary buttons; click-outside; Esc dismiss; primary disabled until valid). Extend to a stepper-driven multi-step body without changing the outer chrome.
    - Steps:
      - Step 1 — confirmation header: *"Copying from `<source>` into `<active-target>`"* (target pulled from `useArchitectureContext().activeArchitectureId`).
      - Step 2 — `<SelectiveCopyElementPicker>` tree. On mount, fetch inventory via `getElementsInventory(projectId, source.id)`.
      - Step 3 — preflight summary + `<SelectiveCopyConflictResolution>`. Reached after the user clicks `Run preflight`. Auto-skipped to step 4 if `conflictCount === 0 && autoIncludedCount === 0` (fast-path).
      - Step 4 — commit. Calls `selectiveCopyCommit(...)` with the full resolved payload. On success, fires the post-copy toast with `Copied N elements from <source.name> (skipped: X, overwrote: Y, duplicated: Z)`, calls `refreshArchitectures()`, and closes the modal.
    - Stepper indicator at the top.
    - Footer buttons: `Cancel` (always closes the wizard) + `Back` + step-specific primary (`Next` / `Run preflight` / `Commit copy`). Primary disabled while invalid or in flight.
    - On error: branch on the thrown `ArchitecturesApiError`:
      - 422 `archived_source` -> footer error banner; modal stays open.
      - 422 `same_architecture` -> footer error banner; modal stays open (defence-in-depth — the per-row button should already be disabled).
      - 422 `missing_reference` -> footer error banner explaining the user un-ticked an auto-included element; modal stays open.
      - 400 validation -> footer error banner with the server message.
      - other -> generic footer error banner.
    - The user is already in the target architecture (it IS the active one) — NO `setActiveArchitecture(...)` call after commit. Just `refreshArchitectures()` for completeness.
  - [x] 9.3 Ensure wizard tests pass
    - Run ONLY the 4-8 tests written in 9.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 4-8 tests written in 9.1 pass.
- Step progression matches the spec (header -> picker -> preflight summary + resolution -> commit).
- Fast-path skip when zero conflicts AND zero auto-includes works.
- Post-copy toast matches `Copied N elements from <source.name> (skipped: X, overwrote: Y, duplicated: Z)` (safety property (k)).
- Wizard reuses the `CloneArchitectureModal` shell; the outer chrome (overlay + header + footer) is unchanged.
- 422 errors all surface in a footer banner; the modal stays open.

---

#### Task Group 10: `ManageArchitecturesModal` extension — per-row `Copy from` button
**Dependencies:** Task Group 9.

- [x] 10.0 Wire `Copy from` into the Manage modal
  - [x] 10.1 Write 2-4 focused Vitest tests
    - Limit to 2-4 highly focused tests maximum.
    - Cover:
      1. A per-row `Copy from...` button is rendered for every non-archived row (alongside Edit, Clone, Archive from spec #6).
      2. Disabled-on-self (safety property (h)): when the row IS the active architecture, the `Copy from...` button is rendered disabled with the tooltip text `Cannot copy into itself - switch to a different architecture first.`
      3. Clicking the `Copy from...` button on a non-self row opens `<SelectiveCopyWizardModal>` wired with that row's architecture as `source`.
    - Update the existing `ManageArchitecturesModal.test.tsx` — do not duplicate tests already covering Edit / Clone / Archive.
    - Subagent regex-based edits warning (per project memory): if you sweep the existing test file, verify the output by reading it back — nested braces in the existing setup can break regex edits.
  - [x] 10.2 Add the `Copy from...` button to `ManageArchitecturesModal.tsx`
    - File: `frontend/src/components/TopBar/ManageArchitecturesModal.tsx`.
    - Add a fourth per-row action button: `Copy from...` (alongside Edit + Clone + Archive). Same button styling pattern as the existing three (right-aligned action group).
    - Disabled with tooltip when `row.id === activeArchitectureId` (pull `activeArchitectureId` from `useArchitectureContext()`): tooltip text `Cannot copy into itself - switch to a different architecture first.`
    - Add local state: `copyingFromArchitecture: Architecture | null` (mirror the existing `editingArchitecture` / `cloningArchitecture` / `archivingArchitecture` state pattern from spec #6).
    - Render `<SelectiveCopyWizardModal open={copyingFromArchitecture !== null} onClose={() => setCopyingFromArchitecture(null)} projectId={projectId} source={copyingFromArchitecture} />` (with whatever guard pattern the file already uses for the other modals).
    - No selector dropdown footer entry for selective copy — the wizard lives ONLY in the Manage modal (locked decision). Do NOT add an entry anywhere in `ArchitectureSelector` / dropdown components.
    - Archived-row filtering and last-architecture protection logic are untouched — `Copy from...` simply slots in as a fourth action.
  - [x] 10.3 Ensure Manage modal tests pass
    - Run ONLY the 2-4 tests written / updated in 10.1.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 2-4 tests written / updated in 10.1 pass.
- A per-row `Copy from...` button is rendered for non-archived rows in the Manage modal alongside Edit / Clone / Archive.
- The button is disabled with the spec'd tooltip when the row IS the active architecture (safety property (h)).
- Clicking it opens `<SelectiveCopyWizardModal>` with the row's architecture as `source`.
- No selective-copy entry appears in the selector dropdown footer (regression check via inspection).

---

### Testing

#### Task Group 11: Test review and gap fill
**Dependencies:** Task Groups 1-10.

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests written in Task Groups 1-10
    - Group 1 (inventory service + endpoint): 5 tests in `ArchitectureElementInventoryServiceTest.java`.
    - Group 2 (selective-copy service + exception): 8 tests in `ArchitectureSelectiveCopyServiceTest.java`.
    - Group 3 (controller endpoints): 4 tests in `ArchitectureSelectiveCopyControllerTest.java`.
    - Group 4 (backend integration / graph correctness): 7 tests in `ArchitectureSelectiveCopyIntegrationTest.java`.
    - Group 5 (gateway proxies): 5 tests in `multiArchitectureSelectiveCopyProxy.test.ts`.
    - Group 6 (frontend API client): 4 tests in `architecturesApi.selectiveCopy.test.ts`.
    - Group 7 (element picker): 8 tests in `SelectiveCopyElementPicker.test.tsx`.
    - Group 8 (conflict resolution): 8 tests in `SelectiveCopyConflictResolution.test.tsx`.
    - Group 9 (wizard modal): 5 tests in `SelectiveCopyWizardModal.test.tsx`.
    - Group 10 (Manage modal extension): 10 tests in `ManageArchitecturesModal.test.tsx` (existing 7 + 3 new for Copy-from button).
    - Total spec-specific tests: 64 tests (matches the 32-72 envelope).
  - [x] 11.2 Verify all eleven safety properties have direct test assertions
    - (a) Atomic commit — forced exception mid-commit rolls back the new architecture data. -> Group 11.3 Test 8 in `ArchitectureSelectiveCopyIntegrationTest` (gap-fill: original integration test deferred this to Group 11; service-level guarantee comes from `@Transactional` boundary verified by inspection).
    - (b) Conflict detection — same UUID in target = `same_uuid` conflict reported. -> Group 2 service test + Group 4 integration Test 1.
    - (c) Resolution semantics: `skip` skips, `overwrite` UPDATEs preserving id, `duplicate` creates new UUID and rewires intra-copy-set FKs. -> Group 4 integration Tests 4, 5, 6.
    - (d) Smart cascading: missing reference -> auto-include in result; UUID match in target -> reuse (no auto-include). -> Group 2 service tests + Group 4 integration Tests 2, 3.
    - (e) Refuse archived source -> 422 `archived_source`. -> Group 2 service test + Group 3 controller test + Group 4 integration Test 7.
    - (f) Refuse same-architecture -> 422 `same_architecture`. -> Group 2 service test + Group 3 controller test + Group 4 integration Test 7.
    - (g) Threads + Discovery runs NOT copyable. -> Group 1 inspection (inventory excludes them) + Group 2 inspection (commit code never references them) + Group 11.3 Test 9 in `ArchitectureSelectiveCopyIntegrationTest` (gap-fill: end-to-end DB-level assertion that source's discovery_run is untouched and target has zero discovery_run rows after commit).
    - (h) Frontend `Copy from...` button disabled when row IS active architecture. -> Group 10 Manage modal test (disabled-on-self assertion).
    - (i) Soft banner appears above 10 conflicts; commit not blocked. -> Group 8 conflict resolution tests (banner threshold + below-threshold cases).
    - (j) Banner is informational only (no hard block). -> Same as (i): Group 8 conflict resolution test asserts the banner is dismissible and does not gate the commit button.
    - (k) Post-copy toast contains `copied N elements (skipped: X, overwrote: Y, duplicated: Z)`. -> Group 9 wizard modal test (toast-content assertion).
    - **Production reachability finding (documented):** the `same_uuid` conflict path is essentially unreachable in production because the schema enforces a global single-column PK on `id`. The detection branch is retained as defence-in-depth (future schema relaxation, raw-SQL imports, JPA-bypass paths). Documented in Javadoc of `ArchitectureSelectiveCopyService.REASON_SAME_UUID` and in the class-level Javadoc of `ArchitectureSelectiveCopyIntegrationTest`. Schema changes to enable production reachability are explicitly out of scope for spec #7.
  - [x] 11.3 Write up to 10 additional strategic tests maximum (only if 11.2 finds gaps)
    - Added 2 strategic gap-fill tests (well under the 10-test budget) to `ArchitectureSelectiveCopyIntegrationTest.java`:
      1. **Test 8 (a) atomic rollback**: wires a `ThrowingJdbcTemplate` (mirrors the pattern in `ArchitectureCloneIntegrationTest`) overriding `update(String, Object[])` so the very first commit-time write throws. Asserts the commit's `@Transactional` boundary rolls back: target row's overwrite-UPDATE is reverted; no new application or service row remains in the target; source rows untouched.
      2. **Test 9 (g) Discovery exclusion**: seeds source with an `application` + a `discovery_run`, runs commit on the application, asserts target has zero `discovery_run` rows after commit, source's `discovery_run` is byte-for-byte untouched, and total `discovery_run` count is unchanged. Threads exclusion is verified by inspection (the service has no thread-storage dependency injected).
    - Did NOT touch any pre-existing failure listed in project memory.
  - [x] 11.4 Run feature-specific tests only
    - Backend integration tests run via the documented `mvn surefire:test -Dtest=ArchitectureSelectiveCopyIntegrationTest -Dmaven.test.skip=false -Dtests.skip=false` workaround after `javac`-recompiling the modified test source.
    - Result: **9 tests run, 0 failures, 0 errors, 0 skipped** (7 original + 2 new gap-fill).
    - Earlier-group tests (Groups 1-10) were already verified passing in their own group runs and were NOT re-executed wholesale (per the spec's "do not run the entire suite" rule).
    - All eleven safety properties (a)-(k) now have at least one passing direct test assertion (or, for (g) threads, an inspection-by-construction guarantee — the service has no thread storage dependency).

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 32-82 tests total).
- All ten safety properties (a)-(k) have at least one direct, passing test assertion.
- No more than 10 additional tests added when filling gaps.
- Testing focused exclusively on this spec's feature requirements.
- No pre-existing failure in the project memory list was modified.

---

## Execution Order

Recommended implementation sequence (strict — each group depends on the prior, except where noted):

1. Task Group 1 — Backend element inventory service + endpoint.
2. Task Group 2 — Backend selective-copy service (preflight + commit) + new exception.
3. Task Group 3 — Backend controller endpoints (preflight + commit).
4. Task Group 4 — Backend integration test for selective-copy correctness.
5. Task Group 5 — Gateway proxy routes (3) + client helpers (3).
6. Task Group 6 — Frontend API client (3 functions).
7. Task Group 7 — `SelectiveCopyElementPicker` component.
8. Task Group 8 — `SelectiveCopyConflictResolution` component (can run in parallel with Group 7 — both depend only on Group 6 types).
9. Task Group 9 — `SelectiveCopyWizardModal` shell.
10. Task Group 10 — `ManageArchitecturesModal` extension (`Copy from...` button).
11. Task Group 11 — Test review and gap fill.

---

## Critical Safety Properties (cross-reference)

| # | Safety property | Where tested |
|---|---|---|
| (a) | Atomic commit — forced exception mid-commit rolls back the new architecture data. | Group 4.1 item 1 |
| (b) | Conflict detection — same UUID in target = `same_uuid` conflict reported. | Group 2.1 item 1, Group 4.1 item 2 |
| (c) | Resolution semantics: `skip` skips, `overwrite` UPDATEs preserving id, `duplicate` creates new UUID and rewires intra-copy-set FKs. | Group 4.1 items 3, 4, 5 |
| (d) | Smart cascading: missing reference -> auto-include; UUID match in target -> reuse (no auto-include). | Group 2.1 items 2, 3, Group 4.1 items 6, 7 |
| (e) | Refuse archived source -> 422 `archived_source`. | Group 2.1 item 5, Group 3.1 item 4, Group 4.1 item 8 |
| (f) | Refuse same-architecture -> 422 `same_architecture`. | Group 2.1 item 4, Group 3.1 item 3, Group 4.1 item 9 |
| (g) | Threads + Discovery runs NOT copyable. | Group 1 (inspection), Group 2 (inspection), Group 4.1 item 10 |
| (h) | Frontend `Copy from...` button disabled when row IS active architecture. | Group 10.1 item 2 |
| (i) | Soft banner appears above 10 conflicts; commit not blocked. | Group 8.1 items 5, 6 |
| (j) | Banner is informational only (no hard block). | Group 8.1 item 5 |
| (k) | Post-copy toast contains `copied N elements (skipped: X, overwrote: Y, duplicated: Z)`. | Group 9.1 item 5 |
