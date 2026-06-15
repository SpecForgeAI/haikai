# Specification: Comprehensive Frontend Routing

## Goal
Replace the partial routing introduced in spec `2026-05-02-multi-architecture-selector-and-routing` with a complete, end-to-end URL-driven routing system that fixes the four diagnosed regressions, promotes Discovery / sub-views to first-class deep-linkable routes, and is exhaustively covered by full-`<App>`-mount tests.

## User Stories
- As a user, I want every screen of the app — including discovery runs, metamodel domains, diagrams, product tabs, and individual work items — to have a stable URL so that I can refresh, bookmark, share, or use browser back/forward and always land back exactly where I was.
- As a user, I want the app to open straight into my last active project's dashboard with the correct project name and architecture selector populated so that I never see an empty TopBar shell, an "Untitled" fallback, or silent-fail navigation buttons.
- As a user mistyping a URL or following a stale link, I want to land on a friendly 404 page with a link back to the landing page rather than a blank screen.

## Specific Requirements

**Foundational fix: URL-derived `activeArchitectureId` in `ArchitectureProvider`**
- Replace `const params = useParams()` + `params.architectureId ?? null` in `ArchitectureContext.tsx` (lines ~2598–2604) with `parseArchitectureIdFromPathname(useLocation().pathname)`.
- `useLocation()` works outside `<Routes>` as long as the call sits inside `<BrowserRouter>` — `ArchitectureProvider` already does, so no provider re-ordering is required.
- Add a new pure helper `parseArchitectureIdFromPathname(pathname: string): string | null` co-located with the existing `parseViewFromPathname`, mirroring its `/projects/:projectId/architectures/:architectureId/...` matching pattern.
- Audit every other `useParams()` call site in `frontend/src/**` (currently `Layout/ProjectLayout.tsx`, `hooks/useNavigateToView.ts`, plus tests) and confirm each remains inside a `<Route>` element; document the audit in the implementation tasks.
- Add a regression test that asserts `useActiveArchitectureId()` returns the correct id on the very first render of a cold `<App>` mount at `/projects/:p/architectures/:a/dashboard` (no `useEffect` wait).

**Locked URL list (17 routes including 404)**
- `/` — Landing page when no active project; `RootRoute` auto-navigates to active project on mount.
- `*` — 404 page with a `<Link to="/">` back to landing.
- `/projects/:projectId` — `<ProjectLayout>` redirect to canonical dashboard URL.
- `/projects/:p/architectures/:a` — Redirect to `/dashboard`.
- `/projects/:p/architectures/:a/dashboard` — Dashboard overview.
- `/projects/:p/architectures/:a/discovery` — Discovery run list (V1 stripped-down page).
- `/projects/:p/architectures/:a/discovery/runs/:runId` — Discovery run detail.
- `/projects/:p/architectures/:a/metamodel` — Default domain `applications`.
- `/projects/:p/architectures/:a/metamodel/:domain` — Specific domain (`applications` / `data` / `business` / `infrastructure` / `ui` / `package-sets`).
- `/projects/:p/architectures/:a/diagrams` — Diagram list (no selection).
- `/projects/:p/architectures/:a/diagrams/:diagramId` — Selected diagram on canvas.
- `/projects/:p/architectures/:a/product` — Redirect to `/product/backlog`.
- `/projects/:p/architectures/:a/product/mission` — Product mission editor.
- `/projects/:p/architectures/:a/product/roadmap` — Roadmap viewer.
- `/projects/:p/architectures/:a/product/backlog` — Backlog tree.
- `/projects/:p/architectures/:a/product/backlog/:workItemId` — Backlog with details panel pre-opened.
- `/projects/:p/architectures/:a/product/implement/:workItemId` — Implementation Assistant for a specific work item.

**`RootRoute` — auto-navigate to active project on mount**
- Delete the file-mode/empty-shell else branch in `App.tsx` `RootRoute` (lines ~268–278).
- Three terminal states only: (a) DB mode + no active project → `<LandingPage>`; (b) loading → spinner; (c) hydrated active project → `<Navigate to="/projects/:projectId" replace />` (which `<ProjectLayout>` then chains to canonical dashboard).
- Never renders a `TopBar` with an empty `<main>` — that combination is the regression bug being fixed.

**`AppShell` rework — single `<Outlet />` slot**
- Replace the `view` prop with `<Outlet />` so nested routes mount inside the shell.
- Outer JSX (TopBar wrapping `<main className="main-content">`) stays identical; only the body content is swapped.
- Existing `useEmptyArchitectureToast`, auto-load-model effect, `useCreateOrganisationShortcut`, and Create Organisation modal mount points stay in place — none depend on the `view` prop.
- The `includeDelivery` redirect-when-product-gated effect remains; `useCurrentView()` keeps returning the top-level view name.

**Sub-route co-location — no new `XLayout.tsx` files**
- Each top-level view component (`ProductView`, `MetaModelView`, `DiagramsView`, `DashboardView`) becomes a tiny layout: it renders its own existing chrome (tab bar / domain selector / toolbar) plus an `<Outlet />` where the active sub-view body mounts.
- Active-tab / active-domain / active-diagram styling is read from URL via small new hooks (`useProductTab`, `useMetaModelDomain`, `useSelectedDiagramId`, `useDiscoveryRunId`, `useWorkItemId`) co-located in `useCurrentView.ts` (or a renamed `urlParsers.ts`).
- No parallel layout files, no CSS module duplication; the diff inside each view is "delete the conditional `{tab === X && <X .../>}` block, render `<Outlet/>`".

**Migrate state-driven view selection that spec #2 missed**
- `ProductView.tsx` lines 82–116: drop `parseTabFromUrl` / `getWorkItemIdFromUrl` / `updateUrl` (`URLSearchParams` + `window.history.pushState`); replace with nested `<Route>`s (`mission`, `roadmap`, `backlog`, `backlog/:workItemId`, `implement/:workItemId`) and `useNavigate` for tab switches.
- `MetaModelView/DomainSelector.tsx` lines 27–28: replace `dispatch({ type: 'SET_DOMAIN' })` with `useNavigate('/.../metamodel/:domain')`. Reducer `selectedDomain` field remains but is synced from URL via a single `useEffect` so existing grid consumers keep working.
- `DiagramsView.tsx` line ~1717: replace `dispatch({ type: 'SELECT_DIAGRAM' })` with `useNavigate('/.../diagrams/:diagramId')`. Reducer `selectedDiagramId` stays, synced from URL on mount and on URL change.
- `DashboardView.tsx` lines 217 / 232–241 / 417–443: remove `showDiscoveryDetail` boolean and `sessionStorage.pendingDiscoveryDetail` handoff; replace with direct `useNavigate('/.../discovery/runs/:runId')` calls. Grid context-menu "Start Discovery Run" navigates to the new run id directly once it has been created.
- Update any call sites that previously produced `?tab=...&expandEpicId=...` URLs (`DashboardView.handleArtifactSaved`, lines 308–310) to produce `/.../product/backlog?expandEpicId=...` — the `expandEpicId` query stays as an in-component scroll/expand hint.

**Discovery first-class routes (V1 stripped-down)**
- `/discovery` — one-column list of historical discovery runs for the active project + architecture, most recent first; each row shows run id / start time / status / tier badge. Click → navigate to `/discovery/runs/:runId`. No filters, sort UI, or candidate-table preview in V1.
- `/discovery/runs/:runId` — reuses the existing `DiscoveryRunDetailView` component, parameterised on `:runId` from the URL instead of internal `selectedRunId` state.
- The runs-list rendering currently inside `DiscoveryRunDetailView`'s left column is extracted into a small subcomponent reused by both the new list page and (optionally) the existing detail view.
- `DashboardView` no longer renders `DiscoveryRunDetailView` inline.

**404 catch-all**
- New component `frontend/src/components/Layout/NotFoundPage.tsx`: minimal — title ("Page not found"), one paragraph, single `<Link to="/">Back to home</Link>`. No marketing copy.
- Mounted as `<Route path="*" element={<NotFoundPage/>} />` outside the project-scoped tree, after `/projects/:projectId` and `/`.

**Test infrastructure: `renderWithFullApp(initialUrl)` helper**
- New helper at `frontend/src/__tests__/routing/testUtils.tsx`. Mounts the full `<App>` with a `MemoryRouter` initial entry rather than relying on isolated `<MemoryRouter>` + child component renders.
- Implementation: extract `App.tsx`'s inner provider tree into a separate `<AppContent>` wrapper. `App` mounts `<BrowserRouter><AppContent/></BrowserRouter>`; the helper mounts `<MemoryRouter initialEntries={[initialUrl]}><AppContent/></MemoryRouter>`. Standard React Router v6 pattern.
- Test files under `frontend/src/__tests__/routing/`:
  - `coldStart.test.tsx` — refresh on every top-level URL; assert correct view, no empty shell, no "Untitled", no console errors.
  - `subRoutes.test.tsx` — refresh on every sub-route URL (`/metamodel/data`, `/diagrams/<id>`, `/product/backlog/<id>`, `/product/implement/<id>`, `/discovery/runs/<id>`).
  - `topBarNav.test.tsx` — every TopBar nav button click results in canonical-URL navigation; active styling reflects URL.
  - `backForward.test.tsx` — simulated back/forward changes view without remounting providers.
  - `notFound.test.tsx` — unmatched URL renders 404 with link back to `/`.
  - `architectureProviderUrlDerivation.test.tsx` — direct test of the bug class fixed by this spec.

**Functionally additive — preserve specs #1–#7**
- No backend / gateway / Liquibase changes. No `react-router-dom` version bump.
- `useActiveArchitectureId()` signature is unchanged; only its source-of-truth is fixed.
- `<ProjectLayout>` redirect-and-toast behaviour from spec #2 is preserved verbatim, including legacy URL handling.
- The architecture selector, empty-view-on-switch toast, and architecture CRUD modals all keep working — they consume the same context this spec fixes.
- Pre-existing test failures listed in project memory are not addressed by this spec.

## Existing Code to Leverage

**`frontend/src/hooks/useCurrentView.ts` (`parseViewFromPathname` + `useCurrentView`)**
- Template for every new pathname parser added by this spec (`parseArchitectureIdFromPathname`, `parseDomainFromPathname`, `parseDiagramIdFromPathname`, `parseProductTabFromPathname`, `parseWorkItemIdFromPathname`, `parseDiscoveryRunIdFromPathname`).
- Co-locate the new parsers in this file (or rename to `urlParsers.ts` if the count justifies it) to keep one source of pathname parsing logic.

**`frontend/src/contexts/ArchitectureContext.tsx` lines 2598–2604**
- The bug epicentre. Replace `useParams()` with `useLocation()` + new parser; `useNavigate` and `useLocation` already imported and used elsewhere in the provider for `setActiveArchitecture`.

**`frontend/src/components/Layout/ProjectLayout.tsx`**
- Keep verbatim — its missing-`:architectureId` redirect, toast firing, `KNOWN_VIEW_SEGMENTS` set, and `extractTrailingViewFromLegacyPath` helper continue to handle the project-root and legacy URLs unchanged. Extend `KNOWN_VIEW_SEGMENTS` to include `discovery` so legacy `/projects/abc/discovery` redirects survive.

**`frontend/src/App.tsx` `AppRoutes` (lines 293–336) and `AppShell` (lines 137–213)**
- Replace the four flat architecture-scoped routes with the nested route tree from the locked URL list. Replace `view` prop with `<Outlet />`. Add the 404 catch-all.

**`frontend/src/components/TopBar/TopBar.tsx` `handleViewChange` (lines 327–333)**
- No code change needed — `handleViewChange` already navigates via `useNavigate`. The early-return guard becomes safe automatically once `activeArchitectureId` is correctly derived. The TopBar's `state.loadedFileName` "Untitled" fallback (line 1222) also resolves itself once the auto-load effect runs.

## Out of Scope
- Backend / gateway / Liquibase changes — none needed.
- "Last used" memory of selected metamodel domain, diagram, product tab, work item, or discovery run — V1 is always-default-on-entry.
- Org / admin / integration settings pages — none currently exist.
- Modal state in URL (e.g. `?modal=createOrg`) — explicitly not routable.
- Backlog refinement-mode in URL (`standard` / `refine` / `refine_and_implement` / `holistic_only`) — ephemeral entry choice.
- Filters / sort / candidate-table preview on the new `/discovery` list page — V1 stripped-down.
- Any visual redesign of existing view chrome — surgical wiring only.
- Selected entity row in metamodel grid (right-hand details panel) — kept as in-component selection.
- Grid filter / sort / pagination state — client-side UI only.
- Fixing the pre-existing test failures listed in project memory.
