# Task Breakdown: Relationship Temporal Columns in Meta-Model Grids

## Overview
Total Tasks: 6 (across 2 task groups)

This is a minimal feature that adds "Valid From" and "Valid To" columns to 5 relationship grids in the Meta-model view. The temporal fields already exist in the TypeScript interfaces; this spec exposes them in the UI grid configuration.

**Scope**: Single file change to `frontend/src/config/gridConfigs.ts`

## Task List

### Configuration Layer

#### Task Group 1: Grid Configuration Updates
**Dependencies:** None

- [x] 1.0 Complete grid configuration changes
  - [x] 1.1 Write 4-6 focused tests for temporal column configuration
    - Test that `business_user_processes` config includes `valid_from` and `valid_to` columns
    - Test that `application_point_business_processes` config includes temporal columns
    - Test that `logical_data_entity_relationships` config includes temporal columns
    - Test that `logical_data_entity_physical_data_entities` config includes temporal columns
    - Test that `logical_data_attribute_physical_data_attributes` config includes temporal columns
    - Test column placement: temporal columns appear after Description and before Tags
  - [x] 1.2 Add temporal columns to `business_user_processes` grid
    - Add after `description` field, before `tags` field:
    ```typescript
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
    ```
  - [x] 1.3 Add temporal columns to `application_point_business_processes` grid
    - Add after `description` field, before `tags` field (same column definitions)
  - [x] 1.4 Add temporal columns to `logical_data_entity_relationships` grid
    - Add after `description` field, before `tags` field (same column definitions)
  - [x] 1.5 Add temporal columns to `logical_data_entity_physical_data_entities` grid
    - Add after `description` field, before `tags` field (same column definitions)
  - [x] 1.6 Add temporal columns to `logical_data_attribute_physical_data_attributes` grid
    - Add after `description` field, before `tags` field (same column definitions)
  - [x] 1.7 Ensure grid configuration tests pass
    - Run ONLY the tests written in 1.1
    - Verify all 5 relationship grids have correct column structure

**Acceptance Criteria:**
- All 5 relationship grid configs include `valid_from` and `valid_to` columns
- Column order is: `[ID] [Endpoint 1] [Endpoint 2] [Description] [Valid From] [Valid To] [Tags]`
- Column definitions match existing pattern from `data_movements` grid
- Tests from 1.1 pass

### Integration Verification

#### Task Group 2: End-to-End Verification
**Dependencies:** Task Group 1

- [x] 2.0 Verify integration and data persistence
  - [x] 2.1 Write 3-4 focused integration tests
    - Test editing temporal fields updates relationship data in state
    - Test JSON save includes `valid_from` and `valid_to` when set
    - Test JSON load populates grid columns with saved temporal values
    - Test empty cells leave temporal field undefined (no regression test)
  - [x] 2.2 Manual verification checklist
    - Verify columns appear in all 5 relationship grids in Meta-model view
    - Verify editing "Valid From" updates `valid_from` in relationship data
    - Verify editing "Valid To" updates `valid_to` in relationship data
    - Verify empty cells leave field undefined
    - Verify `data_movements` grid continues working (no regression)
  - [x] 2.3 Ensure integration tests pass
    - Run ONLY the tests written in 2.1
    - Verify data persistence works correctly

**Acceptance Criteria:**
- Temporal field editing updates relationship data correctly
- JSON save/load preserves temporal values
- No regressions to existing relationship editing functionality
- Tests from 2.1 pass

## Execution Order

Recommended implementation sequence:
1. Grid Configuration Updates (Task Group 1)
2. Integration Verification (Task Group 2)

## Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Add temporal columns to 5 relationship grid configs |

## Files NOT Requiring Changes

These files already support the temporal columns - no modifications needed:
- `frontend/src/components/MetamodelView/RelationshipGrid.tsx` - handles arbitrary columns from config
- `frontend/src/components/MetamodelView/GridCell.tsx` - supports `'text'` cell type
- `frontend/src/contexts/ArchitectureContext.tsx` - reducer preserves all fields on update
- `frontend/src/types/model.ts` - interfaces already have `valid_from` and `valid_to` fields

## Reference: Existing Pattern

The `data_movements` grid (lines 158-168 in gridConfigs.ts) already has temporal columns:
```typescript
{ field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
{ field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
```

Copy this exact pattern to the 5 relationship grids listed in Task Group 1.

## Test File Location

- Task Group 1 tests: `frontend/src/__tests__/relationship-temporal-columns.test.ts`
- Task Group 2 tests: `frontend/src/__tests__/relationship-temporal-columns-integration.test.ts`

## Test Runners

- Task Group 1: `npx tsx frontend/src/__tests__/run-relationship-temporal-columns-tests.ts`
- Task Group 2: `npx tsx frontend/src/__tests__/run-relationship-temporal-columns-integration-tests.ts`

## Estimated Effort

- Task Group 1: ~30 minutes (simple config changes)
- Task Group 2: ~30 minutes (verification and integration tests)
- Total: ~1 hour
