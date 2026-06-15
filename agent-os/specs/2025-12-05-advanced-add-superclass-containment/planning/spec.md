# Advanced Add – Super-class Aware Containment for App Point ↔ Business Point and Interface ↔ Logical Entity

## Overview

This specification defines how Advanced Add and diagram rendering must handle super-class entities (Application Point and Business Point) and containment relationships. The key principle is **Option 1: No Point Nodes** - diagrams show only concrete entities while Points are used internally for relationship traversal and enablement.

## Current State Analysis

### Existing Implementation

The current codebase has these key components:

1. **advancedAddRelationships.ts** - Defines `EXPANDABLE_RELATIONSHIPS` map with relationship kinds:
   - `PARENT_CHILD` - Direct containment from entity tables
   - `ASSOCIATION` - Links via relationship tables
   - `UNDERLYING` - Resolution of super-entities to concrete types

2. **AdvancedAddDialog.tsx** - Tree building with:
   - `buildTreeData()` - Recursive tree builder with deduplication and cycle detection
   - `findRelatedEntities()` - Finds related entities based on relationship definitions
   - Max depth of 10, unique key generation

3. **PalettePanel.tsx** - Contains:
   - `buildWrappedNodeHierarchy()` - Creates nested diagram nodes
   - `CONTAINER_ENTITY_TYPES` - Set of entity types that support children
   - Various "Add with..." handlers

4. **relationshipUtils.ts** - Relationship eligibility and edge creation:
   - `getEntitiesOnDiagram()` - Maps concrete nodes to Point IDs for eligibility
   - `findNodeForBusinessPoint()` / `findNodeForApplicationPointId()` - Priority-based node lookup

### Current Limitations

1. **Business Points appear in tree** - When expanding from Application, Business Points are shown as intermediate nodes
2. **No `acts_as_containment` flag** - Relationships lack explicit classification
3. **Interface ↔ Logical Entity not in containment** - Currently an ASSOCIATION relationship
4. **Inconsistent traversal** - App Point ↔ Business Point doesn't transparently resolve to concrete entities

---

## Specification

### 1. Super-classes: Application Point and Business Point (User-Transparent)

#### 1.1 Application Point

Application Point is a **super-class** over:
- Application
- Application Component
- Service

Each concrete entity has exactly one associated Application Point, created automatically with deterministic ID pattern: `ap_{sourceEntityId}`.

#### 1.2 Business Point

Business Point is a **super-class** over:
- Business Process
- Process Activity

Each concrete entity has exactly one associated Business Point, created automatically with deterministic ID pattern: `bp_{sourceEntityId}`.

#### 1.3 Required Behaviours

| Context | Behaviour |
|---------|-----------|
| Entity tables (RHS) | When user creates/edits/deletes concrete entities, corresponding Points are created/updated/deleted automatically. Users never see Points in entity sections. |
| Relationship tables | Columns use Point type names ("Application Point", "Business Point"). Autocomplete shows concrete names with type, e.g., "My App (Application)", "Order Capture (Business Process)". |
| Diagram view | No Point sections in palette. No Point nodes rendered. Points are internal constructs only. |
| Advanced Add tree | Point nodes are **never shown**. Only concrete entities appear in the tree. |

---

### 2. Containment vs Edge Relationship Classification

#### 2.1 Introduce `acts_as_containment` Flag

Add a conceptual classification for each relationship:

```typescript
type ContainmentBehaviour = 'CONTAINMENT' | 'EDGE_ONLY';
```

#### 2.2 Relationship Classification Table

| Relationship | Type | `acts_as_containment` | Notes |
|--------------|------|----------------------|-------|
| Application → App Component | Direct (parent/child) | **CONTAINMENT** | From entity table |
| Application → Service | Direct (parent/child) | **CONTAINMENT** | From entity table |
| App Component → Service | Direct (parent/child) | **CONTAINMENT** | From entity table |
| Service → Interface | Direct (parent/child) | **CONTAINMENT** | From entity table |
| Business Process → Process Activity | Direct (parent/child) | **CONTAINMENT** | From entity table |
| Logical Data Entity → Logical Data Attribute | Direct (parent/child) | **CONTAINMENT** | From entity table |
| Physical Data Entity → Physical Data Attribute | Direct (parent/child) | **CONTAINMENT** | From entity table |
| **App Point ↔ Business Point** | **Indirect** | **CONTAINMENT** | Business inside Application |
| **Interface ↔ Logical Entity** | **Indirect** | **CONTAINMENT** | Logical Entity inside Interface |
| User ↔ Business Point | Association | EDGE_ONLY | Dashed line |
| Logical ER | Association | EDGE_ONLY | Solid line with multiplicity |
| Logical ↔ Physical Entity | Association | EDGE_ONLY | Solid line |
| Logical ↔ Physical Attribute | Association | EDGE_ONLY | Solid line |
| Data Movements | Association | EDGE_ONLY | Solid line with arrow |

#### 2.3 Implementation Approach

Update `EXPANDABLE_RELATIONSHIPS` to add `actsAsContainment` field:

```typescript
export interface ExpandableRelationship {
  targetEntityType: string;
  relationshipKind: RelationshipKind;
  direction: RelationshipDirection;
  relationshipTableName: string;
  foreignKeyField: string;
  displayLabel?: string;
  actsAsContainment: boolean;  // NEW FIELD
}
```

---

### 3. Advanced Add Tree: Super-class Aware Containment Traversal

#### 3.1 Core Principle

The Advanced Add tree must:
- Traverse all relationships with `actsAsContainment = true`
- **Never show Point nodes** (Application Point, Business Point)
- Show only concrete entities
- Use Points as internal "bridges" for traversal

#### 3.2 Root Entity

The root is always a **concrete entity instance**:
- "Application: My App"
- "Service: My Service"
- "Business Process: Order Capture"

Never a Point.

#### 3.3 Traversal Algorithm Updates

When building children for a node:

1. **For direct containment** (PARENT_CHILD + CHILD direction):
   - Query child entities from entity table
   - Add as direct children in tree

2. **For App Point ↔ Business Point**:
   - Given an Application/Component/Service:
     a. Find its Application Point
     b. Query `application_point_business_points` for linked Business Points
     c. For each Business Point, resolve to concrete entity (Business Process or Process Activity)
     d. Add the **concrete entity** as child, not the Business Point
   - Given a Business Process/Activity:
     a. Find its Business Point
     b. Query `application_point_business_points` for linked Application Points
     c. For each Application Point, resolve to concrete entity (Application/Component/Service)
     d. Add as child (for reverse direction scenarios)

3. **For Interface ↔ Logical Entity**:
   - Given an Interface:
     a. Query `interface_logical_entities` for linked Logical Data Entities
     b. Add as direct children (Logical Entities inside Interface)
   - Mark as `actsAsContainment = true` in relationship definition

4. **Skip edge-only relationships**:
   - Do not traverse User ↔ Business Point, Logical ER, etc. in tree building

#### 3.4 Example Tree Structure

For Application "My App" with full data:

```
Application: My App [ROOT]
├── App Component: My Component (parent/child)
│   └── Service: My Service (parent/child)
│       └── Interface: My API (parent/child)
│           ├── Logical Data Entity: Customer (Interface ↔ Logical Entity)
│           └── Logical Data Entity: Order (Interface ↔ Logical Entity)
├── Service: Direct Service (parent/child)
│   └── Interface: Another API (parent/child)
├── Business Process: Order Capture (App Point ↔ Business Point)
│   └── Process Activity: Validate Order (parent/child)
└── Business Process: Payment Processing (App Point ↔ Business Point)
    ├── Process Activity: Charge Card (parent/child)
    └── Process Activity: Send Receipt (parent/child)
```

Key observations:
- No "Application Point" or "Business Point" nodes visible
- Business Processes appear as direct children of Application
- Process Activities appear as children of their Business Process
- Logical Entities appear as children of Interface

#### 3.5 Implementation Changes to `findRelatedEntities()`

```typescript
// New case for App Point ↔ Business Point (Application side)
case 'application_point_business_points': {
  if (rootEntityType === ENTITY_TYPES.APPLICATION ||
      rootEntityType === ENTITY_TYPES.APP_COMPONENT ||
      rootEntityType === ENTITY_TYPES.SERVICE) {
    // 1. Find the Application Point for this concrete entity
    const appPoint = metaModel.entities.application_points.find(ap => {
      if (rootEntityType === ENTITY_TYPES.APPLICATION) return ap.application_id === rootEntityId;
      if (rootEntityType === ENTITY_TYPES.APP_COMPONENT) return ap.application_component_id === rootEntityId;
      if (rootEntityType === ENTITY_TYPES.SERVICE) return ap.service_id === rootEntityId;
      return false;
    });

    if (!appPoint) return [];

    // 2. Find linked Business Points
    const bpIds = metaModel.relationships.application_point_business_points
      .filter(rel => rel.application_point_id === appPoint.id)
      .map(rel => rel.business_point_id);

    // 3. Resolve Business Points to concrete entities
    const results: Array<{ id: string; name: string }> = [];
    for (const bpId of bpIds) {
      const bp = metaModel.entities.business_points.find(b => b.id === bpId);
      if (!bp) continue;

      if (bp.kind === 'BUSINESS_PROCESS') {
        const process = metaModel.entities.business_processes.find(p => p.id === bp.business_process_id);
        if (process) results.push({ id: process.id, name: process.name });
      } else if (bp.kind === 'PROCESS_ACTIVITY') {
        const activity = metaModel.entities.process_activities.find(a => a.id === bp.process_activity_id);
        if (activity) results.push({ id: activity.id, name: activity.name });
      }
    }
    return results;
  }
  break;
}
```

#### 3.6 Update `EXPANDABLE_RELATIONSHIPS`

```typescript
// Application expands to Business Processes/Activities via App Point ↔ Business Point
[ENTITY_TYPES.APPLICATION]: [
  // ... existing relationships ...
  {
    targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'application_point_business_points',
    foreignKeyField: 'application_point_id',
    displayLabel: 'Business Processes',
    actsAsContainment: true,  // NEW
  },
  {
    targetEntityType: ENTITY_TYPES.PROCESS_ACTIVITY,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'application_point_business_points',
    foreignKeyField: 'application_point_id',
    displayLabel: 'Process Activities',
    actsAsContainment: true,  // NEW
  },
],

// Remove BUSINESS_POINT from targets - never show in tree
// Instead of: targetEntityType: ENTITY_TYPES.BUSINESS_POINT
// Use: targetEntityType: ENTITY_TYPES.BUSINESS_PROCESS (resolved)

// Interface expands to Logical Data Entities
[ENTITY_TYPES.INTERFACE]: [
  {
    targetEntityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'interface_logical_entities',
    foreignKeyField: 'interface_id',
    displayLabel: 'Logical Data Entities',
    actsAsContainment: true,  // NEW - treat as containment
  },
],
```

#### 3.7 Deduplication and Depth

- Maintain existing behaviour: same entity (type + id) = single tree node
- Maximum depth: 10 levels from root
- Business branch must remain distinct (not merged away)

---

### 4. Diagram Behaviour for Containment Relationships

#### 4.1 General Rule

For relationships with `actsAsContainment = true`:
- Render as **nested boxes**, not edge lines
- Child boxes inside parent boxes
- Parent has containment styling: `text_v_align='TOP'`, `text_font_weight='bold'`
- No edge drawn between parent and child

#### 4.2 Wrapping Algorithm

The existing `buildWrappedNodeHierarchy()` handles this. Key updates needed:

1. **Add INTERFACE to CONTAINER_ENTITY_TYPES**:
   ```typescript
   const CONTAINER_ENTITY_TYPES: Set<string> = new Set([
     ENTITY_TYPES.APPLICATION,
     ENTITY_TYPES.APP_COMPONENT,
     ENTITY_TYPES.SERVICE,
     ENTITY_TYPES.INTERFACE,  // Already added
     ENTITY_TYPES.BUSINESS_PROCESS,
     ENTITY_TYPES.LOGICAL_DATA_ENTITY,
     ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
   ]);
   ```

2. **Handle cross-branch containment**:
   - When Business Process is selected under Application, ensure correct parent_node_id is set
   - Business Process's diagram parent is the Application node, not a Point node

#### 4.3 App Point ↔ Business Point → Nested Business Inside Application

Diagram result when selecting Business Process under Application:

```
┌─────────────────────────────────┐
│ Application: My App             │
│ ┌─────────────────────────────┐ │
│ │ Business Process: Order     │ │
│ │ ┌─────────────────────────┐ │ │
│ │ │ Process Activity: Step1 │ │ │
│ │ └─────────────────────────┘ │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

- No Application Point node
- No Business Point node
- No edge line between Application and Business Process
- Containment expressed through nesting

#### 4.4 Interface ↔ Logical Entity → Nested Logical Entities Inside Interface

```
┌─────────────────────────────────┐
│ Service: My Service             │
│ ┌─────────────────────────────┐ │
│ │ Interface: My API           │ │
│ │ ┌───────────────┐           │ │
│ │ │ Logical Data  │           │ │
│ │ │ Entity: Order │           │ │
│ │ └───────────────┘           │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

- No edge between Interface and Logical Entity
- Containment via nesting

---

### 5. Relationship Eligibility (High Level)

The existing `getEntitiesOnDiagram()` correctly maps:
- Application/Component/Service nodes → corresponding Application Point IDs
- Business Process/Activity nodes → corresponding Business Point IDs

This enables relationship rows in the RHS palette when concrete entities are present.

No changes needed to eligibility logic - it already treats concrete entities as "representing" their Points.

---

### 6. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/advancedAddRelationships.ts` | Add `actsAsContainment` field; update EXPANDABLE_RELATIONSHIPS; change BUSINESS_POINT targets to concrete types |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Update `findRelatedEntities()` to resolve Points to concrete entities |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Ensure `buildWrappedNodeHierarchy()` handles cross-branch containment |
| `frontend/src/types/advancedAdd.ts` | Add `actsAsContainment` to interface if needed |

---

### 7. Testing and Acceptance Criteria

#### 7.1 Advanced Add Tree Tests

1. **Application root shows Business Processes directly**:
   - Open Advanced Add on Application
   - Tree must show "Business Process: X" as children
   - Tree must NOT show "Business Point" nodes

2. **Application root shows full hierarchy**:
   - Application → App Components → Services → Interfaces → Logical Entities
   - Application → Business Processes → Process Activities
   - No Point nodes anywhere

3. **Interface root shows Logical Entities**:
   - Open Advanced Add on Interface
   - Tree shows "Logical Data Entity: X" as children
   - Relationship marked as containment

#### 7.2 Diagram Rendering Tests

1. **Selecting Business Processes produces nested boxes**:
   - Select Business Processes in Advanced Add tree
   - Diagram shows Application containing Business Processes
   - No App Point ↔ Business Point edges drawn

2. **Selecting Logical Entities produces nested boxes**:
   - Select Logical Entities under Interface
   - Diagram shows Interface containing Logical Entities
   - No Interface ↔ Logical Entity edges drawn

3. **Existing "Add with business processes" unchanged**:
   - Behaviour remains consistent with new containment rules
   - No regression

#### 7.3 No Point Nodes Ever

1. Application Point never appears as tree node
2. Business Point never appears as tree node
3. Application Point never appears as diagram node (unless directly added, which is hidden from UI)
4. Business Point never appears as diagram node (unless directly added, which is hidden from UI)

---

### 8. Migration / Backward Compatibility

- Existing diagrams with BUSINESS_POINT nodes may need migration (out of scope for this spec)
- Edge-only relationships (User ↔ Business Point, etc.) continue to draw edges
- No schema changes to meta-model

---

### 9. Summary

This specification establishes:

1. **Super-class transparency**: Application Point and Business Point are never visible in Advanced Add trees or diagram nodes
2. **Containment classification**: `actsAsContainment` flag distinguishes containment relationships from edge-only relationships
3. **Two new containment relationships**:
   - App Point ↔ Business Point → Business inside Application
   - Interface ↔ Logical Entity → Logical Entity inside Interface
4. **No edge lines for containment**: Relationships marked as containment render as nested boxes, not edges
5. **Concrete entity focus**: All UI shows only concrete entities; Points are internal implementation details
