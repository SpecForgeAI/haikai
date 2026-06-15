# Specification: Inspector Colour Customization

## Goal
Extend the left-hand Inspector panel to support colour customization for diagram nodes and edges, allowing users to override default background, line/border, and text colours for selected elements.

## User Stories
- As a diagram author, I want to change the background, border, and text colours of nodes so that I can create visually distinct groupings or highlight important elements.
- As a diagram author, I want to change the line and label text colours of edges so that I can visually differentiate relationship types or indicate flow states.

## Specific Requirements

**Colour Section UI Layout**
- Add a new "Colour" control group section below the existing "Text Alignment" section in the InspectorPanel
- Section header should display "Colour" using the existing `.controlGroupHeader` CSS class
- Contains three icon buttons arranged horizontally in a flex container with 4px gap (matching `.styleToggles` pattern)
- Each button should be 28x28px with the same styling as existing `.styleToggle` buttons

**Background Colour Button**
- Display a paint bucket icon or filled square icon to represent background/fill colour
- Tooltip on hover: "Set background colour"
- Clicking opens a colour picker popup
- Only applies to nodes; has no effect when only edges are selected
- When selection contains only edges, this button should be visually disabled (greyed out)

**Line Colour Button**
- Display a stroke/border icon (e.g., square outline or line icon) to represent line/border colour
- Tooltip on hover: "Set line/border colour"
- Clicking opens a colour picker popup
- Applies to both nodes (border colour) and edges (stroke colour)

**Text Colour Button**
- Display an "A" letter icon with colour indicator to represent text colour
- Tooltip on hover: "Set text colour"
- Clicking opens a colour picker popup
- Applies to node labels and edge label_text

**Colour Picker Popup Behaviour**
- Use browser-native HTML5 colour input (`<input type="color">`) for simplicity
- Colour input should be hidden and triggered by button click
- On colour selection/change, immediately apply colour to all selected items
- Dispatch appropriate UPDATE_DIAGRAM_NODES or UPDATE_DIAGRAM_EDGES actions
- Canvas should re-render immediately to show colour changes

**DiagramNode Schema Extension**
- Add `background_color?: string` - hex colour (e.g., "#RRGGBB") for node fill colour
- Add `line_color?: string` - hex colour for node border/stroke colour
- Add `text_color?: string` - hex colour for node label text
- All fields are optional strings; when absent, default colours from `entityColors` are used

**DiagramEdge Schema Extension**
- Add `line_color?: string` - hex colour for edge stroke colour
- Add `text_color?: string` - hex colour for edge label_text colour
- Both fields are optional strings; when absent, default colours are used

**Node Colour Rendering in Canvas.tsx**
- When rendering rectangular nodes, check for `background_color` property; if present, use it instead of `colors.background` from `getEntityColor()`
- When rendering node borders, check for `line_color` property; if present, use it instead of `colors.border`
- When rendering node text, check for `text_color` property; if present, use it instead of hardcoded "#333"
- For BUSINESS_USER stick man nodes, `line_color` applies to the stroke of all lines (head, body, arms, legs) and `text_color` applies to the name label below

**Edge Colour Rendering in Canvas.tsx**
- When rendering edge path stroke, check for `line_color` property; if present, use it instead of default "#616161"
- When rendering arrowhead fill, use the same colour as the edge stroke
- When rendering edge label_text, check for `text_color` property; if present, use it instead of hardcoded "#333"

**Multi-Select Behaviour**
- Colour changes apply to ALL currently selected nodes and/or edges
- Use existing `updateSelectedNodes()` and `updateSelectedEdges()` callback pattern from InspectorPanel
- Background colour button affects only nodes in the selection (edges are ignored)
- Line colour button affects all selected nodes and edges
- Text colour button affects all selected nodes and edges

## Existing Code to Leverage

**InspectorPanel.tsx (lines 339-357)**
- `updateSelectedNodes()` callback pattern for dispatching UPDATE_DIAGRAM_NODES action to multiple nodes
- `updateSelectedEdges()` callback pattern for dispatching UPDATE_DIAGRAM_EDGES action to multiple edges
- These existing functions can be reused directly for colour updates

**InspectorPanel.module.css (lines 166-219)**
- `.styleToggles` container class for horizontal button layout with 4px gap
- `.styleToggle` base button class (28x28px, white background, #ddd border)
- `.styleToggleActive` class for active state styling (blue background)
- Reuse these patterns for the three colour buttons

**ArchitectureContext.tsx (lines 378-440)**
- `UPDATE_DIAGRAM_NODES` action type already handles batch updates to multiple nodes
- `UPDATE_DIAGRAM_EDGES` action type already handles batch updates to multiple edges
- No new reducer actions required; existing actions support arbitrary partial updates

**Canvas.tsx (lines 1093-1237)**
- Node rendering logic using `getEntityColor()` to get default colours
- `colors.background` and `colors.border` variables show where to inject overrides
- Text fill currently hardcoded as "#333" - replace with conditional text_color check

**defaults.ts (lines 178-187)**
- `entityColors` map provides default background and border colours per entity type
- These remain the fallback when no colour override is set on the node

## Out of Scope
- Colour palette or preset colour swatches (use browser native colour picker only)
- Gradient fills or multiple background colours
- Per-line text colouring (entire label uses single colour)
- Colour inheritance from parent nodes
- Undo/redo functionality for colour changes (relies on existing model state)
- Colour picker for individual edge points
- Opacity/transparency controls
- Border width or line thickness controls in this feature
- Exporting colour information to formats other than JSON
- Colour accessibility contrast checking or warnings
