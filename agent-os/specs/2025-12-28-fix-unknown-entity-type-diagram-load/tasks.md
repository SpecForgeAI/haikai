# Task Breakdown: Fix Unknown Entity Type Error on Diagram Load

## Overview
Total Tasks: 15 (across 3 task groups)

This specification addresses the "unknown entity type" validation error that occurs when loading diagrams containing new behavioural domain entities (CLASS, METHOD, EVENT, STATE, ACTIVITY, ACTIVITY_PARTITION). The solution involves creating a centralized entity type registry and updating both rendering.ts and validation.ts to use it.

## Task List

### Registry and Core Utilities

#### Task Group 1: Create Centralized Entity Type Registry
**Dependencies:** None

- [x] 1.0 Complete centralized entity type registry module
  - [x] 1.1 Write 4-6 focused tests for entity type registry
    - Test that DIAGRAM_NODE_ENTITY_TYPE_MAP contains all 20 expected entity types
    - Test that mapping returns correct MetaModelEntities keys for CLASS, METHOD, EVENT, STATE, ACTIVITY, ACTIVITY_PARTITION
    - Test type safety of mapping keys against ENTITY_TYPES constants
    - Test that mapping values are valid keyof MetaModelEntities
    - Create test file: `src/__tests__/behavioural-entity-type-registration.test.ts`
    - Follow pattern from: `src/__tests__/endpoint-entity-type-registration.test.ts`
  - [x] 1.2 Create `src/utils/entityTypeRegistry.ts` module
    - Export DIAGRAM_NODE_ENTITY_TYPE_MAP constant with all entity type mappings
    - Use Record<string, keyof MetaModelEntities> type
    - Include all 20 entity types:
      - Existing: APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, ENDPOINT, BUSINESS_USER, BUSINESS_PROCESS, PROCESS_ACTIVITY, BUSINESS_POINT, LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY, APPLICATION_POINT, INTERACTION
      - New: CLASS -> 'classes', METHOD -> 'methods', EVENT -> 'events', STATE -> 'states', ACTIVITY -> 'activities', ACTIVITY_PARTITION -> 'activity_partitions'
      - Optional: LOGICAL_DATA_ATTRIBUTE -> 'logical_data_attributes', PHYSICAL_DATA_ATTRIBUTE -> 'physical_data_attributes' (if these can appear as diagram nodes)
  - [x] 1.3 Add JSDoc documentation to registry module
    - Document purpose: "Single source of truth for SCREAMING_SNAKE_CASE entity type to MetaModelEntities key mappings"
    - Document usage: "Used by rendering.ts and validation.ts for entity lookup"
    - Document format: "Keys are SCREAMING_SNAKE_CASE (e.g., 'APPLICATION'), values are snake_case plural (e.g., 'applications')"
  - [x] 1.4 Export helper function for getting known entity types list
    - Function: `getKnownEntityTypes(): string[]` that returns Object.keys(DIAGRAM_NODE_ENTITY_TYPE_MAP)
    - Used for improved error messages in validateDiagramNodes()
  - [x] 1.5 Ensure registry tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all entity type mappings resolve correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- entityTypeRegistry.ts exports DIAGRAM_NODE_ENTITY_TYPE_MAP with all 20 entity types
- getKnownEntityTypes() helper function works correctly
- JSDoc comments clearly explain the mapping purpose

### Refactoring Layer

#### Task Group 2: Update rendering.ts and validation.ts to Use Registry
**Dependencies:** Task Group 1

- [x] 2.0 Complete refactoring of rendering.ts and validation.ts
  - [x] 2.1 Write 4-6 focused tests for refactored functions
    - Test getEntityLabel() returns correct names for ACTIVITY, ACTIVITY_PARTITION, STATE, EVENT, CLASS, METHOD
    - Test getEntity() resolves these entity types to their meta-model arrays
    - Test validateDiagramNodes() produces no errors for diagrams with these node types
    - Test validateModel() diagram node validation accepts new entity types
    - Use minimal fixture model containing activities, activity_partitions, states, events, classes, methods arrays
    - Add tests to: `src/__tests__/behavioural-entity-type-registration.test.ts`
  - [x] 2.2 Refactor rendering.ts to use the centralized registry
    - Import DIAGRAM_NODE_ENTITY_TYPE_MAP from `./entityTypeRegistry`
    - Replace inline entityTypeMap (lines 10-24) with imported registry
    - No behavioral changes, only import source change
    - Preserve all existing function signatures: getEntityLabel(), getEntity(), validateDiagramNodes()
  - [x] 2.3 Refactor validation.ts to use the centralized registry
    - Import DIAGRAM_NODE_ENTITY_TYPE_MAP from `./entityTypeRegistry`
    - Replace inline entityTypeMap in validateModel() (lines 1002-1023) with imported registry
    - Maintain existing validation behavior for diagram nodes and edges
  - [x] 2.4 Improve error message in validateDiagramNodes()
    - Import getKnownEntityTypes from entityTypeRegistry
    - When node.entity_type is not found in registry, include list of known types in error message
    - Format: "Node <id> has unknown entity type <TYPE> (known types: APPLICATION, APP_COMPONENT, ..., ACTIVITY_PARTITION)"
    - Update error on line 1168 in rendering.ts
  - [x] 2.5 Ensure refactoring tests pass
    - Run ONLY the 4-6 tests written in 2.1 plus tests from 1.1
    - Verify getEntityLabel, getEntity, validateDiagramNodes work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass (plus 1.1 tests)
- rendering.ts uses DIAGRAM_NODE_ENTITY_TYPE_MAP from entityTypeRegistry.ts
- validation.ts uses DIAGRAM_NODE_ENTITY_TYPE_MAP from entityTypeRegistry.ts
- Inline entityTypeMap constants are removed from both files
- Error messages include list of known entity types when unknown type encountered
- No behavioral changes to existing functionality

### Testing and Verification

#### Task Group 3: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 4-6 tests from Task 1.1 (registry tests)
    - Review the 4-6 tests from Task 2.1 (refactoring tests)
    - Total existing tests: approximately 8-12 tests
  - [x] 3.2 Analyze test coverage gaps for this feature only
    - Identify critical workflows that lack test coverage
    - Focus ONLY on entity type registration and diagram loading
    - Do NOT assess entire application test coverage
  - [x] 3.3 Write up to 5 additional strategic tests maximum
    - Test edge case: entity exists in registry but not in model.metaModel.entities
    - Test edge case: diagram contains mix of old and new entity types
    - Test integration: full model validation with all 20 entity types
    - Test error message format includes all known types
    - Test backward compatibility: existing diagrams without new entity types still work
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests from behavioural-entity-type-registration.test.ts
    - Expected total: approximately 13-17 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 13-17 tests total)
- Critical entity type registration workflows are covered
- No more than 5 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Backward compatibility confirmed with existing diagrams

## Execution Order

Recommended implementation sequence:
1. Registry and Core Utilities (Task Group 1) - Create the centralized registry module
2. Refactoring Layer (Task Group 2) - Update rendering.ts and validation.ts to use registry
3. Testing and Verification (Task Group 3) - Review tests and fill critical gaps

## Files to Create/Modify

### New Files
- `frontend/src/utils/entityTypeRegistry.ts` - Centralized entity type registry module
- `frontend/src/__tests__/behavioural-entity-type-registration.test.ts` - Tests for new entity type registrations

### Modified Files
- `frontend/src/utils/rendering.ts` - Import and use centralized registry, improve error message
- `frontend/src/utils/validation.ts` - Import and use centralized registry

## Reference Implementation Details

### Registry Module Structure (entityTypeRegistry.ts)
```typescript
import { MetaModelEntities } from '../types/model';

/**
 * Centralized mapping of diagram node entity types (SCREAMING_SNAKE_CASE)
 * to MetaModelEntities keys (snake_case plural).
 *
 * This is the single source of truth for entity type mappings used by:
 * - rendering.ts: getEntityLabel(), getEntity(), validateDiagramNodes()
 * - validation.ts: validateModel() diagram node validation
 */
export const DIAGRAM_NODE_ENTITY_TYPE_MAP: Record<string, keyof MetaModelEntities> = {
  // Application domain
  APPLICATION: 'applications',
  APP_COMPONENT: 'app_components',
  SERVICE: 'services',
  INTERFACE: 'interfaces',
  ENDPOINT: 'endpoints',
  // Business domain
  BUSINESS_USER: 'business_users',
  BUSINESS_PROCESS: 'business_processes',
  PROCESS_ACTIVITY: 'process_activities',
  BUSINESS_POINT: 'business_points',
  // Data domain
  LOGICAL_DATA_ENTITY: 'logical_data_entities',
  PHYSICAL_DATA_ENTITY: 'physical_data_entities',
  // Derived entities
  APPLICATION_POINT: 'application_points',
  INTERACTION: 'interactions',
  // Behavioural domain (NEW)
  CLASS: 'classes',
  METHOD: 'methods',
  EVENT: 'events',
  STATE: 'states',
  ACTIVITY: 'activities',
  ACTIVITY_PARTITION: 'activity_partitions',
};

/**
 * Get list of all known entity types for error messages.
 * @returns Array of SCREAMING_SNAKE_CASE entity type strings
 */
export function getKnownEntityTypes(): string[] {
  return Object.keys(DIAGRAM_NODE_ENTITY_TYPE_MAP);
}
```

### Error Message Format
```
Error loading diagram: Node node-123 has unknown entity type UNKNOWN_TYPE (known types: APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, ENDPOINT, BUSINESS_USER, BUSINESS_PROCESS, PROCESS_ACTIVITY, BUSINESS_POINT, LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY, APPLICATION_POINT, INTERACTION, CLASS, METHOD, EVENT, STATE, ACTIVITY, ACTIVITY_PARTITION)
```

## Out of Scope Reminders
- No changes to backend persistence or Liquibase migrations
- No changes to how diagrams are stored in the database
- No adding new entity types beyond those already defined in model.ts
- No modifying diagram canvas rendering logic
- No changes to palette or Create-and-Place drawer functionality
- No changes to grid configurations or MetaModel view
- No UI changes or new user-facing features beyond improved error messages
