# Task Breakdown: Meta-model View Enhancements

## Overview
Total Tasks: 7 Task Groups (35 subtasks)

This task breakdown covers five enhancements to the Meta-model view:
1. Services grid with Application + App Component, auto-inference, and validation
2. Full viewport height rows area with grey background
3. Autocomplete dropdown positioning (above/below based on cell position)
4. Autocomplete search by ID and name with "name (id)" display format
5. Two-row header separating Entities vs Relationships tabs

## Files to Modify Summary

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add `app_component_id` to Service interface |
| `frontend/src/config/defaults.ts` | Services grid configuration with App Component column |
| `frontend/src/components/MetaModelView/MetaModelView.module.css` | Two-row header styling, rows area styling |
| `frontend/src/components/Grid/Grid.tsx` | Full-height rows container with grey background |
| `frontend/src/components/Grid/TypeaheadCell.tsx` | Search by id+name, dropdown positioning, display format, auto-inference |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Two-row header, tab management for entities and relationships |
| `frontend/src/utils/validation.ts` | Service application-component consistency validation |

## Key Constants

- **Rows area background color:** `#f5f5f5` (light grey)
- **Rows area minimum height:** `200px`
- **Dropdown max items:** `10`
- **Autocomplete display format:** `"{name} ({id})"`

---

## Task List

### Task Group 1: Schema and Configuration Updates
**Dependencies:** None
**Effort:** Small (S)
**Specialist:** Frontend Engineer

- [x] 1.0 Complete schema and configuration updates
  - [x] 1.1 Write 3 focused tests for Service schema changes
    - Test Service interface includes optional `app_component_id` field
    - Test Services grid configuration includes App Component column
    - Test default values for new field
  - [x] 1.2 Update Service interface in types
    - File: `frontend/src/types/model.ts`
    - Add `app_component_id?: string` field to Service interface
    - Ensure field is optional (nullable)
  - [x] 1.3 Update Services grid configuration
    - File: `frontend/src/config/gridConfigs.ts`
    - Add `app_component_id` column with `type: 'fk-typeahead'` and `target: 'app_components'`
    - Position after `application_id` column
    - Set `required: false`
  - [x] 1.4 Ensure schema tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- Service interface includes `app_component_id?: string`
- Services grid shows App Component column
- TypeScript compiles without errors

---

### Task Group 2: Rows Area Styling (Full Viewport Height)
**Dependencies:** None
**Effort:** Small (S)
**Specialist:** UI Designer / CSS Engineer

- [x] 2.0 Complete rows area styling
  - [x] 2.1 Write 4 focused tests for rows area styling
    - Test rows container fills remaining viewport height
    - Test grey background color is applied (#f5f5f5)
    - Test rows area visible with zero rows
    - Test vertical scrolling when content overflows
  - [x] 2.2 Update rows container CSS
    - File: `frontend/src/components/Grid/Grid.module.css`
    - Add `.gridContainer` class with:
      - `flex: 1`
      - `overflow-y: auto`
      - `background-color: #f5f5f5`
      - `min-height: 200px`
  - [x] 2.3 Apply flexbox layout to Grid component
    - File: `frontend/src/components/Grid/Grid.tsx`
    - Ensure parent container uses `display: flex` and `flex-direction: column`
    - Apply `.gridContainer` class to rows wrapper element
    - Ensure MetaModelView container has `height: 100%` or `flex: 1`
  - [x] 2.4 Verify styling applies to all tabs
    - Ensure both entity and relationship tabs inherit rows area styling
    - Test with different viewport sizes
  - [x] 2.5 Ensure rows area styling tests pass
    - Run ONLY the 4 tests written in 2.1
    - Visually verify grey background and viewport height
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Rows area fills remaining viewport height
- Light grey background (#f5f5f5) visible
- Empty state shows grey area (not collapsed)
- Scrolling works when many rows present

---

### Task Group 3: Autocomplete Search and Display Format
**Dependencies:** None
**Effort:** Medium (M)
**Specialist:** Frontend Engineer

- [x] 3.0 Complete autocomplete search and display enhancements
  - [x] 3.1 Write 5 focused tests for autocomplete behavior
    - Test search matches by name (case-insensitive)
    - Test search matches by id (case-insensitive)
    - Test dropdown displays "name (id)" format
    - Test selection stores only id value
    - Test cell display shows name when available
  - [x] 3.2 Update filter options function
    - File: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Modify filter logic to match both `name` and `id`
    - Apply `toLowerCase()` to both search text and option values
    - Use `includes()` for substring matching
  - [x] 3.3 Update dropdown item display format
    - File: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Display format: `"{name} ({id})"`
    - Handle empty name case: display just `"{id}"`
    - Apply consistent formatting to all dropdown items
  - [x] 3.4 Update selection and display behavior
    - Store only `id` when option selected
    - Display `name` in cell when not editing (if name available)
    - Fall back to `id` display when name not available
  - [x] 3.5 Apply changes to all FK typeahead columns
    - Verify changes apply to: Applications, App Components, Users, Processes, Logical Entities, Physical Entities
    - Verify changes apply to all relationship source/target fields
  - [x] 3.6 Ensure autocomplete search tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify search and display behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Typing name substring shows matching options
- Typing id substring shows matching options
- Search is case-insensitive
- Dropdown items display "name (id)" format
- Selected value stores only id

---

### Task Group 4: Autocomplete Dropdown Positioning
**Dependencies:** Task Group 2 (rows area styling provides container reference)
**Effort:** Medium (M)
**Specialist:** Frontend Engineer

- [x] 4.0 Complete autocomplete dropdown positioning
  - [x] 4.1 Write 4 focused tests for dropdown positioning
    - Test cell in top half of container shows dropdown below
    - Test cell in bottom half of container shows dropdown above
    - Test dropdown stays within viewport bounds
    - Test positioning updates on scroll
  - [x] 4.2 Implement position calculation function
    - File: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Add `getDropdownPosition(cellRect, containerRect): 'below' | 'above'`
    - Calculate container midpoint Y
    - Compare cell center Y to midpoint
    - Return 'below' if cell in top half, 'above' if bottom half
  - [x] 4.3 Update dropdown rendering logic
    - File: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Get rows container reference (use ref or context)
    - Get cell bounding rect on focus/activation
    - Calculate position using `getDropdownPosition()`
    - Apply appropriate CSS positioning (top or bottom)
  - [x] 4.4 Add CSS for above/below positioning
    - File: `frontend/src/components/Grid/Grid.module.css`
    - Style for dropdown below: `top: 100%`
    - Style for dropdown above: `bottom: 100%`
    - Include small gap between cell and dropdown
  - [x] 4.5 Ensure dropdown positioning tests pass
    - Run ONLY the 4 tests written in 4.1
    - Manually test with rows at top and bottom of container
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- Cells in top half show dropdown below
- Cells in bottom half show dropdown above
- Dropdown never clips off-screen
- All autocomplete options visible

---

### Task Group 5: Services Auto-Inference and Validation
**Dependencies:** Task Group 1 (schema updates), Task Group 3 (typeahead behavior)
**Effort:** Medium (M)
**Specialist:** Frontend Engineer

- [x] 5.0 Complete Services auto-inference and validation
  - [x] 5.1 Write 6 focused tests for auto-inference and validation
    - Test selecting App Component auto-fills Application field
    - Test auto-inference uses component's parent application_id
    - Test validation error when Application doesn't match component's parent
    - Test no error when app_component_id is empty
    - Test no error when both fields are empty
    - Test save blocked when validation error exists
  - [x] 5.2 Implement auto-inference on App Component selection
    - File: `frontend/src/components/Grid/Grid.tsx`
    - Add `onFieldChange` callback support to grid configuration
    - When `app_component_id` changes:
      - Look up component in `model.metaModel.entities.app_components`
      - If component has `application_id`, set `service.application_id`
    - Trigger immediately on selection (not on blur)
  - [x] 5.3 Implement validation function
    - File: `frontend/src/utils/validation.ts`
    - Add `validateServiceApplicationConsistency(service, model): ValidationError | null`
    - Return null if `app_component_id` is empty
    - Return null if component not found
    - Return error if `application_id` doesn't match component's parent
    - Error message: "Service Application must match the parent Application of the selected Application Component."
  - [x] 5.4 Integrate validation into save flow
    - File: `frontend/src/utils/validation.ts`
    - Add service consistency validation to `validateModel()` function
    - Loop through all services and collect errors
    - Display errors with red row highlighting
    - Block save when validation errors exist
  - [x] 5.5 Add visual feedback for validation errors
    - Display error message near invalid field
    - Red highlighting on invalid row
    - Clear error message text
  - [x] 5.6 Ensure auto-inference and validation tests pass
    - Run ONLY the 6 tests written in 5.1
    - Test manual workflow: select component, verify auto-fill, verify validation
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Selecting App Component auto-fills Application
- Validation error shown when Application doesn't match component's parent
- Save blocked with validation errors
- Empty fields are allowed (no false errors)

---

### Task Group 6: Two-Row Header for Entities and Relationships
**Dependencies:** None
**Effort:** Medium (M)
**Specialist:** UI Designer / Frontend Engineer

- [x] 6.0 Complete two-row header implementation
  - [x] 6.1 Write 5 focused tests for two-row header
    - Test first row displays "Entities:" label with entity tabs
    - Test second row displays "Relationships:" label with relationship tabs
    - Test only one tab active at a time across both rows
    - Test clicking entity tab shows entity data
    - Test clicking relationship tab shows relationship data
  - [x] 6.2 Update MetaModelView header structure
    - File: `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Create first header row with "Entities:" label
    - Add tabs: Users, Processes, Applications, App Components, Services, Application Points, Logical Entities, Logical Attributes, Physical Entities, Physical Attributes
    - Create second header row with "Relationships:" label
    - Add tabs: User <-> Process, App Point <-> Process, Logical ER, Logical <-> Physical Entities, Logical <-> Physical Attributes, Data Movements
  - [x] 6.3 Update tab state management
    - File: `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Single `activeTab` state variable (not separate for entities/relationships)
    - Update state on any tab click
    - Deselect all other tabs when one is selected
  - [x] 6.4 Map relationship tabs to data sources
    - Map "User <-> Process" to `metaModel.relationships.business_user_processes`
    - Map "App Point <-> Process" to `metaModel.relationships.application_point_business_processes`
    - Map "Logical ER" to `metaModel.relationships.logical_data_entity_relationships`
    - Map "Logical <-> Physical Entities" to `metaModel.relationships.logical_data_entity_physical_data_entities`
    - Map "Logical <-> Physical Attributes" to `metaModel.relationships.logical_data_attribute_physical_data_attributes`
    - Map "Data Movements" to `metaModel.relationships.data_movements`
  - [x] 6.5 Style two-row header
    - File: `frontend/src/components/MetaModelView/MetaModelView.module.css`
    - Style both header rows with consistent appearance
    - Label styling: "Entities:" and "Relationships:" on left
    - Tab button styling with clear active state (distinct background/border)
    - Visual grouping with grid below
  - [x] 6.6 Ensure two-row header tests pass
    - Run ONLY the 5 tests written in 6.1
    - Manually verify visual appearance and tab switching
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 6.1 pass
- First row shows "Entities:" with entity tabs
- Second row shows "Relationships:" with relationship tabs
- Only one tab active at a time
- Tab switching shows correct data in grid
- Active tab clearly highlighted

---

### Task Group 7: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-6
**Effort:** Medium (M)
**Specialist:** QA Engineer / Frontend Engineer

- [x] 7.0 Complete integration testing and gap analysis
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 3 tests from Task Group 1 (schema)
    - Review 4 tests from Task Group 2 (rows area)
    - Review 5 tests from Task Group 3 (search/display)
    - Review 4 tests from Task Group 4 (positioning)
    - Review 6 tests from Task Group 5 (inference/validation)
    - Review 5 tests from Task Group 6 (two-row header)
    - Total existing tests: approximately 27 tests
  - [x] 7.2 Identify critical integration gaps
    - Focus on end-to-end workflows for this feature
    - Check interaction between auto-inference and validation
    - Check interaction between dropdown positioning and rows area height
    - Check persistence of app_component_id on save/reload
  - [x] 7.3 Write up to 8 additional integration tests
    - Test full workflow: add service, select component, verify auto-fill, save, reload
    - Test validation blocking save with mismatch
    - Test dropdown positioning in scrolled rows area
    - Test search by ID in FK field, select, verify stored value
    - Test tab switching between entities and relationships
    - Test rows area remains full height after row deletion
    - Test all FK typeahead columns use new search/display format
    - Test round-trip: load model with app_component_id, verify display, save, reload
  - [x] 7.4 Run all feature-specific tests
    - Run all tests related to this spec's features
    - Expected total: approximately 35 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 7.5 Document any issues found
    - Note any edge cases discovered
    - Document workarounds if needed
    - Confirm all acceptance criteria met

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 35 tests total)
- Full workflow tests pass (add, edit, save, reload)
- No critical integration issues
- All five enhancements working together correctly

---

## Execution Order

Recommended implementation sequence with parallel opportunities:

### Phase 1: Foundation (Parallel)
Execute these task groups in parallel as they have no dependencies:
1. **Task Group 1: Schema and Configuration Updates** - Small
2. **Task Group 2: Rows Area Styling** - Small
3. **Task Group 6: Two-Row Header** - Medium

### Phase 2: Autocomplete Enhancements (Parallel after Phase 1)
Execute these after rows area styling is complete:
4. **Task Group 3: Autocomplete Search and Display** - Medium
5. **Task Group 4: Autocomplete Dropdown Positioning** - Medium (depends on Task Group 2)

### Phase 3: Services Logic (After Schema + Autocomplete)
Execute after schema and autocomplete are complete:
6. **Task Group 5: Services Auto-Inference and Validation** - Medium (depends on Task Groups 1 and 3)

### Phase 4: Integration
Execute after all other groups are complete:
7. **Task Group 7: Integration Testing** - Medium (depends on all previous groups)

---

## Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Dropdown positioning calculation errors | Test with various viewport sizes and scroll positions |
| Auto-inference not triggering on selection | Ensure onChange handler fires immediately, not on blur |
| Validation blocking valid states | Comprehensive test cases for all empty/filled combinations |
| CSS flexbox issues across browsers | Test in Chrome, Firefox, Safari, Edge |
| Tab state management complexity | Single source of truth for active tab |

### Dependencies

- Task Group 4 requires Task Group 2 for container reference
- Task Group 5 requires Task Groups 1 and 3 for schema and typeahead updates
- Task Group 7 requires all other groups to be complete

---

## Visual Verification Checklist

After implementation, manually verify:

- [x] Services grid shows both Application and App Component columns
- [x] Selecting App Component auto-fills Application
- [x] Validation error appears when Application doesn't match component's parent
- [x] Save is blocked with validation errors
- [x] Rows area fills viewport height with grey background
- [x] Rows area visible with zero rows
- [x] Scrolling works with many rows
- [x] Dropdown appears below for cells in top half
- [x] Dropdown appears above for cells in bottom half
- [x] Search matches both name and id
- [x] Dropdown displays "name (id)" format
- [x] Two header rows visible with correct labels
- [x] Tab switching works correctly
- [x] Only one tab active at a time
