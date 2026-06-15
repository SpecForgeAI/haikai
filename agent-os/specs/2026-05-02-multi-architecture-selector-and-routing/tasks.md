# Task Breakdown: Multi-Architecture Selector + URL Routing (Spec #2)

## Overview
Total Tasks: 7 task groups, ~50 sub-tasks

This is a **frontend-only** spec. No backend, gateway, or Liquibase changes. The dependency order is critical: removing the `currentView` reducer state mid-flight will break every consumer, so routing must exist (group 1) and contexts must mirror route params (group 2) before the view-state migration (group 4) can run safely.

References:
- Spec: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/spec.md`
- Requirements: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/planning/requirements.md`
- Predecessor: `agent-os/specs/2026-05-01-multi-architecture-plumbing/spec.md`
- Multi-spec design context: `agent-os/design-notes/multi-architecture-variants.md`

## Task List

### Routing Skeleton

#### Task Group 1: BrowserRouter, Routes Tree, and ProjectLayout Skeleton
**Dependencies:** None

Introduce `react-router-dom` v6 (already declared in `frontend/package.json`) without removing any existing state-driven view selection. Components keep reading view from `currentView` for now; routing exists in parallel. This makes the breaking changes in groups 2 and 4 safe and incremental.

- [x] 1.0 Stand up the routing skeleton with no behavioural change
  - [x] 1.1 Write 2-8 focused tests for the routing skeleton
    - Test: `<BrowserRouter>` mounts without crashing the existing app shell
    - Test: visiting `/projects/:projectId/architectures/:architectureId/diagrams` renders the diagrams view (component is reachable via the route)
    - Test: visiting `/projects/:projectId/diagrams` (missing `:architectureId`) hits `<ProjectLayout>` and triggers a `<Navigate replace>` to the canonical URL using the oldest non-archived architecture from `listArchitectures(projectId)`
    - Test: SPA fallback — gateway returns `index.html` for unmatched non-API paths (or skip if existing static server already does this; verify in `gateway/src/server.ts`)
    - Use `MemoryRouter` with explicit `initialEntries` for assertions
    - Mock `listArchitectures` for the redirect test
  - [x] 1.2 Wrap `App.tsx` in `<BrowserRouter>`
    - Top-level wrapper around the existing app shell
    - Do not remove `currentView` state yet — routing exists in parallel
  - [x] 1.3 Define the routes tree
    - `/projects/:projectId/architectures/:architectureId/metamodel` → `<MetaModelView>`
    - `/projects/:projectId/architectures/:architectureId/diagrams` → `<DiagramsView>`
    - `/projects/:projectId/architectures/:architectureId/product` → `<ProductView>`
    - `/projects/:projectId/architectures/:architectureId/dashboard` → `<DashboardView>`
    - `/projects/:projectId/*` → `<ProjectLayout>` (matches both with-architecture and without-architecture URLs; `<Outlet>` renders the architecture-scoped child routes)
  - [x] 1.4 Create `frontend/src/components/Layout/ProjectLayout.tsx`
    - Reads `useParams()` for `projectId` and `architectureId`
    - If `architectureId` is missing: calls `listArchitectures(projectId)`, picks oldest non-archived, returns `<Navigate replace to={canonical}>` to the canonical URL preserving the trailing view segment (default to `/dashboard` if no view present)
    - If `architectureId` is present: renders `<Outlet>` so child routes mount unchanged
    - Toast trigger for the redirect case is wired in group 6 (placeholder no-op call site here is fine)
    - Reuse pattern from existing `App.tsx` view-routing logic for component selection
  - [x] 1.5 Verify SPA fallback in gateway/Vite
    - Inspect `gateway/src/server.ts` (or wherever static-file serving is configured)
    - Confirm unmatched non-API paths fall back to `index.html`
    - **Add the fallback only if missing.** No API changes. If already present, document confirmation in the task and skip
  - [x] 1.6 Ensure routing skeleton tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Existing app should still function with state-driven view selection
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `<BrowserRouter>` is mounted; routes tree is defined
- `<ProjectLayout>` performs the missing-architecture redirect (toast wiring deferred to group 6)
- SPA fallback confirmed/added in gateway
- All existing flows continue to work via state-driven view selection (no behavioural change yet)

---

### Context Layer

#### Task Group 2: Rewire ProjectContext + ArchitectureContext to Mirror Route Params
**Dependencies:** Task Group 1

Switch context state sources from `useEffect` + API resolution to `useParams`. Public hook surface (`useActiveProject`, `useActiveArchitectureId`) stays unchanged so consumers keep working — only the internals change. This unblocks the view-state migration in group 4.

- [x] 2.0 Make contexts derived mirrors of route params
  - [x] 2.1 Write 2-8 focused tests for context rewire
    - Test (safety property a): `useActiveArchitectureId()` returns the architecture id from the URL path segment, not from API resolution. Render with `MemoryRouter` initial entry pointing at `/projects/p1/architectures/a1/diagrams` and assert hook returns `'a1'` without any `listArchitectures` call needed for resolution
    - Test: changing the URL `:architectureId` segment causes `useActiveArchitectureId()` to return the new id (re-render assertion)
    - Test: `useActiveProject()?.id` mirrors `useParams().projectId`
    - Test: `setActiveArchitecture(id)` calls `useNavigate` and swaps only the `:architectureId` segment, preserving `:projectId` and the trailing view
    - Test: `architectures` array is populated by a single `listArchitectures(projectId)` call when `projectId` changes (still needed for the selector dropdown in group 3)
    - Mock `listArchitectures` and `useNavigate` as needed
  - [x] 2.2 Rewire `ArchitectureContext.activeArchitectureId` to derive from `useParams`
    - Remove the `useState` + `useEffect(listArchitectures...)` resolver block from `ArchitectureProvider`
    - `activeArchitectureId` now comes from `useParams().architectureId`
    - `useActiveArchitectureId()` hook signature unchanged — only its implementation switches
  - [x] 2.3 Expose `architectures: Architecture[]` and `setActiveArchitecture(id)` from `ArchitectureContext`
    - `architectures` populated by a single `listArchitectures(projectId)` call when `projectId` changes (used by selector dropdown in group 3)
    - `setActiveArchitecture(id)` calls `useNavigate` to swap only the `:architectureId` segment, keeping `:projectId` and the trailing view unchanged
    - Build the canonical URL from `useLocation` so the trailing view segment is preserved
  - [x] 2.4 Reconcile `ProjectContext.activeProject?.id` with `useParams().projectId`
    - `activeProjectId` derived from `useParams`
    - `setActiveProject` continues to work for the activate-flow but additionally calls `useNavigate` to put the new project in the URL
    - Public hook surface unchanged
  - [x] 2.5 Update `TopBar.handleOpenFromBackend` activate-on-open flow
    - Remove the inline `listArchitectures` call (was needed because context hadn't caught up); the `<ProjectLayout>` redirect now handles architecture id resolution
    - After project activation, navigate to the canonical URL (the `<ProjectLayout>` redirect fills in `:architectureId`)
  - [x] 2.6 Ensure context rewire tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify safety property (a) is callable and passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Safety property (a) test passes: `useActiveArchitectureId()` reads from URL, not from API resolution
- `useActiveArchitectureId()` and `useActiveProject()` public signatures unchanged — existing consumers (Bucket A API call sites, `App.tsx` auto-load effect) continue to work
- `architectures` and `setActiveArchitecture(id)` are newly exposed from `ArchitectureContext`
- `currentView` reducer state is **still present** at this point — its removal is group 4

---

### Selector UI

#### Task Group 3: ArchitectureSelector Component in TopBar
**Dependencies:** Task Group 2

New pill/chip + dropdown control. Shows the active architecture name; dropdown lists all non-archived architectures (oldest first); selecting a row calls `setActiveArchitecture(id)` which updates the URL. View remains `currentView`-driven — that migration is group 4.

- [x] 3.0 Build and mount the architecture selector
  - [x] 3.1 Write 2-8 focused tests for the selector
    - Test: closed selector renders the active architecture's name (read from `useActiveArchitectureId` + `architectures` lookup)
    - Test: clicking the closed control opens the dropdown showing all non-archived architectures, ordered oldest-first
    - Test (safety property c): clicking a dropdown row calls `setActiveArchitecture(id)`, which updates the URL `:architectureId` segment and propagates the new active architecture id through context
    - Test: only architecture name is rendered — no tags (tags exist in schema but have no UI until spec #3)
    - Test: archived architectures are filtered out of the dropdown
    - Test: dropdown closes on click-outside and on `Escape` key
    - Use `MemoryRouter` for route-driven assertions
  - [x] 3.2 Create `frontend/src/components/TopBar/ArchitectureSelector.tsx`
    - Pill/chip with subtle border (closed state reads as interactive even with only a `Default` architecture)
    - Click opens dropdown listing all non-archived architectures for the active project, ordered oldest-first (matches spec #1's Default-resolution rule)
    - Both closed control and dropdown rows show **just the name** — no tags
    - Selecting a row calls `setActiveArchitecture(id)` (from `ArchitectureContext`)
    - Reuse positioning, click-outside-to-close, and keyboard-escape behaviour from `frontend/src/components/TopBar/FileMenu.tsx` (portal-rendered dropdown, `useEffect` cleanup)
  - [x] 3.3 Create `frontend/src/components/TopBar/ArchitectureSelector.module.css`
    - Pill/chip styling matching the visual language of `FileMenu.tsx`
    - Dropdown row styling consistent with existing top-bar dropdowns
    - Hover, active, focus states
  - [x] 3.4 Mount `ArchitectureSelector` in `TopBar.tsx`
    - Position next to the project name
    - Render only when `activeProject` is present
  - [x] 3.5 Ensure selector tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify safety property (c) is callable and passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Safety property (c) test passes: selecting a row updates URL and propagates through context
- Closed selector reads as an interactive pill/chip even with one architecture
- Dropdown shows non-archived architectures oldest-first, names only
- Click-outside and Escape close the dropdown

---

### View-State Migration (Breaking Change)

#### Task Group 4: Remove `currentView` State and Migrate All Consumers
**Dependencies:** Task Groups 1, 2, 3

This is the largest mechanical change in the spec. Removing `currentView` from `ArchitectureContext` will break every reader/setter until all are migrated. Sweep the entire frontend for `currentView` and `SET_VIEW` references and migrate to `useLocation`/`useParams` for reads and `useNavigate` for writes.

**Per-memory caution:** Subagent regex-based edits can break when code has nested braces (e.g., `mockResolvedValue({...})`). Manually verify each migrated file.

- [x] 4.0 Migrate every `currentView` consumer to route-driven navigation
  - [x] 4.1 Write 2-8 focused tests for view-state migration
    - Test: top-bar view-toggle buttons (Dashboard / Product & Delivery / Architecture & Design / Diagrams) render as `<Link>` (or `useNavigate` callbacks) and navigate to the route preserving `:projectId` and `:architectureId`
    - Test: active styling on the view-toggle buttons is derived from `useLocation` (current pathname matches)
    - Test (safety property e): browser back/forward (simulated via `MemoryRouter` history) changes the active view AND active architecture without remounting the app shell — assert app shell component instance is stable across history navigation
    - Test: directly navigating to `/projects/p1/architectures/a1/metamodel` renders `<MetaModelView>` (not the previous default)
    - Use `MemoryRouter` with `initialEntries` arrays containing multiple history entries for back/forward simulation
  - [x] 4.2 Sweep the frontend for all `currentView` and `SET_VIEW` references
    - Search for: `state.currentView`, `currentView`, `SET_VIEW`, `setCurrentView`, `dispatch({type: 'SET_VIEW'`
    - Expected hit list (verify by search, not memory): `App.tsx`, `TopBar.tsx`, `DashboardView`, `DiagramsView`, `Grid`, `MetaModelView`, `ProductView`, plus their tests
    - Produce a complete list before editing — do not edit incrementally without first knowing the full set
  - [x] 4.3 Migrate read sites to `useLocation`/`useParams`
    - Anywhere code reads `state.currentView`, derive view from `useLocation().pathname` (parse the trailing view segment) or use a `useCurrentView()` helper hook if many call sites
    - Verify after each file edit that nested braces and complex destructuring weren't broken by mechanical edits
  - [x] 4.4 Migrate write sites to `useNavigate`
    - Anywhere code dispatched `{type: 'SET_VIEW', payload: '<view>'}`, replace with `navigate(\`/projects/\${projectId}/architectures/\${architectureId}/<view>\`)`
    - The top-bar view-toggle buttons become `<Link>`s (preferred) or `useNavigate` callbacks; active styling based on `useLocation`
  - [x] 4.5 Remove `SET_VIEW` action and `currentView` field from `AppState`
    - Only after every call site is migrated and the search returns zero hits
    - Remove the reducer case for `SET_VIEW`
    - Remove the `currentView` initial state field
  - [x] 4.6 Update existing tests that asserted on `state.currentView` or dispatched `SET_VIEW`
    - Mechanical updates: wrap renders in `MemoryRouter` with appropriate `initialEntries`
    - Replace state-based assertions with route-based assertions (e.g., assert on `useLocation().pathname` or rendered view component)
    - Many tests will need this — sweep alongside 4.2's hit list
    - **Pre-existing failures listed in the spec/memory are out of scope** — flag them, do NOT fix
  - [x] 4.7 Ensure view-state migration tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify safety property (e) is callable and passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Safety property (e) test passes: back/forward changes view+architecture without remounting app shell
- `SET_VIEW` action and `currentView` field removed from `AppState`
- Search for `currentView` / `SET_VIEW` returns zero hits in non-test source files
- Top-bar view buttons navigate via `<Link>`/`useNavigate` and reflect active state from `useLocation`
- Existing view-related tests updated to use `MemoryRouter`

---

### Empty-View Detection + Toast on Switch

#### Task Group 5: Per-View `useViewIsEmpty()` Hooks + Empty-View Toast
**Dependencies:** Task Group 4

Each view exposes a small `useViewIsEmpty()`-style hook returning a boolean derived from data already fetched (no extra API calls). Toast trigger fires after the architecture-switch effect settles when the new view is empty.

- [x] 5.0 Wire empty-view detection and the empty-view toast
  - [x] 5.1 Write 2-8 focused tests for empty-view detection + toast
    - Test (safety property d, part 1): switching architectures keeps the user on the same view — `/.../diagrams` stays `/.../diagrams`, only the `:architectureId` segment changes
    - Test (safety property d, part 2): switching to an architecture whose target view is empty fires the empty-view info toast (e.g., "Architecture &lt;name&gt; has no diagrams yet")
    - Test: switching to an architecture whose target view is non-empty does NOT fire the empty-view toast
    - Test: dashboard is always considered non-empty (no toast on switch to dashboard)
    - Test: each `useViewIsEmpty()` hook returns the expected boolean for empty vs non-empty fixtures (metamodel, diagrams, product)
    - Mock the data fetched by each view; do not require real API calls
  - [x] 5.2 Add `useViewIsEmpty()` hook to `MetaModelView`
    - Returns `true` when no entities exist; derived from data already fetched by the view
  - [x] 5.3 Add `useViewIsEmpty()` hook to `DiagramsView`
    - Returns `true` when no persisted diagrams exist
  - [x] 5.4 Add `useViewIsEmpty()` hook to `ProductView`
    - Returns `true` when no product-summary content exists
  - [x] 5.5 Add empty-view toast trigger on architecture switch
    - Effect that observes `useActiveArchitectureId()` changes
    - After the switch settles (data fetch completes), if the destination view's `useViewIsEmpty()` returns `true`, fire an info toast like *"Architecture &lt;name&gt; has no diagrams yet"* (parameterised on view label)
    - Reuse `frontend/src/components/common/Toast.tsx` with `type="info"`
    - Trigger lives in the architecture-switch effect (likely co-located with the selector or in a top-level effect that watches `activeArchitectureId`); see spec section "Stay-on-view-with-empty-toast on architecture switch"
    - Skip the toast for `dashboard` (always non-empty)
  - [x] 5.6 Ensure empty-view detection tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify safety property (d) is callable and passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Safety property (d) test passes: same-view persistence + empty-view toast on switch
- `useViewIsEmpty()` hooks added to MetaModelView, DiagramsView, ProductView
- Toast fires only when destination view is empty
- Dashboard never triggers the empty-view toast

---

### Legacy-URL Redirect Toast

#### Task Group 6: Wire Toast for `<ProjectLayout>` Redirect
**Dependencies:** Task Groups 1, 5 (toast pattern established in 5)

When `<ProjectLayout>` performs the silent redirect from a missing-`:architectureId` URL (built in group 1), fire the "Opened in architecture: &lt;name&gt;" toast.

- [x] 6.0 Fire the redirect toast on legacy-URL navigation
  - [x] 6.1 Write 2-8 focused tests for redirect toast
    - Test (safety property b): URL without `:architectureId` (e.g. `/projects/abc/diagrams`) triggers redirect to canonical URL `/projects/abc/architectures/<oldest-non-archived>/diagrams`
    - Test: after the redirect, an info toast fires with text matching "Opened in architecture: &lt;name&gt;" (parameterised on the resolved architecture's name)
    - Test: legitimate URL with `:architectureId` does NOT fire the redirect toast
    - Test: API client layer does NOT receive a missing/null `architectureId` — the redirect happens at the URL boundary; every Bucket A call still gets a real id (preserves spec #1's "no silent defaults at the API layer" property)
    - Use `MemoryRouter` with the legacy URL as the `initialEntry`; mock `listArchitectures`
  - [x] 6.2 Wire toast trigger inside `<ProjectLayout>` redirect path
    - In the branch where `:architectureId` is missing and `<Navigate replace>` is returned, fire the info toast (`type="info"`) before/after the navigation
    - Toast text: *"Opened in architecture: &lt;name&gt;"* using the resolved architecture's name
    - Reuse `frontend/src/components/common/Toast.tsx`
    - Make sure the toast fires exactly once per redirect (avoid re-firing on every render)
  - [x] 6.3 Ensure redirect toast tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Verify safety property (b) is callable and passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Safety property (b) test passes: missing-architecture URL redirects + fires toast
- Toast fires exactly once per redirect
- Spec #1 invariant preserved: no silent defaults at the API client layer; the redirect is at the URL boundary

---

### Test Review and Gap Analysis

#### Task Group 7: Test Review + Critical Gap-Fill (max 10 added tests)
**Dependencies:** Task Groups 1-6

Confirm the five critical safety properties each have a callable, passing test (one each, expected to come out of groups 2/3/4/5/6). Add up to 10 additional strategic tests only if there are gaps in critical user workflows for THIS spec.

- [x] 7.0 Review tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Approximate counts: 1.1 (2-8), 2.1 (2-8), 3.1 (2-8), 4.1 (2-8), 5.1 (2-8), 6.1 (2-8) → roughly 12-48 tests
    - Map each safety property to its specific test:
      - (a) `useActiveArchitectureId()` reads from URL → group 2 test
      - (b) Missing-architecture URL redirects + toast → group 6 test
      - (c) Selector navigation propagates through context → group 3 test
      - (d) Same-view persistence + empty-view toast on switch → group 5 test
      - (e) Browser back/forward changes architecture without remount → group 4 test
    - If any safety property is NOT covered by a callable test, write the missing test (counts toward the 10-test cap)
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows for spec #2 that lack coverage
    - Focus ONLY on gaps related to this spec's feature (selector + URL routing)
    - Do NOT assess entire frontend test coverage
    - Examples of candidates: end-to-end "open a project → see selector → click a row → URL changes → view re-renders against new architecture"; deep-link round trip via `MemoryRouter`
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Maximum 10 new tests
    - Focus on integration + end-to-end workflows from `frontend/src/__tests__/multiArchitectureSelectorAndRouting.test.tsx`
    - Skip exhaustive coverage of selector micro-states, accessibility audits, performance tests
    - Each new test must justify its presence (covers a gap, not duplicate)
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests written in groups 1-6 plus any added in 7.3
    - Expected total: approximately 22-58 tests
    - Do NOT run the entire frontend test suite
    - Verify all five safety properties pass
    - **Pre-existing failures (from project memory + spec): `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `conversation-memory-edge-cases.test.ts`, `DiagramsViewTemporaryDiagram.test.tsx`. Many other URL-shape or context-related failures may surface — flag them as pre-existing if they appear, do NOT try to fix.**

**Acceptance Criteria:**
- All five critical safety properties (a-e) each have a callable, passing test
- All feature-specific tests pass (approximately 22-58 tests total)
- No more than 10 additional tests added in 7.3 when filling gaps
- Testing focused exclusively on this spec's feature requirements
- Pre-existing failures flagged and not addressed

---

## Execution Order

Recommended implementation sequence (dependency-driven):

1. **Group 1** — Routing skeleton (parallel to existing state-driven view selection)
2. **Group 2** — Context rewire (public hook surface unchanged; safety property (a) lands)
3. **Group 3** — Selector UI (writes via `setActiveArchitecture`; safety property (c) lands)
4. **Group 4** — `currentView` removal + consumer migration (the breaking change; safety property (e) lands)
5. **Group 5** — Empty-view hooks + toast on switch (safety property (d) lands)
6. **Group 6** — Redirect toast wired into `<ProjectLayout>` (safety property (b) lands)
7. **Group 7** — Test review + critical gap-fill

## Critical Safety Properties Map

| ID | Property | Lands In Group | Test Location |
|----|----------|----------------|---------------|
| (a) | `useActiveArchitectureId()` returns id from URL path segment, not API resolution | 2 | Task 2.1 |
| (b) | Missing-`:architectureId` URL redirects to canonical + fires toast | 6 (route in 1) | Task 6.1 |
| (c) | Selector dropdown selection updates URL and propagates active id through context | 3 | Task 3.1 |
| (d) | Switching architectures stays on same view + fires empty-view toast when destination is empty | 5 | Task 5.1 |
| (e) | Browser back/forward changes active architecture without full page reload (no app-shell remount) | 4 | Task 4.1 |

## Notes

- This is a **frontend-only** spec. Backend, gateway (except SPA-fallback verification), and Liquibase are untouched.
- Spec #1's "no silent defaults at the API layer" invariant is preserved — every Bucket A API call still receives a real, resolved `:architectureId` from `useParams`/context. The redirect lives at the URL boundary only.
- `useActiveArchitectureId()` and `useActiveProject()` public signatures stay unchanged so no Bucket A API call sites need to be re-wired.
- Per-memory caution for group 4: subagent regex-based edits can break code with nested braces. Manually verify each migrated file after the sweep.
- Pre-existing test failures are out of scope. Flag them when they surface, do NOT fix.
