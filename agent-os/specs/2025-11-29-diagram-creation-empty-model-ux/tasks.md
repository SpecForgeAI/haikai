# Task Breakdown: Diagram Creation UX for Empty Models

## Overview
Total Tasks: 18

This feature improves the Diagram view user experience when working with new or empty models by:
1. Adding a clear way to create the first diagram via a name input and [+ New] button in the top toolbar
2. Blocking palette additions with a helpful warning message when no diagram exists

## Task List

### UI Layer

#### Task Group 1: Top Bar Controls for Diagram Creation
**Dependencies:** None

- [x] 1.0 Complete top bar diagram creation controls
  - [x] 1.1 Write 3-5 focused tests for top bar controls
    - Test: Input field renders with correct placeholder when no diagrams exist ("Enter diagram name...")
    - Test: Input field renders with correct placeholder when diagrams exist ("Enter new diagram name...")
    - Test: [+ New] button creates diagram when valid name is entered
    - Test: Empty name shows validation error
    - Test: Input clears after successful diagram creation
  - [x] 1.2 Update DiagramsView.tsx header layout
    - Modify the `headerBar` section to always show diagram creation controls
    - When no diagrams exist: Show disabled "No diagrams defined" placeholder in select, show name input, show [+ New] button
    - When diagrams exist: Show existing DiagramSelector dropdown, show name input, show [+ New] button
    - Reference existing layout pattern in `DiagramsView.tsx` lines 251-282
  - [x] 1.3 Leverage existing DiagramSelector component
    - The existing `DiagramSelector.tsx` already has:
      - `newDiagramName` state (line 12)
      - `handleInputChange` handler (lines 19-25)
      - `handleNewDiagram` function (lines 27-57)
      - Validation with `validateDiagramName` utility
      - Input field and [+ New] button UI
    - Determine if DiagramSelector should be refactored or if DiagramsView should directly implement controls for the empty state
  - [x] 1.4 Implement conditional rendering for empty vs populated states
    - Empty state: Show disabled select with "No diagrams defined", always show input + [+ New]
    - Populated state: Show full DiagramSelector with dropdown + input + [+ New]
    - Update DiagramsView.tsx around line 254 where `state.model.diagrams.length > 0` check exists
  - [x] 1.5 Update placeholder text based on state
    - When no diagrams: "Enter diagram name..."
    - When diagrams exist: "Enter new diagram name..."
    - Reference DiagramSelector.tsx line 118 for current placeholder
  - [x] 1.6 Ensure top bar tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify diagram creation flow works in empty and populated states
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- When no diagrams exist, top bar shows disabled placeholder selector + name input + [+ New] button
- When diagrams exist, top bar shows dropdown + name input + [+ New] button
- Placeholder text changes based on diagram count
- Newly created diagram becomes selected and canvas becomes editable

### State Management Layer

#### Task Group 2: Verify ADD_DIAGRAM Action and Active Diagram Detection
**Dependencies:** None (can run parallel with Task Group 1)

- [x] 2.0 Complete state management verification and helper
  - [x] 2.1 Write 3-4 focused tests for state management
    - Test: ADD_DIAGRAM action appends diagram to diagrams array
    - Test: ADD_DIAGRAM action sets selectedDiagramId to new diagram ID
    - Test: Helper function correctly identifies "no active diagram" state (empty array OR null selectedDiagramId)
    - Test: Helper function correctly identifies "active diagram" state (non-empty array AND valid selectedDiagramId)
  - [x] 2.2 Verify existing ADD_DIAGRAM action implementation
    - Review ArchitectureContext.tsx lines 894-909
    - Confirm action: appends to diagrams[], sets selectedDiagramId, applies default view_quarter
    - Already implemented, just verify behavior matches spec
  - [x] 2.3 Create helper function for active diagram detection
    - Create utility function: `hasActiveDiagram(diagrams: Diagram[], selectedDiagramId: string | null): boolean`
    - Logic: `diagrams.length > 0 && selectedDiagramId !== null && diagrams.some(d => d.id === selectedDiagramId)`
    - Place in appropriate utility file or export from ArchitectureContext
  - [x] 2.4 Ensure state management tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify ADD_DIAGRAM behavior and helper function
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- ADD_DIAGRAM action correctly appends and selects new diagram
- Helper function accurately detects active/inactive diagram state

### Palette Blocking Layer

#### Task Group 3: Block Palette Left-Click When No Active Diagram
**Dependencies:** Task Group 2 (needs active diagram detection helper)

- [x] 3.0 Complete palette left-click blocking
  - [x] 3.1 Write 3-4 focused tests for left-click blocking
    - Test: Left-click on palette item when no active diagram shows warning modal
    - Test: Left-click on palette item when active diagram exists adds node to diagram
    - Test: Warning modal displays correct message: "Add a new diagram before trying to add items."
    - Test: Warning modal dismisses on OK button click
  - [x] 3.2 Add active diagram check to PalettePanel.handleItemClick
    - Reference PalettePanel.tsx lines 69-100
    - Before existing check on line 76 (`if (!currentDiagramId || !diagram)`), add explicit warning behavior
    - Instead of just `console.warn`, trigger warning modal
  - [x] 3.3 Add warning modal state to PalettePanel
    - Add state: `const [showNoDiagramWarning, setShowNoDiagramWarning] = useState(false);`
    - Render Modal component (reference Modal.tsx) when warning is active
    - Message: "Add a new diagram before trying to add items."
  - [x] 3.4 Pass hasActiveDiagram prop or compute within PalettePanel
    - Option A: Compute using helper from Task Group 2 with existing `currentDiagramId` and `diagram` props
    - Option B: Pass explicit `hasActiveDiagram` boolean prop from DiagramsView
    - Update handleItemClick to check this condition and show warning
  - [x] 3.5 Ensure left-click blocking tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify warning appears when no active diagram
    - Verify normal behavior when diagram exists
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Left-click on palette item shows warning when no active diagram
- Warning modal displays correct message
- Normal add behavior works when diagram exists

#### Task Group 4: Block Palette Context Menu When No Active Diagram
**Dependencies:** Task Group 2 (needs active diagram detection helper), Task Group 3 (pattern established)

- [x] 4.0 Complete context menu blocking
  - [x] 4.1 Write 3-4 focused tests for context menu blocking
    - Test: Context menu "Add" action when no active diagram shows warning
    - Test: Context menu "Add with business processes" action when no active diagram shows warning
    - Test: Context menu "Add with app components" action when no active diagram shows warning
    - Test: Context menu actions work normally when active diagram exists
  - [x] 4.2 Add active diagram check to context menu action handlers
    - Modify PalettePanel.tsx handlers:
      - `handleContextMenuAdd` (lines 123-147)
      - `handleAddWithBusinessProcesses` (lines 175-358)
      - `handleAddWithAppComponents` (lines 362-536)
    - Each handler currently has `if (!currentDiagramId || !diagram)` check
    - Update to show warning modal instead of just console.warn
  - [x] 4.3 Reuse warning modal from Task Group 3
    - Same state and modal component handles both left-click and context menu scenarios
    - DRY principle: single warning modal, multiple triggers
  - [x] 4.4 Ensure context menu blocking tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify all context menu add actions show warning when no active diagram
    - Verify normal behavior when diagram exists
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- All context menu add actions show warning when no active diagram
- Same warning message is used consistently
- Normal context menu behavior works when diagram exists

### Visual Polish Layer

#### Task Group 5: Styling and User Feedback
**Dependencies:** Task Groups 1, 3, 4

- [x] 5.0 Complete styling and visual polish
  - [x] 5.1 Write 2-3 focused tests for visual feedback
    - Test: Disabled selector displays correctly styled "No diagrams defined" text
    - Test: Warning modal matches existing Modal styling
    - Test: [+ New] button has appropriate hover/active states
  - [x] 5.2 Style the disabled diagram selector placeholder
    - Add CSS styles to DiagramsView.module.css for disabled state
    - Visual: grayed out text, non-interactive appearance
    - Consistent with existing disabled select styling in DiagramSelector
  - [x] 5.3 Verify warning modal matches design spec
    - Reference spec visual design section
    - Modal should match existing ErrorModal pattern from Modal.tsx
    - Centered, with OK button, clean message display
  - [x] 5.4 Add validation error display for empty name
    - Reference existing pattern in DiagramSelector.tsx line 129-131
    - Display inline error: "Please enter a diagram name before creating a new diagram."
    - Style consistent with `.validationError` class
  - [x] 5.5 Ensure styling tests pass
    - Run ONLY the 2-3 tests written in 5.1
    - Verify visual consistency
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 5.1 pass
- Disabled selector looks visually distinct and non-interactive
- Warning modal is clean and matches design spec
- Validation error displays inline with consistent styling

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-5 tests written by Task Group 1 (top bar controls)
    - Review the 3-4 tests written by Task Group 2 (state management)
    - Review the 3-4 tests written by Task Group 3 (left-click blocking)
    - Review the 3-4 tests written by Task Group 4 (context menu blocking)
    - Review the 2-3 tests written by Task Group 5 (styling)
    - Total existing tests: approximately 14-20 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to empty model UX improvements
    - Do NOT assess entire application test coverage
    - Priority areas:
      - End-to-end flow: empty model -> create diagram -> add palette item
      - Edge case: selecting different diagram after creation
      - Edge case: rapid multiple diagram creation
  - [x] 6.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 20-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Critical user workflows for this feature are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Top Bar Controls** (UI Layer)
   - Can start immediately
   - Establishes the primary user-facing feature

2. **Task Group 2: State Management** (parallel with Task Group 1)
   - Verifies existing ADD_DIAGRAM action
   - Creates active diagram detection helper
   - Can run in parallel since it's mostly verification

3. **Task Group 3: Left-Click Blocking** (after Task Group 2)
   - Depends on active diagram helper
   - Core palette blocking functionality

4. **Task Group 4: Context Menu Blocking** (after Task Groups 2 and 3)
   - Reuses pattern from Task Group 3
   - Extends blocking to all add actions

5. **Task Group 5: Styling and Polish** (after Task Groups 1, 3, 4)
   - Requires UI to be functionally complete
   - Final visual adjustments

6. **Task Group 6: Test Review** (after all other groups)
   - Reviews all tests written during development
   - Fills critical gaps only

## Files to Modify

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 1, 5 | Header layout, conditional rendering |
| `frontend/src/components/DiagramsView/DiagramSelector.tsx` | 1 | Possible refactoring for empty state |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 3, 4 | Warning modal state, click handlers |
| `frontend/src/contexts/ArchitectureContext.tsx` | 2 | Helper function export (if needed) |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | 5 | Disabled selector styling |
| `frontend/src/utils/diagramUtils.ts` (new or existing) | 2 | hasActiveDiagram helper function |

## Key Code References

- **Existing ADD_DIAGRAM action**: `ArchitectureContext.tsx` lines 894-909
- **Existing diagram selector**: `DiagramSelector.tsx` lines 92-134
- **Existing validation**: `DiagramSelector.tsx` lines 27-35
- **Palette click handler**: `PalettePanel.tsx` lines 69-100
- **Context menu handlers**: `PalettePanel.tsx` lines 123-147, 175-358, 362-536
- **Modal component**: `Modal.tsx` lines 1-61
- **Empty message display**: `DiagramsView.tsx` lines 298-305
