# Task Breakdown: Fix Advanced Add Interface Schema Entities

## Overview
Total Tasks: 14

This is a frontend-only bugfix to restore Interface schema entity display in the Advanced Add modal after the Interface-to-Entity refactor. The fix requires updating code that still reads the deprecated `logical_entity_id` field to use the new unified `dataEntityPointId` field.

## Task List

### Utility Layer

#### Task Group 1: Shared Resolver Utility and Configuration
**Dependencies:** None

- [x] 1.0 Complete shared utility and configuration updates
  - [x] 1.1 Write 3-4 focused tests for the shared resolver utility
    - Test `resolveDataEntitiesForInterface()` returns empty arrays when no relationships exist
    - Test parsing of `dep_log_<id>` format returns correct logicalEntityIds
    - Test parsing of `dep_phy_<id>` format returns correct physicalEntityIds
    - Test mixed relationships return both logical and physical IDs correctly
  - [x] 1.2 Create `resolveDataEntitiesForInterface()` utility in `dataEntityPointOptions.ts`
    - Location: `frontend/src/utils/dataEntityPointOptions.ts`
    - Function signature: `resolveDataEntitiesForInterface(metaModel: MetaModel, interfaceId: string): { logicalEntityIds: string[], physicalEntityIds: string[] }`
    - Filter `interface_logical_entities` by `interface_id`
    - Use existing `parseDataEntityPointId()` to decode each `dataEntityPointId`
    - Group results by entity type and return both arrays
  - [x] 1.3 Update `advancedAddRelationships.ts` INTERFACE configuration
    - Location: `frontend/src/utils/advancedAddRelationships.ts` lines 322-343
    - Add `PHYSICAL_DATA_ENTITY` target entry alongside existing `LOGICAL_DATA_ENTITY`
    - Both entries use `relationshipTableName: 'interface_logical_entities'`
    - Both entries use `foreignKeyField: 'interface_id'`
    - Both entries use `actsAsContainment: true`
    - Set displayLabels: "Logical Data Entities" and "Physical Data Entities"
  - [x] 1.4 Ensure utility and config tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify `resolveDataEntitiesForInterface()` correctly parses both entity types

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- `resolveDataEntitiesForInterface()` correctly groups entity IDs by type
- `advancedAddRelationships.ts` config supports both LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY targets
- Existing `parseDataEntityPointId()` utility is reused (no duplication)

### Component Fixes

#### Task Group 2: Fix AdvancedAddDialog and InterfaceCompositeBuilder
**Dependencies:** Task Group 1

- [x] 2.0 Complete component-level fixes
  - [x] 2.1 Write 4-5 focused tests for Advanced Add and composite builder fixes
    - Test `findRelatedEntities()` returns logical entities from `dep_log_<id>` relationships
    - Test `findRelatedEntities()` returns physical entities from `dep_phy_<id>` relationships
    - Test `getDataEntityIdsForInterface()` returns grouped entity IDs
    - Test `buildInterfaceCompositeNodes()` includes both logical and physical entity children
    - Test entity display includes type badges `[LOGICAL_DATA_ENTITY]` or `[PHYSICAL_DATA_ENTITY]`
  - [x] 2.2 Fix `findRelatedEntities()` in `AdvancedAddDialog.tsx`
    - Location: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` lines 328-337
    - Import `resolveDataEntitiesForInterface()` from `dataEntityPointOptions.ts`
    - Replace `rel.logical_entity_id` reads with call to shared utility
    - Resolve entities from both `logical_data_entities` and `physical_data_entities` collections
    - Return format: `{ id, name, entityType }` with type indicator
    - Add type badge to display label following `resolveDataEntityPointLabel()` pattern
  - [x] 2.3 Rename and fix `getLogicalEntityIdsForInterface()` in `interfaceCompositeBuilder.ts`
    - Location: `frontend/src/utils/interfaceCompositeBuilder.ts` lines 73-81
    - Rename to `getDataEntityIdsForInterface()`
    - Import and use `resolveDataEntitiesForInterface()` from `dataEntityPointOptions.ts`
    - Return type: `{ logicalEntityIds: string[], physicalEntityIds: string[] }`
    - Remove deprecated `rel.logical_entity_id` reference
  - [x] 2.4 Update `buildInterfaceCompositeNodes()` to handle both entity types
    - Location: `frontend/src/utils/interfaceCompositeBuilder.ts` line 151
    - Rename parameter `selectedLogicalEntityIds` to `selectedDataEntityIds` object
    - Look up entities from both `metaModel.entities.logical_data_entities` and `metaModel.entities.physical_data_entities`
    - Create child entity nodes for both types with appropriate styling
    - Update all call sites to pass the new object format
  - [x] 2.5 Ensure component fix tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify Advanced Add tree shows both logical and physical entities under Interface
    - Verify composite nodes include both entity types

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- `findRelatedEntities()` returns both logical and physical entities with type indicators
- `getDataEntityIdsForInterface()` returns grouped entity IDs using shared utility
- `buildInterfaceCompositeNodes()` renders children for both entity types
- Type badges display correctly: `[LOGICAL_DATA_ENTITY]` or `[PHYSICAL_DATA_ENTITY]`

### Testing

#### Task Group 3: Test Review and Regression Test
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review tests and add regression test
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 3-4 tests written for utility layer (Task 1.1)
    - Review the 4-5 tests written for component fixes (Task 2.1)
    - Total existing tests: approximately 7-9 tests
  - [x] 3.2 Create regression test file
    - Location: `frontend/src/__tests__/advanced-add-interface-schema-entities.test.ts`
    - Construct minimal metaModel fixture with:
      - One Interface entity
      - One logical data entity
      - One physical data entity
      - Two `interface_logical_entities` relationship rows using `dataEntityPointId` format
    - Assert Advanced Add tree builder returns both entities under the Interface node
    - Assert entity type badges are present in display labels
  - [x] 3.3 Add integration scenario test
    - Test end-to-end flow: Interface selection -> Advanced Add tree expansion -> entity visibility
    - Verify both `dep_log_<id>` and `dep_phy_<id>` relationships resolve correctly
    - Ensure no regression to logical-only assumption
  - [x] 3.4 Run feature-specific tests only
    - Run all tests from 1.1, 2.1, 3.2, and 3.3
    - Expected total: approximately 10-12 tests maximum
    - Verify all critical workflows pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 10-12 tests total)
- Regression test prevents reintroduction of logical-only assumption
- Both entity types appear under Interface in Advanced Add modal
- No existing functionality broken

## Execution Order

Recommended implementation sequence:
1. Utility Layer (Task Group 1) - Create shared resolver, update config
2. Component Fixes (Task Group 2) - Fix AdvancedAddDialog and interfaceCompositeBuilder
3. Test Review and Regression Test (Task Group 3) - Verify and add regression protection

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/dataEntityPointOptions.ts` | Add `resolveDataEntitiesForInterface()` utility |
| `frontend/src/utils/advancedAddRelationships.ts` | Add PHYSICAL_DATA_ENTITY target to INTERFACE config |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Fix `findRelatedEntities()` to use shared utility |
| `frontend/src/utils/interfaceCompositeBuilder.ts` | Rename and fix `getDataEntityIdsForInterface()`, update `buildInterfaceCompositeNodes()` |
| `frontend/src/__tests__/advanced-add-interface-schema-entities.test.ts` | New regression test file |

## Key Code Patterns to Follow

**Existing utility to reuse:**
```typescript
// dataEntityPointOptions.ts - parseDataEntityPointId()
parseDataEntityPointId('dep_log_abc123') // -> { entityType: 'logical', entityId: 'abc123' }
parseDataEntityPointId('dep_phy_xyz789') // -> { entityType: 'physical', entityId: 'xyz789' }
```

**Type badge display pattern:**
```typescript
// Follow resolveDataEntityPointLabel() pattern
`${entityName} [LOGICAL_DATA_ENTITY]`
`${entityName} [PHYSICAL_DATA_ENTITY]`
```

## Implementation Summary

All 3 task groups have been completed successfully:

### Task Group 1 (Completed):
- Created `resolveDataEntitiesForInterface()` utility in `dataEntityPointOptions.ts`
- Added `PHYSICAL_DATA_ENTITY` target to INTERFACE config in `advancedAddRelationships.ts`
- Wrote 7 tests in `resolve-data-entities-for-interface.test.ts`

### Task Group 2 (Completed):
- Fixed `findRelatedEntities()` in `AdvancedAddDialog.tsx` to use shared utility
- Renamed `getLogicalEntityIdsForInterface()` to `getDataEntityIdsForInterface()` in `interfaceCompositeBuilder.ts`
- Updated `buildInterfaceCompositeNodes()` to handle both entity types
- Wrote 10 tests in `advanced-add-interface-data-entities.test.ts`

### Task Group 3 (Completed):
- Reviewed all tests from Task Groups 1-2
- Created regression test file `advanced-add-interface-schema-entities.test.ts` with 11 tests
- All 28 feature-specific tests pass
