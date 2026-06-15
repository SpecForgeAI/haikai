# Task Breakdown: Fix Context Picker DEP Labels and Add Select All

## Overview
Total Tasks: 16 tasks across 4 task groups

This spec addresses two distinct issues in the Context Picker modal:
1. **DEP Label Bug**: DATA_ENTITY_POINT participants display as "Unknown [DATA_ENTITY_POINT]" instead of resolving to the underlying entity name
2. **Select All Feature**: Add bulk selection checkboxes at section level (Entities/Relationships) and group level (entity type/relationship type)

## Task List

### Task Group 1: DEP Label Resolution
**Dependencies:** None
**Purpose:** Fix the "Unknown [DATA_ENTITY_POINT]" label bug by resolving DEP IDs to their underlying logical/physical entity names.

---

- [x] 1.0 Complete DEP Label Resolution
  - [x] 1.1 Write 4-6 focused tests for DEP label resolution
    - Test `resolveDataEntityPointLabel()` returns correct entity name for `dep_log_<id>` format
    - Test `resolveDataEntityPointLabel()` returns correct entity name for `dep_phy_<id>` format
    - Test fallback behavior when underlying entity not found (returns "Unknown [LOGICAL_DATA_ENTITY]" or "Unknown [PHYSICAL_DATA_ENTITY]")
    - Test `computeRelationshipLabel()` correctly uses resolved DEP labels instead of "Unknown"
    - Test non-DEP participants are not affected (no regression)
    - **Files:** `frontend/src/__tests__/depLabelResolution.test.ts` (new file)

  - [x] 1.2 Create DEP ID parsing utility function
    - Extract prefix parsing logic from `resolveDataEntityPointLabel()` into a reusable helper
    - Function signature: `parseDepId(depId: string): { type: 'logical' | 'physical'; entityId: string } | null`
    - Returns null for non-DEP IDs
    - **Files:** `frontend/src/utils/dataEntityPointOptions.ts`

  - [x] 1.3 Create entity name extraction function for DEP resolution
    - New function: `resolveDepEntityName(depId: string, metaModel: MetaModel): string`
    - Returns just the entity name (without type badge) for use in relationship labels
    - Uses `parseDepId()` to determine type, then looks up entity in appropriate collection
    - Falls back to "Unknown" if entity not found
    - **Files:** `frontend/src/utils/dataEntityPointOptions.ts`

  - [x] 1.4 Enhance entity lookup to handle DEP IDs
    - Modify or wrap `createEntityLookupFromMetaModel()` to detect DEP-prefixed IDs
    - When DEP ID detected, delegate to `resolveDepEntityName()`
    - Preserve existing behavior for non-DEP IDs
    - **Files:** `frontend/src/utils/contextPickListBuilders.ts`

  - [x] 1.5 Update computeRelationshipLabel() to use enhanced lookup
    - When participant has `typeLabel: 'DATA_ENTITY_POINT'`, use DEP resolution
    - Render concrete type badge (`[LOGICAL_DATA_ENTITY]` or `[PHYSICAL_DATA_ENTITY]`) instead of `[DATA_ENTITY_POINT]`
    - Preserve existing formatting for non-DEP participants
    - **Files:** `frontend/src/utils/contextRelationshipLabelUtils.ts`

  - [x] 1.6 Run DEP label resolution tests
    - Run ONLY the tests written in 1.1
    - Verify all DEP resolution scenarios pass
    - Verify no regression in non-DEP label rendering

**Acceptance Criteria:**
- DEP IDs with `dep_log_` prefix resolve to logical entity names with `[LOGICAL_DATA_ENTITY]` badge
- DEP IDs with `dep_phy_` prefix resolve to physical entity names with `[PHYSICAL_DATA_ENTITY]` badge
- Missing entities show "Unknown [LOGICAL_DATA_ENTITY]" or "Unknown [PHYSICAL_DATA_ENTITY]" (not "Unknown [DATA_ENTITY_POINT]")
- Non-DEP participants render exactly as before (no regression)
- All tests from 1.1 pass

---

### Task Group 2: Section-Level Select All
**Dependencies:** None (can run in parallel with Task Group 1)
**Purpose:** Add Select All checkboxes for the Entities and Relationships sections.

---

- [x] 2.0 Complete Section-Level Select All
  - [x] 2.1 Write 4-6 focused tests for section-level Select All
    - Test Entities section Select All selects all entity rows when clicked (unchecked state)
    - Test Entities section Select All deselects all entity rows when clicked (checked state)
    - Test Relationships section Select All selects all relationship rows when clicked
    - Test Relationships section Select All deselects all relationship rows when clicked
    - Test indeterminate state is shown when some but not all items are selected
    - Test checkbox click does not trigger section expand/collapse
    - **Files:** `frontend/src/__tests__/contextPickerSelectAll.section.test.tsx` (new file)

  - [x] 2.2 Create selection state derivation utility
    - Function: `deriveCheckboxState(selectedCount: number, totalCount: number): 'checked' | 'unchecked' | 'indeterminate'`
    - Returns 'checked' if selectedCount === totalCount && totalCount > 0
    - Returns 'unchecked' if selectedCount === 0
    - Returns 'indeterminate' if 0 < selectedCount < totalCount
    - **Files:** `frontend/src/utils/selectionUtils.ts` (new file or add to existing utils)

  - [x] 2.3 Create bulk entity selection handler
    - Function: `handleBulkEntitySelection(entityIds: string[], entities: EntityPickOption[], select: boolean)`
    - When selecting: add all entityIds to `selectedEntityIds`, populate `entityBundleSelections` with default bundle types, populate `entityDepthSelections` for entities with `entity_with_attributes_and_relationships` bundle
    - When deselecting: remove all entityIds from `selectedEntityIds`, remove entries from `entityBundleSelections` and `entityDepthSelections`
    - Reuse logic pattern from existing `handleEntityToggle()`
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx`

  - [x] 2.4 Create bulk relationship selection handler
    - Function: `handleBulkRelationshipSelection(relationshipIds: string[], relationships: RelationshipPickOption[], select: boolean)`
    - When selecting: add all relationshipIds to `selectedRelationshipIds`, pre-compute and populate `relationshipMetadata` with `{ relationship_type, label }` for each
    - When deselecting: remove all relationshipIds from `selectedRelationshipIds`, remove entries from `relationshipMetadata`
    - Metadata must be computed at selection time (not lazily)
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx`

  - [x] 2.5 Add Select All checkbox to Entities section header
    - Add checkbox before section label: `[checkbox] [triangle] Entities (count)`
    - Wire to `handleBulkEntitySelection()` with all entities in current domain tab
    - Use `deriveCheckboxState()` to compute checked/unchecked/indeterminate state
    - Set `indeterminate` property via ref callback (see `AdvancedAddDialog.tsx` pattern)
    - Add `onClick={(e) => e.stopPropagation()}` to prevent expand/collapse toggle
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx` (DomainEntitiesSection component)

  - [x] 2.6 Add Select All checkbox to Relationships section header
    - Add checkbox before section label: `[checkbox] [triangle] Relationships (count)`
    - Wire to `handleBulkRelationshipSelection()` with all relationships in current domain tab
    - Use `deriveCheckboxState()` to compute state
    - Set `indeterminate` property via ref callback
    - Add `onClick={(e) => e.stopPropagation()}` to prevent expand/collapse toggle
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx` (DomainRelationshipsSection component)

  - [x] 2.7 Run section-level Select All tests
    - Run ONLY the tests written in 2.1
    - Verify all section-level selection scenarios pass

**Acceptance Criteria:**
- Entities section has a Select All checkbox that selects/deselects all entity rows
- Relationships section has a Select All checkbox that selects/deselects all relationship rows
- Checkboxes show indeterminate state when partially selected
- Clicking indeterminate checkbox selects all items
- Bundle/depth defaults are correctly populated for bulk entity selection
- Relationship metadata is pre-computed for bulk relationship selection
- Checkbox clicks do not trigger section expand/collapse
- All tests from 2.1 pass

---

### Task Group 3: Group-Level Select All
**Dependencies:** Task Group 2 (reuses bulk selection handlers and state derivation utility)
**Purpose:** Add Select All checkboxes for each entity type group and relationship type group.

---

- [x] 3.0 Complete Group-Level Select All
  - [x] 3.1 Write 4-6 focused tests for group-level Select All
    - Test entity type group Select All selects only entities of that type
    - Test entity type group Select All deselects only entities of that type
    - Test relationship type group Select All selects only relationships of that type
    - Test relationship type group Select All deselects only relationships of that type
    - Test group checkbox reflects correct state (checked/unchecked/indeterminate) based on group members
    - Test group checkbox click does not trigger group expand/collapse
    - **Files:** `frontend/src/__tests__/contextPickerSelectAll.group.test.tsx` (new file)

  - [x] 3.2 Add Select All checkbox to entity type group headers
    - Add checkbox before group label: `[checkbox] ENTITY_TYPE_NAME (count)`
    - Wire to `handleBulkEntitySelection()` with only entities of that type
    - Compute state based on selection status of entities in that specific group
    - Add `onClick={(e) => e.stopPropagation()}` to prevent expand/collapse toggle
    - Apply to all entity type groups (INTERFACE_LOGICAL_ENTITIES, LOGICAL_DATA_ENTITIES, etc.)
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx` (EntityTypeGroup component)

  - [x] 3.3 Add Select All checkbox to relationship type group headers
    - Add checkbox before group label: `[checkbox] RELATIONSHIP_TYPE_NAME (count)`
    - Wire to `handleBulkRelationshipSelection()` with only relationships of that type
    - Compute state based on selection status of relationships in that specific group
    - Add `onClick={(e) => e.stopPropagation()}` to prevent expand/collapse toggle
    - Apply to all relationship type groups
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx` (RelationshipTypeGroup component)

  - [x] 3.4 Ensure section-level state updates when group selections change
    - Section-level checkboxes must re-derive state when any group selection changes
    - Verify reactive computation from `selectedEntityIds` and `selectedRelationshipIds` sets
    - No additional wiring should be needed if state derivation is done reactively
    - **Files:** `frontend/src/components/ProductView/ContextPickerModal.tsx`

  - [x] 3.5 Run group-level Select All tests
    - Run ONLY the tests written in 3.1
    - Verify all group-level selection scenarios pass

**Acceptance Criteria:**
- Each entity type group has a Select All checkbox
- Each relationship type group has a Select All checkbox
- Group checkboxes only affect their own group members
- Group checkboxes show correct state (checked/unchecked/indeterminate)
- Section-level checkboxes correctly reflect state when groups are modified
- Group checkbox clicks do not trigger group expand/collapse
- All tests from 3.1 pass

---

### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3
**Purpose:** Review all tests written during implementation and fill critical gaps.

---

- [x] 4.0 Complete Test Review and Gap Analysis
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review DEP label resolution tests (Task 1.1): 21 tests
    - Review section-level Select All tests (Task 2.1): 11 tests
    - Review group-level Select All tests (Task 3.1): 10 tests
    - Total existing tests: 42 tests

  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical integration scenarios not covered:
      - DEP labels in relationship rows displayed in UI
      - Apply/commit payload correctness after bulk selection
      - Interaction between section and group level selections
    - Focus on end-to-end workflows, not exhaustive unit tests

  - [x] 4.3 Write up to 8 additional strategic tests if needed
    - Integration test: relationship row renders resolved DEP label in actual modal (2 tests)
    - Integration test: Apply payload includes correct metadata after bulk entity selection (3 tests)
    - Integration test: Apply payload includes correct metadata after bulk relationship selection (2 tests)
    - Edge case: selecting/deselecting via section updates group checkbox state correctly (2 tests)
    - Edge case: selecting/deselecting via group updates section checkbox state correctly (2 tests)
    - Edge case: empty groups/sections handle Select All gracefully (3 tests)
    - **Files:** `frontend/src/__tests__/contextPickerSelectAll.integration.test.tsx` (new file) - 14 tests added
    - **Note:** Added 14 integration tests to fill critical gaps

  - [x] 4.4 Run all feature-specific tests
    - Run all tests from Tasks 1.1, 2.1, 3.1, and 4.3
    - Total tests: 56 tests (21 + 11 + 10 + 14)
    - All critical workflows pass
    - Did NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (56 tests total)
- DEP label resolution is verified in integration context
- Bulk selection correctly populates Apply payload
- Section and group checkbox states stay synchronized
- 14 additional integration tests added to fill gaps

---

## Execution Order

**Recommended implementation sequence:**

```
Phase 1 (Parallel):
  - Task Group 1: DEP Label Resolution
  - Task Group 2: Section-Level Select All (tasks 2.1-2.4 can start immediately)

Phase 2 (After Task Group 2):
  - Task Group 3: Group-Level Select All (depends on bulk handlers from 2.3/2.4)

Phase 3 (After all implementation):
  - Task Group 4: Test Review and Gap Analysis
```

**Dependency Graph:**
```
Task Group 1 ──────────────────────────────────┐
                                               ├──> Task Group 4
Task Group 2 ──> Task Group 3 ─────────────────┘
```

---

## Files Summary

**New Files:**
- `frontend/src/__tests__/depLabelResolution.test.ts`
- `frontend/src/__tests__/contextPickerSelectAll.section.test.tsx`
- `frontend/src/__tests__/contextPickerSelectAll.group.test.tsx`
- `frontend/src/__tests__/contextPickerSelectAll.integration.test.tsx`
- `frontend/src/utils/selectionUtils.ts` (if not adding to existing utils file)

**Modified Files:**
- `frontend/src/utils/dataEntityPointOptions.ts` - DEP parsing and resolution
- `frontend/src/utils/contextPickListBuilders.ts` - Enhanced entity lookup
- `frontend/src/utils/contextRelationshipLabelUtils.ts` - DEP label resolution in computeRelationshipLabel()
- `frontend/src/components/ProductView/ContextPickerModal.tsx` - Bulk handlers, label computation, section Select All, group Select All (EntityTypeGroup, RelationshipTypeGroup components)

**Reference Files (do not modify):**
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - Select All and indeterminate patterns
- `frontend/src/components/BundleSelector.tsx` - Event propagation pattern
- `frontend/src/components/DepthSelector.tsx` - Event propagation pattern
