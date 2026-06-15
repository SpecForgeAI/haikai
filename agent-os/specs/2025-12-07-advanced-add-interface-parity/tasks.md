# Task Breakdown: Advanced Add Interface Parity

## Overview
Total Tasks: 24

This task breakdown implements the feature to make Advanced Add produce the same Interface custom visualisation as "Add with all children". The implementation follows the spec's five phases: shared helper creation, refactoring the existing handler, adding detection/filtering, updating the layout conversion, and final integration testing.

## Task List

### Shared Utility Layer

#### Task Group 1: Interface Composite Builder Helper
**Dependencies:** None

- [x] 1.0 Complete Interface composite builder utility
  - [x] 1.1 Write 4-6 focused tests for `buildInterfaceCompositeNodes`
    - Test basic Interface node creation with `render_style: 'contract'`
    - Test correct `embedded_endpoint_ids` population
    - Test correct `embedded_entity_ids` population
    - Test child entity node creation with correct `parent_node_id`
    - Test dimension calculations wrap all content correctly
    - Test z-index ordering (Interface lower than child entities)
  - [x] 1.2 Create `frontend/src/utils/interfaceCompositeBuilder.ts` (NEW FILE)
    - Define `InterfaceCompositeResult` interface with `interfaceNode` and `entityNodes` properties
    - Define `InterfaceCompositeConfig` interface for position, z-index, and parent parameters
  - [x] 1.3 Implement `buildInterfaceCompositeNodes` function
    - Accept interfaceId, selectedEndpointIds, selectedLogicalEntityIds, selectedAttributeIdsByEntity
    - Accept metaModel, basePosition, baseZIndex, parentNodeId parameters
    - Calculate Interface dimensions using existing `calculateInterfaceWithEntitiesHeight` and `calculateInterfaceWithEntitiesWidth`
    - Create Interface node with `render_style: 'contract'`, `embedded_endpoint_ids`, `embedded_entity_ids`
    - Create child entity nodes positioned INSIDE the Interface with correct parent_node_id
  - [x] 1.4 Implement helper function `getLogicalEntityIdsForInterface`
    - Query `interface_logical_entities` relationship from metaModel
    - Return array of logical entity IDs for given interface ID
  - [x] 1.5 Implement helper function `calculateEntityPositionsInInterface`
    - Calculate vertical stacking positions for entity boxes inside Interface
    - Account for header height, endpoint section height, padding, and gaps
    - Center entities horizontally within Interface bounds
  - [x] 1.6 Ensure Interface composite builder tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all helper functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `buildInterfaceCompositeNodes` returns correct Interface node structure
- Child entity nodes have correct positioning inside Interface bounds
- Z-index ordering is correct (children > parent)

**Files:**
- `frontend/src/utils/interfaceCompositeBuilder.ts` (NEW)
- `frontend/src/__tests__/interfaceCompositeBuilder.test.ts` (NEW)

---

### Refactoring Layer

#### Task Group 2: Refactor handleAddWithAllChildren
**Dependencies:** Task Group 1

- [x] 2.0 Complete handleAddWithAllChildren refactoring
  - [x] 2.1 Write 3-4 focused tests for refactored `handleAddWithAllChildren`
    - Test that "Add with all children" produces identical output before/after refactor
    - Test Interface with endpoints only produces correct structure
    - Test Interface with endpoints and logical entities produces correct structure
    - Test duplicate prevention still works after refactor
  - [x] 2.2 Update imports in `PalettePanel.tsx`
    - Import `buildInterfaceCompositeNodes` from `interfaceCompositeBuilder.ts`
    - Import `getLogicalEntityIdsForInterface` helper
  - [x] 2.3 Refactor `handleAddWithAllChildren` callback (lines 1739-1904)
    - Replace inline Interface node creation with call to `buildInterfaceCompositeNodes`
    - Pass all endpoint IDs from the interface
    - Pass all logical entity IDs via `getLogicalEntityIdsForInterface`
    - Pass `new Map()` for selectedAttributeIdsByEntity (all attributes selected)
    - Maintain viewport center positioning logic
  - [x] 2.4 Ensure refactored handleAddWithAllChildren tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify "Add with all children" behavior unchanged
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- "Add with all children" context menu produces identical JSON as before
- No regression in existing functionality

**Files:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/__tests__/handleAddWithAllChildren.test.ts` (NEW or extend existing)

---

### Detection and Filtering Layer

#### Task Group 3: Interface Custom Candidate Detection in buildWrappedNodeHierarchy
**Dependencies:** Task Group 1

- [x] 3.0 Complete Interface candidate detection and filtering
  - [x] 3.1 Write 4-5 focused tests for Interface candidate detection and filtering
    - Test `findInterfaceCustomCandidates` finds Interface with selected endpoints
    - Test `findInterfaceCustomCandidates` finds Interface with selected logical entities
    - Test filtering removes endpoints from orderedNodes when parent Interface is a candidate
    - Test filtering removes logical entities from orderedNodes when parent Interface is a candidate
    - Test Interface without selected children is NOT a candidate (falls back to plain node)
  - [x] 3.2 Add helper function `findParentInterfaceForEndpoint` to `erdAdvancedAddUtils.ts`
    - Search orderedNodes for parent Interface of an endpoint
    - Use `interface_id` relationship from endpoint entity
    - Return Interface TreeNodeData or null
  - [x] 3.3 Add helper function `findParentInterfaceForLogicalEntity` to `erdAdvancedAddUtils.ts`
    - Search orderedNodes for parent Interface of a logical entity
    - Use `interface_logical_entities` relationship from metaModel
    - Return Interface TreeNodeData or null
  - [x] 3.4 Update `buildWrappedNodeHierarchy` in `PalettePanel.tsx` (lines 187-389)
    - Add call to `findInterfaceCustomCandidates` after ERD candidate detection
    - Build `interfaceCandidateMap` (Map<string, InterfaceCustomCandidate>)
    - Update `filteredOrderedNodes` filter to exclude endpoints belonging to Interface candidates
    - Update `filteredOrderedNodes` filter to exclude logical entities belonging to Interface candidates
    - Pass `interfaceCandidateMap` to downstream layout functions
  - [x] 3.5 Ensure Interface candidate detection tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify filtering correctly removes embedded children
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Interface custom candidates are correctly identified
- Endpoints and logical entities are filtered when parent is a candidate
- Interface-only selection (no children) falls back to plain node

**Files:**
- `frontend/src/utils/erdAdvancedAddUtils.ts`
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/__tests__/advanced-add-interface-candidates.test.ts` (NEW)

---

### Layout Integration Layer

#### Task Group 4: Update Layout and Conversion for Interface Candidates
**Dependencies:** Task Groups 1, 3

- [x] 4.0 Complete layout integration for Interface candidates
  - [x] 4.1 Write 4-5 focused tests for layout conversion with Interface candidates
    - Test `layoutAdvancedAddSelection` accepts interfaceCandidateMap parameter
    - Test `convertTodiagramNodes` creates Interface node with `render_style: 'contract'`
    - Test `convertTodiagramNodes` adds `embedded_endpoint_ids` to Interface candidates
    - Test `convertTodiagramNodes` adds `embedded_entity_ids` to Interface candidates
    - Test child entity nodes are created with correct positioning inside Interface
  - [x] 4.2 Update `layoutAdvancedAddSelection` signature in `compoundLayout.ts`
    - Add optional `interfaceCandidateMap?: Map<string, InterfaceCustomCandidate>` parameter
    - Pass through to measure and assignPositions functions as needed
    - Handle Interface candidate dimensions during measurement
  - [x] 4.3 Update `convertTodiagramNodes` in `compoundLayout.ts`
    - Add optional `interfaceCandidateMap` parameter to signature
    - In traverse function, check if current node is an Interface custom candidate
    - For Interface candidates: call `buildInterfaceCompositeNodes` instead of standard node creation
    - Merge returned nodes (Interface + entity nodes) into result array
    - Ensure z-index ordering preserved
  - [x] 4.4 Update call sites in `PalettePanel.tsx`
    - Update `handleAdvancedAddConfirm` to pass `interfaceCandidateMap` to `buildWrappedNodeHierarchy`
    - Update call to `layoutAdvancedAddSelection` to include `interfaceCandidateMap`
    - Update call to `convertTodiagramNodes` to include `interfaceCandidateMap`
  - [x] 4.5 Ensure layout integration tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify Interface candidates produce custom layout
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 4.1 pass
- Interface candidates produce nodes with `render_style: 'contract'`
- Embedded endpoint and entity IDs are correctly set
- Child entities positioned inside Interface bounds

**Files:**
- `frontend/src/utils/compoundLayout.ts`
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/__tests__/advanced-add-interface-layout.test.ts` (NEW)

---

### Testing Layer

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written by Task Group 1 (interfaceCompositeBuilder)
    - Review the 3-4 tests written by Task Group 2 (handleAddWithAllChildren refactor)
    - Review the 4-5 tests written by Task Group 3 (candidate detection)
    - Review the 4-5 tests written by Task Group 4 (layout integration)
    - Total existing tests: approximately 15-20 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to Advanced Add Interface parity
    - Prioritize integration tests over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - **AC2 Test:** Full chain (Application -> Component -> Service -> Interface -> Entities + Endpoints)
    - **AC3 Test:** JSON parity between "Add with all children" and Advanced Add for same Interface
    - **AC4 Test:** Partial selection (only some endpoints/entities selected)
    - **AC5 Test:** Interface-only selection falls back to plain node
    - Add maximum of 4-8 additional tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Skip edge cases, performance tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 23-28 tests maximum
    - Do NOT run the entire application test suite
    - Verify all acceptance criteria pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-28 tests total)
- AC1: "Add with all children" unchanged (no regression)
- AC2: Full chain produces custom Interface layout
- AC3: Visual parity between both paths
- AC4: Partial selection includes only selected children
- AC5: Interface-only selection produces plain node
- No more than 8 additional tests added

**Files:**
- `frontend/src/__tests__/advanced-add-interface-parity-integration.test.ts` (NEW)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Shared Utility Layer** - Create `buildInterfaceCompositeNodes` helper
   - No dependencies
   - Foundation for all subsequent work

2. **Task Group 2: Refactoring Layer** - Refactor `handleAddWithAllChildren`
   - Depends on Task Group 1
   - Validates the shared helper works correctly
   - Ensures no regression in existing functionality

3. **Task Group 3: Detection and Filtering Layer** - Add candidate detection
   - Depends on Task Group 1
   - Can run in parallel with Task Group 2 if needed
   - Extends existing `erdAdvancedAddUtils.ts` detection functions

4. **Task Group 4: Layout Integration Layer** - Update layout conversion
   - Depends on Task Groups 1 and 3
   - Integrates detection with layout algorithm
   - Connects all pieces together

5. **Task Group 5: Testing Layer** - Test review and gap analysis
   - Depends on all previous Task Groups
   - Final validation of acceptance criteria
   - Integration testing

---

## Files Summary

| File | Action | Task Group |
|------|--------|------------|
| `frontend/src/utils/interfaceCompositeBuilder.ts` | CREATE | 1 |
| `frontend/src/__tests__/interfaceCompositeBuilder.test.ts` | CREATE | 1 |
| `frontend/src/utils/erdAdvancedAddUtils.ts` | MODIFY | 3 |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | MODIFY | 2, 3, 4 |
| `frontend/src/utils/compoundLayout.ts` | MODIFY | 4 |
| `frontend/src/__tests__/advanced-add-interface-candidates.test.ts` | CREATE | 3 |
| `frontend/src/__tests__/advanced-add-interface-layout.test.ts` | CREATE | 4 |
| `frontend/src/__tests__/advanced-add-interface-parity-integration.test.ts` | CREATE | 5 |

---

## Risk Mitigation Notes

1. **Regression Prevention:** Task Group 2 specifically tests that "Add with all children" remains unchanged after refactoring
2. **Incremental Validation:** Each Task Group ends with running its specific tests before moving to the next phase
3. **Shared Code Reuse:** The `buildInterfaceCompositeNodes` helper is designed to be used by both paths, eliminating divergence
4. **Existing Detection Functions:** Task Group 3 builds on existing `findInterfaceCustomCandidates` function which was created but never integrated
