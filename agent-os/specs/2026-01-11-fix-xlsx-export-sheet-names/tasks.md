# Task Breakdown: Fix Export as XLSX by Enforcing Excel-Safe Worksheet Names

## Overview

| Metric | Value |
|--------|-------|
| Total Tasks | 4 Task Groups |
| Total Sub-tasks | 22 |
| Primary File | `frontend/src/utils/excelOperations.ts` |
| Test File | `frontend/src/__tests__/excel-worksheet-names.test.ts` |
| Estimated Complexity | Medium |

## Summary

This bugfix ensures XLSX export generates valid Excel workbooks by:
1. Creating a canonical mapping constant for worksheet names with abbreviations for 5 overlength relationship keys
2. Adding helper functions for safe sheet name generation
3. Refactoring export logic to use key-based naming
4. Updating reverse mappings for future import compatibility

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/utils/excelOperations.ts` | Modify | Add canonical mapping, helper functions, refactor export |
| `frontend/src/__tests__/excel-worksheet-names.test.ts` | Create | New test file for worksheet naming validation |

## Overlength Key Abbreviations Reference

| Original Key (chars) | Abbreviated Sheet Name (chars) |
|---------------------|-------------------------------|
| `application_point_business_points` (33) | `app_point_business_points` (25) |
| `logical_data_entity_relationships` (33) | `logical_entity_relationships` (28) |
| `application_point_business_logics` (33) | `app_point_business_logics` (25) |
| `logical_data_entity_physical_data_entities` (42) | `logical_entity_physical_ents` (28) |
| `logical_data_attribute_physical_data_attributes` (47) | `logical_attr_physical_attrs` (27) |

---

## Task List

### Utility Layer

#### Task Group 1: Canonical Mapping and Helper Functions
**Dependencies:** None

- [x] 1.0 Complete canonical mapping and helper functions
  - [x] 1.1 Write 6 focused tests for worksheet naming functions
    - Test `META_MODEL_XLSX_SHEET_NAME_BY_KEY` contains all 5 abbreviated entries
    - Test `getSheetNameForKey()` returns abbreviated name for overlength keys
    - Test `getSheetNameForKey()` returns identity for normal keys
    - Test `toExcelSafeSheetName()` truncates names exceeding 31 characters
    - Test `toExcelSafeSheetName()` replaces illegal characters `\ / ? * [ ]`
    - Test `ensureUniqueSheetName()` appends suffix on collision
  - [x] 1.2 Create `META_MODEL_XLSX_SHEET_NAME_BY_KEY` constant
    - Define as `Record<string, string>` mapping entity/relationship keys to sheet names
    - Add explicit entries for 5 overlength relationship keys with abbreviated values:
      - `application_point_business_points` -> `app_point_business_points`
      - `logical_data_entity_relationships` -> `logical_entity_relationships`
      - `application_point_business_logics` -> `app_point_business_logics`
      - `logical_data_entity_physical_data_entities` -> `logical_entity_physical_ents`
      - `logical_data_attribute_physical_data_attributes` -> `logical_attr_physical_attrs`
    - Export constant for use in tests
  - [x] 1.3 Implement `getSheetNameForKey(key: string): string`
    - Return `META_MODEL_XLSX_SHEET_NAME_BY_KEY[key] ?? key`
    - Export function for use by export logic and tests
  - [x] 1.4 Implement `toExcelSafeSheetName(name: string): string`
    - Replace illegal characters `\ / ? * [ ]` with underscore `_`
    - Trim leading/trailing whitespace
    - Truncate to 31 characters maximum
    - Export function for use by export logic and tests
  - [x] 1.5 Implement `ensureUniqueSheetName(name: string, existingNames: Set<string>): string`
    - If `name` not in `existingNames`, return `name`
    - If collision, append `_2`, `_3`, etc. until unique
    - Add the returned name to `existingNames` set
    - Export function for use by export logic and tests
  - [x] 1.6 Ensure helper function tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify all helper functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 1.1 pass
- `META_MODEL_XLSX_SHEET_NAME_BY_KEY` contains exactly 5 abbreviated entries
- All abbreviated sheet names are <= 31 characters
- `getSheetNameForKey()` correctly returns canonical names
- `toExcelSafeSheetName()` enforces all Excel constraints
- `ensureUniqueSheetName()` handles collisions properly

---

### Export Logic Refactoring

#### Task Group 2: Refactor XLSX Export to Use Key-Based Naming
**Dependencies:** Task Group 1

- [x] 2.0 Complete export logic refactoring
  - [x] 2.1 Write 4 focused tests for export worksheet naming
    - Test entity worksheets use `getSheetNameForKey(entityType)` not tab names
    - Test relationship worksheets use `getSheetNameForKey(relType)` not tab names
    - Test all exported sheet names pass `toExcelSafeSheetName()` validation
    - Test no duplicate sheet names in exported workbook
  - [x] 2.2 Refactor entity worksheet naming in `exportMetaModelToExcel`
    - Replace `getEntityWorksheetName(tabName)` pattern
    - Use `getSheetNameForKey(entityType)` to get canonical sheet name
    - Apply `toExcelSafeSheetName()` as final safety validation
    - Track used sheet names in a `Set<string>`
    - Apply `ensureUniqueSheetName()` before adding to workbook
  - [x] 2.3 Refactor relationship worksheet naming in `exportMetaModelToExcel`
    - Replace `getRelationshipWorksheetName(tabName)` pattern
    - Use `getSheetNameForKey(relType)` to get canonical sheet name
    - Apply `toExcelSafeSheetName()` as final safety validation
    - Track used sheet names in same `Set<string>` as entities
    - Apply `ensureUniqueSheetName()` before adding to workbook
  - [x] 2.4 Deprecate legacy worksheet naming functions
    - Add JSDoc `@deprecated` tags to `getEntityWorksheetName()` and `getRelationshipWorksheetName()`
    - Document that these functions are kept for backward compatibility
    - Update any internal usages to use new key-based approach
  - [x] 2.5 Ensure export refactoring tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify export produces valid worksheet names
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Export uses entity/relationship type keys instead of tab names
- All worksheet names are <= 31 characters
- No illegal characters appear in any sheet name
- No duplicate sheet names in exported workbook

---

### Import Compatibility Layer

#### Task Group 3: Update Reverse Mapping Functions for Import
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete import reverse mapping updates
  - [x] 3.1 Write 4 focused tests for reverse mapping functions
    - Test `worksheetNameToEntityType()` recognizes all entity sheet names
    - Test `worksheetNameToRelationshipType()` recognizes all abbreviated relationship sheet names
    - Test reverse mapping is exact inverse of `getSheetNameForKey()` for all keys
    - Test reverse mapping handles unknown sheet names gracefully (returns undefined)
  - [x] 3.2 Create reverse mapping constant `XLSX_SHEET_NAME_TO_KEY`
    - Generate by inverting `META_MODEL_XLSX_SHEET_NAME_BY_KEY`
    - Add identity mappings for all non-abbreviated entity/relationship keys
    - Export constant for use by import functions
  - [x] 3.3 Update `worksheetNameToEntityType()` function
    - Use `XLSX_SHEET_NAME_TO_KEY` for lookup instead of iterating tab names
    - Recognize canonical abbreviated sheet names
    - Return entity type or undefined if not found
  - [x] 3.4 Update `worksheetNameToRelationshipType()` function
    - Use `XLSX_SHEET_NAME_TO_KEY` for lookup instead of iterating tab names
    - Recognize canonical abbreviated sheet names for all 5 overlength relationships
    - Return relationship type or undefined if not found
  - [x] 3.5 Ensure import reverse mapping tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify reverse mappings work correctly for all entity/relationship types
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- `worksheetNameToEntityType()` recognizes all entity sheet names
- `worksheetNameToRelationshipType()` recognizes all abbreviated relationship sheet names
- Reverse mapping is exact inverse of forward mapping
- Unknown sheet names return undefined

---

### Testing

#### Task Group 4: Test Review and Comprehensive Validation
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and validate complete implementation
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 6 helper function tests (Task 1.1)
    - Review 4 export refactoring tests (Task 2.1)
    - Review 4 reverse mapping tests (Task 3.1)
    - Total existing tests: 14 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify any critical edge cases not covered
    - Focus on worksheet name boundary conditions (exactly 31 chars, 32 chars)
    - Verify illegal character handling is comprehensive
  - [x] 4.3 Write up to 6 additional strategic tests if needed
    - Test all entity types produce valid sheet names (comprehensive scan)
    - Test all relationship types produce valid sheet names (comprehensive scan)
    - Test export/import round-trip preserves sheet name mapping
    - Test edge case: sheet name exactly 31 characters (no truncation)
    - Test edge case: sheet name 32 characters (truncation to 31)
    - Test multiple illegal characters in single name
  - [x] 4.4 Run all feature-specific tests
    - Run ALL tests in `frontend/src/__tests__/excel-worksheet-names.test.ts`
    - Expected total: approximately 14-20 tests
    - Verify all tests pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (14-20 tests total)
- All entity types produce valid Excel sheet names
- All relationship types produce valid Excel sheet names
- No sheet name exceeds 31 characters
- No sheet name contains illegal characters `\ / ? * [ ]`
- Export/import round-trip maintains data integrity

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: Canonical Mapping and Helper Functions
   |
   v
2. Task Group 2: Refactor XLSX Export to Use Key-Based Naming
   |
   v
3. Task Group 3: Update Reverse Mapping Functions for Import
   |
   v
4. Task Group 4: Test Review and Comprehensive Validation
```

## Implementation Notes

### Excel Worksheet Name Constraints
- Maximum length: 31 characters
- Illegal characters: `\ / ? * [ ]`
- Cannot be blank
- Cannot start or end with apostrophe `'`
- Must be unique within workbook

### Entity/Relationship Keys Reference

**Entity Types (from `tabToEntityType`):**
- `business_users`, `business_processes`, `process_activities`
- `applications`, `app_components`, `services`, `interfaces`, `endpoints`
- `classes`, `methods`, `package_sets`
- `logical_data_entities`, `logical_data_attributes`
- `physical_data_entities`, `physical_data_attributes`
- `application_points`, `business_points`
- `events`, `states`, `state_transitions`
- `activities`, `activity_flows`, `activity_partitions`
- `business_logics`
- `ui_screens`, `ui_workflow_transitions`, `ui_components`, `ui_actions`

**Relationship Types (from `relationshipTabToType`):**
- `business_user_business_points` (26 chars - OK)
- `application_point_business_points` (33 chars - NEEDS ABBREVIATION)
- `interactions` (12 chars - OK)
- `logical_data_entity_relationships` (33 chars - NEEDS ABBREVIATION)
- `logical_data_entity_physical_data_entities` (42 chars - NEEDS ABBREVIATION)
- `logical_data_attribute_physical_data_attributes` (47 chars - NEEDS ABBREVIATION)
- `interface_logical_entities` (26 chars - OK)
- `data_movements` (14 chars - OK)
- `application_point_business_logics` (33 chars - NEEDS ABBREVIATION)

### Test File Location
Create new test file at: `frontend/src/__tests__/excel-worksheet-names.test.ts`

### Code Organization in excelOperations.ts
Add new code in this order after the existing imports and types:
1. `META_MODEL_XLSX_SHEET_NAME_BY_KEY` constant (after line ~20)
2. `XLSX_SHEET_NAME_TO_KEY` reverse mapping constant
3. `getSheetNameForKey()` function
4. `toExcelSafeSheetName()` function
5. `ensureUniqueSheetName()` function
6. Refactor `exportMetaModelToExcel()` to use new functions
7. Update `worksheetNameToEntityType()` and `worksheetNameToRelationshipType()`
