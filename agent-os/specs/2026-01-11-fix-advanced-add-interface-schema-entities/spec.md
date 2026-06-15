# Specification: Fix Advanced Add Interface Schema Entities

## Goal
Restore the previously working behaviour where the Advanced Add modal displays and allows selecting schema entities (both logical and physical) nested under an Interface, which regressed after changing the relationship from Interface-to-Logical Entity to Interface-to-Entity (unified dataEntityPointId field).

## User Stories
- As a diagram author, I want to see data entities under Interfaces in the Advanced Add tree so that I can include them in my architecture diagrams.
- As a diagram author, I want both logical and physical data entities displayed under Interfaces so that the full Interface schema is visible regardless of entity type.

## Specific Requirements

**Fix AdvancedAddDialog.tsx findRelatedEntities function**
- Location: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` lines 328-337
- The `case 'interface_logical_entities'` block currently reads `rel.logical_entity_id` which is deprecated
- Must use `parseDataEntityPointId()` to decode `rel.dataEntityPointId` from each relationship row
- Must resolve entities from both `logical_data_entities` and `physical_data_entities` collections based on parsed type
- Return format should include type indicator: `{ id, name, entityType }` to distinguish logical from physical

**Fix interfaceCompositeBuilder.ts getLogicalEntityIdsForInterface function**
- Location: `frontend/src/utils/interfaceCompositeBuilder.ts` lines 73-81
- Currently reads deprecated `rel.logical_entity_id` field
- Rename function to `getDataEntityIdsForInterface()` to reflect dual-type support
- Return object with grouped IDs: `{ logicalEntityIds: string[], physicalEntityIds: string[] }`
- Use `parseDataEntityPointId()` to decode each relationship row's `dataEntityPointId`

**Update buildInterfaceCompositeNodes function signature**
- Location: `frontend/src/utils/interfaceCompositeBuilder.ts` line 151
- Parameter `selectedLogicalEntityIds` should become `selectedDataEntityIds` object with both types
- Function must look up entities from both `logical_data_entities` and `physical_data_entities` collections
- Child entity nodes must be created for both entity types with appropriate styling

**Update advancedAddRelationships.ts INTERFACE configuration**
- Location: `frontend/src/utils/advancedAddRelationships.ts` lines 322-331
- Current config only defines `LOGICAL_DATA_ENTITY` as target with label "Logical Data Entities"
- Add second entry for `PHYSICAL_DATA_ENTITY` target type
- Both entries should use same `relationshipTableName: 'interface_logical_entities'` and `foreignKeyField: 'interface_id'`
- Set `displayLabel` to "Logical Data Entities" and "Physical Data Entities" respectively

**Create shared resolver utility function**
- Create `resolveDataEntitiesForInterface(metaModel, interfaceId)` function
- Place in `frontend/src/utils/dataEntityPointOptions.ts` alongside existing utilities
- Filter `interface_logical_entities` by `interface_id`, parse each `dataEntityPointId`, return grouped IDs
- Use this shared utility in both AdvancedAddDialog and interfaceCompositeBuilder to avoid divergence

**Display type badges in Advanced Add tree**
- Schema entities under Interface nodes should display with type tags: `[LOGICAL_DATA_ENTITY]` or `[PHYSICAL_DATA_ENTITY]`
- Follow existing badge display pattern from `resolveDataEntityPointLabel()` function

**Add regression test**
- Create test file in `frontend/src/__tests__/` folder
- Test should construct minimal metaModel with: Interface, logical entity, physical entity, relationship rows using dataEntityPointId
- Assert Advanced Add tree builder returns both entities under the Interface
- Prevent reintroduction of logical-only assumption

## Existing Code to Leverage

**parseDataEntityPointId() utility**
- Path: `frontend/src/utils/dataEntityPointOptions.ts` lines 164-184
- Parses `dep_log_<id>` and `dep_phy_<id>` format strings into `{ entityType: 'logical' | 'physical', entityId: string }`
- Handles null/empty input gracefully by returning null
- Must be imported and used in both AdvancedAddDialog and interfaceCompositeBuilder

**DATA_ENTITY_POINT_PREFIXES constants**
- Path: `frontend/src/utils/dataEntityPointOptions.ts` lines 52-55
- Defines `LOGICAL: 'dep_log_'` and `PHYSICAL: 'dep_phy_'` prefixes
- Use for consistent prefix handling if needed

**resolveDataEntityPointLabel() function**
- Path: `frontend/src/utils/dataEntityPointOptions.ts` lines 126-156
- Returns formatted label with type badge: `"[entityName] [LOGICAL_DATA_ENTITY]"`
- Demonstrates pattern for type-badged display labels to follow in Advanced Add

**Existing Advanced Add relationship patterns**
- Path: `frontend/src/utils/advancedAddRelationships.ts`
- Follow existing structure for adding PHYSICAL_DATA_ENTITY entry alongside LOGICAL_DATA_ENTITY
- Use `actsAsContainment: true` for both entries as with current logical-only entry

**buildInterfaceCompositeNodes structure**
- Path: `frontend/src/utils/interfaceCompositeBuilder.ts` lines 151-160
- Shows current signature and parameter naming conventions to preserve compatibility
- Entity lookup pattern for `metaModel.entities.logical_data_entities` to extend for physical

## Out of Scope
- Backend/model-service changes (relationship data already exists and is correctly stored)
- Changes to how Interface-to-Entity relationship rows are authored in the relationship grid
- Changes to the InterfaceLogicalEntity type definition in model.ts (dataEntityPointId field is already correct)
- Other Advanced Add nesting behaviours (applications, components, services, endpoints)
- Visual styling changes to the Advanced Add modal beyond adding type badges
- Performance optimizations for large entity sets
- Changes to the DataEntityPointSelect dropdown component
- Changes to the Interface-to-Entity relationship grid editing experience
- Migration of existing relationship data (dataEntityPointId field is already populated)
- Changes to diagram export/import functionality
