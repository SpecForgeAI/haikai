# Task Breakdown: UI Screen Editor MetaModel Wiring Fix

## Overview
Total Tasks: 9

This is a minimal bugfix specification. The UIScreenDiagramEditorPanel component already accepts a `metaModel` prop and derives dropdown data from it, but DiagramsView.tsx fails to pass this prop. The fix is a single-line addition.

## Task List

### Frontend Wiring

#### Task Group 1: Wire metaModel Prop to UIScreenDiagramEditorPanel
**Dependencies:** None

- [x] 1.0 Complete metaModel prop wiring
  - [x] 1.1 Add metaModel prop to UIScreenDiagramEditorPanel in DiagramsView.tsx
    - Location: `frontend/src/components/DiagramsView/DiagramsView.tsx` around line 2373
    - Current code renders `<UIScreenDiagramEditorPanel diagram={diagram} onUpdateDiagram={handleUpdateDiagramById} />`
    - Add `metaModel={state.model.metaModel}` to the props
    - Follow the pattern used by SequenceEditorPanel (line 2370) and PalettePanel (line 2381)
  - [x] 1.2 Verify no TypeScript errors after change
    - Run `npm run type-check` or equivalent to confirm prop types match
    - UIScreenDiagramEditorPanel already declares `metaModel?: MetaModel | null` in its interface (line 41)

**Acceptance Criteria:**
- UIScreenDiagramEditorPanel receives `metaModel={state.model.metaModel}` prop
- No TypeScript compilation errors
- Pattern matches SequenceEditorPanel and PalettePanel wiring

### Verification

#### Task Group 2: Verify Downstream Component Data Flow
**Dependencies:** Task Group 1

- [x] 2.0 Complete verification of data propagation
  - [x] 2.1 Verify uiScreensList derivation in UIScreenDiagramEditorPanel
    - Confirm lines 111-114 derive UIScreen[] from `metaModel.entities.ui_screens`
    - Confirm this list is passed to OverviewTab (line ~285) and AddActionModal (line ~329)
    - No code changes required - verify existing logic works with wired metaModel
  - [x] 2.2 Verify AddActionModal receives metaModel for Interface/Endpoint picker
    - Confirm AddActionModal already receives `metaModel` prop from UIScreenDiagramEditorPanel
    - Confirm InterfaceEndpointPicker uses `metaModel.entities.interfaces` and `metaModel.entities.endpoints`
    - No code changes required - verify existing wiring
  - [x] 2.3 Manual verification of dropdown population
    - Start the frontend application
    - Create or open a UI_SCREEN diagram
    - Verify "Associated UIScreen" dropdown in OverviewTab shows project UIScreens
    - Verify AddActionModal Navigate target dropdown shows UIScreens
    - Verify AddActionModal Call API interface dropdown shows Interfaces

**Acceptance Criteria:**
- OverviewTab dropdown populates with UIScreens from metaModel
- AddActionModal Navigate dropdown populates with UIScreens
- AddActionModal Call API interface dropdown populates with Interfaces
- No filtering applied - all project entities visible regardless of domain context

### Testing

#### Task Group 3: Regression Tests for Dropdown Population
**Dependencies:** Task Group 1

- [x] 3.0 Complete regression test suite
  - [x] 3.1 Write 4-6 focused tests for dropdown population
    - Create test file: `frontend/src/__tests__/ui-screen-editor-dropdowns-populate.test.tsx`
    - Test 1: OverviewTab dropdown receives UIScreens from metaModel
    - Test 2: AddActionModal Navigate dropdown receives UIScreens
    - Test 3: AddActionModal Call API dropdown receives Interfaces
    - Test 4: Empty metaModel gracefully shows empty dropdowns (no crash)
    - Test 5: Full metaModel with multiple UIScreens shows all items
    - Test 6 (optional): Verify no domain filtering applied
  - [x] 3.2 Create test fixtures with mock metaModel data
    - Mock metaModel with test UIScreens (2-3 items)
    - Mock metaModel with test Interfaces (2-3 items)
    - Mock metaModel with test Endpoints (2-3 items)
    - Mock ArchitectureContext with model.metaModel containing fixtures
  - [x] 3.3 Run regression tests
    - Execute: `npm test -- --testPathPattern="ui-screen-editor-dropdowns-populate"`
    - Verify all tests pass
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- All 4-6 regression tests pass
- Tests verify UIScreen dropdown population in OverviewTab
- Tests verify UIScreen dropdown population in AddActionModal Navigate picker
- Tests verify Interface dropdown population in AddActionModal Call API picker
- Tests verify graceful handling of null/empty metaModel

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Wire metaModel Prop** - Single-line fix in DiagramsView.tsx
2. **Task Group 2: Verification** - Confirm downstream components receive data correctly
3. **Task Group 3: Regression Tests** - Add automated tests to prevent future regressions

## Code References

### Files to Modify
| File | Change |
|------|--------|
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Add `metaModel={state.model.metaModel}` prop (line ~2373) |

### Files to Create
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/ui-screen-editor-dropdowns-populate.test.tsx` | Regression tests |

### Reference Files (No Changes Required)
| File | Reference For |
|------|---------------|
| `frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx` | Prop interface (line 41), uiScreensList derivation (lines 111-114) |
| `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.tsx` | allUIScreens derivation (lines 77-84) |
| `frontend/src/components/DiagramsView/UIScreenEditor/InterfaceEndpointPicker.tsx` | Interface/endpoint filtering (lines 41-52) |

## Notes

- This is a **frontend-only** fix - no backend changes required
- The fix is a **single line addition** - the downstream component logic is already correct
- The metaModel must be the **full project metaModel**, not domain-filtered
- All UIScreens and Interfaces must be visible regardless of current view context
