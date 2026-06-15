# Task Breakdown: UI Route Gating for Startup Feature Toggles

## Overview
Total Tasks: 18 sub-tasks across 4 task groups

This is a **frontend-only** feature that conditionally renders UI components and guards view navigation based on startup-time feature toggles (`includeDelivery`, `includeDatabase`).

## Task List

### UI Component Gating

#### Task Group 1: TopBar Navigation Gating (includeDelivery)
**Dependencies:** None

- [x] 1.0 Complete TopBar navigation gating for Product & Delivery tab
  - [x] 1.1 Write 3-4 focused tests for TopBar conditional rendering
    - Test: Product & Delivery button renders when `includeDelivery=true`
    - Test: Product & Delivery button does NOT render when `includeDelivery=false`
    - Test: Architecture & Design and Diagrams buttons always render regardless of toggle
    - Test: Navigation still works correctly for visible buttons when toggle is false
  - [x] 1.2 Import `useIncludeDelivery` hook in TopBar.tsx
    - Import from `../../contexts/AppConfigContext`
    - Call hook at component top level: `const includeDelivery = useIncludeDelivery();`
  - [x] 1.3 Wrap Product & Delivery button with conditional rendering
    - Use `{includeDelivery && <button>...}` pattern (NOT CSS hiding)
    - Target button with `data-testid="product-nav-button"` in `div.viewToggle`
    - Preserve all existing button props and styling when rendered
  - [x] 1.4 Ensure TopBar tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify conditional rendering works correctly

**Acceptance Criteria:**
- Product & Delivery button is completely absent from DOM when `includeDelivery=false`
- Product & Delivery button renders normally when `includeDelivery=true`
- No visual artifacts or layout shifts when button is hidden
- Other navigation buttons unaffected

---

#### Task Group 2: FileMenu Gating (includeDatabase)
**Dependencies:** None (can run parallel to Task Group 1)

- [x] 2.0 Complete FileMenu gating for database-dependent menu items
  - [x] 2.1 Write 4-6 focused tests for FileMenu conditional rendering
    - Test: All menu items render when `includeDatabase=true`
    - Test: Create, Open, Save, Save As, Delete items do NOT render when `includeDatabase=false`
    - Test: Import as JSON, Export as JSON, Import as XLSX, Export as XLSX items render when `includeDatabase=false`
    - Test: Separator is removed when all DB items are hidden (no orphaned separator)
    - Test: Menu closes correctly after clicking any visible item
    - Test: Menu keyboard navigation works with reduced item set
  - [x] 2.2 Import `useIncludeDatabase` hook in FileMenu.tsx
    - Import from `../../contexts/AppConfigContext`
    - Call hook at component top level: `const includeDatabase = useIncludeDatabase();`
  - [x] 2.3 Wrap database-dependent menu items with conditional rendering
    - Items to conditionally render: Create, Open, Save, Save As, Delete
    - Use `{includeDatabase && <div>...}` pattern for each item
    - Target test IDs: `project-menu-create`, `project-menu-open`, `project-menu-save`, `project-menu-save-as`, `project-menu-delete`
  - [x] 2.4 Handle separator visibility
    - The separator divides DB actions from file actions
    - When `includeDatabase=false`, remove the separator to avoid orphaned visual element
    - Use `{includeDatabase && <div className={styles.separator} />}` pattern
  - [x] 2.5 Verify file-only menu items always render
    - Import as JSON (`project-menu-import-json`)
    - Export as JSON (`project-menu-export-json`)
    - Import as XLSX (`project-menu-import-xlsx`)
    - Export as XLSX (`project-menu-export-xlsx`)
    - These items must render regardless of `includeDatabase` value
  - [x] 2.6 Ensure FileMenu tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify all conditional rendering scenarios work correctly

**Acceptance Criteria:**
- DB menu items (Create, Open, Save, Save As, Delete) completely absent from DOM when `includeDatabase=false`
- File menu items (Import/Export JSON/XLSX) always render regardless of toggle
- Separator removed when DB items are hidden (clean visual appearance)
- No orphaned separators or visual artifacts
- Menu functions correctly in file-only mode

---

### View Guard Logic

#### Task Group 3: View Navigation Guard
**Dependencies:** Task Group 1 (TopBar gating should be in place first)

- [x] 3.0 Complete view navigation guard in App.tsx
  - [x] 3.1 Write 4-5 focused tests for view guard logic
    - Test: When `includeDelivery=false` and `currentView='product'`, view redirects to `'metamodel'`
    - Test: When `includeDelivery=true`, no redirect occurs for any view
    - Test: When `includeDelivery=false` and view is `'metamodel'` or `'diagrams'`, no redirect occurs
    - Test: Redirect does not cause infinite loop (only triggers once)
    - Test: Initial app load with `includeDelivery=false` starts at `'metamodel'` not `'product'`
  - [x] 3.2 Import required hooks in App.tsx
    - Import `useIncludeDelivery` from `./contexts/AppConfigContext`
    - Import `useEffect` from React (already likely imported)
    - Import `useArchitectureDispatch` (already imported via context)
  - [x] 3.3 Implement view guard in AppContent component
    - Add `const includeDelivery = useIncludeDelivery();` at top of AppContent
    - Add `const dispatch = useArchitectureDispatch();` (or use existing)
    - Add `useEffect` hook that watches `includeDelivery` and `state.currentView`
    - Guard logic:
      ```typescript
      useEffect(() => {
        if (!includeDelivery && state.currentView === 'product') {
          dispatch({ type: 'SET_VIEW', payload: 'metamodel' });
        }
      }, [includeDelivery, state.currentView, dispatch]);
      ```
  - [x] 3.4 Ensure deterministic redirect behavior
    - Redirect should only fire when conditions are met
    - No infinite loops (setting to 'metamodel' when already 'metamodel' is a no-op)
    - Effect dependencies are correctly specified
  - [x] 3.5 Ensure view guard tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify redirect logic works correctly in all scenarios

**Acceptance Criteria:**
- Navigating to `'product'` view when `includeDelivery=false` redirects to `'metamodel'`
- No redirect occurs when `includeDelivery=true`
- No redirect for allowed views (`'metamodel'`, `'diagrams'`) when toggle is false
- No infinite loops or flickering
- Initial load respects toggle (starts at `'metamodel'` if delivery disabled)

---

### Integration Testing

#### Task Group 4: Mixed-Mode Integration & Test Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests and verify all mixed-mode combinations
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3-4 tests written in Task 1.1 (TopBar gating) - in `TopBar.navigation-gating.test.tsx`
    - Review the 4-6 tests written in Task 2.1 (FileMenu gating) - in `FileMenu.database-gating.test.tsx`
    - Review the 4-5 tests written in Task 3.1 (view guard) - in `view-navigation-guard.test.tsx`
    - Total existing tests: 33 tests (9 TopBar + 15 FileMenu + 9 View Guard)
  - [x] 4.2 Analyze test coverage gaps for mixed-mode combinations
    - Configuration `(true, true)`: Full platform - verify all features work
    - Configuration `(true, false)`: Delivery UI + file-only menu
    - Configuration `(false, true)`: Architecture-only UI + full menu
    - Configuration `(false, false)`: Architecture-only UI + file-only menu
    - Focus on integration points between toggle checks
  - [x] 4.3 Write up to 6 additional integration tests if needed
    - Test: `(true, false)` - Product & Delivery visible, DB menu items hidden
    - Test: `(false, true)` - Product & Delivery hidden, all menu items visible
    - Test: `(false, false)` - Both restrictions applied correctly
    - Test: View guard + TopBar consistency (hidden button + blocked navigation)
    - Test: No UI indicators reveal gated features (no tooltips, badges, etc.)
    - Test: App state remains consistent across toggle combinations
    - Created `feature-toggle-integration.test.tsx` with 15 integration tests
  - [x] 4.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature
    - Final total: 48 tests (9 TopBar + 15 FileMenu + 9 View Guard + 15 Integration)
    - All mixed-mode combinations verified working correctly
    - All 48 tests pass

**Acceptance Criteria:**
- All four toggle combinations work correctly:
  - `(true, true)`: Full platform, no gating
  - `(true, false)`: Delivery UI present, DB menu items removed
  - `(false, true)`: Architecture-only UI, DB menu items present
  - `(false, false)`: Architecture-only UI, file-only menu
- No UI indicators of gated features (no tooltips, badges, greyed-out buttons)
- All feature-specific tests pass (approximately 17-21 tests total)
- UI appears complete to user with available features

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: TopBar Navigation Gating** - Independent, can start immediately
2. **Task Group 2: FileMenu Gating** - Independent, can run parallel to Group 1
3. **Task Group 3: View Navigation Guard** - Depends on Group 1 for consistent UX
4. **Task Group 4: Integration Testing** - Depends on Groups 1-3 being complete

**Parallelization opportunities:**
- Task Groups 1 and 2 can be developed in parallel by different engineers
- Task Group 3 should wait for Group 1 to ensure TopBar and guard are consistent
- Task Group 4 is the final verification phase

---

## Files to Modify

| File | Task Group | Changes |
|------|------------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | 1 | Add `useIncludeDelivery` hook, wrap Product & Delivery button |
| `frontend/src/components/TopBar/FileMenu.tsx` | 2 | Add `useIncludeDatabase` hook, wrap DB menu items and separator |
| `frontend/src/App.tsx` | 3 | Add view guard `useEffect` in AppContent |

## Test Files Created

| File | Task Group | Tests |
|------|------------|-------|
| `frontend/src/__tests__/TopBar.navigation-gating.test.tsx` | 1 | 9 tests |
| `frontend/src/__tests__/FileMenu.database-gating.test.tsx` | 2 | 15 tests |
| `frontend/src/__tests__/view-navigation-guard.test.tsx` | 3 | 9 tests |
| `frontend/src/__tests__/feature-toggle-integration.test.tsx` | 4 | 15 tests |

## Existing Code to Leverage

- **AppConfigContext.tsx**: Provides `useIncludeDelivery()` and `useIncludeDatabase()` hooks - already implemented
- **ArchitectureContext.tsx**: Provides `currentView` state and `SET_VIEW` action - already implemented
- **TopBar.tsx**: Contains navigation buttons in `div.viewToggle` - modify existing structure
- **FileMenu.tsx**: Contains all Project menu items - modify existing structure
- **App.tsx**: Contains `AppContent` component with view rendering - add guard hook

## Out of Scope

- Backend configuration or database changes
- URL-based routing (app uses state-based navigation)
- Runtime toggle changes (toggles are startup-only)
- Any visual indicators, mode labels, or tooltips about disabled features
- Authentication or authorization logic
- Feature toggle admin UI
