# Task Breakdown: Comprehensive Frontend Routing

## Overview
Total Tasks: 9 task groups, ~70 sub-tasks

This is a **frontend-only** spec. No backend, gateway, or Liquibase changes. The dependency order is critical:

- **Group 1** (foundational bug fix) restores basic app usability — without it the app opens with an empty TopBar shell, nav buttons silent-fail, and the project name shows "Untitled". After Group 1 lands the existing four top-level views are usable again.
- **Group 2** (AppShell `<Outlet/>` rework + 404 catch-all) unlocks nested sub-routes for Groups 4-7 to mount into.
- **Group 3** (`renderWithFullApp` test helper) builds the test infrastructure that Groups 4-9 depend on.
- **Groups 4-7** (Metamodel / Diagrams / Product / Discovery sub-routes) are additive and can in principle run in parallel after Group 3, but are listed sequentially here for predictable dependency ordering and easier review.
- **Group 8** (Dashboard cleanup) removes the now-superseded in-dashboard discovery toggle replaced by Group 7.
- **Group 9** (end-to-end sweep) is the final cross-tier verification.

References:
- Spec: `agent-os/specs/2026-05-04-comprehensive-frontend-routing/spec.md`
- Requirements: `agent-os/specs/2026-05-04-comprehensive-frontend-routing/planning/requirements.md`
- Predecessor (partial routing this spec completes/fixes): `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/spec.md`
- Multi-spec design context: `agent-os/design-notes/multi-architecture-variants.md`

## Task List

### Foundational Bug Fixes

#### Task Group 1: URL-Derived `activeArchitectureId` + `RootRoute` Auto-Navigate
**Dependencies:** None

**CRITICAL — restores basic navigation.** Replace `useParams()` in `ArchitectureProvider` with `parseArchitectureIdFromPathname(useLocation().pathname)` so the provider reads the URL even when mounted outside the route tree. Audit every other `useParams` call site in `frontend/src/**` to confirm they remain inside `<Route>` elements. Delete the empty-shell else branch in `RootRoute` so a hydrated active project auto-navigates to its dashboard.

End-state after this group: TopBar nav buttons work, project name shows correctly, app opens to dashboard when active project hydrates. **App becomes usable for the existing 4 top-level views.**

- [x] 1.0 Fix the foundational bugs and restore basic navigation
  - [x] 1.1 Write 2-8 focused tests for the foundational fix
    - Test (safety property a): `useActiveArchitectureId()` returns the URL-segment value when the URL has `:architectureId`, regardless of where the consumer is mounted relative to the route tree. Cold-render `<App>` at `/projects/p1/architectures/a1/dashboard` and assert hook returns `'a1'` on the very first render (no `useEffect` wait)
    - Test (safety property h, regression for the bug class): a context that uses `useLocation()`-based parsing returns the URL-derived value when mounted outside the route tree (`<MemoryRouter><ArchitectureProvider>{...}</ArchitectureProvider></MemoryRouter>` with no `<Routes>` between them)
    - Test (safety property b): `RootRoute` auto-navigates to `/projects/:projectId` when `activeProject` exists on mount — no empty TopBar shell rendered
    - Test (safety property c, partial — landing requires Group 1 only): every TopBar nav button click on a hydrated app at `/projects/:p/architectures/:a/dashboard` results in `window.location.pathname` (or `MemoryRouter` history) changing
    - Test: pure helper `parseArchitectureIdFromPathname('/projects/p1/architectures/a1/dashboard')` returns `'a1'`; returns `null` for paths without the segment
    - Mock `getActiveProject` / `listArchitectures` as needed; reuse existing patterns from `multiArchitectureSelectorAndRouting.test.tsx`
  - [x] 1.2 Add `parseArchitectureIdFromPathname` pure helper
    - Co-locate with the existing `parseViewFromPathname` in `frontend/src/hooks/useCurrentView.ts` (or rename file to `urlParsers.ts` if the parser count justifies it — defer the rename to Group 4 where more parsers land)
    - Mirror the matching pattern of `parseViewFromPathname`: matches `/projects/:projectId/architectures/:architectureId/...` and returns the `:architectureId` segment or `null`
    - Pure function on `pathname: string`; no React hook usage
  - [x] 1.3 Replace `useParams()` with URL-derived parsing in `ArchitectureProvider`
    - Edit `frontend/src/contexts/ArchitectureContext.tsx` lines ~2598-2604
    - Replace `const params = useParams(); const activeArchitectureId = params.architectureId ?? null;` with `const location = useLocation(); const activeArchitectureId = parseArchitectureIdFromPathname(location.pathname);`
    - `useLocation` is already imported and used elsewhere in the provider (for `setActiveArchitecture`); no provider re-ordering required — the provider already sits inside `<BrowserRouter>` in `App.tsx`
    - **Per-memory caution:** verify nested-brace destructuring after the edit; subagent regex edits can break complex contexts
  - [x] 1.4 Audit every other `useParams()` call site in `frontend/src/**`
    - Grep `useParams` across `frontend/src/**` (excluding test files for the audit; tests use their own routers)
    - Expected hit list per requirements: `Layout/ProjectLayout.tsx`, `hooks/useNavigateToView.ts`, plus tests
    - For each non-test hit, confirm the call site is mounted inside a `<Route>` element (i.e., reached via `element={<Component/>}` in the routes tree)
    - Document the audit result inline as a comment in the implementing PR (or leave a brief note in the task subagent's final summary). Any hit that is NOT inside a `<Route>` element must be migrated to `useLocation()` + a co-located parser using the same pattern as 1.3
  - [x] 1.5 Fix `RootRoute` auto-navigate to active project on mount
    - Edit `frontend/src/App.tsx` `RootRoute` (lines ~234-279 / ~268-278)
    - Delete the file-mode/empty-shell else branch entirely
    - Three terminal states only: (a) DB mode + no active project → `<LandingPage/>`; (b) loading → spinner; (c) hydrated active project → `<Navigate to={\`/projects/${activeProject.id}\`} replace />` (which `<ProjectLayout>` then chains to canonical `/dashboard`)
    - Never renders a `TopBar` with an empty `<main>` — that combination is the regression bug being fixed
  - [x] 1.6 Ensure foundational fix tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify safety properties (a), (b), (c-partial), and (h) are callable and passing
    - Do NOT run the entire test suite at this stage
    - Manually smoke test the dev server: cold-load app at `/`, confirm it auto-navigates to the active project's dashboard, confirm TopBar nav buttons all change the URL when clicked

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Safety properties (a), (b), and (h) each have a callable, passing test
- `parseArchitectureIdFromPathname` exists as a pure exported helper
- `ArchitectureProvider` reads `activeArchitectureId` from `useLocation().pathname` via the new parser
- `useParams()` audit complete — every remaining call site confirmed to be inside a `<Route>` element
- `RootRoute` auto-navigates hydrated active project to `/projects/:projectId`; no empty TopBar shell
- Manual smoke test: TopBar nav buttons work, project name renders, app opens to dashboard

---

### AppShell + 404 Foundations

#### Task Group 2: AppShell `<Outlet/>` Rework + 404 Catch-All
**Dependencies:** Task Group 1

Replace `AppShell`'s single `view` prop with `<Outlet/>` so nested routes mount inside the shell. Convert each top-level view's route to nested-children form (the children themselves are added in Groups 4-7; this group lays the parent-route plumbing). Add a minimal `NotFoundPage` and a `<Route path="*">` catch-all at the end of the routes tree.

- [x] 2.0 Rework AppShell to mount nested routes via `<Outlet/>` and add 404
  - [x] 2.1 Write 2-8 focused tests for AppShell + 404
    - Test: `<AppShell>` renders `<TopBar/>` + `<main className="main-content">` wrapping `<Outlet/>`
    - Test: navigating to `/projects/:p/architectures/:a/dashboard` mounts `<DashboardView>` inside the AppShell `<main>`
    - Test: navigating to each of `/dashboard`, `/metamodel`, `/diagrams`, `/product` (architecture-scoped) renders the corresponding top-level view inside the AppShell
    - Test (safety property g): hitting `/some-bogus-path` renders the 404 page with a `<Link to="/">` back to landing
    - Test: existing `useEmptyArchitectureToast`, auto-load-model effect, `useCreateOrganisationShortcut`, and Create Organisation modal mount points still mount inside `AppShell` (not regressed by the `view` → `<Outlet/>` swap)
    - Test: `useCurrentView()` continues to return the top-level view name (used for TopBar active styling and the `includeDelivery` redirect-when-product-gated effect)
    - Use direct `<MemoryRouter>` + `<App>` (the full helper lands in Group 3; this group can use a minimal inline router)
  - [x] 2.2 Replace `view` prop with `<Outlet/>` in `AppShell`
    - Edit `frontend/src/App.tsx` `AppShell` (lines ~137-213)
    - Outer JSX (TopBar wrapping `<main className="main-content">`) stays identical
    - Only the body content is swapped: replace `{view}` (or whatever `view`-prop renders) with `<Outlet/>`
    - Remove the `view` prop from the function signature
    - Existing `useEmptyArchitectureToast`, auto-load-model effect, `useCreateOrganisationShortcut`, Create Organisation modal — all stay in place; none depend on the `view` prop
    - The `includeDelivery` redirect-when-product-gated effect remains
  - [x] 2.3 Convert each top-level view route to nested-children form
    - Edit `frontend/src/App.tsx` `AppRoutes` (lines ~293-336)
    - Replace the four flat architecture-scoped routes (`/.../metamodel`, `/.../diagrams`, `/.../product`, `/.../dashboard`) with a single parent route that renders `<AppShell/>` and has the four views as `children`
    - Each child route element is the existing top-level view component for now (`<MetaModelView/>`, `<DiagramsView/>`, `<ProductView/>`, `<DashboardView/>`); sub-routes for each land in Groups 4-7
    - Preserve the existing `<ProjectLayout>` wrapping and missing-`:architectureId` redirect behaviour verbatim
    - Extend `KNOWN_VIEW_SEGMENTS` in `ProjectLayout.tsx` to include `discovery` (locked URL list addition; keeps legacy `/projects/abc/discovery` redirects working when Group 7 lands)
  - [x] 2.4 Create `NotFoundPage` component
    - New file `frontend/src/components/Layout/NotFoundPage.tsx`
    - Minimal: title ("Page not found"), one paragraph, single `<Link to="/">Back to home</Link>`
    - No marketing copy
    - Optional: minimal CSS module if styling is needed; otherwise inline minimal styles
  - [x] 2.5 Add `<Route path="*">` catch-all at the end of the routes tree
    - Mount `<Route path="*" element={<NotFoundPage/>} />` outside the project-scoped tree
    - Order in `<Routes>`: project routes first (most specific), then `/`, then `*` (catch-all last)
  - [x] 2.6 Ensure AppShell + 404 tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify safety property (g) is callable and passing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Safety property (g) test passes: bogus URL renders 404 with link back to `/`
- `AppShell` uses `<Outlet/>` instead of a `view` prop
- All four existing top-level views render correctly via nested routes
- `NotFoundPage` exists and is reachable via `*` catch-all
- `useCurrentView()` and all existing AppShell-mounted effects continue to function

---

### Test Infrastructure

#### Task Group 3: `renderWithFullApp` Helper + Provider-Outside-Routes Regression Test
**Dependencies:** Task Group 2

Build the test infrastructure that Groups 4-9 routing tests depend on. The helper mounts the full `<App>` with `MemoryRouter` initial entries (rather than isolated `<MemoryRouter>` + child renders). This catches the entire class of bug fixed by Group 1 — namely, providers reading `useParams` outside the route tree. Also write the explicit regression test for the bug class.

- [x] 3.0 Build `renderWithFullApp` helper and the regression test
  - [x] 3.1 Write 2-8 focused tests exercising the helper itself
    - Test: `renderWithFullApp('/')` mounts the landing page (DB mode + no active project fixture) without crashing
    - Test: `renderWithFullApp('/projects/p1/architectures/a1/dashboard')` mounts `<DashboardView/>` inside `<AppShell/>` with project + architecture id available via `useActiveProject` and `useActiveArchitectureId`
    - Test (safety property h, explicit regression): a contrived consumer using `useLocation()`-based parsing that is mounted outside `<Routes>` returns the URL-derived value at the architecture-scoped initial entry
    - Test: helper supports passing fixture mocks for `getActiveProject` / `listArchitectures` etc. (or documents the expected vi.mock pattern callers should use)
    - Test: helper does NOT mount a second `<BrowserRouter>` (would trigger React Router warnings)
  - [x] 3.2 Extract `<AppContent>` wrapper from `App.tsx`
    - Move `App.tsx`'s inner provider tree + `<AppRoutes/>` into a new exported `<AppContent>` component
    - `<App>` now mounts `<BrowserRouter><AppContent/></BrowserRouter>`
    - Standard React Router v6 pattern that lets the test helper inject `MemoryRouter` instead
    - **Per-memory caution:** verify nested-brace destructuring of provider props after the move; subagent regex edits can break this
  - [x] 3.3 Create `frontend/src/__tests__/routing/testUtils.tsx`
    - Export `renderWithFullApp(initialUrl: string, options?: { mocks?: ... })`
    - Implementation: `render(<MemoryRouter initialEntries={[initialUrl]}><AppContent/></MemoryRouter>)` (plus any standard test wrappers — e.g. ToastProvider may already be inside AppContent; verify)
    - Document the helper's expected mock requirements at the top of the file: `architectureModelClient`, `architecturesApi`, `getActiveProject`, `listArchitectures`, `UnifiedChatPanel`-required contexts (`ArchitectureContext`, `PendingActionContext`, `ModalActionContext`), per project memory
    - Include a small `setupDefaultMocks()` helper that callers can use to wire the standard mock surface, or document the pattern inline
  - [x] 3.4 Create `frontend/src/__tests__/routing/architectureProviderUrlDerivation.test.tsx`
    - Direct test of the bug class fixed by Group 1
    - Cold-mount the full `<App>` via the helper at `/projects/p1/architectures/a1/dashboard`
    - Assert `useActiveArchitectureId()` returns `'a1'` on the very first render via a probe component (e.g., a tiny `<ArchitectureIdProbe>` mounted inside the provider that captures the hook value into a ref)
    - This is the canonical regression test cited in safety property (h)
  - [x] 3.5 Create the `frontend/src/__tests__/routing/` folder structure
    - Empty placeholder files for the test files that Groups 4-9 will populate (`coldStart.test.tsx`, `subRoutes.test.tsx`, `topBarNav.test.tsx`, `backForward.test.tsx`, `notFound.test.tsx`) — or simply document the planned filenames in a README/comment at the top of `testUtils.tsx`
    - Folder must exist so subsequent groups can drop files in without conflict
  - [x] 3.6 Ensure helper tests pass
    - Run ONLY the 2-8 tests written in 3.1 plus the regression test in 3.4
    - Verify safety property (h) test passes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 helper tests pass
- The Group 1 regression test (`architectureProviderUrlDerivation.test.tsx`) is callable from the helper and passes
- `<AppContent>` is extracted and `<App>` mounts it inside `<BrowserRouter>`
- `renderWithFullApp` mounts the full app with a `MemoryRouter` initial entry, no double-router warnings
- Folder `frontend/src/__tests__/routing/` exists and is ready for Groups 4-9 test files
- Mock requirements (per project memory) documented at the top of `testUtils.tsx`

---

### Sub-Routes Migration

#### Task Group 4: Metamodel Sub-Routes (`metamodel/:domain?`)
**Dependencies:** Task Groups 2, 3

Migrate metamodel domain selection from reducer state (`SET_DOMAIN` dispatch) to URL path param. `MetaModelView` becomes a tiny layout: it keeps its existing `DomainSelector` chrome and renders `<Outlet/>` for the active-domain body. Default redirect from `/metamodel` to `/metamodel/applications`. Six valid domain values: `applications` / `data` / `business` / `infrastructure` / `ui` / `package-sets`.

- [x] 4.0 Migrate metamodel domain to URL
  - [x] 4.1 Write 2-8 focused tests for metamodel sub-routes (use `renderWithFullApp`)
    - Test (safety property d): refreshing on `/projects/:p/architectures/:a/metamodel/data` renders the `data` domain selected
    - Test: bare `/.../metamodel` redirects to `/.../metamodel/applications` (the default domain)
    - Test: clicking a `DomainSelector` row navigates via `useNavigate` to `/.../metamodel/<domain>` (no `dispatch SET_DOMAIN`)
    - Test (safety property e, partial): browser back/forward across `applications` → `data` → `applications` changes the active domain without remounting `MetaModelView`'s chrome
    - Test: invalid domain segment (e.g. `/.../metamodel/bogus`) — decision: treat as `applications` redirect or 404; spec implies 404 catch-all only fires for entirely unmatched paths, so a bogus domain inside a known view should redirect to default. Match the implementer's choice; document inline
    - Test: `useMetaModelDomain()` hook returns the URL segment value (or `applications` default)
  - [x] 4.2 Add `parseDomainFromPathname` parser + `useMetaModelDomain` hook
    - Co-locate in `frontend/src/hooks/useCurrentView.ts` (or rename to `urlParsers.ts` per the deferred decision in Group 1.2 — Group 4 is a good moment to rename if the parser count justifies it)
    - Pure parser; matches `/projects/:p/architectures/:a/metamodel/:domain` and returns the `:domain` segment or `null`
    - `useMetaModelDomain()` returns the parsed value with `applications` as default fallback
  - [x] 4.3 Add `metamodel/:domain?` nested route shape
    - Edit the routes tree in `App.tsx` (built in Group 2)
    - Add child routes under the metamodel parent: `<Route path="metamodel" element={<MetaModelView/>}>` with nested `<Route index element={<Navigate to="applications" replace/>}/>` and `<Route path=":domain" element={<MetaModelDomainBody/>}/>`
    - `MetaModelDomainBody` is the existing per-domain rendering extracted into a small standalone component, OR `MetaModelView` itself can read the param and render conditionally with `<Outlet/>` — the spec's "co-locate, no new XLayout files" decision favours the latter
  - [x] 4.4 Migrate `MetaModelView` to read domain from URL
    - `MetaModelView` becomes a tiny layout: keeps `DomainSelector` chrome, renders `<Outlet/>` (or reads `useMetaModelDomain()` and renders the active-domain body inline)
    - Replace `dispatch({ type: 'SET_DOMAIN' })` in `MetaModelView/DomainSelector.tsx` (lines ~27-28) with `useNavigate('/.../metamodel/:domain')`
    - Reducer field `selectedDomain` stays for the grid consumers; an effect synchronises URL → reducer at mount and on URL change (mirrors the predecessor pattern for `selectedDiagramId`)
    - Active-domain styling on `DomainSelector` rows is read from `useMetaModelDomain()` instead of `state.selectedDomain`
    - **Per-memory caution:** verify nested-brace destructuring in `MetaModelView` after the edit; this is one of the larger views
  - [x] 4.5 Ensure metamodel sub-route tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify safety property (d, partial) and (e, partial) for metamodel
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `parseDomainFromPathname` and `useMetaModelDomain` exist and are tested
- `metamodel/:domain?` route shape works; bare `/metamodel` redirects to `/metamodel/applications`
- `MetaModelView` reads domain from URL; `DomainSelector` writes via `useNavigate`
- Reducer `selectedDomain` field still populated via URL → reducer sync effect (grid consumers untouched)
- All six valid domain values render correctly when deep-linked

---

#### Task Group 5: Diagrams Sub-Routes (`diagrams/:diagramId?`)
**Dependencies:** Task Groups 2, 3

Migrate selected-diagram from reducer state (`SELECT_DIAGRAM` dispatch) to URL path param. `DiagramsView` becomes a tiny layout: it keeps its existing toolbar/list chrome and renders `<Outlet/>` (or canvas inline) for the active-diagram body. Bare `/diagrams` shows the diagram list (no canvas selection).

- [x] 5.0 Migrate diagram selection to URL
  - [x] 5.1 Write 2-8 focused tests for diagrams sub-routes (use `renderWithFullApp`)
    - Test (safety property d): refreshing on `/projects/:p/architectures/:a/diagrams/<id>` renders the canvas with the specified diagram selected
    - Test: bare `/.../diagrams` shows the diagram list (no canvas selection)
    - Test: selecting a diagram in the UI navigates via `useNavigate` to `/.../diagrams/<id>` (no `dispatch SELECT_DIAGRAM` — or dispatch happens via URL → reducer sync effect)
    - Test (safety property e, partial): back/forward across diagram selections changes the active diagram without remounting `DiagramsView`'s chrome
    - Test: `useSelectedDiagramId()` hook returns the URL segment value (or `null` for the bare list URL)
    - Test: deep-linking to a diagramId that no longer exists — decision: render the list with a toast or fall through to bare-list. Match the implementer's choice; document inline
  - [x] 5.2 Add `parseDiagramIdFromPathname` parser + `useSelectedDiagramId` hook
    - Co-locate per Group 4 pattern
    - Pure parser; matches `/projects/:p/architectures/:a/diagrams/:diagramId`
  - [x] 5.3 Add `diagrams/:diagramId?` nested route shape
    - Edit the routes tree
    - `<Route path="diagrams" element={<DiagramsView/>}>` with nested `<Route index .../>` (bare list) and `<Route path=":diagramId" .../>` (selected diagram on canvas)
  - [x] 5.4 Migrate `DiagramsView` to read selected diagram from URL
    - Edit `DiagramsView.tsx` line ~1717 etc.: replace `dispatch({ type: 'SELECT_DIAGRAM', payload: diagramId })` with `useNavigate('/.../diagrams/:diagramId')`
    - Reducer `selectedDiagramId` stays for Canvas / palette / inspector consumers; an effect synchronises URL → reducer at mount and on URL change
    - Bare `/diagrams` URL: reducer `selectedDiagramId` is `null`; canvas not rendered
    - **Per-memory caution:** `DiagramsView.tsx` is huge — verify nested-brace destructuring after each edit
  - [x] 5.5 Ensure diagrams sub-route tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify safety property (d, partial) and (e, partial) for diagrams
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- `parseDiagramIdFromPathname` and `useSelectedDiagramId` exist and are tested
- `diagrams/:diagramId?` route shape works; bare `/diagrams` shows the list
- Selecting a diagram navigates to `/.../diagrams/:diagramId`
- Reducer `selectedDiagramId` still populated via URL → reducer sync effect (Canvas / palette / inspector untouched)

---

#### Task Group 6: Product Sub-Routes (`product/{mission,roadmap,backlog,backlog/:workItemId,implement/:workItemId}`)
**Dependencies:** Task Groups 2, 3

Migrate `ProductView`'s tab state from `URLSearchParams` + `window.history.pushState` to react-router child routes. Sub-routes for `mission`, `roadmap`, `backlog`, `backlog/:workItemId`, `implement/:workItemId`. Default redirect from `/product` to `/product/backlog`.

- [x] 6.0 Migrate product tabs and work-item selection to URL
  - [x] 6.1 Write 2-8 focused tests for product sub-routes (use `renderWithFullApp`)
    - Test (safety property d): refreshing on each of `/.../product/mission`, `/.../product/roadmap`, `/.../product/backlog` renders the correct tab body
    - Test (safety property d): refreshing on `/.../product/backlog/<workItemId>` renders the backlog with the work-item details panel pre-opened
    - Test (safety property d): refreshing on `/.../product/implement/<workItemId>` renders the Implementation Assistant for the specified work item
    - Test: bare `/.../product` redirects to `/.../product/backlog` (default tab)
    - Test: clicking the tab bar buttons navigates via `useNavigate` (no `URLSearchParams` / `pushState` manipulation)
    - Test: `expandEpicId` query param survives the URL change (`/.../product/backlog?expandEpicId=<id>` preserved as in-component scroll/expand hint)
    - Test: `useProductTab()` and `useWorkItemId()` hooks return the parsed URL values
  - [x] 6.2 Add `parseProductTabFromPathname` + `parseWorkItemIdFromPathname` parsers + corresponding hooks
    - Co-locate per Group 4 pattern
    - `parseProductTabFromPathname`: matches `/.../product/(mission|roadmap|backlog|implement)/...`
    - `parseWorkItemIdFromPathname`: matches `/.../product/(backlog|implement)/:workItemId`
  - [x] 6.3 Add product nested route shape
    - `<Route path="product" element={<ProductView/>}>` with nested children:
      - `<Route index element={<Navigate to="backlog" replace/>}/>`
      - `<Route path="mission" element={<ProductMissionPage/>}/>`
      - `<Route path="roadmap" element={<ProductRoadmapPage/>}/>`
      - `<Route path="backlog" element={<ProductBacklogPage/>}/>`
      - `<Route path="backlog/:workItemId" element={<ProductBacklogPage/>}/>` (same component; workItemId opens details panel)
      - `<Route path="implement/:workItemId" element={<ProductImplementPage/>}/>`
    - The body components (`ProductBacklogPage`, `ProductImplementPage`, `ProductRoadmapPage`, `ProductMissionPage`) are the existing tab bodies extracted as standalone components if not already
  - [x] 6.4 Migrate `ProductView` to URL-driven tab state
    - Drop `parseTabFromUrl` / `getWorkItemIdFromUrl` / `updateUrl` helpers in `ProductView.tsx` lines 82-116
    - Drop `URLSearchParams` + `window.history.pushState` usage
    - Tab bar reads active tab from `useProductTab()` for styling
    - Tab bar clicks call `useNavigate` to the corresponding `/product/<tab>` URL
    - Render `<Outlet/>` in place of the conditional `{activeTab === '<X>' && <X .../>}` blocks
    - **Per-memory caution:** ProductView is large with nested state — verify nested-brace destructuring after edits
  - [x] 6.5 Update external callers that produced `?tab=...` URLs
    - `DashboardView.handleArtifactSaved` (lines 308-310) currently produces `?tab=backlog&expandEpicId=<id>` URLs — update to produce `/.../product/backlog?expandEpicId=<id>`
    - The `expandEpicId` query stays as an in-component scroll/expand hint (locked NOT-routable per requirements)
    - Audit for any other `?tab=` producers in the frontend; migrate similarly
  - [x] 6.6 Ensure product sub-route tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Verify safety property (d, partial) for product
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- `parseProductTabFromPathname` / `parseWorkItemIdFromPathname` / `useProductTab` / `useWorkItemId` exist and are tested
- All five product sub-routes (`mission`, `roadmap`, `backlog`, `backlog/:workItemId`, `implement/:workItemId`) deep-link correctly
- Bare `/product` redirects to `/product/backlog`
- `URLSearchParams` + `pushState` removed from `ProductView`
- `expandEpicId` query param preserved on `/product/backlog?expandEpicId=...`
- External callers producing `?tab=...` URLs updated

---

#### Task Group 7: Discovery Promotion (`/discovery` list + `/discovery/runs/:runId`)
**Dependencies:** Task Groups 2, 3

Promote `DiscoveryRunDetailView` from in-dashboard state toggle to its own routes at `/discovery` (list) and `/discovery/runs/:runId` (detail). New stripped-down list view at `/discovery` mirroring the runs-list rendering currently inside `DiscoveryRunDetailView`'s left column.

- [x] 7.0 Promote discovery to first-class routes
  - [x] 7.1 Write 2-8 focused tests for discovery routes (use `renderWithFullApp`)
    - Test (safety property f): deep-linking to `/projects/:p/architectures/:a/discovery/runs/<runId>` from cold start lands on the run detail screen
    - Test: refreshing on `/.../discovery` renders the runs-list page (most recent first; no filters/sort UI/candidate-table preview in V1)
    - Test: clicking a row in the discovery list navigates to `/.../discovery/runs/<runId>`
    - Test: TopBar nav button for Discovery (if one exists; otherwise this test is via direct navigation) takes the user to `/.../discovery`
    - Test: dashboard discovery card now navigates to `/.../discovery` (or to a specific run) instead of toggling internal state — this verifies the Group 8 cleanup is wired
    - Test: `useDiscoveryRunId()` hook returns the URL segment value
  - [x] 7.2 Add `parseDiscoveryRunIdFromPathname` parser + `useDiscoveryRunId` hook
    - Co-locate per Group 4 pattern
  - [x] 7.3 Add discovery nested route shape
    - `<Route path="discovery">` with children:
      - `<Route index element={<DiscoveryListPage/>}/>` (new V1 list)
      - `<Route path="runs/:runId" element={<DiscoveryRunDetailView/>}/>` (existing component, parameterised on URL)
  - [x] 7.4 Extract runs-list subcomponent from `DiscoveryRunDetailView`
    - The runs-list rendering currently inside `DiscoveryRunDetailView`'s left column becomes a small standalone subcomponent (e.g., `DiscoveryRunsList`)
    - Reused by both the new `<DiscoveryListPage/>` and (optionally) the existing `DiscoveryRunDetailView` left column
  - [x] 7.5 Create `<DiscoveryListPage/>`
    - One-column list of historical discovery runs for the active project + architecture, most recent first
    - Each row shows run id / start time / status / tier badge (mirrors what `DiscoveryRunDetailView`'s left column already renders)
    - Click a row → `useNavigate` to `/.../discovery/runs/:runId`
    - **No filters, no sort UI, no candidate-table preview in V1** — defer per spec
  - [x] 7.6 Parameterise `DiscoveryRunDetailView` on `:runId` from URL
    - Replace internal `selectedRunId` state with `useDiscoveryRunId()` reading from URL
    - The detail view continues to render its existing right-column detail panel
    - The left-column runs list (now extracted in 7.4) optionally remains for in-detail navigation, with each row navigating via URL
  - [x] 7.7 Update Grid context-menu "Start Discovery Run"
    - Currently sets `sessionStorage.pendingDiscoveryDetail` and dispatches view change
    - Replace with direct `useNavigate('/.../discovery/runs/:newRunId')` call once the run has been created
    - Drop the sessionStorage handoff entirely (Group 8 will remove the dashboard-side consumer)
  - [x] 7.8 Ensure discovery route tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Verify safety property (f) test passes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Safety property (f) test passes: deep-link to `/discovery/runs/:runId` from cold start lands on detail
- `parseDiscoveryRunIdFromPathname` and `useDiscoveryRunId` exist and are tested
- `/discovery` and `/discovery/runs/:runId` routes work and are deep-linkable
- `DiscoveryListPage` exists as a stripped-down V1 (no filters/sort/preview)
- Runs-list subcomponent extracted and reused
- `DiscoveryRunDetailView` reads `:runId` from URL instead of internal state
- Grid context-menu "Start Discovery Run" navigates directly to new run id

---

### Dashboard Cleanup

#### Task Group 8: Remove In-Dashboard Discovery Toggle State
**Dependencies:** Task Group 7

Remove the now-superseded "show discovery detail" state in `DashboardView`. The dashboard discovery card now navigates to `/discovery` (or directly to a specific run) instead of toggling internal state.

- [x] 8.0 Clean up superseded dashboard discovery state
  - [x] 8.1 Write 2-8 focused tests for dashboard cleanup (use `renderWithFullApp`)
    - Test: clicking the dashboard discovery card navigates to `/.../discovery` (or to `/.../discovery/runs/:runId` if the card represents a specific recent run — match implementer's UX choice)
    - Test: `DashboardView` no longer renders `DiscoveryRunDetailView` inline (component tree assertion)
    - Test: `showDiscoveryDetail` boolean is gone from `DashboardView` source (grep-style assertion, or behavioural assertion that the toggle UI no longer exists)
    - Test: `sessionStorage.pendingDiscoveryDetail` is not read anywhere in the frontend (grep-style or behavioural)
    - Test: the dashboard renders correctly when arrived at via `/.../dashboard` (no regressions from the removal)
  - [x] 8.2 Remove `showDiscoveryDetail` state and inline `DiscoveryRunDetailView` mount
    - Edit `DashboardView.tsx` lines 217 / 232-241 / 417-443
    - Remove the `showDiscoveryDetail` boolean state
    - Remove the inline `<DiscoveryRunDetailView/>` mount in the dashboard's render tree
    - Remove the `sessionStorage.pendingDiscoveryDetail` handoff read/write
    - Discovery card click handler: replace state toggle with `useNavigate('/.../discovery')` (or to a specific run if the card is run-specific)
  - [x] 8.3 Audit for stale references
    - Grep for `showDiscoveryDetail`, `pendingDiscoveryDetail`, `setShowDiscoveryDetail` across `frontend/src/**`
    - Confirm zero hits in non-test source files
    - Update any remaining test references (mechanical) — pre-existing failures stay flagged as out-of-scope
  - [x] 8.4 Ensure dashboard cleanup tests pass
    - Run ONLY the 2-8 tests written in 8.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 8.1 pass
- `showDiscoveryDetail` and `pendingDiscoveryDetail` removed from `DashboardView` and confirmed absent via grep
- Dashboard discovery card navigates via `useNavigate` to `/discovery` (or specific run)
- `DiscoveryRunDetailView` no longer mounted inline in dashboard

---

### End-to-End Verification

#### Task Group 9: End-to-End Routing Tests + Comprehensive Sweep Audit
**Dependencies:** Task Groups 1-8

Cross-tier tests using `renderWithFullApp`: refresh on every top-level URL, refresh on every sub-route URL, browser back/forward, deep-link entry from cold start, every TopBar nav button click. Final sweep for any state-driven view selection that earlier groups missed. This is the final verification and gap-fill stage; up to 10 additional tests maximum per the test-discipline rules.

- [x] 9.0 Final end-to-end verification and sweep
  - [x] 9.1 Review tests from Task Groups 1-8
    - Approximate counts: 1.1 (2-8), 2.1 (2-8), 3.1+3.4 (3-9), 4.1 (2-8), 5.1 (2-8), 6.1 (2-8), 7.1 (2-8), 8.1 (2-8) → roughly 17-65 tests
    - Map each safety property to its specific test:
      - (a) `useActiveArchitectureId()` URL-derived → group 1 test
      - (b) `RootRoute` auto-navigates to active project → group 1 test
      - (c) Every TopBar nav button click changes pathname → group 1 partial; full coverage via 9.4
      - (d) Refreshing on any sub-route URL renders correct view + sub-state → groups 4/5/6/7 tests; cross-tier coverage via 9.4
      - (e) Browser back/forward changes sub-state without page reload → group 4/5 partial; full coverage via 9.4
      - (f) Deep-link to `/discovery/runs/:runId` from cold start → group 7 test
      - (g) Bogus path renders 404 with link back to landing → group 2 test
      - (h) Provider-outside-routes regression → group 1/3 tests
    - If any safety property is NOT covered by a callable test, write the missing test (counts toward the 10-test cap)
  - [x] 9.2 Comprehensive sweep audit for state-driven view selection
    - Grep frontend for any remaining `URLSearchParams` + `pushState` patterns, `dispatch({type: 'SET_*'}` for view-affecting state, `sessionStorage.pending*` handoffs
    - Expected zero hits for view-affecting state-driven selection after Groups 4-7
    - Document any survivors inline; if they relate to in-component scroll/expand hints (like `expandEpicId`) or to non-routable transient state per the locked NOT-routable list, leave them; otherwise migrate
  - [x] 9.3 Re-run the `useParams` audit from Group 1
    - Grep `useParams` across `frontend/src/**`
    - Confirm every non-test call site is still inside a `<Route>` element
    - Catch any regressions introduced by Groups 2-8 (e.g., a new component that reads `useParams` outside route context)
  - [x] 9.4 Write up to 10 additional strategic tests maximum (cross-tier)
    - File: `frontend/src/__tests__/routing/coldStart.test.tsx` — refresh on each top-level URL from the locked list (10 URLs), assert correct view, no empty shell, no "Untitled", no console errors. **Group these into a single parameterised test if Vitest supports `test.each` to stay within the 10-test budget.**
    - File: `frontend/src/__tests__/routing/subRoutes.test.tsx` — refresh on each sub-route URL (`/metamodel/data`, `/diagrams/<id>`, `/product/backlog/<id>`, `/product/implement/<id>`, `/discovery/runs/<id>`); parameterised
    - File: `frontend/src/__tests__/routing/topBarNav.test.tsx` — every TopBar nav button click results in canonical-URL navigation; active styling reflects URL (safety property c full coverage)
    - File: `frontend/src/__tests__/routing/backForward.test.tsx` — simulated back/forward via `MemoryRouter` history changes view + sub-state without remounting providers (safety property e full coverage)
    - File: `frontend/src/__tests__/routing/notFound.test.tsx` — already covered in Group 2; add only if Group 2 didn't reach it
    - **Strict cap of 10 new tests across this group.** Use `test.each` parameterisation aggressively to fit
    - Each new test must justify its presence (covers a gap, not duplicate)
  - [x] 9.5 Run feature-specific tests only
    - Run ONLY tests written in groups 1-8 plus any added in 9.4
    - Expected total: approximately 30-75 tests
    - Do NOT run the entire frontend test suite
    - Verify all eight safety properties (a-h) pass
    - **Pre-existing failures (from project memory + spec): `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `conversation-memory-edge-cases.test.ts`, `DiagramsViewTemporaryDiagram.test.tsx`, `TopBar.export-flow.test.tsx`, plus router-context failures from spec #2 Group 4 in some `UnifiedChat` tests. Flag these as pre-existing if they appear; do NOT try to fix.**

**Acceptance Criteria:**
- All eight critical safety properties (a-h) each have a callable, passing test
- All feature-specific tests pass (approximately 30-75 tests total)
- No more than 10 additional tests added in 9.4 when filling gaps
- Comprehensive sweep audit completed; no remaining state-driven view selection survivors (except locked-NOT-routable transient state)
- `useParams` audit re-run; no regressions
- Pre-existing failures flagged and not addressed

---

## Execution Order

Recommended implementation sequence (dependency-driven):

1. **Group 1** — Foundational bug fixes (CRITICAL — restores basic navigation; safety properties (a), (b), (h) land)
2. **Group 2** — AppShell `<Outlet/>` rework + 404 catch-all (safety property (g) lands)
3. **Group 3** — `renderWithFullApp` test infrastructure + provider-outside-routes regression test (safety property (h) reinforced)
4. **Group 4** — Metamodel sub-routes
5. **Group 5** — Diagrams sub-routes
6. **Group 6** — Product sub-routes
7. **Group 7** — Discovery promotion (safety property (f) lands)
8. **Group 8** — Dashboard internal cleanup
9. **Group 9** — End-to-end routing tests + comprehensive sweep audit (safety properties (c), (d), (e) full coverage lands)

Groups 4-7 are mutually independent after Groups 1-3 land and could in principle be parallelised by separate implementer subagents, though sequential execution is recommended for predictable review.

## Critical Safety Properties Map

| ID | Property | Lands In Group | Test Location |
|----|----------|----------------|---------------|
| (a) | `useActiveArchitectureId()` returns URL-segment value when URL has `:architectureId`, regardless of consumer mount location | 1 | Task 1.1 |
| (b) | `RootRoute` auto-navigates to `/projects/:projectId` when `activeProject` exists on mount (no empty TopBar shell) | 1 | Task 1.1 |
| (c) | Every TopBar nav button click results in `window.location.pathname` changing | 1 (partial), 9 (full) | Task 1.1 + Task 9.4 (`topBarNav.test.tsx`) |
| (d) | Refreshing on any sub-route URL renders the correct view + sub-state | 4/5/6/7 (partial), 9 (full) | Tasks 4.1/5.1/6.1/7.1 + Task 9.4 (`subRoutes.test.tsx`) |
| (e) | Browser back/forward changes the active sub-state without page reload | 4/5 (partial), 9 (full) | Tasks 4.1/5.1 + Task 9.4 (`backForward.test.tsx`) |
| (f) | Deep-linking to `/discovery/runs/:runId` from cold start lands on the run detail screen | 7 | Task 7.1 |
| (g) | Hitting `/some-bogus-path` renders the 404 page with link back to landing | 2 | Task 2.1 |
| (h) | Provider-outside-routes regression — context using `useLocation()`-based parsing returns URL-derived value when mounted outside the route tree | 1, 3 | Tasks 1.1, 3.1, 3.4 (`architectureProviderUrlDerivation.test.tsx`) |

## Notes

- This is a **frontend-only** spec. No backend, gateway, or Liquibase changes.
- Spec #2's `<ProjectLayout>` redirect-and-toast behaviour is preserved verbatim (including legacy URL handling); `KNOWN_VIEW_SEGMENTS` extended to include `discovery` in Group 2.3.
- `useActiveArchitectureId()` signature is unchanged; only its source-of-truth is fixed in Group 1.
- Reducer fields (`selectedDomain`, `selectedDiagramId`) stay; URL leads, reducer is synced via a single effect per view (preserves existing Canvas / Grid / Palette / Inspector consumers).
- **Per-memory caution:** subagent regex-based edits can break code with nested braces (e.g., `mockResolvedValue({...})`). Manually verify each migrated file after sweeping edits — particularly in Groups 1.3, 4.4, 5.4, 6.4, 8.2.
- **`UnifiedChatPanel` test mock requirements** (per project memory): `ArchitectureContext`, `PendingActionContext`, `ModalActionContext`, plus the augmented `ArchitectureContext` exposing `useActiveArchitectureId` / `useArchitectureContext`. The `renderWithFullApp` helper (Group 3) must document this mock surface for downstream test authors.
- **Pre-existing test failures are out of scope.** Flagged list per project memory: `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `conversation-memory-edge-cases.test.ts`, `DiagramsViewTemporaryDiagram.test.tsx`, `TopBar.export-flow.test.tsx`, plus router-context failures from spec #2 Group 4 in some `UnifiedChat` tests. Flag any pre-existing failures when they surface; do NOT try to fix.
