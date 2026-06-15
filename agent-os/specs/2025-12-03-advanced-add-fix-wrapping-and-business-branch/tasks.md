# Task Breakdown: Advanced Add - Fix Wrapping and Business Branch

## Overview
Total Tasks: 28 tasks across 4 task groups

This feature addresses two problems in the Advanced Add functionality:
1. **Missing Business Branch**: Restore Application -> Business Process -> Process Activity branch in the Advanced Add tree
2. **Wrapping Order Verification**: Ensure bottom-up recursive wrapping produces correct nested containers matching existing "Add with..." options

## Task List

### Type Definitions and Relationship Configuration

#### Task Group 1: Add UNDERLYING Direction and Business Point Relationships
**Dependencies:** None

- [x] 1.0 Complete type definitions and relationship configuration
    - [x] 1.1 Write 4 focused tests for UNDERLYING direction and Business Point relationships
    - Test that RelationshipDirection type includes 'UNDERLYING'
    - Test that BUSINESS_POINT has expandable relationships to BUSINESS_PROCESS and PROCESS_ACTIVITY
    - Test that APPLICATION -> BUSINESS_POINT relationship is correctly configured
    - Test getExpandableRelationships() returns correct relationships for BUSINESS_POINT
    - [x] 1.2 Add UNDERLYING to RelationshipDirection type
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/advancedAddRelationships.ts`
    - Update line 26: `export type RelationshipDirection = 'CHILD' | 'PARENT' | 'ASSOCIATION' | 'UNDERLYING';`
    - Add documentation comment explaining UNDERLYING is for resolving super-entities (Business Point) to their underlying entities
    - [x] 1.3 Add BUSINESS_POINT -> BUSINESS_PROCESS relationship
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/advancedAddRelationships.ts`
    - Add to EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.BUSINESS_POINT] array:
    ```typescript
    {
      targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
      relationshipKind: 'PARENT_CHILD',
      direction: 'UNDERLYING',
      relationshipTableName: 'business_points',
      foreignKeyField: 'business_process_id',
      displayLabel: 'Business Processes',
    },
    ```
    - [x] 1.4 Add BUSINESS_POINT -> PROCESS_ACTIVITY relationship
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/advancedAddRelationships.ts`
    - Add to EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.BUSINESS_POINT] array:
    ```typescript
    {
      targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
      relationshipKind: 'PARENT_CHILD',
      direction: 'UNDERLYING',
      relationshipTableName: 'business_points',
      foreignKeyField: 'process_activity_id',
      displayLabel: 'Process Activities',
    },
    ```
    - [x] 1.5 Verify APPLICATION -> BUSINESS_POINT relationship configuration
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/advancedAddRelationships.ts`
    - Confirm lines 78-85 have correct relationship via `application_point_business_points`
    - Ensure foreignKeyField is `application_point_id` for traversal from Application
    - [x] 1.6 Run Task Group 1 tests
    - Run ONLY the 4 tests written in 1.1
    - **Command:** `npm test -- --testPathPattern="advanced-add-relationships" --testNamePattern="UNDERLYING|BUSINESS_POINT"`
    - Verify all relationship configuration tests pass

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- RelationshipDirection type includes 'UNDERLYING'
- BUSINESS_POINT has relationships to both BUSINESS_PROCESS and PROCESS_ACTIVITY
- APPLICATION -> BUSINESS_POINT relationship is correctly configured

---

### Tree Building Logic

#### Task Group 2: Update findRelatedEntities and Tree Building for Business Branch
**Dependencies:** Task Group 1

- [x] 2.0 Complete tree building updates for business branch visibility
  - [x] 2.1 Write 6 focused tests for tree building with business branch
    - Test findRelatedEntities() handles UNDERLYING direction for BUSINESS_PROCESS target
    - Test findRelatedEntities() handles UNDERLYING direction for PROCESS_ACTIVITY target
    - Test buildTreeData() shows Business Process branch under Application
    - Test buildTreeData() shows Process Activity branch under Business Process
    - Test deduplication does not remove business branch when technical branch exists
    - Test both technical and business branches visible under same Application
  - [x] 2.2 Add UNDERLYING case to findRelatedEntities()
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Add case after line 206 (after ASSOCIATION handling):
    ```typescript
    // For UNDERLYING relationships, resolve Business Points to their underlying entities
    if (direction === 'UNDERLYING') {
      if (relationshipTableName === 'business_points') {
        const businessPoints = metaModel.entities.business_points || [];

        // For BUSINESS_POINT root: directly resolve to underlying entity
        if (rootEntityType === ENTITY_TYPES.BUSINESS_POINT) {
          const bp = businessPoints.find((b) => b.id === rootEntityId);
          if (!bp) return [];

          if (targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS && bp.kind === 'BUSINESS_PROCESS') {
            const process = metaModel.entities.business_processes.find(
              (p) => p.id === bp.business_process_id
            );
            return process ? [{ id: process.id, name: process.name }] : [];
          }

          if (targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY && bp.kind === 'PROCESS_ACTIVITY' && bp.process_activity_id) {
            const activity = metaModel.entities.process_activities.find(
              (a) => a.id === bp.process_activity_id
            );
            return activity ? [{ id: activity.id, name: activity.name }] : [];
          }
        }
      }
      return [];
    }
    ```
  - [x] 2.3 Add APPLICATION -> BUSINESS_POINT case to findRelatedEntities() ASSOCIATION handling
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Add case in the ASSOCIATION switch block (around line 137-205):
    ```typescript
    case 'application_point_business_points': {
      if (rootEntityType === ENTITY_TYPES.APPLICATION) {
        const appPointIds = metaModel.entities.application_points
          .filter((ap) => ap.application_id === rootEntityId)
          .map((ap) => ap.id);

        const bpIds = metaModel.relationships.application_point_business_points
          .filter((rel) => appPointIds.includes(rel.application_point_id))
          .map((rel) => rel.business_point_id);

        const uniqueBpIds = [...new Set(bpIds)];
        return metaModel.entities.business_points
          .filter((bp) => uniqueBpIds.includes(bp.id))
          .map((bp) => ({ id: bp.id, name: bp.name }));
      }
      break;
    }
    ```
  - [x] 2.4 Add BUSINESS_POINT display name to getEntityTypeDisplayName()
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Verify line 75 has entry: `[ENTITY_TYPES.BUSINESS_POINT]: 'Business Point',`
    - If missing, add it to the displayNames object
  - [x] 2.5 Review deduplication logic in buildTreeData()
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Review lines 250-263 - current deduplication uses `entityType_entityId` key
    - Verify that business entities (BUSINESS_PROCESS, PROCESS_ACTIVITY) are NOT incorrectly deduplicated when appearing via Business Point path
    - If issues found, consider adding branch context to deduplication key
  - [x] 2.6 Run Task Group 2 tests
    - Run ONLY the 6 tests written in 2.1
    - **Command:** `npm test -- --testPathPattern="advanced-add-tree-building" --testNamePattern="Business|UNDERLYING|branch"`
    - Verify all tree building tests pass

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- findRelatedEntities() correctly handles UNDERLYING direction
- Application tree shows Business Point -> Business Process/Process Activity branch
- Business branch appears alongside technical branch (no incorrect deduplication)

---

### Wrapping and Containment Logic

#### Task Group 3: Fix Wrapping Order and Add INTERFACE to Container Types
**Dependencies:** None (can run in parallel with Task Group 2)

- [x] 3.0 Complete wrapping and containment updates
  - [x] 3.1 Write 6 focused tests for wrapping and containment
    - Test INTERFACE is included in CONTAINER_ENTITY_TYPES
    - Test buildOrderedNodeListFromLeaves() orders nodes correctly (leaves first)
    - Test buildWrappedNodeHierarchy() creates correct nested hierarchy for technical chain
    - Test buildWrappedNodeHierarchy() creates correct nested hierarchy for business chain
    - Test containment styling (text_v_align='TOP', text_font_weight='bold') is applied
    - Test z-index ordering (parents have lower z-index than children)
  - [x] 3.2 Add INTERFACE to CONTAINER_ENTITY_TYPES
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Update lines 66-73 to include INTERFACE:
    ```typescript
    const CONTAINER_ENTITY_TYPES: Set<string> = new Set([
      ENTITY_TYPES.APPLICATION,
      ENTITY_TYPES.APP_COMPONENT,
      ENTITY_TYPES.SERVICE,
      ENTITY_TYPES.INTERFACE,           // ADD THIS LINE
      ENTITY_TYPES.BUSINESS_PROCESS,
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
    ]);
    ```
  - [x] 3.3 Verify buildOrderedNodeListFromLeaves() implementation
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Review lines 424-452 - verify nodes are sorted by depth descending (deepest/leaves first)
    - Confirm the function is exported for use by PalettePanel.tsx
  - [x] 3.4 Verify buildWrappedNodeHierarchy() two-pass algorithm
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Review lines 149-391 for correct algorithm:
      - First pass: creates nodes with z-index (root gets baseZ, children increment)
      - Second pass: sets parent_node_id and recalculates positions
    - Verify containment styling is applied: `text_v_align: 'TOP'`, `text_font_weight: 'bold'`
  - [x] 3.5 Verify z-index ordering logic
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Review lines 196-204 - verify rootToLeavesOrder processing
    - Confirm parents get lower z-index than children (outer containers render behind inner)
  - [x] 3.6 Verify containment styling matches existing "Add with..." handlers
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Compare styling in buildWrappedNodeHierarchy() with:
      - handleAddWithBusinessProcesses() (lines 1035-1217)
      - handleAddWithAppComponents() (lines 1222-1396)
      - handleAddWithProcessActivities() (lines 1400-1573)
    - Ensure text_v_align, text_font_weight, padding, and dimensions are consistent
  - [x] 3.7 Run Task Group 3 tests
    - Run ONLY the 6 tests written in 3.1
    - **Command:** `npm test -- --testPathPattern="advanced-add-recursive-wrapping|advanced-add-wrapping" --testNamePattern="INTERFACE|container|wrap|hierarchy"`
    - Verify all wrapping tests pass

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- INTERFACE is a recognized container type
- Bottom-up wrapping produces correct nested containers
- Containment styling matches existing "Add with..." options
- Z-index ordering ensures proper visual layering

---

### Testing and Gap Analysis

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3 (all completed)

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 5 tests written by Task Group 1 (relationship configuration) in `advanced-add-underlying-direction.test.ts`
    - Review the 10 tests written by Task Group 2 (tree building) in `advanced-add-tree-building-business-branch.test.ts`
    - Review the 8 tests written by Task Group 3 (wrapping) in `advanced-add-container-types-wrapping.test.ts`
    - Total existing tests: 23 tests across 3 files
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage:
      - End-to-end: Application -> Business Process -> Process Activity selection and wrapping
      - Mixed selection: technical + business entities from same Application
      - Existing node reuse: when parent already exists on diagram
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/__tests__/advanced-add-business-branch.test.ts` (created)
    - Test 1: End-to-end Application with Business Process branch selection produces correct diagram nodes
    - Test 2: End-to-end Application with Process Activity selection produces correct nested hierarchy
    - Test 3: Mixed selection (technical + business) produces both branches in diagram
    - Test 4: Selecting Business Point resolves to underlying entity (BUSINESS_PROCESS and PROCESS_ACTIVITY variants)
    - Test 5: Wrapping with existing parent node on diagram reuses node (no duplicate)
    - Test 6: Visual result matches "Add with business processes" for equivalent selection
    - Test 7: Interface -> Logical Data Entity containment works correctly
    - Test 8: Business Process -> Process Activity containment styling matches spec
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - **Command:** `npx vitest run src/__tests__/advanced-add-underlying-direction.test.ts src/__tests__/advanced-add-tree-building-business-branch.test.ts src/__tests__/advanced-add-container-types-wrapping.test.ts src/__tests__/advanced-add-business-branch.test.ts`
    - Total: 32 tests across 4 test files
    - All tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (32 tests total)
- Critical user workflows for business branch feature are covered
- 9 additional tests added in `advanced-add-business-branch.test.ts` (8 integration tests covering all required scenarios)
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1** - Type definitions and relationship configuration (foundation)
2. **Task Group 2** - Tree building updates (enables business branch visibility)
3. **Task Group 3** - Wrapping and containment updates (can run parallel with Task Group 2)
4. **Task Group 4** - Test review and gap analysis (validates implementation)

---

## Key Files Summary

| File | Purpose | Task Groups |
|------|---------|-------------|
| `frontend/src/utils/advancedAddRelationships.ts` | Relationship definitions, UNDERLYING direction | 1 |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Tree building, findRelatedEntities(), deduplication | 2, 3 |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Wrapping logic, CONTAINER_ENTITY_TYPES, containment | 3 |
| `frontend/src/__tests__/advanced-add-underlying-direction.test.ts` | UNDERLYING direction and relationship tests | 1 |
| `frontend/src/__tests__/advanced-add-tree-building-business-branch.test.ts` | Business branch tree building tests | 2 |
| `frontend/src/__tests__/advanced-add-container-types-wrapping.test.ts` | Container types and wrapping tests | 3 |
| `frontend/src/__tests__/advanced-add-business-branch.test.ts` | Integration tests for business branch | 4 |

---

## Verification Checklist

After all tasks complete, verify these acceptance criteria from the spec:

- [x] Bottom-up wrapping produces correct nested containers
- [x] Wrapping result is visually identical to existing "Add with..." options
- [x] Business Process branch visible under Application in Advanced Add tree
- [x] Process Activity branch visible under Business Process
- [x] Technical branch remains functional and unchanged
- [x] Subtree merging does not remove Business branch
- [x] Interface acts as container for Logical Data Entities
- [x] All feature-specific Advanced Add tests pass (32 tests)
- [x] New tests cover Business branch scenarios

---

## Implementation Notes

### Business Point Resolution Pattern
When displaying Business Points in the tree, the UNDERLYING direction resolves to the actual business entity:
- `kind === 'BUSINESS_PROCESS'` -> resolve to Business Process using `business_process_id`
- `kind === 'PROCESS_ACTIVITY'` -> resolve to Process Activity using `process_activity_id`

### Expected Tree Structure for Application Root
```
Application: My App
+-- App Component: My Component          (technical branch)
|   +-- Service: My Service
|       +-- Interface: My API
|           +-- Logical Data Entity: Entity 1
|           +-- Logical Data Entity: Entity 2
+-- Business Point: Order Processing BP  (business branch)
    +-- Business Process: Order Processing
        +-- Process Activity: Validate Order
        +-- Process Activity: Process Payment
```

### Containment Hierarchy for Wrapping
Technical chain: Application -> App Component -> Service -> Interface -> Logical Data Entity
Business chain: Application -> Business Process -> Process Activity

Both chains use the same containment styling:
- `text_v_align: 'TOP'`
- `text_font_weight: 'bold'`
- Parent z-index < child z-index
