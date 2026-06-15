# Task Breakdown: Diagram Type Authoring Increment 2 - Create & Place for ER, State, Activity Diagrams

## Overview
Total Tasks: 8 Task Groups
Feature Type: Frontend-only (React/TypeScript)

This spec extends the Diagram View RHS panel to support in-context "Create & Place" workflows for ER, State, and Activity diagram types, allowing users to create new meta-model entities and immediately place them on the active diagram.

## Task List

### Component Foundation

#### Task Group 1: CreateAndPlaceDrawer Component
**Dependencies:** None

- [ ] 1.0 Complete CreateAndPlaceDrawer component
  - [ ] 1.1 Write 2-8 focused tests for CreateAndPlaceDrawer
    - Test drawer opens with correct title
    - Test required field validation prevents submission
    - Test onSubmit callback receives correct payload
    - Test Cancel button closes drawer without submission
    - Test dropdown field renders options correctly
  - [ ] 1.2 Create CreateAndPlaceDrawer.tsx component
    - File: `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx`
    - Props: `title: string`, `fields: FieldSchema[]`, `onSubmit: (payload) => Promise<void>`, `onCancel: () => void`, `isOpen: boolean`
    - Extend existing Modal component from `components/common/Modal.tsx`
    - Follow AdvancedAddDialog.module.css styling patterns
  - [ ] 1.3 Define FieldSchema type
    - File: `frontend/src/types/createAndPlace.ts`
    - Support field types: `text` (required/optional), `dropdown` (with options array)
    - Include: `name: string`, `label: string`, `type: 'text' | 'dropdown'`, `required: boolean`, `options?: { value: string; label: string }[]`, `defaultValue?: string`
  - [ ] 1.4 Create CreateAndPlaceDrawer.module.css
    - Style form fields, buttons, and validation states
    - Match existing modal styling patterns
    - Add disabled state styling for buttons
  - [ ] 1.5 Implement form validation logic
    - Required text fields must be non-empty
    - Dropdown fields must have selection if required
    - Show inline validation error messages
    - Disable "Create & Add" button until valid
  - [ ] 1.6 Ensure CreateAndPlaceDrawer tests pass
    - Run ONLY the tests written in 1.1
    - Verify component renders and functions correctly

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- CreateAndPlaceDrawer renders with title, form fields, and action buttons
- Required field validation works correctly
- Form submission calls onSubmit with correct payload
- Cancel closes drawer without side effects

---

### Create Buttons Integration

#### Task Group 2: Create Buttons in PalettePanel by Diagram Type
**Dependencies:** Task Group 1

- [ ] 2.0 Complete Create buttons integration in PalettePanel
  - [ ] 2.1 Write 2-8 focused tests for Create buttons
    - Test ER diagram shows "+ New Logical Entity" and "+ New Physical Entity" buttons
    - Test State diagram shows "+ New State" button
    - Test Activity diagram shows "+ New Partition" and "+ New Activity" buttons
    - Test General diagram does NOT show create buttons
    - Test buttons are disabled when no diagram is selected
  - [ ] 2.2 Add Create section to PalettePanel
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Add new section above existing palette sections
    - Use `getDiagramType()` from `types/diagramType.ts` to determine diagram type
    - Conditionally render buttons based on diagram type
  - [ ] 2.3 Implement diagram type button configuration
    - Define button config: `{ ER: [...], State: [...], Activity: [...] }`
    - Each button config: `{ label: string, entityType: string, onClick: () => void }`
    - Use existing `hasActiveSelectedDiagram()` pattern for disabled state
  - [ ] 2.4 Add Create section styling
    - Update PalettePanel.module.css
    - Visual separator between Create section and Add existing sections
    - Button styling consistent with existing palette actions
  - [ ] 2.5 Wire up button click handlers to open CreateAndPlaceDrawer
    - Track which entity type create form is open via state
    - Pass appropriate field schema based on entity type
  - [ ] 2.6 Ensure Create buttons tests pass
    - Run ONLY the tests written in 2.1
    - Verify buttons appear correctly per diagram type

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Create buttons appear in correct diagram types
- Buttons disabled when no active diagram
- Clicking button opens CreateAndPlaceDrawer with correct form

---

### ER Diagram Forms

#### Task Group 3: ER Entity Create Forms (Logical/Physical Entity)
**Dependencies:** Task Groups 1, 2

- [ ] 3.0 Complete ER entity create forms
  - [ ] 3.1 Write 2-8 focused tests for ER entity creation
    - Test Logical Entity form has name (required) and description (optional) fields
    - Test Physical Entity form has name (required) and description (optional) fields
    - Test successful creation dispatches ADD_ENTITY with correct entityType
    - Test successful creation dispatches ADD_DIAGRAM_NODE
  - [ ] 3.2 Define Logical Entity field schema
    - name: required text field
    - description: optional text field
    - Reference `LogicalDataEntity` interface from `types/model.ts`
  - [ ] 3.3 Define Physical Entity field schema
    - name: required text field
    - description: optional text field
    - Reference `PhysicalDataEntity` interface from `types/model.ts`
  - [ ] 3.4 Implement createLogicalDataEntity handler
    - Generate entity ID using `generatePrefixedId('lde')`
    - Build entity object with form values
    - Dispatch ADD_ENTITY with entityType: 'logical_data_entities'
    - Return created entity for node placement
  - [ ] 3.5 Implement createPhysicalDataEntity handler
    - Generate entity ID using `generatePrefixedId('pde')`
    - Build entity object with form values
    - Dispatch ADD_ENTITY with entityType: 'physical_data_entities'
    - Return created entity for node placement
  - [ ] 3.6 Ensure ER entity creation tests pass
    - Run ONLY the tests written in 3.1
    - Verify entities are created and added to meta-model

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Logical Entity form validates and creates entity correctly
- Physical Entity form validates and creates entity correctly
- Entities appear in Meta-Model tables after creation

---

### State Diagram Form

#### Task Group 4: State Diagram Create Form
**Dependencies:** Task Groups 1, 2

- [ ] 4.0 Complete State diagram create form
  - [ ] 4.1 Write 2-8 focused tests for State creation
    - Test State form has name (required), stateKind (required dropdown), description (optional)
    - Test stateKind dropdown shows Initial/Normal/Final options
    - Test stateKind defaults to 'Normal'
    - Test successful creation dispatches ADD_ENTITY with state_kind field
  - [ ] 4.2 Define State field schema
    - name: required text field
    - stateKind: required dropdown with options `[{ value: 'Initial', label: 'Initial' }, { value: 'Normal', label: 'Normal' }, { value: 'Final', label: 'Final' }]`
    - description: optional text field
    - Default stateKind to 'Normal'
    - Reference `State` interface and `StateKind` type from `types/model.ts`
  - [ ] 4.3 Implement createState handler
    - Generate entity ID using `generatePrefixedId('state')`
    - Build entity object with form values, mapping `stateKind` to `state_kind`
    - Dispatch ADD_ENTITY with entityType: 'states'
    - Return created entity for node placement
  - [ ] 4.4 Ensure State creation tests pass
    - Run ONLY the tests written in 4.1
    - Verify State entities are created with correct state_kind

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- State form validates all required fields
- stateKind dropdown works and defaults to 'Normal'
- State entity appears in Meta-Model with correct state_kind

---

### Activity Diagram Forms

#### Task Group 5: Activity Diagram Create Forms (Activity/Partition)
**Dependencies:** Task Groups 1, 2

- [ ] 5.0 Complete Activity diagram create forms
  - [ ] 5.1 Write 2-8 focused tests for Activity/Partition creation
    - Test Activity form has name (required), activityKind (required dropdown), description (optional)
    - Test activityKind dropdown shows Initial/Action/Decision/Merge/Final options
    - Test activityKind defaults to 'Action'
    - Test Partition form has refKind (optional dropdown), refId (conditional), name (conditional), description (optional)
    - Test Partition validation: if refKind set, refId required; if no refKind, name required
  - [ ] 5.2 Define Activity field schema
    - name: required text field
    - activityKind: required dropdown with options `[{ value: 'Initial', label: 'Initial' }, { value: 'Action', label: 'Action' }, { value: 'Decision', label: 'Decision' }, { value: 'Merge', label: 'Merge' }, { value: 'Final', label: 'Final' }]`
    - description: optional text field
    - Default activityKind to 'Action'
    - Reference `Activity` interface and `ActivityKind` type from `types/model.ts`
  - [ ] 5.3 Define ActivityPartition field schema
    - refKind: optional dropdown with values from `ActivityPartitionRefKind` type: BusinessUser, Application, ApplicationComponent, Service, Interface, Class
    - refId: optional text field (becomes required if refKind set)
    - name: optional text field (becomes required if refKind not set)
    - description: optional text field
    - Implement conditional validation logic in CreateAndPlaceDrawer
  - [ ] 5.4 Implement createActivity handler
    - Generate entity ID using `generatePrefixedId('activity')`
    - Build entity object with form values, mapping `activityKind` to `activity_kind`
    - Dispatch ADD_ENTITY with entityType: 'activities'
    - Return created entity for node placement
  - [ ] 5.5 Implement createActivityPartition handler
    - Generate entity ID using `generatePrefixedId('apartition')`
    - Build entity object with form values, mapping to snake_case: `ref_kind`, `ref_id`
    - Dispatch ADD_ENTITY with entityType: 'activity_partitions'
    - Return created entity for node placement
  - [ ] 5.6 Ensure Activity/Partition creation tests pass
    - Run ONLY the tests written in 5.1
    - Verify conditional validation works correctly

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Activity form validates and creates with correct activity_kind
- Partition form enforces conditional required rules
- Both entity types appear in Meta-Model after creation

---

### Node Placement

#### Task Group 6: Node Placement and Context Updates
**Dependencies:** Task Groups 3, 4, 5

- [ ] 6.0 Complete node placement behavior
  - [ ] 6.1 Write 2-8 focused tests for node placement
    - Test new node is placed at viewport center
    - Test consecutive creates apply +40px offset to avoid overlap
    - Test new node is auto-selected after placement
    - Test ADD_DIAGRAM_NODE action is dispatched with correct node data
  - [ ] 6.2 Implement handleCreateAndPlace orchestrator function
    - File: Add to `frontend/src/components/DiagramsView/PalettePanel.tsx` or create `useCreateAndPlace.ts` hook
    - Accept entity creation callback and entity type
    - Call entity creation handler
    - Call node placement logic
    - Track consecutive create offset state
  - [ ] 6.3 Implement cascading offset logic
    - Track consecutive create count per session (reset on drawer close or diagram change)
    - Apply +40px x and y offset for each consecutive create
    - Use `getCurrentViewportCenter()` as base position
  - [ ] 6.4 Implement node creation using existing utilities
    - Use `createDiagramNodeFromEntity()` from `utils/nodeCreation.ts`
    - Pass viewport center with cascading offset
    - Use `calculateZIndex()` for proper layering
  - [ ] 6.5 Dispatch ADD_DIAGRAM_NODE action
    - Use existing `ADD_DIAGRAM_NODE` action from `ArchitectureContext.tsx`
    - Pass diagramId and node object
    - Close CreateAndPlaceDrawer on success
  - [ ] 6.6 Implement auto-select of new node
    - After node creation, dispatch selection state update
    - New node should be selected in inspector panel
  - [ ] 6.7 Ensure node placement tests pass
    - Run ONLY the tests written in 6.1
    - Verify nodes appear on canvas at correct positions

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Nodes placed at viewport center with cascading offset
- New nodes are auto-selected
- Meta-Model and diagram stay in sync

---

### Selection Inspector

#### Task Group 7: Selection Inspector for Created Entities
**Dependencies:** Task Groups 3, 4, 5, 6

- [ ] 7.0 Complete Selection Inspector integration
  - [ ] 7.1 Write 2-8 focused tests for Selection Inspector editing
    - Test LogicalDataEntity shows name and description fields
    - Test State shows name, description, and stateKind dropdown
    - Test Activity shows name, description, and activityKind dropdown
    - Test Partition shows refKind, refId, name (conditional), description
    - Test UPDATE_ENTITY is dispatched on save
  - [ ] 7.2 Extend inspector to handle new entity types
    - File: Likely `frontend/src/components/DiagramsView/InspectorPanel.tsx` or similar
    - Add cases for: LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY, STATE, ACTIVITY, ACTIVITY_PARTITION
    - Render appropriate form fields based on entity type
  - [ ] 7.3 Implement editable fields for ER entities
    - name: text input
    - description: textarea
    - Both use blur or explicit Save to persist
  - [ ] 7.4 Implement editable fields for State entity
    - name: text input
    - description: textarea
    - stateKind: dropdown (Initial/Normal/Final)
  - [ ] 7.5 Implement editable fields for Activity entity
    - name: text input
    - description: textarea
    - activityKind: dropdown (Initial/Action/Decision/Merge/Final)
  - [ ] 7.6 Implement editable fields for ActivityPartition entity
    - refKind: dropdown (optional)
    - refId: text input (required if refKind set)
    - name: text input (required if no refKind)
    - description: textarea
  - [ ] 7.7 Implement save handler using UPDATE_ENTITY
    - Dispatch UPDATE_ENTITY action from `ArchitectureContext.tsx`
    - Map form field names to entity field names (camelCase to snake_case)
    - Handle validation before save
  - [ ] 7.8 Ensure Selection Inspector tests pass
    - Run ONLY the tests written in 7.1
    - Verify inspector edits persist to context

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Inspector shows correct fields for each entity type
- Edits persist via UPDATE_ENTITY action
- Meta-Model tables reflect inspector changes

---

### Verification

#### Task Group 8: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-7

- [ ] 8.0 Review existing tests and fill critical gaps only
  - [ ] 8.1 Review tests from Task Groups 1-7
    - Review the 2-8 tests from CreateAndPlaceDrawer (Task 1.1)
    - Review the 2-8 tests from Create buttons (Task 2.1)
    - Review the 2-8 tests from ER forms (Task 3.1)
    - Review the 2-8 tests from State form (Task 4.1)
    - Review the 2-8 tests from Activity forms (Task 5.1)
    - Review the 2-8 tests from Node placement (Task 6.1)
    - Review the 2-8 tests from Selection Inspector (Task 7.1)
    - Total existing tests: approximately 14-56 tests
  - [ ] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Create & Place feature requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Check for: diagram type switching, no diagram warning, form reset on cancel
  - [ ] 8.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Example gaps to consider:
      - Full create-place-inspect workflow for each diagram type
      - Regression test for existing palette behavior
      - Create button visibility across all diagram types
  - [ ] 8.4 Run feature-specific tests only
    - Run ONLY tests related to Create & Place feature
    - Expected total: approximately 24-66 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass
  - [ ] 8.5 Manual verification checklist
    - [ ] ER diagram: create Logical Entity, verify on canvas and Meta-Model
    - [ ] ER diagram: create Physical Entity, verify on canvas and Meta-Model
    - [ ] State diagram: create State with different stateKinds
    - [ ] Activity diagram: create Activity with different activityKinds
    - [ ] Activity diagram: create Partition with refKind/refId binding
    - [ ] Activity diagram: create Partition with name only
    - [ ] Verify General diagram shows NO create buttons
    - [ ] Verify no regressions to existing palette behavior
    - [ ] Verify inspector editing works for all new entity types

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-66 tests total)
- Critical user workflows for Create & Place are covered
- No more than 10 additional tests added when filling in gaps
- No regressions to existing palette or General diagram behavior

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: CreateAndPlaceDrawer Component** - Foundation component
2. **Task Group 2: Create Buttons in PalettePanel** - Wire up buttons per diagram type
3. **Task Group 3: ER Entity Create Forms** - Implement Logical/Physical Entity forms
4. **Task Group 4: State Diagram Create Form** - Implement State form with stateKind
5. **Task Group 5: Activity Diagram Create Forms** - Implement Activity/Partition forms
6. **Task Group 6: Node Placement and Context Updates** - Wire up entity creation to node placement
7. **Task Group 7: Selection Inspector Integration** - Enable editing of created entities
8. **Task Group 8: Test Review & Gap Analysis** - Verify and fill test gaps

---

## Key Files Reference

### Existing Files to Modify
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Add Create section and buttons
- `frontend/src/components/DiagramsView/PalettePanel.module.css` - Add Create section styling
- `frontend/src/components/common/Modal.tsx` - Base for CreateAndPlaceDrawer (may extend)

### New Files to Create
- `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx` - Reusable create form drawer
- `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css` - Drawer styling
- `frontend/src/types/createAndPlace.ts` - FieldSchema and related types

### Existing Utilities to Leverage
- `frontend/src/types/diagramType.ts` - `getDiagramType()` helper
- `frontend/src/types/model.ts` - State, Activity, ActivityPartition, LogicalDataEntity, PhysicalDataEntity interfaces
- `frontend/src/utils/idGenerator.ts` - `generatePrefixedId()` for entity IDs
- `frontend/src/utils/nodeCreation.ts` - `createDiagramNodeFromEntity()`, `calculateZIndex()`
- `frontend/src/contexts/ArchitectureContext.tsx` - ADD_ENTITY, ADD_DIAGRAM_NODE, UPDATE_ENTITY actions
- `frontend/src/utils/viewportUtils.ts` - Viewport center utilities

### Entity Type to Collection Mapping
| Entity Type | Collection Name | ID Prefix |
|-------------|-----------------|-----------|
| LogicalDataEntity | logical_data_entities | lde |
| PhysicalDataEntity | physical_data_entities | pde |
| State | states | state |
| Activity | activities | activity |
| ActivityPartition | activity_partitions | apartition |

---

## Out of Scope Reminders

Per the spec, the following are explicitly OUT OF SCOPE for this increment:
- Sequence diagram editor
- Canvas rendering changes beyond placing standard nodes
- ER attribute visual nesting
- State/Activity diagram-specific rendering (swimlanes, decision diamonds)
- Backend API changes
- Drag-and-drop placement
- Edge creation (ActivityFlow, StateTransition)
- Inline renaming on canvas
