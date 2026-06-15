# Specification: Interfaces Entity and Interface-Logical Entities Relationship

## Goal
Add a new "Interfaces" meta-model entity representing API contracts and integration points owned by Services, along with an "Interface-Logical Entities" relationship that links interfaces to the data entities they expose or consume, enabling comprehensive application architecture modeling with data lineage at the interface level.

## User Stories
- As an architect, I want to define interfaces (REST APIs, message topics, etc.) under services so that I can document integration contracts and their ownership.
- As a data steward, I want to link logical data entities to interfaces so that I can track which data is exposed through which integration points.

## Specific Requirements

**Interface Entity Data Model**
- Add `Interface` type with fields: `id`, `name`, `description`, `service_id` (FK to services), `interface_type` (enum), `spec_link`, `tags`, `valid_from`, `valid_to`
- Add `interfaces: Interface[]` to `MetaModelEntities` interface in `model.ts`
- Enum values for `interface_type`: `REST_API`, `GRAPHQL_API`, `MESSAGE_TOPIC`, `STREAM`, `FILE_TRANSFER`, `SOAP_API`, `RPC`, `OTHER`
- Default `interface_type` to `REST_API` for new rows; default `tags` to empty array

**Interface-Logical Entities Relationship Data Model**
- Add `InterfaceLogicalEntity` type with fields: `id`, `interface_id` (FK), `logical_entity_id` (FK), `description`, `tags`, `valid_from`, `valid_to`
- Add `interface_logical_entities: InterfaceLogicalEntity[]` to `MetaModelRelationships` interface
- Relationship semantics: many-to-many between interfaces and logical_data_entities with temporal validity

**Grid Configuration for Interfaces**
- Add `interfaces` grid config to `gridConfigs` in `gridConfigs.ts` with columns: ID (auto-generate), Name (required), Description, Service (fk_typeahead to services, required), Interface Type (dropdown, required), Spec Link, Tags, Valid From, Valid To
- Add `'Interfaces': 'interfaces'` to `tabToEntityType` mapping
- Insert "Interfaces" into `entityTabNames` array after "Services" (position index 6)
- Update `domainGroupings.application` to include "Interfaces" after "Services"

**Grid Configuration for Interface-Logical Entities Relationship**
- Add `interface_logical_entities` grid config with columns: ID (auto-generate), Interface (fk_typeahead to interfaces, required), Logical Entity (fk_typeahead to logical_data_entities, required), Description, Tags, Valid From, Valid To
- Add mapping to `relationshipTabToType`: `'Interface <-> Logical Entity': 'interface_logical_entities'`
- Add "Interface <-> Logical Entity" to `relationshipTabNames` array

**INTERFACE Diagram Node Type**
- Add `INTERFACE: 'INTERFACE'` to `ENTITY_TYPES` constant in `model.ts`
- Add `interfaces: 'interfaces'` mapping to `entityTypeMap` in `rendering.ts`
- Add `INTERFACE` color definition to `entityColors` in `defaults.ts` with distinct fill (suggest lighter purple/violet to complement SERVICE purple)
- Update `DiagramEntityType` union type to include `'INTERFACE'`

**Containment: Interfaces Inside Services**
- When adding INTERFACE node, determine parent Service via `interface.service_id`
- Create node with `parent_node_id` set to the Service node's ID
- Position using vertical stacking layout (reuse `calculateChildPositionWithHeights` from `compoundLayout.ts`)
- Parent Service must expand height to accommodate Interface children
- Interface nodes move with their parent Service node (existing parent-child movement logic)

**Containment: Logical Entities Inside Interfaces**
- When adding Interface-Logical Entity relationship to diagram, create Logical Entity node inside Interface node
- Set `parent_node_id` on Logical Entity node to the Interface node's ID
- Use vertical stacking layout inside Interface box for multiple Logical Entities
- Interface height auto-expands to fit all child Logical Entity nodes

**Palette Section for Interfaces**
- Add "Interfaces" section to `getPaletteSections` in `paletteData.ts` with `id: 'interfaces'`, `label: 'Interfaces'`, `type: 'entity'`
- Add `interfaces: ENTITY_TYPES.INTERFACE` mapping to `getEntityTypeConstant`
- Row enable logic: enabled if Interface active at current time AND owning Service active AND Service node present on diagram
- Disabled tooltip when Service not on diagram: "Add the parent Service to this diagram first"

**Palette Section for Interface-Logical Entities**
- Add "Interface <-> Logical Entities" section to palette under relationships grouping
- Display format: `<Interface Name> - <Logical Entity Name>`
- Row enable logic: enabled if relationship active AND Interface node on diagram AND Logical Entity not already child of this Interface
- When Interface node deleted from diagram, child Logical Entities removed and palette rows re-enabled

**Temporal Filtering Behavior**
- Apply `valid_from`/`valid_to` checks to Interface entity and Interface-Logical Entity relationship
- Interface visible only when: own valid period includes diagram time AND referenced Service is valid
- Relationship visible only when: own valid period includes diagram time AND both Interface and Logical Entity are valid
- Update `isEntityVisibleInPeriod` and `isRelationshipVisibleInPeriod` checks in `quarterUtils.ts` or `rendering.ts`

**Validation Rules**
- Required fields for Interface: `name`, `service_id`, `interface_type`
- FK validation: `service_id` must reference existing `services.id`
- Required fields for InterfaceLogicalEntity: `interface_id`, `logical_entity_id`
- FK validation: both foreign keys must reference existing entities
- Add entity types to validation arrays in `validation.ts`

## Visual Design
No visual mockups were provided. The Interface node should follow existing node rendering patterns with a distinct fill color (e.g., light cyan or lighter purple variant) to differentiate from Services while maintaining visual hierarchy as a child of Services.

## Existing Code to Leverage

**frontend/src/types/model.ts**
- Follow pattern of `Service` interface for Interface type definition (lines 73-84)
- Follow pattern of `LogicalDataEntityPhysicalDataEntity` for relationship type (lines 197-206)
- Extend `ENTITY_TYPES` constant with INTERFACE (lines 237-249)
- Extend `MetaModelEntities` and `MetaModelRelationships` interfaces (lines 426-447)

**frontend/src/config/gridConfigs.ts**
- Follow `services` grid config pattern for Interface columns (lines 62-72)
- Follow `logical_data_entity_physical_data_entities` pattern for relationship grid (lines 170-178)
- Extend `tabToEntityType`, `relationshipTabToType`, `entityTabNames`, `domainGroupings` (lines 221-269)

**frontend/src/utils/paletteData.ts**
- Follow existing entity section pattern in `getPaletteSections` (lines 48-99)
- Extend `getEntityTypeConstant` mapping (lines 15-28)
- Follow relationship section pattern for Interface-Logical Entities (lines 104-158)

**frontend/src/utils/compoundLayout.ts**
- Reuse `calculateChildPositionWithHeights` for positioning Interface inside Service (lines 118-140)
- Reuse `calculateParentSizeWithHeights` for auto-sizing parent containers (lines 184-208)
- Pattern for finding child entities (`findAppComponents`, `findProcessActivities`) can be adapted for findInterfacesForService

**frontend/src/config/defaults.ts**
- Add Interface color to `entityColors` following existing pattern (lines 286-296)
- Add `emptyModel` entity arrays for interfaces and interface_logical_entities (lines 363-388)

## Out of Scope
- Auto-creation of Service nodes when adding Interface (user must add Service first)
- Drag-and-drop reordering of Interface children within Service
- Visual connectors/edges between Interface and Logical Entity nodes (containment only)
- Interface inheritance or versioning
- Import/sync of interface definitions from external spec files (OAS, AsyncAPI)
- Editing of spec_link as a clickable hyperlink in the grid
- Diagram legend or key for interface types
- Batch operations for adding multiple interfaces at once
- Interface-to-Interface relationships or dependencies
- Physical data entity relationships to interfaces (only logical entities supported)
