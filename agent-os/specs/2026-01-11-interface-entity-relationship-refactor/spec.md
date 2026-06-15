# Specification: Interface Entity Relationship Refactor

## Goal
Rename the "Interface <-> Logical Entity" relationship to "Interface <-> Entity" and update the "Logical Entity" field to "Data Entity" to allow selection of either Logical or Physical data entities, using the same selector UI as the Data Movements relationship.

## User Stories
- As an architect, I want to associate an Interface with either a Logical or Physical Data Entity so that I can accurately model interfaces that expose physical database tables or logical domain entities.
- As a user, I want the Data Entity selector to use the same grouped dropdown with type tags as Data Movements so that the UI is consistent across similar fields.

## Specific Requirements

**Relationship rename in UI**
- Update display name from "Interface <-> Logical Entity" to "Interface <-> Entity" in relationshipTabToType mapping (gridConfigs.ts line 544)
- Update display name in RELATIONSHIP_DEFINITIONS array (relationshipDefinitions.ts lines 86-89)
- Update RELATIONSHIP_TAB_ORDER array (relationshipDefinitions.ts line 230)
- Update relationshipTabNames array (gridConfigs.ts line 625)

**Grid column configuration update**
- Replace the current fk_typeahead column for logical_entity_id with a data_entity_point_picker column
- Change field name from "logical_entity_id" to "dataEntityPointId" for consistency with Data Movements
- Change displayName from "Logical Entity" to "Data Entity"
- Use cellType "data_entity_point_picker" to enable the grouped dropdown selector

**Relationship definition endpoint types update**
- Update endpointEntityTypes in RELATIONSHIP_DEFINITIONS from ['interfaces', 'logical_data_entities'] to ['interfaces', 'logical_data_entities', 'physical_data_entities', 'data_entity_points']
- This ensures the relationship appears correctly in domain-derived filtering

**Frontend TypeScript type update**
- Rename InterfaceLogicalEntity interface in model.ts to InterfaceEntity (or keep name for backward compat)
- Replace logical_entity_id: string field with dataEntityPointId: string field
- Update MetaModelRelationships interface to use new type name if renamed

**Backend DTO update**
- Update InterfaceLogicalEntityDto.java to add dataEntityPointId field following DataMovementDto pattern
- Keep logical_entity_id field for backward compatibility during migration or remove if doing clean break
- Update JSON property annotations to include dataEntityPointId

**Backend Entity update**
- Update InterfaceLogicalEntityEntity.java to add data_entity_point_id column
- Keep logical_entity_id column temporarily for backward compatibility or use migration strategy
- Update table mapping with new column

**EntityMapper update**
- Update toDto and toEntity methods for InterfaceLogicalEntity in EntityMapper.java (lines 1433-1456)
- Add mapping for dataEntityPointId field
- Handle backward compatibility: if dataEntityPointId is null, derive from logical_entity_id using "dep_log_" prefix

**XLSX import/export handling**
- Relationship key "interface_logical_entities" is used directly as worksheet name (under 31 chars)
- No entry in META_MODEL_XLSX_SHEET_NAME_BY_KEY needed for abbreviation
- Update gridConfigs column definitions so export writes the new "Data Entity" column header
- Import should handle both legacy "Logical Entity" column and new "Data Entity" column

## Existing Code to Leverage

**DataEntityPointSelect component (frontend/src/components/Grid/DataEntityPointSelect.tsx)**
- Provides searchable grouped dropdown with LOGICAL DATA ENTITIES and PHYSICAL DATA ENTITIES sections
- Uses dep_log_<id> and dep_phy_<id> prefixes for entity identification
- Reuse directly by setting cellType to "data_entity_point_picker" in grid config

**dataEntityPointOptions utility (frontend/src/utils/dataEntityPointOptions.ts)**
- buildDataEntityPointOptions() function generates dropdown options from model entities
- resolveDataEntityPointLabel() resolves point IDs to display labels
- DATA_ENTITY_POINT_PREFIXES constants: LOGICAL = 'dep_log_', PHYSICAL = 'dep_phy_'
- parseDataEntityPointId() extracts entity type and ID from point ID

**Data Movements implementation pattern**
- DataMovementDto.java and DataMovementEntity.java use dataEntityPointId field
- data_movements grid config uses cellType: 'data_entity_point_picker' with field: 'dataEntityPointId'
- Follow identical pattern for Interface Entity relationship

**GridCell component (frontend/src/components/Grid/GridCell.tsx)**
- Already handles data_entity_point_picker cellType (lines 218-232)
- Renders DataEntityPointSelect component with relationship context props for label cache

**excelOperations.ts XLSX handling**
- Uses key-based worksheet naming via getSheetNameForKey()
- Reverse mapping via XLSX_SHEET_NAME_TO_KEY for import
- Column headers derived from gridConfigs displayName values

## Out of Scope
- Changes to the Data Movements relationship behavior or UI (reference implementation only)
- Diagram rendering changes unless diagrams explicitly depend on the old relationship name or structure
- Creating new database migration scripts for existing data (simple compatibility handling via code)
- Renaming the relationship key from "interface_logical_entities" to a new key (would require too many changes)
- Renaming the backend table from "interface_logical_entities" (keep existing table name)
- Updating PalettePanel or AdvancedAddDialog diagram integration code unless broken
- Changes to relationship domain visibility logic beyond updating endpointEntityTypes
- Cascade delete behavior changes in ArchitectureContext.tsx
- Creation of new test files or modification of existing test suites
- Backend controller or repository changes beyond DTO/Entity/Mapper updates
