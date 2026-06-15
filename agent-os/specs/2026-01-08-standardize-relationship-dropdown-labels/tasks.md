# Task Breakdown: Standardize Relationship Dropdown Display Labels

## Overview
Total Tasks: 34

This feature implements a centralized label cache in the ArchitectureContext for relationship dropdowns, ensuring consistent human-readable labels across all relationship grids while persisting only canonical foreign-key identifiers.

## Task List

### State Management Layer

#### Task Group 1: Relationship Cell Label Cache in ArchitectureContext
**Dependencies:** None

- [x] 1.0 Complete relationship cell label cache state management
  - [x] 1.1 Write 4-6 focused tests for label cache state and actions
    - Test initial state includes empty `relationshipCellLabels: {}`
    - Test `SET_RELATIONSHIP_CELL_LABEL` action adds/updates cache entries
    - Test `CLEAR_RELATIONSHIP_CELL_LABELS_FOR_RELATIONSHIP` clears entries by relationshipKey prefix
    - Test `REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL` populates cache from model data
    - Test cache key format: `${relationshipKey}:${rowId}:${columnKey}`
    - Test cache is not serialized (verify through model export/snapshot)
  - [x] 1.2 Add `relationshipCellLabels` to AppState interface
    - File: `frontend/src/contexts/ArchitectureContext.tsx` (line ~56)
    - Type: `Record<string, string>`
    - Add to initialState with default `{}`
  - [x] 1.3 Implement `SET_RELATIONSHIP_CELL_LABEL` action
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add to AppAction union type (line ~75)
    - Payload: `{ relationshipKey: string; rowId: string; columnKey: string; label: string }`
    - Reducer: compute cache key and update `relationshipCellLabels`
  - [x] 1.4 Implement `CLEAR_RELATIONSHIP_CELL_LABELS_FOR_RELATIONSHIP` action
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Payload: `{ relationshipKey: string }`
    - Reducer: filter out all cache entries whose key starts with `${relationshipKey}:`
  - [x] 1.5 Implement `REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL` action
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - No payload required
    - Reducer: iterate all relationship types, resolve labels for FK columns, populate cache
    - Must call this after `LOAD_MODEL` completes
  - [x] 1.6 Create label resolution utility functions
    - File: `frontend/src/utils/relationshipLabelResolver.ts` (new file)
    - Function: `buildCacheKeyForCell(relationshipKey: string, rowId: string, columnKey: string): string`
    - Function: `resolveRelationshipCellLabel(columnKey: string, fkValue: string, entities: MetaModelEntities): string`
    - Dispatch logic to existing resolvers based on column type
  - [x] 1.7 Ensure label cache state tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify actions properly update state
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `relationshipCellLabels` is available in AppState
- All three actions work correctly
- Cache keys follow format `${relationshipKey}:${rowId}:${columnKey}`
- Cache survives tab switches (persisted in React context)
- Cache is never serialized to backend/snapshots

---

### Label Resolution Utilities Layer

#### Task Group 2: Unified Label Resolution Logic
**Dependencies:** Task Group 1

- [x] 2.0 Complete label resolution utility layer
  - [x] 2.1 Write 6-8 focused tests for label resolution functions
    - Test `resolveDataEntityPointLabel` returns formatted label for logical entities
    - Test `resolveDataEntityPointLabel` returns formatted label for physical entities
    - Test `resolveApplicationPointLabel` returns label with kind badge
    - Test `resolveApplicationPointLabel` handles derived APs with target info
    - Test `resolveBusinessPointLabel` returns "[Name] [KIND]" format
    - Test `resolveAppBusinessPointLabel` resolves through app_business_points collection
    - Test `resolveBusinessUserLabel` returns user name
    - Test fallback to raw ID when entity not found
  - [x] 2.2 Create `resolveApplicationPointLabel` function
    - File: `frontend/src/utils/relationshipLabelResolver.ts`
    - Leverage `getApplicationPointDisplayText` from `ApplicationPointPickerCell.tsx`
    - Handle derived APs via `getTargetEntityInfo`
    - Format: "[Name] [KIND]" (e.g., "Order Service [SERVICE]")
  - [x] 2.3 Create `resolveBusinessPointLabel` function
    - File: `frontend/src/utils/relationshipLabelResolver.ts`
    - Leverage `businessPointDisplayFormatter` from `formatters.ts`
    - Format: "[Name] [KIND]" (e.g., "Order Processing [BUSINESS_PROCESS]")
  - [x] 2.4 Create `resolveAppBusinessPointLabel` function
    - File: `frontend/src/utils/relationshipLabelResolver.ts`
    - Lookup in `app_business_points` collection
    - Use `ABP_KIND_LABELS` for kind badge
    - Format: "[Name] [KIND]" (e.g., "Payment Service [SERVICE]")
  - [x] 2.5 Create `resolveBusinessUserLabel` function
    - File: `frontend/src/utils/relationshipLabelResolver.ts`
    - Simple lookup in `business_users` collection
    - Return name directly (no badge needed)
  - [x] 2.6 Implement column-to-resolver mapping
    - File: `frontend/src/utils/relationshipLabelResolver.ts`
    - Map column keys to appropriate resolver functions:
      - `application_point_id`, `source_application_point_id`, `target_application_point_id` -> `resolveApplicationPointLabel`
      - `business_point_id` -> `resolveBusinessPointLabel`
      - `fromDataEntityPointId`, `toDataEntityPointId`, `dataEntityPointId` -> `resolveDataEntityPointLabel` (existing)
      - `user_id` -> `resolveBusinessUserLabel`
      - `primary_app_business_point_id`, `secondary_app_business_point_id` -> `resolveAppBusinessPointLabel`
  - [x] 2.7 Ensure label resolution tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all resolver functions return correct format
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- All resolver functions produce consistent "[Name] [TYPE]" format
- Fallback to raw ID works for missing entities
- Column-to-resolver mapping covers all relationship FK columns

---

### Dropdown Editor Updates Layer

#### Task Group 3: Standardized Dropdown Editor Contracts
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete dropdown editor updates
  - [x] 3.1 Write 4-6 focused tests for dropdown editor label dispatch
    - Test `DataEntityPointSelect` dispatches `SET_RELATIONSHIP_CELL_LABEL` on selection
    - Test `ApplicationPointPickerCell` dispatches `SET_RELATIONSHIP_CELL_LABEL` on selection
    - Test `TypeaheadCell` for business points dispatches label cache update
    - Test label format matches "[Name] [ENTITY_TYPE_BADGE]"
    - Test persisted value remains canonical FK ID
    - Test selection workflow: persist FK, then dispatch label cache
  - [x] 3.2 Extend `DataEntityPointSelect` to dispatch label cache update
    - File: `frontend/src/components/Grid/DataEntityPointSelect.tsx`
    - Add dispatch prop or context access
    - On `handleSelect`: after `onChange(option.value)`, dispatch `SET_RELATIONSHIP_CELL_LABEL`
    - Label = `option.label` (already formatted correctly)
    - Pass relationshipKey, rowId, columnKey from props
  - [x] 3.3 Extend `ApplicationPointPickerCell` to dispatch label cache update
    - File: `frontend/src/components/Grid/ApplicationPointPickerCell.tsx`
    - Add dispatch prop or context access
    - On `handleSelect`: after `onChange(...)`, dispatch `SET_RELATIONSHIP_CELL_LABEL`
    - Generate label using `getApplicationPointDisplayText`
    - Pass relationshipKey, rowId, columnKey from props
  - [x] 3.4 Update TypeaheadCell for business_point_id columns
    - File: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Detect when column is `business_point_id` fk_typeahead
    - On selection: generate label using `businessPointDisplayFormatter`
    - Dispatch `SET_RELATIONSHIP_CELL_LABEL`
  - [x] 3.5 Update TypeaheadCell for interactions grid columns
    - File: `frontend/src/components/Grid/TypeaheadCell.tsx`
    - Handle `user_id`, `primary_app_business_point_id`, `secondary_app_business_point_id`
    - Generate appropriate labels using resolvers from Task Group 2
    - Dispatch `SET_RELATIONSHIP_CELL_LABEL`
  - [x] 3.6 Add relationshipKey, rowId, columnKey props to editor components
    - Update `DataEntityPointSelect` props interface
    - Update `ApplicationPointPickerCell` props interface
    - Update `TypeaheadCell` props interface
    - Pass through from Grid/RelationshipGrid parent components
  - [x] 3.7 Ensure dropdown editor tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify label dispatch occurs on selection
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- All relationship dropdown editors dispatch label updates on selection
- Label format is consistent "[Name] [ENTITY_TYPE_BADGE]"
- FK persistence is unchanged (canonical IDs only)

---

### Cell Renderer Updates Layer

#### Task Group 4: Standardized Cell Renderer Logic
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete cell renderer updates
  - [x] 4.1 Write 4-6 focused tests for cell renderer label resolution
    - Test cell renderer checks `relationshipCellLabels` cache first
    - Test cache hit returns cached label
    - Test cache miss resolves label on-demand
    - Test resolved label is added to cache
    - Test fallback to raw ID when resolution fails
    - Test different column types render correct format
  - [x] 4.2 Create relationship cell display hook
    - File: `frontend/src/hooks/useRelationshipCellLabel.ts` (new file)
    - Hook: `useRelationshipCellLabel(relationshipKey, rowId, columnKey, fkValue, entities)`
    - Check cache first, resolve on-demand if miss
    - Optionally dispatch to populate cache on miss
    - Return display label string
  - [x] 4.3 Update Grid/RelationshipGrid cell rendering
    - File: `frontend/src/components/Grid/Grid.tsx`
    - File: `frontend/src/components/Grid/GridCell.tsx`
    - File: `frontend/src/components/Grid/RelationshipGrid.tsx`
    - For relationship FK columns, pass relationshipKey to GridCell
    - GridCell uses `useArchitectureDispatch` to dispatch label updates
  - [x] 4.4 Update DataEntityPointSelect read-only display
    - File: `frontend/src/components/Grid/DataEntityPointSelect.tsx`
    - Use hook or check cache for display value
    - Fall back to `resolveDataEntityPointLabel` on cache miss
  - [x] 4.5 Update ApplicationPointPickerCell read-only display
    - File: `frontend/src/components/Grid/ApplicationPointPickerCell.tsx`
    - Use hook or check cache for display value
    - Fall back to `getApplicationPointDisplayText` on cache miss
  - [x] 4.6 Ensure cell renderer tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify cache-first rendering behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Cell renderers prioritize cache lookup
- On-demand resolution populates cache
- Raw ID displayed only as last resort

---

### Integration Layer

#### Task Group 5: Model Load Cache Rebuild Integration
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Complete model load integration
  - [x] 5.1 Write 2-4 focused tests for cache rebuild on model load
    - Test `REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL` is dispatched after `LOAD_MODEL`
    - Test cache is populated with labels from all relationship FK columns
    - Test existing labels are cleared before rebuild
    - Test new file load rebuilds cache correctly
  - [x] 5.2 Integrate cache rebuild into model loading flow
    - File: `frontend/src/contexts/ArchitectureContext.tsx` or loading component
    - After `LOAD_MODEL` action completes, dispatch `REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL`
    - Consider using useEffect in provider or middleware pattern
  - [x] 5.3 Implement rebuild logic in reducer
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Clear existing cache entries
    - Iterate: relationships.data_movements, relationships.logical_data_entity_relationships, etc.
    - For each row and FK column, resolve label and populate cache
    - Use resolvers from Task Group 2
  - [x] 5.4 Ensure model load integration tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify cache is populated on load
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass
- Cache is rebuilt whenever model is loaded
- All relationship FK columns have labels populated
- Tab switches preserve cache (no re-build needed)

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 tests written by state management (Task 1.1)
    - Review the 6-8 tests written by label resolution utilities (Task 2.1)
    - Review the 4-6 tests written by dropdown editors (Task 3.1)
    - Review the 4-6 tests written by cell renderers (Task 4.1)
    - Review the 2-4 tests written by model load integration (Task 5.1)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus areas:
      - End-to-end: Select dropdown -> verify cache update -> verify cell display
      - Integration: Tab switch -> verify cache persists
      - Edge cases: Missing entity -> verify fallback to ID
      - Snapshot export -> verify cache is NOT serialized
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 28-38 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-38 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **State Management Layer** (Task Group 1)
   - Foundation for all other groups
   - Establishes cache state and actions

2. **Label Resolution Utilities Layer** (Task Group 2)
   - Provides resolution functions needed by editors and renderers
   - Depends on state types from Group 1

3. **Dropdown Editor Updates Layer** (Task Group 3)
   - Implements write path: selection -> cache update
   - Depends on Groups 1-2 for state and resolvers

4. **Cell Renderer Updates Layer** (Task Group 4)
   - Implements read path: cache lookup -> display
   - Depends on Groups 1-3 for cache population

5. **Model Load Integration Layer** (Task Group 5)
   - Integrates cache rebuild into application lifecycle
   - Depends on all previous groups

6. **Test Review and Gap Analysis** (Task Group 6)
   - Final validation and gap filling
   - Runs after all implementation complete

---

## File Paths Summary

### New Files
- `frontend/src/utils/relationshipLabelResolver.ts` - Label resolution utilities
- `frontend/src/hooks/useRelationshipCellLabel.ts` - Cell display hook
- `frontend/src/__tests__/relationship-label-cache.test.ts` - State management tests
- `frontend/src/__tests__/relationship-dropdown-label-dispatch.test.ts` - Dropdown editor and cell renderer tests

### Modified Files
- `frontend/src/contexts/ArchitectureContext.tsx` - AppState, actions, reducer
- `frontend/src/components/Grid/DataEntityPointSelect.tsx` - Dispatch label on selection
- `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` - Dispatch label on selection
- `frontend/src/components/Grid/TypeaheadCell.tsx` - Dispatch label on selection
- `frontend/src/components/Grid/GridCell.tsx` - Label dispatch callback, prop passing
- `frontend/src/components/Grid/RelationshipGrid.tsx` - Pass relationshipKey to GridCell

### Reference Files (Read-Only)
- `frontend/src/utils/dataEntityPointOptions.ts` - Existing `resolveDataEntityPointLabel`
- `frontend/src/utils/formatters.ts` - Existing formatter patterns
- `frontend/src/config/gridConfigs.ts` - Column configurations

---

## Relationship Columns Inventory

| Relationship Type | Column Key | Resolver Function |
|-------------------|------------|-------------------|
| `data_movements` | `source_application_point_id` | `resolveApplicationPointLabel` |
| `data_movements` | `target_application_point_id` | `resolveApplicationPointLabel` |
| `data_movements` | `dataEntityPointId` | `resolveDataEntityPointLabel` |
| `logical_data_entity_relationships` | `fromDataEntityPointId` | `resolveDataEntityPointLabel` |
| `logical_data_entity_relationships` | `toDataEntityPointId` | `resolveDataEntityPointLabel` |
| `application_point_business_points` | `application_point_id` | `resolveApplicationPointLabel` |
| `application_point_business_points` | `business_point_id` | `resolveBusinessPointLabel` |
| `business_user_business_points` | `business_user_id` | `resolveBusinessUserLabel` |
| `business_user_business_points` | `business_point_id` | `resolveBusinessPointLabel` |
| `interactions` | `user_id` | `resolveBusinessUserLabel` |
| `interactions` | `primary_app_business_point_id` | `resolveAppBusinessPointLabel` |
| `interactions` | `secondary_app_business_point_id` | `resolveAppBusinessPointLabel` |
| `application_point_business_logics` | `application_point_id` | `resolveApplicationPointLabel` |

---

## Implementation Summary

All tasks have been completed:

- **Task Group 1** (State Management): Added `relationshipCellLabels` cache to AppState, implemented `SET_RELATIONSHIP_CELL_LABEL`, `CLEAR_RELATIONSHIP_CELL_LABELS_FOR_RELATIONSHIP`, and `REBUILD_RELATIONSHIP_CELL_LABELS_FROM_MODEL` actions. Cache rebuild is integrated into `LOAD_MODEL`.

- **Task Group 2** (Label Resolution): Created `relationshipLabelResolver.ts` with resolver functions for all FK column types, column-to-resolver mapping, and cache key building utilities.

- **Task Group 3** (Dropdown Editors): Updated `DataEntityPointSelect`, `ApplicationPointPickerCell`, and `TypeaheadCell` to accept `relationshipKey`, `rowId`, `columnKey`, and `onLabelUpdate` props for dispatching label cache updates on selection.

- **Task Group 4** (Cell Renderers): Created `useRelationshipCellLabel` hook, updated `GridCell` to dispatch label updates via callback, updated `RelationshipGrid` to pass `relationshipKey` to cells.

- **Task Group 5** (Integration): Cache rebuild is automatically triggered in `LOAD_MODEL` reducer, populating labels for all relationship FK columns.

- **Task Group 6** (Testing): 70 tests pass covering state management, label resolution, dropdown dispatch, cell rendering, and model load integration.
