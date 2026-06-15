# Specification: Remove Incorrect "Logical Entity" Field from Physical Entities

## Goal
Remove the redundant `logical_entity_id` field from the `PhysicalDataEntity` interface, as the Logical-to-Physical Entity mapping is already modeled by the authoritative `LogicalDataEntityPhysicalDataEntity` relationship table which supports 1:1, 1:M, M:1, and M:M cardinalities.

## User Stories
- As an architect, I want Physical Entities to be independent of Logical Entities at the entity level, so that I can model M:1 and M:M mappings correctly through the relationship table.
- As a data modeler, I want the relationship table to be the single source of truth for Logical-to-Physical mappings, so that I avoid data inconsistency from redundant fields.

## Specific Requirements

**Remove logical_entity_id from PhysicalDataEntity interface**
- In `frontend/src/types/model.ts`, remove the `logical_entity_id: string` field from the `PhysicalDataEntity` interface (line 135)
- The resulting PhysicalDataEntity interface should contain only: `id`, `name`, `description`, `physical_type`, `database`, `tags`, `valid_from`, `valid_to`
- No optional logical entity reference must remain on the entity itself

**Remove Logical Entity column from Physical Entities grid configuration**
- In `frontend/src/config/gridConfigs.ts`, remove the `logical_entity_id` column entry from the `physical_data_entities` grid config (around line 110)
- The column config at line 110 specifies: `{ field: 'logical_entity_id', displayName: 'Logical Entity', cellType: 'fk_typeahead', required: true, width: 150, fkTarget: 'logical_data_entities' }`
- This entire column configuration object must be removed from the array
- No column referencing logical entity should appear in the Physical Entities grid

**Update fileOperations.ts to strip logical_entity_id on load**
- In `frontend/src/utils/fileOperations.ts`, the `buildModelFromData` function (line 197) already constructs `physical_data_entities` from the raw JSON
- Modify the physical_data_entities parsing to explicitly omit any `logical_entity_id` field that might exist in legacy JSON files
- This should be a silent discard with no warning or migration - the field is simply ignored
- Follow the pattern used for migrating ProcessActivity fields (lines 127-183) but simpler - just omit the field

**Ensure save operation excludes logical_entity_id**
- In `frontend/src/utils/fileOperations.ts`, the `serializeModel` function (line 238) serializes the model
- Since the TypeScript interface no longer includes `logical_entity_id`, the field will naturally be excluded from saved JSON
- Verify no manual field inclusion exists that would re-add this field

**Confirm relationship table remains authoritative**
- The `LogicalDataEntityPhysicalDataEntity` relationship interface in `frontend/src/types/model.ts` (lines 190-199) must remain unchanged
- This relationship table with `logical_entity_id` and `physical_entity_id` fields is the only structure defining Logical-to-Physical mappings
- The `logical_data_entity_physical_data_entities` grid config in `frontend/src/config/gridConfigs.ts` (lines 164-172) must remain unchanged

**Update validation logic to not require logical_entity_id**
- In `frontend/src/utils/validation.ts`, the `validateRequiredFields` function (line 164) checks required fields based on grid config
- Once the column is removed from grid config, validation will automatically stop requiring the field
- No explicit change needed in validation.ts as it derives requirements from gridConfigs

**Update rendering utilities if needed**
- In `frontend/src/utils/rendering.ts`, review `getRelationshipEndpointEntities` function (lines 146-228)
- The `LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY` case (lines 187-194) correctly reads from the relationship record, not from PhysicalDataEntity
- No change needed here - already uses correct relationship-based lookup

**Update cascade delete to not reference logical_entity_id**
- In `frontend/src/utils/applicationPointSync.ts`, the `cascadeDeletePhysicalDataEntity` function (lines 543-560) already correctly references the relationship table
- Verify it does not attempt to read `logical_entity_id` from the entity itself
- Currently filters `logical_data_entity_physical_data_entities` by `physical_entity_id` - this is correct and unchanged

## Visual Design
Not applicable - this is a data model change with no new visual elements. The grid will simply have one fewer column.

## Existing Code to Leverage

**LogicalDataEntityPhysicalDataEntity relationship table**
- Located in `frontend/src/types/model.ts` lines 190-199
- Already correctly models the mapping with `logical_entity_id` and `physical_entity_id` fields
- Supports all cardinality patterns through multiple relationship records

**Grid configuration pattern**
- The `physical_data_entities` grid config in `frontend/src/config/gridConfigs.ts` uses the standard column config pattern
- Simply remove the offending column entry; other columns remain untouched

**ProcessActivity migration pattern in fileOperations.ts**
- The `migrateProcessActivity` function (lines 127-183) demonstrates how to transform loaded data
- For PhysicalDataEntity, use a simpler approach: destructure to omit `logical_entity_id` when building the entity

**Cascade delete for PhysicalDataEntity**
- The `cascadeDeletePhysicalDataEntity` function in `applicationPointSync.ts` already correctly uses the relationship table
- No modification needed - serves as reference for correct behavior

**Relationship grid configuration**
- The `logical_data_entity_physical_data_entities` grid config (lines 164-172) correctly defines the authoritative mapping table UI
- This remains unchanged and is the single source of truth for the mapping

## Out of Scope
- Migrating existing `logical_entity_id` values to the relationship table - legacy data is simply discarded
- Adding any warning or notification when legacy JSON contains the deprecated field
- Modifying the `LogicalDataEntityPhysicalDataEntity` relationship table in any way
- Changing the `Physical Entities` tab name or position in the UI
- Modifying the `logical_data_entity_physical_data_entities` relationship grid configuration
- Adding backward compatibility shims or migration utilities
- Modifying diagram rendering or edge creation logic - these already use the relationship table
- Adding new validation rules for the relationship table
- Creating database migration scripts (this is a frontend-only JSON model change)
- Modifying any backend Java code in the `backend/` directory
