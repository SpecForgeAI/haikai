# Task Breakdown: Dashboard Increment 1 -- Add Top-Level Dashboard Tab + Route (UI Scaffold Only)

## Overview
Total Tasks: 12 (across 2 task groups)

This is a small, UI-only frontend change. No backend, gateway, or MCP server changes are needed. The changes are tightly coupled through the view-switching pipeline: context type extension -> TopBar navigation button -> App.tsx conditional render -> new DashboardView component. The work is split into two groups: (1) wiring the Dashboard view into the existing navigation infrastructure, and (2) creating the new DashboardView component and its styles.

## Task List

### Frontend -- Navigation Wiring

#### Task Group 1: Extend View Type, TopBar Button, and App.tsx Rendering
**Dependencies:** None

- [x] 1.0 Complete navigation wiring for Dashboard view
  - [x] 1.1 Write 4 focused tests for Dashboard navigation behavior
    - Test 1: Verify that `currentView` accepts `'dashboard'` as a valid value in the ArchitectureContext state type (dispatch `SET_VIEW` with `'dashboard'` and assert state updates).
    - Test 2: Verify the Dashboard nav button renders in the TopBar with `data-testid="dashboard-nav-button"` and label text "Dashboard".
    - Test 3: Verify clicking the Dashboard nav button dispatches `SET_VIEW` with payload `'dashboard'` and the button receives the active class.
    - Test 4: Verify that `App.tsx` renders `<DashboardView />` when `currentView === 'dashboard'` and does NOT render it when `currentView` is any other value.
    - Place test file at: `frontend/src/__tests__/dashboard-increment-1-navigation.test.tsx`
    - Use Vitest + React Testing Library (consistent with existing test files in `frontend/src/__tests__/`).
  - [x] 1.2 Extend `currentView` union type in ArchitectureContext
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Line 119: Change `currentView: 'product' | 'metamodel' | 'diagrams'` to `currentView: 'product' | 'metamodel' | 'diagrams' | 'dashboard'`
    - Line 145: Change `SET_VIEW` payload from `'product' | 'metamodel' | 'diagrams'` to `'product' | 'metamodel' | 'diagrams' | 'dashboard'`
    - Do NOT change the initial state on line 247 (`currentView: 'metamodel'` must remain as-is).
    - No reducer logic change needed (line 484 already assigns `action.payload` generically).
  - [x] 1.3 Extend `handleViewChange` type signature and add Dashboard button to TopBar
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Line 236: Extend `handleViewChange` parameter type from `(view: 'product' | 'metamodel' | 'diagrams')` to `(view: 'product' | 'metamodel' | 'diagrams' | 'dashboard')`.
    - In the `.viewToggle` div (line 933), insert a new `<button>` as the FIRST child, BEFORE the `{includeDelivery && (...)}` Product & Delivery block (line 935).
    - Button attributes:
      - `className={`${styles.toggleButton} ${state.currentView === 'dashboard' ? styles.active : ''}`}`
      - `onClick={() => handleViewChange('dashboard')}`
      - `data-testid="dashboard-nav-button"`
      - Label text: `Dashboard`
    - The button must always be visible (no feature-toggle gating).
    - No new CSS needed in TopBar -- reuse existing `.toggleButton` and `.active` classes.
  - [x] 1.4 Add conditional rendering for DashboardView in App.tsx
    - File: `frontend/src/App.tsx`
    - Add import at top: `import { DashboardView } from './components/DashboardView/DashboardView';`
    - In the `<main className="main-content">` block (lines 116-121), add `{state.currentView === 'dashboard' && <DashboardView />}` as the FIRST conditional, before the existing `product`, `metamodel`, and `diagrams` lines.
    - Do NOT modify the existing `useEffect` navigation guard (lines 73-77) that redirects `product` to `metamodel` when `includeDelivery` is false.
  - [x] 1.5 Ensure navigation wiring tests pass
    - Run ONLY the 4 tests written in 1.1: `npx vitest run frontend/src/__tests__/dashboard-increment-1-navigation.test.tsx`
    - Verify all 4 tests pass.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `'dashboard'` is a valid value in the `currentView` union type and `SET_VIEW` action payload
- A "Dashboard" button appears as the first item in the TopBar `.viewToggle` nav, before "Product & Delivery"
- The Dashboard button is always visible (not gated by any feature toggle)
- Clicking Dashboard dispatches `SET_VIEW` with `'dashboard'` and the button shows active styling
- `App.tsx` renders `<DashboardView />` when `currentView === 'dashboard'`
- The default initial view remains `'metamodel'` (unchanged)
- The existing `product` -> `metamodel` navigation guard is untouched

### Frontend -- DashboardView Component

#### Task Group 2: Create DashboardView Placeholder Component and Styles
**Dependencies:** Task Group 1 (App.tsx imports DashboardView, so the component must exist)

- [x] 2.0 Complete DashboardView placeholder component
  - [x] 2.1 Write 3 focused tests for DashboardView component
    - Test 1: Verify `DashboardView` renders a container with `data-testid="dashboard-view"`.
    - Test 2: Verify the component renders an `<h1>` with text "Dashboard".
    - Test 3: Verify the component renders a `<p>` with text "Project delivery overview (coming soon)."
    - Place test file at: `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx`
    - Use Vitest + React Testing Library.
  - [x] 2.2 Create DashboardView CSS module
    - Create directory: `frontend/src/components/DashboardView/`
    - Create file: `frontend/src/components/DashboardView/DashboardView.module.css`
    - Define `.container` class: `display: flex; flex-direction: column; height: calc(100vh - 60px);` (matches ProductView container pattern for full-height views beneath the 60px TopBar).
    - Define `.placeholder` class: `flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #888; font-size: 16px; padding: 40px;`
    - Define `.title` class: `font-size: 24px; font-weight: 600; color: #333; margin: 0 0 8px 0;`
    - Define `.subtitle` class: `font-size: 16px; color: #888; margin: 0;`
  - [x] 2.3 Create DashboardView component
    - Create file: `frontend/src/components/DashboardView/DashboardView.tsx`
    - Named export: `export const DashboardView: React.FC`
    - Import the CSS module: `import styles from './DashboardView.module.css';`
    - Render structure:
      - Outer `<div>` with `className={styles.container}` and `data-testid="dashboard-view"`
      - Inner `<div>` with `className={styles.placeholder}`
      - `<h1>` with `className={styles.title}` and text "Dashboard"
      - `<p>` with `className={styles.subtitle}` and text "Project delivery overview (coming soon)."
    - No external dependencies beyond React and the CSS module.
    - No props, no state, no hooks, no API calls.
  - [x] 2.4 Ensure DashboardView tests pass
    - Run ONLY the 3 tests written in 2.1: `npx vitest run frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx`
    - Verify all 3 tests pass.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- `DashboardView` renders a centered placeholder with title "Dashboard" and subtitle "Project delivery overview (coming soon)."
- The component uses CSS module classes for styling (`.container`, `.placeholder`, `.title`, `.subtitle`)
- The container takes full viewport height minus the 60px TopBar
- The component has `data-testid="dashboard-view"` on the outer container
- No console errors or warnings when the component renders
- The component is self-contained with no external dependencies beyond React and its CSS module

### Verification

#### Task Group 3: Final Verification
**Dependencies:** Task Groups 1-2

- [x] 3.0 Run all feature tests and verify end-to-end behavior
  - [x] 3.1 Run all Dashboard Increment 1 tests together
    - Run: `npx vitest run frontend/src/__tests__/dashboard-increment-1-navigation.test.tsx frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx`
    - All 7 tests (4 from Task 1.1 + 3 from Task 2.1) must pass.
    - Do NOT run the entire application test suite.
  - [x] 3.2 Verify no TypeScript compilation errors
    - Run: `npx tsc --noEmit` from the `frontend/` directory.
    - Ensure zero type errors related to the `'dashboard'` view type, DashboardView import, or any modified files.
  - [x] 3.3 Manual smoke test (if applicable)
    - Start the dev server and navigate between all views: Dashboard, Product & Delivery (when enabled), Architecture & Design, Diagrams.
    - Confirm zero console errors or warnings when switching views.
    - Confirm the Dashboard button appears first in the nav pill group.
    - Confirm the Dashboard placeholder page shows centered title and subtitle.

**Acceptance Criteria:**
- All 7 feature-specific tests pass
- Zero TypeScript compilation errors
- View switching between all four views produces no console errors
- The Dashboard button appears as the leftmost nav item
- The DashboardView placeholder renders correctly with centered content

## Execution Order

Recommended implementation sequence:
1. **Task Group 2** (Create DashboardView component and CSS) -- create the component first so that imports in App.tsx resolve.
2. **Task Group 1** (Navigation wiring: context type, TopBar button, App.tsx render) -- wire the new component into the navigation system.
3. **Task Group 3** (Final verification) -- run all tests together and verify end-to-end.

Note: While Task Group 1 is listed first for logical readability (it describes the flow from context -> TopBar -> App), the implementation should start with Task Group 2 so that the `DashboardView` import in App.tsx (Task 1.4) resolves without error. Alternatively, both groups can be implemented in listed order if Task 1.4 is done last.

## Files Modified / Created Summary

| File | Action | Task |
|------|--------|------|
| `frontend/src/contexts/ArchitectureContext.tsx` | Modify (extend type unions) | 1.2 |
| `frontend/src/components/TopBar/TopBar.tsx` | Modify (type signature + new button) | 1.3 |
| `frontend/src/App.tsx` | Modify (import + conditional render) | 1.4 |
| `frontend/src/components/DashboardView/DashboardView.module.css` | Create | 2.2 |
| `frontend/src/components/DashboardView/DashboardView.tsx` | Create | 2.3 |
| `frontend/src/__tests__/dashboard-increment-1-navigation.test.tsx` | Create | 1.1 |
| `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx` | Create | 2.1 |
