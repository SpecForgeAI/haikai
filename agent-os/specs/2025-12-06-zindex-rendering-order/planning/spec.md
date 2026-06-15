# z_index as the Single Source of Truth for Rendering Order

## Overview

This specification fixes the disconnect between z_index values (which are correctly updated via context menu actions) and the actual visual rendering order (which still uses category-based layering). After this change, z_index becomes the **sole determinant** of rendering order for all diagram elements.

---

## Current State Analysis

### The Problem

**File:** `frontend/src/components/DiagramsView/Canvas.tsx` (lines 556-570, 2318-2638)

The current rendering uses **fixed category layers**:

```
SVG Rendering Order (current - WRONG):
1. lowZIndexDecorations (z < 100)     ← Filtered by threshold
2. nodes                               ← All nodes, in array order
3. edges                               ← All edges, in array order
4. highZIndexDecorations (z >= 120)   ← Filtered by threshold
5. Selection indicators
6. Handles
```

This means:
- A node with z_index=200 is **still rendered below** a line decoration with z_index=120
- Nodes are rendered in array order, not z_index order
- The z_index thresholds (50, 100, 110, 120) create artificial layer boundaries

### What Works

**File:** `frontend/src/utils/zIndexUtils.ts` (lines 99-116)

The context menu actions correctly update z_index values:
- `calculateNewZIndex()` computes new values correctly
- `handleZIndexChange()` dispatches UPDATE actions
- JSON is persisted with correct z_index values

**File:** `frontend/src/utils/zIndexUtils.ts` (lines 132-180)

The `getSortedRenderOrder()` function already exists but is **NOT USED** in Canvas.tsx:

```typescript
export function getSortedRenderOrder(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): RenderableElement[]
```

This function:
- Collects all elements into a single array
- Wraps each in a `RenderableElement` with z_index and type
- Sorts by z_index ascending (with id as tie-breaker)
- Returns elements ready for unified rendering

### Z_INDEX_DEFAULTS

**File:** `frontend/src/config/defaults.ts` (lines 106-114)

```typescript
export const Z_INDEX_DEFAULTS = {
  BOX_DECORATION: 50,
  DIAGRAM_NODE: 100,
  DIAGRAM_EDGE: 110,
  LINE_DECORATION: 120,
} as const;
```

These defaults are still useful for **initial assignment** but should NOT create hard rendering layers.

---

## Specification

### 1. Unified Rendering Pipeline

#### 1.1 Replace Category-Based Rendering

**File to modify:** `frontend/src/components/DiagramsView/Canvas.tsx`

**Current approach (lines 2318-2638):**
```typescript
// WRONG: Fixed layer order
{lowZIndexDecorations.map(renderDecoration)}
{nodes.map(renderNode)}
{edges.map(renderEdge)}
{highZIndexDecorations.map(renderDecoration)}
```

**New approach:**
```typescript
// CORRECT: Single sorted list by z_index
const sortedElements = getSortedRenderOrder(nodes, edges, decorations);
{sortedElements.map(renderElement)}
```

#### 1.2 Use getSortedRenderOrder from zIndexUtils

**File:** `frontend/src/utils/zIndexUtils.ts` (lines 132-180)

The function already exists and returns:
```typescript
interface RenderableElement {
  type: 'node' | 'edge' | 'decoration';
  element: DiagramNode | DiagramEdge | Decoration;
  zIndex: number;
}
```

Sorted by:
1. Primary: `zIndex` ascending (lowest renders first, highest on top)
2. Secondary: `element.id` for deterministic tie-breaking

#### 1.3 Create Unified renderElement Function

**File to modify:** `frontend/src/components/DiagramsView/Canvas.tsx`

Add a dispatcher function that renders based on element type:

```typescript
const renderElement = useCallback((item: RenderableElement, index: number) => {
  switch (item.type) {
    case 'node':
      return renderNode(item.element as DiagramNode, index);
    case 'edge':
      return renderEdge(item.element as DiagramEdge, index);
    case 'decoration':
      return renderDecoration(item.element as Decoration, index);
    default:
      return null;
  }
}, [renderNode, renderEdge, renderDecoration]);
```

---

### 2. Remove Category-Based Filtering

#### 2.1 Remove lowZIndexDecorations / highZIndexDecorations

**File to modify:** `frontend/src/components/DiagramsView/Canvas.tsx` (lines 556-570)

**Remove:**
```typescript
// DELETE these lines - no longer needed
const lowZIndexDecorations = sortedDecorations.filter(
  d => getDecorationZIndex(d) < Z_INDEX_DEFAULTS.DIAGRAM_NODE
);
const highZIndexDecorations = sortedDecorations.filter(
  d => getDecorationZIndex(d) >= Z_INDEX_DEFAULTS.LINE_DECORATION
);
```

All decorations are now rendered through the unified pipeline.

#### 2.2 Update SVG Rendering Section

**File to modify:** `frontend/src/components/DiagramsView/Canvas.tsx` (lines 2318-2638)

Replace the four separate rendering loops with:

```typescript
{/* Main diagram elements - rendered in z_index order */}
{sortedElements.map((item, index) => renderElement(item, index))}

{/* Selection indicators - always on top of content */}
{selectedNodeIds.size > 0 && renderSelectionIndicators()}

{/* Resize/point handles - always topmost */}
{renderHandles()}
```

---

### 3. Ensure Immediate Re-render on Z-Index Change

#### 3.1 Verify React Reactivity

**File:** `frontend/src/components/DiagramsView/DiagramsView.tsx` (lines 711-774)

The `handleZIndexChange` function dispatches UPDATE actions which modify state. This should trigger re-render automatically via React's state management.

Verify that:
1. `nodes`, `edges`, `decorations` are derived from state
2. `getSortedRenderOrder()` is called on every render (not memoized with stale deps)
3. The sorted list updates when any element's z_index changes

#### 3.2 Memoization Considerations

If using `useMemo` for sorted elements, ensure dependencies include the full element arrays:

```typescript
const sortedElements = useMemo(
  () => getSortedRenderOrder(nodes, edges, decorations),
  [nodes, edges, decorations]  // Re-compute when any array changes
);
```

---

### 4. Legacy Diagram Handling

#### 4.1 Assign Default Z-Index on Load

**File to modify:** `frontend/src/contexts/ArchitectureContext.tsx` (LOAD_MODEL action)

When loading a diagram, ensure all elements have z_index values:

```typescript
case 'LOAD_MODEL': {
  const diagrams = action.payload.diagrams.map(diagram => {
    // Ensure all nodes have z_index
    const nodesWithZIndex = diagram.diagram_nodes.map((node, index) => ({
      ...node,
      z_index: node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE + index,
    }));

    // Ensure all edges have z_index
    const edgesWithZIndex = diagram.diagram_edges.map((edge, index) => ({
      ...edge,
      z_index: edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE + index,
    }));

    // Ensure all decorations have z_index
    const decorationsWithZIndex = (diagram.decorations || []).map((dec, index) => {
      const defaultZ = isShapeDecoration(dec)
        ? Z_INDEX_DEFAULTS.BOX_DECORATION
        : Z_INDEX_DEFAULTS.LINE_DECORATION;
      return {
        ...dec,
        z_index: dec.z_index ?? defaultZ + index,
      };
    });

    return {
      ...diagram,
      diagram_nodes: nodesWithZIndex,
      diagram_edges: edgesWithZIndex,
      decorations: decorationsWithZIndex,
    };
  });
  // ... rest of LOAD_MODEL
}
```

#### 4.2 Preserve Original Order for Legacy Elements

The `+ index` offset ensures legacy elements without z_index maintain their original relative order within their category, while still participating in the unified z_index system.

---

### 5. Hit Testing Consistency

#### 5.1 Update findDecorationAtPoint

**File:** `frontend/src/utils/decorationUtils.ts` (lines 910-934)

This function already checks decorations in reverse z_index order (topmost first), which is correct.

Verify it's being used consistently for all hit testing.

#### 5.2 Update Node/Edge Hit Testing

If there are separate hit testing functions for nodes and edges, they should also respect z_index order:
- Check topmost elements first (highest z_index)
- Return the first hit match

---

### 6. Files Summary

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/Canvas.tsx` | Replace category rendering with unified z_index sorted rendering |
| `frontend/src/contexts/ArchitectureContext.tsx` | Ensure z_index is assigned on LOAD_MODEL for legacy elements |
| `frontend/src/utils/zIndexUtils.ts` | Verify `getSortedRenderOrder()` is complete and exported |

---

### 7. Acceptance Criteria

1. **Z-index determines visual order**
   - An element with z_index=200 appears above an element with z_index=100
   - This works regardless of element type (node, edge, decoration)

2. **Context menu actions work immediately**
   - "Bring to Front" moves element visually to top
   - "Send to Back" moves element visually to bottom
   - "Bring Forward" / "Send Backward" adjust relative position

3. **Mixed-type layering works**
   - A node can appear above a line decoration
   - A box decoration can appear above a node
   - Only z_index determines order, not element type

4. **Reload preserves order**
   - Save diagram with custom z_index values
   - Reload the page
   - Visual order matches saved z_index values

5. **Legacy diagrams work**
   - Diagrams without z_index values load correctly
   - Default z_index values are assigned preserving original relative order
   - Elements can then be reordered via context menu

6. **Hit testing matches visual**
   - Clicking on overlapping elements selects the topmost (highest z_index)
   - Hit testing order matches visual rendering order

---

### 8. Implementation Notes

1. **Performance Consideration**: Sorting on every render is O(n log n). For typical diagrams (<1000 elements), this is negligible. If needed, memoize the sorted array with proper dependencies.

2. **SVG Rendering**: In SVG, later elements render on top. So ascending z_index sort (lowest first) produces correct visual layering.

3. **Selection Indicators**: These should always render above diagram content, so they remain outside the sorted elements loop.

4. **Handles**: Resize and point handles should always be topmost for usability.

5. **Grid Background**: If there's a grid background, it should render before all elements (z_index = 0 or separate layer).

---

### 9. Testing Strategy

**Test File:** `frontend/src/__tests__/zindex-unified-rendering.test.ts`

Test cases:
1. Node with high z_index renders above decoration with lower z_index
2. Decoration with high z_index renders above node with lower z_index
3. "Bring to Front" makes element highest z_index and topmost visual
4. "Send to Back" makes element lowest z_index and bottommost visual
5. Elements with same z_index use id as tie-breaker (deterministic)
6. Legacy elements (no z_index) receive defaults and render correctly
7. Save/load cycle preserves z_index values and visual order
