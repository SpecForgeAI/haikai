# Direct Editing of Position/Size Fields + Auto-Size Toggle + Z-Index Controls

## Overview

This specification extends the diagram editor with two new UI mechanisms for editing element properties:

1. **Top Bar POSITION Controls** (X, Y, W, H) - Numeric fields for precise position and size editing
2. **Right-Click Context Menu** - Auto-size toggle and z-index ordering controls

These controls apply to:
- Meta-model diagram nodes (DiagramNode)
- Decoration shapes (ShapeDecoration)
- Node edges (DiagramEdge)
- Decorative lines/arrows (LineDecoration)

Behaviour varies by element type as detailed below.

---

## Current State Analysis

### Existing Implementation

1. **Top Toolbar** (`DiagramsView.tsx:966-1241`):
   - Row 1: Diagram selection, time controls, zoom controls
   - Row 2: FONT SIZE | FONT STYLES | BOX ALIGNMENT | COLOUR
   - Controls enable/disable based on selection state
   - Uses `updateSelectedNodes`, `updateSelectedEdges`, `updateSelectedDecorations` functions

2. **Context Menu** (`PaletteContextMenu.tsx`):
   - Exists only for palette items (Add/Delete operations)
   - No canvas-level context menu for diagram elements
   - Portal-based rendering with viewport clamping

3. **Selection State** (`DiagramsView.tsx:25-30`):
   ```typescript
   interface SelectionState {
     selectedNodeIds: Set<string>;
     selectedEdgeIds: Set<string>;
     selectedDecorationIds: Set<string>;
   }
   ```

4. **Element Properties** (`model.ts`):
   - DiagramNode: `pos_x`, `pos_y`, `width`, `height`, `auto_size`, `z_index`
   - ShapeDecoration: `pos_x`, `pos_y`, `width`, `height`, `z_index`
   - LineDecoration: `line_points`, `z_index` (no pos_x/y/width/height)
   - DiagramEdge: `edge_points`, no explicit z_index (uses rendering order)

5. **Update Mechanism** (`ArchitectureContext.tsx`):
   - Dispatch actions: `UPDATE_DIAGRAM_NODES`, `UPDATE_DECORATIONS`, `UPDATE_DIAGRAM_EDGES`
   - Immutable state updates through reducer

### Current Gaps

1. No numeric position/size input fields in toolbar
2. No right-click context menu on canvas elements
3. No UI for toggling auto_size
4. No UI for adjusting z_index ordering

---

## Specification

### 1. Top Bar POSITION Controls

#### 1.1 Layout

Add a new **POSITION** group to Row 2 of the top toolbar, after COLOUR:

```
FONT SIZE | FONT STYLES | BOX ALIGNMENT | COLOUR | POSITION
```

Inside POSITION, display four numeric input fields:

```
┌─────────────────────────────────────────────────────────────┐
│  X: [____]   Y: [____]   W: [____]   H: [____]              │
└─────────────────────────────────────────────────────────────┘
```

#### 1.2 Field Specifications

| Field | Label | Maps To | Description |
|-------|-------|---------|-------------|
| X | X: | `pos_x` | Horizontal position from canvas origin |
| Y | Y: | `pos_y` | Vertical position from canvas origin |
| W | W: | `width` | Element width |
| H | H: | `height` | Element height |

**Input Constraints:**
- Maximum 4 digits (0-9999)
- Numeric-only input (reject non-digits)
- Input width: ~50px per field
- Minimum value: 0 for position, 1 for size (width/height)

#### 1.3 Enable/Disable Logic

POSITION controls are **ENABLED** when:
- Exactly **one** element is selected, AND
- The element is a **node** (DiagramNode) OR **non-line decoration** (ShapeDecoration)

POSITION controls are **DISABLED** when:
- No element is selected
- More than one element is selected
- Selected element is a **line** (LineDecoration) or **edge** (DiagramEdge)

**Rationale:** Lines and edges are defined by point arrays, not bounding boxes. They are resized by dragging endpoints, not numeric width/height.

#### 1.4 Update Behaviour

1. **On Input Change**:
   - Validate input is numeric
   - Clamp to valid range (0-9999 for position, 1-9999 for size)

2. **On Blur/Enter**:
   - Update the element's JSON property via dispatch
   - Diagram immediately re-renders at new position/size

3. **Implementation**:
   ```typescript
   // For nodes
   updateSelectedNodes({ pos_x: newX, pos_y: newY, width: newW, height: newH });

   // For decorations
   updateSelectedDecorations({ pos_x: newX, pos_y: newY, width: newW, height: newH });
   ```

#### 1.5 Value Display

When a single eligible element is selected:
- Display current values rounded to integers
- Update display when element is dragged/resized on canvas

---

### 2. Right-Click Context Menu

#### 2.1 Context Menu Component

Create a new `ElementContextMenu` component (similar to `PaletteContextMenu`):

```typescript
interface ElementContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  elementType: 'node' | 'edge' | 'shape-decoration' | 'line-decoration';
  elementId: string;
  currentAutoSize?: boolean;  // Only for nodes and shape decorations
  onClose: () => void;
  onAutoSizeToggle: () => void;
  onZIndexChange: (action: 'forward' | 'backward' | 'front' | 'back') => void;
}
```

#### 2.2 Menu Items by Element Type

**For Nodes & Shape Decorations (5 items):**

| Menu Item | Action | Description |
|-----------|--------|-------------|
| Enable/Disable Auto-Size | Toggle `auto_size` | Show "Enable" if false, "Disable" if true |
| Bring Forward | `z_index + 1` | Move one layer up |
| Bring to Front | `max(all z_index) + 1` | Move to topmost layer |
| Send Backward | `z_index - 1` | Move one layer down |
| Send to Back | `min(all z_index) - 1` | Move to bottommost layer |

**For Edges & Line Decorations (4 items):**

| Menu Item | Action | Description |
|-----------|--------|-------------|
| Bring Forward | `z_index + 1` | Move one layer up |
| Bring to Front | `max(all z_index) + 1` | Move to topmost layer |
| Send Backward | `z_index - 1` | Move one layer down |
| Send to Back | `min(all z_index) - 1` | Move to bottommost layer |

**Note:** Lines/edges don't have auto-size concept - they're defined by endpoints.

#### 2.3 Context Menu Trigger

In `Canvas.tsx`, add right-click handler:

```typescript
const handleContextMenu = useCallback((e: React.MouseEvent) => {
  e.preventDefault();

  const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY);

  // Check what element is under cursor (similar to click detection)
  const decoration = findDecorationAtPoint(canvasX, canvasY);
  const node = findNodeAtPoint(canvasX, canvasY);
  const edge = findEdgeAtPoint(canvasX, canvasY);

  if (decoration) {
    // Show context menu for decoration
    showElementContextMenu(e.clientX, e.clientY, 'decoration', decoration);
  } else if (node) {
    // Show context menu for node
    showElementContextMenu(e.clientX, e.clientY, 'node', node);
  } else if (edge) {
    // Show context menu for edge
    showElementContextMenu(e.clientX, e.clientY, 'edge', edge);
  }
}, []);
```

#### 2.4 Auto-Size Toggle Behaviour

When auto-size is toggled:

1. **Enable Auto-Size** (`auto_size: true`):
   - Element resizes to fit its text content
   - Manual width/height adjustments are overridden
   - POSITION W/H fields become read-only (visually indicated)

2. **Disable Auto-Size** (`auto_size: false`):
   - Element maintains current size
   - User can manually adjust via drag handles or POSITION fields

**Implementation:**
```typescript
// Toggle auto_size
const handleAutoSizeToggle = () => {
  if (selectedNodeIds.has(elementId)) {
    updateSelectedNodes({ auto_size: !currentAutoSize });
  } else if (selectedDecorationIds.has(elementId)) {
    updateSelectedDecorations({ auto_size: !currentAutoSize });
  }
};
```

#### 2.5 Z-Index Operations

Calculate min/max z_index across ALL diagram elements:

```typescript
function getZIndexBounds(diagram: Diagram): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  // Check nodes
  diagram.diagram_nodes.forEach(node => {
    const z = node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE;
    min = Math.min(min, z);
    max = Math.max(max, z);
  });

  // Check edges
  diagram.diagram_edges?.forEach(edge => {
    const z = edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE;
    min = Math.min(min, z);
    max = Math.max(max, z);
  });

  // Check decorations
  diagram.decorations?.forEach(dec => {
    const z = dec.z_index ?? (isShapeDecoration(dec)
      ? Z_INDEX_DEFAULTS.BOX_DECORATION
      : Z_INDEX_DEFAULTS.LINE_DECORATION);
    min = Math.min(min, z);
    max = Math.max(max, z);
  });

  return { min, max };
}
```

**Z-Index Actions:**
```typescript
const handleZIndexChange = (action: 'forward' | 'backward' | 'front' | 'back') => {
  const { min, max } = getZIndexBounds(diagram);
  const currentZ = element.z_index ?? getDefaultZIndex(element);

  let newZ: number;
  switch (action) {
    case 'forward':  newZ = currentZ + 1; break;
    case 'backward': newZ = currentZ - 1; break;
    case 'front':    newZ = max + 1; break;
    case 'back':     newZ = min - 1; break;
  }

  updateElement({ z_index: newZ });
};
```

---

### 3. Canvas Rendering Order

Update canvas rendering to respect z_index:

```typescript
function renderDiagram(ctx, diagram) {
  // Collect all renderable elements with z_index
  const elements = [
    ...diagram.decorations.map(d => ({ ...d, _type: 'decoration' })),
    ...diagram.diagram_nodes.map(n => ({ ...n, _type: 'node' })),
    ...diagram.diagram_edges.map(e => ({ ...e, _type: 'edge' })),
  ];

  // Sort by z_index (lower values render first = behind)
  elements.sort((a, b) => {
    const zA = a.z_index ?? getDefaultZIndex(a);
    const zB = b.z_index ?? getDefaultZIndex(b);
    return zA - zB;
  });

  // Render in order
  elements.forEach(el => {
    switch (el._type) {
      case 'decoration': renderDecoration(ctx, el); break;
      case 'node': renderNode(ctx, el); break;
      case 'edge': renderEdge(ctx, el); break;
    }
  });
}
```

---

### 4. Type Updates

#### 4.1 Add z_index to DiagramEdge

Update `model.ts`:

```typescript
export interface DiagramEdge {
  // ... existing fields
  z_index?: number;  // ADD THIS
}
```

#### 4.2 Add auto_size to ShapeDecoration

If not already present, ensure ShapeDecoration supports auto_size:

```typescript
export interface ShapeDecoration extends DecorationBase {
  // ... existing fields
  auto_size?: boolean;  // ADD IF MISSING
}
```

---

### 5. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Add POSITION control group to toolbar |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add right-click handler, update rendering order |
| `frontend/src/components/DiagramsView/ElementContextMenu.tsx` | New component for element context menu |
| `frontend/src/types/model.ts` | Add z_index to DiagramEdge, verify auto_size on decorations |
| `frontend/src/contexts/ArchitectureContext.tsx` | Possibly add helper for z_index bounds |
| `frontend/src/config/defaults.ts` | Verify Z_INDEX_DEFAULTS are appropriate |

---

### 6. Acceptance Criteria

1. **POSITION Controls Enablement:**
   - Selecting a single node or shape decoration enables X/Y/W/H fields
   - Selecting a line, edge, or multiple elements disables X/Y/W/H fields
   - Fields show current values when enabled

2. **POSITION Controls Functionality:**
   - Changing X/Y updates element position immediately
   - Changing W/H updates element size immediately
   - Values persist after save/load cycle

3. **Context Menu for Nodes/Shape Decorations:**
   - Right-click shows 5-item menu (auto-size toggle + 4 z-index actions)
   - Auto-size toggle label reflects current state
   - Z-index actions correctly update draw order

4. **Context Menu for Edges/Line Decorations:**
   - Right-click shows 4-item menu (z-index actions only)
   - Z-index actions correctly update draw order

5. **Z-Index Rendering:**
   - All diagram elements render in z_index order
   - "Bring to Front" places element above all others
   - "Send to Back" places element below all others

6. **Auto-Size Behaviour:**
   - Enabling auto-size resizes element to fit content
   - Disabling auto-size preserves current size
   - POSITION W/H fields indicate read-only state when auto-size is enabled

7. **Persistence:**
   - All position, size, auto_size, and z_index changes persist through save/load

---

### 7. Visual Reference

#### 7.1 Top Toolbar with POSITION Controls

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ [Diagram Selector ▼]   [< >]   [-][+] Fit  100%  │  -[12]+ px │ B I U │ ...    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ FONT SIZE │ FONT STYLES │ BOX ALIGNMENT │ COLOUR │ POSITION                    │
│ -[12]+ px │   B  I  U   │ H: L C R      │ [■][□] │ X:[150] Y:[200] W:[120] H:[80]│
│           │             │ V: T M B      │ [A]    │                              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 7.2 Context Menu for Node/Shape Decoration

```
┌─────────────────────┐
│ Enable Auto-Size    │  (or "Disable Auto-Size" if currently enabled)
├─────────────────────┤
│ Bring Forward       │
│ Bring to Front      │
│ Send Backward       │
│ Send to Back        │
└─────────────────────┘
```

#### 7.3 Context Menu for Edge/Line Decoration

```
┌─────────────────────┐
│ Bring Forward       │
│ Bring to Front      │
│ Send Backward       │
│ Send to Back        │
└─────────────────────┘
```

---

### 8. Implementation Notes

1. **Toolbar Consistency**: Follow existing patterns for control groups (vertical dividers, button styles, enable/disable states)

2. **Context Menu Pattern**: Use portal rendering like `PaletteContextMenu` for proper z-index stacking

3. **Input Debouncing**: Consider debouncing POSITION field updates to avoid excessive re-renders during typing

4. **Keyboard Support**: Enter key should commit field value and move focus; Tab should navigate between fields

5. **Selection Priority**: When right-clicking, if element is not already selected, select it before showing context menu

6. **Z-Index Defaults**: Use existing defaults from `Z_INDEX_DEFAULTS` when z_index is undefined

7. **Multi-Element Context Menu**: If multiple elements are selected and user right-clicks one of them, apply z-index actions to all selected elements (but auto-size toggle applies only to the clicked element)

---

### 9. Summary

This specification adds:

1. **POSITION controls** in the top toolbar for precise X/Y/W/H editing of nodes and shape decorations
2. **Element context menu** for right-click operations on all diagram elements
3. **Auto-size toggle** for nodes and shape decorations
4. **Z-index ordering controls** for all element types
5. **Proper z-index rendering** that respects element order across all types

The implementation maintains consistency with existing toolbar patterns and extends the context menu system to canvas elements.
