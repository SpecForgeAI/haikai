# Spec Requirements: Comprehensive Frontend Routing

**Spec folder:** `agent-os/specs/2026-05-04-comprehensive-frontend-routing/`
**Raw idea:** `planning/raw-idea.md`
**Replaces (partial):** `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` (Group 4 view-state migration was incomplete; this spec finishes the job and fixes the regressions it introduced)
**Design context:** `agent-os/design-notes/multi-architecture-variants.md`

This document captures the resolved scope and decisions for `/agent-os:write-spec`. Per the user's instructions in auto-mode, no clarifying questions were asked — the raw idea is exceptionally detailed (locked URL list, scope items, fix targets, out-of-scope items, key constraints, and implementation hints), and the three "likely implementation questions" listed in the prompt have been resolved inline below.

---

## Initial Description

Comprehensive routing spec for the architecture-store-and-diagrams app. Replaces the partial routing introduced in spec `2026-05-02-multi-architecture-selector-and-routing` (which broke navigation as a side-effect of the multi-architecture work).

**Bugs to fix (real architectural defects from spec #2):**

1. `ArchitectureProvider` is mounted **outside the route tree** in `App.tsx`. `useParams()` returns `{}` so `activeArchitectureId` is permanently `null`.
2. App opens with TopBar but no content below when a persisted active project hydrates — `RootRoute`'s else branch renders an empty `<main>`.
3. "Untitled" shows in TopBar after opening a project — model auto-load never runs because `activeArchitectureId` is null.
4. TopBar nav buttons (Dashboard / Product & Delivery / Architecture & Design / Diagrams) silent-fail because `handleViewChange` early-returns when `!activeArchitectureId`.

**LOCKED ROUTE LIST (user-confirmed, no changes):**

Top-level / unauthenticated:
- `/` — Landing page when no active project; auto-redirect to active project's dashboard when one is loaded on mount
- `*` — 404 page with link back to landing

Project root (auto-redirect):
- `/projects/:projectId` — Redirects to default architecture's dashboard via existing `<ProjectLayout>` redirect logic
- `/projects/:p/architectures/:a` — Redirects to dashboard

Dashboard:
- `/projects/:p/architectures/:a/dashboard` — Dashboard overview

Discovery (NEW — promoted from in-dashboard state toggle):
- `/projects/:p/architectures/:a/discovery` — Discovery run list (own top-level page)
- `/projects/:p/architectures/:a/discovery/runs/:runId` — Discovery run detail (deep-linkable)

Metamodel (Architecture & Design):
- `/projects/:p/architectures/:a/metamodel` — Default domain = applications
- `/projects/:p/architectures/:a/metamodel/:domain` — Specific domain (`applications` / `data` / `business` / `infrastructure` / `ui` / `package-sets`)

Diagrams:
- `/projects/:p/architectures/:a/diagrams` — Diagram list (no selection)
- `/projects/:p/architectures/:a/diagrams/:diagramId` — Selected diagram on canvas (deep-linkable)

Product & Delivery:
- `/projects/:p/architectures/:a/product` — Redirects to backlog (default tab)
- `/projects/:p/architectures/:a/product/mission` — Product mission editor
- `/projects/:p/architectures/:a/product/roadmap` — Roadmap viewer
- `/projects/:p/architectures/:a/product/backlog` — Backlog tree
- `/projects/:p/architectures/:a/product/backlog/:workItemId` — Backlog with details panel pre-opened
- `/projects/:p/architectures/:a/product/implement/:workItemId` — Implementation Assistant for a specific work item

**NOT routable (intentional, kept as transient state):**
- All modals (Create/Edit/Delete dialogs across the app) — bookmarking a half-filled form makes no sense
- Toast notifications — ephemeral
- Palette creation modes / context menus / hover states — transient UI
- Grid filter/sort/pagination state — client-side UI only
- Selected entity row in metamodel grid (right-hand details panel) — kept as in-component selection
- Backlog refinement mode (`standard` / `refine` / `refine_and_implement` / `holistic_only`) — ephemeral entry choice; the workItemId in the URL is the durable part

**SPEC SCOPE:**

1. Fix the foundational bug — replace `useParams()` in `ArchitectureProvider` with `useLocation()`-derived URL parsing (same pattern that `useCurrentView` already uses successfully). Audit any other contexts/hooks reading `useParams` outside route context.
2. Fix `RootRoute` — when the active project hydrates on mount with no URL match, auto-navigate to `/projects/:projectId` (which `<ProjectLayout>` then redirects to canonical). The empty-TopBar-shell else branch is removed entirely.
3. Add nested sub-routes for Product (mission/roadmap/backlog/implement), Diagrams (selected diagramId), Metamodel (selected domain), and Dashboard.
4. Promote `DiscoveryRunDetailView` from in-dashboard state toggle to its own routes under `/discovery/runs/:runId`. New list view at `/discovery`.
5. Migrate any remaining state-driven view selection that spec #2 Group 4 missed (sweep + fix).
6. `AppShell` rework — replace the single `view` prop with React Router `<Outlet />` so nested routes mount inside the shell.
7. 404 catch-all route with link back to landing.
8. End-to-end routing tests with FULL `<App>` mount (not isolated `<MemoryRouter>` + child component tests). This specifically catches the provider-outside-routes class of bug.

**Out of scope (deferred):**
- Backend/gateway/Liquibase changes — none needed.
- "Last used" memory of selected metamodel domain or diagram — V1 is always-default-on-entry.
- Org/admin/integration settings pages — none currently exist.
- Modal state in URL (e.g. `?modal=createOrg`) — explicitly not routable.

**Key constraints:**
- Frontend-only spec.
- Functionally additive on top of multi-architecture-variants — must not regress any of specs #1–#7.
- User must be able to refresh any URL and land back where they were.
- All current TopBar nav must work after this spec ships.
- Browser back/forward must work naturally.

---

## Requirements Discussion

### First Round Questions

No clarifying questions were asked. The raw idea is exhaustive (locked URL list, locked scope, locked out-of-scope, locked constraints, locked decisions on routing library / wrapper / 404 / parser pattern). Auto-mode applied: where the prompt listed "things to decide yourself" they have been decided and documented under [Decisions Made Inline](#decisions-made-inline). Where the prompt listed three "likely implementation questions you might ask," each has been answered inline below rather than asked.

### Existing Code to Reference

**The codebase already contains the patterns this spec extends.** No "similar features" hunt is required — every pattern needed is already in-tree from spec #2's partial implementation. Direct file references for the spec writer:

| Pattern | Existing file | Use for |
|---|---|---|
| Pathname-parsing hook (the model to copy) | `frontend/src/hooks/useCurrentView.ts` (`parseViewFromPathname`) | Source the new `parseArchitectureIdFromPathname` and `parseDomainFromPathname` / `parseDiagramIdFromPathname` / `parseWorkItemIdFromPathname` / `parseDiscoveryRunIdFromPathname` helpers from this template |
| URL-derived navigation hook | `frontend/src/hooks/useNavigateToView.ts` (`buildArchitectureScopedUrl`, `useNavigateToView`) | Extend with builders for the new sub-routes; reuse the projectId/architectureId fallback logic |
| Route-level layout that gates children | `frontend/src/components/Layout/ProjectLayout.tsx` | Template for new `<ProductLayout>` / `<MetaModelLayout>` / `<DiagramsLayout>` / `<DiscoveryLayout>` *(see "Decisions Made Inline" below — actually we co-locate the layout JSX inside the existing view component rather than introducing new files)* |
| `ArchitectureProvider` URL bug epicentre | `frontend/src/contexts/ArchitectureContext.tsx` lines 2599–2604 (`const params = useParams()` → `params.architectureId ?? null`) | Replace with `parseArchitectureIdFromPathname(useLocation().pathname)` |
| Routes tree | `frontend/src/App.tsx` `AppRoutes` (lines 293–336) | Replace with the locked-list nested routes |
| AppShell with `view` prop | `frontend/src/App.tsx` `AppShell` (lines 137–213) | Replace `view` prop with `<Outlet />` |
| RootRoute else-branch bug | `frontend/src/App.tsx` `RootRoute` (lines 234–279) | Replace with auto-navigate-to-`/projects/:id` when project hydrated; landing or spinner otherwise; never render empty shell |
| Tab-to-URL view selector (existing) | `frontend/src/components/TopBar/TopBar.tsx` `handleViewChange` (lines 327–333) | Already URL-driven; no rework, but the early-return guard becomes safe once arch id is correctly derived |
| Toast infrastructure | `frontend/src/contexts/ToastContext.tsx` + `frontend/src/components/common/Toast.tsx` | Reuse for `<ProjectLayout>` redirect toast (already wired) and for the discovery / 404 surfaces if any messaging is needed |
| Internal tab/state currently not in URL — Product | `frontend/src/components/ProductView/ProductView.tsx` (lines 82–116, `parseTabFromUrl` / `getWorkItemIdFromUrl` / `updateUrl` using `URLSearchParams` + `window.history.pushState`) | **Migrate to react-router child routes** — replace `?tab=...` query manipulation with nested `<Outlet />` and useNavigate; preserve workItemId via path params per locked URL list |
| Internal tab/state currently not in URL — Metamodel | `frontend/src/components/MetaModelView/DomainSelector.tsx` (lines 27–28, dispatches `SET_DOMAIN`) | **Migrate to URL** — domain selection becomes `:domain` path param; `SET_DOMAIN` dispatch becomes `useNavigate` to `/metamodel/:domain` |
| Internal state currently not in URL — Diagrams | `frontend/src/components/DiagramsView/DiagramsView.tsx` (line 1717, `dispatch({ type: 'SELECT_DIAGRAM', payload: diagramId })`) | **Migrate to URL** — selected diagram becomes `:diagramId` path param; the existing `SELECT_DIAGRAM` reducer field can stay as a derived sync target, but URL is the source of truth |
| Internal state currently not in URL — Discovery | `frontend/src/components/DashboardView/DashboardView.tsx` (lines 217, 232–241, 417–443; `showDiscoveryDetail` boolean + `pendingDiscoveryDetail` sessionStorage flag) | **Migrate to URL** — promote to its own `/discovery` and `/discovery/runs/:runId` routes; `pendingDiscoveryDetail` sessionStorage flag is replaced by direct navigation; `DashboardView` no longer renders `DiscoveryRunDetailView` inline |
| Existing Bucket A `useParams` audit baseline | grep `useParams` in `frontend/src/**` returned: `Layout/ProjectLayout.tsx`, `contexts/ArchitectureContext.tsx`, `hooks/useNavigateToView.ts`, plus tests. | **Only `ArchitectureContext.tsx` is broken** (mounted outside routes). `useNavigateToView` is fine because it's only called from inside route components. `ProjectLayout` is itself a route element. The audit should still confirm no further regressions. |

No similar features outside the multi-architecture spec series need to be referenced.

### Follow-up Questions

None — auto-mode, no questions asked.

---

## Visual Assets

### Files Provided

`ls` of `agent-os/specs/2026-05-04-comprehensive-frontend-routing/planning/visuals/` returned no `.png/.jpg/.jpeg/.gif/.svg/.pdf` files.

No visual assets provided.

### Visual Insights

N/A. The spec is a routing/wiring refactor with no UI-design fidelity required beyond what the existing components render. The only genuinely new screen surface (a `/discovery` list page) is decided in [Decisions Made Inline](#decisions-made-inline) to mirror the existing in-dashboard `DiscoveryRunDetailView` runs list, not to introduce new visual design.

---

## Decisions Made Inline

The prompt listed twelve technical points to decide ourselves and three "likely implementation questions you might ask, max 3, only if genuinely ambiguous." All resolved here.

### Routing library / wrapper / 404 / parsing pattern

| # | Decision | Rationale |
|---|---|---|
| 1 | Use `react-router-dom@^6.22.0` already in `frontend/package.json`. No upgrade. | Confirmed present (`frontend/package.json` line 22). Spec #2 already adopted this version. |
| 2 | `<BrowserRouter>` (not `<HashRouter>`). | Spec #2 already chose this; no change. Gateway SPA fallback is in place from spec #2. |
| 3 | Replace `useParams()` in `ArchitectureProvider` with `parseArchitectureIdFromPathname(useLocation().pathname)`. | Same pattern `useCurrentView` uses today. Solves the provider-outside-routes class of bug. |
| 4 | Reuse the `parseViewFromPathname` shape (`hooks/useCurrentView.ts`) as the template for new parsers. | Already proven in-tree; tested against canonical and legacy URL shapes. |
| 5 | Audit pattern: grep `useParams` in `frontend/src/**` and check every call site is inside a `<Route>` element component. | Result of the audit (run during this requirements pass): only `ArchitectureContext.tsx` is outside routes; everything else is fine. Re-grep during implementation as a regression check. |
| 6 | `AppShell` outer JSX shape stays similar (`TopBar` + `<main className="main-content">`); replace the single `view` prop with `<Outlet />`. | Minimal diff, preserves existing styling, lets nested routes mount inside the shell. |
| 7 | New 404 page `frontend/src/components/Layout/NotFoundPage.tsx`: minimal — title ("Page not found"), one paragraph, single `<Link to="/">Back to home</Link>`. No marketing copy. | Catch-all only; not a feature surface. |
| 8 | Test file naming: `frontend/src/__tests__/routing/<area>.test.tsx`. New folder for clarity (vs. flat `__tests__/`). | Routing tests are a coherent class; co-locating them eases future maintenance and avoids confusion with the 100+ existing flat tests. |
| 9 | `useCurrentView` extension: keep the existing `(): 'metamodel' \| 'diagrams' \| 'product' \| 'dashboard'` for top-level chrome (TopBar active-button styling), and **co-locate** the new sub-route parsers (`parseDomainFromPathname`, `parseDiagramIdFromPathname`, `parseWorkItemIdFromPathname`, `parseProductTabFromPathname`, `parseDiscoveryRunIdFromPathname`) as additional named exports in the same `useCurrentView.ts` file (rename the file to `urlParsers.ts` if the parser count justifies it; the spec writer can decide). | Single source of pathname-parsing logic; one file is easier to test exhaustively. |

### Sub-route layout shape (decision for "likely question 1")

| # | Decision | Rationale |
|---|---|---|
| 10 | **Co-locate sub-route layouts inside the existing view components.** Each top-level view (`ProductView`, `MetaModelView`, `DiagramsView`, `DashboardView`) becomes a tiny layout component rendering its own chrome (tab bar / header / toolbar) plus an `<Outlet />` for the child route body. The actual tab bodies (already extracted: `ProductBacklogPage`, `ProductImplementPage`, `ProductRoadmapPage`, `ProductPage`/`ProductMission`, etc.) become standalone components mounted by child routes. **Do not introduce parallel `XLayout.tsx` files.** | The chrome (tab bar, toolbar, persona panel mount points) lives inside the existing view components today and is tightly coupled to their CSS modules. Extracting a separate Layout file would force duplication of the tab-bar JSX + a second CSS module. Co-locating keeps the diff surgical: `ProductView.tsx` keeps its tab bar, replaces the conditional `{activeTab === 'backlog' && <ProductBacklogPage .../>}` block with `<Outlet />`, and the active-tab styling reads from the URL via a small `useProductTab()` hook (mirrors `useCurrentView`). Same pattern for `MetaModelView` (DomainSelector becomes URL-driven, body becomes `<Outlet />`), `DiagramsView` (selected diagram becomes path param, canvas mounts via child route), and dashboard (no sub-routes, but Discovery is hoisted out). |

### Test infrastructure (decision for "likely question 2")

| # | Decision | Rationale |
|---|---|---|
| 11 | **Introduce `renderWithFullApp(initialUrl: string)` helper** at `frontend/src/__tests__/routing/testUtils.tsx`. The helper mounts `<App>` with a `MemoryRouter` initial entry (replacing the `BrowserRouter` import in App with a router prop or wrapping App's body in a way that lets tests inject a router — see implementation note below). All routing tests use the helper. | The raw idea explicitly calls for **end-to-end routing tests with FULL `<App>` mount (not isolated `<MemoryRouter>` + child component tests)** to catch the provider-outside-routes class of bug. Inline boilerplate would drift across files. A single helper makes the cold-start / refresh / back-forward / TopBar-nav tests trivial to write. **Implementation note for spec writer:** the cleanest way is to extract `<AppRoutes>` and the provider tree from `App.tsx` into a separate `<AppContent>` wrapper, then have `App` mount `<BrowserRouter><AppContent/></BrowserRouter>` while the test helper mounts `<MemoryRouter initialEntries={[initialUrl]}><AppContent/></MemoryRouter>`. This is a well-trodden React Router v6 pattern. |

### Discovery list view at `/discovery` (decision for "likely question 3")

| # | Decision | Rationale |
|---|---|---|
| 12 | **V1 = stripped-down version of the existing dashboard discovery card.** New page at `/discovery` is a one-column list of historical discovery runs for the project + active architecture (most recent first), each row showing run id / start time / status / tier badge — exactly the rows that `DiscoveryRunDetailView`'s left column already renders. Click a row → navigate to `/discovery/runs/:runId`. The detail page reuses the existing `DiscoveryRunDetailView` component, parameterised on `:runId` from the URL instead of internal `selectedRunId` state. **No filters, no sort UI, no candidate-table preview on the list page** — those are deferred. | The user prompt's "lean" guidance: *"stripped-down for V1; mirrors current dashboard card behaviour but as its own page."* The existing `DiscoveryRunDetailView` already renders both the runs list and the selected-run detail panel — splitting it across two routes is a small refactor (extract the runs-list subcomponent) rather than new UI design. Keeps scope tight and matches the locked URL list. |

### Migration of remaining state-driven view selection (scope item 5 sweep)

The audit performed during this requirements pass identified four call sites still using non-URL state for things the locked URL list says should be in the URL:

1. **`ProductView.tsx`** lines 82–116: `parseTabFromUrl` / `getWorkItemIdFromUrl` / `updateUrl` use `URLSearchParams` + `window.history.pushState` for tab + workItemId. Migrate to react-router child routes (locked URLs `/product/mission`, `/product/roadmap`, `/product/backlog`, `/product/backlog/:workItemId`, `/product/implement/:workItemId`).
2. **`MetaModelView/DomainSelector.tsx`** lines 27–28: `dispatch({ type: 'SET_DOMAIN', payload: domain })`. Migrate to `useNavigate('/metamodel/:domain')`. Reducer field `selectedDomain` can stay as a derived sync target read by the grid, with URL as source of truth — same pattern as `selectedDiagramId` below.
3. **`DiagramsView.tsx`** line 1717 etc.: `dispatch({ type: 'SELECT_DIAGRAM', payload: diagramId })`. Migrate to `useNavigate('/diagrams/:diagramId')`. The reducer field `selectedDiagramId` stays for the Canvas / palette / inspector consumers; an effect synchronises URL → reducer at mount and on URL changes.
4. **`DashboardView.tsx`** lines 217, 232–241, 417–443 + `sessionStorage.pendingDiscoveryDetail`: `showDiscoveryDetail` boolean + sessionStorage handoff. Migrate to direct navigation to `/discovery` or `/discovery/runs/:runId`. The Grid context-menu "Start Discovery Run" action that today sets the sessionStorage flag should instead navigate directly to `/discovery/runs/:newRunId` once the run has been created.

### Bug fixes (scope items 1–4 + 6 + 7) — confirmed approach

| Bug | Fix |
|---|---|
| `ArchitectureProvider.useParams()` returns `{}` | Replace with `parseArchitectureIdFromPathname(useLocation().pathname)`. `useLocation` works outside `<Routes>` as long as we're inside `<BrowserRouter>` — which we are. |
| `RootRoute` empty-shell else branch | Delete the else branch entirely. New logic: (a) DB mode + no active project → `<LandingPage>`; (b) loading → spinner; (c) hydrated active project → `<Navigate to="/projects/:id" replace />` (then `<ProjectLayout>` chains to canonical). |
| TopBar nav buttons silent-fail | Already correct in the code (`handleViewChange` already calls `navigate` with the URL). The fix is upstream: once `activeArchitectureId` is no longer `null`, the early-return guard passes and the buttons work. |
| `AppShell` `view` prop coupling | Replace `<AppShell view={...} />` with `<AppShell>` rendering `<Outlet />` in the main content slot. |
| 404 catch-all | New `<Route path="*" element={<NotFoundPage/>} />` outside the project-scoped tree. |

### End-to-end routing tests (scope item 8)

Tests live under `frontend/src/__tests__/routing/`:

- `routing/coldStart.test.tsx` — refresh on each top-level URL (10 URLs from the locked list) with mocked `getActiveProject` / `listArchitectures` returning a real arch id; assert correct view component renders, no empty-shell, no "Untitled" fallback, no console errors.
- `routing/subRoutes.test.tsx` — refresh on each sub-route URL (`/metamodel/data`, `/diagrams/<id>`, `/product/backlog/<id>`, `/product/implement/<id>`, `/discovery/runs/<id>`); assert correct selected state.
- `routing/topBarNav.test.tsx` — every TopBar nav button click results in navigation to the canonical URL; active-button styling reflects URL.
- `routing/backForward.test.tsx` — simulated browser back/forward via `MemoryRouter` history changes the rendered view without remounting providers.
- `routing/notFound.test.tsx` — unmatched URL renders 404 with link back to `/`.
- `routing/architectureProviderUrlDerivation.test.tsx` — direct test of the bug class: mount `<App>` cold at `/projects/p/architectures/a/dashboard`; assert `useActiveArchitectureId()` returns `'a'` immediately on first render (no `useEffect` wait).

All tests use the `renderWithFullApp(url)` helper from `routing/testUtils.tsx`.

Pre-existing test failures listed in project memory (bootstrap-summary-fetching, conversation-memory-edge-cases, dashboardSummary, hub-bootstrap-4-task-definition, chatV2-panel) are **not** addressed by this spec.

---

## Requirements Summary

### Functional Requirements

1. URL is the single source of truth for project + architecture + view + sub-view (domain / diagram / work-item / discovery-run).
2. Refreshing any URL from the locked list lands the user back on the same view with the same selection.
3. Browser back/forward changes the view/selection without remounting providers.
4. All four TopBar nav buttons navigate to the canonical architecture-scoped URL on click.
5. The four diagnosed bugs are gone: no empty `<main>` on hydrated project, no "Untitled" fallback after open, no silent-fail on TopBar clicks, no permanently-null `activeArchitectureId`.
6. Discovery is its own first-class page (list + detail) instead of an in-dashboard toggle.
7. 404 page renders for unmatched URLs.

### Reusability Opportunities

Already cataloged in [Existing Code to Reference](#existing-code-to-reference). Key reuses: `useCurrentView` parser shape, `useNavigateToView` URL builder, `<ToastProvider>` for any incidental messaging, `<ProjectLayout>` redirect pattern (re-applied conceptually if any sub-route layout needs gating), `DiscoveryRunDetailView` (split into list-row component + detail panel for the new route pair).

### Scope Boundaries

**In Scope:**
- The eight scope items listed in the raw idea.
- The state-driven view-selection sweep covering Product tab, Metamodel domain, Diagrams selected diagram, and Discovery toggle.
- Test infrastructure helper (`renderWithFullApp`) and the six routing test files listed above.
- Co-locating sub-route layouts inside the existing view components (no new `XLayout.tsx` files except the `NotFoundPage`).

**Out of Scope:**
- Backend / gateway / Liquibase changes — none needed.
- "Last used" memory of selected metamodel domain, diagram, product tab, work item, or discovery run — V1 is always-default-on-entry per locked URL list.
- Org / admin / integration settings pages — none currently exist.
- Modal state in URL — explicitly not routable per locked NOT-routable list.
- Backlog refinement-mode in URL — locked NOT-routable per raw idea.
- Filters/sort on the new `/discovery` list page — V1 stripped-down.
- Any visual redesign of existing view chrome — surgical wiring only.
- Fixing the pre-existing test failures listed in project memory.

### Technical Considerations

- **Router flavour:** `<BrowserRouter>` only in `App.tsx`; tests inject `<MemoryRouter>` via the `renderWithFullApp` helper, which means `App` must expose its inner content separate from the router (extract `<AppContent>` wrapper).
- **URL-derivation pattern:** Every parser is a pure function on `pathname`, exported alongside its hook variant — same shape as `parseViewFromPathname` / `useCurrentView`. No `useParams` outside route element components.
- **Reducer fields stay, URL leads:** `selectedDiagramId` and `selectedDomain` reducer fields are not deleted; instead a single effect per view syncs URL → reducer at mount and on URL change. Writes (selecting a diagram, switching domain, switching tab) become `useNavigate` calls; the reducer mutation happens reactively via the sync effect. This keeps the existing Canvas / Grid / Palette / Inspector consumers untouched.
- **`SET_VIEW` is already removed** (spec #2 Group 4); no further action there.
- **`ProductView.tsx` `URLSearchParams` + `pushState` migration:** the `?tab=...` pattern is replaced by nested routes. Any external callers that today produce `?tab=backlog&expandEpicId=<id>` URLs (e.g. `DashboardView.handleArtifactSaved`, line 308–310) need to be updated to produce `/.../product/backlog?expandEpicId=<id>` — the `expandEpicId` query param stays (it's an in-component scroll/expand hint, not a routable selection).
- **`pendingDiscoveryDetail` sessionStorage handoff:** replaced by direct navigation to `/discovery/runs/<newRunId>`. The Grid context-menu action that creates the run already has the new run id — it just needs to navigate instead of setting sessionStorage and dispatching SET_VIEW.
- **Provider order in `App.tsx`:** stays `<AppConfigProvider><ToastProvider><BrowserRouter><ProjectProvider><ArchitectureProvider>...`. `ArchitectureProvider` is already inside `<BrowserRouter>` (which is why `useLocation()` works inside it); the bug is only that it uses `useParams()` (which needs a `<Route>` match) instead of `useLocation()` (which doesn't).
- **Backwards compatibility with spec #2's `<ProjectLayout>` redirect:** kept verbatim. Legacy URLs like `/projects/abc/diagrams` still redirect to the canonical form.
- **No regression of specs #1–#7:** the multi-architecture selector, redirect toast, empty-view-on-switch toast, and CRUD UI all keep working — they're all already URL-aware and consume `useActiveArchitectureId()` / `architectures` from `ArchitectureContext`, which this spec only fixes (does not break).
- **404 placement:** outside the project-scoped tree, after the `/projects/:projectId` route. Order in `<Routes>`: project routes first (most specific), then `/`, then `*`.
- **Test mocks:** the existing `architectureModelClient` / `architecturesApi` / `getActiveProject` / `listArchitectures` mock patterns from `multiArchitecturePlumbing.test.tsx` and `multiArchitectureSelectorAndRouting.test.tsx` are reused. The `UnifiedChatPanel` mock requirements documented in project memory (`ArchitectureContext`, `PendingActionContext`, `ModalActionContext`) still apply for any test that mounts a view that mounts the panel.
