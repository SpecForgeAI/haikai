# Specification: Multi-Architecture Selector + URL Routing (Spec #2)

## Goal
Replace spec #1's silent default-to-`Default` resolution with an explicit URL-driven active-architecture selection: introduce real `react-router-dom` usage so `:projectId` and `:architectureId` are URL path segments (the source of truth), and add a top-bar architecture selector that switches the URL. Functionally additive — no spec #1 behaviour breaks; backend, gateway, and Bucket A API contracts are untouched.

## User Stories
- As a user, I want to see which architecture I'm working in (and switch to another) from a persistent control in the top bar so that once spec #3 ships I can move between parallel architectures without losing my place.
- As a user, I want to bookmark or share a deep link to a specific project + architecture + view (e.g. `/projects/abc/architectures/xyz/diagrams`) so that refreshing the browser, hitting back/forward, or pasting the URL in another tab lands me in exactly the same place.
- As a user opening an old bookmark that doesn't include `:architectureId`, I want the app to silently route me into the project's Default architecture and tell me what just happened so that I'm never blocked by a stale URL.

## Specific Requirements

**URL is the source of truth (project + architecture + view)**
- Adopt `react-router-dom` v6 (already in `frontend/package.json`, currently unused) with `<BrowserRouter>` (not `<HashRouter>`).
- Architecture-scoped routes mirror the backend path shape: `/projects/:projectId/architectures/:architectureId/<view>` for `view` in `{metamodel, diagrams, product, dashboard}`.
- Browser back/forward, refresh, and direct paste all converge on the same render path.
- Confirm gateway/Vite static-file serving falls back to `index.html` for unmatched non-API paths (SPA fallback); add the fallback only if missing — no API changes.

**Contexts become derived mirrors of route params**
- `ArchitectureContext.activeArchitectureId` is no longer driven by `useEffect(listArchitectures...)`; it is derived from `useParams().architectureId` and exposed via the unchanged `useActiveArchitectureId()` hook so existing consumers (e.g. `App.tsx`'s auto-load effect, every Bucket A API call site) keep working.
- `ProjectContext.activeProject?.id` is reconciled with `useParams().projectId` — switching the URL segment swaps the active project; `setActiveProject` continues to work for the activate-flow but additionally calls `useNavigate` to put the new project in the URL.
- `ArchitectureContext` additionally exposes `architectures: Architecture[]` (the full list for the active project) and `setActiveArchitecture(id: string)` — the latter calls `useNavigate` to swap only the `:architectureId` segment, keeping `:projectId` and the trailing view unchanged.
- `currentView` reducer state is removed; view selection is driven by the route. `SET_VIEW` action and `state.currentView` reads/writes are migrated to `useNavigate` / `useParams`.

**Architecture selector UI (pill/chip with subtle border in the top bar)**
- New component `frontend/src/components/TopBar/ArchitectureSelector.tsx` mounted next to the project name in `TopBar.tsx`.
- Closed state is a pill/chip with subtle border so it reads as an interactive control even when only the `Default` architecture exists (the spec-#1 reality for every project today).
- Click opens a dropdown listing all non-archived architectures for the active project, ordered oldest-first (matches spec #1's Default-resolution rule).
- Both the closed control and dropdown rows show **just the name** — no tags rendered in this spec (tags exist in the schema but have no management UI until spec #3; revisit then).
- Selecting a row calls `setActiveArchitecture(id)` which navigates to the equivalent URL with the new `:architectureId` segment; the URL change re-renders the current view against the new architecture's data.
- Reuse positioning, click-outside-to-close, and keyboard-escape behaviour from `frontend/src/components/TopBar/FileMenu.tsx`.

**Stay-on-view-with-empty-toast on architecture switch**
- Switching architectures keeps the user on the same view (`/.../diagrams` stays `/.../diagrams`); only the `:architectureId` segment changes.
- Each view exposes a small `useViewIsEmpty()`-style hook returning a boolean derived from data already fetched by that view (no extra API calls): metamodel checks for any entities; diagrams checks for any persisted diagrams; product checks for product-summary content; dashboard is always non-empty.
- After the architecture-switch effect settles, if the destination view is empty, fire an info toast like *"Architecture &lt;name&gt; has no diagrams yet"* (parameterised on the view label).

**Silent redirect + toast for legacy URLs missing `:architectureId`**
- A route-level `<ProjectLayout>` wraps every `/projects/:projectId/...` route. If the matched URL has no `:architectureId` segment, the layout calls `listArchitectures(projectId)` (existing API), picks the oldest non-archived (same rule as spec #1's `ArchitectureContext` resolver), and `<Navigate replace to={canonical}>` to the canonical URL with the resolved id inserted.
- After the redirect, fire an info toast: *"Opened in architecture: &lt;name&gt;"* so the user knows why the URL changed.
- This redirect-and-toast lives at the **URL boundary only** — it does not introduce a silent default at the API client layer. Every Bucket A API call still receives a real, resolved `:architectureId` read from `useParams` / context. Spec #1's "no silent defaults at the API layer" property is preserved.

**Toast component reuse**
- Reuse `frontend/src/components/common/Toast.tsx` (`type="info"`) for both the legacy-URL redirect message and the empty-view-on-switch hint. No new toast infrastructure built in this spec.
- Toast triggers live in the `<ProjectLayout>` (redirect case) and in the architecture-switch effect of the selector (empty-view case).

**Migrate every existing `currentView` consumer**
- Sweep components that read `state.currentView` or dispatch `{type: 'SET_VIEW'}` (currently: `App.tsx`, `TopBar.tsx`, plus references in DashboardView/DiagramsView/Grid/MetaModelView/ProductView and their tests) and migrate them to `useLocation` / `useParams` for reads and `useNavigate` for writes.
- The top-bar view-toggle buttons (`Dashboard / Product & Delivery / Architecture & Design / Diagrams`) become `<Link>`s (or `useNavigate` callbacks) preserving the active styling based on `useLocation`.
- Remove `SET_VIEW` action and `currentView` field from `AppState` once all call sites are migrated.

**Functionally additive — preserve spec #1 behaviour**
- Bucket A API endpoints, gateway proxies, backend controllers, Liquibase changesets — all unchanged.
- `useActiveArchitectureId()` hook signature is unchanged; only its implementation switches from useState/useEffect to `useParams`.
- The auto-load effect in `App.tsx` (`loadModelByProjectId(projectId, architectureId)`) keeps working unchanged — its `activeArchitectureId` dependency now comes from the URL instead of an effect.
- The activate-on-open flow in `TopBar.handleOpenFromBackend` (which today resolves `architectures` inline because context hasn't caught up yet) is updated to navigate to the canonical URL after activation; the `<ProjectLayout>` redirect handles the architecture id and the inline `listArchitectures` call there can be removed.

**Test strategy**
- New `frontend/src/__tests__/multiArchitectureSelectorAndRouting.test.tsx` using `MemoryRouter`:
  - Selector renders the active architecture's name in its closed state.
  - Clicking a dropdown row navigates to the new URL (`:architectureId` segment swapped, view preserved).
  - URL without `:architectureId` (e.g. `/projects/abc/diagrams`) redirects to `/projects/abc/architectures/<oldest-non-archived>/diagrams` and fires the info toast.
  - Switching to an architecture whose target view is empty fires the empty-view info toast.
  - Browser back/forward (simulated via `MemoryRouter` history) changes the active architecture without remounting the app shell.
- Mechanical updates to existing tests that asserted on `state.currentView` or dispatched `SET_VIEW` — wrap renders in `MemoryRouter` with the appropriate initial entries.
- Pre-existing test failures listed in project memory (bootstrap-summary-fetching, conversation-memory-edge-cases, dashboardSummary, hub-bootstrap-4-task-definition, chatV2-panel) are not addressed by this spec.

## Existing Code to Leverage

**`useActiveArchitectureId()` + `ArchitectureContext` (spec #1)**
- Hook signature stays exactly as today; consumers across all Bucket A API call sites need no change.
- Replace the `useState` + `useEffect(listArchitectures...)` resolver block in `ArchitectureProvider` with a `useParams` read; keep the `architectures: Architecture[]` list (now exposed publicly) populated by a single `listArchitectures(projectId)` call when the project changes (still needed for the selector dropdown).

**`frontend/src/api/architecturesApi.ts` (spec #1)**
- `listArchitectures(projectId)` is reused as-is by both the selector dropdown population and the `<ProjectLayout>` redirect resolver. No API changes needed.

**`frontend/src/components/TopBar/FileMenu.tsx`**
- Portal-rendered dropdown pattern: positioning calculation, click-outside-to-close listener, keyboard escape, `useEffect` cleanup. `ArchitectureSelector` reuses these patterns for visual consistency with the existing top-bar control.

**`frontend/src/components/common/Toast.tsx`**
- Existing `Toast` component supports `info` type, auto-dismiss, manual dismiss. Reused for both the legacy-URL-redirect toast and the empty-view-on-switch toast — no new component built.

**`react-router-dom` v6 (already in `frontend/package.json`)**
- Dependency already declared at `^6.22.0`; no version bump in this spec. Uses standard `<BrowserRouter>`, `<Routes>`, `<Route>`, `<Navigate>`, `useParams`, `useNavigate`, `useLocation`, `<Link>`, `<Outlet>`.

## Out of Scope
- Architecture CRUD UI (create / rename / archive) — deferred to spec #3.
- Tag-management modal and rendering tags inside the selector — deferred to spec #3 (revisit then).
- Discovery Service `architectureId` integration (Discovery's own endpoints + UI selector at run start) — deferred to spec #4.
- LLM persona/task save-target resolution (`clarify-at-save` vs `bound-by-system-prompt`) — deferred to spec #5.
- Full clone of one architecture into another — deferred to spec #6.
- Selective cross-architecture copy — deferred to spec #7.
- Comparison / diffing UI and unarchive UI — deferred indefinitely.
- Per-architecture access control — not in V1.
- Backend, gateway, and Liquibase changes — none in this spec.
- `react-router-dom` version upgrade beyond what's already in `package.json`.
