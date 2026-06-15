# Task Breakdown: Interfaces Entity and Interface-Logical Entities Relationship

## Overview
Total Tasks: 42 sub-tasks across 5 task groups

This specification adds a new "Interfaces" meta-model entity representing API contracts owned by Services, along with an "Interface-Logical Entities" relationship linking interfaces to the data entities they expose or consume.

## Task List

### Data Model Layer

#### Task Group 1: Interface Entity and InterfaceLogicalEntity Relationship Types
**Dependencies:** None

- [x] 1.0 Complete Interface data model layer
  - [x] 1.1 Write 4-6 focused tests for Interface and InterfaceLogicalEntity types
    - Test Interface type definition with all required fields
    - Test InterfaceType enum values
    - Test InterfaceLogicalEntity relationship type
    - Test ENTITY_TYPES.INTERFACE constant
    - Test EntityType and DiagramEntityType union updates
  - [x] 1.2 Add InterfaceType enum to model.ts
    - **File:** `frontend/src/types/model.ts`
    - **Location:** After line 32 (after UserInteractionLevel)
    - Add enum type: `REST_API`, `GRAPHQL_API`, `MESSAGE_TOPIC`, `STREAM`, `FILE_TRANSFER`, `SOAP_API`, `RPC`, `OTHER`
    - Pattern: Follow `ActorHint` type definition (lines 20-28)
  - [x] 1.3 Add Interface type definition to model.ts
    - **File:** `frontend/src/types/model.ts`
    - **Location:** After line 84 (after Service interface)
    - Fields: `id`, `name`, `description`, `service_id` (FK), `interface_type` (InterfaceType), `spec_link`, `tags`, `valid_from`, `valid_to`
    - Pattern: Follow `Service` interface (lines 73-84)
  - [x] 1.4 Add InterfaceLogicalEntity relationship type to model.ts
    - **File:** `frontend/src/types/model.ts`
    - **Location:** After line 206 (after LogicalDataEntityPhysicalDataEntity)
    - Fields: `id`, `interface_id` (FK), `logical_entity_id` (FK), `description`, `tags`, `valid_from`, `valid_to`
    - Pattern: Follow `LogicalDataEntityPhysicalDataEntity` (lines 197-206)
  - [x] 1.5 Add INTERFACE to ENTITY_TYPES constant
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 249 (before closing brace of ENTITY_TYPES)
    - Add: `INTERFACE: 'INTERFACE'`
  - [x] 1.6 Add INTERFACE_LOGICAL_ENTITY to RELATIONSHIP_EDGE_TYPES constant
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 265 (before closing brace of RELATIONSHIP_EDGE_TYPES)
    - Add: `INTERFACE_LOGICAL_ENTITY: 'INTERFACE_LOGICAL_ENTITY'`
  - [x] 1.7 Extend MetaModelEntities interface
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 437 (before closing brace)
    - Add: `interfaces: Interface[]`
  - [x] 1.8 Extend MetaModelRelationships interface
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 447 (before closing brace)
    - Add: `interface_logical_entities: InterfaceLogicalEntity[]`
  - [x] 1.9 Update EntityType union type
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 472 (before semicolon)
    - Add: `| 'interfaces'`
  - [x] 1.10 Update RelationshipType union type
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 481 (before semicolon)
    - Add: `| 'interface_logical_entities'`
  - [x] 1.11 Update AnyEntity union type
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 495 (before semicolon)
    - Add: `| Interface`
  - [x] 1.12 Update AnyRelationship union type
    - **File:** `frontend/src/types/model.ts`
    - **Location:** Line 504 (before semicolon)
    - Add: `| InterfaceLogicalEntity`
  - [x] 1.13 Ensure data model tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify type definitions compile correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- TypeScript compiles without errors
- Interface and InterfaceLogicalEntity types are properly defined
- All union types are extended correctly

---

### Configuration Layer

#### Task Group 2: Grid Configurations and Defaults
**Dependencies:** Task Group 1

- [x] 2.0 Complete configuration layer
  - [x] 2.1 Write 4-6 focused tests for grid configurations
    - Test interfaces grid config structure
    - Test interface_logical_entities grid config structure
    - Test tabToEntityType mapping includes Interfaces
    - Test relationshipTabToType mapping includes Interface <-> Logical Entity
    - Test entityColors includes INTERFACE
    - Test emptyModel includes new arrays
  - [x] 2.2 Add interfaceTypeOptions to defaults.ts
    - **File:** `frontend/src/config/defaults.ts`
    - **Location:** After line 361 (after relationshipTypeOptions)
    - Add: `export const interfaceTypeOptions = ['REST_API', 'GRAPHQL_API', 'MESSAGE_TOPIC', 'STREAM', 'FILE_TRANSFER', 'SOAP_API', 'RPC', 'OTHER'];`
  - [x] 2.3 Add INTERFACE color to entityColors
    - **File:** `frontend/src/config/defaults.ts`
    - **Location:** Line 296 (before closing brace of entityColors)
    - Add: `INTERFACE: { background: '#E8EAF6', border: '#5C6BC0' }` (light indigo/violet to complement SERVICE purple)
    - Pattern: Follow existing color definitions (lines 286-296)
  - [x] 2.4 Add interfaces and interface_logical_entities to emptyModel
    - **File:** `frontend/src/config/defaults.ts`
    - **Location:** Lines 376 and 385 (in entities and relationships sections)
    - Add `interfaces: []` to entities
    - Add `interface_logical_entities: []` to relationships
  - [x] 2.5 Import interfaceTypeOptions in gridConfigs.ts
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** Line 13 (add to existing imports)
    - Add `interfaceTypeOptions` to imports from defaults
  - [x] 2.6 Add interfaces grid config
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** After line 72 (after services config)
    - Columns: ID (auto-generate), Name (required), Description, Service (fk_typeahead to services, required), Interface Type (dropdown with interfaceTypeOptions, required), Spec Link, Tags, Valid From, Valid To
    - Pattern: Follow `services` grid config (lines 62-72)
  - [x] 2.7 Add interface_logical_entities grid config
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** After line 178 (after logical_data_entity_physical_data_entities)
    - Columns: ID (auto-generate), Interface (fk_typeahead to interfaces, required), Logical Entity (fk_typeahead to logical_data_entities, required), Description, Tags, Valid From, Valid To
    - Pattern: Follow `logical_data_entity_physical_data_entities` (lines 170-178)
  - [x] 2.8 Add Interfaces to tabToEntityType mapping
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** After line 227 (after Services mapping)
    - Add: `'Interfaces': 'interfaces'`
  - [x] 2.9 Add Interface <-> Logical Entity to relationshipTabToType
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** After line 240 (after Logical <-> Physical Entities)
    - Add: `'Interface <-> Logical Entity': 'interface_logical_entities'`
  - [x] 2.10 Add Interfaces to entityTabNames array
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** After line 256 (after 'Services')
    - Insert `'Interfaces'` after 'Services' (position index 6)
  - [x] 2.11 Update domainGroupings.application
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** Line 267
    - Change to: `application: ['Applications', 'App Components', 'Services', 'Interfaces']`
  - [x] 2.12 Add Interface <-> Logical Entity to relationshipTabNames
    - **File:** `frontend/src/config/gridConfigs.ts`
    - **Location:** After line 276 (after 'Logical <-> Physical Entities')
    - Add: `'Interface <-> Logical Entity'`
  - [x] 2.13 Ensure configuration tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify grid configs are structured correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Grid tabs appear correctly in UI
- Dropdown options for interface_type work
- FK typeaheads resolve correctly

---

### Rendering Layer

#### Task Group 3: Node Rendering and Palette Integration
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete rendering and palette layer
  - [x] 3.1 Write 4-6 focused tests for rendering and palette
    - Test entityTypeMap includes INTERFACE mapping
    - Test getEntityTypeConstant includes interfaces mapping
    - Test getPaletteSections includes Interfaces section
    - Test getPaletteSections includes Interface <-> Logical Entities relationship section
    - Test relationshipTypeMap includes INTERFACE_LOGICAL_ENTITY
  - [x] 3.2 Add INTERFACE to entityTypeMap in rendering.ts
    - **File:** `frontend/src/utils/rendering.ts`
    - **Location:** Line 19 (before closing brace of entityTypeMap)
    - Add: `INTERFACE: 'interfaces'`
    - Pattern: Follow existing mappings (lines 10-19)
  - [x] 3.3 Add INTERFACE_LOGICAL_ENTITY to relationshipTypeMap
    - **File:** `frontend/src/utils/rendering.ts`
    - **Location:** Line 30 (before closing brace of relationshipTypeMap)
    - Add: `INTERFACE_LOGICAL_ENTITY: 'interface_logical_entities'`
  - [x] 3.4 Add interfaces mapping to getEntityTypeConstant
    - **File:** `frontend/src/utils/paletteData.ts`
    - **Location:** Line 26 (before closing brace of mapping object)
    - Add: `interfaces: ENTITY_TYPES.INTERFACE`
    - Note: Need to import INTERFACE from ENTITY_TYPES
  - [x] 3.5 Add Interfaces entity section to getPaletteSections
    - **File:** `frontend/src/utils/paletteData.ts`
    - **Location:** After line 84 (after services section)
    - Add section with id: 'interfaces', label: 'Interfaces', items from metaModel.entities.interfaces
    - Pattern: Follow `services` section (lines 79-84)
  - [x] 3.6 Add Interface <-> Logical Entities relationship section to getPaletteSections
    - **File:** `frontend/src/utils/paletteData.ts`
    - **Location:** After line 140 (after logical_data_entity_physical_data_entities section)
    - Add section with id: 'interface_logical_entities', label: 'Interface <-> Logical Entity'
    - Pattern: Follow existing relationship sections (lines 133-140)
  - [x] 3.7 Update getRelationshipEndpointEntities for INTERFACE_LOGICAL_ENTITY
    - **File:** `frontend/src/utils/rendering.ts`
    - **Location:** After line 220 (in the switch statement)
    - Add case for `INTERFACE_LOGICAL_ENTITY` that returns Interface and LogicalDataEntity endpoints
  - [x] 3.8 Ensure rendering tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify palette sections render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- INTERFACE nodes render with correct colors
- Palette shows Interfaces section
- Palette shows Interface <-> Logical Entity relationship section

---

### Validation Layer

#### Task Group 4: Validation Rules and Type Updates
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete validation layer
  - [x] 4.1 Write 4-6 focused tests for validation
    - Test required field validation for Interface (name, service_id, interface_type)
    - Test required field validation for InterfaceLogicalEntity (interface_id, logical_entity_id)
    - Test FK validation for service_id referencing services
    - Test FK validation for interface_id and logical_entity_id
    - Test interfaces added to entity type arrays in validateModel
  - [x] 4.2 Add interfaces to ENTITY_TYPE_DISPLAY_NAMES
    - **File:** `frontend/src/utils/validation.ts`
    - **Location:** Line 32 (before closing brace)
    - Add: `'interfaces': 'INTERFACE'`
  - [x] 4.3 Add interfaces to entityTypes array in validateModel
    - **File:** `frontend/src/utils/validation.ts`
    - **Location:** Line 539 (before closing bracket)
    - Add: `'interfaces'`
  - [x] 4.4 Add interfaces to entityArrays in validateJsonStructure
    - **File:** `frontend/src/utils/validation.ts`
    - **Location:** Line 730 (before closing bracket)
    - Add: `'interfaces'`
  - [x] 4.5 Add interface_logical_entities to relationshipArrays in validateJsonStructure
    - **File:** `frontend/src/utils/validation.ts`
    - **Location:** Line 766 (before closing bracket)
    - Add: `'interface_logical_entities'`
  - [x] 4.6 Add INTERFACE to entityTypeMap in validateModel
    - **File:** `frontend/src/utils/validation.ts`
    - **Location:** Line 599 (before closing brace)
    - Add: `INTERFACE: 'interfaces'`
  - [x] 4.7 Ensure validation tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify required field validation works
    - Verify FK validation works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Required fields are validated for Interface entity
- Required fields are validated for InterfaceLogicalEntity relationship
- FK references are validated correctly
- Validation errors display with correct entity type names

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written by Task Group 1 (data model)
    - Review the 4-6 tests written by Task Group 2 (configuration)
    - Review the 4-6 tests written by Task Group 3 (rendering/palette)
    - Review the 4-6 tests written by Task Group 4 (validation)
    - Total existing tests: approximately 16-24 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical workflows lacking coverage:
      - Adding Interface via grid and palette
      - Adding InterfaceLogicalEntity relationship
      - Temporal filtering behavior
      - Parent-child containment (Interface inside Service)
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Priority 1: Integration test for Interface creation flow
    - Priority 2: Integration test for InterfaceLogicalEntity creation
    - Priority 3: Test temporal filtering for Interface visibility
    - Priority 4: Test temporal filtering for InterfaceLogicalEntity visibility
    - Priority 5: Test Interface containment within Service node
    - Priority 6: Test cascade behavior when Service is deleted from diagram
    - Skip edge cases, performance tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 24-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-32 tests total)
- Critical workflows for Interface and InterfaceLogicalEntity are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Data Model Layer** - Type definitions in model.ts
2. **Task Group 2: Configuration Layer** - Grid configs, defaults, tab mappings
3. **Task Group 3: Rendering Layer** - Palette sections, entity type mappings
4. **Task Group 4: Validation Layer** - Required field and FK validation
5. **Task Group 5: Test Review** - Gap analysis and integration tests

---

## File Change Summary

### Primary Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | InterfaceType enum, Interface type, InterfaceLogicalEntity type, ENTITY_TYPES, RELATIONSHIP_EDGE_TYPES, MetaModelEntities, MetaModelRelationships, EntityType, RelationshipType, AnyEntity, AnyRelationship |
| `frontend/src/config/defaults.ts` | interfaceTypeOptions, entityColors.INTERFACE, emptyModel.entities.interfaces, emptyModel.relationships.interface_logical_entities |
| `frontend/src/config/gridConfigs.ts` | interfaces grid config, interface_logical_entities grid config, tabToEntityType, relationshipTabToType, entityTabNames, domainGroupings, relationshipTabNames |
| `frontend/src/utils/rendering.ts` | entityTypeMap, relationshipTypeMap, getRelationshipEndpointEntities |
| `frontend/src/utils/paletteData.ts` | getEntityTypeConstant, getPaletteSections |
| `frontend/src/utils/validation.ts` | ENTITY_TYPE_DISPLAY_NAMES, entityTypes array, entityArrays, relationshipArrays, entityTypeMap |

### New Test Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/interface-entity-types.test.ts` | Type definition tests |
| `frontend/src/__tests__/interface-grid-config.test.ts` | Grid configuration tests |
| `frontend/src/__tests__/interface-rendering.test.ts` | Rendering and palette tests |
| `frontend/src/__tests__/interface-validation.test.ts` | Validation rule tests |
| `frontend/src/__tests__/interface-integration.test.ts` | Integration tests |

---

## Out of Scope (per spec)

The following items are explicitly out of scope and should NOT be implemented:
- Auto-creation of Service nodes when adding Interface
- Drag-and-drop reordering of Interface children within Service
- Visual connectors/edges between Interface and Logical Entity nodes (containment only)
- Interface inheritance or versioning
- Import/sync of interface definitions from external spec files (OAS, AsyncAPI)
- Editing of spec_link as a clickable hyperlink in the grid
- Diagram legend or key for interface types
- Batch operations for adding multiple interfaces at once
- Interface-to-Interface relationships or dependencies
- Physical data entity relationships to interfaces (only logical entities supported)

---

## Notes on Containment Behavior

### Interface Inside Service
When adding an INTERFACE node to a diagram:
1. Determine parent Service via `interface.service_id`
2. Find the Service node on the diagram
3. Create Interface node with `parent_node_id` set to Service node's ID
4. Position using `calculateChildPositionWithHeights` from `compoundLayout.ts`
5. Parent Service expands height to accommodate Interface children

### Logical Entity Inside Interface
When adding Interface-Logical Entity relationship to diagram:
1. Create Logical Entity node inside Interface node
2. Set `parent_node_id` on Logical Entity node to Interface node's ID
3. Use vertical stacking layout inside Interface box
4. Interface height auto-expands to fit child Logical Entity nodes

### Palette Enable/Disable Logic
- Interface row enabled if: Interface active at current time AND owning Service active AND Service node present on diagram
- Disabled tooltip: "Add the parent Service to this diagram first"
- InterfaceLogicalEntity row enabled if: relationship active AND Interface node on diagram AND Logical Entity not already child of this Interface

---

## Implementation Notes

### Implementation completed on 2025-12-02

All 5 task groups have been successfully implemented:

1. **Data Model Layer** - Added `InterfaceType`, `Interface`, and `InterfaceLogicalEntity` types to `model.ts`, along with ENTITY_TYPES.INTERFACE, RELATIONSHIP_EDGE_TYPES.INTERFACE_LOGICAL_ENTITY, and updated all relevant union types.

2. **Configuration Layer** - Added `interfaceTypeOptions`, INTERFACE entity color (#E8EAF6 background, #5C6BC0 border), grid configs for both interfaces and interface_logical_entities, tab mappings, and updated emptyModel.

3. **Rendering Layer** - Added INTERFACE to entityTypeMap, INTERFACE_LOGICAL_ENTITY to relationshipTypeMap, interfaces mapping in getEntityTypeConstant, palette sections for both Interfaces and Interface <-> Logical Entity, and containment support functions (supportsChildNodes, getParentEntityType, isChildEntityType).

4. **Validation Layer** - Added interfaces to ENTITY_TYPE_DISPLAY_NAMES, entityTypes array, JSON structure validation arrays, and entityTypeMap. Also added validateScopedInterfaceNames function for scoped name uniqueness within the same service.

5. **Testing** - Created comprehensive test suite with 46 tests covering all task groups in `frontend/src/__tests__/interfaces-entity-relationship.test.ts`.

### Test Results
- All 46 tests pass
- TypeScript compiles without errors
- Tests consolidated into single file instead of multiple files as originally planned
