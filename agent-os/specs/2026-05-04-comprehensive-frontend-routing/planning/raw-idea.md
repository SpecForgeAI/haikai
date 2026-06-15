Comprehensive routing spec for the architecture-store-and-diagrams app. Replaces the partial routing introduced in spec `2026-05-02-multi-architecture-selector-and-routing` (which broke navigation as a side-effect of the multi-architecture work).

**Key diagnostic finding** (real architectural bug from spec #2):
- `ArchitectureProvider` is mounted **OUTSIDE the route tree** in `App.tsx`.
- Inside that provider, `useParams()` returns `{}` because there's no enclosing matched `<Route>`.
- So `activeArchitectureId = params.architectureId ?? null` is always `null`.
- All TopBar nav buttons silent-fail (`handleViewChange` early-returns when `!activeArchitectureId`).
- The auto-load-model effect in `<AppShell>` also fails its `activeArchitectureId` guard, so `state.loadedFileName` never gets set and TopBar shows fallback `'Untitled'`.

**User-described bugs to fix:**
1. App opens with TopBar but no content below when a persisted active project hydrates (RootRoute else branch renders empty `<main>`).
2. "Untitled" shows in TopBar after opening a project (model auto-load never runs because `activeArchitectureId` is null).
3. TopBar nav buttons (Dashboard / Product & Delivery / Architecture & Design / Diagrams) do nothing on click — no console error.

**LOCKED ROUTE LIST (user-confirmed):**

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

1. **Fix the foundational bug** — replace `useParams()` in `ArchitectureProvider` with `useLocation()`-derived URL parsing (same pattern that `useCurrentView` already uses successfully). Audit any other contexts/hooks reading `useParams` outside route context.

2. **Fix `RootRoute`** — when the active project hydrates on mount with no URL match, auto-navigate to `/projects/:projectId` (which `<ProjectLayout>` then redirects to canonical). The empty-TopBar-shell else branch is removed entirely. Every state either renders LandingPage (no project), spinner (loading), or navigates to the project URL (project hydrated).

3. **Add nested sub-routes** for Product (mission/roadmap/backlog/implement), Diagrams (selected diagramId), Metamodel (selected domain), and Dashboard.

4. **Promote `DiscoveryRunDetailView`** from in-dashboard state toggle to its own routes under `/discovery/runs/:runId`. New list view at `/discovery`.

5. **Migrate any remaining state-driven view selection** that spec #2 Group 4 missed (sweep + fix).

6. **`AppShell` rework** — replace the single `view` prop with React Router `<Outlet />` so nested routes mount inside the shell.

7. **404 catch-all route** with link back to landing.

8. **End-to-end routing tests** with FULL `<App>` mount (not isolated `<MemoryRouter>` + child component tests). This specifically catches the provider-outside-routes class of bug. Tests cover: refresh on each top-level URL, refresh on each sub-route URL, browser back/forward, deep-link entry from cold start, every TopBar nav button click resulting in actual navigation.

**Out of scope (deferred):**
- Backend/gateway/Liquibase changes — none needed.
- "Last used" memory of selected metamodel domain or diagram — V1 is always-default-on-entry.
- Org/admin/integration settings pages — none currently exist.
- Modal state in URL (e.g. `?modal=createOrg`) — explicitly not routable.

**Key constraints:**
- Frontend-only spec.
- Functionally additive on top of multi-architecture-variants — must not regress any of specs #1-#7.
- User must be able to refresh any URL and land back where they were.
- All current TopBar nav must work after this spec ships.
- Browser back/forward must work naturally.

**Per project memory:**
- Frontend tests use Vitest + `vi.mock()`. Long pre-existing failure list (don't fix unrelated).
- `UnifiedChatPanel` requires mocks for `ArchitectureContext`, `PendingActionContext`, `ModalActionContext`, plus the augmented `ArchitectureContext` exposing `useActiveArchitectureId` / `useArchitectureContext`.
- Subagent regex-based edits can break with nested braces — verify after sweeping edits.
