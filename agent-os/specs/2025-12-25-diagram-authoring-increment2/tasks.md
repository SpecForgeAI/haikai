# Task Breakdown: Diagram Type Authoring Increment 2 - Create & Place for ER, State, Activity Diagrams

## Overview
Total Tasks: 28 sub-tasks across 4 task groups

This is a **frontend-only feature** that extends the Diagram View RHS panel to support in-context "Create & Place" workflows for ER, State, and Activity diagram types. The feature allows users to create new meta-model entities directly from the Diagram View and immediately place them on the active diagram.

## Task List

### UI Components Layer

#### Task Group 1: CreateAndPlaceDrawer Component and Create Section UI
**Dependencies:** None

- [x] 1.0 Complete CreateAndPlaceDrawer component and Create Section buttons
  - [x] 1.1 Write 4-6 focused tests for CreateAndPlaceDrawer component
    - Test drawer opens/closes correctly with isOpen prop
    - Test form renders correct fields based on entity type (State, Activity, ActivityPartition, LogicalDataEntity, PhysicalDataEntity)
    - Test required field validation prevents submission with empty required fields
    - Test "Create & Add" button triggers onSubmit callback with form data
    - Test "Cancel" button triggers onClose callback
    - Test dropdown fields render correct options (StateKind, ActivityKind, ActivityPartitionRefKind)
  - [x] 1.2 Create CreateAndPlaceDrawer component
    - File: `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx`
    - Props interface: `{ isOpen: boolean; onClose: () => void; title: string; entityType: string; onSubmit: (formData: Record<string, unknown>) => Promise<void> }`
    - Extend or wrap existing Modal component (`components/common/Modal.tsx`)
    - Support dynamic field rendering based on entityType
    - Include "Create & Add" primary button and "Cancel" secondary button
  - [x] 1.3 Implement form field configurations for each entity type
    - State fields: name (required text), stateKind (required dropdown: Initial|Normal|Final, default: Normal), description (optional text)
    - Activity fields: name (required text), activityKind (required dropdown: Initial|Action|Decision|Merge|Final, default: Action), description (optional text)
    - ActivityPartition fields: refKind (optional dropdown), refId (conditional typeahead), name (conditional required text), description (optional text)
    - LogicalDataEntity fields: name (required text), description (optional text), tags (optional text)
    - PhysicalDataEntity fields: name (required text), description (optional text), physical_type (optional text), database (optional text), tags (optional text)
  - [x] 1.4 Create CreateAndPlaceDrawer CSS module
    - File: `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css`
    - Follow existing Modal.module.css patterns for overlay, header, content, footer
    - Add form-specific styles for field layout, labels, inputs, dropdowns
    - Style primary ("Create & Add") and secondary ("Cancel") buttons
  - [x] 1.5 Add Create Section to PalettePanel for ER, State, Activity diagram types
    - Modify `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Add conditional rendering based on `getDiagramType(fullDiagram)` result
    - ER diagrams: Show "+ New Logical Entity" and "+ New Physical Entity" buttons
    - State diagrams: Show "+ New State" button
    - Activity diagrams: Show "+ New Partition" and "+ New Activity" buttons
    - Create Section appears above existing "Add Existing" palette sections
    - Buttons disabled when `!hasActiveSelectedDiagram()`
  - [x] 1.6 Add Create Section styles to PalettePanel CSS
    - Modify `frontend/src/components/DiagramsView/PalettePanel.module.css`
    - Add `.createSection` class with clear visual separation from palette sections
    - Style create buttons with distinct appearance from palette items
    - Add disabled state styling for buttons
  - [x] 1.7 Ensure CreateAndPlaceDrawer tests pass
    - Run ONLY the tests written in 1.1
    - Verify component renders and behaves correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- CreateAndPlaceDrawer component renders with dynamic fields based on entity type
- Form validation prevents submission with empty required fields
- Create Section buttons appear conditionally based on diagram type
- Buttons are disabled when no diagram is selected
- The 4-6 tests from 1.1 pass

---

### Entity Creation and State Update Layer

#### Task Group 2: Entity Creation Flow and Node Placement
**Dependencies:** Task Group 1

- [x] 2.0 Complete entity creation flow and auto-node placement
  - [x] 2.1 Write 4-6 focused tests for entity creation and node placement
    - Test clicking Create Section button opens drawer with correct entity type
    - Test successful form submission dispatches ADD_ENTITY action with generated ID
    - Test successful entity creation dispatches ADD_DIAGRAM_NODE action
    - Test new node positioned at viewport center using getCurrentViewportCenter()
    - Test cascade offset (+40px x/y) applied for consecutive creates
    - Test new node is auto-selected after placement
  - [x] 2.2 Implement Create Section button click handlers in PalettePanel
    - Add state for drawer visibility and selected entity type: `useState<{ isOpen: boolean; entityType: string | null }>`
    - Wire "+ New Logical Entity" button to open drawer with entityType 'LOGICAL_DATA_ENTITY'
    - Wire "+ New Physical Entity" button to open drawer with entityType 'PHYSICAL_DATA_ENTITY'
    - Wire "+ New State" button to open drawer with entityType 'STATE'
    - Wire "+ New Activity" button to open drawer with entityType 'ACTIVITY'
    - Wire "+ New Partition" button to open drawer with entityType 'ACTIVITY_PARTITION'
  - [x] 2.3 Implement entity creation submission handler
    - Create `handleCreateAndPlace` callback in PalettePanel
    - Generate entity ID using `generatePrefixedId()` from `utils/idGenerator.ts`
    - Build entity object from form data with proper type structure
    - Dispatch ADD_ENTITY action via `useArchitectureDispatch()`
    - Map entityType to EntityType constant (e.g., 'STATE' -> 'states')
  - [x] 2.4 Implement node placement after entity creation
    - After successful ADD_ENTITY dispatch, create DiagramNode for new entity
    - Use `createDiagramNodeFromEntity()` from `utils/nodeCreation.ts`
    - Pass `getCurrentViewportCenter()` for viewport-centered positioning
    - Track consecutive create count to apply cascade offset (+40px x/y)
    - Dispatch ADD_DIAGRAM_NODE action with new node
  - [x] 2.5 Add auto-selection of newly created node
    - After ADD_DIAGRAM_NODE dispatch, trigger node selection
    - Use existing selection mechanism (dispatch or direct state update)
    - Ensures inspector panel shows the new entity for immediate editing
  - [x] 2.6 Add cascade offset tracking for consecutive creates
    - Add state to track last create position: `useState<{ x: number; y: number; count: number }>`
    - Reset count when diagram changes or after user interaction
    - Apply offset: `viewportCenter.x + (count * 40)`, `viewportCenter.y + (count * 40)`
  - [x] 2.7 Ensure entity creation flow tests pass
    - Run ONLY the tests written in 2.1
    - Verify entity creation and node placement work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Clicking Create Section buttons opens drawer with correct form fields
- Form submission creates entity in meta-model state (ADD_ENTITY)
- New node is placed at viewport center with cascade offset
- New node is automatically selected after placement
- The 4-6 tests from 2.1 pass

---

### Selection Inspector Layer

#### Task Group 3: Selection Inspector for Created Entities
**Dependencies:** Task Group 2

- [x] 3.0 Complete Selection Inspector for ER, State, Activity entities
  - [x] 3.1 Write 4-6 focused tests for Selection Inspector
    - Test inspector shows editable fields when State node is selected
    - Test inspector shows editable fields when Activity node is selected
    - Test inspector shows editable fields when ActivityPartition node is selected
    - Test inspector shows editable fields when LogicalDataEntity/PhysicalDataEntity node is selected
    - Test save on blur triggers UPDATE_ENTITY dispatch with updated values
    - Test dropdown changes update entity correctly
  - [x] 3.2 Extend InspectorPanel to detect new entity types for editing
    - Modify `frontend/src/components/DiagramsView/InspectorPanel.tsx` (or create if not exists)
    - Detect selected node's entity_type from diagram state
    - Check for entity_type in {LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY, STATE, ACTIVITY, ACTIVITY_PARTITION}
    - Show editable form when entity type matches
  - [x] 3.3 Implement editable fields for State entities
    - name: text input
    - description: textarea
    - stateKind: dropdown (Initial|Normal|Final)
    - Lookup State entity from metaModel.entities.states by entity_id
  - [x] 3.4 Implement editable fields for Activity entities
    - name: text input
    - description: textarea
    - activityKind: dropdown (Initial|Action|Decision|Merge|Final)
    - Lookup Activity entity from metaModel.entities.activities by entity_id
  - [x] 3.5 Implement editable fields for ActivityPartition entities
    - name: text input (conditional required - required if refKind not set)
    - refKind: dropdown (BusinessUser|Application|ApplicationComponent|Service|Interface|Class)
    - refId: selector/typeahead (required if refKind is set)
    - description: textarea
    - Lookup ActivityPartition from metaModel.entities.activity_partitions by entity_id
  - [x] 3.6 Implement editable fields for LogicalDataEntity and PhysicalDataEntity
    - name: text input (required)
    - description: textarea
    - Lookup from respective entity arrays in metaModel.entities
  - [x] 3.7 Implement save mechanism with UPDATE_ENTITY dispatch
    - Save on blur of text fields
    - Save on dropdown change
    - Optionally add explicit "Save" button
    - Dispatch UPDATE_ENTITY with entityType and updated entity object
    - Ensure changes sync to ArchitectureContext so Meta-Model tables reflect updates
  - [x] 3.8 Ensure Selection Inspector tests pass
    - Run ONLY the tests written in 3.1
    - Verify inspector displays and saves entity data correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Inspector shows editable fields for State, Activity, ActivityPartition, LogicalDataEntity, PhysicalDataEntity
- All form fields correctly bound to entity data
- Save on blur/change updates meta-model state via UPDATE_ENTITY
- The 4-6 tests from 3.1 pass

---

### Test Review and Integration Layer

#### Task Group 4: Test Review, Gap Analysis, and Integration Testing
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests from Task 1.1 (CreateAndPlaceDrawer)
    - Review the 4-6 tests from Task 2.1 (Entity Creation Flow)
    - Review the 4-6 tests from Task 3.1 (Selection Inspector)
    - Total existing tests: approximately 12-18 tests
  - [x] 4.2 Analyze test coverage gaps for this feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration between drawer -> entity creation -> node placement -> inspector
    - Check for edge cases in conditional field validation (ActivityPartition refKind/name)
    - Verify diagram type detection correctly filters Create Section visibility
  - [x] 4.3 Write up to 10 additional strategic tests
    - Integration test: Full create flow from button click to node on diagram
    - Integration test: Edit entity via inspector, verify meta-model update
    - Edge case: ActivityPartition with refKind set requires refId
    - Edge case: ActivityPartition without refKind requires name
    - Edge case: Cascade offset resets after diagram change
    - Diagram type test: ER diagram shows correct Create Section buttons
    - Diagram type test: State diagram shows correct Create Section buttons
    - Diagram type test: Activity diagram shows correct Create Section buttons
    - Disabled state test: Buttons disabled when no diagram selected
    - Error handling: Form validation error display
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this feature (from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 22-28 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-28 tests total)
- Critical end-to-end workflows for Create & Place are covered
- No more than 10 additional tests added in gap analysis
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: UI Components Layer** - CreateAndPlaceDrawer and Create Section UI
   - Foundation for user interaction
   - No dependencies on other groups

2. **Task Group 2: Entity Creation and State Update Layer** - Creation flow and node placement
   - Depends on Task Group 1 for drawer component
   - Implements core business logic

3. **Task Group 3: Selection Inspector Layer** - Inspector for editing created entities
   - Depends on Task Group 2 for entities to exist
   - Completes the authoring workflow

4. **Task Group 4: Test Review and Integration** - Gap analysis and integration tests
   - Depends on all previous groups
   - Ensures quality and coverage

---

## Key Files to Create/Modify

### New Files
- `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx`
- `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css`
- `frontend/src/components/DiagramsView/SelectionInspector.tsx`
- `frontend/src/components/DiagramsView/SelectionInspector.module.css`
- `frontend/src/__tests__/create-and-place-drawer.test.ts`
- `frontend/src/__tests__/create-and-place-flow.test.ts`
- `frontend/src/__tests__/selection-inspector-editable.test.ts`
- `frontend/src/__tests__/create-and-place-integration.test.ts`

### Modified Files
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Add Create Section with conditional buttons, integrate SelectionInspector
- `frontend/src/components/DiagramsView/PalettePanel.module.css` - Add Create Section styles
- `frontend/src/components/DiagramsView/DiagramsView.tsx` - Add handleUpdateEntity callback, pass new props to PalettePanel

---

## Existing Code to Leverage

| Pattern/Utility | Location | Usage |
|-----------------|----------|-------|
| getDiagramType() | `types/diagramType.ts` | Detect diagram type for conditional Create Section |
| generatePrefixedId() | `utils/idGenerator.ts` | Generate IDs for new entities |
| createDiagramNodeFromEntity() | `utils/nodeCreation.ts` | Create DiagramNode for new entity |
| getCurrentViewportCenter() | PalettePanel.tsx | Get viewport center for node positioning |
| ADD_ENTITY action | ArchitectureContext.tsx | Dispatch new entity to meta-model |
| ADD_DIAGRAM_NODE action | ArchitectureContext.tsx | Add node to diagram |
| UPDATE_ENTITY action | ArchitectureContext.tsx | Update entity from inspector |
| Modal component | `components/common/Modal.tsx` | Base for CreateAndPlaceDrawer |
| StateKind type | `types/model.ts` | Dropdown values for State entity |
| ActivityKind type | `types/model.ts` | Dropdown values for Activity entity |
| ActivityPartitionRefKind type | `types/model.ts` | Dropdown values for ActivityPartition entity |
| hasActiveSelectedDiagram() | PalettePanel.tsx | Check for button disabled state |

---

## Notes

- This is a **frontend-only feature** - backend CRUD endpoints already exist for all entity types
- The CreateAndPlaceDrawer should be **reusable** across all diagram types
- Node placement uses **viewport center** with **cascade offset** for multiple creates
- Inspector edits update **both diagram and meta-model state**
- **Out of scope**: Sequence diagrams, drag-and-drop placement, undo/redo, attribute editing, entity deletion from inspector
