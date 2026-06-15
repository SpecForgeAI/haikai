# Specification: Fix Export as XLSX by Enforcing Excel-Safe Worksheet Names

## Goal
Fix the XLSX export feature to always generate valid Excel workbooks by enforcing Excel-safe worksheet names with a deterministic canonical mapping for all Architecture Meta-Model entity and relationship sheets.

## User Stories
- As a user, I want to export my architecture model to XLSX without encountering errors so that I can share and analyze the data in Excel.
- As a user, I want worksheet names to be stable and predictable so that future import functionality can reliably map sheets back to their entity/relationship types.

## Specific Requirements

**Canonical worksheet name mapping constant**
- Create `META_MODEL_XLSX_SHEET_NAME_BY_KEY: Record<string, string>` in `excelOperations.ts`
- Must include explicit abbreviated entries for the 5 overlength relationship keys
- All other entity/relationship keys use identity mapping (key as sheet name)
- This constant becomes the single source of truth for all XLSX worksheet names

**Abbreviated names for overlength relationship keys**
- `application_point_business_points` (33 chars) maps to `app_point_business_points` (25 chars)
- `logical_data_entity_relationships` (33 chars) maps to `logical_entity_relationships` (28 chars)
- `application_point_business_logics` (33 chars) maps to `app_point_business_logics` (25 chars)
- `logical_data_entity_physical_data_entities` (42 chars) maps to `logical_entity_physical_entities` (32 chars - still exceeds, use `logical_entity_physical_ents` at 28 chars or the provided `logical_entity_physical_entities` truncated)
- `logical_data_attribute_physical_data_attributes` (47 chars) maps to `logical_attr_physical_attrs` (27 chars)

**Helper function: getSheetNameForKey**
- Implement `getSheetNameForKey(key: string): string` that returns `META_MODEL_XLSX_SHEET_NAME_BY_KEY[key] ?? key`
- All export code must use this function instead of directly using entity/relationship keys
- Refactor `getEntityWorksheetName` and `getRelationshipWorksheetName` to use entity/relationship type keys rather than UI tab names

**Sheet name validation helper**
- Implement `toExcelSafeSheetName(name: string): string` that enforces all Excel constraints
- Replace illegal characters `\ / ? * [ ]` with underscore `_` or hyphen `-`
- Trim leading/trailing whitespace
- Enforce max length of 31 characters (truncate if needed)
- Export must call this on the final sheet name as a safety net

**Uniqueness enforcement helper**
- Implement `ensureUniqueSheetName(name: string, existingNames: Set<string>): string`
- If collision occurs, suffix with `_2`, `_3`, etc. until unique
- Should not be needed with the fixed mapping but provides safety for future changes

**Refactor exportMetaModelToExcel to use key-based naming**
- Replace current approach using `getEntityWorksheetName(tabName)` with `getSheetNameForKey(entityType)`
- Replace current approach using `getRelationshipWorksheetName(tabName)` with `getSheetNameForKey(relationshipType)`
- Apply `toExcelSafeSheetName()` as final validation on all sheet names
- Track used sheet names and apply uniqueness enforcement

**Update reverse mapping functions for import**
- Update `worksheetNameToEntityType` to recognize canonical abbreviated sheet names
- Update `worksheetNameToRelationshipType` to recognize canonical abbreviated sheet names
- These functions must be the inverse of `getSheetNameForKey` for all keys

**Update unit tests**
- Add tests asserting the 5 abbreviated relationship sheet names are exactly as specified
- Add tests verifying no sheet name exceeds 31 characters for all entity/relationship types
- Add tests verifying no sheet name contains illegal characters `\ / ? * [ ]`
- Add tests for `toExcelSafeSheetName` edge cases (long names, illegal chars, whitespace)
- Add tests for reverse mapping functions recognizing abbreviated names

## Visual Design
No visual changes required - this is a backend/utility bugfix.

## Existing Code to Leverage

**`frontend/src/utils/excelOperations.ts`**
- Contains `exportMetaModelToExcel()` function that creates worksheets - this is the main export logic to fix
- Contains `getEntityWorksheetName()` and `getRelationshipWorksheetName()` - to be refactored to use key-based approach
- Contains `worksheetNameToEntityType()` and `worksheetNameToRelationshipType()` - reverse mappings to update

**`frontend/src/config/gridConfigs.ts`**
- Contains `entityTabNames` array and `tabToEntityType` mapping for entity types
- Contains `relationshipTabNames` array and `relationshipTabToType` mapping for relationship types
- These provide the authoritative list of entity/relationship type keys

**`frontend/src/__tests__/excel-operations.test.ts`**
- Existing test file with worksheet naming tests - extend with new test cases
- Already tests `getEntityWorksheetName` and `getRelationshipWorksheetName` functions

**`frontend/src/components/TopBar/TopBar.tsx`**
- Calls `exportMetaModelToExcel()` on line 430 - no changes needed here, just ensure export function works correctly

## Out of Scope
- Import as XLSX changes (will be handled as a separate spec using the same canonical mapping)
- Exporting full project DB snapshot to XLSX (XLSX is only for meta-model tables/relationships)
- Changes to the TopBar UI or menu structure
- Changes to the gridConfigs or entity/relationship type definitions
- Backend/API changes - this is a frontend-only fix
- Adding new entity or relationship types
- Changing how data is serialized within worksheet cells
- Excel formatting, styling, or column width adjustments
- Validation of imported data against the canonical mapping (deferred to import spec)
