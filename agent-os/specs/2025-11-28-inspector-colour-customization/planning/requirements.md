# Inspector Colour Customization - Requirements

## Overview
Extend the left-hand Inspector panel in the Diagram view to support colour customisation for diagram nodes and edges. This builds on the existing Inspector (font size, font style, text alignment) and introduces a new "Colour" section with three colour pickers: background, lines, and text. We also need to extend the diagram JSON schema to persist these colours on nodes and edges.

---

## 1) New "Colour" section in the left-hand Inspector panel

Context:
- The left-hand Inspector currently controls:
  - Font Size
  - Font Styles (italic, underline, bold)
  - Text Alignment (vertical + horizontal)
- It applies to whichever nodes/edges are currently selected (including multi-select).

New section:
- Add a **"Colour"** section **below** the existing "Text Alignment" section.

Layout (within the Inspector, in order):
- Font Size
- Font Styles
- Text Alignment
- **Colour**

Colour section contents:
- Three icon buttons representing:
  1. **Background colour**
  2. **Line colour**
  3. **Text colour**

Each icon:
- Should visually indicate its purpose (e.g. paint bucket for background, stroke icon for line, "A" with colour indicator for text).
- Should show a tooltip on hover:
  - Background: "Set background colour"
  - Line: "Set line/border colour"
  - Text: "Set text colour"

Behaviour:
- Clicking any of these opens a **colour picker popup/modal**.
  - A simple implementation is fine (browser-native colour input, or a small custom palette).
- On colour selection/confirmation:
  - Apply the selected colour to **all currently selected items** (multi-select aware).
  - Update the in-memory diagram model.
  - Re-render the canvas immediately.

Selection logic:
- If a node is selected → the colour changes apply to that node as described in section 2.
- If an edge is selected → the colour changes apply to that edge as described in section 3.
- If multiple nodes and/or edges are selected:
  - All relevant properties are updated together.
  - For nodes that do not support a given colour type (e.g., background on edges), that control has no effect.

---

## 2) Colour behaviour for diagram_nodes

For diagram_nodes (box-like nodes, including Application, Process, Application Point, Business User, etc.):

### 2.1 Background colour picker
- Applies only to **nodes**, not edges.
- When the user selects a colour via the Background picker:
  - For every selected node:
    - Set `background_color` to the chosen colour.
- Rendering:
  - If `background_color` is present on a diagram_node:
    - Use it as the fill colour of the node.
  - If missing:
    - Use the default node fill colour based on its type.

### 2.2 Line (border) colour picker
- Applies to nodes and edges.
- For nodes:
  - When user selects a colour via the Line picker:
    - For every selected node:
      - Set `line_color` to the chosen colour.
- Rendering:
  - If `line_color` is present:
    - Use it for the node's border/outline.
  - Otherwise:
    - Use default stroke colour for that node type.

### 2.3 Text colour picker
- Applies to node labels.
- When the user selects a colour via the Text picker:
  - For every selected node:
    - Set `text_color` to the chosen colour.
- Rendering:
  - If `text_color` is present:
    - Use it for the node's main label text (and any associated name text, e.g., under the business_user stickman).
  - Otherwise:
    - Use the default text colour.

---

## 3) Colour behaviour for diagram_edges

For diagram_edges (relationship lines):

### 3.1 Background colour
- Edges do **not** have a background fill, so the Background picker has no effect on edges.
- For usability:
  - You may either:
    - Ignore the Background click for edges, OR
    - Disable/grey-out the Background icon when only edges are selected.
  - Choose one consistent behaviour and describe it in the implementation.

### 3.2 Line colour picker
- Applies to edge strokes.
- When user selects a colour via the Line picker:
  - For every selected edge:
    - Set `line_color` to the chosen colour.
- Rendering:
  - If `line_color` is present:
    - Use it as the edge stroke colour, overriding style defaults.
  - If absent:
    - Use the existing default from the edge style (e.g., parsed from mxGraph style, or a generic default).

### 3.3 Text colour picker
- Applies to edge label_text.
- When user selects a colour via the Text picker:
  - For every selected edge:
    - Set `text_color` to the chosen colour.
- Rendering:
  - If `text_color` is present:
    - Use it for the edge label_text.
  - Otherwise:
    - Use default text colour.

---

## 4) JSON / model schema extensions

We need to extend the diagram meta-data schema to persist these colour overrides.

### 4.1 diagram_nodes

Add the following optional fields to each diagram_node object:

- `background_color` (string; optional)
  - Hex colour (e.g. "#RRGGBB") or other CSS-compatible colour string.
- `line_color` (string; optional)
  - Stroke/border colour.
- `text_color` (string; optional)
  - Node text colour.

Schema example:

```json
"diagram_nodes": [
  {
    "id": "n1",
    "entity_type": "APPLICATION_POINT",
    "entity_id": "ap_oms",
    "pos_x": 100,
    "pos_y": 120,
    "width": 180,
    "height": 80,
    "background_color": "#E6F7FF",
    "line_color": "#0050B3",
    "text_color": "#000000",
    ...
  }
]
```

### 4.2 diagram_edges

Add the following optional fields to each diagram_edge object:

- `line_color` (string; optional)
  - Stroke colour for the edge polyline.
- `text_color` (string; optional)
  - Colour for label_text.

Schema example:

```json
"diagram_edges": [
  {
    "id": "e1",
    "relationship_type": "DATA_MOVEMENT",
    "relationship_id": "dm_trade_oms_to_risk",
    "source_node_id": "n1",
    "target_node_id": "n2",
    "label_text": "Daily Batch",
    "label_pos_x": 290,
    "label_pos_y": 80,
    "line_color": "#595959",
    "text_color": "#262626",
    ...
  }
]
```

### 4.3 Rendering precedence

For both nodes and edges:

- If a colour override is present in the diagram data:
  - Use it as the primary colour.
- If not:
  - Fall back to:
    - The default style based on node/edge type (e.g., configured in renderer).
    - Or parsed style from underlying source (e.g., draw.io import).

---

## 5) Interaction with selection model

- All colour changes apply to the current selection (single or multi).
- For multi-selection with mixed colours:
  - The colour picker icon may show:
    - The last applied colour, or
    - A neutral indicator (implementation detail).
  - When a new colour is chosen:
    - It overwrites the colour for **all** selected nodes/edges for that type (background/line/text).

- If selection includes both nodes and edges:
  - Background colour will affect nodes only.
  - Line and Text colours will affect all selected nodes/edges.

---

## 6) Save / Load behaviour

- On Save JSON:
  - Include `background_color`, `line_color`, `text_color` fields for nodes and edges where they are set.
- On Load JSON:
  - Read these fields and:
    - Apply them as overrides in the renderer.
    - Show them in the Inspector (e.g. colour pickers should reflect the currently applied colour on first open, if feasible).

---

## 7) Acceptance criteria

- The left-hand Inspector has a "Colour" section beneath "Text Alignment" with three icons:
  - Background, Line, Text.
- Selecting a node:
  - Background colour picker changes the fill colour of that node.
  - Line colour picker changes its border.
  - Text colour picker changes its label text colour.
- Selecting an edge:
  - Line colour picker changes the edge stroke.
  - Text colour picker changes the label_text colour.
  - Background colour has no effect (or is disabled when only edges are selected).
- Multi-selection:
  - Applying a colour updates all selected elements appropriately.
- Save/Load:
  - Colour changes persist to and from the JSON file via:
    - diagram_nodes[].background_color / line_color / text_color
    - diagram_edges[].line_color / text_color
- Default styling continues to work when no overrides are present.
