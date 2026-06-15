# Fix Decoration Reload Rendering and Override Browser Context Menu

## Overview

This specification addresses two issues that prevent expected diagram functionality:

1. **Decorations not rendering on load** - Decorations exist in the JSON but don't appear on canvas after reload
2. **Browser context menu not suppressed** - Right-clicking shows browser menu instead of custom element context menu

Both issues stem from missing integration code in Canvas.tsx and DiagramsView.tsx.

---

## Current State Analysis

### Issue 1: Decoration Rendering on Load

#### What Works
1. **LOAD_MODEL Action** (`ArchitectureContext.tsx:189-227`):
   - Ensures `decorations` array exists (defaults to `[]` for backward compatibility)
   - Decorations are stored in state correctly

2. **Decoration Rendering** (`Canvas.tsx:1975-2194`):
   - `renderDecoration()` function handles all 11 decoration types
   - Shape decorations (BOX, OVAL, DIAMOND, etc.) render via `renderShape()`
   - Line decorations (LINE, ARROW_SINGLE, ARROW_DOUBLE) render via path elements

3. **Decoration Retrieval** (`Canvas.tsx:1962-1973`):
   - `getDisplayDecorations()` separates by z-index
   - Low z-index decorations render before nodes
   - High z-index decorations render after edges

#### Root Cause Investigation Needed
The code path from loading to rendering appears complete. The issue may be:
- Decorations not being passed to Canvas component
- Diagram selection not triggering re-render
- Type mismatch between JSON and expected interface

**Action Required:** Verify the data flow from LOAD_MODEL → selected diagram → Canvas props → rendering.

---

### Issue 2: Context Menu Not Wired

#### What Exists
1. **ElementContextMenu Component** (`ElementContextMenu.tsx`):
   - Fully implemented with 5 menu items for nodes/shapes
   - 4 menu items for edges/lines
   - Portal-based rendering
   - Auto-dismiss on outside click and Escape key
   - Z-index and auto-size action handlers

2. **ElementContextMenuState Type** (`model.ts:731-752`):
   ```typescript
   export interface ElementContextMenuState {
     visible: boolean;
     x: number;
     y: number;
     elementType: ElementContextMenuType;
     elementId: string;
     currentAutoSize?: boolean;
   }
   ```

#### What's Missing

1. **No onContextMenu Handler** (`Canvas.tsx`):
   - SVG element has no `onContextMenu` prop
   - No `handleContextMenu` function exists
   - Browser default menu is not suppressed

2. **No Context Menu State** (`Canvas.tsx` or `DiagramsView.tsx`):
   - No state variable to track context menu visibility/position
   - ElementContextMenu never rendered in component tree

3. **No Integration**:
   - ElementContextMenu component is not imported or used anywhere
   - No connection between right-click events and menu display

---

## Specification

### 1. Verify Decoration Loading Flow

**Goal:** Ensure decorations from JSON are rendered on canvas after load.

#### 1.1 Debug Data Flow

Check that decorations flow correctly through:
```
JSON File
  ↓ (parse)
LOAD_MODEL action.payload.diagrams[n].decorations
  ↓ (reducer)
state.model.diagrams[n].decorations
  ↓ (selection)
selectedDiagram.decorations
  ↓ (props)
Canvas decorations prop
  ↓ (render)
renderDecoration() calls
```

#### 1.2 Verify Canvas Props

**Location:** `DiagramsView.tsx` around line 1400+

Check that Canvas receives decorations:
```typescript
<Canvas
  diagram={selectedDiagram}  // Must include decorations array
  // ...other props
/>
```

#### 1.3 Verify Decoration Type Matching

Ensure loaded decoration types match expected values:
- JSON uses uppercase: `"BOX"`, `"OVAL"`, `"LINE"`, etc.
- Code expects: `ShapeDecorationType` or `LineDecorationType`

If case mismatch exists, normalize during load:
```typescript
case 'LOAD_MODEL': {
  const diagramsWithDefaults = action.payload.diagrams.map(diagram => ({
    ...diagram,
    decorations: (diagram.decorations || []).map(dec => ({
      ...dec,
      type: dec.type.toUpperCase() as DecorationType,  // Normalize case
    })),
  }));
}
```

---

### 2. Implement Context Menu Integration

#### 2.1 Add Context Menu State

**Location:** `DiagramsView.tsx` state declarations

Add state to track context menu:
```typescript
const [elementContextMenu, setElementContextMenu] = useState<ElementContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  elementType: 'node',
  elementId: '',
  currentAutoSize: false,
});
```

#### 2.2 Add Context Menu Handler

**Location:** `DiagramsView.tsx` handlers section

```typescript
const handleElementContextMenu = useCallback((
  event: React.MouseEvent,
  elementType: ElementContextMenuType,
  elementId: string,
  currentAutoSize?: boolean
) => {
  event.preventDefault();
  event.stopPropagation();

  // Select the element if not already selected
  if (elementType === 'node') {
    setSelectedNodeIds(new Set([elementId]));
    setSelectedEdgeIds(new Set());
    setSelectedDecorationIds(new Set());
  } else if (elementType === 'edge') {
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set([elementId]));
    setSelectedDecorationIds(new Set());
  } else if (elementType === 'shape-decoration' || elementType === 'line-decoration') {
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setSelectedDecorationIds(new Set([elementId]));
  }

  setElementContextMenu({
    visible: true,
    x: event.clientX,
    y: event.clientY,
    elementType,
    elementId,
    currentAutoSize,
  });
}, []);

const handleCloseContextMenu = useCallback(() => {
  setElementContextMenu(prev => ({ ...prev, visible: false }));
}, []);
```

#### 2.3 Add Auto-Size Toggle Handler

**Location:** `DiagramsView.tsx` handlers section

```typescript
const handleAutoSizeToggle = useCallback((elementId: string, elementType: ElementContextMenuType) => {
  if (elementType === 'node') {
    const node = selectedDiagram?.diagram_nodes.find(n => n.id === elementId);
    if (node) {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId!,
        node: { ...node, auto_size: !node.auto_size },
      });
    }
  } else if (elementType === 'shape-decoration') {
    const decoration = selectedDiagram?.decorations?.find(d => d.id === elementId);
    if (decoration && 'auto_size' in decoration) {
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId!,
        decoration: { ...decoration, auto_size: !decoration.auto_size },
      });
    }
  }
  handleCloseContextMenu();
}, [selectedDiagram, selectedDiagramId, dispatch, handleCloseContextMenu]);
```

#### 2.4 Add Z-Index Change Handler

**Location:** `DiagramsView.tsx` handlers section

```typescript
const handleZIndexChange = useCallback((
  elementId: string,
  elementType: ElementContextMenuType,
  action: 'forward' | 'backward' | 'front' | 'back'
) => {
  const { minZIndex, maxZIndex } = getZIndexBounds(
    selectedDiagram?.diagram_nodes || [],
    selectedDiagram?.diagram_edges || [],
    selectedDiagram?.decorations || []
  );

  let element: DiagramNode | DiagramEdge | Decoration | undefined;
  let currentZIndex = 100; // Default

  // Find the element and its current z_index
  if (elementType === 'node') {
    element = selectedDiagram?.diagram_nodes.find(n => n.id === elementId);
    currentZIndex = (element as DiagramNode)?.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE;
  } else if (elementType === 'edge') {
    element = selectedDiagram?.diagram_edges.find(e => e.id === elementId);
    currentZIndex = (element as DiagramEdge)?.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE;
  } else {
    element = selectedDiagram?.decorations?.find(d => d.id === elementId);
    currentZIndex = element?.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION;
  }

  if (!element) return;

  // Calculate new z_index
  let newZIndex: number;
  switch (action) {
    case 'forward':
      newZIndex = currentZIndex + 1;
      break;
    case 'backward':
      newZIndex = currentZIndex - 1;
      break;
    case 'front':
      newZIndex = maxZIndex + 1;
      break;
    case 'back':
      newZIndex = minZIndex - 1;
      break;
  }

  // Dispatch appropriate update action
  if (elementType === 'node') {
    dispatch({
      type: 'UPDATE_DIAGRAM_NODE',
      diagramId: selectedDiagramId!,
      node: { ...(element as DiagramNode), z_index: newZIndex },
    });
  } else if (elementType === 'edge') {
    dispatch({
      type: 'UPDATE_DIAGRAM_EDGE',
      diagramId: selectedDiagramId!,
      edge: { ...(element as DiagramEdge), z_index: newZIndex },
    });
  } else {
    dispatch({
      type: 'UPDATE_DECORATION',
      diagramId: selectedDiagramId!,
      decoration: { ...(element as Decoration), z_index: newZIndex },
    });
  }

  handleCloseContextMenu();
}, [selectedDiagram, selectedDiagramId, dispatch, handleCloseContextMenu]);
```

#### 2.5 Pass Handler to Canvas

**Location:** `DiagramsView.tsx` Canvas component

```typescript
<Canvas
  // ...existing props
  onElementContextMenu={handleElementContextMenu}
/>
```

#### 2.6 Add Canvas onContextMenu Handler

**Location:** `Canvas.tsx` props and SVG element

Add prop type:
```typescript
interface CanvasProps {
  // ...existing props
  onElementContextMenu?: (
    event: React.MouseEvent,
    elementType: ElementContextMenuType,
    elementId: string,
    currentAutoSize?: boolean
  ) => void;
}
```

Add handler function:
```typescript
const handleContextMenu = useCallback((event: React.MouseEvent) => {
  // Always prevent browser context menu on canvas
  event.preventDefault();

  const { x: canvasX, y: canvasY } = getCanvasCoordinates(event);

  // Check nodes
  for (const node of (diagram?.diagram_nodes || [])) {
    if (isPointInNode(canvasX, canvasY, node)) {
      onElementContextMenu?.(event, 'node', node.id, node.auto_size);
      return;
    }
  }

  // Check decorations
  for (const decoration of (diagram?.decorations || [])) {
    if (isShapeDecoration(decoration)) {
      if (isPointInShapeDecoration(canvasX, canvasY, decoration)) {
        onElementContextMenu?.(event, 'shape-decoration', decoration.id, decoration.auto_size);
        return;
      }
    } else if (isLineBasedDecoration(decoration)) {
      if (isPointNearLineDecoration(canvasX, canvasY, decoration)) {
        onElementContextMenu?.(event, 'line-decoration', decoration.id);
        return;
      }
    }
  }

  // Check edges
  for (const edge of (diagram?.diagram_edges || [])) {
    if (isPointNearEdge(canvasX, canvasY, edge)) {
      onElementContextMenu?.(event, 'edge', edge.id);
      return;
    }
  }

  // No element found - just suppress browser menu
}, [diagram, onElementContextMenu]);
```

Add to SVG element:
```typescript
<svg
  ref={svgRef}
  // ...existing props
  onContextMenu={handleContextMenu}  // ADD THIS
>
```

#### 2.7 Render ElementContextMenu

**Location:** `DiagramsView.tsx` return statement

```typescript
return (
  <div className={styles.container}>
    {/* ...existing content */}

    {/* Element Context Menu */}
    <ElementContextMenu
      visible={elementContextMenu.visible}
      x={elementContextMenu.x}
      y={elementContextMenu.y}
      elementType={elementContextMenu.elementType}
      elementId={elementContextMenu.elementId}
      currentAutoSize={elementContextMenu.currentAutoSize}
      onClose={handleCloseContextMenu}
      onAutoSizeToggle={handleAutoSizeToggle}
      onZIndexChange={handleZIndexChange}
    />
  </div>
);
```

---

### 3. Hit Testing Utilities

#### 3.1 Point-in-Node Test

**Location:** `Canvas.tsx` or `utils/hitTesting.ts`

```typescript
function isPointInNode(x: number, y: number, node: DiagramNode): boolean {
  return (
    x >= node.pos_x &&
    x <= node.pos_x + node.width &&
    y >= node.pos_y &&
    y <= node.pos_y + node.height
  );
}
```

#### 3.2 Point-in-Shape-Decoration Test

```typescript
function isPointInShapeDecoration(
  x: number,
  y: number,
  decoration: ShapeDecoration
): boolean {
  return (
    x >= decoration.pos_x &&
    x <= decoration.pos_x + decoration.width &&
    y >= decoration.pos_y &&
    y <= decoration.pos_y + decoration.height
  );
}
```

#### 3.3 Point-Near-Line Test

```typescript
function isPointNearLineDecoration(
  x: number,
  y: number,
  decoration: LineDecoration,
  tolerance: number = 5
): boolean {
  const points = decoration.line_points;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = distanceToSegment(
      x, y,
      points[i].x, points[i].y,
      points[i + 1].x, points[i + 1].y
    );
    if (dist <= tolerance) return true;
  }
  return false;
}
```

---

### 4. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Add context menu state, handlers, render ElementContextMenu |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add onContextMenu prop and handler, hit testing |
| `frontend/src/contexts/ArchitectureContext.tsx` | Verify decoration loading, add UPDATE_DECORATION action if missing |

**Imports to Add:**
```typescript
// DiagramsView.tsx
import { ElementContextMenu } from './ElementContextMenu';
import { ElementContextMenuState, ElementContextMenuType } from '../../types/model';
import { getZIndexBounds } from '../../utils/zIndexUtils';
import { Z_INDEX_DEFAULTS } from '../../config/defaults';
```

---

### 5. Acceptance Criteria

#### Decoration Loading
1. Create decorations (BOX, OVAL, LINE, etc.) on canvas
2. Save diagram to JSON
3. Reload the page/diagram
4. **All decorations appear** in correct positions with correct styles
5. Decorations are selectable, movable, resizable

#### Context Menu - Nodes
1. Right-click on a diagram node
2. **Browser menu does NOT appear**
3. Custom menu appears with 5 items:
   - "Enable Auto-Size" or "Disable Auto-Size"
   - "Bring Forward"
   - "Bring to Front"
   - "Send Backward"
   - "Send to Back"
4. Clicking menu items updates the node

#### Context Menu - Shape Decorations
1. Right-click on a shape decoration (BOX, OVAL, etc.)
2. **Browser menu does NOT appear**
3. Same 5-item menu as nodes
4. Actions update the decoration

#### Context Menu - Edges/Lines
1. Right-click on an edge or line decoration
2. **Browser menu does NOT appear**
3. 4-item z-index menu (no auto-size option)
4. Actions update the element

#### Context Menu - Empty Canvas
1. Right-click on empty canvas area
2. **Browser menu does NOT appear**
3. No custom menu appears (or canvas-level menu if implemented)

---

### 6. Implementation Notes

1. **Z-Order Checking**: When checking for element under cursor, check in reverse z-order (highest z-index first) to match visual layering.

2. **Selection on Right-Click**: Right-clicking an element should select it (deselecting others) before showing the context menu.

3. **Menu Positioning**: Use `event.clientX/clientY` for screen coordinates. ElementContextMenu already handles viewport clamping.

4. **Dismiss on Action**: Close context menu after any menu item is clicked.

5. **Dismiss on Outside Click**: ElementContextMenu already handles this via useEffect.

---

### 7. Testing Considerations

1. **Decoration Persistence**: Test all 11 decoration types save/load correctly
2. **Context Menu**: Test on nodes, edges, all decoration types
3. **Z-Index Actions**: Verify rendering order changes after z-index updates
4. **Auto-Size Toggle**: Verify node/decoration resizes appropriately
5. **No Regression**: Verify left-click selection and drag still work
