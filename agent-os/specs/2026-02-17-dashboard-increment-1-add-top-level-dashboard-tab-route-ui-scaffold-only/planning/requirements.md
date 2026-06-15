# Spec Requirements: Dashboard Increment 1 -- Add Top-Level Dashboard Tab + Route (UI Scaffold Only)

## Initial Description

Introduce a new top-level "Dashboard" entry point that appears before "Product & Delivery" in the main top navigation and routes to a new DashboardPage. This increment is UI-only: no backend calls, no mock data, no LLM, no new DTOs yet.

Scope includes:
- frontend: top nav update to add Dashboard tab/button before Product & Delivery
- frontend: new DashboardPage route + placeholder UI scaffold

Scope excludes:
- any backend endpoints (gateway/mcp/model-service)
- any data fetching or mock data
- any persona panels, scope selector, cards layout
- any persistence or database changes

Frontend changes:
1. Add Dashboard route - new route path "/dashboard", reachable via navigation
2. Create DashboardPage scaffold - placeholder with title "Dashboard" and subtitle "Project delivery overview (coming soon)."
3. Add Dashboard tab/button to main top navigation before "Product & Delivery"
4. Minimal UX: route loads instantly, no console errors, works when switching between areas

Acceptance criteria:
- A new top-level "Dashboard" tab/button appears before "Product & Delivery"
- Navigating to "/dashboard" renders a Dashboard page with placeholder title/subtitle
- Active tab styling correctly indicates Dashboard when on "/dashboard"
- No backend changes, no network calls

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea mentions the route path "/dashboard", but the current app does not use URL-based routing for top-level views. Navigation is entirely managed via React Context state (`currentView` in ArchitectureContext). I'm assuming we should follow the existing pattern and add `'dashboard'` as a new value to the `currentView` state union type (alongside `'product'`, `'metamodel'`, `'diagrams'`), rather than introducing actual React Router routes. Is that correct, or should this increment also introduce URL-based routing (e.g., using the already-installed `react-router-dom`)?
**Answer:** Follow the existing pattern -- add 'dashboard' as a new currentView value in ArchitectureContext (no React Router routes).

**Q2:** The "Product & Delivery" tab is conditionally rendered based on the `includeDelivery` feature toggle from `AppConfigContext`. I'm assuming the new Dashboard tab should always be visible (no feature toggle gating), since it's intended to be the primary entry point. Is that correct, or should it also be behind a feature toggle?
**Answer:** Dashboard should always be visible (no feature-toggle gating).

**Q3:** The current app starts with `currentView: 'metamodel'` as the default initial state. Since Dashboard is meant to be the primary entry point appearing first in navigation, I'm assuming we should change the default initial view to `'dashboard'` so the app opens to the Dashboard on startup. Is that correct, or should the initial view remain `'metamodel'` for now?
**Answer:** Keep the default initial view as 'metamodel' for now (don't change startup default in Increment 1).

**Q4:** For the placeholder scaffold, the raw idea specifies a title "Dashboard" and subtitle "Project delivery overview (coming soon)." I'm assuming this should be a simple centered placeholder matching the existing pattern used elsewhere in the app (e.g., `ProductView.module.css` has a `.placeholder` class with centered text, muted color `#888`, `font-size: 16px`). Should the scaffold follow this exact pattern, or do you envision something different?
**Answer:** Use the existing centered/muted placeholder style (simple scaffold consistent with other empty states).

**Q5:** The existing view navigation guard in `App.tsx` redirects from `'product'` to `'metamodel'` when `includeDelivery` is false. With the new Dashboard view, should this fallback change to redirect to `'dashboard'` instead of `'metamodel'` when delivery is disabled? Or should the guard remain unchanged for this increment?
**Answer:** Keep the existing fallback unchanged (redirect product->metamodel when delivery is disabled; no redirect-to-dashboard in this increment).

**Q6:** The new `DashboardPage` component needs a home. I'm assuming we should create a new `frontend/src/components/DashboardView/` folder (following the naming convention of `ProductView/`, `MetaModelView/`, `DiagramsView/`) containing `DashboardPage.tsx` and `DashboardPage.module.css`. Is that correct, or do you prefer a different folder name or structure?
**Answer:** Yes -- create src/components/DashboardView/ following the established convention (e.g., DashboardView.tsx + module CSS alongside ProductView/MetaModelView/DiagramsView/).

### Existing Code to Reference

No similar existing features were explicitly identified by the user. However, based on codebase research the following files contain the patterns that must be followed:

**Navigation and View Switching Pattern:**
- `frontend/src/components/TopBar/TopBar.tsx` - Top-level navigation buttons in `.viewToggle` div (lines 933-959). Dashboard button should be inserted BEFORE the Product & Delivery button.
- `frontend/src/components/TopBar/TopBar.module.css` - `.toggleButton` and `.active` CSS classes for tab styling.
- `frontend/src/App.tsx` - View rendering via conditional expressions in `AppContent` (lines 118-120). Dashboard view rendering should be added here.
- `frontend/src/contexts/ArchitectureContext.tsx` - `currentView` type union on line 119, `SET_VIEW` action payload type on line 145, initial state on line 247, and reducer case on line 484.

**View Component Pattern (to follow for DashboardView):**
- `frontend/src/components/ProductView/` - Example top-level view folder with `ProductView.tsx` + `ProductView.module.css`.
- `frontend/src/components/MetaModelView/` - Another example: `MetaModelView.tsx` + `MetaModelView.module.css`.
- `frontend/src/components/DiagramsView/` - Third example: `DiagramsView.tsx` + `DiagramsView.module.css`.

### Follow-up Questions

No follow-up questions were needed. All answers were clear and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided. The mandatory bash check of the `planning/visuals/` folder confirmed no image files are present.

### Visual Insights:
Not applicable -- no visuals were provided.

## Requirements Summary

### Functional Requirements
- Add `'dashboard'` to the `currentView` union type in `ArchitectureContext` (type definition and `SET_VIEW` action payload type).
- Add a "Dashboard" toggle button as the FIRST item in the `.viewToggle` navigation bar in `TopBar.tsx`, appearing before "Product & Delivery".
- The Dashboard button must always be visible (no feature-toggle gating, unlike Product & Delivery which is gated by `includeDelivery`).
- Clicking the Dashboard button dispatches `SET_VIEW` with payload `'dashboard'`.
- Active tab styling (`.toggleButton.active` CSS class) must correctly highlight when `currentView === 'dashboard'`.
- Add conditional rendering `{state.currentView === 'dashboard' && <DashboardView />}` in `App.tsx` `AppContent` component.
- Create `DashboardView` component in `frontend/src/components/DashboardView/DashboardView.tsx` with a placeholder UI containing:
  - Title: "Dashboard"
  - Subtitle: "Project delivery overview (coming soon)."
  - Centered, muted styling consistent with other placeholder/empty states in the app.
- Create accompanying CSS module `frontend/src/components/DashboardView/DashboardView.module.css`.
- The `data-testid` for the new navigation button should follow the existing convention (e.g., `data-testid="dashboard-nav-button"`).

### Reusability Opportunities
- The `.toggleButton` and `.active` CSS classes in `TopBar.module.css` are already defined and will be reused for the Dashboard button (no new CSS needed in TopBar).
- The centered placeholder pattern used in other views can be replicated for the DashboardView scaffold.
- The `handleViewChange` function in `TopBar.tsx` already accepts the view string and dispatches `SET_VIEW`; it just needs its type signature extended to accept `'dashboard'`.

### Scope Boundaries

**In Scope:**
- Extending the `currentView` type union to include `'dashboard'` in `ArchitectureContext`.
- Adding a Dashboard toggle button to `TopBar.tsx` navigation (first position, always visible).
- Creating `DashboardView.tsx` + `DashboardView.module.css` in a new `DashboardView/` folder.
- Adding conditional rendering for the dashboard view in `App.tsx`.
- Ensuring no console errors when switching between all views including Dashboard.
- Unit tests for the new component and navigation behavior.

**Out of Scope:**
- Any backend endpoints (gateway, mcp-server, model-service).
- Any data fetching, API calls, or mock data.
- Any persona panels, scope selector, or cards layout on the dashboard.
- Any persistence or database changes.
- Changing the default initial view from `'metamodel'` to `'dashboard'` (deferred to a future increment).
- Changing the existing navigation guard fallback (product->metamodel redirect stays unchanged).
- Introducing URL-based routing via React Router (the existing context-based view switching pattern is retained).
- Any feature-toggle gating for the Dashboard tab.

### Technical Considerations
- **State type extension**: The `currentView` type in `ArchitectureContext.tsx` (line 119) must be extended from `'product' | 'metamodel' | 'diagrams'` to `'product' | 'metamodel' | 'diagrams' | 'dashboard'`. The same change applies to the `SET_VIEW` action payload type (line 145) and the `handleViewChange` function signature in `TopBar.tsx` (line 236).
- **No React Router**: Despite `react-router-dom` being in `package.json`, the app does not use URL-based routing for top-level views. This increment follows the existing `ArchitectureContext` state-driven pattern.
- **Button ordering**: The Dashboard button must appear FIRST in the `.viewToggle` div, before the conditionally-rendered "Product & Delivery" button. The JSX order in `TopBar.tsx` determines visual order.
- **CSS Modules**: The new `DashboardView.module.css` should follow the vanilla CSS + CSS Modules pattern used throughout the project. No preprocessors, no styled-components.
- **Test framework**: Vitest + React Testing Library for any unit tests.
- **Existing guard unchanged**: The `useEffect` guard in `App.tsx` (lines 73-77) that redirects `product`->`metamodel` when `includeDelivery=false` remains untouched. The Dashboard view is not subject to any guard.
