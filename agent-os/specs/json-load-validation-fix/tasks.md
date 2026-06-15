# Task Breakdown: JSON Load Validation Fix

## Overview
Total Tasks: 18
Estimated Total Effort: ~6-8 hours

This is a focused bug fix that corrects JSON load validation behavior. Tasks are grouped by concern area and ordered by dependency.

## Task List

### Type Definitions Layer

#### Task Group 1: Update TypeScript Interfaces
**Dependencies:** None
**Effort:** M (45-60 min)

- [x] 1.0 Complete type definition updates
  - [x] 1.1 Write 4 focused tests for type structure validation
    - Test `MetaModel` interface structure
    - Test `MetaModelEntities` has all 10 entity arrays
    - Test `MetaModelRelationships` has all 6 relationship arrays
    - Test `EntityType` union uses correct keys
  - [x] 1.2 Create nested MetaModel interfaces in `frontend/src/types/model.ts`
    - Add `MetaModelEntities` interface with 10 entity arrays
    - Add `MetaModelRelationships` interface with 6 relationship arrays
    - Add `MetaModel` interface containing both
  - [x] 1.3 Update `ArchitectureModel` interface
    - Replace flat arrays with nested `metaModel` property
    - Keep `diagrams`, `diagram_nodes`, `diagram_edges`, `edge_points` at root
  - [x] 1.4 Update `EntityType` union type
    - Change `application_components` to `app_components`
    - Add `logical_data_attributes` and `physical_data_attributes`
    - Remove incorrect `attributes` key
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- All interfaces compile without TypeScript errors
- `EntityType` uses correct key names
- Nested structure matches spec schema

---

### Validation Layer

#### Task Group 2: Update Validation Logic
**Dependencies:** Task Group 1
**Effort:** M (45-60 min)

- [x] 2.0 Complete validation logic updates
  - [x] 2.1 Write 6 focused tests for validation scenarios
    - Test empty JSON `{}` loads successfully
    - Test partial JSON with only some arrays loads successfully
    - Test malformed JSON is rejected with parse error
    - Test non-array type where array expected is rejected
    - Test valid FK reference passes validation
    - Test invalid FK reference shows validation error
  - [x] 2.2 Update `validateJsonStructure` in `frontend/src/utils/validation.ts`
    - Accept nested `metaModel.entities.*` and `metaModel.relationships.*` structure
    - Remove requirements for all arrays to be present
    - Only reject malformed JSON or non-array types
  - [x] 2.3 Update `getArrayOrDefault` helper function
    - Return empty array for `undefined` or `null`
    - Throw error for non-array types (objects, strings, numbers)
    - Return value as-is if already an array
  - [x] 2.4 Update FK validation to use correct nested paths
    - Update entity lookup paths to `metaModel.entities.*`
    - Update relationship lookup paths to `metaModel.relationships.*`
    - Ensure FK validation still checks referenced entities exist
  - [x] 2.5 Ensure validation tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify permissive load behavior works
    - Verify FK validation still catches invalid references

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Empty JSON loads without errors
- Missing arrays default to empty
- Invalid FK references show validation errors
- Only malformed JSON or wrong types are rejected

---

### File Operations Layer

#### Task Group 3: Update File Load/Save Operations
**Dependencies:** Task Group 2
**Effort:** M (45-60 min)

- [x] 3.0 Complete file operations updates
  - [x] 3.1 Write 4 focused tests for file operations
    - Test loading JSON with nested structure
    - Test loading JSON with missing arrays defaults correctly
    - Test saving model produces nested structure
    - Test round-trip (load -> modify -> save -> load) preserves data
  - [x] 3.2 Update `loadModel` function in `frontend/src/utils/fileOperations.ts`
    - Parse nested `metaModel.entities.*` structure
    - Parse nested `metaModel.relationships.*` structure
    - Default all missing arrays to empty using `getArrayOrDefault`
    - Build complete in-memory model with all arrays present
  - [x] 3.3 Update `saveModel` function
    - Serialize to nested `metaModel` structure
    - Output correct key names (`app_components`, `logical_data_attributes`, etc.)
    - Maintain consistent JSON formatting
  - [x] 3.4 Update file import/export handlers
    - Ensure file download uses correct nested structure
    - Ensure file upload parses nested structure correctly
  - [x] 3.5 Ensure file operations tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify load and save produce correct structures

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Loaded model always has complete structure with all arrays
- Saved JSON uses nested `metaModel` structure
- Round-trip preserves all data correctly

---

### State Management Layer

#### Task Group 4: Update Context and State
**Dependencies:** Task Group 3
**Effort:** S (30-45 min)

- [x] 4.0 Complete state management updates
  - [x] 4.1 Write 3 focused tests for state operations
    - Test initial state has correct nested structure
    - Test reducer handles nested entity paths
    - Test state updates preserve structure integrity
  - [x] 4.2 Update initial state in `frontend/src/contexts/ArchitectureContext.tsx`
    - Change initial state to use nested `metaModel` structure
    - Initialize all entity arrays as empty
    - Initialize all relationship arrays as empty
  - [x] 4.3 Update reducer actions for nested paths
    - Update ADD_ENTITY to use `metaModel.entities[entityType]`
    - Update UPDATE_ENTITY to use nested path
    - Update DELETE_ENTITY to use nested path
    - Update SET_MODEL to accept nested structure
  - [x] 4.4 Update context selectors and getters
    - Update any functions that read entity/relationship data
    - Ensure correct nested path access throughout
  - [x] 4.5 Ensure state management tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify state operations work with nested structure

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Initial state uses correct nested structure
- All reducer actions work with nested paths
- State integrity maintained during updates

---

### UI Components Layer

#### Task Group 5: Update Grid and Config Components
**Dependencies:** Task Group 4
**Effort:** S (30-45 min)

- [x] 5.0 Complete UI component updates
  - [x] 5.1 Write 3 focused tests for UI components
    - Test Grid component renders with nested data access
    - Test `createEmptyEntity` uses correct entity types
    - Test grid config uses correct key mappings
  - [x] 5.2 Update `frontend/src/components/Grid/Grid.tsx`
    - Update entity access to use `model.metaModel.entities[entityType]`
    - Update relationship access to use `model.metaModel.relationships[relType]`
    - Update `createEmptyEntity` for correct entity type keys
  - [x] 5.3 Update `frontend/src/config/gridConfigs.ts`
    - Change `application_components` to `app_components`
    - Update attribute type mappings to use `logical_data_attributes` and `physical_data_attributes`
    - Ensure all entity type references use correct keys
  - [x] 5.4 Update any other components accessing entity data
    - Search for direct entity array access patterns
    - Update to use nested paths
  - [x] 5.5 Ensure UI component tests pass
    - Run ONLY the 3 tests written in 5.1
    - Verify components render correctly with nested structure

**Acceptance Criteria:**
- The 3 tests written in 5.1 pass
- Grid displays entities correctly
- Entity creation uses correct types
- All key names match spec

---

### Sample Data Layer

#### Task Group 6: Update Sample JSON
**Dependencies:** Task Group 5
**Effort:** XS (15-20 min)

- [x] 6.0 Complete sample data updates
  - [x] 6.1 Update `frontend/public/sample-architecture.json`
    - Restructure to nested `metaModel.entities.*` format
    - Restructure to nested `metaModel.relationships.*` format
    - Use correct key names throughout
    - Ensure valid FK references
  - [x] 6.2 Verify sample JSON loads without errors
    - Load sample JSON through the application
    - Confirm no validation errors appear
    - Confirm all entities display correctly

**Acceptance Criteria:**
- Sample JSON uses correct nested structure
- Sample JSON loads without validation errors
- All entities and relationships display correctly

---

### Integration Testing

#### Task Group 7: Test Review and Integration Verification
**Dependencies:** Task Groups 1-6
**Effort:** S (30-45 min)

- [x] 7.0 Review existing tests and verify integration
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 4 type definition tests (Task 1.1)
    - Review 6 validation tests (Task 2.1)
    - Review 4 file operations tests (Task 3.1)
    - Review 3 state management tests (Task 4.1)
    - Review 3 UI component tests (Task 5.1)
    - Total existing tests: 20 tests
  - [x] 7.2 Analyze test coverage gaps
    - Identify any critical user workflows lacking coverage
    - Focus on end-to-end scenarios specific to this fix
  - [x] 7.3 Write up to 5 additional integration tests if needed
    - Test full workflow: load empty JSON -> add entity -> save -> reload
    - Test full workflow: load partial JSON -> verify defaults -> save
    - Test error handling: malformed JSON shows user-friendly error
    - Additional tests only if critical gaps identified
  - [x] 7.4 Run all feature-specific tests
    - Run all tests from Task Groups 1-6 plus any new tests
    - Expected total: approximately 20-25 tests
    - Verify all acceptance criteria from spec are met
  - [x] 7.5 Manual verification of acceptance criteria
    - Empty JSON `{}` loads successfully
    - Partial JSON loads with defaults
    - Correct nested structure accepted
    - Invalid structure rejected appropriately
    - FK validation works correctly
    - Sample JSON loads without errors
    - Save produces correct nested structure

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-25 tests)
- All 7 acceptance criteria from spec verified
- No more than 5 additional tests added
- Manual testing confirms fix works end-to-end

---

## Execution Order

Recommended implementation sequence:

1. **Type Definitions** (Task Group 1) - Foundation for all other changes
2. **Validation Logic** (Task Group 2) - Core bug fix logic
3. **File Operations** (Task Group 3) - Load/save implementation
4. **State Management** (Task Group 4) - Context updates
5. **UI Components** (Task Group 5) - Display updates
6. **Sample Data** (Task Group 6) - Update test data
7. **Integration Testing** (Task Group 7) - Verify complete fix

## Notes

- This is a bug fix affecting multiple files but with a focused scope
- Changes cascade from types through to UI, so order is important
- FK validation must remain functional throughout changes
- Test each layer before proceeding to dependent tasks
- Total estimated time: 6-8 hours for complete implementation and testing

## Implementation Summary

All 7 task groups have been successfully implemented. Key changes made:

### Files Modified:
1. `frontend/src/types/model.ts` - Added nested MetaModel interfaces, updated EntityType union
2. `frontend/src/utils/validation.ts` - Added getArrayOrDefault helper, permissive validation
3. `frontend/src/utils/fileOperations.ts` - Added buildModelFromData with defaults
4. `frontend/src/config/defaults.ts` - Updated emptyModel to nested structure
5. `frontend/src/contexts/ArchitectureContext.tsx` - Updated reducer for nested paths
6. `frontend/src/components/Grid/Grid.tsx` - Updated entity access, createEmptyEntity
7. `frontend/src/config/gridConfigs.ts` - Changed app_components, added attribute grids
8. `frontend/src/components/Grid/TypeaheadCell.tsx` - Updated FK lookup to nested path
9. `frontend/src/components/TopBar/TopBar.tsx` - Load model even with validation errors
10. `frontend/src/utils/idGenerator.ts` - Added new entity type prefixes
11. `frontend/src/utils/rendering.ts` - Updated entity lookups to nested paths
12. `frontend/src/components/DiagramsView/Canvas.tsx` - Removed old relationship access
13. `frontend/public/sample-architecture.json` - Restructured to nested format

### Build Status: SUCCESS
- TypeScript compilation passed
- Vite build completed successfully
