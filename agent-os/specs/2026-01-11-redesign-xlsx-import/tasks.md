# Task Breakdown: Redesign Import as XLSX for Architecture Meta-Model

## Overview

This feature redesigns the XLSX import functionality to be safe, deterministic, and aligned with real modelling use-cases. The implementation covers:

- Import precondition (disabled when no active project)
- Append vs Overwrite mode selection via modal dialog
- Entity-first, relationship-second import ordering
- Row matching by logical unique key (name field)
- Non-blocking FK validation errors
- Post-import summary modal with detailed statistics

**Total Tasks:** 36 sub-tasks across 6 task groups

## Summary Table

| Task Group | Description | Dependencies | Sub-tasks |
|------------|-------------|--------------|-----------|
| 1 | Menu Disabled State | None | 5 |
| 2 | Import Mode Modal | None | 7 |
| 3 | Import Core Logic Refactoring | Task Group 1 | 8 |
| 4 | Relationship Import with FK Validation | Task Group 3 | 6 |
| 5 | Post-Import Summary Modal Enhancement | Task Groups 3, 4 | 5 |
| 6 | Test Review and Gap Analysis | Task Groups 1-5 | 5 |

## Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/components/TopBar/FileMenu.tsx` | Add importXlsxDisabled prop and disabled styling |
| `frontend/src/components/TopBar/TopBar.tsx` | Compute importXlsxDisabled, add modal state and handlers |
| `frontend/src/utils/excelOperations.ts` | Refactor importMetaModelFromExcel for Append/Overwrite modes |
| `frontend/src/components/common/ImportSummaryModal.tsx` | Enhance to show Append/Overwrite statistics |
| `frontend/src/contexts/ArchitectureContext.tsx` | Potentially add IMPORT_META_MODEL_OVERWRITE action |

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/Import/ImportModeModal.tsx` | Append/Overwrite selection dialog |
| `frontend/src/components/Import/ImportModeModal.module.css` | Styles for ImportModeModal |
| `frontend/src/__tests__/xlsx-import-redesign.test.ts` | Unit tests for import logic |

---

## Task List

### Task Group 1: Menu Disabled State (Preconditions)

**Dependencies:** None

This task group implements the precondition that prevents XLSX import when no active project is loaded.

- [x] 1.0 Complete menu disabled state for XLSX import
  - [x] 1.1 Write 3-4 focused tests for menu disabled state
    - Test that "Import as XLSX" menu item is disabled when `loadedFileName` is null
    - Test that "Import as XLSX" menu item is enabled when `loadedFileName` is set
    - Test that clicking disabled menu item does not trigger file picker
    - Test that disabled styling (menuItemDisabled) is applied correctly
  - [x] 1.2 Add `importXlsxDisabled` prop to FileMenu component
    - Add new prop `importXlsxDisabled: boolean` to FileMenuProps interface
    - Follow existing pattern from `saveDisabled` prop
    - Located in: `frontend/src/components/TopBar/FileMenu.tsx`
  - [x] 1.3 Apply disabled styling to Import as XLSX menu item
    - Conditionally apply `styles.menuItemDisabled` class based on `importXlsxDisabled`
    - Guard the `handleImportXlsxClick` handler to return early when disabled
    - Pattern reference: existing Save menu item implementation (lines 249-256)
  - [x] 1.4 Compute and pass importXlsxDisabled in TopBar
    - Compute `importXlsxDisabled = !state.loadedFileName`
    - Pass to FileMenu component as prop
    - Located in: `frontend/src/components/TopBar/TopBar.tsx`
  - [x] 1.5 Ensure menu disabled state tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify disabled state renders correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- "Import as XLSX" menu item is visually disabled when no project is open
- Clicking disabled menu item has no effect
- Menu item becomes enabled when a project is loaded

---

### Task Group 2: Import Mode Modal (Append/Overwrite Selection)

**Dependencies:** None (can be developed in parallel with Task Group 1)

This task group creates the modal dialog for selecting between Append and Overwrite import modes.

- [x] 2.0 Complete Import Mode Modal component
  - [x] 2.1 Write 4-5 focused tests for ImportModeModal
    - Test modal renders with Append and Overwrite options
    - Test Append button click calls onConfirm with 'append' mode
    - Test Overwrite button click calls onConfirm with 'overwrite' mode
    - Test Cancel button closes modal
    - Test modal displays imported file name in header
  - [x] 2.2 Create ImportModeModal component structure
    - Create `frontend/src/components/Import/ImportModeModal.tsx`
    - Props: `isOpen`, `onClose`, `onConfirm: (mode: 'append' | 'overwrite') => void`, `fileName: string`
    - Use existing `Modal` component from `../common/Modal` as base
    - Display clear descriptions of each mode
  - [x] 2.3 Implement Append mode description and button
    - Description: "Add new rows only. Existing rows with matching names are preserved (skipped)."
    - Button label: "Append"
    - Button style: secondary/outline
  - [x] 2.4 Implement Overwrite mode description and button
    - Description: "Update existing rows and add new rows. Rows are matched by name field."
    - Button label: "Overwrite"
    - Button style: primary
  - [x] 2.5 Create ImportModeModal styles
    - Create `frontend/src/components/Import/ImportModeModal.module.css`
    - Style mode option cards with clear visual separation
    - Follow existing modal styling patterns (reference: CreateProjectModal)
  - [x] 2.6 Add modal state and trigger logic to TopBar
    - Add `isImportModeModalOpen` state
    - Add `pendingXlsxFile` state to hold file until mode is selected
    - Modify `handleExcelFileChange` to show modal instead of immediate import
    - Skip modal when meta-model is empty (implicit Overwrite mode)
  - [x] 2.7 Ensure ImportModeModal tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify modal interactions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- Modal renders with clear Append and Overwrite options
- Modal is skipped when meta-model contains no existing data
- Selected mode is correctly passed to import handler

---

### Task Group 3: Import Core Logic Refactoring

**Dependencies:** Task Group 1 (menu disabled state), Task Group 2 (import mode)

This task group refactors the import logic to support entity-first ordering and row matching by name.

- [x] 3.0 Complete import core logic refactoring
  - [x] 3.1 Write 5-6 focused tests for import core logic
    - Test entities are processed before relationships (check processing order)
    - Test row matching by `name` field (case-sensitive)
    - Test Append mode: duplicate names are skipped, new names are added
    - Test Overwrite mode: matching names update existing rows, new names add
    - Test Overwrite mode preserves existing row IDs when updating
    - Test unknown worksheets are silently ignored
  - [x] 3.2 Create ImportMode type and extend ImportResult interface
    - Add `type ImportMode = 'append' | 'overwrite'` in excelOperations.ts
    - Extend `WorksheetImportResult` to include `rowsUpdated: number`
    - Extend `ImportResult` to track mode used and overall updated count
  - [x] 3.3 Refactor importMetaModelFromExcel function signature
    - Add `mode: ImportMode` parameter
    - Update return type to include updated row statistics
    - Located in: `frontend/src/utils/excelOperations.ts`
  - [x] 3.4 Implement entity-first processing order
    - Use `entityTabNames` array from gridConfigs for entity ordering
    - Process all entity worksheets first
    - Then process relationship worksheets using `relationshipTabNames`
    - Existing code reference: lines 559-594 in excelOperations.ts
  - [x] 3.5 Implement row matching by name field for entities
    - Build name-to-row lookup map for existing entities
    - For each imported row, check if name already exists
    - Apply Append vs Overwrite logic based on match result
    - Preserve existing row ID when updating in Overwrite mode
  - [x] 3.6 Handle ID generation for new rows
    - Generate new IDs for rows that don't match any existing row
    - Use existing ID generation pattern from the codebase
    - Ensure IDs are unique within the combined set (existing + imported)
  - [x] 3.7 Update IMPORT_META_MODEL action or add new action
    - Consider adding IMPORT_META_MODEL_OVERWRITE action for Overwrite mode
    - Or enhance existing IMPORT_META_MODEL to accept update vs append behavior
    - Located in: `frontend/src/contexts/ArchitectureContext.tsx`
  - [x] 3.8 Ensure import core logic tests pass
    - Run ONLY the 5-6 tests written in 3.1
    - Verify entity-first ordering and row matching work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5-6 tests written in 3.1 pass
- Entities are always processed before relationships
- Row matching uses case-sensitive name comparison
- Append mode skips existing rows, Overwrite mode updates them
- Existing row IDs are preserved when updating

---

### Task Group 4: Relationship Import with FK Validation

**Dependencies:** Task Group 3 (import core logic)

This task group implements relationship import with non-blocking FK validation.

- [x] 4.0 Complete relationship import with FK validation
  - [x] 4.1 Write 4-5 focused tests for relationship FK validation
    - Test FK resolution against combined entity set (existing + newly imported)
    - Test unresolved FK produces validation error but row is still imported
    - Test logical_data_attribute_physical_data_attributes is excluded from row matching
    - Test validation errors include row number and unresolved reference details
    - Test import continues processing after FK validation error (non-blocking)
  - [x] 4.2 Implement combined entity lookup for FK resolution
    - Build lookup map combining existing entities with newly imported entities
    - Entity names from import are available for relationship FK resolution
    - Name-based resolution (not ID-based)
  - [x] 4.3 Implement non-blocking FK validation
    - Validate FK references for each relationship row
    - If FK cannot be resolved, add validation error but continue import
    - Store error details: row number, field name, unresolved reference value
    - Do NOT abort import on validation errors
  - [x] 4.4 Exclude logical_data_attribute_physical_data_attributes from row matching
    - Skip deduplication logic for this specific relationship type
    - Import all rows as-is (append only, even in Overwrite mode)
    - Surface validation errors if FK references cannot be resolved
    - Spec rationale: logical-physical attribute mapping is many-to-many without natural key
  - [x] 4.5 Apply Append/Overwrite logic to relationship rows
    - Use composite key matching based on FK field values for most relationships
    - For relationships without composite key, use ID matching
    - Preserve existing row ID when updating in Overwrite mode
  - [x] 4.6 Ensure relationship FK validation tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify FK validation is non-blocking
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 4.1 pass
- FK references resolve against combined (existing + imported) entity set
- Unresolved FKs produce validation errors but don't abort import
- logical_data_attribute_physical_data_attributes rows are imported as-is
- Validation error details are captured for summary display

---

### Task Group 5: Post-Import Summary Modal Enhancement

**Dependencies:** Task Groups 3 and 4 (import logic and validation)

This task group enhances the existing ImportSummaryModal to display Append/Overwrite statistics.

- [x] 5.0 Complete post-import summary modal enhancement
  - [x] 5.1 Write 3-4 focused tests for enhanced summary modal
    - Test modal displays rows added count per entity/relationship type
    - Test modal displays rows updated count (Overwrite mode)
    - Test modal displays rows skipped count (Append mode duplicates)
    - Test modal displays validation errors with row number and details
  - [x] 5.2 Extend WorksheetImportResult to include update statistics
    - Add `rowsUpdated: number` field to WorksheetImportResult interface
    - Modify `calculateTotals` function to include totalUpdated
    - Located in: `frontend/src/utils/excelOperations.ts` (interface)
    - Located in: `frontend/src/components/common/ImportSummaryModal.tsx` (display)
  - [x] 5.3 Update ImportSummaryModal to display updated count
    - Add "Rows Updated" column to summary table
    - Display count only when mode is Overwrite (hide column in Append mode)
    - Update overall status badge to reflect update statistics
  - [x] 5.4 Enhance validation error display
    - Show row number for each validation error
    - Show field name that has the unresolved reference
    - Show the unresolved reference value (entity name that wasn't found)
    - Group errors by worksheet for clarity
  - [x] 5.5 Ensure summary modal tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify all statistics display correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- Summary modal shows added, updated, and skipped counts per worksheet
- Validation errors display with sufficient detail for debugging
- Modal layout handles both Append and Overwrite mode statistics

---

### Task Group 6: Test Review and Gap Analysis

**Dependencies:** Task Groups 1-5

This task group reviews existing tests and fills critical gaps.

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-4 tests written by Task Group 1 (menu disabled state)
    - Review the 4-5 tests written by Task Group 2 (import mode modal)
    - Review the 5-6 tests written by Task Group 3 (import core logic)
    - Review the 4-5 tests written by Task Group 4 (relationship FK validation)
    - Review the 3-4 tests written by Task Group 5 (summary modal enhancement)
    - Total existing tests: approximately 19-24 tests
  - [x] 6.2 Analyze test coverage gaps for XLSX import redesign feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Add tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows:
      - Full import flow: file select -> mode modal -> import -> summary
      - Edge case: import when meta-model is empty (skip modal)
      - Edge case: import file with no matching worksheets
      - Edge case: import with all rows having FK validation errors
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 27-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass
  - [x] 6.5 Document any known limitations or future improvements
    - Note any edge cases not covered
    - Suggest potential enhancements for future iterations

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 27-32 tests total)
- Critical user workflows for XLSX import redesign are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Menu Disabled State** - Simple UI change, can be completed quickly
2. **Task Group 2: Import Mode Modal** - Can be developed in parallel with Task Group 1
3. **Task Group 3: Import Core Logic Refactoring** - Core functionality, requires Task Groups 1 & 2
4. **Task Group 4: Relationship Import with FK Validation** - Builds on Task Group 3
5. **Task Group 5: Post-Import Summary Modal Enhancement** - Requires Task Groups 3 & 4 complete
6. **Task Group 6: Test Review and Gap Analysis** - Final verification

---

## Key Implementation Notes

### Row Matching Logic

Most entities use the `name` field as the unique key for matching:
- `business_users.name`
- `business_processes.name`
- `applications.name`
- `services.name`
- `logical_data_entities.name`
- etc.

### Relationship Exclusion

The `logical_data_attribute_physical_data_attributes` relationship type is explicitly excluded from row matching because:
- It represents many-to-many logical-to-physical attribute mappings
- There is no natural unique key (both FKs can have duplicates)
- All imported rows should be added as-is

### Import Mode Decision Tree

```
If meta-model has existing data:
  -> Show ImportModeModal
  -> User selects Append or Overwrite
Else (meta-model is empty):
  -> Implicitly use Overwrite mode
  -> Skip modal display
```

### FK Resolution Order

1. Parse all entity worksheets and build combined lookup (existing + imported)
2. Process relationship worksheets using the combined lookup
3. Validate FK references against the combined set
4. Non-blocking: import rows even with invalid FKs, surface errors

---

## Reference Files

| File | Description |
|------|-------------|
| `frontend/src/utils/excelOperations.ts` | Current import/export implementation (lines 541-700) |
| `frontend/src/components/TopBar/TopBar.tsx` | Current import handler (lines 437-466) |
| `frontend/src/components/TopBar/FileMenu.tsx` | Menu component with disabled pattern (lines 249-256) |
| `frontend/src/components/common/ImportSummaryModal.tsx` | Existing summary modal |
| `frontend/src/config/gridConfigs.ts` | entityTabNames, relationshipTabNames arrays |
| `frontend/src/contexts/ArchitectureContext.tsx` | IMPORT_META_MODEL action (lines 940-973) |

---

## Implementation Notes (2026-01-11)

### Task Group 6.5: Known Limitations and Future Improvements

**Known Limitations:**

1. **Row Matching by Name Only**: The current implementation matches rows by the `name` field only. If an entity type does not have a `name` field, or the `name` field is optional, row matching may not work as expected.

2. **FK Validation Scope**: FK validation only checks that the referenced entity ID exists in the combined entity set. It does not validate that the entity type matches the expected FK target type.

3. **No Undo Support**: XLSX import is an irreversible operation within the session. Users must save after import to persist changes, but there is no built-in undo mechanism.

4. **Large File Performance**: The import is processed synchronously in the browser. Very large XLSX files (thousands of rows) may cause UI responsiveness issues.

**Future Improvements:**

1. **Configurable Matching Keys**: Allow administrators to configure which field(s) to use for row matching per entity type.

2. **Dry Run Mode**: Add a "preview" option that shows what would be imported without actually modifying the model.

3. **Batch Import Progress**: For large imports, add a progress indicator showing current worksheet and row count.

4. **Import History**: Track import operations with timestamps and statistics for audit purposes.

5. **Selective Worksheet Import**: Allow users to select which worksheets to import rather than importing all recognized sheets.

---

## Test Results Summary

All 41 tests pass:
- Task Group 1: 4 tests (menu disabled state)
- Task Group 2: 7 tests (import mode modal)
- Task Group 3: 8 tests (import core logic)
- Task Group 4: 9 tests (relationship FK validation)
- Task Group 5: 5 tests (summary modal enhancement)
- Task Group 6: 8 tests (integration and gap coverage)
