# Specification: Diagram Decorations

## Goal
Add a "decorations" feature to the Diagram view that allows users to place purely visual elements on the canvas that are NOT tied to the architecture meta-model. These elements are used for grouping, annotating, and clarifying diagrams (e.g., grouping boxes, comment boxes, annotated lines).

## User Stories
- As an architect, I want to draw grouping boxes around related nodes so that viewers can understand logical groupings at a glance.
- As a user, I want to add annotation text and labelled lines to explain diagram elements without polluting the meta-model.
- As a user, I want decorations to be saved with the diagram and restored when I reload.

## Design Principle

**Decorations are purely visual elements, separate from the meta-model.**

- Two types: `BOX` and `LINE`
- Both can optionally have text
- A BOX with text is effectively a text box
- A LINE with text is a labelled line
- Stored in a separate `decorations[]` array, not in `diagram_nodes` or `diagram_edges`

## Specific Requirements

### 1. JSON Schema Extension: Diagram Decorations

Extend each diagram object with a new `decorations` array.

**Example Structure:**

```json
{
  "diagrams": [
    {
      "id": "d1",
      "name": "OMS to Risk Flow",
      "description": "Simple data flow example",
      "diagram_type": "DATA_MOVEMENTS",
      "settings": {},
      "diagram_nodes": [],
      "diagram_edges": [],
      "decorations": [
        {
          "id": "dec_box_1",
          "type": "BOX",
          "pos_x": 80,
          "pos_y": 200,
          "width": 400,
          "height": 250,
          "text": "Rates Trader Area",
          "text_h_align": "CENTER",
          "text_v_align": "TOP",
          "text_font_size": 14,
          "text_font_weight": "bold",
          "text_font_style": "normal",
          "text_color": "#000000",
          "background_color": "rgba(230,230,255,0.2)",
          "line_color": "#9999FF",
          "line_style": "DASHED",
          "line_weight": "2px",
          "z_index": 50
        },
        {
          "id": "dec_line_1",
          "type": "LINE",
          "line_points": [
            { "x": 150, "y": 220 },
            { "x": 260, "y": 220 },
            { "x": 260, "y": 280 }
          ],
          "text": "Dealer-to-dealer flow",
          "label_pos_x": 205,
          "label_pos_y": 250,
          "text_font_size": 12,
          "text_font_weight": "normal",
          "text_font_style": "italic",
          "text_color": "#333333",
          "line_color": "#666666",
          "line_style": "DASHED",
          "line_weight": "2px",
          "arrow_start": "NONE",
          "arrow_end": "ARROW",
          "z_index": 120
        }
      ]
    }
  ]
}
```

**Rules:**

- `decorations` is separate from `diagram_nodes` and `diagram_edges`
- No `entity_type`, `entity_id`, `relationship_id`, etc.
- `type` is an enum: `"BOX"` | `"LINE"`

**BOX Geometry:**
- `pos_x`, `pos_y`, `width`, `height` (same coordinate system as diagram_nodes)

**LINE Geometry:**
- `line_points[]` = polyline points, similar to edge_points

**Text Properties:**
- `text`: Optional string on both BOX and LINE. If empty/undefined, no text is drawn.
- `label_pos_x`, `label_pos_y`: For LINE decorations, optional label position. If absent and `text` is non-empty, renderer computes midpoint:
  - `label_pos_x = average(point.x)`
  - `label_pos_y = average(point.y)`

### 2. Styling Behaviour for Decorations

#### 2.1 BOX Decorations

**Supports:**
- **Text** (optional): When `text` is non-empty:
  - `text_h_align`: LEFT | CENTER | RIGHT
  - `text_v_align`: TOP | MIDDLE | BOTTOM
  - `text_font_size`, `text_font_weight`, `text_font_style`, `text_color`
  - Text is rendered inside the box with specified alignment
- **Background**: `background_color` = fill colour
- **Border**: `line_color`, `line_style` (SOLID | DASHED | DOTTED), `line_weight`
- **Interactions**: Move by dragging, resize via 8 handles (corners + edges)

**Does NOT Support:**
- Arrowheads (`arrow_start`/`arrow_end` have no effect)

#### 2.2 LINE Decorations

**Supports:**
- **Geometry**: `line_points[]` polyline path, user can drag points to reshape
- **Label text** (optional): If `text` is non-empty, drawn at `label_pos_x`/`label_pos_y` or computed midpoint
- **Text styling**: `text_font_size`, `text_font_weight`, `text_font_style`, `text_color`
- **Line styling**: `line_color`, `line_style`, `line_weight`
- **Arrows**: `arrow_start`, `arrow_end` (NONE | ARROW)
- **Interactions**: Move entire line by dragging, move individual control points

**Does NOT Support:**
- Background colour (no fill)
- Text alignment properties (centered by default)

#### 2.3 Style Controls Mapping (Inspector Panel)

**For selected BOX:**
- Font size, styles, alignment, colour → Apply to BOX.text
- Background colour → Apply to BOX.background_color
- Line colour, weight, style → Apply to BOX border
- Arrow controls → No effect

**For selected LINE:**
- Font size, styles, colour → Apply to LINE.text styles
- Background colour → Ignored
- Line colour, weight, style → Apply to LINE styling
- Arrow start/end → Apply to LINE arrows

**Multi-selection:** Controls apply to all compatible properties across selected decorations.

### 3. Bottom "Decorations" Panel: UX & Behaviour

#### 3.1 Panel Placement and Toggling

- Small icon/tab at the bottom edge of the canvas
- Click to expand panel upward
- Click again (or close button) to collapse

#### 3.2 Panel Layout When Expanded

Two main sections:
- **A) Add Decorations**
- **B) Decoration Text Editor**

#### 3A) Section: Add Decorations

**Buttons:**
- `[▭] Add Box`
- `[／] Add Line`

**Add Box Behaviour:**
1. Click button → enter "add BOX mode" (button highlighted)
2. User click-drags on canvas to define rectangle
3. On completion:
   - Create decoration: `type="BOX"`, geometry from gesture, `text=""`
   - Default styling: sensible background_color, line_color, etc.
   - Select the new BOX decoration
4. Mode reverts to neutral after creation

**Add Line Behaviour:**
1. Click button → enter "add LINE mode" (button highlighted)
2. User clicks once for start point, clicks again for end point
3. On completion:
   - Create decoration: `type="LINE"`, `line_points=[start, end]`, `text=""`
   - Default styling: line_color, line_style, line_weight
   - Select the new LINE decoration
4. Mode reverts to neutral after creation

#### 3B) Section: Decoration Text Editor

**Visibility:** Only shown when exactly ONE decoration (BOX or LINE) is selected.

**Content:**
- Label: "Decoration text"
- Text input area (single-line acceptable; small multi-line textarea preferred)

**Behaviour:**
- Populates with decoration's current `text` value
- Edits update `text` property in real-time
- Re-renders canvas immediately:
  - BOX: Text drawn inside the box
  - LINE: Label drawn at label position or midpoint
- Clearing text sets `text` to empty, no text drawn

**When selection changes:**
- If zero decorations, multiple decorations, or a diagram_node/diagram_edge selected → hide this section

### 4. Selection and Editing Behaviour

**Selection:**
- Click to select decoration
- Shift/Ctrl + click to multi-select
- Selection rectangle includes decorations

**Editing:**
- **BOX**: Move by dragging interior, resize via 8 handles
- **LINE**: Move entire line by dragging, show control points when selected for geometry adjustment

**Inspector Integration:**
- Left-hand inspector recognises selected decorations
- Applies style controls per rules in section 2

### 5. Z-Ordering

Decorations render according to `z_index` relative to other elements.

**Suggested Defaults:**
| Element Type | Default z_index |
|--------------|-----------------|
| BOX decorations | 50 |
| diagram_nodes | 100 |
| diagram_edges | 110 |
| LINE decorations | 120 |

BOX decorations (grouping) render below nodes. LINE decorations render above nodes/edges.

### 6. Save / Load Behaviour

**On Save JSON:**
- Include `decorations[]` array for each diagram with all properties

**On Load JSON:**
- Parse `decorations[]`
- Display BOX and LINE decorations at correct positions with styling
- Render labels where `text` is non-empty

Ensures visual annotations round-trip correctly with the diagram.

## TypeScript Interfaces

```typescript
type DecorationHAlign = 'LEFT' | 'CENTER' | 'RIGHT';
type DecorationVAlign = 'TOP' | 'MIDDLE' | 'BOTTOM';
type LineStyle = 'SOLID' | 'DASHED' | 'DOTTED';
type ArrowType = 'NONE' | 'ARROW';

interface DecorationBase {
  id: string;
  text?: string;
  text_font_size?: number;
  text_font_weight?: string;
  text_font_style?: string;
  text_color?: string;
  line_color?: string;
  line_style?: LineStyle;
  line_weight?: string;
  z_index?: number;
}

interface BoxDecoration extends DecorationBase {
  type: 'BOX';
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  text_h_align?: DecorationHAlign;
  text_v_align?: DecorationVAlign;
  background_color?: string;
}

interface LineDecoration extends DecorationBase {
  type: 'LINE';
  line_points: Array<{ x: number; y: number }>;
  label_pos_x?: number;
  label_pos_y?: number;
  arrow_start?: ArrowType;
  arrow_end?: ArrowType;
}

type Decoration = BoxDecoration | LineDecoration;

interface Diagram {
  id: string;
  name: string;
  description?: string;
  diagram_type?: string;
  settings?: Record<string, unknown>;
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
  decorations: Decoration[];
}
```

## Implementation Approach

### Phase 1: Data Model and Types
- Add `Decoration` types to `model.ts`
- Update `Diagram` interface to include `decorations: Decoration[]`
- Update JSON load/save to handle decorations

### Phase 2: Canvas Rendering
- Add decoration rendering in `Canvas.tsx` or `rendering.ts`
- Implement BOX rendering (rect with optional text)
- Implement LINE rendering (polyline with optional label)
- Implement z-ordering

### Phase 3: Bottom Panel UI
- Create `DecorationsPanel.tsx` component
- Add toggle button to canvas
- Implement "Add Box" and "Add Line" buttons with modes
- Implement "Decoration Text" editor section

### Phase 4: Selection and Interaction
- Extend selection logic to include decorations
- Implement BOX move/resize
- Implement LINE move/point-drag
- Integrate with inspector for style editing

### Phase 5: Reducer Actions
- Add `ADD_DECORATION`, `UPDATE_DECORATION`, `DELETE_DECORATION` actions
- Handle decoration selection state

## Existing Code to Leverage

**model.ts - Type Definitions**
- Add new `Decoration`, `BoxDecoration`, `LineDecoration` types
- Extend `Diagram` interface

**Canvas.tsx - Rendering**
- Add decoration rendering layer
- Leverage existing node/edge rendering patterns

**rendering.ts - Render Utilities**
- Add `renderBoxDecoration()`, `renderLineDecoration()` functions

**ArchitectureContext.tsx - State Management**
- Add decoration-related reducer actions
- Add `selectedDecorationIds` state

**InspectorPanel.tsx - Style Controls**
- Detect decoration selection and apply style mappings

## Visual Design

**Bottom Panel (collapsed):**
```
┌─────────────────────────────────────────────────────────────┐
│ [Canvas content...]                                         │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [▼ Decorations]                                             │
└─────────────────────────────────────────────────────────────┘
```

**Bottom Panel (expanded):**
```
┌─────────────────────────────────────────────────────────────┐
│ [Canvas content...]                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Decorations                                            [▲]  │
├─────────────────────────────────────────────────────────────┤
│ Add Decorations                                             │
│   [▭ Add Box]  [／ Add Line]                                │
├─────────────────────────────────────────────────────────────┤
│ Decoration Text                                             │
│   [                                               ]         │
│   (shown only when single decoration selected)              │
└─────────────────────────────────────────────────────────────┘
```

## Acceptance Criteria

**Adding Decorations:**
- [ ] Users can open the bottom "Decorations" panel
- [ ] Users can add BOX decorations via click-drag
- [ ] Users can add LINE decorations via click-click
- [ ] Newly created decorations are selected automatically

**BOX Decorations:**
- [ ] BOX renders with background colour and border
- [ ] BOX can be moved by dragging
- [ ] BOX can be resized via 8 handles
- [ ] BOX text (when present) renders inside with correct alignment

**LINE Decorations:**
- [ ] LINE renders as polyline with specified styling
- [ ] LINE can be moved by dragging
- [ ] LINE control points can be dragged to reshape
- [ ] LINE label (when present) renders at label position or midpoint
- [ ] LINE arrows render at start/end when specified

**Text Editor:**
- [ ] "Decoration text" editor appears when single decoration selected
- [ ] Text edits update decoration in real-time
- [ ] Text clears when input is emptied
- [ ] Editor hides when selection changes to non-decoration or multiple items

**Persistence:**
- [ ] Decorations save to JSON in `decorations[]` array
- [ ] Decorations load from JSON and render correctly
- [ ] All decoration properties round-trip correctly

**Inspector Integration:**
- [ ] Font controls apply to selected decoration text
- [ ] Background colour applies to BOX decorations
- [ ] Line styling applies to both BOX border and LINE stroke
- [ ] Arrow controls apply only to LINE decorations

**Z-Ordering:**
- [ ] BOX decorations render below nodes by default
- [ ] LINE decorations render above edges by default
- [ ] Z-index can be customized per decoration

## Out of Scope

- Complex LINE shapes (v0.x uses simple two-point or polyline)
- Decoration grouping/nesting
- Decoration templates or presets
- Copy/paste decorations across diagrams
- Undo/redo for decoration operations (unless existing undo system is extended)
- Decoration-to-node snapping or alignment guides
- Multi-line text editing for decorations
- Decoration rotation
