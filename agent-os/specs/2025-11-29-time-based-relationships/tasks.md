# Task Breakdown: Time-Based Relationships and Diagram Filtering

## Overview
Total Tasks: 4 Task Groups with approximately 24-30 sub-tasks

This feature extends the SDD Architecture Store with:
1. Temporal validity (`valid_from`/`valid_to`) support for all relationship types
2. Enhanced diagram filtering that validates both relationships and their endpoint entities
3. Comprehensive cascade delete when entities are removed from the meta-model

## Files to Modify

| File | Task Groups | Purpose |
|------|-------------|---------|
| `frontend/src/types/model.ts` | 1 | Add temporal fields to 5 relationship interfaces |
| `frontend/src/utils/rendering.ts` | 2 | Enhance `getEdgesForDiagram()` with endpoint entity validation |
| `frontend/src/utils/applicationPointSync.ts` | 3 | Add cascade delete functions for all entity types |
| `frontend/src/contexts/ArchitectureContext.tsx` | 3, 4 | Call cascade delete in DELETE_ENTITY action for all entity types |

---

## Task List

### Type Definitions Layer

#### Task Group 1: Add Temporal Fields to Relationship Interfaces
**Dependencies:** None

- [x] 1.0 Complete type definitions layer
  - [x] 1.1 Write 4-6 focused tests for relationship temporal field type validation
    - Test that BusinessUserProcess accepts valid_from/valid_to fields
    - Test that ApplicationPointBusinessProcess accepts valid_from/valid_to fields
    - Test that LogicalDataEntityRelationship accepts valid_from/valid_to fields
    - Test that mapping relationships (LDE-PDE, LDA-PDA) accept temporal fields
    - Test that existing DataMovement temporal fields continue to work
    - Test backward compatibility: relationships without temporal fields still valid
  - [x] 1.2 Add temporal fields to BusinessUserProcess interface
    - Add optional `valid_from?: string` field
    - Add optional `valid_to?: string` field
    - Add JSDoc comment: `// Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")`
  - [x] 1.3 Add temporal fields to ApplicationPointBusinessProcess interface
    - Add optional `valid_from?: string` field
    - Add optional `valid_to?: string` field
    - Add JSDoc comment for format documentation
  - [x] 1.4 Add temporal fields to LogicalDataEntityRelationship interface
    - Add optional `valid_from?: string` field
    - Add optional `valid_to?: string` field
    - Add JSDoc comment for format documentation
  - [x] 1.5 Add temporal fields to LogicalDataEntityPhysicalDataEntity interface
    - Add optional `valid_from?: string` field
    - Add optional `valid_to?: string` field
    - Add JSDoc comment for format documentation
  - [x] 1.6 Add temporal fields to LogicalDataAttributePhysicalDataAttribute interface
    - Add optional `valid_from?: string` field
    - Add optional `valid_to?: string` field
    - Add JSDoc comment for format documentation
  - [x] 1.7 Ensure type definitions compile and tests pass
    - Run TypeScript compiler to verify no type errors
    - Run ONLY the 4-6 tests written in 1.1
    - Verify existing code continues to work with new optional fields

**Acceptance Criteria:**
- All 5 relationship interfaces have optional `valid_from` and `valid_to` fields
- Fields use same format as entities: `"YYYY-Qn"` (e.g., "2026-Q3")
- Existing data without temporal fields continues to work (backward compatible)
- TypeScript compiler reports no errors
- The 4-6 tests written in 1.1 pass

---

### Diagram Filtering Layer

#### Task Group 2: Enhanced Edge Filtering with Endpoint Validation
**Dependencies:** Task Group 1 (COMPLETED)

- [x] 2.0 Complete enhanced diagram filtering layer
  - [x] 2.1 Write 6-8 focused tests for edge filtering with endpoint validation
    - Test edge hidden when relationship itself has valid_to in the past
    - Test edge hidden when relationship has valid_from in the future
    - Test edge hidden when source endpoint entity is not valid at viewQuarter
    - Test edge hidden when target endpoint entity is not valid at viewQuarter
    - Test edge visible when both relationship AND all endpoints are valid
    - Test edge visible for timeless relationships with timeless endpoints
    - Test BusinessUserProcess edge: validate business_user_id and business_process_id endpoints
    - Test DataMovement edge: validate source_application_id, target_application_id, and data_entity_id endpoints
  - [x] 2.2 Create helper function `getRelationshipEndpointEntities()` in rendering.ts
    - Input: relationship type, relationship object, MetaModel
    - Output: Array of endpoint entities to validate
    - Handle each relationship type's specific endpoint fields:
      - `business_user_processes`: BusinessUser (business_user_id - timeless), BusinessProcess (business_process_id - temporal)
      - `application_point_business_processes`: ApplicationPoint (application_point_id - temporal), BusinessProcess (business_process_id - temporal)
      - `logical_data_entity_relationships`: source LogicalDataEntity (source_entity_id), target LogicalDataEntity (target_entity_id) - both temporal
      - `logical_data_entity_physical_data_entities`: LogicalDataEntity (logical_entity_id - temporal), PhysicalDataEntity (physical_entity_id - temporal)
      - `logical_data_attribute_physical_data_attributes`: LogicalDataAttribute (logical_attribute_id - timeless), PhysicalDataAttribute (physical_attribute_id - timeless)
      - `data_movements`: Application (source_application_id), Application (target_application_id), LogicalDataEntity (data_entity_id) - all temporal
  - [x] 2.3 Update `getEdgesForDiagram()` in rendering.ts
    - After checking relationship visibility with `isRelationshipVisibleInPeriod()`
    - Call `getRelationshipEndpointEntities()` to get endpoint entities
    - For each endpoint entity, call `isEntityVisibleInPeriod()`
    - If ANY endpoint entity is not visible at viewQuarter, filter out the edge
    - Preserve existing visibleNodeIds check for diagram node visibility
  - [x] 2.4 Handle timeless entities correctly
    - BusinessUser has no temporal fields - always considered visible
    - LogicalDataAttribute has no temporal fields - always considered visible
    - PhysicalDataAttribute has no temporal fields - always considered visible
    - `isEntityVisibleInPeriod()` already returns true for entities without temporal fields
  - [x] 2.5 Ensure diagram filtering tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify edges filter correctly based on relationship validity
    - Verify edges filter correctly based on endpoint entity validity
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- Edges are hidden when relationship's validity window excludes viewQuarter
- Edges are hidden when ANY endpoint entity's validity window excludes viewQuarter
- Timeless relationships with timeless endpoints are always shown
- Changing the view quarter immediately updates edge visibility
- Existing diagram rendering behavior is preserved for non-temporal scenarios

**Existing Code to Leverage:**
- `quarterUtils.ts`: `isEntityVisibleInPeriod()` - already handles optional temporal fields
- `quarterUtils.ts`: `isRelationshipVisibleInPeriod()` - already handles optional temporal fields
- `rendering.ts`: `getRelationship()` - lookup relationship by type and ID
- `rendering.ts`: `getEntity()` - lookup entity by type and ID

---

### Cascade Delete Layer

#### Task Group 3: Comprehensive Cascade Delete for All Entity Types
**Dependencies:** Task Group 1 (COMPLETED)

- [x] 3.0 Complete cascade delete layer
  - [x] 3.1 Write 6-8 focused tests for cascade delete functionality
    - Test deleting BusinessUser cascades to business_user_processes
    - Test deleting BusinessProcess cascades to business_user_processes AND application_point_business_processes
    - Test deleting LogicalDataEntity cascades to logical_data_entity_relationships, logical_data_entity_physical_data_entities, AND data_movements (via data_entity_id)
    - Test deleting PhysicalDataEntity cascades to logical_data_entity_physical_data_entities
    - Test deleting LogicalDataAttribute cascades to logical_data_attribute_physical_data_attributes
    - Test deleting PhysicalDataAttribute cascades to logical_data_attribute_physical_data_attributes
    - Test existing Application/AppComponent/Service cascade delete still works (via ApplicationPoint)
  - [x] 3.2 Create `cascadeDeleteBusinessUser()` function in applicationPointSync.ts
    - Input: businessUserId, MetaModelRelationships
    - Filter out business_user_processes where business_user_id matches
    - Return updated MetaModelRelationships
    - Follow pattern from existing `cascadeDeleteApplicationPoint()`
  - [x] 3.3 Create `cascadeDeleteBusinessProcess()` function in applicationPointSync.ts
    - Input: businessProcessId, MetaModelRelationships
    - Filter out business_user_processes where business_process_id matches
    - Filter out application_point_business_processes where business_process_id matches
    - Return updated MetaModelRelationships
  - [x] 3.4 Create `cascadeDeleteLogicalDataEntity()` function in applicationPointSync.ts
    - Input: logicalEntityId, MetaModelRelationships
    - Filter out logical_data_entity_relationships where source_entity_id OR target_entity_id matches
    - Filter out logical_data_entity_physical_data_entities where logical_entity_id matches
    - Filter out data_movements where data_entity_id matches
    - Return updated MetaModelRelationships
  - [x] 3.5 Create `cascadeDeletePhysicalDataEntity()` function in applicationPointSync.ts
    - Input: physicalEntityId, MetaModelRelationships
    - Filter out logical_data_entity_physical_data_entities where physical_entity_id matches
    - Return updated MetaModelRelationships
  - [x] 3.6 Create `cascadeDeleteLogicalDataAttribute()` function in applicationPointSync.ts
    - Input: logicalAttributeId, MetaModelRelationships
    - Filter out logical_data_attribute_physical_data_attributes where logical_attribute_id matches
    - Return updated MetaModelRelationships
  - [x] 3.7 Create `cascadeDeletePhysicalDataAttribute()` function in applicationPointSync.ts
    - Input: physicalAttributeId, MetaModelRelationships
    - Filter out logical_data_attribute_physical_data_attributes where physical_attribute_id matches
    - Return updated MetaModelRelationships
  - [x] 3.8 Update DELETE_ENTITY action in ArchitectureContext.tsx
    - Import new cascade delete functions from applicationPointSync
    - Extend entity type handling to cover all types requiring cascade:
      - `business_users` -> call `cascadeDeleteBusinessUser()`
      - `business_processes` -> call `cascadeDeleteBusinessProcess()`
      - `logical_data_entities` -> call `cascadeDeleteLogicalDataEntity()`
      - `physical_data_entities` -> call `cascadeDeletePhysicalDataEntity()`
      - `logical_data_attributes` -> call `cascadeDeleteLogicalDataAttribute()`
      - `physical_data_attributes` -> call `cascadeDeletePhysicalDataAttribute()`
    - Preserve existing cascade for applications, app_components, services (via `cascadeDeleteForSourceEntity`)
  - [x] 3.9 Ensure cascade delete tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify each cascade delete function removes correct relationships
    - Verify DELETE_ENTITY action triggers appropriate cascade
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass
- Each entity type has a dedicated cascade delete function
- Deleting an entity removes all referencing relationships from JSON
- Existing ApplicationPoint cascade delete continues to work
- No orphaned relationships remain after entity deletion
- Deleted elements cannot be recovered by changing view quarter (permanent removal)

**Existing Code to Leverage:**
- `applicationPointSync.ts`: `cascadeDeleteApplicationPoint()` - pattern to follow
- `applicationPointSync.ts`: `cascadeDeleteForSourceEntity()` - existing Application/AppComponent/Service handling
- `ArchitectureContext.tsx`: DELETE_ENTITY case - existing structure to extend

---

### Testing Layer

#### Task Group 4: Test Review and Integration Testing
**Dependencies:** Task Groups 1, 2, 3 (ALL COMPLETED)

- [x] 4.0 Complete integration and verify all functionality
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Task Group 1 (type definitions)
    - Review the 6-8 tests written by Task Group 2 (diagram filtering)
    - Review the 6-8 tests written by Task Group 3 (cascade delete)
    - Total existing tests: approximately 16-22 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify any critical user workflows that lack test coverage
    - Focus ONLY on gaps related to temporal relationships and cascade delete
    - Do NOT assess entire application test coverage
    - Prioritize integration scenarios over additional unit tests
  - [x] 4.3 Write up to 8 additional strategic integration tests if needed
    - Test process migration scenario: edge shows with legacy app before changeover, target app after
    - Test combined scenario: temporal relationship + temporal endpoint = correct visibility
    - Test adjacent validity windows work correctly (valid_to: "2026-Q2" and valid_from: "2026-Q3")
    - Test setting valid_to to past quarter hides element but keeps it in JSON (temporal disappearance)
    - Test DELETE_ENTITY removes entity AND its relationships from JSON (actual deletion)
    - Test changing view_quarter immediately updates edge visibility
    - Test temporal disappearance vs actual deletion distinction
    - Test loading JSON with temporal relationship fields preserves data
  - [x] 4.4 Run all feature-specific tests
    - Run ALL tests from Task Groups 1-4 (approximately 24-30 tests total)
    - Verify all temporal filtering scenarios work correctly
    - Verify all cascade delete scenarios work correctly
    - Verify integration with existing functionality
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-30 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- No regressions in existing functionality
- Code compiles without TypeScript errors

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Type Definitions (model.ts)
       |
       v
  +----+----+
  |         |
  v         v
Task Group 2    Task Group 3
(Edge           (Cascade
 Filtering)      Delete)
  |         |
  +----+----+
       |
       v
Task Group 4: Test Review & Integration
```

1. **Task Group 1 (Type Definitions)** - Must be completed first as other groups depend on the new type definitions
2. **Task Group 2 (Diagram Filtering)** and **Task Group 3 (Cascade Delete)** - Can be implemented in parallel after Task Group 1 (they modify different files and have no interdependencies)
3. **Task Group 4 (Integration Testing)** - Final integration, depends on all previous groups

---

## Key Implementation Notes

### Existing Code to Leverage

| Existing Code | Location | Purpose |
|---------------|----------|---------|
| `isEntityVisibleInPeriod()` | quarterUtils.ts | Already handles optional temporal fields for entities |
| `isRelationshipVisibleInPeriod()` | quarterUtils.ts | Already handles optional temporal fields for relationships |
| `getNodesInRenderOrder()` | rendering.ts | Pattern for filtering by viewQuarter |
| `getEntity()` | rendering.ts | Lookup entity by type and ID |
| `getRelationship()` | rendering.ts | Lookup relationship by type and ID |
| `cascadeDeleteApplicationPoint()` | applicationPointSync.ts | Pattern to follow for new cascade delete functions |
| `cascadeDeleteForSourceEntity()` | applicationPointSync.ts | Existing cascade delete for source entity types |
| DELETE_ENTITY case | ArchitectureContext.tsx | Existing structure to extend |

### Backward Compatibility

- All temporal fields are **optional** - no schema version changes required
- Existing JSON files without temporal fields will continue to work
- Relationships without `valid_from`/`valid_to` are treated as "timeless" (always visible)

### Temporal Semantics

- Format: `"YYYY-Qn"` (e.g., `"2026-Q2"`)
- `valid_from` is **inclusive** (relationship appears at this quarter)
- `valid_to` is **exclusive** (relationship disappears after this quarter, visible up to but not including)
- Null/undefined = timeless (always visible)

### Endpoint Entity Temporal Status

| Entity Type | Has Temporal Fields | Notes |
|-------------|---------------------|-------|
| BusinessUser | No | Always considered visible (timeless) |
| BusinessProcess | Yes | Has valid_from/valid_to |
| Application | Yes | Has valid_from/valid_to |
| ApplicationComponent | Yes | Has valid_from/valid_to |
| Service | Yes | Has valid_from/valid_to |
| ApplicationPoint | Yes | Has valid_from/valid_to |
| LogicalDataEntity | Yes | Has valid_from/valid_to |
| PhysicalDataEntity | Yes | Has valid_from/valid_to |
| LogicalDataAttribute | No | Always considered visible (timeless) |
| PhysicalDataAttribute | No | Always considered visible (timeless) |

### Cascade Delete Rules Summary

| Entity Type | Cascades To |
|-------------|-------------|
| BusinessUser | business_user_processes |
| BusinessProcess | business_user_processes, application_point_business_processes |
| Application | ApplicationPoint (existing), then application_point_business_processes |
| AppComponent | ApplicationPoint (existing), then application_point_business_processes |
| Service | ApplicationPoint (existing), then application_point_business_processes |
| ApplicationPoint | application_point_business_processes (existing) |
| LogicalDataEntity | logical_data_entity_relationships, logical_data_entity_physical_data_entities, data_movements |
| PhysicalDataEntity | logical_data_entity_physical_data_entities |
| LogicalDataAttribute | logical_data_attribute_physical_data_attributes |
| PhysicalDataAttribute | logical_data_attribute_physical_data_attributes |

### Temporal Disappearance vs Actual Deletion

| Operation | Effect | Recoverable? |
|-----------|--------|--------------|
| Set `valid_to` to past quarter | Element hidden at current view date | Yes - change view quarter to see it |
| DELETE_ENTITY action | Element removed from JSON model | No - permanently deleted |
