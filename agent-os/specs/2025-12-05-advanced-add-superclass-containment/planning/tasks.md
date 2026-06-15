# Implementation Tasks: Advanced Add Super-class Aware Containment

## Prerequisites

Before starting implementation, ensure you understand:
- Current `EXPANDABLE_RELATIONSHIPS` structure in `advancedAddRelationships.ts`
- Tree building logic in `AdvancedAddDialog.tsx`
- Wrapping algorithm in `PalettePanel.tsx`
- Existing test patterns in `frontend/src/__tests__/advanced-add-*.test.ts`

---

## Task Group 1: Add `actsAsContainment` Field to Relationship Definitions

### Task 1.1: Update `ExpandableRelationship` Interface

**File**: `frontend/src/utils/advancedAddRelationships.ts`

**Changes**:
1. Add `actsAsContainment` field to `ExpandableRelationship` interface:
```typescript
export interface ExpandableRelationship {
  targetEntityType: string;
  relationshipKind: RelationshipKind;
  direction: RelationshipDirection;
  relationshipTableName: string;
  foreignKeyField: string;
  displayLabel?: string;
  actsAsContainment: boolean;  // NEW: true for containment, false for edge-only
}
```

**Acceptance Criteria**:
- [ ] Interface updated with new field
- [ ] TypeScript compiles without errors

### Task 1.2: Update All Existing Relationships with `actsAsContainment`

**File**: `frontend/src/utils/advancedAddRelationships.ts`

**Changes**:
Add `actsAsContainment: true` or `actsAsContainment: false` to all existing entries in `EXPANDABLE_RELATIONSHIPS`:

| Entity Type | Relationship | `actsAsContainment` |
|-------------|--------------|---------------------|
| APPLICATION → APP_COMPONENT | PARENT_CHILD/CHILD | `true` |
| APPLICATION → SERVICE | PARENT_CHILD/CHILD | `true` |
| APPLICATION → BUSINESS_POINT | ASSOCIATION | `false` (to be changed in Task 2) |
| BUSINESS_PROCESS → PROCESS_ACTIVITY | PARENT_CHILD/CHILD | `true` |
| BUSINESS_POINT → APPLICATION | ASSOCIATION | `false` |
| BUSINESS_POINT → BUSINESS_USER | ASSOCIATION | `false` |
| BUSINESS_POINT → BUSINESS_PROCESS | UNDERLYING | `true` |
| BUSINESS_POINT → PROCESS_ACTIVITY | UNDERLYING | `true` |
| APP_COMPONENT → SERVICE | PARENT_CHILD/CHILD | `true` |
| SERVICE → INTERFACE | PARENT_CHILD/CHILD | `true` |
| LOGICAL_DATA_ENTITY → LOGICAL_DATA_ATTRIBUTE | PARENT_CHILD/CHILD | `true` |
| LOGICAL_DATA_ENTITY → PHYSICAL_DATA_ENTITY | ASSOCIATION | `false` |
| PHYSICAL_DATA_ENTITY → PHYSICAL_DATA_ATTRIBUTE | PARENT_CHILD/CHILD | `true` |
| BUSINESS_USER → BUSINESS_POINT | ASSOCIATION | `false` |
| INTERFACE → LOGICAL_DATA_ENTITY | ASSOCIATION | **`true`** (containment) |

**Acceptance Criteria**:
- [ ] All 15+ relationships have explicit `actsAsContainment` value
- [ ] TypeScript compiles
- [ ] Existing tests still pass (no behaviour change yet)

---

## Task Group 2: Refactor App Point ↔ Business Point Traversal

### Task 2.1: Change Application's BUSINESS_POINT Target to Concrete Types

**File**: `frontend/src/utils/advancedAddRelationships.ts`

**Changes**:
Replace the current `BUSINESS_POINT` target with two new entries for `BUSINESS_PROCESS` and `PROCESS_ACTIVITY`:

```typescript
[ENTITY_TYPES.APPLICATION]: [
  // ... existing APP_COMPONENT and SERVICE entries ...

  // REMOVE:
  // {
  //   targetEntityType: ENTITY_TYPES.BUSINESS_POINT,
  //   relationshipKind: 'ASSOCIATION',
  //   direction: 'ASSOCIATION',
  //   relationshipTableName: 'application_point_business_points',
  //   foreignKeyField: 'application_point_id',
  //   displayLabel: 'Business Points',
  // },

  // ADD:
  {
    targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'application_point_business_points',
    foreignKeyField: 'application_point_id',
    displayLabel: 'Business Processes',
    actsAsContainment: true,
  },
  {
    targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'application_point_business_points',
    foreignKeyField: 'application_point_id',
    displayLabel: 'Process Activities',
    actsAsContainment: true,
  },
],
```

Apply same pattern to `APP_COMPONENT` and `SERVICE` if they should also expand to Business Processes.

**Acceptance Criteria**:
- [ ] APPLICATION no longer targets BUSINESS_POINT
- [ ] APPLICATION now targets BUSINESS_PROCESS and PROCESS_ACTIVITY
- [ ] Both marked as `actsAsContainment: true`

### Task 2.2: Update `findRelatedEntities()` to Resolve Points to Concrete Entities

**File**: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`

**Changes**:
Add new case handling for `application_point_business_points` that resolves to concrete entities:

```typescript
case 'application_point_business_points': {
  // Handle Application/Component/Service -> Business Process/Activity
  if (rootEntityType === ENTITY_TYPES.APPLICATION ||
      rootEntityType === ENTITY_TYPES.APP_COMPONENT ||
      rootEntityType === ENTITY_TYPES.SERVICE) {

    // 1. Find Application Point for this concrete entity
    const appPoint = metaModel.entities.application_points.find(ap => {
      switch (rootEntityType) {
        case ENTITY_TYPES.APPLICATION:
          return ap.kind === 'APPLICATION' && ap.application_id === rootEntityId;
        case ENTITY_TYPES.APP_COMPONENT:
          return ap.kind === 'APP_COMPONENT' && ap.application_component_id === rootEntityId;
        case ENTITY_TYPES.SERVICE:
          return ap.kind === 'SERVICE' && ap.service_id === rootEntityId;
        default:
          return false;
      }
    });

    if (!appPoint) return [];

    // 2. Find linked Business Points
    const linkedBpIds = metaModel.relationships.application_point_business_points
      .filter(rel => rel.application_point_id === appPoint.id)
      .map(rel => rel.business_point_id);

    const uniqueBpIds = [...new Set(linkedBpIds)];

    // 3. Resolve each Business Point to concrete entity
    const results: Array<{ id: string; name: string }> = [];

    for (const bpId of uniqueBpIds) {
      const bp = metaModel.entities.business_points.find(b => b.id === bpId);
      if (!bp) continue;

      // Filter by targetEntityType
      if (targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS && bp.kind === 'BUSINESS_PROCESS') {
        const process = metaModel.entities.business_processes.find(
          p => p.id === bp.business_process_id
        );
        if (process) {
          results.push({ id: process.id, name: process.name });
        }
      } else if (targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY && bp.kind === 'PROCESS_ACTIVITY') {
        const activity = metaModel.entities.process_activities.find(
          a => a.id === bp.process_activity_id
        );
        if (activity) {
          results.push({ id: activity.id, name: activity.name });
        }
      }
    }

    return results;
  }
  break;
}
```

**Acceptance Criteria**:
- [ ] Application root finds Business Processes via Point resolution
- [ ] Application root finds Process Activities via Point resolution
- [ ] App Component root finds linked Business Processes
- [ ] Service root finds linked Business Processes
- [ ] No BUSINESS_POINT nodes appear in returned results

### Task 2.3: Remove BUSINESS_POINT from Tree Display

**File**: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`

**Changes**:
Ensure `buildTreeData()` and `buildNodeRecursive()` never create nodes for `ENTITY_TYPES.BUSINESS_POINT`:

1. Add check at start of `buildNodeRecursive()`:
```typescript
// Never create tree nodes for Point types
if (entityType === ENTITY_TYPES.BUSINESS_POINT ||
    entityType === ENTITY_TYPES.APPLICATION_POINT) {
  return null;
}
```

2. Or filter in relationship processing to skip Point types entirely.

**Acceptance Criteria**:
- [ ] Tree never contains "Business Point: X" nodes
- [ ] Tree never contains "Application Point: X" nodes
- [ ] Only concrete entity types appear in tree

---

## Task Group 3: Interface ↔ Logical Entity Containment

### Task 3.1: Mark Interface ↔ Logical Entity as Containment

**File**: `frontend/src/utils/advancedAddRelationships.ts`

**Changes**:
Update the INTERFACE entry:

```typescript
[ENTITY_TYPES.INTERFACE]: [
  {
    targetEntityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'interface_logical_entities',
    foreignKeyField: 'interface_id',
    displayLabel: 'Logical Data Entities',
    actsAsContainment: true,  // Changed from false to true
  },
],
```

**Acceptance Criteria**:
- [ ] Interface ↔ Logical Entity marked as containment
- [ ] Advanced Add from Interface shows Logical Entities as children

### Task 3.2: Verify INTERFACE is in CONTAINER_ENTITY_TYPES

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

**Changes**:
Verify `ENTITY_TYPES.INTERFACE` is in `CONTAINER_ENTITY_TYPES` (should already be there from prior work):

```typescript
const CONTAINER_ENTITY_TYPES: Set<string> = new Set([
  ENTITY_TYPES.APPLICATION,
  ENTITY_TYPES.APP_COMPONENT,
  ENTITY_TYPES.SERVICE,
  ENTITY_TYPES.INTERFACE,  // Must be present
  ENTITY_TYPES.BUSINESS_PROCESS,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
]);
```

**Acceptance Criteria**:
- [ ] INTERFACE is in container types
- [ ] Selecting Logical Entity under Interface creates nested node

---

## Task Group 4: Update Wrapping Logic for Cross-Branch Containment

### Task 4.1: Handle Business Process Containment in Application

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

**Changes**:
Ensure `buildWrappedNodeHierarchy()` correctly sets `parent_node_id` when a Business Process is added under an Application via Advanced Add:

1. When tree shows Application → Business Process (via resolved Point), the resulting diagram node for Business Process should have `parent_node_id` pointing to the Application diagram node.

2. The algorithm already processes nodes from leaves to root and finds parents via the tree structure. Verify this works for the App → BP path.

**Acceptance Criteria**:
- [ ] Business Process node has correct `parent_node_id` (Application's node ID)
- [ ] No Application Point node created
- [ ] No edge created between Application and Business Process

### Task 4.2: Handle Logical Entity Containment in Interface

**File**: `frontend/src/components/DiagramsView/PalettePanel.tsx`

**Changes**:
Same as above - verify Logical Data Entity gets `parent_node_id` pointing to Interface.

**Acceptance Criteria**:
- [ ] Logical Entity node has correct `parent_node_id` (Interface's node ID)
- [ ] No edge created between Interface and Logical Entity

---

## Task Group 5: Write Tests

### Task 5.1: Test Tree Building for Application → Business Process

**File**: `frontend/src/__tests__/advanced-add-superclass-containment.test.ts` (new file)

**Test Cases**:
1. Application root shows Business Processes as children (not Business Points)
2. Application root shows Process Activities as children (not Business Points)
3. Tree never contains Business Point or Application Point nodes
4. Correct entity IDs are used (concrete entity IDs, not Point IDs)

### Task 5.2: Test Tree Building for Interface → Logical Entity

**File**: Same test file

**Test Cases**:
1. Interface root shows Logical Data Entities as children
2. Relationship marked as containment
3. Selecting Logical Entity produces correct tree path

### Task 5.3: Test Diagram Wrapping

**File**: Same test file or `advanced-add-wrapping-containment.test.ts`

**Test Cases**:
1. Selecting Business Processes under Application creates nested diagram
2. Business Process has `parent_node_id` = Application node ID
3. No BUSINESS_POINT nodes in diagram output
4. No APP_POINT_BUSINESS_POINT edges created

### Task 5.4: Test Logical Entity Wrapping

**File**: Same test file

**Test Cases**:
1. Selecting Logical Entities under Interface creates nested diagram
2. Logical Entity has `parent_node_id` = Interface node ID
3. No INTERFACE_LOGICAL_ENTITY edges created for containment scenario

---

## Task Group 6: Edge Cases and Deduplication

### Task 6.1: Handle Same Entity via Multiple Paths

**Concern**: A Business Process might be reachable via:
- Application → Business Process (via Point)
- Business Process root directly

**Solution**: Existing deduplication (`addedEntities` Set) handles this. Verify no regression.

**Acceptance Criteria**:
- [ ] Entity appearing via multiple paths = single tree node
- [ ] No duplicate diagram nodes created

### Task 6.2: Handle Depth Limits with Business Branch

**Concern**: Application → Business Process → Process Activity is 3 levels. Ensure max depth (10) still applies.

**Acceptance Criteria**:
- [ ] Tree respects MAX_TREE_DEPTH = 10
- [ ] Business branch not truncated prematurely

### Task 6.3: Handle Empty Relationships

**Concern**: Application with no linked Business Points should show empty Business Process section.

**Acceptance Criteria**:
- [ ] No crash if no App Point ↔ Business Point relationships exist
- [ ] Tree shows "no children" correctly

---

## Task Group 7: Regression Testing

### Task 7.1: Verify Existing Tests Pass

Run all existing Advanced Add tests:
```bash
npm test -- --testPathPattern="advanced-add"
```

**Acceptance Criteria**:
- [ ] All existing tests pass
- [ ] No behaviour changes for edge-only relationships

### Task 7.2: Verify "Add with business processes" Still Works

**Test**: Use context menu "Add with business processes" on Application
- Should still work
- Should produce same nested result as before

**Acceptance Criteria**:
- [ ] Context menu action works
- [ ] Result matches expected containment

### Task 7.3: Verify Edge-Only Relationships Unchanged

**Test**: User ↔ Business Point, Logical ER, Data Movements
- Should still draw edges
- Should not create nested boxes

**Acceptance Criteria**:
- [ ] User ↔ Business Point draws dashed edge
- [ ] Logical ER draws solid edge with multiplicities
- [ ] Data Movement draws solid edge with arrow

---

## Implementation Order

1. **Task Group 1**: Add field to interface (low risk)
2. **Task Group 5.1-5.2**: Write tests first (TDD approach)
3. **Task Group 2**: Refactor Application → Business Process traversal
4. **Task Group 3**: Mark Interface ↔ Logical Entity as containment
5. **Task Group 4**: Verify wrapping logic
6. **Task Group 5.3-5.4**: Complete wrapping tests
7. **Task Group 6**: Edge cases
8. **Task Group 7**: Regression testing

---

## Estimated Files Changed

| File | Type of Change |
|------|----------------|
| `frontend/src/utils/advancedAddRelationships.ts` | Interface update, relationship updates |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | `findRelatedEntities()` new cases |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Verify container types |
| `frontend/src/__tests__/advanced-add-superclass-containment.test.ts` | New test file |

---

## Definition of Done

- [ ] `actsAsContainment` field added to all relationships
- [ ] Application → Business Process tree shows concrete entities
- [ ] Application → Business Process diagram uses containment (nested boxes)
- [ ] Interface → Logical Entity tree shows correct hierarchy
- [ ] Interface → Logical Entity diagram uses containment
- [ ] No Point nodes in trees
- [ ] No Point nodes in diagrams (from Advanced Add)
- [ ] No containment edges drawn for containment relationships
- [ ] All new tests pass
- [ ] All existing tests pass
- [ ] No regression in edge-only relationships
