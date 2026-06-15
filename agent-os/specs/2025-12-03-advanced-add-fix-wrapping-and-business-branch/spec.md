# Specification: Advanced Add – Fix Bottom-Up Recursive Wrapping and Restore Business Process/Activity Branch

## Overview

**Title:** Advanced Add – Fix bottom-up recursive wrapping and restore Business Process/Activity branch in tree

**Created:** 2025-12-03

**Status:** Draft

## Problem Statement

The current implementation of Advanced Add has two issues:

1. **Wrapping Order Issue:** The recursive wrapping of containers may not correctly wrap nodes from selected children up to the root as intended, potentially causing incorrect nesting order.

2. **Missing Business Branch:** The Advanced Add tree no longer shows the Application → Business Process → Process Activity branch, even though:
   - The relationship definitions exist (`application_point_business_points`, `application_point_business_processes`)
   - This chain can be added to the diagram via other context menu options
   - The Business Point super-entity was recently added to unify Business Process and Process Activity relationships

## Goals

1. Ensure bottom-up recursive wrapping produces visually identical results to existing "Add with..." context menu options
2. Restore the Application → Business Process → Process Activity branch in the Advanced Add tree
3. Maintain existing technical stack branch (Application → App Component → Service → Interface → Logical Data Entity)
4. Ensure subtree-merging logic does not incorrectly remove the Business branch

## Non-Goals

- Changes to other context menu options
- Changes to non-Advanced-Add behaviours
- Adding new relationship types (only fixing visibility of existing ones)

---

## Technical Specification

### 1. Bottom-Up Recursive Wrapping Algorithm

#### 1.1 Current Implementation Analysis

**Location:** `frontend/src/components/DiagramsView/PalettePanel.tsx` - `buildWrappedNodeHierarchy()` (lines 149-391)

The current implementation uses:
- `buildOrderedNodeListFromLeaves()` - orders nodes from leaves to root
- Two-pass algorithm: first creates nodes with z-index, second sets parent relationships

**Current Algorithm:**
1. Build ordered list from leaves to root
2. First pass: Create all nodes (root gets baseZ, children increment)
3. Second pass: Set parent_node_id and recalculate positions

#### 1.2 Required Algorithm Clarification

The bottom-up wrapping algorithm MUST:

1. **Determine selected leaves**
   - After user confirms "Add to Diagram", identify leaf entity instances from tree selection
   - Leaves are the deepest selected nodes in each branch

2. **Build ancestor chains**
   - For each selected leaf, compute ordered chain back to subtree root
   - Example: Logical Data Entity → Interface → Service → App Component → Application

3. **Create/reuse diagram nodes (bottom-up)**
   - For each leaf: ensure diagram node exists
   - For each ancestor (leaf to root order):
     - Ensure diagram node exists (create if missing, reuse if exists)
     - Apply containment: ancestor becomes container of immediate descendant
     - Use same padding, borders, label styles as existing "Add with..." commands

4. **Merge common ancestors**
   - When multiple leaves share ancestors, reuse the same ancestor nodes
   - Never create duplicate parent nodes

#### 1.3 Verification Requirements

The wrapping result MUST be visually identical to:
- "Add with business processes"
- "Add with application components"
- Other existing right-click containment options

**Expected Container Hierarchy:**

```
┌─────────────────────────────────────────┐
│ Application: My App                      │
│ ┌─────────────────────────────────────┐ │
│ │ App Component: My Component          │ │
│ │ ┌─────────────────────────────────┐ │ │
│ │ │ Service: My Service              │ │ │
│ │ │ ┌─────────────────────────────┐ │ │ │
│ │ │ │ Interface: My API            │ │ │ │
│ │ │ │ ┌─────────────┐ ┌─────────┐ │ │ │ │
│ │ │ │ │ Entity 1    │ │Entity 2 │ │ │ │ │
│ │ │ │ └─────────────┘ └─────────┘ │ │ │ │
│ │ │ └─────────────────────────────┘ │ │ │
│ │ └─────────────────────────────────┘ │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

### 2. Restore Business Process/Activity Branch in Tree

#### 2.1 Current State Analysis

**Location:** `frontend/src/utils/advancedAddRelationships.ts`

Current APPLICATION relationships:
```typescript
[ENTITY_TYPES.APPLICATION]: [
  { targetEntityType: ENTITY_TYPES.APP_COMPONENT, ... },  // ✓ Technical branch
  { targetEntityType: ENTITY_TYPES.SERVICE, ... },        // ✓ Technical branch
  { targetEntityType: ENTITY_TYPES.BUSINESS_POINT, ... }, // Business branch via BP
]
```

Current BUSINESS_POINT relationships:
```typescript
[ENTITY_TYPES.BUSINESS_POINT]: [
  { targetEntityType: ENTITY_TYPES.APPLICATION, ... },
  { targetEntityType: ENTITY_TYPES.BUSINESS_USER, ... },
]
```

**Issue:** BUSINESS_POINT does not expand to show the underlying Business Process or Process Activity. The tree stops at BUSINESS_POINT without revealing the actual business entities.

#### 2.2 Required Tree Structure

For an Application root, the Advanced Add tree MUST show **both** branches:

**Technical Stack Branch (already present):**
```
Application: My App
├── App Component: My Component
│   └── Service: My Service
│       └── Interface: My API
│           ├── Logical Data Entity: Entity 1
│           └── Logical Data Entity: Entity 2
```

**Business Branch (must be restored):**
```
Application: My App
├── Business Process: Order Processing (via Business Point)
│   ├── Process Activity: Validate Order
│   └── Process Activity: Process Payment
```

#### 2.3 Implementation Approach

**Option A: Expand Business Point to show underlying entities**

Update `EXPANDABLE_RELATIONSHIPS` for BUSINESS_POINT:

```typescript
[ENTITY_TYPES.BUSINESS_POINT]: [
  // Existing...
  {
    targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
    relationshipKind: 'DERIVED',
    direction: 'UNDERLYING',
    relationshipTableName: 'business_points',
    foreignKeyField: 'business_process_id',
    displayLabel: 'Business Processes',
  },
  {
    targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
    relationshipKind: 'DERIVED',
    direction: 'UNDERLYING',
    relationshipTableName: 'business_points',
    foreignKeyField: 'process_activity_id',
    displayLabel: 'Process Activities',
  },
]
```

**Option B: Direct Application → Business Process relationship**

Add direct relationship from APPLICATION to BUSINESS_PROCESS:

```typescript
[ENTITY_TYPES.APPLICATION]: [
  // Existing...
  {
    targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'application_point_business_points',
    foreignKeyField: 'application_point_id',
    displayLabel: 'Business Processes',
    // Custom lookup: find BPs linked to this App's Application Point
  },
]
```

**Recommended: Option A** - This leverages the existing Business Point abstraction and is more consistent with the recent Business Point implementation.

#### 2.4 Update findRelatedEntities()

**File:** `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`

Add handling for the new `'UNDERLYING'` direction to resolve Business Points to their underlying entities:

```typescript
case 'UNDERLYING':
  if (relationshipTableName === 'business_points') {
    const businessPoints = metaModel.entities.business_points || [];
    // For BUSINESS_PROCESS target: find BPs where business_process_id is set
    // For PROCESS_ACTIVITY target: find BPs where process_activity_id is set
    // Return the underlying entity, not the BP itself
  }
  break;
```

#### 2.5 Tree Display Format

Business entities in the tree should display with their type indicator:

| Entity | Display Format |
|--------|---------------|
| Business Process | `Order Processing` |
| Process Activity | `Validate Order` |

The type is already implied by the tree hierarchy level.

---

### 3. Subtree-Merging Clarification

#### 3.1 Current Deduplication Logic

**Location:** `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - `buildTreeData()` (lines 250-263)

```typescript
const entityKey = `${entityType}_${entity.id}`;
if (addedEntities.has(entityKey)) {
  return null; // Skip duplicate
}
addedEntities.add(entityKey);
```

#### 3.2 Required Behaviour

Subtree merging MUST:

1. **Merge identical node paths** - Same entity ID + same relationship chain = deduplicate
2. **NOT remove Business branch** - Business Process/Activity branch must remain visible even when Application has other branches

#### 3.3 Branch Separation Logic

The deduplication should consider branch context:

```typescript
// Include branch type in deduplication key
const branchType = getBranchType(ancestorPath); // 'TECHNICAL' or 'BUSINESS'
const entityKey = `${branchType}_${entityType}_${entity.id}`;
```

This ensures:
- Technical entities (App Component, Service, Interface) only deduplicate within technical branch
- Business entities (Business Process, Process Activity) only deduplicate within business branch
- An entity appearing in both branches (if possible) appears in both

---

### 4. Container Entity Types

#### 4.1 Current Container Types

```typescript
CONTAINER_ENTITY_TYPES: Set<string> = new Set([
  ENTITY_TYPES.APPLICATION,
  ENTITY_TYPES.APP_COMPONENT,
  ENTITY_TYPES.SERVICE,
  ENTITY_TYPES.BUSINESS_PROCESS,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
]);
```

#### 4.2 Required Update

Add INTERFACE as a container type (it contains Logical Data Entities):

```typescript
CONTAINER_ENTITY_TYPES: Set<string> = new Set([
  ENTITY_TYPES.APPLICATION,
  ENTITY_TYPES.APP_COMPONENT,
  ENTITY_TYPES.SERVICE,
  ENTITY_TYPES.INTERFACE,           // ADD THIS
  ENTITY_TYPES.BUSINESS_PROCESS,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
]);
```

---

### 5. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/advancedAddRelationships.ts` | Add BUSINESS_POINT → underlying entity relationships |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Update `findRelatedEntities()` for UNDERLYING direction, potentially update deduplication logic |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Verify/fix bottom-up wrapping order, add INTERFACE to container types |
| `frontend/src/types/advancedAdd.ts` | Add 'UNDERLYING' to RelationshipDirection type if needed |

---

### 6. Test Scenarios

#### 6.1 Technical Stack Wrapping

**Scenario:** User selects Logical Data Entities under Application's technical branch via Advanced Add

**Expected Result:**
- Nested containers: Application → App Component → Service → Interface → Entities
- Visual identical to existing "Add with application components" behavior

#### 6.2 Business Branch Visibility

**Scenario:** Application has linked Business Processes and Process Activities

**Expected Result:**
- Advanced Add tree shows Business Process → Process Activity branch under Application
- Branch is separate from technical branch
- Selecting Business Process adds it to diagram with proper containment

#### 6.3 Mixed Selection

**Scenario:** User selects both technical entities (Logical Data Entities) and business entities (Process Activities) from the same Application

**Expected Result:**
- Both branches render correctly
- Application container contains both:
  - Technical subtree (App Component → Service → Interface → Entities)
  - Business subtree (Business Process → Process Activities)

#### 6.4 Deduplication Correctness

**Scenario:** Same Service appears under multiple App Components

**Expected Result:**
- Service appears only once in tree (first occurrence)
- Business branch remains visible regardless of technical branch deduplication

---

### 7. Acceptance Criteria

1. ✅ Bottom-up wrapping produces correct nested containers
2. ✅ Wrapping result is visually identical to existing "Add with..." options
3. ✅ Business Process branch visible under Application in Advanced Add tree
4. ✅ Process Activity branch visible under Business Process
5. ✅ Technical branch remains functional and unchanged
6. ✅ Subtree merging does not remove Business branch
7. ✅ Interface acts as container for Logical Data Entities
8. ✅ All existing Advanced Add tests pass
9. ✅ New tests cover Business branch scenarios

---

### 8. Implementation Notes

#### 8.1 Business Point Resolution

When displaying Business Points in the tree, resolve to the underlying entity:

```typescript
function resolveBusinessPoint(bp: BusinessPoint, metaModel: MetaModel): { id: string, name: string, type: EntityType } {
  if (bp.kind === 'BUSINESS_PROCESS') {
    const process = metaModel.entities.business_processes.find(p => p.id === bp.business_process_id);
    return { id: process.id, name: process.name, type: ENTITY_TYPES.BUSINESS_PROCESS };
  } else {
    const activity = metaModel.entities.process_activities.find(a => a.id === bp.process_activity_id);
    return { id: activity.id, name: activity.name, type: ENTITY_TYPES.PROCESS_ACTIVITY };
  }
}
```

#### 8.2 Containment Chain for Business Branch

When wrapping Business entities:

```
Application (container)
└── Business Process (container)
    └── Process Activity (leaf)
```

The Business Process should wrap its Process Activities using the same containment styling as the technical branch.

#### 8.3 Z-Index Ordering

Maintain correct z-index for proper visual layering:
- Root (Application): baseZ
- First level children: baseZ + 1
- Second level children: baseZ + 2
- etc.

This ensures outer containers render behind inner containers.
