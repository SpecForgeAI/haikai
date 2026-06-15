# Spec Requirements: Inspector Panel

## Initial Description

Add a new collapsible **left-hand "Inspector" panel** in the Diagrams view that lets users edit visual text styling for selected diagram nodes and edges. Currently these values can only be changed by editing JSON; this feature makes them editable via the UI.

Key features requested:
1. Left-hand Inspector panel with collapsible/expandable behavior (similar to right-hand palette)
2. Selection model supporting single and multi-select (Ctrl+click)
3. Font Size, Font Styles (Bold/Italic/Underline), and Text Alignment controls
4. Changes apply immediately and persist through Save/Load JSON

## Codebase Analysis

### 1. Existing Diagrams View Structure

**Location:** `frontend/src/components/DiagramsView/DiagramsView.tsx`

The DiagramsView uses a flex column layout with:
- **Header bar** (`.headerBar`): Contains diagram selector, time navigation controls, and zoom controls
- **Main content** (`.mainContent`): Horizontal flex container with:
  - **Canvas container** (`.canvasContainer`): Takes `flex: 1` and contains the SVG canvas
  - **Palette panel**: Fixed width (300px) right-hand panel

**CSS Structure** (`DiagramsView.module.css`):
```css
.container { display: flex; flex-direction: column; height: 100%; }
.mainContent { display: flex; flex: 1; overflow: hidden; }
.canvasContainer { flex: 1; position: relative; overflow: hidden; }
```

**Layout modification needed:** The Inspector panel will be inserted **before** the canvas container in the mainContent div, creating:
`Inspector Panel | Canvas | Palette Panel`

### 2. Current Selection Handling

**Location:** `frontend/src/components/DiagramsView/Canvas.tsx` (lines 192-196, 349-466)

**Current state management:**
```typescript
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
const [selectedLabelEdgeId, setSelectedLabelEdgeId] = useState<string | null>(null);
```

**Current selection behavior (handleMouseDown):**
1. Click on node body: `setSelectedNodeId(clickedNode.id)` - single select only
2. Click on edge line: `setSelectedEdgeId(clickedEdge.id)` - single select only
3. Click on empty canvas: Deselects all (`setSelectedNodeId(null)`, etc.)

**Key observations:**
- Selection state is local to Canvas component
- No multi-select support currently
- No Ctrl+click handling
- Selection IDs would need to be lifted to DiagramsView or Context for Inspector panel access

**Multi-select implementation requirements:**
- Change from single ID to Set<string> for selectedNodeIds and selectedEdgeIds
- Add Ctrl+click detection via `e.ctrlKey || e.metaKey`
- Toggle logic: if already selected, remove; if not, add
- Without Ctrl: clear existing and select single item

### 3. Data Model for diagram_nodes and diagram_edges

**Location:** `frontend/src/types/model.ts` (lines 195-236)

**DiagramNode interface (already has styling fields):**
```typescript
export interface DiagramNode {
  id: string;
  entity_type: string;
  entity_id: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  auto_size?: boolean;
  z_index?: number;
  parent_node_id: string | null;
  style_override?: Record<string, unknown>;
  text_h_align?: TextHorizontalAlign;  // 'LEFT' | 'CENTER' | 'RIGHT'
  text_v_align?: TextVerticalAlign;    // 'TOP' | 'MIDDLE' | 'BOTTOM'
  text_area_width?: number;
  text_font_size?: string;   // e.g., "14px"
  text_font_weight?: string; // e.g., "bold", "normal"
  text_font_style?: string;  // e.g., "italic", "normal"
}
```

**DiagramEdge interface (already has label styling fields):**
```typescript
export interface DiagramEdge {
  id: string;
  relationship_type: string;
  relationship_id: string;
  source_node_id: string;
  target_node_id: string;
  label_text?: string;
  label_pos_x?: number;
  label_pos_y?: number;
  line_weight?: string;
  line_type?: string;
  line_dashes?: string;
  arrow_start?: string;
  arrow_end?: string;
  style_override?: Record<string, unknown>;
  edge_points: EdgePoint[];
  label_font_size?: string;
  label_font_weight?: string;
  label_font_style?: string;
}
```

**Missing fields to add:**
- `DiagramNode.text_text_decoration?: string;` (for underline: "underline" | "none")
- `DiagramEdge.label_text_decoration?: string;` (for underline: "underline" | "none")
- `DiagramEdge.label_h_align?: TextHorizontalAlign;` (if needed - currently labels use "middle" anchor)
- `DiagramEdge.label_v_align?: TextVerticalAlign;` (if needed)

**Text alignment types already defined:**
```typescript
export type TextHorizontalAlign = 'LEFT' | 'CENTER' | 'RIGHT';
export type TextVerticalAlign = 'TOP' | 'MIDDLE' | 'BOTTOM';
```

### 4. Existing Collapsible Panel Pattern

**Location:** `frontend/src/components/DiagramsView/PalettePanel.tsx`

**Collapsed state handling:**
```typescript
interface PalettePanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  // ... other props
}
```

**Collapsed rendering:**
```tsx
if (isCollapsed) {
  return (
    <div className={styles.panelCollapsed}>
      <button className={styles.toggleButton} onClick={onToggleCollapse} title="Expand palette panel">
        &lt;&lt;
      </button>
    </div>
  );
}
```

**CSS for collapsed state** (`PalettePanel.module.css`):
```css
.panel { width: 300px; border-left: 1px solid #e0e0e0; }
.panelCollapsed { width: 30px; padding-top: 12px; }
.toggleButton { width: 28px; height: 28px; border-radius: 4px; }
```

**State management in DiagramsView:**
- `isPalettePanelCollapsed` is stored in AppState (ArchitectureContext)
- Action `TOGGLE_PALETTE_PANEL` handles toggle
- This pattern should be replicated for Inspector panel

### 5. Text Styling Rendering Logic

**Location:** `frontend/src/components/DiagramsView/Canvas.tsx` (lines 697-838)

**Node text rendering:**
```typescript
const nodeFontSize = parseFontSize(node.text_font_size);  // default: 12
const nodeFontWeight = node.text_font_weight || 'normal';
const nodeFontStyle = node.text_font_style || 'normal';

// Text wrapping uses font styling
const lines = wrapText(label, textAreaWidth, nodeFontSize, nodeFontWeight, nodeFontStyle);

// SVG text element
<text
  fontSize={nodeFontSize}
  fontWeight={nodeFontWeight}
  fontStyle={nodeFontStyle}
  // text_text_decoration would need: textDecoration={nodeTextDecoration}
  fill="#333"
>
```

**Edge label rendering:**
```typescript
const labelFontSize = edge.label_font_size || '12px';
const labelFontWeight = edge.label_font_weight || 'normal';
const labelFontStyle = edge.label_font_style || 'normal';

<text
  fontSize={labelFontSize}
  fontWeight={labelFontWeight}
  fontStyle={labelFontStyle}
  // label_text_decoration would need: textDecoration={labelTextDecoration}
>
```

**Text position calculation** (`frontend/src/utils/rendering.ts`):
- `calculateTextPosition()` uses `node.text_h_align` and `node.text_v_align`
- Returns `{ startY, getLineX, anchor }` based on alignment
- Already fully supports LEFT/CENTER/RIGHT and TOP/MIDDLE/BOTTOM

### 6. State Update Actions

**Location:** `frontend/src/contexts/ArchitectureContext.tsx`

**Existing node update action:**
```typescript
case 'UPDATE_DIAGRAM_NODE': {
  // Updates node with Partial<DiagramNode> updates
  const updatedNodes = [...diagram.diagram_nodes];
  updatedNodes[nodeIndex] = {
    ...updatedNodes[nodeIndex],
    ...action.updates,
  };
}
```

**New action needed for edge updates (similar pattern):**
```typescript
| { type: 'UPDATE_DIAGRAM_EDGE'; diagramId: string; edgeId: string; updates: Partial<DiagramEdge> }
```

**Batch update action for multi-select:**
```typescript
| { type: 'UPDATE_DIAGRAM_NODES'; diagramId: string; nodeIds: string[]; updates: Partial<DiagramNode> }
| { type: 'UPDATE_DIAGRAM_EDGES'; diagramId: string; edgeIds: string[]; updates: Partial<DiagramEdge> }
```

## Technical Considerations Discovered

### Selection State Location

The selection state is currently local to Canvas.tsx. Two options:

**Option A: Lift to DiagramsView (recommended for v1)**
- Pass selectedNodeIds and selectedEdgeIds as props
- Pass setSelectedNodeIds and setSelectedEdgeIds as callbacks
- Inspector reads from these props

**Option B: Lift to ArchitectureContext**
- Add `selectedNodeIds: Set<string>` and `selectedEdgeIds: Set<string>` to AppState
- Add actions: `SELECT_NODE`, `DESELECT_NODE`, `TOGGLE_NODE_SELECTION`, `CLEAR_SELECTION`
- Better for future features but more complex

### Inspector Panel State

New state needed in AppState:
```typescript
isInspectorPanelCollapsed: boolean;
```

New action:
```typescript
| { type: 'TOGGLE_INSPECTOR_PANEL' }
```

### Mixed Values Display

When multiple items are selected with different values:
- Show empty/placeholder for mixed values
- Apply changes to all selected items when user modifies a control
- Use "-" or "Mixed" indicator for numeric fields
- Use unchecked/indeterminate state for toggles

### Default Values

From config and rendering analysis:
- Default font size: 12px (`appConfig.node.fontSize = 12`)
- Default font weight: 'normal'
- Default font style: 'normal'
- Default text decoration: 'none' (to be added)
- Default h_align: 'CENTER'
- Default v_align: 'MIDDLE'

## Existing Code to Reference

### Similar Features Identified

| Feature | Path | Use For |
|---------|------|---------|
| Collapsible panel pattern | `frontend/src/components/DiagramsView/PalettePanel.tsx` | Panel structure and collapse behavior |
| Panel CSS styling | `frontend/src/components/DiagramsView/PalettePanel.module.css` | CSS patterns for panels |
| Selection indicators | `frontend/src/components/DiagramsView/Canvas.tsx` (lines 926-960) | Visual selection feedback |
| Toggle button style | `frontend/src/components/common/Button.tsx` | Reusable button component |
| Node update dispatch | `frontend/src/contexts/ArchitectureContext.tsx` (`UPDATE_DIAGRAM_NODE`) | Pattern for updating nodes |
| Text rendering | `frontend/src/utils/rendering.ts` (`calculateTextPosition`) | How text styling is applied |

### Components to Potentially Reuse
- `Button` component from `frontend/src/components/common/Button.tsx`
- Panel structure pattern from `PalettePanel.tsx`
- CSS variables and colors from existing stylesheets (e.g., `#1976D2` for selection)

### Backend Logic to Reference
- `ArchitectureContext.tsx` reducer patterns for state updates
- `UPDATE_DIAGRAM_NODE` action for node property updates

## Visual Assets

### Files Provided
No visual assets provided.

### Visual Insights
N/A

## Requirements Summary

### Functional Requirements

**FR-1: Inspector Panel Layout**
- Collapsible left-hand panel in Diagrams view only
- Layout: Inspector | Canvas | Palette
- Collapsed: slim vertical bar (30px) with expand chevron pointing right (`>>`)
- Expanded: fixed width panel (suggest 280px) with vertical scroll
- Collapse toggle button at top

**FR-2: Selection Model Enhancement**
- Single click: select single item (deselect others)
- Ctrl+click (Cmd+click on Mac): toggle selection (add/remove from multi-select)
- Click empty canvas: deselect all
- Selection state must be accessible to both Canvas and Inspector components

**FR-3: Inspector Controls - Font Size**
- Decrease button (icon: minus or A-)
- Numeric input field (1-99, in pixels)
- Increase button (icon: plus or A+)
- Changes apply immediately to all selected items
- Mixed values: show empty or "-"

**FR-4: Inspector Controls - Font Styles**
- Bold toggle button (icon: B)
- Italic toggle button (icon: I)
- Underline toggle button (icon: U)
- Toggle buttons show active state when style is applied
- Mixed values: indeterminate/unchecked state

**FR-5: Inspector Controls - Text Alignment**
- Horizontal alignment: Left, Center, Right toggle group
- Vertical alignment: Top, Middle, Bottom toggle group
- Mutually exclusive within each group
- Mixed values: none selected

**FR-5a: Text Alignment Visibility Rules**
- Alignment controls ONLY apply to rectangular nodes (APPLICATION, APP_COMPONENT, SERVICE, etc.)
- Alignment controls do NOT apply to:
  - BUSINESS_USER nodes (text is below stick figure)
  - diagram_edge label_text (positioned at fixed point)
- Visibility behavior:
  - Selection has ANY rectangular nodes → Show alignment controls
  - Selection has ONLY BUSINESS_USER and/or edges → Hide alignment controls entirely
  - Mixed selection: alignment changes apply only to rectangular nodes

**FR-6: Data Persistence**
- All styling changes update in-memory model immediately
- Save JSON includes all styling fields
- Load JSON restores styling correctly

**FR-7: Empty State**
- When no items selected: show "Select a node or edge to edit its properties"

**FR-8: Extended Text Targets**
- BUSINESS_USER node text (below stick figure): supports Font Size and Font Styles
- diagram_edge label_text: supports Font Size and Font Styles
- Rectangular nodes: support Font Size, Font Styles, AND Text Alignment

### Data Model Extensions

**DiagramNode additions:**
- `text_text_decoration?: string;` - "underline" | "none"

**DiagramEdge additions:**
- `label_text_decoration?: string;` - "underline" | "none"

### Reusability Opportunities

- Reuse PalettePanel structure and CSS patterns
- Reuse Button component for toggle buttons
- Leverage existing `UPDATE_DIAGRAM_NODE` action pattern
- Follow existing text rendering patterns in Canvas

### Scope Boundaries

**In Scope:**
- Left-hand Inspector panel with collapse/expand
- Multi-select for nodes and edges (Ctrl+click)
- Font Size, Bold, Italic, Underline controls
- Horizontal and Vertical text alignment controls (for rectangular nodes only)
- Conditional visibility of alignment controls based on selection type
- Support for BUSINESS_USER node text styling (below stick figure)
- Support for diagram_edge label text styling
- Tooltips on all icon buttons
- Immediate visual feedback on changes
- JSON persistence of all styling fields

**Out of Scope:**
- Font family selection
- Text color selection
- Line/border styling for nodes
- Edge line styling (weight, dash pattern, arrows) - these exist but are not in Inspector
- Undo/redo for styling changes (future Phase 4 feature)
- Keyboard shortcuts for styling (e.g., Ctrl+B for bold)

### Technical Considerations

**State Architecture:**
- Selection state should be lifted from Canvas to DiagramsView
- New state in AppState: `isInspectorPanelCollapsed: boolean`
- New action: `TOGGLE_INSPECTOR_PANEL`

**New Actions for Context:**
- `UPDATE_DIAGRAM_EDGE` - single edge property update
- `UPDATE_DIAGRAM_NODES` - batch node update for multi-select
- `UPDATE_DIAGRAM_EDGES` - batch edge update for multi-select

**Rendering Updates:**
- Add `textDecoration` attribute to SVG text elements in Canvas
- Both node labels and edge labels need text-decoration support

**CSS Styling:**
- Follow existing panel patterns (background: #fafafa, border: 1px solid #e0e0e0)
- Toggle button active state: use primary color (#1976D2)
- Icon button size: suggest 28x28px like existing toggleButton

**Accessibility:**
- All buttons need aria-labels
- Tooltips for icons
- Keyboard navigation within controls
