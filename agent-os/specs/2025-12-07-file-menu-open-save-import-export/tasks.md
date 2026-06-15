# Task Breakdown: File Menu with Open/Save/Import/Export Meta-Model

## Overview
Total Tasks: 32

This feature replaces the "Architecture Tool" label and separate "Load JSON" / "Save" buttons with a unified File menu dropdown in the top bar, adding Excel import/export capabilities for the meta-model.

## Task List

### Task Group 1: Dependencies and Setup
**Dependencies:** None

- [x] 1.0 Complete dependencies setup
  - [x] 1.1 Install SheetJS/xlsx library
    - Run: `npm install xlsx` in frontend directory
    - Verify types are included (xlsx ships with TypeScript definitions)
  - [x] 1.2 Create excelOperations.ts utility file
    - Create file: `frontend/src/utils/excelOperations.ts`
    - Add placeholder exports for `exportMetaModelToExcel` and `importMetaModelFromExcel`
  - [x] 1.3 Verify xlsx import works in project
    - Add test import in excelOperations.ts
    - Verify no bundler/TypeScript errors

**Acceptance Criteria:**
- xlsx package installed and listed in package.json dependencies
- excelOperations.ts file created with placeholder exports
- No TypeScript or bundler errors when importing xlsx

---

### Task Group 2: Top Bar Layout Restructuring
**Dependencies:** Task Group 1

- [x] 2.0 Complete top bar layout changes
  - [x] 2.1 Write 3-5 focused tests for TopBar layout changes
    - Test File button renders in left position
    - Test Load JSON and Save buttons are removed
    - Test filename display remains in right area
    - Test Meta-model/Diagrams tabs remain centered
  - [x] 2.2 Remove "Architecture Tool" logo from TopBar
    - In `frontend/src/components/TopBar/TopBar.tsx`
    - Remove or replace the `.logo` div element
  - [x] 2.3 Add FileMenu placeholder in left position
    - Add File button element where logo was
    - Style as dropdown trigger with chevron indicator
  - [x] 2.4 Remove Load JSON and Save buttons from actions area
    - Keep the filename display span
    - Keep the hidden file input element (needed for Open)
  - [x] 2.5 Update TopBar.module.css for new layout
    - Add `.fileMenuContainer` styles
    - Add `.fileMenuButton` styles matching existing action buttons
    - Add chevron/dropdown indicator styling
  - [x] 2.6 Ensure top bar layout tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify layout renders correctly

**Acceptance Criteria:**
- File button appears in left position where logo was
- Load JSON and Save buttons removed from right side
- Filename display remains visible
- Meta-model/Diagrams tabs remain centered
- Visual styling is consistent with existing design

---

### Task Group 3: File Menu Component
**Dependencies:** Task Group 2

- [x] 3.0 Complete File menu dropdown component
  - [x] 3.1 Write 4-6 focused tests for FileMenu component
    - Test menu opens on File button click
    - Test menu closes on outside click
    - Test menu closes on Escape key
    - Test menu items render: Open, Save, Import Meta-Model, Export Meta-Model
    - Test menu item click triggers callback and closes menu
  - [x] 3.2 Create FileMenu.tsx component
    - Create file: `frontend/src/components/TopBar/FileMenu.tsx`
    - Follow ElementContextMenu pattern for dropdown behavior
    - Props: visible, onClose, onOpen, onSave, onImport, onExport
    - Use ReactDOM.createPortal for rendering
  - [x] 3.3 Create FileMenu.module.css styles
    - Create file: `frontend/src/components/TopBar/FileMenu.module.css`
    - Match ElementContextMenu.module.css styling pattern
    - Style: `.menu`, `.menuItem`, `.menuItem:hover`, `.separator` (if needed)
  - [x] 3.4 Implement click-outside dismissal
    - Use useRef and useEffect pattern from ElementContextMenu
    - Add mousedown listener with setTimeout for immediate-dismiss prevention
  - [x] 3.5 Implement Escape key dismissal
    - Add keydown listener for Escape in useEffect
  - [x] 3.6 Position menu below File button
    - Calculate position based on button bounding rect
    - Use getClampedPosition pattern if needed for edge cases
  - [x] 3.7 Ensure FileMenu component tests pass
    - Run ONLY the 4-6 tests written in 3.1

**Acceptance Criteria:**
- FileMenu renders as dropdown below File button
- Menu contains Open, Save, Import Meta-Model, Export Meta-Model items
- Menu closes on outside click or Escape key
- Menu items trigger callbacks when clicked
- Visual styling matches ElementContextMenu

---

### Task Group 4: Open/Save Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete Open and Save menu integration
  - [x] 4.1 Write 3-4 focused tests for Open/Save functionality
    - Test Open triggers file input click
    - Test Save triggers download with correct filename
    - Test error modal displays on save validation errors
  - [x] 4.2 Wire Open menu item to existing file input
    - Move fileInputRef handling to FileMenu context
    - Connect Open click to `handleLoadClick` pattern
  - [x] 4.3 Wire Save menu item to existing save handler
    - Connect Save click to `handleSaveClick` pattern
    - Use `state.loadedFileName || getDefaultFileName()` for filename
  - [x] 4.4 Integrate FileMenu with TopBar state
    - Add visible state for FileMenu in TopBar
    - Pass error modal setters to FileMenu or handle in TopBar
  - [x] 4.5 Ensure Open/Save tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify JSON load/save behavior unchanged

**Acceptance Criteria:**
- Open menu item opens file chooser for .json files
- Save menu item downloads current model as JSON
- Filename follows existing pattern (loaded name or default)
- Error handling same as previous Load JSON/Save buttons

---

### Task Group 5: Excel Export Implementation
**Dependencies:** Task Group 4

- [x] 5.0 Complete Excel export functionality
  - [x] 5.1 Write 4-6 focused tests for Excel export
    - Test export creates workbook with correct worksheet names
    - Test entity worksheets have correct column headers from gridConfigs displayName
    - Test relationship worksheets named with hyphen (not `<->`)
    - Test derived entities (application_points, business_points, app_business_points) are excluded
    - Test export triggers download with correct filename
  - [x] 5.2 Implement getExportableEntityTypes utility function
    - In `frontend/src/utils/excelOperations.ts`
    - Return entity types from entityTabNames via tabToEntityType mapping
    - Exclude: application_points, business_points, app_business_points
  - [x] 5.3 Implement getExportableRelationshipTypes utility function
    - Return relationship types from relationshipTabNames via relationshipTabToType mapping
  - [x] 5.4 Implement worksheet naming functions
    - `getEntityWorksheetName(tabName)` - returns tab name (max 31 chars)
    - `getRelationshipWorksheetName(tabName)` - replaces `<->` with `-`, truncates to 31 chars
  - [x] 5.5 Implement exportMetaModelToExcel function
    - Create xlsx workbook using `XLSX.utils.book_new()`
    - For each exportable entity type:
      - Get column configs from gridConfigs[entityType]
      - Extract displayName for headers
      - Get data from model.metaModel.entities[entityType]
      - Create worksheet with `XLSX.utils.json_to_sheet()`
      - Add to workbook with entity worksheet name
    - For each exportable relationship type:
      - Similar process for model.metaModel.relationships[relationshipType]
      - Add to workbook with relationship worksheet name (hyphen format)
    - Generate filename: `{loadedFileName}-metamodel.xlsx` or `architecture-metamodel.xlsx`
    - Trigger download using `XLSX.writeFile()`
  - [x] 5.6 Wire Export Meta-Model menu item to export function
    - Connect menu item click to exportMetaModelToExcel
    - Pass model and filename from state
  - [x] 5.7 Ensure Excel export tests pass
    - Run ONLY the 4-6 tests written in 5.1

**Acceptance Criteria:**
- Export creates .xlsx file with entity and relationship worksheets
- Column headers use displayName from gridConfigs
- Worksheet names follow convention (entities: tab name, relationships: hyphen format)
- Derived entities excluded from export
- Download triggered with appropriate filename

---

### Task Group 6: Excel Import Implementation
**Dependencies:** Task Group 5

- [x] 6.0 Complete Excel import functionality
  - [x] 6.1 Write 5-8 focused tests for Excel import
    - Test import parses worksheet to entity arrays
    - Test rows are appended to existing model (not overwritten)
    - Test duplicate IDs are skipped
    - Test missing required fields generate validation errors
    - Test FK references are validated
    - Test import returns summary with counts
  - [x] 6.2 Implement worksheet-to-entity-type mapping
    - Create `worksheetNameToEntityType(sheetName)` function
    - Map worksheet names back to entity types using tabToEntityType
  - [x] 6.3 Implement worksheet-to-relationship-type mapping
    - Create `worksheetNameToRelationshipType(sheetName)` function
    - Map worksheet names (with hyphen) back to relationship types
  - [x] 6.4 Implement row validation function
    - Create `validateImportRow(row, entityType, existingIds, model)` function
    - Check for duplicate ID in existingIds set
    - Check required fields from gridConfigs[entityType]
    - Check FK references exist in model for fk_typeahead columns
    - Return: { valid: boolean, errors: string[] }
  - [x] 6.5 Implement importMetaModelFromExcel function
    - Read .xlsx file using `XLSX.read()` with FileReader
    - For each worksheet:
      - Map to entity or relationship type
      - Parse rows with `XLSX.utils.sheet_to_json()`
      - Map displayName headers back to field names
      - Validate each row
      - Collect valid rows and validation errors
    - Return: { importedCounts, skippedCounts, errors, newEntities, newRelationships }
  - [x] 6.6 Wire Import Meta-Model menu item to import function
    - Add file input for .xlsx files (accept=".xlsx")
    - Connect Import click to trigger file input
    - Process selected file through importMetaModelFromExcel
    - Dispatch action to append imported data to model
  - [x] 6.7 Ensure Excel import tests pass
    - Run ONLY the 5-8 tests written in 6.1

**Acceptance Criteria:**
- Import reads .xlsx file and parses worksheets
- Rows are appended to existing model arrays
- Duplicate IDs are skipped (not imported)
- Missing required fields generate validation errors
- FK references are validated
- Import returns summary with success/skip/error counts

---

### Task Group 7: Import Summary Modal
**Dependencies:** Task Group 6

- [x] 7.0 Complete Import Summary Modal
  - [x] 7.1 Write 3-5 focused tests for ImportSummaryModal
    - Test modal displays per-worksheet summary
    - Test imported/skipped/error counts shown correctly
    - Test specific validation errors listed with row number
    - Test OK button dismisses modal
  - [x] 7.2 Create ImportSummaryModal component
    - Create file: `frontend/src/components/common/ImportSummaryModal.tsx`
    - Extend Modal component pattern
    - Props: isOpen, onClose, importResults
  - [x] 7.3 Define ImportResult type interface
    - Add to `frontend/src/types/config.ts` or separate types file
    - Include: worksheetName, entityType, rowsImported, rowsSkipped, errors[]
    - Error type: { row: number, field: string, message: string }
  - [x] 7.4 Implement per-worksheet summary display
    - Table or list showing: Entity/Relationship name, Imported, Skipped, Errors
    - Visual indicators (green for success, red for errors)
  - [x] 7.5 Implement error details section
    - Expandable or scrollable list of specific errors
    - Show: row number, field name, error message
    - Group by worksheet for clarity
  - [x] 7.6 Wire ImportSummaryModal to import flow
    - Show modal after import completes
    - Pass importResults from importMetaModelFromExcel
  - [x] 7.7 Ensure ImportSummaryModal tests pass
    - Run ONLY the 3-5 tests written in 7.1

**Acceptance Criteria:**
- Modal displays after import completion
- Shows per-worksheet summary with counts
- Lists specific validation errors with row/field details
- OK button dismisses modal
- Styling consistent with existing Modal/ErrorModal

---

### Task Group 8: Testing and Integration
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review and fill testing gaps
  - [x] 8.1 Review all tests from Task Groups 2-7
    - Verify approximately 22-34 tests exist across groups
    - Check coverage of critical user workflows
  - [x] 8.2 Add integration tests if gaps identified
    - Maximum 8 additional tests
    - Focus on end-to-end workflows:
      - Full Open -> Edit -> Save cycle
      - Full Export -> Import round-trip data integrity
      - Menu interaction flow
  - [x] 8.3 Manual testing verification
    - Test Open with valid JSON file
    - Test Save produces valid JSON
    - Test Export creates valid .xlsx with all expected worksheets
    - Test Import appends data correctly
    - Test Import validation catches errors
    - Test menu keyboard navigation (Escape to close)
  - [x] 8.4 Run feature-specific test suite
    - Run all tests from Task Groups 2-7 plus any new tests
    - Verify all pass
    - Do NOT run entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical workflows covered: Open, Save, Export, Import
- Menu interactions work correctly
- No regressions in existing functionality

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Dependencies** - Install xlsx library, create utility file
2. **Task Group 2: Top Bar Layout** - Restructure TopBar, remove old buttons
3. **Task Group 3: File Menu Component** - Create dropdown menu with dismiss behavior
4. **Task Group 4: Open/Save Integration** - Wire existing JSON handlers to menu
5. **Task Group 5: Excel Export** - Implement Export Meta-Model functionality
6. **Task Group 6: Excel Import** - Implement Import Meta-Model with validation
7. **Task Group 7: Import Summary Modal** - Create modal for import results display
8. **Task Group 8: Testing** - Review coverage, add integration tests, verify

## Key Files to Create/Modify

### New Files
- `frontend/src/utils/excelOperations.ts` - Excel import/export logic
- `frontend/src/components/TopBar/FileMenu.tsx` - File menu dropdown component
- `frontend/src/components/TopBar/FileMenu.module.css` - FileMenu styles
- `frontend/src/components/common/ImportSummaryModal.tsx` - Import results modal

### Modified Files
- `frontend/package.json` - Add xlsx dependency
- `frontend/src/components/TopBar/TopBar.tsx` - Layout restructuring, FileMenu integration
- `frontend/src/components/TopBar/TopBar.module.css` - Updated layout styles
- `frontend/src/types/config.ts` - ImportResult type definition

## Key Implementation References

### Pattern Files to Reference
- `frontend/src/components/DiagramsView/ElementContextMenu.tsx` - Dropdown menu pattern
- `frontend/src/components/DiagramsView/ElementContextMenu.module.css` - Menu styling
- `frontend/src/components/common/Modal.tsx` - Modal component pattern
- `frontend/src/utils/fileOperations.ts` - File handling patterns

### Configuration Files to Use
- `frontend/src/config/gridConfigs.ts` - Entity/relationship configs
  - `gridConfigs` - Column definitions per entity type
  - `tabToEntityType` - Entity tab name to type mapping
  - `relationshipTabToType` - Relationship tab name to type mapping
  - `entityTabNames` - List of entity tab names
  - `relationshipTabNames` - List of relationship tab names

### Derived Entities to Exclude from Export
- `application_points` - Derived from Applications, App Components, Services
- `business_points` - Derived from Business Processes, Process Activities
- `app_business_points` - Lookup entity for Application Point + Business Point combinations
