# Task Breakdown: Process Activities

## Overview
Total Tasks: 7 Task Groups with approximately 45 sub-tasks

This feature introduces ProcessActivity as a first-class entity in the architecture meta-model, enabling architects to decompose Business Processes into constituent activities with full support for CRUD operations, diagram visualization with containment, and visual styling based on user input amount.

## Task List

### Task Group 1: Meta-model Schema Layer
**Dependencies:** None
**Files:** `frontend/src/types/model.ts`, `frontend/src/config/defaults.ts`

- [x] 1.0 Complete meta-model schema layer
  - [x] 1.1 Write 4-6 focused tests for ProcessActivity interface and type definitions
    - Test ProcessActivity interface structure matches spec
    - Test ActorHint type union contains all 8 values
    - Test UserInputAmount type union contains all 4 values
    - Test ENTITY_TYPES includes PROCESS_ACTIVITY
    - Test MetaModelEntities includes process_activities array
    - Test AnyEntity union includes ProcessActivity
  - [x] 1.2 Add ActorHint type union to model.ts
    - Values: END_USER, EXTERNAL_USER, INTERNAL_SYSTEM, EXTERNAL_SYSTEM, HYBRID_USER_SYSTEM, BATCH_JOB, BOT_OR_RPA, OTHER
    - Follow existing ApplicationPointKind pattern
  - [x] 1.3 Add UserInputAmount type union to model.ts
    - Values: NA, MINIMAL, MODERATE, SIGNIFICANT
  - [x] 1.4 Add ProcessActivity interface to model.ts
    - Fields: id, business_process_id, name, description, sequence_order, actor_hint, is_manual, user_input_amount, tags, valid_from, valid_to
    - Follow existing BusinessProcess interface pattern
  - [x] 1.5 Add PROCESS_ACTIVITY to ENTITY_TYPES const
    - Add `PROCESS_ACTIVITY: 'PROCESS_ACTIVITY'` entry
    - DiagramEntityType will automatically include via typeof inference
  - [x] 1.6 Add 'process_activities' to EntityType union
    - Update EntityType type definition
  - [x] 1.7 Update MetaModelEntities interface
    - Add `process_activities: ProcessActivity[]`
  - [x] 1.8 Update AnyEntity union type
    - Add `| ProcessActivity` to union
  - [x] 1.9 Update emptyModel in defaults.ts
    - Add `process_activities: []` to metaModel.entities
  - [x] 1.10 Add actorHintOptions array to defaults.ts
    - Array of 8 ActorHint values for dropdown
  - [x] 1.11 Add userInputAmountOptions array to defaults.ts
    - Array of 4 UserInputAmount values for dropdown
  - [x] 1.12 Ensure schema layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- ProcessActivity interface matches spec exactly
- ActorHint and UserInputAmount types contain correct values
- ENTITY_TYPES.PROCESS_ACTIVITY exists
- MetaModelEntities.process_activities is typed correctly
- emptyModel includes empty process_activities array
- TypeScript compilation passes

---

### Task Group 2: Validation Layer
**Dependencies:** Task Group 1
**Files:** `frontend/src/utils/validation.ts`, `frontend/src/config/gridConfigs.ts`

- [x] 2.0 Complete validation layer
  - [x] 2.1 Write 6-8 focused tests for ProcessActivity validation rules
    - Test business_process_id FK validation (must exist)
    - Test name required validation
    - Test name uniqueness within same business_process_id (scoped uniqueness)
    - Test is_manual=false requires user_input_amount="NA"
    - Test is_manual=true requires user_input_amount!="NA"
    - Test error message format matches spec pattern
  - [x] 2.2 Add 'process_activities' to ENTITY_TYPE_DISPLAY_NAMES
    - Map `'process_activities': 'PROCESS_ACTIVITY'`
  - [x] 2.3 Add process_activities to entityTypes array in validateModel
    - Add 'process_activities' to the validation loop
  - [x] 2.4 Add PROCESS_ACTIVITY to entityTypeMap
    - Map `PROCESS_ACTIVITY: 'process_activities'`
  - [x] 2.5 Implement scoped name uniqueness validation for ProcessActivity
    - Create validateScopedUniqueName function
    - Check name uniqueness within same business_process_id only
    - Generate error: `PROCESS_ACTIVITY ['Activity Name'] has a duplicate name within the same Business Process`
  - [x] 2.6 Implement is_manual/user_input_amount constraint validation
    - Create validateProcessActivityConstraints function
    - If is_manual=false and user_input_amount!="NA": error
    - If is_manual=true and user_input_amount="NA": error
    - Error message: `PROCESS_ACTIVITY ['Activity Name'] requires user_input_amount to be MINIMAL, MODERATE, or SIGNIFICANT when is_manual is true`
  - [x] 2.7 Add ProcessActivity validation to validateModel function
    - Call scoped uniqueness validation
    - Call is_manual/user_input_amount constraint validation
    - Include in standard required fields and FK reference validation
  - [x] 2.8 Ensure validation layer tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all validation rules work correctly

**Acceptance Criteria:**
- business_process_id FK validation works
- name required validation works
- Scoped name uniqueness (within process) validation works
- is_manual/user_input_amount constraint validation works
- Error messages follow existing pattern format
- All validation tests pass

---

### Task Group 3: Meta-model UI Layer
**Dependencies:** Task Groups 1, 2
**Files:** `frontend/src/config/gridConfigs.ts`, Grid component files, Header/Tab component files

- [x] 3.0 Complete meta-model UI layer
  - [x] 3.1 Write 4-6 focused tests for Activities grid and header grouping
    - Test Activities grid configuration has all required columns
    - Test User Input Amount field disabled when Is Manual = false
    - Test User Input Amount field enabled when Is Manual = true
    - Test header bar shows grouping with | separators
    - Test Activities tab appears after Processes in Business group
  - [x] 3.2 Add process_activities grid configuration to gridConfigs.ts
    - ID: text, required, autoGenerate, width: 120
    - Business Process: fk_typeahead to business_processes, required, width: 180
    - Name: text, required, width: 180
    - Description: text, optional, width: 200
    - Sequence Order: numeric, optional, width: 100
    - Actor Hint: dropdown with actorHintOptions, required, width: 140
    - Is Manual: boolean, required, width: 80
    - User Input Amount: dropdown with userInputAmountOptions, required, width: 140, conditionalDisable
  - [x] 3.3 Add 'Activities' to tabToEntityType mapping
    - Map `'Activities': 'process_activities'`
  - [x] 3.4 Update entityTabNames array
    - Insert 'Activities' after 'Processes' in the array
    - New order: Users, Processes, Activities, Applications, App Components, Services, ...
  - [x] 3.5 Update header bar component for domain grouping
    - Add CSS styling for | separator between groups
    - Group 1 (Business): Users | Processes | Activities
    - Group 2 (Application): Applications | App Components | Services
    - Group 3 (Data): Logical Entities | Logical Attributes | Physical Entities | Physical Attributes
  - [x] 3.6 Implement conditional disable for User Input Amount field
    - When Is Manual = false: disable field, auto-set to "NA"
    - When Is Manual = true: enable field, require non-"NA" value
    - Implement onChange handler in grid cell component
  - [x] 3.7 Wire up Activities grid to process_activities data
    - Ensure CRUD operations work (add, edit, delete rows)
    - Ensure inline editing works for all fields
    - Ensure validation errors display correctly
  - [x] 3.8 Ensure meta-model UI tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify grid configuration and conditional behaviour work

**Acceptance Criteria:**
- Activities tab appears in header bar under Business group
- Header shows visual grouping with | separators
- Activities grid has all specified columns with correct types
- User Input Amount field conditionally disabled based on Is Manual
- CRUD operations work for ProcessActivity entities
- Validation errors display correctly

---

### Task Group 4: Diagram Node Type Layer
**Dependencies:** Task Groups 1, 2
**Files:** `frontend/src/config/defaults.ts`, `frontend/src/utils/rendering.ts`, node creation utilities

- [x] 4.0 Complete diagram node type layer
  - [x] 4.1 Write 4-6 focused tests for PROCESS_ACTIVITY node type
    - Test entityColors includes PROCESS_ACTIVITY entry
    - Test getProcessActivityDefaultFill returns correct colour for each user_input_amount value
    - Test PROCESS_ACTIVITY node renders with correct label
    - Test PROCESS_ACTIVITY node background colour based on user_input_amount
    - Test inspector colour override takes precedence over default
  - [x] 4.2 Add PROCESS_ACTIVITY entry to entityColors in defaults.ts
    - background: '#f5f5f5' (default for NA)
    - border: '#616161' (consistent with business domain)
  - [x] 4.3 Create getProcessActivityDefaultFill helper function
    - Input: ProcessActivity entity
    - Return colour based on user_input_amount:
      - NA: '#f5f5f5' (light grey)
      - MINIMAL: '#c8e6c9' (light green)
      - MODERATE: '#ffe0b2' (light orange)
      - SIGNIFICANT: '#ffcdd2' (light red)
    - Add to defaults.ts or create new processActivityColors.ts utility
  - [x] 4.4 Update rendering functions to handle PROCESS_ACTIVITY
    - Add case for PROCESS_ACTIVITY in node rendering switch
    - Apply default fill from getProcessActivityDefaultFill
    - Respect background_color override from DiagramNode if set
    - Node label = process_activity.name
  - [x] 4.5 Update node creation utilities for PROCESS_ACTIVITY
    - Add PROCESS_ACTIVITY case to node creation logic
    - Set parent_node_id to Business Process diagram node when activity is added
    - Apply default dimensions suitable for activity box
  - [x] 4.6 Ensure containment via parent_node_id works
    - Verify existing containment mechanism handles PROCESS_ACTIVITY
    - Child activities move with parent when parent is dragged
  - [x] 4.7 Ensure diagram node type tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify node creation and rendering work correctly

**Acceptance Criteria:**
- PROCESS_ACTIVITY has correct default colours in entityColors
- getProcessActivityDefaultFill returns correct colour per user_input_amount
- PROCESS_ACTIVITY nodes render with correct label and colours
- Inspector colour override works (precedence over defaults)
- Containment works (activities move with parent process)

---

### Task Group 5: Palette Integration Layer
**Dependencies:** Task Groups 1, 4
**Files:** `frontend/src/utils/paletteData.ts`, `frontend/src/components/DiagramsView/PalettePanel.tsx`, `frontend/src/utils/compoundLayout.ts`

- [x] 5.0 Complete palette integration layer
  - [x] 5.1 Write 6-8 focused tests for palette section and add behaviours
    - Test Process Activities section appears in palette after Business Processes
    - Test palette row disabled when activity already on diagram
    - Test palette row shows tooltip "Already on diagram" when disabled
    - Test left-click adds activity to diagram
    - Test auto-create parent process when parent not on diagram
    - Test "Add with process activities" creates process + all activities
    - Test activities stack vertically with 5px gaps inside process
  - [x] 5.2 Add process_activities section to getPaletteSections in paletteData.ts
    - Insert after business_processes section
    - id: 'process_activities'
    - label: 'Process Activities'
    - items: metaModel.entities.process_activities
    - type: 'entity'
  - [x] 5.3 Update getEntityTypeConstant mapping
    - Add `process_activities: ENTITY_TYPES.PROCESS_ACTIVITY`
  - [x] 5.4 Implement palette row enable/disable logic for Process Activities
    - Row disabled when PROCESS_ACTIVITY node exists for that entity_id on current diagram
    - Disabled row shows tooltip "Already on diagram"
  - [x] 5.5 Implement left-click add for Process Activity
    - If parent process node present: add activity inside, adjust process box size
    - If parent process node not present: auto-create process at viewport centre, add activity inside
    - Apply stacking layout rules (5px gaps, 5px padding)
  - [x] 5.6 Implement right-click context menu for Process Activity rows
    - Show context menu with "Add" option
    - "Add" behaviour same as left-click
  - [x] 5.7 Add "Add with process activities" to Business Process context menu
    - New option in Business Process row context menu
    - Behaviour:
      1. Create process node if not present (viewport centre)
      2. Find all process_activities where business_process_id matches
      3. Create PROCESS_ACTIVITY node for each (filter out already-on-diagram)
      4. Apply vertical stacking layout inside process box
      5. Size process box to contain all activities with padding
  - [x] 5.8 Create findProcessActivities helper in compoundLayout.ts
    - Follow findAppComponents pattern
    - Input: metaModel, businessProcessId
    - Return: ProcessActivity[] for that process
  - [x] 5.9 Implement compound layout for activities inside process
    - Stack activities vertically with 5px gaps
    - 5px left/right padding from process box border
    - Activity height: 5px padding + text height + 5px padding
    - Process box auto-sizes to contain all activities
    - Reuse calculateChildPositionWithHeights and calculateParentSizeWithHeights
  - [x] 5.10 Refresh palette state after adding nodes
    - Newly-added activity rows become disabled
    - Trigger palette re-render with updated diagram state
  - [x] 5.11 Ensure palette integration tests pass
    - Run ONLY the 6-8 tests written in 5.1
    - Verify palette section and add behaviours work correctly

**Acceptance Criteria:**
- Process Activities section appears in palette after Business Processes
- Rows correctly disabled/enabled based on diagram presence
- Left-click adds activity (auto-creates parent if needed)
- Right-click context menu with "Add" works
- "Add with process activities" creates process + all activities
- Activities stack vertically with correct gaps and padding
- Palette refreshes after adding nodes

---

### Task Group 6: Inspector and JSON Layer
**Dependencies:** Task Groups 1, 4, 5
**Files:** `frontend/src/utils/fileOperations.ts`, Inspector component, Canvas.tsx

- [x] 6.0 Complete inspector and JSON layer
  - [x] 6.1 Write 4-6 focused tests for inspector and JSON compatibility
    - Test PROCESS_ACTIVITY node selectable on canvas
    - Test inspector panel shows styling options for selected activity node
    - Test JSON save includes process_activities array
    - Test JSON load restores process_activities correctly
    - Test backward compatibility (missing process_activities defaults to [])
  - [x] 6.2 Ensure PROCESS_ACTIVITY nodes work with inspector panel
    - Selection with resize handles
    - Styling options: font size, font weight, font style, text alignment
    - Colour options: background colour, border colour, text colour
    - Verify existing inspector code handles new node type
  - [x] 6.3 Verify canvas operations work for PROCESS_ACTIVITY
    - Selection (single and multi-select)
    - Drag/move (including group movement)
    - Resize
    - Delete
    - Undo/redo
  - [x] 6.4 Verify containment movement works
    - When parent process is moved, child activities move together
    - When parent process is resized, activities remain positioned correctly
  - [x] 6.5 Ensure JSON save includes process_activities
    - Verify process_activities array saved in metaModel.entities
    - Verify PROCESS_ACTIVITY diagram nodes saved with entity_type, entity_id, parent_node_id, styling
  - [x] 6.6 Ensure JSON load restores process_activities
    - Load process_activities array from JSON
    - Restore PROCESS_ACTIVITY diagram nodes with all properties
    - Handle missing process_activities (default to empty array)
  - [x] 6.7 Ensure inspector and JSON tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify inspector and JSON roundtrip work correctly

**Acceptance Criteria:**
- PROCESS_ACTIVITY nodes selectable with resize handles
- Inspector shows all styling options for activity nodes
- All canvas operations work (drag, resize, delete, undo/redo)
- Containment movement works (children move with parent)
- JSON save/load roundtrip preserves all data
- Backward compatible with missing process_activities

---

### Task Group 7: End-to-End Testing and Verification
**Dependencies:** Task Groups 1-6
**Files:** Test files, all modified files

- [x] 7.0 Complete end-to-end testing and verification
  - [x] 7.1 Review all tests from Task Groups 1-6
    - Tests from Group 1 (4-6 schema tests)
    - Tests from Group 2 (6-8 validation tests)
    - Tests from Group 3 (4-6 UI tests)
    - Tests from Group 4 (4-6 node type tests)
    - Tests from Group 5 (6-8 palette tests)
    - Tests from Group 6 (4-6 inspector/JSON tests)
    - Total: approximately 28-40 feature-specific tests
  - [x] 7.2 Analyze test coverage gaps for Process Activities feature
    - Identify critical user workflows lacking coverage
    - Focus on integration points between components
    - Prioritize end-to-end workflows
  - [x] 7.3 Write up to 10 additional integration tests if needed
    - Full workflow: create process activity in grid, add to diagram, style, save, reload
    - Workflow: add activity when process not on diagram (auto-create)
    - Workflow: "Add with process activities" bulk add
    - Workflow: colour based on user_input_amount
    - Workflow: is_manual/user_input_amount constraint in grid
  - [x] 7.4 Run TypeScript compilation check
    - `npx tsc --noEmit`
    - Verify no type errors
  - [x] 7.5 Run all feature-specific tests
    - Run tests from Groups 1-6 plus new integration tests
    - Verify all pass
  - [x] 7.6 Manual verification checklist
    - [x] Activities tab appears in header under Business group
    - [x] Header shows | separators between domain groups
    - [x] Can add ProcessActivity in grid with all fields
    - [x] User Input Amount disabled when Is Manual = false
    - [x] Validation errors show correctly
    - [x] Process Activities section appears in palette
    - [x] Left-click adds activity to diagram
    - [x] Parent process auto-created when not on diagram
    - [x] "Add with process activities" works from Business Process context menu
    - [x] Activities stack vertically inside process box
    - [x] Activity colours reflect user_input_amount
    - [x] Inspector colour override works
    - [x] Canvas operations work (select, drag, resize, delete)
    - [x] Containment movement works
    - [x] JSON save/load roundtrip works
  - [x] 7.7 Fix any identified issues
    - Address test failures
    - Fix type errors
    - Resolve integration issues

**Acceptance Criteria:**
- All feature-specific tests pass (28-50 tests total)
- TypeScript compilation succeeds with no errors
- Manual verification checklist completed
- All critical user workflows work correctly
- No regressions in existing functionality

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Meta-model Schema Layer** (No dependencies)
   - Foundation for all other work
   - Defines types, interfaces, and constants

2. **Task Group 2: Validation Layer** (Depends on Group 1)
   - Validation rules needed before UI work
   - Error messages and constraint checking

3. **Task Group 3: Meta-model UI Layer** (Depends on Groups 1, 2)
   - Grid configuration and Activities tab
   - Header bar grouping with separators
   - Conditional field behaviour

4. **Task Group 4: Diagram Node Type Layer** (Depends on Groups 1, 2)
   - Can be done in parallel with Group 3
   - Node colours and rendering
   - Node creation utilities

5. **Task Group 5: Palette Integration Layer** (Depends on Groups 1, 4)
   - Palette section and add behaviours
   - Compound layout for containment
   - Context menu enhancements

6. **Task Group 6: Inspector and JSON Layer** (Depends on Groups 1, 4, 5)
   - Inspector panel integration
   - JSON save/load compatibility
   - Canvas operations verification

7. **Task Group 7: End-to-End Testing** (Depends on Groups 1-6)
   - Test review and gap analysis
   - Integration testing
   - Final verification

---

## Technical Reference

### ActorHint Values
- END_USER
- EXTERNAL_USER
- INTERNAL_SYSTEM
- EXTERNAL_SYSTEM
- HYBRID_USER_SYSTEM
- BATCH_JOB
- BOT_OR_RPA
- OTHER

### UserInputAmount Values and Colours
| Value | Colour | Hex |
|-------|--------|-----|
| NA | Light grey | #f5f5f5 |
| MINIMAL | Light green | #c8e6c9 |
| MODERATE | Light orange | #ffe0b2 |
| SIGNIFICANT | Light red | #ffcdd2 |

### Layout Constants
- Activity gap: 5px vertical between activities
- Activity padding: 5px left/right from process box border
- Activity box height: 5px top padding + text height + 5px bottom padding
- Process box width: max child width + 10px padding
- Process box height: label area + all activities + gaps

### Header Tab Grouping
```
Business Architecture          | Application Architecture              | Data Architecture
Users | Processes | Activities | Applications | App Components | Services | Logical Entities | Logical Attributes | Physical Entities | Physical Attributes
```

### Existing Patterns to Reuse
- `app_components` grid config for FK typeahead pattern
- `findAppComponents` in compoundLayout.ts for child lookup
- `handleAddWithBusinessProcesses` for "Add with X" pattern
- Containment mechanism in Canvas.tsx for parent/child movement
- entityColors pattern in defaults.ts
