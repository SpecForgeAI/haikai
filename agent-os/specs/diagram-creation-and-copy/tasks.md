# Task Breakdown: Diagram Creation and Copy

## Overview
Total Tasks: 23

## Task List

### State Management Layer

#### Task Group 1: Reducer and Action Implementation
**Dependencies:** None

- [x] 1.0 Complete state management for diagram creation
  - [x] 1.1 Write 4 focused tests for ADD_DIAGRAM reducer action
    - Test adding diagram updates diagrams array
    - Test adding diagram sets selectedDiagramId to new diagram
    - Test immutable state update pattern
    - Test adding diagram preserves existing diagrams
  - [x] 1.2 Add ADD_DIAGRAM action type to AppAction union in ArchitectureContext.tsx
    - Action type: `{ type: 'ADD_DIAGRAM'; payload: Diagram }`
    - Import Diagram type from `../types/model`
    - Add to existing AppAction union at line ~18
  - [x] 1.3 Implement ADD_DIAGRAM case in appReducer function
    - Push new diagram to `state.model.diagrams` array using spread operator
    - Set `selectedDiagramId` to new diagram's id
    - Follow immutable pattern from ADD_ENTITY case (lines 111-126)
    - Return updated state with new diagrams array
  - [x] 1.4 Ensure state management tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify reducer handles action correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- ADD_DIAGRAM action type is properly typed
- Reducer correctly adds diagram to array
- selectedDiagramId is updated to new diagram

**Files to modify:**
- `frontend/src/contexts/ArchitectureContext.tsx`

---

### Validation Logic Layer

#### Task Group 2: Name Validation Utility Functions
**Dependencies:** None (can run parallel with Task Group 1)

- [x] 2.0 Complete validation logic for diagram names
  - [x] 2.1 Write 5 focused tests for diagram name validation
    - Test empty name after trim returns error message
    - Test whitespace-only name returns error message
    - Test duplicate name returns error message
    - Test valid unique name returns null (no error)
    - Test case-sensitive duplicate detection
  - [x] 2.2 Create validation function in new or existing utility file
    - Function signature: `validateDiagramName(name: string, existingDiagrams: Diagram[]): string | null`
    - Trim whitespace from input name
    - Return "Please enter a name for the new diagram." if empty after trim
    - Return "A diagram with this name already exists. Please choose a different name." if duplicate
    - Return null if valid
    - Location: `frontend/src/utils/validation.ts` (existing file)
  - [x] 2.3 Export validation function from utils
    - Add export to validation.ts
    - Ensure proper TypeScript typing
  - [x] 2.4 Ensure validation tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify all validation scenarios work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Empty/whitespace names are rejected with correct message
- Duplicate names are rejected with correct message
- Valid unique names return null

**Files to modify:**
- `frontend/src/utils/validation.ts`

---

### UI Component Layer

#### Task Group 3: DiagramSelector Component Enhancement
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete UI components for diagram creation and copy
  - [x] 3.1 Write 6 focused tests for DiagramSelector component
    - Test text input renders and accepts user input
    - Test [+ New] button creates empty diagram with valid name
    - Test [+ Copy] button creates copy of selected diagram
    - Test validation error displays for empty name
    - Test validation error displays for duplicate name
    - Test input clears after successful creation
  - [x] 3.2 Expand DiagramSelector component to include new UI elements
    - Add "Diagram:" label before dropdown
    - Keep existing dropdown select element
    - Add " - New Diagram " text label after dropdown
    - Add text input field for new diagram name
    - Add [+ New] button using Button component with secondary variant
    - Add [+ Copy] button using Button component with secondary variant
    - Use existing hooks: `useArchitecture()` and `useArchitectureDispatch()`
    - Import Button from `../common/Button`
    - Import `generatePrefixedId` from `../../utils/idGenerator`
    - Import validation function from `../../utils/validation`
  - [x] 3.3 Add local state for text input and validation error
    - `const [newDiagramName, setNewDiagramName] = useState('')`
    - `const [validationError, setValidationError] = useState<string | null>(null)`
    - Clear validation error when input changes
  - [x] 3.4 Implement handleNewDiagram function for [+ New] button
    - Trim input name
    - Call validation function with existing diagrams
    - If validation fails, set error state and return
    - Generate ID using `generatePrefixedId('diag')`
    - Create new Diagram object with empty values:
      - id: generated
      - name: from trimmed input
      - description: ""
      - diagram_type: ""
      - settings: {}
      - diagram_nodes: []
      - diagram_edges: []
    - Dispatch ADD_DIAGRAM action with new diagram
    - Clear input field
    - Clear validation error
  - [x] 3.5 Implement handleCopyDiagram function for [+ Copy] button
    - Trim input name
    - Call validation function with existing diagrams
    - If validation fails, set error state and return
    - Get currently selected diagram from state
    - Generate new ID using `generatePrefixedId('diag')`
    - Create deep copy using JSON.parse(JSON.stringify()) or structured clone
    - Update copied diagram with new id and name
    - Dispatch ADD_DIAGRAM action with copied diagram
    - Clear input field
    - Clear validation error
  - [x] 3.6 Display validation error message
    - Show error below input or as inline message
    - Use simple span/div with error styling
    - Clear error when user modifies input
  - [x] 3.7 Ensure UI component tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify all UI interactions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- All UI elements render on same horizontal row
- Buttons trigger correct actions
- Validation errors display appropriately
- Input clears after successful operation
- New diagram appears in dropdown immediately

**Files to modify:**
- `frontend/src/components/DiagramsView/DiagramSelector.tsx`

---

### CSS Styling Layer

#### Task Group 4: Component Styling
**Dependencies:** Task Group 3

- [x] 4.0 Complete styling for new UI elements
  - [x] 4.1 Write 2 visual/style verification tests
    - Test all selector elements align horizontally
    - Test input has minimum 150px width
  - [x] 4.2 Add CSS classes to DiagramsView.module.css
    - `.diagramInput` class for text input field
      - Match `.selector` padding: 8px 12px
      - Match `.selector` border: 1px solid #ddd
      - Match `.selector` border-radius: 4px
      - Match `.selector` font-size: 14px
      - Set min-width: 150px
      - Set background: white
    - `.newDiagramLabel` class for " - New Diagram " text
      - font-size: 14px
      - color: #666
      - white-space: nowrap
    - `.validationError` class for error messages
      - color: #d32f2f (red)
      - font-size: 12px
      - margin-left: 8px
  - [x] 4.3 Update .selectorContainer styles if needed
    - Ensure flex-wrap: nowrap to prevent wrapping
    - Adjust gap if needed for new elements
    - All elements must stay on same horizontal row
  - [x] 4.4 Apply CSS classes to DiagramSelector component
    - Apply .diagramInput to text input
    - Apply .newDiagramLabel to separator text
    - Apply .validationError to error message element
  - [x] 4.5 Ensure styling tests pass
    - Run ONLY the 2 tests written in 4.1
    - Verify visual alignment and sizing
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2 tests written in 4.1 pass
- Input matches existing selector styling
- All elements align horizontally without wrapping
- Error messages are clearly visible in red
- Consistent visual appearance with existing UI

**Files to modify:**
- `frontend/src/components/DiagramsView/DiagramsView.module.css`
- `frontend/src/components/DiagramsView/DiagramSelector.tsx`

---

### Integration Testing Layer

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests written by state management (Task 1.1)
    - Review the 5 tests written by validation logic (Task 2.1)
    - Review the 6 tests written by UI component (Task 3.1)
    - Review the 2 tests written by styling (Task 4.1)
    - Total existing tests: approximately 17 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to diagram creation and copy
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 6 additional strategic tests maximum
    - Test complete flow: enter name -> click New -> verify diagram in dropdown
    - Test complete flow: enter name -> click Copy -> verify copied content
    - Test copy preserves all diagram_nodes with positions
    - Test copy preserves all diagram_edges with edge_points
    - Test new diagram displays empty canvas
    - Test Save JSON includes newly created diagrams
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to diagram creation and copy feature
    - Expected total: approximately 23 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23 tests total)
- Critical user workflows for diagram creation and copy are covered
- No more than 6 additional tests added when filling in gaps
- Deep copy functionality verified (nodes, edges, edge_points)
- Model persistence verified in Save JSON output

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Reducer and Action Implementation** - Foundation for state changes
2. **Task Group 2: Name Validation Utility Functions** - Can run parallel with Group 1
3. **Task Group 3: DiagramSelector Component Enhancement** - Depends on Groups 1 and 2
4. **Task Group 4: Component Styling** - Depends on Group 3
5. **Task Group 5: Test Review and Gap Analysis** - Final integration verification

## Technical Notes

### Key Files Reference
- **ArchitectureContext.tsx**: `frontend/src/contexts/ArchitectureContext.tsx` - Add ADD_DIAGRAM action
- **DiagramSelector.tsx**: `frontend/src/components/DiagramsView/DiagramSelector.tsx` - Main component to enhance
- **idGenerator.ts**: `frontend/src/utils/idGenerator.ts` - Use `generatePrefixedId('diag')`
- **validation.ts**: `frontend/src/utils/validation.ts` - Add diagram name validation
- **DiagramsView.module.css**: `frontend/src/components/DiagramsView/DiagramsView.module.css` - Add new CSS classes
- **model.ts**: `frontend/src/types/model.ts` - Diagram interface reference (lines 214-222)
- **Button.tsx**: `frontend/src/components/common/Button.tsx` - Reusable button component

### Diagram Object Structure
```typescript
interface Diagram {
  id: string;
  name: string;
  description: string;
  diagram_type?: string;
  settings?: Record<string, unknown>;
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
}
```

### ID Generation Pattern
Use existing pattern from idGenerator.ts:
```typescript
const newId = generatePrefixedId('diag');
// Returns: "diag-{timestamp}-{random}"
```

### Deep Copy Strategy
For copying diagrams with all nested data:
```typescript
const copiedDiagram = JSON.parse(JSON.stringify(selectedDiagram));
copiedDiagram.id = generatePrefixedId('diag');
copiedDiagram.name = trimmedName;
```
