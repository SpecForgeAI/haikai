# Task Breakdown: Discovery Service `architectureId` Integration (Spec #4)

## Overview
Total Task Groups: 9
Total Tasks: 9 top-level (1.0 - 9.0)

This spec binds every Discovery run to exactly one architecture for life. The bound `architectureId` is picked explicitly by the user at run start, persisted on `discovery_runs`, threaded through every Discovery endpoint and every save-back, and surfaced through a URL-filtered run list, a detail-page chip, and a save-back confirmation modal.

**Hard environment constraints (read before starting any group):**
- Never edit applied Liquibase changesets (087-092). Always create new files (project memory rule).
- Only edit `discovery-service/src/**` when no discovery run is active (`tsx watch` auto-reloads kill in-flight runs — project memory rule). Each implementer touching that tree must check first.
- Backend tests work around pre-existing broken test files (`WorkItemImplementContextServiceTest`, `OrganisationControllerDocsAppliedTest`, `OrganisationControllerTextIdTest`, `RoadmapImportServiceV3Test`) — compile directly with `javac`, run via `mvn surefire:test -Dtest=... -Dmaven.test.skip=false -Dtests.skip=false`.
- Frontend tests use Vitest with `vi.mock()`. Pre-existing failure list: `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `conversation-memory-edge-cases.test.ts`, `DiagramsViewTemporaryDiagram.test.tsx`, `TopBar.export-flow.test.tsx`, plus UnifiedChatPanel/TemporaryDiagramContext failures from commit `0742b99`, plus SET_VIEW failures noted in spec #2.
- Subagent regex-based edits can break with nested braces — verify after sweeping edits.

---

## Task List

### Backend Foundation (architecture-model-service)

#### Task Group 1: Liquibase changesets + `DiscoveryRunEntity` field
**Dependencies:** None (spec #1 changesets 087-091 and spec #3 changeset 092 already applied)

- [x] 1.0 Add `architecture_id` to `discovery_runs` with zero-data-loss backfill
  - [x] 1.1 Write 2-8 focused tests for the migration
    - Liquibase H2 integration test: seed fixture project + at least 2 pre-existing `discovery_runs` rows + the project's spec-#1 auto-created `Default` architecture (where `architecture.id = project.id`); run changesets 093-095; assert every `discovery_runs` row now has `architecture_id = project_id`, `NOT NULL`, FK valid, composite index present (zero-data-loss + idempotent on re-run = property (a)).
    - Test that re-running 094 is a no-op (idempotency check — UPDATE with WHERE-already-set guard, or precondition).
    - Test the precondition assertion in 094 fails loudly if a project lacks its `Default` architecture row (negative path).
    - Limit to 4 tests maximum; do not write exhaustive coverage of every column or every constraint.
  - [x] 1.2 Create `093-add-architecture-id-to-discovery-runs.sql`
    - Add nullable `architecture_id UUID` column to `discovery_runs`.
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/093-add-architecture-id-to-discovery-runs.sql`.
    - Pattern: same shape as changesets 087-091.
  - [x] 1.3 Create `094-backfill-discovery-runs-architecture-id.sql`
    - `UPDATE discovery_runs SET architecture_id = project_id WHERE architecture_id IS NULL` (exploits spec #1's `architecture.id = project.id` rule for the auto-created `Default`).
    - Add a Liquibase `<preConditions>` SQL check asserting every distinct `project_id` in `discovery_runs` has a matching `architecture` row with `id = project_id`. Fail loudly (`onFail="HALT"`) if not.
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/094-backfill-discovery-runs-architecture-id.sql`.
  - [x] 1.4 Create `095-discovery-runs-architecture-id-not-null-fk.sql`
    - `ALTER TABLE discovery_runs ALTER COLUMN architecture_id SET NOT NULL`.
    - `ALTER TABLE discovery_runs ADD CONSTRAINT fk_discovery_runs_architecture FOREIGN KEY (architecture_id) REFERENCES architecture(id)`.
    - `CREATE INDEX idx_discovery_runs_project_arch ON discovery_runs (project_id, architecture_id)`.
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/095-discovery-runs-architecture-id-not-null-fk.sql`.
  - [x] 1.5 Register all three in `db.changelog-master.yaml`
    - Add the three `<include>` lines after the existing 092 entry, in 093 → 094 → 095 order.
    - DO NOT touch 087-092 entries.
  - [x] 1.6 Add `architectureId UUID` field to `DiscoveryRunEntity.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/entity/DiscoveryRunEntity.java` (verify path).
    - Mark `@Column(name = "architecture_id", nullable = false)`.
    - Add getter/setter mirroring `projectId`.
    - DO NOT add `architecture_id` columns to any child entity (`DiscoveryEvidenceEntity`, `DiscoveryRelationshipEntity`, `DiscoveryClusterEntity`, `DiscoveryCandidateEntity`, `DiscoveryDecisionTaskEntity`) — they inherit via `run_id` FK only.
  - [x] 1.7 Run ONLY the 1.1 tests
    - Use the broken-test workaround: `mvn surefire:test -Dtest=<MigrationTestClass> -Dmaven.test.skip=false -Dtests.skip=false`.
    - Verify all four tests pass.
    - Do NOT run the entire `architecture-model-service` test suite.

**Acceptance Criteria:**
- Property (a) test passes: backfill is zero-data-loss + idempotent on H2.
- 094 precondition fails loudly when a project lacks its `Default`.
- `DiscoveryRunEntity` exposes `architectureId` (UUID, non-null).
- No edits to changesets 087-092; new files only.
- No `architecture_id` column added to any child discovery table.

---

#### Task Group 2: Backend Discovery controllers + services + repositories
**Dependencies:** Task Group 1

- [x] 2.0 Add `{architectureId}` path segment to every `Discovery*Controller` and propagate through services / repositories
  - [x] 2.1 Write 2-8 focused tests
    - Path-segment 404 safety test (property (b)): hit at least one Discovery list endpoint and one Discovery item endpoint without `:architectureId` in the URL → expect Spring 404 (no fallback / no default-resolution at controller layer).
    - Service-layer filter test: list endpoint returns ONLY rows for the given `(projectId, architectureId)` pair when two architectures exist with parallel runs in the H2 fixture.
    - Child-entity JOIN-filter test: a Discovery child endpoint (e.g. evidence list) returns only rows whose parent run is in the requested architecture; rows from a parallel architecture's runs are excluded.
    - Run-create test: POSTing to the runs endpoint persists `architectureId` from the path segment onto the new `DiscoveryRunEntity` row.
    - Limit to 4 tests maximum; skip exhaustive coverage of every controller × every action.
  - [x] 2.2 Identify all `Discovery*Controller.java` files
    - Sweep `architecture-model-service/src/main/java/com/example/architecturemodel/controller/` for `Discovery*Controller.java`.
    - Document the list at the top of the implementation notes for this group.
  - [x] 2.3 Add `{architectureId}` path variable to each controller endpoint
    - Update `@RequestMapping` / `@GetMapping` / `@PostMapping` / `@PatchMapping` / `@DeleteMapping` annotations to insert `/architectures/{architectureId}` after `/projects/{projectId}` per spec #1's Bucket A pattern.
    - Add `@PathVariable UUID architectureId` to every method signature.
    - Pass `architectureId` through to the service call.
    - **No back-compat shim** — old project-only routes are removed in this spec (hard cutover).
  - [x] 2.4 Update Discovery services and repositories to accept and filter by `architectureId`
    - For methods operating on `discovery_runs` directly: add `architectureId` to method signature; add `AND architecture_id = ?` to the `WHERE` clause.
    - For methods operating on child tables (`discovery_evidence`, `discovery_relationships`, `discovery_clusters`, `discovery_candidates`, `discovery_decision_tasks`): apply the architecture filter via JOIN — `WHERE run_id IN (SELECT id FROM discovery_runs WHERE project_id = ? AND architecture_id = ?)`.
    - For `create` paths on `DiscoveryRunEntity`: persist the `architectureId` from the controller into the entity before save.
  - [x] 2.5 Map controller exceptions consistently
    - Reuse the existing `GlobalExceptionHandler`; no new error codes.
    - 404 on missing path segment (Spring's default behaviour — verify, don't override).
  - [x] 2.6 Run ONLY the 2.1 tests
    - `mvn surefire:test -Dtest=<DiscoveryControllerTests> -Dmaven.test.skip=false -Dtests.skip=false` for the new test classes only.
    - Verify all 4 tests pass.
    - Do NOT run the entire backend suite (pre-existing broken tests would fail).

**Acceptance Criteria:**
- Property (b) test passes: every Discovery endpoint 404s without `:architectureId`.
- All `Discovery*Controller.java` files updated; no controller missed.
- Child-entity list endpoints correctly JOIN-filter via `discovery_runs`.
- `DiscoveryRunEntity` is created with `architectureId` from the path segment.
- The 4 tests written in 2.1 pass.

---

### Gateway

#### Task Group 3: Gateway proxies + client functions
**Dependencies:** Task Group 2

- [x] 3.0 Update gateway proxy routes and client functions to embed `:architectureId`
  - [x] 3.1 Write 2-8 focused tests
    - Gateway round-trip test: a frontend call to `/api/projects/:projectId/architectures/:architectureId/discovery/runs` is proxied through to the architecture-model-service backend with `:architectureId` preserved in the downstream URL.
    - Gateway-rejection test: hitting the discovery proxy without `:architectureId` in the URL returns 404 (Express router does not match) — confirms the gateway mirrors the backend's path-segment safety.
    - Client-function smoke test: at least one updated client function in `gateway/src/services/*.ts` builds the correct architecture-scoped URL when given `(projectId, architectureId)`.
    - Limit to 3 tests maximum.
  - [x] 3.2 Identify discovery-related proxy routes
    - Sweep `gateway/src/routes/` for any routes targeting Discovery endpoints (likely `gateway/src/routes/discovery.ts` or similar; if it doesn't exist, look in `gateway/src/routes/index.ts` and any sibling discovery routers).
    - Document the list before editing.
  - [x] 3.3 Embed `:architectureId` in every Discovery proxy route
    - Update Express path strings to insert `/architectures/:architectureId` after `/projects/:projectId`.
    - Pass `req.params.architectureId` into the downstream URL when building the proxied request.
    - Mirror the Bucket A proxy pattern in `gateway/src/routes/architectures.ts` (spec #1).
  - [x] 3.4 Update gateway client functions for Discovery in `gateway/src/services/`
    - Identify the client functions that hit Discovery endpoints (search by URL fragment `/discovery/`).
    - Add `architectureId: string` to each function signature; embed it in the URL after `/projects/{projectId}/`.
    - Use `jest.requireActual` spread when mocking these clients in any new gateway tests (project memory rule for `architectureModelClient.ts`).
  - [x] 3.5 Run ONLY the 3.1 tests
    - `npx jest --testPathPattern="<new-discovery-proxy-test>"` from the `gateway/` directory.
    - Verify all 3 tests pass.
    - Do NOT run the full gateway test suite.

**Acceptance Criteria:**
- All discovery proxy routes carry `:architectureId`.
- Forgetting `:architectureId` produces a 404 at the gateway boundary.
- Updated client functions build the correct URL.
- The 3 tests from 3.1 pass.

---

### discovery-service backend

#### Task Group 4: discovery-service routes + runManager + archModelClient
**Dependencies:** Task Groups 1, 2, 3

**Pre-flight check (mandatory):** the implementer MUST verify there is no in-flight discovery run before editing any file in `discovery-service/src/**`. The `tsx watch` auto-reload will kill any active run. If a run is active, wait or coordinate with the user.

- [x] 4.0 Bind `architectureId` to each discovery run for life inside discovery-service
  - [x] 4.1 Write 2-8 focused tests
    - Run-binding test (property (d)): start a run with `architectureId=A`; verify `runManager.getRun(runId).architectureId === 'A'` is persisted; simulate the URL active arch later switching to `B`; assert subsequent entity-fetch and save-back calls in this run still use `A`, not `B`.
    - Route path-segment 404: hit a discovery-service route without `:architectureId` → 404.
    - archModelClient helper test: an entity-fetch helper (e.g. the spec-#1 `services` helper) reads from the run's stored `architectureId` (mocked via runManager), not the cached default-resolver helper.
    - Cached `resolveDefaultArchitectureId` non-regression: spec #1's existing tests for the helper still pass after refactor (it remains as a fallback for non-run code paths).
    - Limit to 4 tests maximum.
  - [x] 4.2 Update `discovery-service/src/services/runManager.ts`
    - Add `architectureId: string` to the per-run state shape.
    - Read `architectureId` from the run-start payload; persist alongside other run state.
    - Expose a getter so other services can read the bound id given a `runId`.
  - [x] 4.3 Update `discovery-service/src/routes/runs.ts` (and any sibling route files)
    - Accept `:architectureId` path segment on every Discovery route.
    - Pass it into `runManager` on run-start.
    - On all subsequent run-scoped routes, validate that `:architectureId` from the URL matches the run's stored `architectureId`; mismatch returns 409 (defence in depth — frontend should never get this wrong).
  - [x] 4.4 Update `discovery-service/src/services/archModelClient.ts`
    - The three entity-fetch helpers from spec #1 (services / applications / app_components): change source-of-truth from `resolveDefaultArchitectureId(...)` (per-run cached) to `runManager.getRun(runId).architectureId`.
    - Helper signatures stay the same (still accept `architectureId` as an arg); only the call sites that previously used the cached default now thread the run's stored id instead.
    - Save-back code paths read the same stored `architectureId` and write only to that architecture in architecture-model-service via the new architecture-scoped URLs.
    - **Keep** `resolveDefaultArchitectureId` as a fallback for any non-run code paths. Do not delete it; do not regress its existing tests.
  - [x] 4.5 Update the LLM persona definition for Discovery to declare bound-by-system-prompt mode
    - Locate the Discovery persona file (search `discovery-service/src/personas/` or grep for the Discovery persona declaration).
    - Update the persona descriptor to set its save-target-resolution mode to `bound-by-system-prompt` per the design note.
    - This does NOT inject the prompt — that lands in Group 5. This task is the persona declaration only.
  - [x] 4.6 Run ONLY the 4.1 tests
    - `npx jest --testPathPattern="<new-architecture-binding-test>"` (or vitest equivalent depending on what discovery-service uses).
    - Verify all 4 tests pass.
    - Do NOT run the entire discovery-service suite.

**Acceptance Criteria:**
- Property (d) test passes: run is bound to its picked `architectureId` for life.
- discovery-service routes 404 without `:architectureId`.
- Mismatch between URL `:architectureId` and the run's stored id returns 409.
- Spec #1's `resolveDefaultArchitectureId` helper retained and its existing tests still pass.
- The 4 tests from 4.1 pass.
- No edits made while a run was active (implementer confirmation).

---

### LLM persona system-prompt injection

#### Task Group 5: Inject `Architecture: <name> (id: <id>)` at conversation start
**Dependencies:** Task Group 4

**Pre-flight check (mandatory):** same as Group 4 — no in-flight runs before editing `discovery-service/src/**`.

- [x] 5.0 Inject the architecture line into the system prompt of Discovery-triggered LLM threads
  - [x] 5.1 Write 2-8 focused tests
    - Prompt-injection test: when discovery-service opens an LLM thread for a run with `architectureId=X`, the resulting system prompt contains the literal line `Architecture: <name> (id: X)` where `<name>` is resolved from the architecture-model-service `listArchitectures` response.
    - Forward-only test: an EXISTING (pre-existing-on-disk) thread file is not modified or migrated when this code runs — only NEW threads opened after this change get the line.
    - Limit to 2 tests maximum.
  - [x] 5.2 Update the discovery-service code that opens the LLM thread
    - Locate the call site that constructs the system prompt for a Discovery-triggered conversation (likely in the persona invocation or LLM thread bootstrapper).
    - Resolve the architecture name once per run (cache it on the run state in `runManager`) by calling `listArchitectures(projectId)` and finding the entry whose id matches the run's bound `architectureId`.
    - Inject the line `Architecture: <name> (id: <architectureId>)` into the system prompt at conversation start. Place it adjacent to existing project / persona declarations.
    - Threads remain project-scoped per spec #1 — no change to thread storage paths (`{projectParentFolder}/threads/{type}/thread.json`).
  - [x] 5.3 Confirm forward-only behaviour
    - Do NOT iterate over existing thread files to back-patch them.
    - Do NOT add a migration step. New threads only.
  - [x] 5.4 Run ONLY the 5.1 tests
    - Verify both tests pass.
    - Do NOT run the entire discovery-service suite.

**Acceptance Criteria:**
- New Discovery-triggered LLM threads receive the `Architecture: <name> (id: <id>)` system-prompt line.
- Existing threads on disk are untouched.
- The 2 tests from 5.1 pass.

---

### Frontend — picker at run start

#### Task Group 6: `ArchitectureRunTargetPicker` + StartDiscoveryRunConfirmModal integration
**Dependencies:** Task Groups 2, 3 (backend + gateway must accept new URL shape)

- [x] 6.0 Add the always-visible architecture picker to the Start Discovery Run modal
  - [x] 6.1 Write 2-8 focused tests (Vitest)
    - Pre-fill test: picker opens with `useActiveArchitectureId()` value pre-selected.
    - Disabled-when-one test: when the project has only one non-archived architecture, the picker is rendered but disabled.
    - Override test: user selects a different architecture in the picker; the run-start payload sent on Confirm carries the picker's chosen id, NOT the URL active id.
    - Ordering test: picker lists `architectures.filter(a => !a.archived)` in oldest-first order (matches spec #1 + spec #2 ordering rule).
    - Limit to 4 tests maximum.
  - [x] 6.2 Create `frontend/src/components/Discovery/ArchitectureRunTargetPicker.tsx`
    - Pull `architectures` from `ArchitectureContext` (spec #2 exposes the list).
    - Filter to non-archived; sort oldest-first by `createdAt`.
    - Render a `<select>` (or styled equivalent) with label `Target architecture`.
    - Pre-select via `useActiveArchitectureId()`.
    - Disable when `architectures.filter(a => !a.archived).length === 1`.
    - One-line confirmation copy beneath the select: `Run will be locked to this architecture for its entire lifetime.`
    - Expose `value` and `onChange` props so the parent modal can lift the chosen id.
  - [x] 6.3 Embed the picker in `StartDiscoveryRunConfirmModal.tsx`
    - Always render the picker (no conditional hide).
    - Hold the picked id in modal-local state, initialised from `useActiveArchitectureId()`.
    - On Confirm, send the picked id in the run-start request payload (NOT `useActiveArchitectureId()`).
    - Update the modal's API call to use the new architecture-scoped URL (`/api/projects/:projectId/architectures/:architectureId/discovery/runs`) where `:architectureId` is the picked id from the picker.
  - [x] 6.4 Update `frontend/src/api/discoveryApi.ts` (or equivalent) to accept `architectureId`
    - Every Discovery API client function gains an `architectureId: string` argument and embeds it in the URL after `/projects/{projectId}/`.
    - Run-start function takes the picker's chosen id; list and detail functions take the active id from `useActiveArchitectureId()` at the call site.
  - [x] 6.5 Run ONLY the 6.1 tests
    - `npx vitest run <path-to-new-test>` from `frontend/`.
    - Verify all 4 tests pass.
    - Do NOT run the full frontend suite (pre-existing failures listed in environment notes).

**Acceptance Criteria:**
- `ArchitectureRunTargetPicker` always visible in the Start Discovery Run modal.
- Picker is the source of truth for the run-start payload, not the URL active id.
- Picker disables when only one non-archived architecture exists.
- The 4 tests from 6.1 pass.

---

### Frontend — run list filter + detail chip

#### Task Group 7: Run list filtered by URL active architecture; detail page chip
**Dependencies:** Task Group 6 (API client signatures updated)

- [x] 7.0 Filter the run list by URL active architecture; show architecture chip on the run detail page
  - [x] 7.1 Write 2-8 focused tests (Vitest)
    - Run-list filter test (property (c)): mount the run list with `useActiveArchitectureId()` returning `A`; assert the API call passes `A` in the URL; assert runs whose bound `architectureId !== A` are not displayed.
    - Architecture-switch re-render test: change the URL `:architectureId` segment; the list re-renders against the new architecture's data.
    - No-row-chip test: assert run-list rows do NOT render an architecture name (implicit URL filter — showing it would be redundant noise).
    - Detail-chip test: mount the run detail page; assert the header renders a read-only `Architecture: <name>` chip; the name is resolved from `ArchitectureContext.architectures` using the run's stored `architectureId`.
    - Limit to 4 tests maximum.
  - [x] 7.2 Update the discovery run-list component
    - Locate the run-list component (search `frontend/src/components/Discovery/` for the list view).
    - Read `useActiveArchitectureId()`; pass it into the API client list call.
    - Remove (or skip adding) any per-row architecture-name display.
  - [x] 7.3 Update the discovery run-detail component
    - Locate the run-detail component header.
    - Add a read-only chip: `Architecture: <name>`.
    - Resolve the name client-side from `ArchitectureContext.architectures` using the run's stored `architectureId`.
    - Reuse the closed-state pill styling from `frontend/src/components/TopBar/ArchitectureSelector.tsx` (spec #2) — read-only variant, no dropdown affordance.
  - [x] 7.4 Run ONLY the 7.1 tests
    - Verify all 4 tests pass.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- Property (c) test passes: run list filtered by URL active architecture; cross-architecture runs hidden.
- Run-list rows have NO architecture name chip.
- Run-detail page header has the `Architecture: <name>` chip.
- The 4 tests from 7.1 pass.

---

### Frontend — save-back confirmation

#### Task Group 8: `SaveBackConfirmModal`
**Dependencies:** Task Group 7

- [x] 8.0 Add the save-back confirmation modal that blocks the writes until confirmed
  - [x] 8.1 Write 2-8 focused tests (Vitest)
    - Render test: modal renders with copy `Save <N> candidates and <M> relationships to architecture '<name>'?` where N, M, and name are wired from props.
    - Block-until-confirm test (property (e)): the save-back API call is NOT fired until the user clicks Confirm; clicking Cancel or pressing Esc dismisses without firing.
    - In-flight disable test: while the save is in flight, the Confirm button is disabled.
    - Architecture-name test: name resolved from `ArchitectureContext.architectures` using the run's bound `architectureId` (NOT the URL active id).
    - Limit to 4 tests maximum.
  - [x] 8.2 Create `frontend/src/components/Discovery/SaveBackConfirmModal.tsx`
    - Model on `frontend/src/components/TopBar/ArchiveArchitectureConfirmModal.tsx` (spec #3): warning copy, secondary Cancel + primary action button, Esc-to-dismiss, click-outside-to-close, primary disabled while in flight.
    - Body: `Save <N> candidates and <M> relationships to architecture '<name>'?`
    - Confirm button label: `Save to <name>`.
    - Resolve `<name>` client-side from `ArchitectureContext.architectures` keyed on the run's bound `architectureId`.
  - [x] 8.3 Wire the modal into the save-back flow
    - Locate the existing save-back trigger in the discovery UI (likely on the run-detail page or a dedicated review screen).
    - Replace the direct API call with: open `SaveBackConfirmModal` → on Confirm, fire the save-back to `/api/projects/{projectId}/architectures/{runArchitectureId}/discovery/runs/{runId}/save-back` (or whatever the backend endpoint is).
    - The architecture id in the URL is the run's BOUND `architectureId` (from the run state), NOT `useActiveArchitectureId()` — defensive even though they should match.
  - [x] 8.4 Run ONLY the 8.1 tests
    - Verify all 4 tests pass.
    - Do NOT run the full frontend suite.

**Acceptance Criteria:**
- Property (e) test passes: save-back blocked until user confirms.
- Modal copy shows correct counts and architecture name.
- Save-back fires against the run's bound architecture, not the URL active arch.
- The 4 tests from 8.1 pass.

---

### Testing

#### Task Group 9: Test review + critical gap fill
**Dependencies:** Task Groups 1-8

- [x] 9.0 Review existing tests across all groups and add at most 10 strategic tests to fill critical gaps for THIS spec only
  - [x] 9.1 Review tests written in groups 1-8
    - Group 1: 4 tests (Liquibase backfill).
    - Group 2: 4 tests (backend controller path-segment + filtering).
    - Group 3: 3 tests (gateway proxies).
    - Group 4: 4 tests (discovery-service runManager + archModelClient).
    - Group 5: 2 tests (LLM persona system-prompt injection).
    - Group 6: 4 tests (run-start picker).
    - Group 7: 4 tests (run-list filter + detail chip).
    - Group 8: 4 tests (save-back confirm modal).
    - Total existing: ~29 tests.
  - [x] 9.2 Identify gaps in this spec's safety properties only
    - Verify property (a) — backfill zero-data-loss + idempotent — is covered by Group 1.
    - Verify property (b) — Discovery backend 404s without `:architectureId` — is covered by Group 2 (and gateway equivalent in Group 3).
    - Verify property (c) — run list filtered by URL active arch — is covered by Group 7.
    - Verify property (d) — run bound to picked architecture for life — is covered by Group 4.
    - Verify property (e) — save-back confirm modal blocks writes — is covered by Group 8.
    - For any property without a callable test, add ONE strategic test in 9.3.
    - Identify at most a few critical end-to-end / integration gaps within this spec's scope. Skip exhaustive coverage. Skip edge cases unless business-critical.
  - [x] 9.3 Write up to 10 additional strategic tests maximum
    - Suggested candidates if not already covered:
      - End-to-end: pick architecture B in the picker while URL active is A → run is created with `architectureId=B` in the backend.
      - End-to-end: switch URL active arch from A to B mid-session; in-flight run started under A continues to read/write architecture A in entity-fetch and save-back.
      - Cross-layer 404 propagation: gateway → backend → discovery-service all 404 consistently when `:architectureId` is missing.
      - Save-back URL: save-back POST URL embeds the run's bound id, even if the URL active id is different.
    - Hard cap: 10 new tests. Do not exceed this cap.
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY the tests from groups 1-8 plus the new tests from 9.3.
    - Expected total: ~29 + up to 10 = up to 39 tests.
    - Do NOT run the entire architecture-model-service / gateway / discovery-service / frontend suites.
    - Do NOT attempt to fix pre-existing failing tests listed in the environment notes (out of scope).

**Acceptance Criteria:**
- Each of the five safety properties (a)-(e) has at least one passing callable test.
- No more than 10 additional tests added beyond the 29 from groups 1-8.
- All feature-specific tests pass.
- Pre-existing test failures (listed in environment notes) are not addressed by this spec.

---

## Execution Order

Recommended implementation sequence (each group is implementable independently by a single subagent call):

1. **Group 1** — Liquibase 093/094/095 + `DiscoveryRunEntity` field (backend foundation; zero-data-loss test gates the rest).
2. **Group 2** — Backend Discovery controllers / services / repositories (path-segment 404 safety).
3. **Group 3** — Gateway proxies + client functions.
4. **Group 4** — discovery-service routes + runManager + archModelClient (run binding for life). **Pre-flight: no active runs.**
5. **Group 5** — LLM persona system-prompt injection. **Pre-flight: no active runs.**
6. **Group 6** — Frontend `ArchitectureRunTargetPicker` + `StartDiscoveryRunConfirmModal` integration.
7. **Group 7** — Frontend run list filter + detail chip.
8. **Group 8** — Frontend `SaveBackConfirmModal`.
9. **Group 9** — Test review + gap fill.

## Safety Properties Coverage Map

| Property | Description | Group(s) |
|---|---|---|
| (a) | Liquibase backfill is zero-data-loss + idempotent | 1 |
| (b) | Discovery backend endpoints 404 without `architectureId` | 2 (backend), 3 (gateway), 4 (discovery-service) |
| (c) | Run list filtered correctly by URL active architecture; cross-arch runs hidden | 7 |
| (d) | Run is bound to its picked architecture for life — save-back + entity-fetch use that id, not URL active id | 4 (binding), 8 (save-back URL) |
| (e) | Save-back confirm modal blocks the writes until confirmed | 8 |
