# Specification: Dashboard Increment 1 -- Add Top-Level Dashboard Tab + Route (UI Scaffold Only)

## Goal

Introduce a new top-level "Dashboard" entry point in the main navigation bar that routes to a placeholder DashboardView component, following the existing context-driven view pattern. This increment is UI-scaffold only -- no backend calls, no data fetching, no mock data.

## User Stories

- As a user, I want to see a "Dashboard" tab in the top navigation bar so that I can navigate to a project delivery overview area.
- As a user, I want to click the Dashboard tab and see a placeholder page confirming the Dashboard area exists, so that I know it will be available for future functionality.

## Specific Requirements

**Extend the `currentView` union type in ArchitectureContext**
- In `frontend/src/contexts/ArchitectureContext.tsx`, line 119, change the `currentView` type from `'product' | 'metamodel' | 'diagrams'` to `'product' | 'metamodel' | 'diagrams' | 'dashboard'`.
- On line 145, extend the `SET_VIEW` action payload type from `'product' | 'metamodel' | 'diagrams'` to `'product' | 'metamodel' | 'diagrams' | 'dashboard'`.
- The initial state on line 247 (`currentView: 'metamodel'`) must remain unchanged -- do NOT change the startup default.
- The `SET_VIEW` reducer case on line 484 already assigns `action.payload` generically, so no reducer logic change is needed.

**Extend `handleViewChange` in TopBar to accept `'dashboard'`**
- In `frontend/src/components/TopBar/TopBar.tsx`, line 236, the `handleViewChange` function's parameter type is currently `(view: 'product' | 'metamodel' | 'diagrams')`. Extend this to `(view: 'product' | 'metamodel' | 'diagrams' | 'dashboard')`.
- No other changes to `handleViewChange` body are needed; it already dispatches `SET_VIEW` with the parameter value.

**Add a Dashboard toggle button to TopBar navigation**
- In the `.viewToggle` div in `TopBar.tsx` (line 933), insert a new `<button>` element as the FIRST child, BEFORE the conditionally-rendered `{includeDelivery && (...)}` Product & Delivery block (line 935).
- The Dashboard button must always be visible (no feature-toggle gating, unlike Product & Delivery which is gated by `includeDelivery`).
- Apply the same className pattern: `` className={`${styles.toggleButton} ${state.currentView === 'dashboard' ? styles.active : ''}`} ``.
- Set `onClick={() => handleViewChange('dashboard')}`.
- Set `data-testid="dashboard-nav-button"`.
- Button label text: `Dashboard`.

**Add conditional rendering for DashboardView in App.tsx**
- In `frontend/src/App.tsx`, within the `<main className="main-content">` block (lines 116-121), add a new conditional render line: `{state.currentView === 'dashboard' && <DashboardView />}`.
- Place it as the first item in the block, before the existing `product`, `metamodel`, and `diagrams` conditionals.
- Add the corresponding import at the top of App.tsx: `import { DashboardView } from './components/DashboardView/DashboardView';`.

**Create the DashboardView component**
- Create a new folder `frontend/src/components/DashboardView/`.
- Create `frontend/src/components/DashboardView/DashboardView.tsx` as a named export `DashboardView`.
- The component renders a container `<div>` with `data-testid="dashboard-view"` and the CSS module class for the container.
- Inside the container, render a centered placeholder with a title "Dashboard" in an `<h1>` element and a subtitle paragraph "Project delivery overview (coming soon)." in a `<p>` element.
- Apply centered, muted placeholder styling consistent with the `.placeholder` class pattern in `ProductView.module.css` (lines 73-82): flex centering, `color: #888`, `font-size: 16px`, `padding: 40px`.

**Create the DashboardView CSS module**
- Create `frontend/src/components/DashboardView/DashboardView.module.css`.
- Define a `.container` class: `display: flex; flex-direction: column; height: calc(100vh - 60px);` (matching the ProductView container pattern for full-height views beneath the 60px TopBar).
- Define a `.placeholder` class: `flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #888; font-size: 16px; padding: 40px;`.
- Define a `.title` class for the `<h1>`: `font-size: 24px; font-weight: 600; color: #333; margin: 0 0 8px 0;` (to give the heading a slightly larger, darker treatment above the muted subtitle).
- Define a `.subtitle` class for the `<p>`: `font-size: 16px; color: #888; margin: 0;`.

**Existing navigation guard remains unchanged**
- The `useEffect` guard in `App.tsx` (lines 73-77) that redirects `currentView === 'product'` to `'metamodel'` when `includeDelivery === false` must NOT be modified.
- The Dashboard view is not subject to any navigation guard -- it is always accessible.

**No console errors when switching views**
- Switching between Dashboard, Architecture & Design, Diagrams, and Product & Delivery (when enabled) must produce zero console errors or warnings.
- The DashboardView component must be a self-contained scaffold with no external dependencies beyond React and its CSS module.

## Visual Design

No visual mockups were provided. The expected visual appearance is as follows:

**TopBar navigation area**
- The Dashboard button appears as the leftmost item in the `.viewToggle` pill group, before "Product & Delivery" (when visible) and "Architecture & Design".
- It uses the existing `.toggleButton` styling: `padding: 8px 16px`, `font-size: 14px`, `font-weight: 500`, `color: #666`, transparent background.
- When active (`currentView === 'dashboard'`), the `.active` class applies: white background, `color: #1976D2`, subtle `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1)`.

**DashboardView placeholder page**
- Full viewport height minus the 60px TopBar.
- Content is vertically and horizontally centered.
- Title "Dashboard" displayed in a larger, darker font (`#333`, ~24px).
- Subtitle "Project delivery overview (coming soon)." displayed in muted text (`#888`, 16px).
- No borders, no cards, no icons -- minimal scaffold only.

## Existing Code to Leverage

**`frontend/src/contexts/ArchitectureContext.tsx` -- State-driven view switching**
- The `currentView` union type (line 119), `SET_VIEW` action payload (line 145), and reducer case (line 484) form the established view-switching mechanism. The `'dashboard'` value is simply appended to the existing union types. No new reducer case or action type is needed.

**`frontend/src/components/TopBar/TopBar.tsx` -- Navigation button rendering**
- The `.viewToggle` div (line 933) and existing button elements (lines 935-958) define the exact pattern for navigation buttons. The new Dashboard button replicates this pattern using the same `styles.toggleButton`, `styles.active`, `handleViewChange`, and `data-testid` conventions.
- The `handleViewChange` function (line 236) already dispatches `SET_VIEW`; only its TypeScript type signature needs widening.

**`frontend/src/components/TopBar/TopBar.module.css` -- Toggle button CSS classes**
- `.viewToggle` (line 49): flex container with `gap: 4px`, gray background pill, `border-radius: 6px`.
- `.toggleButton` (line 57): shared inactive button style.
- `.toggleButton.active` (line 73): active state with white background, blue text, shadow. No new CSS is needed in TopBar.

**`frontend/src/App.tsx` -- View conditional rendering**
- Lines 118-120 demonstrate the `{state.currentView === 'xxx' && <XxxView />}` pattern used for all top-level views. The DashboardView conditional follows this identical pattern.

**`frontend/src/components/ProductView/ProductView.module.css` -- Placeholder styling pattern**
- The `.placeholder` class (lines 73-82) and `.container` class (lines 18-24) establish the visual pattern for empty-state views: flex centering, muted color `#888`, `font-size: 16px`. The DashboardView CSS module replicates this pattern.

## Out of Scope

- Any backend endpoints, gateway routes, or MCP server changes.
- Any data fetching, API calls, WebSocket connections, or mock data.
- Any persona panels, scope selector, cards layout, charts, or dashboard widgets.
- Any persistence, database changes, or new DTOs.
- Changing the default initial view from `'metamodel'` to `'dashboard'` (deferred to a future increment).
- Modifying the existing navigation guard fallback (the `product` to `metamodel` redirect when `includeDelivery` is false remains unchanged).
- Introducing URL-based routing via React Router (the existing `ArchitectureContext` state-driven view pattern is retained).
- Adding any feature-toggle gating for the Dashboard tab visibility.
- Creating unit tests (can be added in a follow-up if needed, but are not part of this scaffold increment).
- Any styling beyond the minimal centered placeholder (no layout grid, no responsive breakpoints, no dark mode).
