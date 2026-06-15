# Advanced Add – Hierarchical Layout Using Recursive Tree-Based Containment

## Overview

This specification defines a recursive, two-pass layout algorithm for Advanced Add that ensures the diagram visually matches the selected tree hierarchy. Parents wrap children as nested boxes, siblings are stacked vertically with gaps, and no nodes overlap.

## Problem Statement

The current implementation has a critical flaw: **all selected nodes are placed on top of each other** at the viewport center. While the containment relationships (`parent_node_id`) are correctly set, and parent sizes are calculated to theoretically fit children, the positioning logic fails to properly stack siblings and cascade positions through the hierarchy.

### Current Issues

1. **Siblings overlap**: When multiple children are added to the same parent, they all receive the same Y position
2. **Position cascade failure**: Child positions are calculated before parent positions are finalized
3. **Recursive sizing absent**: Parent sizes don't properly account for nested grandchildren
4. **No bottom-up measurement**: The current approach calculates sizes top-down rather than measuring leaves first

---

## Specification

### 1. The Advanced Add Tree is the Layout Blueprint

When the user confirms "Add to Diagram", the diagram MUST reproduce the selected Advanced Add hierarchy as nested geometry.

**Example selection tree:**
```
Application: My App
├── App Component: My Comp
│   └── Service: My Service
│       └── Interface: My API
│           ├── Logical Entity: Scenario
│           ├── Logical Entity: ScenarioEdits
│           ├── Logical Entity: ScenarioImpact
│           └── Logical Entity: ScenarioSignOff
└── Business Process: My Business Process
    └── Process Activity: My Process Activity
```

**Expected diagram result:**
- "My App" as the outermost container
- "My Comp" nested inside "My App"
- "My Service" nested inside "My Comp"
- "My API" nested inside "My Service"
- Logical Entities stacked vertically inside "My API"
- "My Business Process" nested inside "My App" (below "My Comp")
- "My Process Activity" nested inside "My Business Process"
- **NO nodes overlap**; all are placed with proper spacing

---

### 2. Input Structure from Advanced Add

The layout algorithm receives a tree structure representing the user's selection:

```typescript
interface LayoutTreeNode {
  id: string;           // Unique entity ID (e.g., "app-123")
  type: string;         // Entity type (APPLICATION, SERVICE, etc.)
  label: string;        // Display text for the box
  children: LayoutTreeNode[];
}
```

**Key rules:**
- Only concrete entities appear (no Application Points or Business Points)
- The tree already encodes direct + indirect containment
- Shared ancestors appear once (deduplication handled upstream)

---

### 3. Containment Rendering Rules

Applied for every node in the Advanced Add selection tree:

| Rule | Description |
|------|-------------|
| Parent wraps children | Parent boxes contain children visually (no edge lines) |
| Children inside with padding | Children appear inside parent with uniform padding |
| Siblings stacked vertically | Multiple children are stacked top-to-bottom with gaps |
| Parent expands to fit | Parent size automatically grows to fit label + all children |
| Type-specific styling | Container nodes get `text_v_align: 'TOP'`, `text_font_weight: 'bold'` |

---

### 4. Layout Constants

Define constants to control spacing and minimum dimensions:

```typescript
// Layout spacing constants
const PADDING_X = 20;           // Horizontal padding inside containers
const PADDING_Y = 20;           // Vertical padding inside containers
const CHILD_VERTICAL_GAP = 10;  // Vertical gap between siblings
const LABEL_PADDING = 10;       // Space below parent label

// Minimum dimensions
const MIN_NODE_WIDTH = 120;     // Minimum width for any node
const MIN_NODE_HEIGHT = 40;     // Minimum height for leaf nodes

// Text measurement
const DEFAULT_FONT_SIZE = 12;
const CONTAINER_FONT_WEIGHT = 'bold';
```

**Note**: These differ from the current constants (`PADDING = 5`) to provide better visual separation. The current tight spacing causes visual crowding.

---

### 5. Two-Pass Recursive Layout Algorithm

The layout is computed in two passes:
1. **Pass 1 (Measure)**: Bottom-up calculation of required dimensions
2. **Pass 2 (Position)**: Top-down assignment of coordinates

#### 5.1 Pass 1: `measure(node)` - Bottom-Up Sizing

Computes the required width and height for each node, starting from leaves and working up to the root.

```typescript
interface MeasuredNode {
  id: string;
  type: string;
  label: string;
  children: MeasuredNode[];
  measuredWidth: number;
  measuredHeight: number;
}

function measure(node: LayoutTreeNode): MeasuredNode {
  // Calculate label dimensions
  const labelWidth = estimateLabelWidth(node.label, DEFAULT_FONT_SIZE);
  const labelHeight = estimateLabelHeight(node.label, MIN_NODE_WIDTH - 2 * PADDING_X, DEFAULT_FONT_SIZE);

  // Recursively measure children first (bottom-up)
  const measuredChildren: MeasuredNode[] = [];
  for (const child of node.children) {
    measuredChildren.push(measure(child));
  }

  // Leaf node: size based on label only
  if (measuredChildren.length === 0) {
    return {
      ...node,
      children: [],
      measuredWidth: Math.max(MIN_NODE_WIDTH, labelWidth + 2 * PADDING_X),
      measuredHeight: Math.max(MIN_NODE_HEIGHT, labelHeight + 2 * PADDING_Y),
    };
  }

  // Container node: size based on label + children
  const childWidths = measuredChildren.map(c => c.measuredWidth);
  const childHeights = measuredChildren.map(c => c.measuredHeight);

  const maxChildWidth = Math.max(...childWidths);
  const totalChildrenHeight = sum(childHeights) + CHILD_VERTICAL_GAP * (measuredChildren.length - 1);

  // Content area is the larger of label or children
  const contentWidth = Math.max(labelWidth, maxChildWidth);
  const contentHeight = labelHeight + LABEL_PADDING + totalChildrenHeight;

  return {
    ...node,
    children: measuredChildren,
    measuredWidth: Math.max(MIN_NODE_WIDTH, contentWidth + 2 * PADDING_X),
    measuredHeight: Math.max(MIN_NODE_HEIGHT, contentHeight + 2 * PADDING_Y),
  };
}
```

**Key behaviors:**
- Leaves are measured based on their label text
- Parents include all children heights plus gaps
- Width is determined by the widest content (label or child)
- All measurements include padding

#### 5.2 Pass 2: `assignPositions(node, originX, originY)` - Top-Down Positioning

Assigns absolute (x, y) coordinates to each node, starting from the root and working down to leaves.

```typescript
interface LayoutNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
}

function assignPositions(
  node: MeasuredNode,
  originX: number,
  originY: number
): LayoutNode {
  const width = node.measuredWidth;
  const height = node.measuredHeight;

  const layoutNode: LayoutNode = {
    id: node.id,
    type: node.type,
    label: node.label,
    x: originX,
    y: originY,
    width,
    height,
    children: [],
  };

  // Leaf node: no children to position
  if (node.children.length === 0) {
    return layoutNode;
  }

  // Calculate label height for this container
  const labelHeight = estimateLabelHeight(node.label, width - 2 * PADDING_X, DEFAULT_FONT_SIZE);

  // Calculate inner content area
  const innerWidth = width - 2 * PADDING_X;

  // Start Y for first child: below label with padding
  let currentY = originY + PADDING_Y + labelHeight + LABEL_PADDING;

  // Position each child
  for (const child of node.children) {
    const childWidth = child.measuredWidth;
    const childHeight = child.measuredHeight;

    // Center child horizontally within inner area
    const childX = originX + PADDING_X + (innerWidth - childWidth) / 2;

    // Recursively position this child and its descendants
    const childLayout = assignPositions(child, childX, currentY);
    layoutNode.children.push(childLayout);

    // Move Y down for next sibling
    currentY += childHeight + CHILD_VERTICAL_GAP;
  }

  return layoutNode;
}
```

**Key behaviors:**
- Root is positioned at the specified origin (viewport center)
- Children are positioned relative to their parent
- Siblings are stacked vertically with gaps
- Children are horizontally centered within the parent's content area

---

### 6. End-to-End Layout Execution

The complete layout process:

```typescript
function layoutAdvancedAddSelection(
  rootTreeNode: LayoutTreeNode,
  viewportCenter: { x: number; y: number }
): LayoutNode {
  // Pass 1: Measure all nodes bottom-up
  const measuredRoot = measure(rootTreeNode);

  // Calculate root origin (centered at viewport)
  const rootX = viewportCenter.x - measuredRoot.measuredWidth / 2;
  const rootY = viewportCenter.y - measuredRoot.measuredHeight / 2;

  // Pass 2: Assign positions top-down
  const layoutRoot = assignPositions(measuredRoot, rootX, rootY);

  return layoutRoot;
}

function convertTodiagramNodes(layoutNode: LayoutNode, zIndexBase: number): DiagramNode[] {
  const nodes: DiagramNode[] = [];
  let currentZIndex = zIndexBase;

  function traverse(node: LayoutNode, parentNodeId: string | null) {
    currentZIndex++;

    const diagramNode: DiagramNode = {
      id: generatePrefixedId('node'),
      entity_type: node.type,
      entity_id: node.id,
      pos_x: node.x,
      pos_y: node.y,
      width: node.width,
      height: node.height,
      auto_size: false,
      z_index: currentZIndex,
      parent_node_id: parentNodeId,
      style_override: {},
      ...(node.children.length > 0 ? {
        text_v_align: 'TOP' as const,
        text_font_weight: 'bold' as const,
      } : {}),
    };

    nodes.push(diagramNode);

    // Recursively process children
    for (const child of node.children) {
      traverse(child, diagramNode.id);
    }
  }

  traverse(layoutNode, null);
  return nodes;
}
```

---

### 7. Handling Multiple Root Branches

When the selection tree has multiple branches from the root (e.g., Application with both App Components and Business Processes), they must be stacked correctly:

```
Application: My App [ROOT]
├── App Component: My Comp        ← First branch
│   └── Service: My Service
└── Business Process: Order       ← Second branch
    └── Process Activity: Step 1
```

Both "My Comp" and "Order" are children of "My App" and should be stacked vertically inside the Application container, not overlapping.

The algorithm handles this naturally because:
1. `measure()` calculates the Application height as: label + LABEL_PADDING + height(My Comp subtree) + GAP + height(Order subtree)
2. `assignPositions()` places "My Comp" first, then places "Order" below it with the gap

---

### 8. Node Reuse / Idempotency Rules

| Scenario | Behavior |
|----------|----------|
| Node with same entity ID exists | Reuse existing node; update its geometry if needed |
| Re-running Advanced Add | Deterministic results; no duplicate nodes created |
| Unselected siblings | Remain unchanged on diagram |
| Position conflicts | Layout algorithm guarantees no overlaps for newly added nodes |

**Reuse logic:**
```typescript
function getOrCreateNode(
  entityType: string,
  entityId: string,
  existingNodes: DiagramNode[]
): { node: DiagramNode; isNew: boolean } {
  const existing = existingNodes.find(
    n => n.entity_type === entityType && n.entity_id === entityId
  );

  if (existing) {
    return { node: existing, isNew: false };
  }

  // Create new node (position will be calculated by layout algorithm)
  return { node: createNewNode(entityType, entityId), isNew: true };
}
```

---

### 9. Text Measurement Helpers

Accurate text measurement is critical for proper sizing:

```typescript
/**
 * Estimate the width of text when rendered
 */
function estimateLabelWidth(
  text: string,
  fontSize: number = DEFAULT_FONT_SIZE,
  fontWeight: string = 'normal'
): number {
  // Use canvas API or existing measureTextWidth() utility
  return measureTextWidth(text, fontSize, fontWeight);
}

/**
 * Estimate the height of text when wrapped to fit a given width
 */
function estimateLabelHeight(
  text: string,
  maxWidth: number,
  fontSize: number = DEFAULT_FONT_SIZE,
  fontWeight: string = 'normal'
): number {
  const lines = wrapText(text, maxWidth, fontSize, fontWeight, 'normal');
  return calculateTextBlockHeight(lines.length, fontSize);
}
```

---

### 10. Integration with Existing Code

The new layout algorithm should be implemented in `compoundLayout.ts` and called from `buildWrappedNodeHierarchy()` in `PalettePanel.tsx`.

**Key integration points:**

1. **Replace current positioning logic** in `buildWrappedNodeHierarchy()`:
   - Instead of calculating positions in two passes within the function
   - Call `layoutAdvancedAddSelection()` with the tree structure
   - Convert the result to `DiagramNode[]`

2. **Use existing utilities**:
   - `wrapText()` from `rendering.ts`
   - `calculateTextBlockHeight()` from `rendering.ts`
   - `generatePrefixedId()` from `idGenerator.ts`
   - `calculateZIndex()` from `nodeCreation.ts`

3. **Preserve existing behavior**:
   - Containment styling (`text_v_align`, `text_font_weight`)
   - Z-index ordering (parents lower than children)
   - Node reuse for existing entities

---

### 11. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/compoundLayout.ts` | Add `measure()`, `assignPositions()`, `layoutAdvancedAddSelection()` |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Update `buildWrappedNodeHierarchy()` to use new layout algorithm |
| `frontend/src/types/advancedAdd.ts` | Add `MeasuredNode`, `LayoutNode` interfaces if needed |

---

### 12. Acceptance Criteria

After implementing this spec:

1. **Hierarchy matches selection**: "Add to Diagram" produces a diagram that matches the Advanced Add tree exactly

2. **Nested containment**: All containment chains render as nested boxes with correct padding and spacing

3. **No overlap**: No nodes overlap; all siblings are stacked properly with gaps

4. **Multi-branch layout**: Application → Business Process and Application → Component both render properly in the same hierarchy when selected together

5. **Idempotency**: Re-running Advanced Add reuses existing diagram nodes and updates geometry without duplication

6. **Visual quality**: Parent containers are large enough to contain all children with readable spacing

---

### 13. Visual Example

**Before (current behavior):**
```
┌────────────────────────┐
│ Application            │
│ ┌──────────────────┐   │
│ │ App Component    │   │  ← All children overlap at same position
│ │ Business Process │   │
│ └──────────────────┘   │
└────────────────────────┘
```

**After (with this spec):**
```
┌──────────────────────────────────────┐
│ Application: My App                  │
│ ┌──────────────────────────────────┐ │
│ │ App Component: My Comp           │ │
│ │ ┌──────────────────────────────┐ │ │
│ │ │ Service: My Service          │ │ │
│ │ │ ┌──────────────────────────┐ │ │ │
│ │ │ │ Interface: My API        │ │ │ │
│ │ │ │ ┌────────────────────┐   │ │ │ │
│ │ │ │ │ Entity: Scenario   │   │ │ │ │
│ │ │ │ └────────────────────┘   │ │ │ │
│ │ │ │ ┌────────────────────┐   │ │ │ │
│ │ │ │ │ Entity: Edits      │   │ │ │ │
│ │ │ │ └────────────────────┘   │ │ │ │
│ │ │ └──────────────────────────┘ │ │ │
│ │ └──────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ Business Process: Order          │ │
│ │ ┌────────────────────────────┐   │ │
│ │ │ Activity: Validate         │   │ │
│ │ └────────────────────────────┘   │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

---

### 14. Summary

This specification defines:

1. **Two-pass recursive algorithm**: Measure bottom-up, position top-down
2. **Proper sibling stacking**: Children of the same parent are stacked vertically with gaps
3. **Accurate sizing**: Parents expand to fit all children, including deeply nested structures
4. **No overlap guarantee**: The algorithm mathematically prevents overlapping nodes
5. **Clean integration**: Uses existing text measurement utilities and node creation patterns

The result is a diagram layout that accurately reflects the Advanced Add selection hierarchy with proper visual nesting and spacing.
