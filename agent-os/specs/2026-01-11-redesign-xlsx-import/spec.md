# Specification: Redesign Import as XLSX for Architecture Meta-Model

## Goal
Re-implement XLSX import for the Architecture Meta-Model to be safe, deterministic, aligned with real modelling use-cases, and the logical inverse of the fixed Export as XLSX.

## User Stories
- As a data architect, I want to import meta-model data from Excel so that I can bulk-load entities and relationships from external sources
- As a user, I want clear feedback on import results so that I understand what was added, updated, or failed validation

## Specific Requirements

**Active project precondition**
- Import as XLSX menu item must be disabled when no active project is loaded (no loadedFileName in state)
- Follow the existing disabled pattern from Save menu item (menuItemDisabled CSS class)
- Rationale: XLSX import mutates the active project's meta-model

**XLSX import scope limited to meta-model**
- Import only entities and relationships from Architecture & Design domain
- Exclude Product & Delivery data, diagrams, implementation context, and runtime data
- Use only the worksheets that Export as XLSX produces

**Canonical worksheet name resolution**
- Use META_MODEL_XLSX_SHEET_NAME_BY_KEY mapping (5 abbreviated relationship names)
- Use XLSX_SHEET_NAME_TO_KEY reverse mapping for import recognition
- Match worksheets via exact key match or sanitized Excel-safe normalization
- Silently ignore unknown worksheets without error

**Entity-first, relationship-second import order**
- Process all entity worksheets before any relationship worksheets
- Entities must exist before relationships can attempt FK resolution
- Use entityTabNames and relationshipTabNames arrays for ordering

**Row matching by logical unique key**
- Most entities: match by `name` field (case-sensitive)
- Composite uniqueness: use same logic enforced by frontend meta-model tables
- Match using existing model data combined with already-imported rows in current batch

**Logical-Physical Attribute relationship exclusion**
- Do NOT attempt row matching for logical_data_attribute_physical_data_attributes
- Import these rows as-is without deduplication
- Surface validation errors if FK references cannot be resolved

**Append vs Overwrite mode selection**
- Show modal dialog when meta-model contains any existing rows (entities or relationships)
- Options: Append (add new only, ignore duplicates) or Overwrite (update matching, add missing)
- Skip dialog and use Overwrite implicitly when meta-model is empty
- Never clear existing data unless user explicitly chose Overwrite

**Append mode behavior**
- Check each imported row against unique key (name for most entities)
- If no match exists: add new row
- If match exists: skip/ignore imported row (preserve existing)
- No modification of existing data

**Overwrite mode behavior**
- Check each imported row against unique key
- If no match exists: add new row
- If match exists: update existing row fields with Excel data
- Preserve IDs of existing rows when updating

**Relationship FK resolution**
- Resolve entity name references against combined set: existing entities + newly imported entities
- Resolution is name-based (same as current implementation)
- Unresolved references produce validation errors, not hard failures

**Non-blocking validation errors**
- Import must NOT abort due to unresolved FK references
- Add rows with invalid references to in-memory table
- Mark row as invalid and surface error in UI
- Continue processing remaining rows

**Post-import summary modal**
- Display count of rows added per entity/relationship type
- Display count of rows updated (Overwrite mode)
- Display count of rows ignored/skipped (Append mode duplicates)
- Display list of validation errors with row number and unresolved reference details

## Existing Code to Leverage

**`frontend/src/utils/excelOperations.ts`**
- META_MODEL_XLSX_SHEET_NAME_BY_KEY constant for canonical worksheet name mapping (5 overlength keys)
- XLSX_SHEET_NAME_TO_KEY reverse mapping for import sheet resolution
- getSheetNameForKey(), worksheetNameToEntityType(), worksheetNameToRelationshipType() helper functions
- Existing importMetaModelFromExcel() function to refactor (current implementation appends only)

**`frontend/src/config/gridConfigs.ts`**
- entityTabNames and relationshipTabNames arrays for import ordering
- tabToEntityType and relationshipTabToType mappings for type resolution
- gridConfigs[type] for field definitions, required fields, and FK targets

**`frontend/src/components/TopBar/FileMenu.tsx`**
- saveDisabled prop and menuItemDisabled CSS pattern for disabled menu items
- handleImportXlsxClick handler and excelInputRef for file picker

**`frontend/src/contexts/ArchitectureContext.tsx`**
- IMPORT_META_MODEL action for appending entities/relationships (needs enhancement for Overwrite mode)
- Action payload structure: { entities: Record<string, unknown[]>, relationships: Record<string, unknown[]> }

**`frontend/src/components/common/ImportSummaryModal.tsx`**
- Existing modal for import result display (may need enhancement for Overwrite statistics)

## Out of Scope
- Backend API changes - this is frontend-only XLSX parsing and state management
- Full project snapshot import - XLSX is meta-model only, JSON handles full project
- Automatic FK creation - unresolved references produce errors, not new entities
- Diagrams or diagram node import from XLSX
- Product & Delivery section data import from XLSX
- Runtime data or implementation context import
- Undo/redo support for XLSX imports
- Column reordering tolerance - headers must match Export format exactly
- Multi-file batch import
- Asynchronous/background import processing
