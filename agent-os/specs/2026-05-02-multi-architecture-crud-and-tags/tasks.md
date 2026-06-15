# Task Breakdown: Multi-Architecture CRUD UI + Tag Management (Spec #3)

## Overview
Total Tasks: 8 task groups, ~70 sub-tasks

This spec adds the backend CRUD endpoints, gateway proxies, frontend API + context refresh, and the three new modals (Edit/Create, Manage, Archive Confirm) that turn the spec #2 selector pill into a usable surface for creating, editing, and archiving architectures plus their tags.

The dependency order is strict: server must enforce uniqueness and last-architecture protection (group 1) before the gateway can proxy reliably (group 2), before the frontend client/context expose mutations (group 3), before any modal can call them (groups 4–6). Selector dropdown changes (group 7) hang off all three modals being available. Test review (group 8) is last.

References:
- Spec: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/spec.md`
- Requirements: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/planning/requirements.md`
- Design context: `agent-os/design-notes/multi-architecture-variants.md`
- Predecessor #1 (data model + Bucket A): `agent-os/specs/2026-05-01-multi-architecture-plumbing/spec.md`
- Predecessor #2 (selector + routing): `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/spec.md`

## Critical Safety Properties (each must have a callable test)
- (a) Server rejects duplicate name with 409; client surfaces inline.
- (b) Server rejects archive of last architecture with 422; client disables button.
- (c) PATCH replaces the full tag set atomically (name + description + tags in one payload).
- (d) Archiving the currently-active architecture redirects to the new oldest non-archived via `setActiveArchitecture`.
- (e) Modals refetch via `refreshArchitectures()` after successful mutation.

## Task List

### Backend Foundation

#### Task Group 1: Liquibase 092 + Architecture CRUD Service/Controller
**Dependencies:** None

Add the case-insensitive name uniqueness constraint, extend `ArchitectureService` with `create`, `update`, and `archive` (with last-architecture protection and uniqueness check), extend `ArchitectureController` with the three new endpoints, and map the new exceptions to 409 / 422 / 400 in `GlobalExceptionHandler`.

- [x] 1.0 Complete backend CRUD layer
  - [x] 1.1 Write 2-8 focused tests for the new endpoints
    - Test (safety property a): `POST` returns 409 when a name collides with an existing architecture in the same project, case-insensitive (e.g. existing `Default` rejects `default`, `DEFAULT`)
    - Test (safety property b): `POST /archive` returns 422 with the localised "A project must have at least one architecture." message when only one non-archived architecture exists for the project
    - Test (safety property c): `PATCH` with `{name, description, tags: ["x", "y"]}` replaces the full tag set atomically — pre-existing tags `["a", "b"]` are gone after the call, only `["x", "y"]` remain
    - Test: `POST` happy path returns 201 with the created row including `id`, `name`, `description`, `tags`, `archived: false`, timestamps
    - Test: `PATCH` returns 404 when `architectureId` belongs to a different project than the path's `projectId`
    - Test: `POST` returns 400 when `name` is empty after trim, when `name` >100 chars, when `description` >500 chars, or when any tag is empty/>50 chars (one or two of these is enough)
    - Limit to 2-8 tests maximum — skip exhaustive validation matrix coverage
    - Use the workaround: `javac` direct-compile new test classes + `mvn surefire:test -Dtest=...` to bypass the four pre-existing broken test files (`WorkItemImplementContextServiceTest`, `OrganisationControllerDocsAppliedTest`, `OrganisationControllerTextIdTest`, `RoadmapImportServiceV3Test`)
  - [x] 1.2 Add Liquibase changeset `092-architecture-name-unique-constraint.sql`
    - **NEVER edit applied changesets 087-091** — create a new file only (project-memory rule: Liquibase checksum validation refuses startup on edits to applied changesets)
    - Path: `architecture-model-service/src/main/resources/db/changelog/sql/092-architecture-name-unique-constraint.sql`
    - SQL: `CREATE UNIQUE INDEX architecture_project_id_lower_name_uidx ON architecture (project_id, LOWER(name));`
    - Register the new changeset in `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` alongside the existing 087-091 entries (append; do not reorder)
  - [x] 1.3 Extend `ArchitectureRepository` with the lookup methods
    - Add `boolean existsByProjectIdAndNameIgnoreCase(UUID projectId, String name)`
    - Add `long countByProjectIdAndArchivedFalse(UUID projectId)` (or confirm the existing `listArchitectures` repository surface already has an equivalent — reuse before adding)
    - Add `boolean existsByProjectIdAndNameIgnoreCaseAndIdNot(UUID projectId, String name, UUID id)` for the `update` path (lets the user keep their own current name on PATCH without false 409)
  - [x] 1.4 Extend `ArchitectureService` with `create`, `update`, `archive`
    - `create(projectId, CreateArchitectureRequest)`: trim and validate name + description + each tag; throw `DuplicateArchitectureNameException` if `existsByProjectIdAndNameIgnoreCase`; persist `Architecture` row; persist `architecture_tag` rows from payload; return mapped DTO
    - `update(projectId, architectureId, UpdateArchitectureRequest)`: load by `(projectId, architectureId)` or throw `ArchitectureNotFoundException`; throw `DuplicateArchitectureNameException` if `existsByProjectIdAndNameIgnoreCaseAndIdNot`; update name + description; **delete all rows for `architecture_id` from `architecture_tag` and re-insert from payload — atomic within a single `@Transactional` boundary**; return mapped DTO
    - `archive(projectId, architectureId)`: load or 404; if `countByProjectIdAndArchivedFalse(projectId) <= 1` throw `LastArchitectureException`; set `archived = true`; save
    - Reuse the trim/validate helpers from `OrganisationService` if they exist; otherwise inline minimal helpers in `ArchitectureService` (no premature extraction)
  - [x] 1.5 Add the three exception types
    - `DuplicateArchitectureNameException extends RuntimeException` (carries the offending name)
    - `LastArchitectureException extends RuntimeException` (carries the localised message constant)
    - `ArchitectureNotFoundException extends RuntimeException` — likely already exists from spec #1; reuse if so
    - Co-locate in `architecture-model-service/src/main/java/com/example/architecturemodel/exception/`
  - [x] 1.6 Extend `GlobalExceptionHandler` with the four new mappings
    - `DuplicateArchitectureNameException` → 409 Conflict with envelope `{code: "duplicate_name", message: "An architecture named '<x>' already exists in this project.", field: "name"}`
    - `LastArchitectureException` → 422 Unprocessable Entity with `{code: "last_architecture", message: "A project must have at least one architecture."}`
    - `ArchitectureNotFoundException` → 404 (reuse existing handler if present)
    - `MethodArgumentNotValidException` / Bean Validation failures → 400 with field-level details (reuse existing handler shape; mirror `OrganisationController`'s contract)
  - [x] 1.7 Extend `ArchitectureController` with the three endpoints
    - `POST /api/projects/{projectId}/architectures` → calls `service.create`, returns 201 with body
    - `PATCH /api/projects/{projectId}/architectures/{architectureId}` → calls `service.update`, returns 200 with body
    - `POST /api/projects/{projectId}/architectures/{architectureId}/archive` → calls `service.archive`, returns 200 (or 204 — pick the one matching the existing controller convention from spec #1's list endpoint)
    - Add request DTO classes `CreateArchitectureRequest` and `UpdateArchitectureRequest` with `@NotBlank`, `@Size(max=100)`, `@Size(max=500)` annotations matching the validation rules from the spec
    - Reuse `ArchitectureMapper` for the response shape
  - [x] 1.8 Ensure backend tests pass
    - Run ONLY the 2-8 tests written in 1.1 via the `javac` + `mvn surefire:test -Dtest=...` workaround (the four pre-existing broken test files block `mvn test`)
    - Verify Liquibase 092 applies cleanly against a freshly-started service (run the service once locally if possible; check startup logs for changeset application + zero checksum errors)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Safety property (a) verified: 409 on duplicate name, case-insensitive
- Safety property (b) verified: 422 on archive of last architecture
- Safety property (c) verified: PATCH replaces the full tag set atomically
- Liquibase 092 registered in master changelog and applies without checksum errors
- No edits made to applied changesets 087-091

---

### Gateway Layer

#### Task Group 2: Gateway Proxy Routes + Client Functions
**Dependencies:** Task Group 1

Add the three proxy routes in `gateway/src/routes/architectures.ts` and the three client functions in `gateway/src/services/architectureModelClient.ts`. Status codes and error bodies pass through untouched so the frontend can render inline 409 messages.

- [x] 2.0 Complete gateway layer
  - [x] 2.1 Write 2-8 focused tests for gateway routes + client
    - Test: `POST /api/projects/:projectId/architectures` proxies to backend `POST` and returns the 201 body
    - Test: gateway returns 409 status + body verbatim when backend returns 409 (do not transform — frontend depends on status code branching)
    - Test: gateway returns 422 status + body verbatim when backend returns 422
    - Test: `PATCH` proxy forwards the full `{name, description, tags}` payload unchanged
    - Test: `POST /archive` proxy forwards correctly and returns the backend status verbatim
    - Use Jest with `jest.mock('axios')` (or whatever HTTP client `architectureModelClient.ts` already uses); mirror the test pattern from existing architecture route tests
    - Limit to 2-8 tests maximum
  - [x] 2.2 Extend `gateway/src/services/architectureModelClient.ts`
    - Add `createArchitecture(projectId, payload)` → `POST /api/projects/{projectId}/architectures`
    - Add `updateArchitecture(projectId, architectureId, payload)` → `PATCH /api/projects/{projectId}/architectures/{architectureId}`
    - Add `archiveArchitecture(projectId, architectureId)` → `POST /api/projects/{projectId}/architectures/{architectureId}/archive`
    - Each function returns the parsed body on success and rethrows the upstream error with status preserved on failure (so the route layer can pass status codes through)
    - Reuse the existing `architectureModelClient` axios/fetch instance; do not introduce a parallel HTTP client
  - [x] 2.3 Extend `gateway/src/routes/architectures.ts` with the three routes
    - `router.post('/api/projects/:projectId/architectures', ...)` → calls `createArchitecture`, passes status + body through
    - `router.patch('/api/projects/:projectId/architectures/:architectureId', ...)` → calls `updateArchitecture`
    - `router.post('/api/projects/:projectId/architectures/:architectureId/archive', ...)` → calls `archiveArchitecture`
    - Error handling: catch upstream HTTP errors, set `res.status(error.response.status).json(error.response.data)` so 409 / 422 / 400 / 404 round-trip verbatim
    - Mirror the pattern of the existing `GET /api/projects/:projectId/architectures` route from spec #1
  - [x] 2.4 Ensure gateway tests pass
    - Run ONLY the 2-8 tests written in 2.1: `npx jest gateway/src/__tests__/architectures.proxy.test.ts` (or whatever the new test file is named)
    - Do NOT run the entire gateway test suite at this stage (pre-existing failures listed in project memory are not in scope)

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- 409 / 422 / 400 / 404 status codes and bodies round-trip from backend → gateway → caller untransformed
- Three new client functions exported from `architectureModelClient.ts`
- Three new proxy routes registered in `architectures.ts`

---

### Frontend Foundation

#### Task Group 3: Frontend API Client + ArchitectureContext.refreshArchitectures()
**Dependencies:** Task Group 2

Add the three new functions to `architecturesApi.ts` and extend `ArchitectureContext` (added in spec #2) with a `refreshArchitectures()` callable. Every CRUD modal will call this on success.

- [x] 3.0 Complete frontend API + context layer
  - [x] 3.1 Write 2-8 focused tests for the API client + context
    - Test: `createArchitecture(projectId, payload)` POSTs to the correct URL and returns the parsed body
    - Test: `updateArchitecture` and `archiveArchitecture` call the correct verbs + URLs
    - Test: API client throws a typed error carrying the HTTP status (so callers can branch on 409 vs 422 vs other) — assert `error.status === 409` after a mocked 409 response
    - Test (safety property e foundation): `ArchitectureContext.refreshArchitectures()` re-invokes `listArchitectures(projectId)` and updates the in-memory `architectures` array — render with `MemoryRouter`, mock `listArchitectures` to return `[a1]` on first call and `[a1, a2]` on second, call `refreshArchitectures()`, assert the updated array
    - Limit to 2-8 tests maximum; use `vi.mock()` per project memory
  - [x] 3.2 Extend `frontend/src/api/architecturesApi.ts`
    - Add `createArchitecture(projectId: string, payload: {name: string; description?: string; tags?: string[]}): Promise<Architecture>`
    - Add `updateArchitecture(projectId: string, architectureId: string, payload: {name: string; description: string; tags: string[]}): Promise<Architecture>`
    - Add `archiveArchitecture(projectId: string, architectureId: string): Promise<void>`
    - Throw a typed `HttpError` (or equivalent — match the pattern from the existing `listArchitectures` function in the same file) with `status` and `body` properties so callers can branch on 409 vs 422
  - [x] 3.3 Extend `frontend/src/contexts/ArchitectureContext.tsx` with `refreshArchitectures()`
    - Add a `refreshArchitectures: () => Promise<void>` field to the context value type
    - Implementation re-invokes `listArchitectures(projectId)` (the spec #2 fetch already in `ArchitectureProvider`) and updates the state holding `architectures`
    - Memoize with `useCallback` so consumers can put it in `useEffect` deps without infinite loops
    - Do not change the existing `architectures`, `activeArchitectureId`, or `setActiveArchitecture` surfaces — additive only
  - [x] 3.4 Ensure frontend foundation tests pass
    - Run ONLY the 2-8 tests written in 3.1 via `npx vitest run path/to/new/test/file`
    - Do NOT run the entire frontend test suite (long list of pre-existing failures per project memory is not in scope)

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Three new API client functions exported with typed-error handling for 409 / 422 branching
- `ArchitectureContext` exposes `refreshArchitectures()` without breaking existing consumers
- Foundation for safety property (e) in place

---

### Modals

#### Task Group 4: EditArchitectureModal (Combined Create + Edit)
**Dependencies:** Task Group 3

Build the shared `EditArchitectureModal.tsx` driven by a `mode: 'create' | 'edit'` prop. Fields: Name (required, inline-validated), Description (optional, multi-line), Tags (chip UI — local primitive). Submit calls `createArchitecture` or `updateArchitecture` then `refreshArchitectures()`. On 409, surfaces inline next to Name. Use `RenameDiagramModal.tsx` as the modal-shell template.

- [x] 4.0 Complete EditArchitectureModal
  - [x] 4.1 Write 2-8 focused tests for EditArchitectureModal
    - Test (create flow): render with `mode='create'`, fill Name + Description, add two tag chips, click Create → assert `createArchitecture` called once with `{name, description, tags: [...]}`, then `refreshArchitectures()` called, then modal closes, then `setActiveArchitecture(newId)` called with the created id
    - Test (edit flow): render with `mode='edit'` and pre-populated `{name, description, tags}`, change all three fields, click Save changes → assert `updateArchitecture` called once with the full new payload (safety property c — single atomic save)
    - Test (safety property a — client surface of 409): mock `createArchitecture` to throw `{status: 409, body: {message: "..."}}`, click Create → assert inline error renders next to Name field, modal stays open, no `refreshArchitectures()` call
    - Test (tag chip add): type `current-state`, press Enter → assert chip rendered; type `target-state,` (with comma) → assert chip rendered; type duplicate → assert rejected silently (no second chip); type 51-char value → assert rejected with inline error; type whitespace-only → assert rejected
    - Test (tag chip remove): click `×` on a chip → assert chip removed from the chip set; submit → assert payload `tags` array reflects the removal
    - Test (submit disabled): empty Name → assert Create/Save disabled; in-flight (mock pending promise) → assert disabled
    - Limit to 2-8 tests maximum; use `vi.mock()` for `architecturesApi`, `ArchitectureContext`, and React Router `useNavigate`
  - [x] 4.2 Create `frontend/src/components/TopBar/EditArchitectureModal.tsx`
    - Props: `{mode: 'create' | 'edit', projectId: string, initial?: {id: string; name: string; description: string; tags: string[]}, onClose: () => void}`
    - Modal shell: copy the structure from `frontend/src/components/DiagramsView/modals/RenameDiagramModal.tsx` (portal overlay, header, scrollable content, footer with Cancel + primary)
    - Click-outside-to-close, Esc to dismiss, focus first input on mount
    - Submit button label: `Create` if `mode==='create'`, `Save changes` if `mode==='edit'`
    - Disabled state: while invalid OR while in-flight (track local `isSubmitting` state)
  - [x] 4.3 Implement the form fields
    - Name `<input>` — required; inline-validated (non-empty after trim, ≤100 chars); error renders below the field
    - Description `<textarea>` — optional; ≤500 chars; counter optional but match existing modal conventions
    - Tags chip area — see 4.4 for the chip primitive
    - Field-level validation runs on blur AND on change (after first blur) — match the pattern of the existing `RenameDiagramModal`
  - [x] 4.4 Build the local tag chip primitive (scoped to this file — no premature extraction)
    - Renders existing tags as removable chips (chip + `×` button)
    - Below the chip row: a single `<input>` accepting Enter or comma to commit
    - Commit pipeline: trim → reject empty → reject if length >50 → check case-sensitive duplicate against current chip set → reject if duplicate → append
    - On reject, show a transient inline error message ("Tag too long" / "Tag already added") — clears on next valid input or 3s timeout
    - Backspace on the empty input removes the most recent chip (nice-to-have; only if cheap)
  - [x] 4.5 Wire the submit handler
    - On Create: call `createArchitecture(projectId, {name, description, tags})`; on success → call `refreshArchitectures()`, await it, then call `setActiveArchitecture(created.id)`, then `onClose()`
    - On Edit: call `updateArchitecture(projectId, initial.id, {name, description, tags})`; on success → `refreshArchitectures()`, await it, then `onClose()` (no navigation — id unchanged)
    - On 409 (duplicate name): catch the typed error, render the message inline next to Name (NOT a toast); modal stays open, no refresh
    - On 400 (validation slip): catch and render generic "Could not save — please check your input"; modal stays open
    - On other errors: render generic error in modal footer
  - [x] 4.6 Add `frontend/src/components/TopBar/EditArchitectureModal.module.css`
    - Match the visual structure of `RenameDiagramModal.module.css`
    - Add chip and chip-input styles (rounded chip with `×`, input below)
  - [x] 4.7 Ensure EditArchitectureModal tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Safety property (a) verified: 409 surfaces inline next to Name, modal stays open
- Safety property (c) verified: PATCH carries `{name, description, tags}` in one payload
- Safety property (e) verified: `refreshArchitectures()` called on success
- Tag chip primitive supports Enter / comma add, `×` remove, trim, dedupe, 50-char max, empty rejection
- Modal shell matches `RenameDiagramModal.tsx` (overlay, click-outside, Esc, focus management)

---

#### Task Group 5: ManageArchitecturesModal
**Dependencies:** Task Group 4

List of non-archived architectures with per-row Edit + Archive buttons. Edit opens `EditArchitectureModal` in `mode='edit'`. Archive opens `ArchiveArchitectureConfirmModal` (built in group 6 — leave a stub `onArchive` handler that this group's tests assert is wired correctly).

- [x] 5.0 Complete ManageArchitecturesModal
  - [x] 5.1 Write 2-8 focused tests for ManageArchitecturesModal
    - Test: renders one row per non-archived architecture from `ArchitectureContext.architectures`, oldest first (matches spec #2 selector ordering)
    - Test: archived architectures are NOT rendered
    - Test: each row shows Name, Description (truncated if long), read-only tag chips
    - Test: clicking Edit on a row opens `EditArchitectureModal` in `mode='edit'` with that row's `{name, description, tags}` pre-populated (assert via the component prop or rendered DOM state — spy on the modal-open callback)
    - Test (safety property b — client side): when `architectures.filter(a => !a.archived).length === 1`, the Archive button on the only row is `disabled` and has the tooltip "Cannot archive — every project must have at least one architecture." — and clicking it does NOT call `archiveArchitecture`
    - Test: clicking Archive on a non-last row triggers the archive-confirmation flow (spy on `onArchiveClick` or assert the confirm modal opens)
    - Limit to 2-8 tests maximum
  - [x] 5.2 Create `frontend/src/components/TopBar/ManageArchitecturesModal.tsx`
    - Props: `{projectId: string, onClose: () => void}`
    - Modal shell: same `RenameDiagramModal.tsx` pattern, but wider (architectures list needs more horizontal space)
    - Reads `architectures` from `useArchitectureContext()`; filters `!archived`; sorts oldest-first by `createdAt` (or `id` if `createdAt` not exposed in the DTO — check what spec #1 surfaced)
  - [x] 5.3 Render the row layout
    - Each row: left side `[Name | Description (truncated to ~80 chars with ellipsis) | Tag chips (read-only, no `×`)]`, right side `[Edit button] [Archive button]`
    - Empty state per requirements decision #19: never shown — at least one row always exists; do not add "no architectures" copy
    - Style with a new `frontend/src/components/TopBar/ManageArchitecturesModal.module.css`
  - [x] 5.4 Wire the row actions
    - Edit click → set local state `{editingArchitecture: row}`, render `<EditArchitectureModal mode='edit' initial={row} ... />` (open one nested modal at a time)
    - Archive click → set local state `{archivingArchitecture: row}`, render `<ArchiveArchitectureConfirmModal architecture={row} ... />` (will be built in group 6 — for now wire the open/close state and pass a placeholder confirm handler)
    - On nested modal close → clear the local state and re-read `architectures` from context (which group 4's `EditArchitectureModal` already refreshed via `refreshArchitectures()`)
  - [x] 5.5 Implement last-architecture Archive disable (defence in depth — server also rejects with 422)
    - Compute `nonArchivedCount = architectures.filter(a => !a.archived).length`
    - For each row, the Archive button is `disabled` if `nonArchivedCount === 1`
    - Tooltip via `title=` attribute (or existing tooltip primitive if one is in use): "Cannot archive — every project must have at least one architecture."
  - [x] 5.6 Ensure ManageArchitecturesModal tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Safety property (b) verified client-side: Archive button disabled on the only-remaining row with the correct tooltip
- Edit opens `EditArchitectureModal` pre-populated with the row's data
- Archived architectures hidden from the list
- Rows sorted oldest-first matching spec #2 selector ordering

---

#### Task Group 6: ArchiveArchitectureConfirmModal
**Dependencies:** Task Group 5

Confirmation modal modelled on `DeleteDiagramConfirmModal.tsx`. Includes the active-architecture warning ("You'll be moved to **<next>**") and post-archive navigation via `setActiveArchitecture(nextId)`.

- [x] 6.0 Complete ArchiveArchitectureConfirmModal
  - [x] 6.1 Write 2-8 focused tests for ArchiveArchitectureConfirmModal
    - Test (default copy): render with a non-active architecture → assert body reads "Archive `<name>`? This hides it from the selector. (Unarchive is not yet supported.)" and the active-architecture warning paragraph is NOT present
    - Test (active-architecture warning): render with the architecture that matches `activeArchitectureId` → assert the additional warning paragraph "You're archiving the architecture you're currently viewing. You'll be moved to **`<next>`**." is rendered with `<next>` resolved client-side as the new oldest non-archived after excluding this row
    - Test (safety property d): mock `archiveArchitecture` to resolve, render with the active architecture, click Confirm → assert sequence: `archiveArchitecture` called, `refreshArchitectures()` called, `setActiveArchitecture(nextId)` called with the resolved next id, modal closes
    - Test (safety property e — non-active path): archive a non-active architecture → assert `refreshArchitectures()` called but `setActiveArchitecture` NOT called (URL stays put)
    - Test (safety property b — server race): mock `archiveArchitecture` to throw `{status: 422, body: {message: "..."}}` → assert error renders inline, modal stays open, no navigation
    - Limit to 2-8 tests maximum
  - [x] 6.2 Create `frontend/src/components/TopBar/ArchiveArchitectureConfirmModal.tsx`
    - Props: `{architecture: Architecture, projectId: string, onClose: () => void}`
    - Modal shell: copy from `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.tsx` (warning copy + secondary Cancel + destructive primary `Archive`)
    - Compute `isActive = architecture.id === activeArchitectureId` (read from `useArchitectureContext()`)
    - Compute `nextArchitecture = architectures.filter(a => !a.archived && a.id !== architecture.id).sort(byCreatedAt)[0]` (the new oldest non-archived after excluding this row) — only computed when `isActive`
  - [x] 6.3 Render the body copy
    - Always: "Archive `<name>`? This hides it from the selector. (Unarchive is not yet supported.)"
    - When `isActive` AND `nextArchitecture` defined: append a paragraph "You're archiving the architecture you're currently viewing. You'll be moved to **`<nextArchitecture.name>`**."
    - When `isActive` AND no `nextArchitecture` defined: this case should be unreachable (the only-remaining-row Archive button is disabled in group 5). Render a defensive fallback message and disable Confirm just in case
  - [x] 6.4 Wire the confirm handler
    - Call `archiveArchitecture(projectId, architecture.id)`
    - On success: `await refreshArchitectures()`; if `isActive`, call `setActiveArchitecture(nextArchitecture.id)` (explicit navigation — faster than waiting for `<ProjectLayout>` redirect to catch a stale id, though that redirect is the safety net per spec #2); then `onClose()`
    - On 422 (server race): catch typed error, render `body.message` inline at the bottom of the modal, keep modal open, do NOT call `refreshArchitectures` or navigate
    - On other errors: generic "Could not archive — please try again" inline
  - [x] 6.5 Backfill the wiring in `ManageArchitecturesModal`
    - Replace the placeholder confirm handler from task 5.4 with the real `<ArchiveArchitectureConfirmModal />` import + render
    - Verify the existing group 5 tests still pass (re-run only the group 5 tests, not the full suite)
  - [x] 6.6 Ensure ArchiveArchitectureConfirmModal tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Re-run the group 5 tests to confirm the backfill didn't regress them
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass; group 5 tests still pass
- Safety property (b) verified server-race side: 422 surfaces inline, modal stays open
- Safety property (d) verified: archiving the active architecture triggers `setActiveArchitecture(nextId)` after `refreshArchitectures()`
- Safety property (e) verified: `refreshArchitectures()` called on success regardless of active/non-active
- Active-architecture warning paragraph rendered with the correct resolved `<next>` name only when applicable

---

### Selector Integration

#### Task Group 7: ArchitectureSelector Footer Entries
**Dependencies:** Task Group 6

Extend spec #2's `ArchitectureSelector` dropdown with a separator + two footer entries: `+ Create architecture…` (opens `EditArchitectureModal` in `mode='create'`) and `Manage architectures…` (opens `ManageArchitecturesModal`). Both always visible, even with one architecture.

- [x] 7.0 Complete selector dropdown extension
  - [x] 7.1 Write 2-8 focused tests for the selector footer
    - Test: open the dropdown → assert separator and both footer entries (`+ Create architecture…`, `Manage architectures…`) are rendered, even when `architectures.length === 1`
    - Test: clicking `+ Create architecture…` → assert `EditArchitectureModal` opens with `mode='create'` (and the dropdown closes)
    - Test: clicking `Manage architectures…` → assert `ManageArchitecturesModal` opens (and the dropdown closes)
    - Test: existing architecture-name list rendering from spec #2 still works (one architecture name per row, click selects via `setActiveArchitecture`) — guard against regression of spec #2 behaviour
    - Limit to 2-8 tests maximum
  - [x] 7.2 Extend `frontend/src/components/TopBar/ArchitectureSelector.tsx`
    - Below the existing architecture-name list rendering: insert `<hr>` (or styled separator div) + two clickable rows
    - `+ Create architecture…` row → `onClick`: closes dropdown, opens `EditArchitectureModal` (`mode='create'`) via local state
    - `Manage architectures…` row → `onClick`: closes dropdown, opens `ManageArchitecturesModal` via local state
    - Both rows always visible (no conditional hiding for single-architecture projects)
    - Keep the existing list rendering intact — additive only
  - [x] 7.3 Wire the modal open/close state
    - Add local state `{createModalOpen: boolean, manageModalOpen: boolean}` in `ArchitectureSelector` (or hoist to a parent if cleaner — match the existing modal-state pattern in TopBar)
    - Render `<EditArchitectureModal mode='create' projectId={projectId} onClose={...} />` when `createModalOpen`
    - Render `<ManageArchitecturesModal projectId={projectId} onClose={...} />` when `manageModalOpen`
    - On close → clear the state; the modals already trigger `refreshArchitectures()` so the dropdown re-renders against fresh data on next open
  - [x] 7.4 Update spec #2's `ArchitectureSelector.test.tsx` (mechanical)
    - Per spec line 90: "spec #2's `ArchitectureSelector.test.tsx` to assert the two new footer entries are rendered and route to the correct modals"
    - Add the two assertions inside the existing test file rather than creating a parallel file
    - Verify subagent regex-based edits did not break any existing assertion in that file (project-memory rule: subagent regex edits can break with nested braces — manually re-read the file after editing)
  - [x] 7.5 Ensure selector tests pass
    - Run ONLY the 2-8 tests written in 7.1 plus the existing `ArchitectureSelector.test.tsx`
    - Do NOT run the entire frontend test suite

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Existing `ArchitectureSelector.test.tsx` still passes after the mechanical update
- Both footer entries always visible regardless of architecture count
- Spec #2's name-list selection behaviour is unchanged
- Modals open from the dropdown and close cleanly with `refreshArchitectures()` already called

---

### Testing

#### Task Group 8: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-7

Review the focused tests written by each prior group, identify critical gaps in feature-level integration coverage, and add up to 10 strategic tests maximum. Focus on end-to-end flows touching multiple layers (e.g. create → list refresh → selector renders new entry → can navigate to it). Skip exhaustive coverage.

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 2-8 tests written by the backend implementer (Task 1.1)
    - Review the 2-8 tests written by the gateway implementer (Task 2.1)
    - Review the 2-8 tests written by the frontend foundation implementer (Task 3.1)
    - Review the 2-8 tests written by each modal implementer (Tasks 4.1, 5.1, 6.1)
    - Review the 2-8 tests written by the selector implementer (Task 7.1)
    - Total existing tests: approximately 14-56 tests
  - [x] 8.2 Verify all five safety properties have a callable test
    - (a) duplicate name → 409 → inline at Name field — covered by 1.1 + 4.1
    - (b) last architecture → 422 + button disabled — covered by 1.1 + 5.1 + 6.1
    - (c) PATCH atomic — covered by 1.1 + 4.1
    - (d) active-architecture archive redirect — covered by 6.1
    - (e) `refreshArchitectures()` after mutation — covered by 3.1 + 4.1 + 6.1
    - If any property lacks a test, add it as part of the up-to-10-test budget below (highest priority)
  - [x] 8.3 Analyse test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage:
      - Full create flow: dropdown footer → modal → submit → list refresh → new entry visible in dropdown → selecting it navigates
      - Full archive-active flow: dropdown footer → manage modal → archive row → confirm modal → navigate to next architecture (URL changes)
      - Tag chip interaction inside an integrated modal context (not just unit-tested)
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritise integration over unit-level gaps
  - [x] 8.4 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps
    - Recommended (pick subset to fit the 10-test cap):
      - End-to-end create flow integration test (dropdown → modal → list refresh → dropdown shows new entry)
      - End-to-end archive-active flow integration test (dropdown → manage → archive → confirm → URL navigates)
      - End-to-end edit flow integration test (dropdown → manage → edit → save → list shows updated name + tags)
      - 422 race-condition test in `ArchiveArchitectureConfirmModal` if not already in 6.1
      - Backend integration test exercising create then archive then list-after-archive (asserts the row is hidden)
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 8.5 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.4)
    - Expected total: approximately 24-66 tests maximum
    - Use the `javac` + `mvn surefire:test -Dtest=...` workaround for backend (pre-existing broken tests block `mvn test`)
    - For frontend, target tests by file path with `npx vitest run` — do NOT run the full Vitest suite (long list of pre-existing failures from prior specs per project memory: `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `conversation-memory-edge-cases.test.ts`, `DiagramsViewTemporaryDiagram.test.tsx`, `TopBar.export-flow.test.tsx`, plus `UnifiedChatPanel`/`TemporaryDiagramContext` failures from commit 0742b99)
    - Verify all five safety properties (a)-(e) have at least one passing assertion

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-66 tests total)
- All five safety properties (a)-(e) have at least one passing test
- Critical user workflows for this feature are covered (create, edit, archive non-active, archive active, last-architecture protection)
- No more than 10 additional tests added when filling testing gaps
- Testing focused exclusively on this spec's feature requirements
- No attempt made to fix pre-existing failing tests from prior specs

---

## Execution Order

Recommended implementation sequence:
1. **Backend Foundation** (Task Group 1) — Liquibase 092 + service/controller + exception mapping
2. **Gateway Layer** (Task Group 2) — proxy routes + client functions
3. **Frontend Foundation** (Task Group 3) — API client + `ArchitectureContext.refreshArchitectures()`
4. **EditArchitectureModal** (Task Group 4) — combined create + edit with tag chip primitive
5. **ManageArchitecturesModal** (Task Group 5) — list with per-row Edit + Archive
6. **ArchiveArchitectureConfirmModal** (Task Group 6) — confirm with active-architecture warning + navigation; backfill wiring in group 5
7. **Selector Footer Entries** (Task Group 7) — dropdown extension that opens groups 4+5 modals
8. **Test Review & Gap Analysis** (Task Group 8) — verify all five safety properties + add up to 10 integration tests

Each task group is implementable independently by a single implementer subagent call once its dependencies have landed.
