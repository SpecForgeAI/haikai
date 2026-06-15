# Task Breakdown: Target State Sub-tab + Deterministic Suggest

## Overview
Total Tasks: 6 task groups, 38 sub-tasks
Commit Boundary: One commit covering all six task groups (per spec Commit Boundary section).

## Task List

### Backend (Architecture Model Service)

#### Task Group 1: `SuggestFromCurrentService` + new endpoint + integration tests
**Dependencies:** None

- [x] 1.0 Build the deterministic Suggest-from-current backend stack
  - [x] 1.1 Write 2-8 focused integration tests for the new endpoint
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/SuggestFromCurrentServiceIntegrationTest.java`
    - Limit to 2-8 highly focused tests maximum (target 2 tests for this spec's Test Coverage section, leave headroom for one optional double-click-guard 409 assertion if cheap).
    - Test 1 (happy path): seed a current architecture with a non-trivial mix - 1 application, 2 components, 1 service with 1 interface + 2 endpoints, 1 logical data entity with 2 attributes, 1 physical data entity, 1 infrastructure node. Invoke the new endpoint. Assert (a) a new target draft was created with auto-name `Target State - Suggested YYYY-MM-DD`, `kind='target'`, `draft_state='draft'`; (b) every source element has a cloned element in the new draft with matching name/description/attributes and `provenance='cloned-from-current'`; (c) exactly one `architecture_element_mappings` row exists per cloned element with `mapping_type='equivalent'`, `status='confirmed'`, `confidence=1.0`, `created_by_task='target-state-suggest'`, correct `source_element_id` / `target_element_id` / `source_architecture_id` / `target_architecture_id`; (d) diagram tables (`sequence_diagrams`, `sequence_fragments`) are NOT cloned.
    - Test 2 (empty-source 422): seed a current architecture with zero in-scope elements. Invoke endpoint. Assert HTTP 422, message `"Current architecture has no elements to suggest from"`, no new draft row, no `architecture_element_mappings` rows.
    - Skip exhaustive coverage of per-domain element-type permutations; skip rename-suffix scan beyond what test 1 exercises naturally.
  - [x] 1.2 Create request + response DTOs
    - Files:
      - `architecture-model-service/src/main/java/com/example/architecturemodel/dto/SuggestFromCurrentRequest.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/dto/SuggestFromCurrentResponse.java`
    - Request fields: `currentArchitectureId` (UUID, required).
    - Response fields: `newDraftId` (UUID), `resolvedName` (String), `clonedElementCount` (int), `mappingRowCount` (int).
    - Both annotated with `@JsonNaming(LowerCamelCaseStrategy.class)` per the selective-copy DTO pattern.
  - [x] 1.3 Create `SuggestFromCurrentService` class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/SuggestFromCurrentService.java`
    - Single `@Transactional` public method `SuggestFromCurrentResponse suggestFromCurrent(UUID projectId, SuggestFromCurrentRequest request)`.
    - Phase 1: call `modelService.loadModelByProjectIdAndArchitectureId(projectId, currentArchitectureId)`. If zero elements across all in-scope meta-model domains, throw a domain exception that maps to HTTP 422 with the exact message `"Current architecture has no elements to suggest from"`.
    - Phase 2: resolve auto-name via same-day collision scan (`Target State - Suggested YYYY-MM-DD`, append ` (2)`, ` (3)`, etc.). Apply 5-second double-click guard: if a draft with the resolved name exists with `created_at` within the last 5 seconds, throw a domain exception that maps to HTTP 409 with a message identifying the existing draft. Then delegate the deep-copy to `ArchitectureCloneService.cloneArchitecture(projectId, currentArchitectureId, resolvedName, newDescription, includedTables)` passing an `includedTables` list covering every meta-model entity table (applications, application_components, services, interfaces, endpoints, classes, methods, application_points, logical/physical data entities + attributes, business entities, UI entities, infrastructure entities and their typed children, events, states) and explicitly excluding diagram tables (`sequence_diagrams`, `sequence_fragments`, and any other diagram-domain tables).
    - Phase 3: in the SAME transactional boundary, bulk insert one `architecture_element_mappings` row per cloned element via `ArchitectureElementMappingRepository` / `ArchitectureElementMappingService` with `mapping_type='equivalent'`, `status='confirmed'`, `confidence=1.0`, `created_by_task='target-state-suggest'`, `source_element_id` / `target_element_id` / `source_architecture_id` / `target_architecture_id` populated from the clone result.
    - New draft `kind='target'`, `draft_state='draft'`; each cloned element's `provenance='cloned-from-current'`.
    - Do NOT add any new columns to entity tables. Back-reference lives only in the mapping rows.
  - [x] 1.4 Audit `ArchitectureCloneService.cloneArchitecture` for `includedTables` opt-out
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`
    - Confirm the existing method already supports an explicit inclusion list that can omit diagram tables (per spec Implementation Notes: "If the clone service does not currently expose a way to opt out of diagrams, audit + extend its parameter handling minimally").
    - If a minimal extension is needed, add only the parameter plumbing; no behavioural change to the clone walk itself.
  - [x] 1.5 Create endpoint controller wiring
    - Add `POST /api/projects/{projectId}/target-architectures/suggest-from-current` to the existing target-architecture controller (or a new co-located controller, matching the existing convention).
    - Map the domain 422 exception to `HttpStatus.UNPROCESSABLE_ENTITY` and the domain 409 exception to `HttpStatus.CONFLICT` via the standard `@ControllerAdvice` / `ResponseStatusException` pattern used elsewhere in the service.
    - The existing `POST /target-architectures/seed` endpoint and its `clone-current` / `blank` / `from-template` modes are untouched.
  - [x] 1.6 Ensure backend tests pass
    - Run ONLY the 2 tests written in 1.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2 tests in 1.1 pass.
- New endpoint accepts `currentArchitectureId` in the request body and returns the new draft id + resolved name + counts.
- Empty current architecture yields HTTP 422 with the specified message and writes no rows.
- 5-second double-click guard yields HTTP 409.
- Phase 2 + Phase 3 share one `@Transactional` boundary; mapping-insert failure rolls back the clone.
- No schema changes; no new columns on entity tables; no new Liquibase changesets.
- `TargetArchitectureSeedService` and the existing `/target-architectures/seed` endpoint are untouched.

### Gateway

#### Task Group 2: Gateway proxy + removal of broken LLM Suggest stack
**Dependencies:** Task Group 1 (endpoint must exist for the proxy contract to be meaningful; deletes can run in parallel)

- [x] 2.0 Wire the new endpoint and tear down the LLM Suggest stack
  - [x] 2.1 Add gateway proxy route + client function for the new endpoint
    - Route file: add a small handler (existing target-architecture proxy route file, or a new file co-located with peer proxy routes) that forwards `POST /api/projects/:projectId/target-architectures/suggest-from-current` to the Architecture Model Service preserving the request body and path params.
    - Register the route in `gateway/src/server.ts` if a new route file is introduced.
    - No new business logic in the gateway; pure pass-through.
  - [x] 2.2 Delete `gateway/src/routes/suggestTargetArchitecture.ts`
    - Before deletion: grep `gateway/src/` for incoming references (per `feedback_trace_before_coding.md`).
  - [x] 2.3 Delete `gateway/src/services/suggestTargetArchitectureHandler.ts`
    - Before deletion: grep `gateway/src/` for incoming references.
  - [x] 2.4 Delete LLM task config + prompt files
    - `gateway/src/config/tasks/product-manager--suggest-target-architecture.json`
    - `gateway/src/config/prompts/product-manager.suggest-target-architecture.task.md`
    - Confirm no remaining task registry references either file.
  - [x] 2.5 Unwire `server.ts` route registration for the deleted LLM Suggest route
    - File: `gateway/src/server.ts`
    - Remove the `app.use(...)` / route mount line bound to the deleted `suggestTargetArchitecture.ts` route file.
    - Gateway still boots cleanly with no missing import errors.
  - [x] 2.6 Delete gateway-side tests that exercised the deleted LLM Suggest path
    - Grep `gateway/src/__tests__/` for `suggestTargetArchitecture` and delete the matching test files wholesale.
    - Do NOT touch unrelated gateway tests.
  - [x] 2.7 Confirm gateway still compiles
    - Run `tsc --noEmit` (or the project equivalent) against `gateway/`. No type errors, no missing imports.
    - Do NOT run the entire gateway test suite at this stage; that happens in Task Group 6.

**Acceptance Criteria:**
- New proxy route forwards to the Architecture Model Service endpoint with body + path params intact.
- Grep across `gateway/src/` for `suggestTargetArchitecture` returns zero hits.
- The four LLM-stack files listed in spec "Removal of broken LLM stack" no longer exist.
- `gateway/src/server.ts` has no dangling route mount for the deleted handler.
- Gateway TypeScript compilation passes.

### Frontend Navigation

#### Task Group 3: Sub-tab nav re-home + redirect from old route
**Dependencies:** Task Group 2 (Gateway proxy exists so the rewired UI can be exercised manually; technically routing changes are independent)

- [x] 3.0 Re-home Target Architecture as a Target State sub-tab under Architecture & Design
  - [x] 3.1 Add the sub-tab nav strip to the Architecture & Design page
    - File: the existing Architecture & Design page component (the `metamodel` route's top-level component in `frontend/src/components/Architecture/` - identify by following the `<Route path="metamodel" ...>` element in `App.tsx`).
    - Two peers: "Current State" (default, existing metamodel domain view) and "Target State" (the new sub-route).
    - Active sub-tab reflects the URL (not local component state) so deep-linking and browser back/forward survive.
    - The TopBar "Architecture & Design" button continues to land on Current State; users reach Target State via the sub-tab strip or directly via URL.
  - [x] 3.2 Mount `<TargetArchitectureWorkspace />` under the new sub-route
    - File: `frontend/src/App.tsx`
    - Add a child route under the `metamodel` route at path `target-state` rendering `<TargetArchitectureWorkspace />`.
    - Final route path: `/projects/:p/architectures/:a/architecture-design/target-state`.
  - [x] 3.3 Remove the top-level `target-architecture` route
    - File: `frontend/src/App.tsx` (line ~776 per spec).
    - Replace the existing `<Route path="target-architecture" element={<TargetArchitectureWorkspace />} />` with a `<Route path="target-architecture" element={<Navigate replace to="../architecture-design/target-state" />} />` (or equivalent relative `to=` that preserves `:projectId` and `:architectureId`).
    - Confirm both path params survive the redirect by manual route resolution check.
  - [x] 3.4 Remove TopBar / nav entries that pointed at the deleted top-level tab
    - Grep `frontend/src/` for any nav-strip / TopBar entry titled "Target Architecture" that linked at the old top-level route and remove the entry.
    - Do NOT touch other TopBar entries.

**Acceptance Criteria:**
- Visiting `/projects/:p/architectures/:a/target-architecture` lands on `/projects/:p/architectures/:a/architecture-design/target-state` via replace navigation (browser back does NOT bounce back to the old URL).
- The sub-tab strip on the Architecture & Design page renders Current State (active by default) and Target State (active when the URL ends in `/target-state`).
- The top-level "Target Architecture" tab is no longer reachable from the TopBar.
- Path params `:projectId` and `:architectureId` survive the redirect.

### Frontend Workspace Rewire

#### Task Group 4: Suggest rewire + empty-state + empty-badge + button hygiene
**Dependencies:** Task Groups 2 + 3

- [x] 4.0 Replace LLM Suggest call, add empty-state UX, badge empty drafts, remove dead UI
  - [x] 4.1 Add `suggestTargetFromCurrent` to the frontend API client
    - File: `frontend/src/api/targetArchitecturesApi.ts`
    - New function `suggestTargetFromCurrent(projectId: string, currentArchitectureId: string): Promise<SuggestFromCurrentResponse>`.
    - POSTs to the new gateway proxy route with body `{ currentArchitectureId }`.
    - Define matching TypeScript response type aligned with the backend DTO.
  - [x] 4.2 Remove the `suggestTargetArchitecture` LLM function from the API client
    - File: `frontend/src/api/targetArchitecturesApi.ts`
    - Delete the function declaration and any unused supporting types.
    - Grep `frontend/src/` for `suggestTargetArchitecture` to confirm zero remaining call sites before final commit.
  - [x] 4.3 Replace `handleSuggestFromCurrent` in `TargetArchitectureWorkspace`
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx` (current lines 646-683).
    - New handler captures the current `architectureId` at click time, calls `suggestTargetFromCurrent(projectId, capturedArchitectureId)`.
    - On success: dispatch the AppShell cache action per `project_appshell_model_cache.md` (same-project sibling architecture; LOAD_MODEL dispatch or equivalent cross-architecture invalidation per the memory note), refresh the drafts list, and auto-select the new draft (by `newDraftId` from the response).
    - On 422: surface the backend error message via the existing toast / error-banner pattern in the workspace.
    - On 409: surface a "draft already created in the last few seconds" message via the same error surface.
  - [x] 4.4 Add Suggest pending-disable guard
    - In `TargetArchitectureWorkspace.tsx`, introduce a local `isSuggestPending` state (or reuse the existing local pending flag if appropriate).
    - Disable the Suggest button while the request is in flight; re-enable on resolution (success or error).
    - Use a normal short-duration loading state - drop the existing `suggestPending` "Suggesting... may take 10-30s" spinner copy.
  - [x] 4.5 Drop the `overlaysByTargetId` LLM-provenance overlay stamping
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
    - Remove the state slice, the population logic, and any references in JSX. Provenance is uniformly `'cloned-from-current'` now.
    - Grep `frontend/src/` for `overlaysByTargetId` to confirm zero remaining references.
  - [x] 4.6 Remove `handleAddElement` and the "Add ..." inline-add buttons
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
    - Remove the `handleAddElement` function (current line ~605) and the four inline-add buttons ("Add Component", "Add API", "Add Data entitie", "Add Infrastructur") from the table editor.
    - Remove any helper / state slice that exists only to support those buttons.
  - [x] 4.7 Remove the Diagram View tab from the workspace
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
    - Remove the tab definition + content panel.
    - The Compare with Current tab stays exactly as is.
  - [x] 4.8 Add empty-state card when zero drafts exist
    - In `TargetArchitectureWorkspace.tsx`, when `drafts.length === 0`: render a centered card with copy `"Target State is your proposed end-state architecture. Click Suggest to generate a 1:1 clone of your current architecture as a starting point."` plus a single Suggest button.
    - Hide the Drafts panel, table editor, Compare with Current tab, and Unmapped current elements panel in this state.
    - Suggest button in the empty-state card uses the same handler from 4.3.
  - [x] 4.9 Add inline "empty" badge to zero-element drafts in the Drafts panel
    - In the Drafts panel renderer, append an inline pill / badge with text `"empty"` to any draft whose computed element count is zero.
    - Use the existing draft element-count source (either the draft summary DTO or a derived count from the loaded model); do NOT add a new backend call.
    - Style with an existing low-prominence badge style from the design system; no new CSS asset needed.

**Acceptance Criteria:**
- Grep across `frontend/src/` for `suggestTargetArchitecture`, `overlaysByTargetId`, `handleAddElement`, and the "may take 10-30s" copy returns zero hits.
- Empty drafts list renders the centered empty-state card only (no other chrome).
- Drafts panel shows the "empty" badge inline on any zero-element draft (including pre-existing broken May-20 drafts).
- After a successful Suggest, the new draft is auto-selected; it is NOT auto-promoted to active.
- Suggest button is disabled for the duration of the in-flight request and re-enables on resolution.
- The Add Component / API / Data entitie / Infrastructur buttons and the Diagram View tab no longer appear anywhere in the workspace.

### Frontend Tests

#### Task Group 5: Frontend tests for sub-tab navigation + Suggest pending-disable
**Dependencies:** Task Groups 3 + 4

- [x] 5.0 Add the two frontend tests from the spec Tests section
  - [x] 5.1 Write 2-8 focused frontend tests
    - Files:
      - `frontend/src/components/Architecture/__tests__/TargetStateSubTabNavigation.test.tsx`
      - `frontend/src/components/Architecture/__tests__/TargetArchitectureWorkspace.suggestPending.test.tsx` (or extend an existing colocated test file if the project's convention is one-file-per-component)
    - Limit to 2-8 highly focused tests maximum (target 2 tests for this spec's Test Coverage section).
    - Test 1 (sub-tab navigation): render the Architecture & Design page wrapped in a memory router pointed at `/projects/p1/architectures/a1/architecture-design/target-state`, mock `targetArchitecturesApi` to return at least one draft, assert the Target State sub-tab is active and `<TargetArchitectureWorkspace />` renders.
    - Test 2 (Suggest pending-disable): render the Target State sub-tab with at least one draft, mock `suggestTargetFromCurrent` to return a never-resolving promise (or a controllable promise), click Suggest, assert the button is `disabled` while pending; resolve the promise and assert the button re-enables.
    - Skip exhaustive routing edge cases (deep-linking from a cold start, browser back/forward) and skip exhaustive Suggest-error-path coverage; the spec calls for exactly these two frontend tests.
  - [x] 5.2 Mock setup
    - Use Vitest with `vi.mock()` per the project's frontend test pattern.
    - Mock `targetArchitecturesApi` (specifically `listTargetArchitectures`, `suggestTargetFromCurrent`) plus any other dependency the workspace pulls from `ArchitectureContext`, `PendingActionContext`, `ModalActionContext` per the project's established test patterns (see CLAUDE.md "UnifiedChatPanel requires mocks for..." for the pattern).
  - [x] 5.3 Ensure frontend tests pass
    - Run ONLY the 2 tests written in 5.1.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2 frontend tests in 5.1 pass.
- No test relies on the deleted LLM Suggest function.
- Mocks reuse the established project patterns (no ad-hoc mocking of `architectureModelClient` without `jest.requireActual` spread, etc., per CLAUDE.md).

### Verification

#### Task Group 6: Full grep sweep, regression check, manual smoke
**Dependencies:** Task Groups 1-5

- [x] 6.0 Confirm no regressions, no orphaned references, and the Definition of Done holds
  - [x] 6.1 Run the backend test suite for the affected service
    - Command: `mvn -pl architecture-model-service test` (or project equivalent).
    - All previously-passing tests continue to pass; the 2 new tests from 1.1 pass.
    - Pre-existing unrelated failures listed in CLAUDE.md may stay red - do NOT touch them.
  - [x] 6.2 Run the gateway test suite
    - Command: `npm test` in `gateway/` (or project equivalent).
    - All previously-passing tests continue to pass; the LLM-Suggest tests that were deleted in 2.6 are gone.
    - Pre-existing unrelated failures listed in CLAUDE.md may stay red.
  - [x] 6.3 Run the frontend test suite
    - Command: `npm test` in `frontend/` (or project equivalent).
    - All previously-passing tests continue to pass; the 2 new tests from 5.1 pass.
  - [x] 6.4 Final grep sweep
    - `gateway/src/` for `suggestTargetArchitecture` returns zero hits.
    - `frontend/src/` for `suggestTargetArchitecture` returns zero hits.
    - `frontend/src/` for `overlaysByTargetId` returns zero hits.
    - `frontend/src/` for `handleAddElement` (within `TargetArchitectureWorkspace.tsx` scope) returns zero hits.
    - `frontend/src/` for the literal `"may take 10-30s"` returns zero hits.
    - The four LLM stack files (route, handler, task json, prompt md) no longer exist on disk.
  - [x] 6.5 Manual smoke check against Definition of Done
    - Old bookmark `/projects/:p/architectures/:a/target-architecture` redirects to the new sub-route via replace navigation.
    - The top-level "Target Architecture" tab is no longer reachable from the TopBar.
    - On a project with a non-trivial current architecture, clicking Suggest creates a populated new target draft within ~1 second and auto-selects it; no auto-promote to active.
    - On a project with an empty current architecture, Suggest returns 422 with the specified message and creates no draft / no mapping rows.
    - Clicking Suggest twice in rapid succession yields exactly one new draft (frontend pending-disable or server 409).
    - A draft with zero elements (including any pre-existing broken May-20 draft) shows the inline "empty" badge in the Drafts panel.
    - Add Component / API / Data entitie / Infrastructur buttons and the Diagram View tab are no longer visible anywhere.

**Acceptance Criteria:**
- Backend, gateway, and frontend test suites are green (modulo pre-existing unrelated failures listed in CLAUDE.md).
- Final grep sweep yields zero hits on every banned symbol / file path.
- Every bullet under the spec's Definition of Done section is manually verified.
- Single commit covers all six task groups per the spec's Commit Boundary section.

## Execution Order

Recommended implementation sequence:
1. Task Group 1 - Backend endpoint + service (foundation; everything else depends on the contract).
2. Task Group 2 - Gateway proxy + LLM-stack deletion (depends on Group 1 contract; deletes can run alongside the proxy add).
3. Task Group 3 - Frontend navigation re-home (depends on Group 2 only for end-to-end smoke; route changes themselves are independent).
4. Task Group 4 - Frontend Suggest rewire + empty-state + badge + UI clean-up (depends on Groups 2 + 3).
5. Task Group 5 - Frontend tests (depends on Groups 3 + 4 to have testable surface).
6. Task Group 6 - Full regression + grep + manual smoke (final gate before commit).

All six task groups land in a single commit per the spec's Commit Boundary section.
