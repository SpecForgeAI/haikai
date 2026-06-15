# Specification: File Menu with Open/Save/Import/Export Meta-Model

## Goal
Replace the "Architecture Tool" label and separate "Load JSON" / "Save" buttons with a unified File menu in the top bar, adding Excel import/export capabilities for the meta-model while maintaining existing JSON persistence.

## User Stories
- As an architect, I want a File menu in the top bar so that I have a familiar interface for file operations
- As a data analyst, I want to import meta-model data from Excel so that I can populate the tool from existing spreadsheets

## Specific Requirements

**Top Bar Layout Restructuring**
- Remove the "Architecture Tool" label (`.logo` div) from the left side
- Add a File menu button in its place, styled as a dropdown trigger
- Remove the Load JSON and Save buttons from the right side (`.actions` div)
- Keep the filename display in the right side area
- Maintain centered Meta-model / Diagrams tabs (`.viewToggle`)

**File Menu Component**
- Create a new FileMenu component with dropdown behavior
- Menu items: Open, Save, Import Meta-Model, Export Meta-Model
- Use click-outside dismissal pattern (reference ElementContextMenu implementation)
- Menu appears below the File button, left-aligned
- Visual styling matches existing context menu patterns

**Open Menu Item (JSON)**
- Reuses existing `handleLoadClick` and `handleFileChange` handlers from TopBar
- Opens browser file chooser for .json files
- Behavior identical to current Load JSON button
- Closes menu on click

**Save Menu Item (JSON)**
- Reuses existing `handleSaveClick` handler from TopBar
- Uses `state.loadedFileName` or `getDefaultFileName()` for filename
- Behavior identical to current Save button
- Closes menu on click

**Import Meta-Model (Excel)**
- Opens browser file chooser for .xlsx files only
- Parses workbook using SheetJS/xlsx library
- Each worksheet maps to one entity or relationship table
- Worksheet naming: entity tabs use `tabToEntityType` keys, relationship tabs use `relationshipTabToType` keys with `<->` replaced by hyphen
- Append mode: imported rows are added to existing meta-model arrays (no overwrite)
- Validation: check for duplicate IDs, missing required fields per gridConfigs
- Shows ImportSummaryModal on completion with success counts and error list

**Export Meta-Model (Excel)**
- Generates .xlsx workbook in memory using SheetJS/xlsx
- Creates one worksheet per entity table and relationship table
- Column headers match `displayName` from gridConfigs for each entity/relationship type
- Only exports entity tables visible in UI tabs (entityTabNames) and relationship tables (relationshipTabNames)
- Excludes derived entities: application_points, business_points, app_business_points
- Triggers browser download with filename: `{loadedFileName}-metamodel.xlsx` or `architecture-metamodel.xlsx`

**Worksheet Naming Convention**
- Entity worksheets: Use keys from `tabToEntityType` (e.g., "Users", "Processes", "Applications")
- Relationship worksheets: Use keys from `relationshipTabToType` with `<->` replaced by `-` (e.g., "User - Business Point", "Logical - Physical Entities")
- Worksheet names limited to 31 characters (Excel constraint)

**Import Validation Rules**
- Skip rows with duplicate IDs (ID already exists in current model)
- Validate required fields based on gridConfigs[entityType] where `required: true`
- For FK fields (cellType: 'fk_typeahead'), validate referenced entity exists
- Collect all validation errors and continue processing remaining rows
- Track: rows imported, rows skipped (duplicates), rows with errors

**Import Summary Modal**
- Extends existing Modal component pattern
- Shows per-worksheet summary: entity name, rows imported, rows skipped, errors
- Lists specific validation errors with row number and field
- OK button dismisses modal

## Existing Code to Leverage

**ElementContextMenu Component Pattern**
- Use same dropdown positioning logic (`getClampedPosition` function)
- Use same click-outside dismissal pattern with `useRef` and `useEffect`
- Use same portal rendering pattern with `ReactDOM.createPortal`
- Reference styling from `ElementContextMenu.module.css` for menu appearance

**fileOperations.ts Utilities**
- Reuse `loadJsonFile`, `saveJsonFile`, `getDefaultFileName` for Open/Save
- Reference `triggerFileInput` pattern for file chooser triggering
- Follow same error handling pattern with ValidationError type

**Modal Component**
- Extend existing Modal from `components/common/Modal.tsx` for ImportSummaryModal
- Reference ErrorModal pattern for displaying lists of validation messages
- Use same styling from `Modal.module.css`

**gridConfigs.ts Configuration**
- Use `gridConfigs[entityType]` to get column definitions for export headers
- Use `tabToEntityType` and `relationshipTabToType` for worksheet naming
- Use column configs to determine required fields for import validation

## Out of Scope
- Importing/exporting diagrams (JSON only for full model persistence)
- Importing/exporting decorations or visual elements
- Overwrite mode for import (append only)
- Undo/redo for import operations
- Progress bar during import/export operations
- Excel formula support in export
- Cell formatting or styling in Excel export
- Importing from CSV or other formats
- Partial export (specific tables only)
- Auto-save functionality
