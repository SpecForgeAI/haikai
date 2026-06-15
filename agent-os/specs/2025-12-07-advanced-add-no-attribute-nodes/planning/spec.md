# Advanced Add – Do Not Create Attribute Nodes; Use Attributes Only for ERD Rendering

## Overview

This specification fixes a bug where the Advanced Add dialog creates diagram nodes for `LOGICAL_DATA_ATTRIBUTE` and `PHYSICAL_DATA_ATTRIBUTE` entity types, leading to validation errors. These attribute types should **never** be created as diagram nodes—they should only be used for ERD-style rendering inside their parent entity nodes.

---

## Current State Analysis

### The Problem

**File:** `frontend/src/utils/compoundLayout.ts` (lines 339-388)

The `convertTodiagramNodes()` function creates DiagramNode objects for ALL nodes in the layout tree, including attribute types:

```typescript
export function convertTodiagramNodes(
  layoutNode: LayoutNode,
  zIndexBase: number
): DiagramNode[] {
  // ...
  function traverse(node: LayoutNode, parentDiagramNodeId: string | null): void {
    // Creates a DiagramNode for EVERY node type, including attributes
    const diagramNode: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: node.type,  // <-- This includes LOGICAL_DATA_ATTRIBUTE, PHYSICAL_DATA_ATTRIBUTE
      // ...
    };
    nodes.push(diagramNode);
    // ...
  }
}
```

When attributes are selected in Advanced Add, they're included in the tree structure and converted to diagram nodes, causing:
- Validation error: "Node ... has unknown entity type LOGICAL_DATA_ATTRIBUTE"
- Invalid diagram JSON with attribute nodes

### What Already Works

**File:** `frontend/src/utils/erdAdvancedAddUtils.ts`

The `findERDCandidates()` function correctly identifies data entities with selected attributes:

```typescript
export function findERDCandidates(
  orderedNodes: TreeNodeData[],
  selectedKeys: Set<string>,
  _metaModel: MetaModel
): ERDCandidate[] {
  // Returns entities with their selected attributes for ERD rendering
}
```

**File:** `frontend/src/utils/erdUtils.ts`

ERD rendering utilities exist for rendering attributes inside entity boxes:
- `getAttributesForEntity()` - Gets attributes for a given entity
- `calculateERDNodeSize()` - Calculates node size based on attributes

### Attribute Types That Must Never Be Diagram Nodes

These entity types should **never** appear in `diagram_nodes`:
- `LOGICAL_DATA_ATTRIBUTE` (ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)
- `PHYSICAL_DATA_ATTRIBUTE` (ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE)

---

## Specification

### 1. Filter Attribute Nodes in Advanced Add Processing

#### 1.1 Update convertTodiagramNodes to Skip Attribute Types

**File to modify:** `frontend/src/utils/compoundLayout.ts`

Add a check in `convertTodiagramNodes()` to skip attribute entity types:

```typescript
import { ENTITY_TYPES } from '../types/model';

// Add helper function to check if entity type is an attribute
function isAttributeEntityType(entityType: string): boolean {
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE
  );
}

export function convertTodiagramNodes(
  layoutNode: LayoutNode,
  zIndexBase: number
): DiagramNode[] {
  const nodes: DiagramNode[] = [];
  let currentZIndex = zIndexBase;

  function traverse(node: LayoutNode, parentDiagramNodeId: string | null): void {
    // Skip attribute entity types - they should not become diagram nodes
    if (isAttributeEntityType(node.type)) {
      // Still process children in case of nested structure
      for (const child of node.children) {
        traverse(child, parentDiagramNodeId);
      }
      return;
    }

    currentZIndex++;
    // ... rest of existing code
  }

  traverse(layoutNode, null);
  return nodes;
}
```

#### 1.2 Update buildWrappedNodeHierarchy to Filter Attributes

**File to modify:** `frontend/src/components/DiagramsView/PalettePanel.tsx`

Update `buildWrappedNodeHierarchy()` to recognize ERD candidates and filter out attribute nodes:

```typescript
// Add import for ERD utilities
import { findERDCandidates, isEmbeddedAttribute } from '../../utils/erdAdvancedAddUtils';

export function buildWrappedNodeHierarchy(
  orderedNodes: TreeNodeData[],
  treeData: TreeNodeData,
  metaModel: MetaModel,
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges?: DiagramEdge[] },
  viewportCenter: { x: number; y: number },
  spacingPreset: SpacingPreset = DEFAULT_SPACING_PRESET
): WrappedNodeResult {
  // ... existing code ...

  // Build selected keys set
  const selectedKeys = new Set<string>(orderedNodes.map(n => n.key));

  // Find ERD candidates - entities with selected attributes
  const erdCandidates = findERDCandidates(orderedNodes, selectedKeys, metaModel);

  // Filter orderedNodes to exclude attribute nodes that are embedded in ERD candidates
  const filteredNodes = orderedNodes.filter(node =>
    !isEmbeddedAttribute(node, erdCandidates)
  );

  // Continue with filteredNodes instead of orderedNodes...
}
```

---

### 2. Store Selected Attributes as Metadata on Entity Nodes

#### 2.1 Add selected_attribute_ids Field to DiagramNode

**File to modify:** `frontend/src/types/model.ts`

Add optional field to DiagramNode interface:

```typescript
export interface DiagramNode {
  // ... existing fields ...

  /**
   * Optional list of attribute IDs for ERD-style rendering.
   * When present, these attributes are rendered as rows inside the entity box.
   * Only applicable to LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY nodes.
   */
  selected_attribute_ids?: string[];
}
```

#### 2.2 Pass Attribute Selection to Node Creation

**File to modify:** `frontend/src/utils/compoundLayout.ts`

Update `convertTodiagramNodes()` to accept and use ERD candidate information:

```typescript
export function convertTodiagramNodes(
  layoutNode: LayoutNode,
  zIndexBase: number,
  erdCandidateMap?: Map<string, string[]>  // entityId -> selectedAttributeIds
): DiagramNode[] {
  // ...
  function traverse(node: LayoutNode, parentDiagramNodeId: string | null): void {
    // Skip attribute entity types
    if (isAttributeEntityType(node.type)) {
      for (const child of node.children) {
        traverse(child, parentDiagramNodeId);
      }
      return;
    }

    const diagramNode: DiagramNode = {
      // ... existing fields ...
    };

    // If this entity has selected attributes (ERD candidate), add them
    const selectedAttributes = erdCandidateMap?.get(node.id);
    if (selectedAttributes && selectedAttributes.length > 0) {
      diagramNode.selected_attribute_ids = selectedAttributes;
    }

    nodes.push(diagramNode);
    // ...
  }
}
```

---

### 3. Update Layout Tree Filtering

#### 3.1 Filter Attributes from Layout Tree

**File to modify:** `frontend/src/components/DiagramsView/PalettePanel.tsx`

Update `convertTreeNodeToLayoutTreeWithExistingHandling()` to exclude attributes:

```typescript
function convertTreeNodeToLayoutTreeWithExistingHandling(
  treeNode: TreeNodeData,
  metaModel: MetaModel,
  selectedKeys: Set<string>,
  existingEntityMap: Map<string, DiagramNode>
): LayoutTreeNode | null {
  // Only include nodes that are selected
  if (!selectedKeys.has(treeNode.key)) {
    return null;
  }

  // Skip attribute entity types - they are not diagram nodes
  if (isAttributeEntityType(treeNode.entityType)) {
    return null;
  }

  // ... rest of existing code ...
}

// Helper function (same as in compoundLayout.ts)
function isAttributeEntityType(entityType: string): boolean {
  return (
    entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE ||
    entityType === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE
  );
}
```

---

### 4. Ensure ERD Rendering Uses Stored Attributes

#### 4.1 Update Canvas Rendering

**File to check:** `frontend/src/components/DiagramsView/Canvas.tsx`

The ERD rendering logic in `renderNode()` should use `node.selected_attribute_ids` when rendering data entities:

```typescript
function renderNode(node: DiagramNode): JSX.Element {
  // For Logical/Physical Data Entities, render in ERD style
  if (node.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
      node.entity_type === ENTITY_TYPES.PHYSICAL_DATA_ENTITY) {
    // Use selected_attribute_ids if present, otherwise fall back to all attributes
    const attributeIds = node.selected_attribute_ids;
    const attributes = attributeIds
      ? getAttributesForEntityByIds(metaModel, node.entity_type, node.entity_id, attributeIds)
      : getAttributesForEntity(metaModel, node.entity_type, node.entity_id);

    return renderERDNode(node, attributes);
  }
  // ... rest of rendering ...
}
```

---

### 5. Add Validation to Prevent Attribute Nodes

#### 5.1 Add Validation Check

**File to modify:** `frontend/src/utils/validation.ts`

Add validation to reject attribute nodes in diagrams:

```typescript
function validateDiagramNodes(nodes: DiagramNode[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const node of nodes) {
    // Attribute types should never be diagram nodes
    if (node.entity_type === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE ||
        node.entity_type === ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE) {
      errors.push({
        entityType: node.entity_type,
        entityId: node.entity_id,
        field: 'entity_type',
        message: `${node.entity_type} should not be a diagram node. Attributes are rendered inside entity boxes.`,
        type: 'invalid_entity_type',
      });
    }
  }

  return errors;
}
```

---

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/utils/compoundLayout.ts` | Add `isAttributeEntityType()` helper, skip attributes in `convertTodiagramNodes()` |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Filter attributes from orderedNodes, update tree conversion |
| `frontend/src/types/model.ts` | Add optional `selected_attribute_ids` field to DiagramNode |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Use `selected_attribute_ids` for ERD rendering (verify existing logic) |
| `frontend/src/utils/validation.ts` | Add validation to reject attribute diagram nodes |

---

## Acceptance Criteria

1. **No attribute diagram nodes created**
   - Using Advanced Add with a Logical/Physical Entity and its attributes selected creates only entity nodes
   - No nodes with `entity_type: 'LOGICAL_DATA_ATTRIBUTE'` or `'PHYSICAL_DATA_ATTRIBUTE'` in `diagram_nodes`

2. **ERD rendering works correctly**
   - Selected attributes appear as rows inside the entity box
   - Unselected attributes do not appear in the ERD view
   - Entity without selected attributes shows only the header

3. **Validation error resolved**
   - "Node ... has unknown entity type LOGICAL_DATA_ATTRIBUTE" error no longer occurs
   - Diagrams created via Advanced Add pass validation

4. **"Add with attributes" continues to work**
   - The existing "Add with attributes" context menu action still works correctly
   - Creates a single entity node with all attributes rendered inside

5. **Diagram save/load works**
   - Saved diagrams contain entity nodes with `selected_attribute_ids` (when applicable)
   - Loading these diagrams renders attributes correctly

---

## Implementation Notes

1. **Shared helper function**: The `isAttributeEntityType()` function should be shared between files. Consider adding it to a common utility file or importing from `erdAdvancedAddUtils.ts`.

2. **Backward compatibility**: Existing diagrams without `selected_attribute_ids` should fall back to showing all attributes (current behavior).

3. **ERD candidate detection**: The existing `findERDCandidates()` function already correctly identifies entities with selected attributes. Leverage this for filtering.

4. **Test coverage**: Add tests verifying:
   - Attribute nodes are filtered from convertTodiagramNodes output
   - ERD candidates have their attributes recorded as metadata
   - Validation rejects attribute diagram nodes

---

## Risk Assessment

**Low Risk:**
- Adding `selected_attribute_ids` field to DiagramNode (optional field, backward compatible)
- Adding validation to reject attribute nodes (additive)

**Medium Risk:**
- Modifying `convertTodiagramNodes()` to skip attributes (need to ensure children are still processed)
- Modifying tree conversion logic (need to ensure layout calculations are still correct)

**Testing Strategy:**
1. Write tests for attribute filtering before making changes
2. Verify existing "Add with attributes" still works after changes
3. Test Advanced Add with various entity/attribute selection combinations
4. Verify diagram save/load preserves attribute selection
