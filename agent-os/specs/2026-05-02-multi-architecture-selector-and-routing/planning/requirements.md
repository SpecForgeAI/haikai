# Spec #2 Requirements — Architecture Selector + URL Routing

**Spec folder:** `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/`
**Design note (full multi-spec context):** `agent-os/design-notes/multi-architecture-variants.md`
**Predecessor:** `agent-os/specs/2026-05-01-multi-architecture-plumbing/` (shipped — provides the data model, backend endpoints, gateway proxies, and the silent-default frontend wiring this spec replaces).
**Raw idea:** `planning/raw-idea.md`

This document captures the resolved decisions from the shape-spec phase, ready for `/agent-os:write-spec` to consume.

---

## Context

Spec #1 landed the multi-architecture plumbing end-to-end with **zero user-visible change** — every project gets a `Default` architecture, the frontend silently resolves it at project-load time, and every Bucket A API call carries an `architectureId`.

This spec **replaces the silent default with explicit user-driven selection** that survives refresh and supports deep-linking. Two parallel changes:

1. **URL becomes the source of truth** for active project + active architecture (introducing real react-router-dom usage; the dependency is already in `frontend/package.json` but currently unused).
2. **Architecture selector UI** appears in the top bar so the user can switch between architectures.

CRUD (create / rename / archive / tags) is deferred to spec #3 — this spec only adds the selector UI and the URL routing layer. With one architecture per project (the spec #1 reality), the selector is functionally a no-op for most users until spec #3 ships, but it lays the foundation.

**Hard constraints:**
- Functionally additive — does not break any spec #1 behaviour.
- URL is source of truth; React context is a derived mirror of route params, not the source.
- Old URLs (without `architectureId`) gracefully redirect to canonical form, not error.
- Spec #1's "no silent defaults at the API layer" property is preserved — every API call still includes a real, resolved `architectureId`.

---

## Resolved Product/UX Decisions

### 1. Selector trigger style (closed state in the top bar)

**Pill/chip with subtle border.** The closed selector reads as an interactive control even before the user clicks it — important because spec #2 ships when most projects still have only one (`Default`) architecture, so the affordance must be self-evident.

### 2. What's shown in the closed selector and in dropdown rows

**Just the name**, in both the closed control and the dropdown rows. Cleanest. Tags exist in the schema but have no management UI until spec #3; rendering them now would be empty/no-op visual real estate. Spec #3's tag-management work can revisit this and add tags to the selector if desired.

### 3. URL shape

**Mirror the backend:** `/projects/:projectId/architectures/:architectureId/<view>` (e.g. `/projects/abc/architectures/xyz/diagrams`). Matches the backend mental model exactly, makes deep-links unambiguous, keeps URL semantics consistent across the API and UI.

Concretely the views to migrate (sweep `frontend/src/App.tsx` and the `currentView` state in `ArchitectureContext` — currently `metamodel` / `diagrams` / `product` / `dashboard`) become:
- `/projects/:projectId/architectures/:architectureId/metamodel`
- `/projects/:projectId/architectures/:architectureId/diagrams`
- `/projects/:projectId/architectures/:architectureId/product`
- `/projects/:projectId/architectures/:architectureId/dashboard`

### 4. View persistence on architecture switch

**Stay on the same view, with a soft hint (toast) when the target view would be empty in the new architecture.** Architectures behave as parallel workspaces with the same shape. If a user is on Diagrams in architecture A and switches to architecture B, the URL becomes `/projects/:projectId/architectures/B/diagrams` and the view re-renders for B. If B has no content for that view (e.g. zero diagrams, zero entities), show a brief non-blocking toast like *"Architecture B has no diagrams yet"* so the user understands why the view appears empty.

**"Empty" detection rule** (kept simple for this spec): each view exposes a single boolean it derives from its own data — `metamodel` checks for any entities; `diagrams` checks for any persisted diagrams; `product` checks for product summary content; `dashboard` always considered non-empty. Implementation should add a small per-view hook (`useViewIsEmpty()` style) the toast trigger reads after the architecture-switch effect settles.

### 5. Bookmarks / links lacking `:architectureId`

**Silent redirect to the resolved Default's canonical URL + a brief toast** ("Opened in architecture: Default"). The redirect uses the same oldest-non-archived rule from spec #1's `ArchitectureContext` resolver. The toast tells the user *why* the URL changed, which matters once spec #3 ships and projects can have more than one architecture.

---

## Decisions Made Inline (technical — no user input needed)

| # | Decision | Rationale |
|---|---|---|
| 6 | Use **react-router-dom v6** (already in `frontend/package.json`). `<BrowserRouter>` (not `<HashRouter>`) — the gateway can serve `index.html` for unmatched paths if it doesn't already. | Matches what's installed; clean URLs without `#`. |
| 7 | **`ArchitectureContext` and `ProjectContext` become derived mirrors of route params** (via `useParams` + `useEffect`). Their public hook surface stays unchanged so no consumers need to re-wire. | Existing components keep working with minimal churn; URL is the truth. |
| 8 | **Selector is a new component** at `frontend/src/components/TopBar/ArchitectureSelector.tsx`, mounted next to the project name in the top bar. Reuses dropdown/popover patterns from `frontend/src/components/TopBar/FileMenu.tsx` (positioning, click-outside-to-close, keyboard escape). | Consistent UX with existing top-bar controls. |
| 9 | **Selector data source** = `useActiveArchitectureId()` (already added in spec #1 — augment to also expose the full list and a `setActiveArchitecture(id)` that calls `useNavigate` to swap the URL segment). | Leverages spec #1's wiring. |
| 10 | **Redirect handling for missing `:architectureId`** — implement at a route-level `<Layout>` component that checks for a missing architecture segment, calls `listArchitectures(projectId)` (already exists), picks oldest non-archived, then `<Navigate replace to={canonical}>` to the canonical URL and fires the toast. | Single chokepoint; replaces the spec #1 in-context resolver behaviour at the URL boundary. |
| 11 | **Toast component** — reuse whatever notification primitive the codebase already has (search for `Toast`, `Notification`, `Snackbar` in `frontend/src/components/`). If none exists, introduce a minimal new component for these two cases (architecture-redirect, empty-view-on-switch); spec #3 can promote it to a shared utility if needed. | Avoid building infrastructure unnecessarily. |
| 12 | **Top-level redirects from legacy state-based view routing** — the existing `currentView` state in `ArchitectureContext` is removed; view selection is now driven purely by the route. Update every component that reads/sets `currentView` to either read from `useLocation`/`useParams` or use `useNavigate`. | Single source of truth. |
| 13 | **Empty-view detection** = small per-view hook returning a boolean. Implementation reuses the data already fetched for that view (no extra API calls). | Keeps the soft-hint cheap. |
| 14 | **No backend or gateway changes** in this spec. URL routing is entirely a frontend concern; backend Bucket A endpoints already require `architectureId` per spec #1. | Scope discipline. |
| 15 | **Test strategy** — Vitest tests using `MemoryRouter` for route-driven assertions: (a) selector renders the active architecture's name; (b) clicking an item navigates to the new URL; (c) URL without `:architectureId` redirects to canonical and fires the toast; (d) switching to an architecture whose current view is empty fires the empty-view toast; (e) browser back/forward changes active architecture without a full reload. Plus mechanical updates to existing tests that assumed state-based view switching. | Standard react-router test patterns. |
| 16 | **Pre-existing `react-router-dom` dependency** stays at the version already in `package.json`; no upgrade in this spec. | Scope. |

---

## Out of Scope (deferred to later specs)

- **Architecture CRUD UI** (create / rename / archive) and **tag-management modal** → spec #3.
- **Discovery Service `architectureId` integration** (Discovery's own endpoints + UI selector at run start) → spec #4.
- **LLM persona/task save-target resolution** → spec #5.
- **Full clone** → spec #6.
- **Selective cross-architecture copy** → spec #7.
- **Comparison** and **unarchive UI** → deferred indefinitely.
- **Tags rendered in the selector** — schema supports them, UI does not in this spec; revisit in spec #3 once tag-management exists.
- **Per-architecture access control** — not in V1.

---

## Critical Files (anticipated)

**Frontend:**
- `frontend/src/App.tsx` (modify) — wrap in `<BrowserRouter>`; introduce a `<Routes>` tree replacing the current view-state switching.
- `frontend/src/contexts/ArchitectureContext.tsx` (modify) — `activeArchitectureId` derived from `useParams`; expose `setActiveArchitecture(id)` that calls `useNavigate`; expose the full list (`architectures`).
- `frontend/src/contexts/ProjectContext.tsx` (modify) — `activeProjectId` derived from `useParams`.
- `frontend/src/components/TopBar/ArchitectureSelector.tsx` (new) — pill/chip + dropdown.
- `frontend/src/components/TopBar/ArchitectureSelector.module.css` (new).
- `frontend/src/components/TopBar/TopBar.tsx` (modify) — mount the selector next to the project name.
- `frontend/src/components/Layout/ProjectLayout.tsx` (new — or wherever route layouts live) — handles the missing-`:architectureId` redirect + toast.
- A toast/notification component (new or reused) — for the redirect message and the empty-view hint.
- Per-view "is empty" hooks in `MetaModelView`, `DiagramsView`, `ProductView` (`DashboardView` always non-empty).
- Every component currently reading or setting `currentView` in `ArchitectureContext` — migrate to `useNavigate` / `useParams`.
- `frontend/src/__tests__/multiArchitectureSelectorAndRouting.test.tsx` (new) — feature tests.
- Pre-existing tests asserting on `currentView` state behaviour — mechanical updates to use `MemoryRouter`.

**Gateway:**
- `gateway/src/server.ts` or wherever the static-file serving happens — confirm SPA fallback (serve `index.html` for unmatched routes) is in place; add it if not. **No API changes.**

**Backend:**
- **No changes.**

---

## Visual Assets

None provided. The selector is a small, conventional pill-dropdown — implementation should match the visual language of `frontend/src/components/TopBar/FileMenu.tsx`.
