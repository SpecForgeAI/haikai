# Specification: Inspector Panel for Text Styling

## Goal
Add a collapsible left-hand Inspector panel in the Diagrams view that enables users to edit visual text styling (font size, bold/italic/underline, text alignment) for selected diagram nodes and edges through the UI, eliminating the need to edit JSON directly.

## User Stories
- As a diagram author, I want to select one or more nodes/edges and change their text styling so that I can visually emphasize important elements
- As a diagram author, I want to multi-select items with Ctrl+click so that I can apply the same styling to multiple elements at once
- As a diagram author, I want to style BUSINESS_USER node labels (text below stick figure) with font size and styles
- As a diagram author, I want to style diagram_edge label text with font size and styles
- As a diagram author, I want the Inspector to hide alignment controls when they don't apply to my selection

## Specific Requirements

**Three-Panel Layout Structure**
- Insert Inspector panel before canvas container in mainContent div: `Inspector Panel | Canvas | Palette Panel`
- Inspector panel positioned on left side of DiagramsView
- Maintain existing flex layout structure from DiagramsView.tsx (mainContent uses `display: flex`)
- Inspector panel only visible in Diagrams view (not Meta-model view)

**Inspector Panel Dimensions and Collapse Behavior**
- Expanded width: 250px (narrower than PalettePanel's 300px since controls are simpler)
- Collapsed width: 30px (same as PalettePanel collapsed state)
- Collapsed state shows slim vertical bar with chevron pointing right (`>>`)
- Expanded state shows header with chevron pointing left (`<<`) and panel title "Inspector"
- Panel has `flex-shrink: 0` to maintain fixed width
- Content area has `overflow-y: auto` for vertical scrolling

**Selection Model Enhancement**
- Change Canvas.tsx selection state from single IDs to Sets: `selectedNodeIds: Set<string>` and `selectedEdgeIds: Set<string>`
- Lift selection state from Canvas to DiagramsView component
- Pass selection state and setters as props to both Canvas and InspectorPanel
- Single click: clear existing selection and select clicked item
- Ctrl+click (or Cmd+click on Mac): toggle item in selection (add if not selected, remove if selected)
- Click on empty canvas: clear all selections
- Both nodes and edges can be selected simultaneously in multi-select mode

**Editable Text Targets**
The Inspector applies text styling to the following targets:

1. **Rectangular diagram_nodes** (APPLICATION, APP_COMPONENT, SERVICE, APPLICATION_POINT, BUSINESS_PROCESS, etc.):
   - Text rendered inside the node box
   - Supports: Font Size, Font Styles, AND Text Alignment (horizontal + vertical)
   - Uses: text_font_size, text_font_weight, text_font_style, text_text_decoration, text_h_align, text_v_align

2. **BUSINESS_USER diagram_nodes**:
   - Text rendered below the stick figure
   - Supports: Font Size and Font Styles ONLY (no alignment)
   - Uses: text_font_size, text_font_weight, text_font_style, text_text_decoration
   - Clicking anywhere on the stick figure or its associated text selects the BUSINESS_USER node

3. **diagram_edge label_text**:
   - Relationship label text drawn along/near the edge
   - Supports: Font Size and Font Styles ONLY (no alignment)
   - Uses: label_font_size, label_font_weight, label_font_style, label_text_decoration
   - Clicking directly on the label text selects the edge for styling

**Selection Behavior for Text Targets**
- Clicking a diagram_edge's label text: Selects that edge; if Ctrl is held, adds to existing selection
- Clicking a BUSINESS_USER node (stick figure or text): Selects the node for text styling
- All selections behave consistently with the existing single/multi-select model

**Inspector Panel Empty State**
- When no items selected: display centered message "Select a node or edge to edit its properties"
- Use existing emptyState CSS pattern from PalettePanel.module.css
- Empty state uses muted text color (#999) and 12px font size

**Font Size Control Group**
- Section header: "Font Size" with horizontal rule separator
- Layout: Decrease button [-] | Numeric input | Increase button [+]
- Numeric input: 3-character width field showing current value (1-99), suffix "px"
- Decrease button: reduces font size by 1px, minimum 1
- Increase button: increases font size by 1px, maximum 99
- Input field allows direct typing; validates on blur to clamp 1-99
- Mixed values (multi-select with different sizes): show empty input with placeholder "-"
- Tooltips: "Decrease font size", "Increase font size"

**Font Styles Control Group**
- Section header: "Font Styles"
- Three toggle buttons in a row: Bold [B] | Italic [I] | Underline [U]
- Toggle buttons use 28x28px size (same as existing toggleButton)
- Active state: primary color background (#1976D2) with white text
- Inactive state: white background with gray border
- Mixed values (multi-select with different states): show inactive/unchecked state
- Clicking a toggle applies to ALL selected items (sets all to active if any inactive, sets all to inactive if all active)
- Tooltips: "Bold (font-weight: bold)", "Italic (font-style: italic)", "Underline (text-decoration: underline)"

**Text Alignment Control Group**
- Section header: "Text Alignment"
- Two sub-groups: Horizontal alignment and Vertical alignment
- Horizontal: Left | Center | Right toggle group (mutually exclusive)
- Vertical: Top | Middle | Bottom toggle group (mutually exclusive)
- Use standard alignment icons or text labels: L/C/R for horizontal, T/M/B for vertical
- Active alignment button highlighted with primary color
- Mixed values: no button highlighted (none active)
- Tooltips: "Align left", "Align center", "Align right", "Align top", "Align middle", "Align bottom"

**Text Alignment Control Visibility Rules**
Alignment controls (text_h_align, text_v_align) are ONLY meaningful for rectangular nodes where text is rendered inside a box. They do NOT apply to:
- BUSINESS_USER nodes (text is below the stick figure, not inside a box)
- diagram_edge label_text (label is positioned at a fixed point, not inside a box)

Visibility behavior:
- If selection contains ANY rectangular nodes → Show Text Alignment section
- If selection contains ONLY BUSINESS_USER nodes and/or edges → **Hide** Text Alignment section entirely
- When multi-select includes both rectangular nodes AND alignment-unsupported items:
  - Show alignment controls
  - Alignment changes apply ONLY to the rectangular nodes (unsupported targets ignore alignment settings)

Implementation note: To determine if a node is "rectangular" (alignment-supported), check `node.entity_type !== 'BUSINESS_USER'`. All other entity types use rectangular rendering with text_h_align/text_v_align.

**Data Model Extensions**
- Add `text_text_decoration?: string` to DiagramNode interface in model.ts (values: "underline" | "none")
- Add `label_text_decoration?: string` to DiagramEdge interface in model.ts (values: "underline" | "none")
- Add `label_h_align?: TextHorizontalAlign` to DiagramEdge interface (for future use, not in v1 UI)
- Add `label_v_align?: TextVerticalAlign` to DiagramEdge interface (for future use, not in v1 UI)
- Default values: text_text_decoration="none", label_text_decoration="none"
- Existing fields to use: text_font_size, text_font_weight, text_font_style, text_h_align, text_v_align (nodes); label_font_size, label_font_weight, label_font_style (edges)

**Styling Fields by Target Type**

| Target | Font Size | Font Weight | Font Style | Text Decoration | H Align | V Align |
|--------|-----------|-------------|------------|-----------------|---------|---------|
| Rectangular nodes | text_font_size | text_font_weight | text_font_style | text_text_decoration | text_h_align | text_v_align |
| BUSINESS_USER nodes | text_font_size | text_font_weight | text_font_style | text_text_decoration | N/A | N/A |
| diagram_edge labels | label_font_size | label_font_weight | label_font_style | label_text_decoration | N/A | N/A |

Note: No schema changes needed. Existing fields are sufficient for all text styling targets.

**Context Actions for Batch Updates**
- Add `UPDATE_DIAGRAM_EDGE` action to ArchitectureContext for single edge property updates (mirrors UPDATE_DIAGRAM_NODE pattern)
- Add `UPDATE_DIAGRAM_NODES` action for batch node updates: `{ type: 'UPDATE_DIAGRAM_NODES'; diagramId: string; nodeIds: string[]; updates: Partial<DiagramNode> }`
- Add `UPDATE_DIAGRAM_EDGES` action for batch edge updates: `{ type: 'UPDATE_DIAGRAM_EDGES'; diagramId: string; edgeIds: string[]; updates: Partial<DiagramEdge> }`
- Add `isInspectorPanelCollapsed: boolean` to AppState (default: false)
- Add `TOGGLE_INSPECTOR_PANEL` action

**Canvas Text Rendering Updates**
- Add `textDecoration` attribute to node label SVG text elements in Canvas.tsx
- Add `textDecoration` attribute to edge label SVG text elements in Canvas.tsx
- Read from `node.text_text_decoration` and `edge.label_text_decoration` with fallback to "none"
- Existing rendering uses `parseFontSize()`, `node.text_font_weight || 'normal'`, `node.text_font_style || 'normal'`

## Visual Design
No visual mockups provided. Follow existing PalettePanel patterns for:
- Panel container styling (background: #fafafa, border: 1px solid #e0e0e0)
- Header styling (background: white, border-bottom, 12px padding)
- Toggle button styling (28x28px, 4px border-radius, hover states)
- Section container styling with padding and scroll behavior

## Existing Code to Leverage

**PalettePanel.tsx and PalettePanel.module.css**
- Reuse collapsed/expanded panel structure pattern
- Reuse toggle button styling and behavior
- Reuse header layout with toggle button + title
- Reuse panelCollapsed class for collapsed state (30px width, centered content)
- Follow sectionsContainer pattern for scrollable content area

**Canvas.tsx Selection Handling (lines 192-196, 349-466)**
- Current selection state uses useState for selectedNodeId, selectedEdgeId, selectedLabelEdgeId
- Lift these to DiagramsView and convert to Set<string> for multi-select
- Modify handleMouseDown to check `e.ctrlKey || e.metaKey` for toggle selection
- Update click handlers to dispatch to parent via callback props

**ArchitectureContext.tsx UPDATE_DIAGRAM_NODE Action (lines 237-264)**
- Follow this pattern for UPDATE_DIAGRAM_EDGE, UPDATE_DIAGRAM_NODES, UPDATE_DIAGRAM_EDGES
- Same diagram/node/edge lookup pattern
- Same immutable state update pattern with spread operators

**DiagramsView.tsx Layout (lines 137-168)**
- Insert InspectorPanel component before canvasContainer in mainContent div
- Pass selection state as props to both Canvas and InspectorPanel
- Add isInspectorPanelCollapsed state management similar to isPalettePanelCollapsed

**Button Component (common/Button.tsx)**
- Can be extended or used as reference for toggle button styling
- Primary color (#1976D2) matches existing selection/highlight colors

## Out of Scope
- Font family selection (future enhancement)
- Text color selection (future enhancement)
- Node border/line styling controls
- Edge line styling (weight, dash pattern, arrows) - exists in model but not in Inspector v1
- Undo/redo for styling changes (Phase 4 feature per roadmap)
- Keyboard shortcuts for styling (e.g., Ctrl+B for bold)
- Drag-to-reorder controls within Inspector panel
- Persistence of Inspector panel collapse state across sessions

## Acceptance Criteria

### Core Functionality
- [ ] A collapsible left-hand Inspector panel exists in Diagrams view
- [ ] Selecting a node or edge updates the panel to reflect its text styling
- [ ] Multi-select is supported via Ctrl+click
- [ ] Changing Font Size / Font Styles via the Inspector immediately updates the appearance
- [ ] All styling changes persist to the underlying JSON and survive a Save → Load round trip
- [ ] Icons are intuitive and show informative tooltips on hover

### Extended Text Targets
- [ ] Selecting a diagram_edge label text enables Font Size and Font Styles controls
- [ ] Selecting a BUSINESS_USER node enables Font Size and Font Styles controls for the text below the stick man
- [ ] Selecting rectangular node(s) shows Font Size, Font Styles, AND Alignment controls

### Alignment Control Visibility
- [ ] If selection contains ANY rectangular nodes → Text Alignment controls appear
- [ ] If selection contains ONLY edges → Text Alignment controls are hidden
- [ ] If selection contains ONLY BUSINESS_USER nodes → Text Alignment controls are hidden
- [ ] If selection contains ONLY edges AND BUSINESS_USER nodes (no rectangular nodes) → Text Alignment controls are hidden
- [ ] In mixed selection (rectangular + non-rectangular), alignment changes only affect rectangular nodes

### Error-Free Operation
- [ ] No errors occur when combining styles across mixed selections
- [ ] Applying font styles to edges does not affect their alignment properties
- [ ] Applying font styles to BUSINESS_USER nodes does not affect alignment properties
