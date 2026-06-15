# Specification: Data Movement Interface Schema Extension

## Goal
Extend the Data Movement relationship to support either a specific Data Entity level OR a higher-level Interface (with Schema) level, plus add a Bi-directional flag to capture movement directionality.

## User Stories
- As an architect, I want to define data movements at the interface level so that I can represent "many allowed data movements" compactly without creating rows for every entity.
- As an architect, I want to mark data movements as bi-directional so that I can accurately model two-way data flows without duplicate rows.

## Specific Requirements

**XOR Validation for Data Entity vs Interface (with Schema)**
- Exactly ONE of `dataEntityPointId` OR `interfaceWithSchemaId` must be set per row
- Both set: validation error "DATA_MOVEMENT must specify either Data Entity OR Interface (with Schema), not both"
- Neither set: validation error "DATA_MOVEMENT requires either Data Entity or Interface (with Schema)"
- Use non-blocking validation: row remains visible in table, error indicator shown on row/fields
- Add new validation error type `xor_constraint` to ValidationError types

**Mutual Exclusivity UX Behavior**
- When user selects `interfaceWithSchemaId` and `dataEntityPointId` is already populated: auto-clear `dataEntityPointId`
- When user selects `dataEntityPointId` and `interfaceWithSchemaId` is already populated: auto-clear `interfaceWithSchemaId`
- Show brief inline hint after clearing: "Cleared [field name] (use one or the other)"
- Implement in Grid.tsx cell change handler with field-pair awareness

**New Field: interfaceWithSchemaId**
- Field name: `interfaceWithSchemaId`
- Display name: "Interface (with Schema)"
- Cell type: `fk_typeahead` with `fkTarget: 'interfaces'`
- Required: `false` (nullable)
- Position: after `dataEntityPointId` column in grid config
- Semantics: when set, implies movable entities are those linked via Interface <-> Entity relationship

**New Field: biDirectional**
- Field name: `biDirectional`
- Display name: "Bi-directional?"
- Cell type: `boolean` (checkbox)
- Required: `false`
- Default value: `false`
- Position: after `interfaceWithSchemaId` column in grid config

**Update dataEntityPointId to Optional**
- Change `required: true` to `required: false` in gridConfigs.ts data_movements config
- Update TypeScript interface to make field optional: `dataEntityPointId?: string`
- Existing rows with `dataEntityPointId` remain valid and unchanged

**Database Migration**
- Migration file: `028-data-movement-interface-schema.sql`
- Make `data_entity_point_id` column nullable: `ALTER COLUMN data_entity_point_id DROP NOT NULL`
- Add `interface_with_schema_id VARCHAR(255) NULL`
- Add `bi_directional BOOLEAN NOT NULL DEFAULT FALSE`
- No data backfill needed - existing rows keep current values, new fields default to null/false

**XLSX Export Updates**
- Add columns: "Interface (with Schema)", "Bi-directional?"
- Position: after "Data Entity" column, before "Type" column
- Export `biDirectional` as "TRUE" or "FALSE" string (consistent with existing boolean convention)
- Export `interfaceWithSchemaId` as interface ID string
- If row uses Interface: leave Data Entity column blank
- If row uses Data Entity: leave Interface column blank

**XLSX Import Updates**
- Read new columns from worksheet
- Apply XOR validation during import (non-blocking - import row but flag as invalid if both/neither set)
- Resolve `interfaceWithSchemaId` by ID matching against interfaces collection
- Parse `biDirectional`: "TRUE"/"YES"/"1" -> true, other values -> false

## Existing Code to Leverage

**gridConfigs.ts data_movements configuration (lines 471-483)**
- Contains current Data Movement grid column definitions
- Pattern for `fk_typeahead` with `fkTarget` already used (see `interface_id` columns)
- Pattern for `boolean` cellType already exists (see `is_primary_key` in logical_data_attributes)
- Update this config to add new columns and change `dataEntityPointId` required to false

**validation.ts validation patterns (lines 253-323)**
- `validateRequiredFields()` handles field-level required validation
- `validateFKReferences()` handles FK reference validation with fkTarget lookup
- Error format: `{ entityType, entityId, entityName, field, message, type }`
- Add new `validateDataMovementXOR()` function following same pattern
- Add `xor_constraint` to validation error types

**DataMovementDto.java and DataMovementEntity.java**
- Current record/entity pattern for Data Movement
- Add new fields following same @JsonProperty/@Column pattern
- Change `nullable = false` to `nullable = true` on dataEntityPointId column

**EntityMapper.java toDto/toEntity methods (lines 1397-1431)**
- Pattern for mapping DataMovement between DTO and Entity
- Add mapping for new `interfaceWithSchemaId` and `biDirectional` fields
- Handle null values appropriately in mapping

**excelOperations.ts boolean export pattern**
- Boolean fields exported as "TRUE"/"FALSE" strings
- Import parses "true"/"yes"/"1" (case-insensitive) as true
- Follow same pattern for `biDirectional` field

## Out of Scope
- Diagram rendering changes for Data Movement visualization
- Auto-generation of per-entity movements from interface schema (this feature represents allowance compactly only)
- Changes to Interface <-> Entity relationship definition
- Backend XOR validation (frontend-only validation for this spec)
- Changes to movement_type dropdown options
- Changes to Source/Target App Point picker behavior
- Creating new cell type components (use existing fk_typeahead and boolean)
- Validation warning toast/notification system changes
- API endpoint changes beyond DTO/Entity field additions
- Changes to other relationship grids
