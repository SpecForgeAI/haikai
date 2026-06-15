# Task Breakdown: UI Screen Actions Enhancement

## Overview
Total Tasks: 6 Task Groups, 30 Sub-tasks

This specification enhances the Add Action modal for UI_SCREEN diagrams with:
- Navigate dropdown populated from all UIScreens in the meta-model
- Call API dropdown verification for interface/endpoint population
- Multiple state mutations support with new `mutations` array schema
- Entity/attribute autocomplete for Set State key field
- Back-compatibility migration and form validation

**Scope:** Frontend-only enhancement (no backend changes required)

## Task List

### Task Group 1: Navigate Dropdown Fix
**Dependencies:** None
**Files:** `AddActionModal.tsx`, `UIScreenDiagramEditorPanel.tsx`

- [x] 1.0 Complete Navigate dropdown population from full meta-model
  - [x] 1.1 Verify UIScreenDiagramEditorPanel passes `metaModel` prop to AddActionModal
    - Current: `metaModel` is passed at line 328
    - Current: `uiScreens={uiScreensList}` is passed at line 329
    - Verify `uiScreensList` is derived from `metaModel.entities.ui_screens` (line 111-114)
  - [x] 1.2 Update AddActionModal NAVIGATE dropdown to use full meta-model
    - Current: Uses `uiScreens` prop which comes from parent
    - Ensure dropdown lists ALL UIScreens from `metaModel.entities.ui_screens`
    - If `uiScreens` prop is empty but `metaModel.entities.ui_screens` has data, use metaModel directly
  - [x] 1.3 Update option label format
    - Current format: `{screen.name} ({screen.route})` (line 324-325)
    - Target format: `${screen.name}${screen.route ? " (" + screen.route + ")" : ""}`
    - Handle screens without routes gracefully
  - [x] 1.4 Add hint text when no UIScreens exist
    - Current: Shows hint at line 332-335 when `uiScreens.length === 0`
    - Verify hint text is displayed appropriately

**Acceptance Criteria:**
- Navigate dropdown shows ALL UIScreens from project meta-model
- Option labels show name with optional route in parentheses
- Hint displays when no UIScreens exist in the project

---

### Task Group 2: Call API Dropdown Verification
**Dependencies:** None
**Files:** `InterfaceEndpointPicker.tsx`, `ActionsTab.tsx`, `uiScreenUtils.ts`

- [x] 2.0 Complete Call API dropdown verification
  - [x] 2.1 Verify InterfaceEndpointPicker interface dropdown population
    - Current: Reads from `metaModel.entities.interfaces` (lines 41-44)
    - Verify option label uses `interface.name` (line 102-104)
    - Confirm dropdown shows all interfaces
  - [x] 2.2 Verify endpoint dropdown population and filtering
    - Current: Filters `metaModel.entities.endpoints` by `interface_id` (lines 47-52)
    - Verify endpoint label format: `${endpoint.name} (${endpoint.operation_verb || endpoint.endpoint_type})` (line 134-136)
  - [x] 2.3 Verify CALL_API action persistence schema
    - Current: Persists as `effect: { type: 'CALL_API', interface_endpoint_id: endpointId }` (lines 168-171)
    - Confirm this matches spec requirement
  - [x] 2.4 Verify ActionsTab CALL_API display label
    - Current: Uses `getCallApiDisplayName()` from `uiScreenUtils.ts` (line 93-96)
    - Verify format: `"CALL_API - InterfaceName.EndpointName"` (line 41 in uiScreenUtils.ts)
    - Verify warning badge shows when endpoint/interface not found (lines 243-257)

**Acceptance Criteria:**
- Interface dropdown shows all interfaces from meta-model
- Endpoint dropdown filters by selected interface
- Endpoint labels show name with operation verb or type
- CALL_API display shows "InterfaceName.EndpointName" format
- Warning badge appears when endpoint/interface lookup fails

---

### Task Group 3: Set State Multiple Mutations
**Dependencies:** None
**Files:** `AddActionModal.tsx`, `AddActionModal.module.css`

- [x] 3.0 Complete multiple mutations UI and schema
  - [x] 3.1 Add mutations array state to AddActionModal
    - Replace single `stateKey`/`stateValue` state with `mutations` array state
    - Type: `{ key: string; value?: string }[]`
    - Initialize with one empty mutation row: `[{ key: '', value: '' }]`
  - [x] 3.2 Create MutationRow component or inline row rendering
    - Each row has: Key input, Value input (optional), Remove button
    - Key input is required, value input is optional
    - Remove button disabled when only one row exists
  - [x] 3.3 Implement Add Mutation button
    - Add button at bottom of mutations list
    - Clicking adds new empty mutation row to array
    - Button label: "Add Mutation" or "+ Add"
  - [x] 3.4 Implement Remove Mutation functionality
    - Remove button on each row (except when single row)
    - Clicking removes that mutation from array
    - Minimum one mutation row required
  - [x] 3.5 Update SET_STATE effect persistence
    - Change from: `effect: { type: 'SET_STATE', key, value }`
    - Change to: `effect: { type: 'SET_STATE', mutations: [{ key, value? }] }`
    - Always persist using new mutations array schema
  - [x] 3.6 Add CSS styles for mutations list UI
    - Style for mutations container
    - Style for individual mutation rows
    - Style for Add/Remove buttons
    - Responsive layout for key/value inputs

**Acceptance Criteria:**
- SET_STATE shows list of mutation rows with Key/Value inputs
- Add button creates new mutation rows
- Remove button deletes mutation rows (minimum one required)
- Persistence uses new `mutations: []` array schema

---

### Task Group 4: Set State Key Autocomplete
**Dependencies:** Task Group 3 (mutations structure must exist)
**Files:** `AddActionModal.tsx`, `UIScreenDiagramEditorPanel.tsx`

- [x] 4.0 Complete key autocomplete with entity/attribute suggestions
  - [x] 4.1 Thread logical entities and attributes props to AddActionModal
    - Current: `UIScreenDiagramEditorPanel` passes `metaModel` prop
    - Extract `logicalEntities` from `metaModel.entities.logical_data_entities`
    - Extract `logicalAttributes` from `metaModel.entities.logical_data_attributes`
    - Pass as props or derive within AddActionModal from metaModel
  - [x] 4.2 Build autocomplete suggestions list
    - Entity suggestions: `logicalEntities.map(e => e.name)` (e.g., "Customer")
    - Attribute suggestions: `entity.name + "." + attribute.name` (e.g., "Customer.email")
    - Filter attributes by `logical_entity_id` to group with parent entity
    - Deduplicate and sort alphabetically
  - [x] 4.3 Implement datalist-based autocomplete for key input
    - Use HTML5 `<datalist>` element for type-ahead suggestions
    - Connect to key input via `list` attribute
    - Generate unique datalist ID per mutation row
    - Allow free-text entry (suggestions are optional, not required)
  - [x] 4.4 Alternative: TypeaheadCell-style dropdown (if datalist insufficient)
    - Use pattern from `TypeaheadCell.tsx` for dropdown suggestions
    - Show suggestions as user types
    - Selection sets exact string
    - Support keyboard navigation (optional)

**Acceptance Criteria:**
- Key input shows autocomplete suggestions from logical entities/attributes
- Suggestions include entity names (e.g., "Customer")
- Suggestions include entity.attribute format (e.g., "Customer.email")
- Free-text entry allowed (not restricted to suggestions)
- Suggestions sorted alphabetically

---

### Task Group 5: Back-Compatibility and Validation
**Dependencies:** Task Groups 1, 2, 3, 4
**Files:** `AddActionModal.tsx`, `ActionsTab.tsx`

- [x] 5.0 Complete back-compatibility migration and form validation
  - [x] 5.1 Implement in-memory migration for legacy SET_STATE format
    - Detect legacy format: `effect.key` exists without `effect.mutations`
    - Convert to new format: `mutations = [{ key: effect.key, value: effect.value }]`
    - Apply only in UI for rendering; do not modify database
    - Migration happens when loading/displaying existing actions
  - [x] 5.2 Update SET_STATE validation in AddActionModal
    - Current: Validates single `stateKey` is non-empty (line 143-145)
    - New: Validate at least one mutation with non-empty key
    - All mutations must have non-empty `key` field
    - Error message: "At least one mutation with a key is required"
  - [x] 5.3 Verify Navigate validation
    - Current: Validates `targetScreenId` is set (line 132-134)
    - Ensure "Target screen is required" error shows correctly
  - [x] 5.4 Verify Call API validation
    - Current: Validates `interfaceEndpointId` is set (line 137-139)
    - Ensure "Endpoint is required" error shows correctly
  - [x] 5.5 Update form validity check for Add button enablement
    - Add Action button disabled until all required fields valid
    - Name must be set
    - Trigger type is always set (has default)
    - Effect fields must be valid per effect type

**Acceptance Criteria:**
- Legacy `effect.key`/`effect.value` format auto-migrates to `mutations[]` in UI
- Validation requires at least one mutation with non-empty key
- Navigate validation requires target screen selection
- Call API validation requires endpoint selection
- Add Action button properly disabled until form is valid

---

### Task Group 6: Tests
**Dependencies:** Task Groups 1-5
**Files:** New test file(s) in `frontend/src/__tests__/`

- [x] 6.0 Complete test coverage for UI Screen Actions Enhancement
  - [x] 6.1 Write tests for Navigate dropdown population (2-3 tests)
    - Test: Navigate dropdown shows all UIScreens from metaModel
    - Test: Option label format shows name with optional route
    - Test: Hint text displays when no UIScreens exist
  - [x] 6.2 Write tests for Call API dropdown (2-3 tests)
    - Test: Interface dropdown shows all interfaces
    - Test: Endpoint dropdown filters by selected interface
    - Test: CALL_API display label format in ActionsTab
  - [x] 6.3 Write tests for SET_STATE mutations (3-4 tests)
    - Test: Initial state has one empty mutation row
    - Test: Add Mutation button adds new row
    - Test: Remove button removes row (minimum one enforced)
    - Test: Persistence uses mutations array schema
  - [x] 6.4 Write tests for key autocomplete (2-3 tests)
    - Test: Suggestions include entity names
    - Test: Suggestions include entity.attribute format
    - Test: Free-text entry allowed
  - [x] 6.5 Write tests for back-compatibility (2 tests)
    - Test: Legacy `effect.key`/`value` migrates to `mutations[]`
    - Test: New format persists correctly
  - [x] 6.6 Write tests for form validation (2-3 tests)
    - Test: Add button disabled when name empty
    - Test: Add button disabled when Navigate has no target screen
    - Test: Add button disabled when SET_STATE has no valid mutations
  - [x] 6.7 Run all feature-specific tests
    - Run ONLY tests written in 6.1-6.6
    - Expected: approximately 14-18 tests
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (29 tests total - exceeded target)
- Coverage for Navigate, Call API, SET_STATE mutations, autocomplete, back-compat
- Validation scenarios tested
- No regression in existing functionality

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Navigate Dropdown Fix** - Verify/fix UIScreen dropdown population
2. **Task Group 2: Call API Dropdown Verification** - Verify existing CALL_API implementation
3. **Task Group 3: Set State Multiple Mutations** - Implement new mutations array UI/schema
4. **Task Group 4: Set State Key Autocomplete** - Add entity/attribute suggestions
5. **Task Group 5: Back-Compatibility and Validation** - Migration logic and form validation
6. **Task Group 6: Tests** - Write and run feature-specific tests

**Note:** Task Groups 1 and 2 can be done in parallel. Task Groups 3 and 4 are sequential (4 depends on 3). Task Group 5 depends on 1-4. Task Group 6 should be done last.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.tsx` | Main modal component for adding actions |
| `frontend/src/components/DiagramsView/UIScreenEditor/modals/InterfaceEndpointPicker.tsx` | Two-dropdown picker for Interface + Endpoint |
| `frontend/src/components/DiagramsView/UIScreenEditor/ActionsTab.tsx` | Actions list display with CALL_API labels |
| `frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx` | Parent panel that passes props to modal |
| `frontend/src/utils/uiScreenUtils.ts` | Utility functions including getCallApiDisplayName |
| `frontend/src/types/model.ts` | Type definitions for MetaModel, UIScreen, etc. |
| `frontend/src/components/Grid/TypeaheadCell.tsx` | Reference pattern for autocomplete dropdown |

---

## Schema Changes Summary

**SET_STATE Effect - Before:**
```typescript
effect: {
  type: 'SET_STATE',
  key: string,
  value?: string
}
```

**SET_STATE Effect - After:**
```typescript
effect: {
  type: 'SET_STATE',
  mutations: Array<{ key: string; value?: string }>
}
```

**Back-Compatibility:** In-memory migration only; no database migration required.

---

## Implementation Summary

All 6 task groups have been successfully implemented:

1. **Task Group 1 (Navigate Dropdown):** Updated AddActionModal to use `allUIScreens` from metaModel with fallback to uiScreens prop. Updated label format to show name with optional route in parentheses.

2. **Task Group 2 (Call API Verification):** Verified InterfaceEndpointPicker correctly reads interfaces and filters endpoints. Verified getCallApiDisplayName returns "InterfaceName.EndpointName" format.

3. **Task Group 3 (Multiple Mutations):** Replaced single stateKey/stateValue with mutations array. Added mutation row UI with Add/Remove buttons. Added CSS styles for mutations list.

4. **Task Group 4 (Key Autocomplete):** Built keySuggestions from logicalEntities and logicalAttributes. Implemented HTML5 datalist-based autocomplete for key inputs.

5. **Task Group 5 (Back-Compatibility):** Added migrateSetStateEffect and isLegacySetStateEffect utilities. Updated validation for mutations array. Disabled Add Action button until form valid.

6. **Task Group 6 (Tests):** Created comprehensive test suite with 29 tests covering all functionality. All tests pass.
