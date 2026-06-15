# Specification: Add with Business Processes Refinements

## Goal
Refine the "Add with business processes" feature to produce more polished compound layouts: Application labels are bold and top-aligned, child process boxes are sized precisely to their text content, and new Application groups appear centered in the visible viewport.

## User Stories
- As a diagram author, I want the Application label to be bold and top-aligned so that it serves as a clear header for the container box.
- As a diagram author, I want each Business Process child to be sized exactly to its text content (with consistent 5px padding) so the layout is compact and predictable.
- As a diagram author, I want newly added Application+process groups to appear in the center of my current view so I do not have to scroll to find them.

## Specific Requirements

**Application Label Styling**
- When creating a NEW Application node via "Add with business processes", set `text_v_align = "TOP"` and `text_font_weight = "bold"` on the Application DiagramNode
- When augmenting an EXISTING Application node with new processes, update it to also have `text_v_align = "TOP"` and `text_font_weight = "bold"`
- These properties are already supported in the DiagramNode interface (see model.ts lines 234-240)
- The rendering layer (Canvas.tsx) already respects these alignment and font properties

**Business Process Child Height Calculation**
- Each child Business Process node height must be: `5px (top padding) + text_height + 5px (bottom padding)`
- Use `measureTextWidth()` and `wrapText()` from rendering.ts to compute text dimensions for the process label
- Use `calculateTextBlockHeight()` from rendering.ts to get total text height given line count and font size
- The child node width remains at 120px (DEFAULT_CHILD_WIDTH), with text wrapped to fit
- Replace the hardcoded `height: 60` in PalettePanel.tsx with a dynamically calculated height

**Application Parent Height Calculation**
- Application height formula: `5px + app_text_height + 5px + sum(child_heights) + (5px * child_count)`
- This accounts for: top padding, Application label, gap below label, all child boxes stacked, and a 5px gap after each child
- Use the same text measurement utilities to compute `app_text_height`
- Update `calculateParentSize()` in compoundLayout.ts to accept dynamic child heights instead of using DEFAULT_CHILD_HEIGHT

**Viewport-Centered Placement for New Applications**
- When creating a NEW Application node, position it at the center of the visible canvas viewport
- The visible center is: `scrollX + (viewportWidth / 2)`, `scrollY + (viewportHeight / 2)`
- Application position: `pos_x = visibleCenterX - (application_width / 2)`, `pos_y = visibleCenterY - (application_height / 2)`
- PalettePanel needs access to current scroll position and viewport dimensions (pass via props or context)
- Existing Application nodes that are augmented with new processes retain their current position

**Update compoundLayout.ts calculateChildPosition**
- Modify to accept variable child heights instead of assuming DEFAULT_CHILD_HEIGHT
- Y position calculation must sum actual heights of preceding children plus gaps
- Consider passing an array of child heights or a height-lookup function

**Update compoundLayout.ts calculateParentSize**
- Accept an array of child heights instead of just childCount
- Compute total height as: `PADDING + LABEL_HEIGHT + PADDING + sum(childHeights) + (PADDING * childCount)`
- LABEL_HEIGHT should be computed dynamically using text measurement for the Application label

## Existing Code to Leverage

**rendering.ts Text Measurement Utilities**
- `measureTextWidth(text, fontSize, fontWeight, fontStyle)` - measures text width using canvas API
- `wrapText(text, maxWidth, fontSize, fontWeight, fontStyle)` - wraps text into lines for a given width
- `calculateTextBlockHeight(lineCount, fontSize, lineSpacing)` - computes total height for wrapped text
- Reuse these functions to compute exact text dimensions for both Application labels and Business Process labels

**compoundLayout.ts Layout Functions**
- `calculateChildPosition(parentNode, childIndex, existingChildCount)` - needs modification to accept variable heights
- `calculateParentSize(childCount, maxChildWidth)` - needs modification to accept actual child heights
- Constants: `PADDING = 5`, `LABEL_HEIGHT = 20`, `DEFAULT_CHILD_WIDTH = 120`

**PalettePanel.tsx handleAddWithBusinessProcesses**
- Current implementation at lines 161-259 handles the full add-with-processes flow
- Creates parent Application node with `createDiagramNodeFromEntity()`
- Creates child Business Process nodes with fixed width=120, height=60
- Calls `onAddNodes()` to add all nodes and `onUpdateNode()` to resize parent

**Canvas.tsx Viewport Access**
- Canvas component has `containerRef` (HTMLDivElement) that can provide scroll position and viewport size
- `svgRef` provides the SVG element for coordinate transformations
- Viewport information needs to be exposed to PalettePanel (via DiagramsView props or shared context)

**DiagramNode Model Properties**
- `text_v_align?: TextVerticalAlign` - supports "TOP", "MIDDLE", "BOTTOM"
- `text_font_weight?: string` - supports CSS font-weight values like "bold", "normal"
- These properties are already rendered correctly in Canvas.tsx (lines 1049-1053)

## Out of Scope
- Changing the horizontal alignment of Application labels (remains CENTER by default)
- Modifying the width calculation for child process nodes (stays at 120px)
- Adding viewport centering for "Add with app components" feature (only "Add with business processes" is affected)
- Persisting viewport position or zoom level
- Collision detection or nudging when placing new groups
- Undo/redo support for the styling changes
- Animated transitions when nodes are added
- User-configurable padding values (5px is hardcoded)
- Multi-line Application label support (assumes single-line Application names)
- Responsive layout adjustments based on zoom level
