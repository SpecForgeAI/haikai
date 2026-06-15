# Specification: Fix Unknown Entity Type Error on Diagram Load

## Goal
Register all new diagram node entity types (CLASS, METHOD, EVENT, STATE, ACTIVITY, ACTIVITY_PARTITION) in the entityTypeMap so that diagrams containing these entities load without "unknown entity type" validation errors.

## User Stories
- As a user, I want to load diagrams containing Activity or Activity Partition nodes without seeing "unknown entity type" errors
- As a user, I want diagrams with State, Event, Class, or Method nodes to validate correctly on load

## Specific Requirements

**Extend entityTypeMap in rendering.ts**
- Add CLASS -> 'classes' mapping
- Add METHOD -> 'methods' mapping
- Add EVENT -> 'events' mapping
- Add STATE -> 'states' mapping
- Add ACTIVITY -> 'activities' mapping
- Add ACTIVITY_PARTITION -> 'activity_partitions' mapping
- Optionally add LOGICAL_DATA_ATTRIBUTE and PHYSICAL_DATA_ATTRIBUTE if these can appear as diagram nodes

**Create centralized entity type registry module**
- Create new file src/utils/entityTypeRegistry.ts as single source of truth
- Export DIAGRAM_NODE_ENTITY_TYPE_MAP constant with all SCREAMING_SNAKE_CASE -> MetaModelEntities key mappings
- Export type for the mapping keys for type safety
- Include JSDoc comments explaining the mapping purpose and format

**Refactor rendering.ts to use the registry**
- Import DIAGRAM_NODE_ENTITY_TYPE_MAP from entityTypeRegistry.ts
- Replace inline entityTypeMap with the imported registry
- Ensure getEntityLabel(), getEntity(), validateDiagramNodes() continue to work correctly
- No behavioral changes, only code centralization

**Update validation.ts to use the registry**
- Import DIAGRAM_NODE_ENTITY_TYPE_MAP from entityTypeRegistry.ts
- Replace the entityTypeMap inside validateModel() with the imported registry
- Maintain existing validation behavior for diagram nodes and edges

**Improve error message for unknown entity types**
- In validateDiagramNodes(), when node.entity_type is not found in registry, include list of known types in error message
- Format: "Node <id> has unknown entity type <TYPE> (known types: APPLICATION, APP_COMPONENT, ..., ACTIVITY_PARTITION)"
- Aids debugging when new entity types are added but not registered

**Add tests for new entity type registrations**
- Create new test file src/__tests__/behavioural-entity-type-registration.test.ts following endpoint-entity-type-registration.test.ts pattern
- Test that getEntityLabel() returns correct names for ACTIVITY, ACTIVITY_PARTITION, STATE, EVENT, CLASS, METHOD
- Test that getEntity() resolves these entity types to their meta-model arrays
- Test that validateDiagramNodes() produces no errors for diagrams with these node types
- Use minimal fixture model containing activities, activity_partitions, states, events, classes, methods arrays

## Existing Code to Leverage

**src/utils/rendering.ts entityTypeMap (lines 10-24)**
- Current inline map has 13 entity types registered
- Missing: CLASS, METHOD, EVENT, STATE, ACTIVITY, ACTIVITY_PARTITION
- Same structure will be used in the new registry module

**src/utils/validation.ts entityTypeMap (lines 1002-1023)**
- Duplicate map inside validateModel() with 20 entity types already registered
- Already includes ACTIVITY, ACTIVITY_PARTITION, STATE, EVENT, CLASS, METHOD
- Use this as the authoritative source for the centralized registry

**src/types/model.ts MetaModelEntities interface (lines 1463-1488)**
- Defines all valid entity array keys: activities, activity_partitions, states, events, classes, methods
- Use keyof MetaModelEntities for type-safe registry values

**src/__tests__/endpoint-entity-type-registration.test.ts**
- Follow this pattern for the new behavioural entity type tests
- Uses assertion helpers, creates minimal model fixtures
- Tests getEntityLabel, getEntity, validateDiagramNodes functions

**src/types/model.ts ENTITY_TYPES constant (lines 876-901)**
- Defines SCREAMING_SNAKE_CASE constants for all entity types
- ACTIVITY, ACTIVITY_PARTITION, STATE, EVENT, CLASS, METHOD already defined
- Use these constants in tests for consistency

## Out of Scope
- Changes to backend persistence or Liquibase migrations
- Changes to how diagrams are stored in the database
- Adding new entity types beyond those already defined in model.ts
- Modifying the diagram canvas rendering logic
- Changes to palette or Create-and-Place drawer functionality
- Adding new entity types to ENTITY_TYPE_DISPLAY_NAMES (already complete in validation.ts)
- Changes to grid configurations or MetaModel view
- Entity validation rules beyond type registration
- Performance optimizations
- UI changes or new user-facing features
