# Task Breakdown: Frontend Navigation Update - Product Area

## Overview
Total Tasks: 16
Estimated Complexity: Low-Medium (Frontend-only changes with new component creation)

## Summary
This spec adds a new "Product" navigation area to the application, renames "Meta-Model" to "Architecture" in the UI, and creates a basic ProductView component with Backlog/Implement tabs. All changes are frontend-only with no backend modifications.

## Task List

### State & Context Layer

#### Task Group 1: Extend Context State Type
**Dependencies:** None
**Files:** `frontend/src/contexts/ArchitectureContext.tsx`

- [x] 1.0 Complete context state type extension
  - [x] 1.1 Write 2-4 focused tests for currentView state changes
    - Test that 'product' is a valid currentView value
    - Test SET_VIEW action accepts 'product' payload
    - Test initial state defaults correctly
  - [x] 1.2 Extend AppState currentView type union
    - Location: Line 57, `AppState` interface
    - Change: `currentView: 'metamodel' | 'diagrams'` to `currentView: 'product' | 'metamodel' | 'diagrams'`
  - [x] 1.3 Extend AppAction SET_VIEW payload type
    - Location: Line 75, `AppAction` type union
    - Change: `payload: 'metamodel' | 'diagrams'` to `payload: 'product' | 'metamodel' | 'diagrams'`
  - [x] 1.4 Verify initial state default value
    - Location: Line 154, `initialState`
    - Confirm `currentView: 'metamodel'` remains default (per spec)
  - [x] 1.5 Ensure context layer tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify TypeScript compiles without errors

**Acceptance Criteria:**
- TypeScript type `'product' | 'metamodel' | 'diagrams'` is valid for currentView
- SET_VIEW action accepts 'product' as payload
- No TypeScript compilation errors
- Existing metamodel/diagrams functionality unaffected

---

### UI Components Layer

#### Task Group 2: Update TopBar Navigation
**Dependencies:** Task Group 1
**Files:** `frontend/src/components/TopBar/TopBar.tsx`

- [x] 2.0 Complete TopBar navigation updates
  - [x] 2.1 Write 3-5 focused tests for TopBar navigation changes
    - Test nav renders three buttons in order: "Product", "Architecture", "Diagrams"
    - Test clicking Product button calls `handleViewChange('product')`
    - Test "Meta-model" label changed to "Architecture"
    - Test active state styling applies correctly to each button
  - [x] 2.2 Extend handleViewChange function signature
    - Location: Line 39
    - Change: `(view: 'metamodel' | 'diagrams')` to `(view: 'product' | 'metamodel' | 'diagrams')`
  - [x] 2.3 Add Product button as first item in viewToggle div
    - Location: Lines 213-226, inside `<div className={styles.viewToggle}>`
    - Add new button BEFORE the Meta-model button
    - Pattern: Follow existing button structure
    - onClick: `() => handleViewChange('product')`
    - Active class: `state.currentView === 'product' ? styles.active : ''`
    - Label: "Product"
  - [x] 2.4 Rename "Meta-model" label to "Architecture"
    - Location: Line 218
    - Change button text from "Meta-model" to "Architecture"
    - Keep onClick as `() => handleViewChange('metamodel')` (internal value unchanged)
  - [x] 2.5 Ensure TopBar tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify button order is: Product, Architecture, Diagrams

**Acceptance Criteria:**
- Three navigation buttons render in correct order: Product, Architecture, Diagrams
- Product button triggers `SET_VIEW` action with 'product' payload
- "Architecture" label displays instead of "Meta-model"
- Active state styling works for all three buttons
- Existing navigation to metamodel and diagrams still works

---

#### Task Group 3: Create ProductView Component
**Dependencies:** Task Group 1
**Files:**
- `frontend/src/components/ProductView/ProductView.tsx` (new)
- `frontend/src/components/ProductView/ProductView.module.css` (new)

- [x] 3.0 Complete ProductView component implementation
  - [x] 3.1 Write 4-6 focused tests for ProductView component
    - Test component renders with "Product" title/header
    - Test "Backlog" and "Implement" tabs are visible
    - Test default active tab is "Backlog"
    - Test clicking "Implement" tab switches activeTab state
    - Test placeholder content displays for each tab
  - [x] 3.2 Create ProductView directory structure
    - Create directory: `frontend/src/components/ProductView/`
  - [x] 3.3 Create ProductView.module.css with tab styling
    - Copy tab styling patterns from MetaModelView.module.css
    - Include: `.container`, `.header`, `.tabBar`, `.tab`, `.activeTab`, `.content`
    - Follow existing design system conventions
  - [x] 3.4 Create ProductView.tsx component
    - Import React, useState
    - Define local state: `activeTab: 'backlog' | 'implement'` with default 'backlog'
    - Render structure:
      ```
      - container div
        - header with "Product" title
        - tab bar with Backlog and Implement buttons
        - content area with placeholder text based on activeTab
      ```
    - Backlog placeholder: "Backlog view coming next."
    - Implement placeholder: "Implement view coming next."
  - [x] 3.5 Export ProductView from component
    - Add named export: `export function ProductView()`
  - [x] 3.6 Ensure ProductView tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify component renders and tabs switch correctly

**Acceptance Criteria:**
- ProductView component renders with "Product" header
- Two tabs visible: "Backlog" and "Implement"
- Default tab is "Backlog" showing placeholder content
- Clicking tabs switches content correctly
- Styling follows MetaModelView patterns

---

#### Task Group 4: Update App.tsx View Rendering
**Dependencies:** Task Groups 2, 3
**Files:** `frontend/src/App.tsx`

- [x] 4.0 Complete App.tsx view routing updates
  - [x] 4.1 Write 2-3 focused tests for view routing
    - Test currentView 'product' renders ProductView component
    - Test currentView 'metamodel' still renders MetaModelView
    - Test currentView 'diagrams' still renders DiagramsView
  - [x] 4.2 Add ProductView import
    - Location: After existing component imports (around line 4)
    - Add: `import { ProductView } from './components/ProductView/ProductView';`
  - [x] 4.3 Update conditional rendering in AppContent
    - Location: Lines 13-18, inside `<main className="main-content">`
    - Change from ternary to multi-condition rendering:
      ```tsx
      {state.currentView === 'product' && <ProductView />}
      {state.currentView === 'metamodel' && <MetaModelView />}
      {state.currentView === 'diagrams' && <DiagramsView />}
      ```
  - [x] 4.4 Ensure App.tsx tests pass
    - Run ONLY the 2-3 tests written in 4.1
    - Verify all three views route correctly

**Acceptance Criteria:**
- ProductView renders when currentView is 'product'
- MetaModelView renders when currentView is 'metamodel'
- DiagramsView renders when currentView is 'diagrams'
- No TypeScript compilation errors
- No broken imports

---

### Testing & Validation

#### Task Group 5: Integration Testing & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete integration testing and validation
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review context state tests (Task 1.1): ~2-4 tests
    - Review TopBar tests (Task 2.1): ~3-5 tests
    - Review ProductView tests (Task 3.1): ~4-6 tests
    - Review App.tsx tests (Task 4.1): ~2-3 tests
    - Total existing: ~11-18 tests
  - [x] 5.2 Analyze integration test coverage gaps
    - Verify end-to-end navigation flow: TopBar click -> state change -> view switch
    - Verify tab switching within ProductView persists during view switches
    - Check for any missing edge cases in navigation
  - [x] 5.3 Write up to 5 additional integration tests if needed
    - E2E test: Click Product nav -> ProductView displays
    - E2E test: Click Architecture nav -> MetaModelView displays
    - E2E test: Switch to Product -> switch tabs -> switch to Diagrams -> return to Product -> verify tab state
  - [x] 5.4 Run full feature test suite
    - Run all tests related to this feature (~15-23 tests total)
    - Verify TypeScript compilation succeeds
    - Verify no console errors or warnings
  - [x] 5.5 Manual verification checklist
    - [x] Nav displays: Product, Architecture, Diagrams (in order)
    - [x] Clicking Product shows ProductView with tabs
    - [x] Backlog tab shows correct placeholder
    - [x] Implement tab shows correct placeholder
    - [x] Architecture nav still works (shows MetaModelView)
    - [x] Diagrams nav still works (shows DiagramsView)

**Acceptance Criteria:**
- All feature-specific tests pass (~15-23 tests total)
- TypeScript compiles without errors
- No console errors during runtime
- Manual verification checklist complete
- Navigation flows work end-to-end

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Context State Type** (Foundation)
   - Must be completed first as other tasks depend on the type definitions
   - Low risk, minimal code changes

2. **Task Group 2: TopBar Navigation** (Depends on TG1)
   - Requires extended type from TG1
   - Can be tested independently with state changes

3. **Task Group 3: ProductView Component** (Depends on TG1)
   - New component creation, can be developed in parallel with TG2
   - Self-contained with local state

4. **Task Group 4: App.tsx Routing** (Depends on TG2, TG3)
   - Wires everything together
   - Requires both TopBar and ProductView to be complete

5. **Task Group 5: Integration Testing** (Depends on TG1-4)
   - Final validation of all components working together
   - Fills any test coverage gaps

---

## Files Summary

| File | Action | Task Group |
|------|--------|------------|
| `frontend/src/contexts/ArchitectureContext.tsx` | Modify | 1 |
| `frontend/src/components/TopBar/TopBar.tsx` | Modify | 2 |
| `frontend/src/components/ProductView/ProductView.tsx` | Create | 3 |
| `frontend/src/components/ProductView/ProductView.module.css` | Create | 3 |
| `frontend/src/App.tsx` | Modify | 4 |

---

## Reference Patterns

### TopBar Button Pattern (from lines 214-225)
```tsx
<button
  className={`${styles.toggleButton} ${state.currentView === 'VIEW_KEY' ? styles.active : ''}`}
  onClick={() => handleViewChange('VIEW_KEY')}
>
  Button Label
</button>
```

### MetaModelView Tab Pattern (from MetaModelView.module.css)
```css
.tab {
  padding: 6px 10px;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  border-radius: 4px 4px 0 0;
}

.activeTab {
  color: #1976D2;
  border-bottom-color: #1976D2;
  background: white;
}
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TypeScript type errors | Low | Medium | Extend types incrementally, compile after each change |
| Breaking existing navigation | Low | High | Keep internal 'metamodel' value unchanged, only change label |
| Styling inconsistencies | Low | Low | Copy patterns directly from MetaModelView |
| Missing imports | Low | Low | Verify imports after each component addition |
