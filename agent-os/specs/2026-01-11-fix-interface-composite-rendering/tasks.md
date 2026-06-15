# Task Breakdown: Fix Interface Composite Rendering

## Overview
Total Tasks: 3 Task Groups, 18 Sub-tasks

**Runtime Error to Fix:** `selectedDataEntityIds.logicalEntityIds is not iterable`

**Root Cause:** `buildInterfaceCompositeNodes` receives a `string[]` instead of the expected `DataEntityIdsForInterface` object, and the `InterfaceCustomCandidate` type lacks `physicalEntities` support.

## Task List

### Type and Utility Layer

#### Task Group 1: Extend InterfaceCustomCandidate and Utility Functions
**Dependencies:** None

- [x] 1.0 Complete type and utility layer updates
  - [x] 1.1 Write 4-6 focused tests for erdAdvancedAddUtils changes
    - Test `isInterfaceCustomLayoutCandidate` returns true for PHYSICAL_DATA_ENTITY children
    - Test `findInterfaceCustomCandidates` returns candidates with both `logicalEntities` and `physicalEntities`
    - Test candidate with only physical entities is detected as custom layout candidate
    - Test candidate with mixed endpoint, logical, and physical children populates all arrays
  - [x] 1.2 Extend InterfaceCustomCandidate type in erdAdvancedAddUtils.ts
    - File: `frontend/src/utils/erdAdvancedAddUtils.ts` lines 35-42
    - Add field: `physicalEntities: TreeNodeData[]`
    - Keep existing fields: `interface`, `endpoints`, `logicalEntities`
  - [x] 1.3 Update isInterfaceCustomLayoutCandidate to check PHYSICAL_DATA_ENTITY
    - File: `frontend/src/utils/erdAdvancedAddUtils.ts` lines 258-265
    - Add condition: `child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY`
    - Interface qualifies for custom layout if it has any selected endpoint OR logical entity OR physical entity child
  - [x] 1.4 Update findInterfaceCustomCandidates to collect physical entities
    - File: `frontend/src/utils/erdAdvancedAddUtils.ts` lines 296-306
    - Add filter for selected PHYSICAL_DATA_ENTITY children (parallel to logical entity filter at lines 297-300)
    - Include `physicalEntities: selectedPhysicalEntities` in the candidate object
  - [x] 1.5 Ensure type and utility tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify InterfaceCustomCandidate type compiles correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `InterfaceCustomCandidate` type includes `physicalEntities: TreeNodeData[]`
- `isInterfaceCustomLayoutCandidate` returns true for interfaces with physical entity children
- `findInterfaceCustomCandidates` populates both `logicalEntities` and `physicalEntities` arrays

**Files to Modify:**
- `frontend/src/utils/erdAdvancedAddUtils.ts`

**Reference Code:**
- `ENTITY_TYPES.PHYSICAL_DATA_ENTITY` constant from `frontend/src/config/entityTypes.ts`
- Existing logical entity filter pattern at lines 297-300

---

### Call Site Fixes

#### Task Group 2: Fix compoundLayout and PalettePanel Call Sites
**Dependencies:** Task Group 1

- [x] 2.0 Complete call site fixes
  - [x] 2.1 Write 4-6 focused tests for call site changes
    - Test `buildInterfaceCompositeNodes` does not throw when given valid `DataEntityIdsForInterface` with both logical and physical entity IDs
    - Test `buildInterfaceCompositeNodes` handles empty `physicalEntityIds` array without error
    - Test `calculateInterfaceCompositeDimensions` includes physical entity count in dimension calculations
    - Test dimension calculation with only physical entities (no logical entities)
  - [x] 2.2 Fix compoundLayout.ts to pass DataEntityIdsForInterface object
    - File: `frontend/src/utils/compoundLayout.ts` line 656
    - Replace `selectedLogicalEntityIds` (string[]) with DataEntityIdsForInterface object
    - Build object: `{ logicalEntityIds: candidate.logicalEntities.map(le => le.entityId), physicalEntityIds: candidate.physicalEntities?.map(pe => pe.entityId) || [] }`
    - Use defensive empty array if `candidate.physicalEntities` is undefined
  - [x] 2.3 Import DataEntityIdsForInterface type in compoundLayout.ts
    - Import from: `frontend/src/utils/interfaceCompositeBuilder.ts`
    - Type is already exported at lines 72-77
  - [x] 2.4 Update PalettePanel.tsx calculateInterfaceCompositeDimensions
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` lines 244-259
    - Include physical entity boxes in dimension calculations alongside logical entities
    - Physical entities should be counted in entity box rows/columns same as logical entities
  - [x] 2.5 Update PalettePanel_tmp.tsx calculateInterfaceCompositeDimensions
    - File: `frontend/src/components/DiagramsView/PalettePanel_tmp.tsx` lines 210-226
    - Apply same fix as PalettePanel.tsx
    - Keep both files in sync
  - [x] 2.6 Ensure call site tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify no runtime errors when rendering Interface composites
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- `buildInterfaceCompositeNodes` receives `DataEntityIdsForInterface` object, not `string[]`
- Runtime error `selectedDataEntityIds.logicalEntityIds is not iterable` is resolved
- PalettePanel dimension calculations include physical entity boxes

**Files to Modify:**
- `frontend/src/utils/compoundLayout.ts`
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/components/DiagramsView/PalettePanel_tmp.tsx`

**Reference Code:**
- `DataEntityIdsForInterface` type at `frontend/src/utils/interfaceCompositeBuilder.ts` lines 72-77
- `getDataEntityIdsForInterface` helper at `frontend/src/utils/interfaceCompositeBuilder.ts` lines 95-101

---

### Legacy Normalization and Tests

#### Task Group 3: Add Legacy dataEntityPointId Normalization and Regression Tests
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete legacy normalization and test coverage
  - [x] 3.1 Write 4-6 focused tests for legacy normalization
    - Test `normalizeInterfaceLogicalEntities` fills `dataEntityPointId` from `logical_entity_id` when missing
    - Test `normalizeInterfaceLogicalEntities` fills `dataEntityPointId` from `physical_entity_id` when missing
    - Test normalization preserves existing `dataEntityPointId` values (no overwrite)
    - Test normalization handles rows with no legacy fields gracefully
  - [x] 3.2 Create normalizeInterfaceLogicalEntities function in ArchitectureContext.tsx
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Create function that processes `interface_logical_entities` array
    - For each row where `dataEntityPointId` is missing/blank:
      - If legacy `logical_entity_id` exists: set `dataEntityPointId = "dep_log_" + logical_entity_id`
      - If legacy `physical_entity_id` exists: set `dataEntityPointId = "dep_phy_" + physical_entity_id`
    - Do not remove legacy fields; only ensure `dataEntityPointId` is populated
  - [x] 3.3 Call normalizeInterfaceLogicalEntities in LOAD_MODEL reducer
    - File: `frontend/src/contexts/ArchitectureContext.tsx` lines 369-393
    - Call normalization after `entitiesWithDefaults` and before `reconcileApplicationPoints`
    - Follow existing migration pattern (similar to `migrateLogicalAttributes`)
  - [x] 3.4 Add integration regression test for Interface composite rendering
    - Test: Adding Interface entity with logical and physical entities via Advanced Add renders without runtime errors
    - Test: Attribute selection map correctly uses raw entity IDs as keys (not point IDs)
  - [x] 3.5 Ensure legacy normalization tests pass
    - Run ONLY the 4-6 tests written in 3.1 plus regression test from 3.4
    - Verify legacy diagrams load without console warnings about missing point-id fields
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Legacy Interface-Entity relationships with missing `dataEntityPointId` are normalized on load
- Existing diagrams render without console warnings about missing point-id fields
- Regression tests confirm end-to-end Interface composite rendering works

**Files to Modify:**
- `frontend/src/contexts/ArchitectureContext.tsx`

**Reference Code:**
- `resolveDataEntitiesForInterface` at `frontend/src/utils/dataEntityPointOptions.ts` lines 233-274 (uses `dep_log_` and `dep_phy_` prefixes)
- LOAD_MODEL migration pattern at `frontend/src/contexts/ArchitectureContext.tsx` lines 369-393

---

## Execution Order

Recommended implementation sequence:

1. **Type and Utility Layer (Task Group 1)** - Must be completed first
   - Extends the `InterfaceCustomCandidate` type to include `physicalEntities`
   - Updates utility functions to detect and collect physical entity children
   - No external dependencies

2. **Call Site Fixes (Task Group 2)** - Depends on Task Group 1
   - Requires the extended `InterfaceCustomCandidate` type to access `physicalEntities`
   - Fixes the runtime error by passing correct data shape to `buildInterfaceCompositeNodes`
   - Updates dimension calculations in both PalettePanel files

3. **Legacy Normalization and Tests (Task Group 3)** - Depends on Task Groups 1-2
   - Can only verify full fix with both type extensions and call site fixes in place
   - Adds backward compatibility for legacy Interface-Entity relationships
   - Completes regression testing for the entire fix

## Summary of Changes by File

| File | Changes |
|------|---------|
| `frontend/src/utils/erdAdvancedAddUtils.ts` | Add `physicalEntities` to type, update detection and collection functions |
| `frontend/src/utils/compoundLayout.ts` | Fix call to `buildInterfaceCompositeNodes` with correct data shape |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update dimension calculations for physical entities |
| `frontend/src/components/DiagramsView/PalettePanel_tmp.tsx` | Same as above |
| `frontend/src/contexts/ArchitectureContext.tsx` | Add `normalizeInterfaceLogicalEntities` function and call in reducer |

## Test Summary

- **Task Group 1:** 4-6 tests for type and utility changes
- **Task Group 2:** 4-6 tests for call site fixes
- **Task Group 3:** 4-6 tests for normalization + integration regression tests
- **Total:** Approximately 12-18 focused tests for this bugfix

## Implementation Status

**All 3 Task Groups Completed** - 21 tests passing

Test file: `frontend/src/__tests__/interface-composite-rendering.test.ts`
