# Viewport-Centered Node Spawn

Update the diagram node spawn-position behaviour so newly created nodes appear at the *centre of the currently visible viewport*, not the centre of the full canvas.

## Problem
Currently, when adding a node to a diagram (via palette, context menu, "Add with business processes", "Add with app components", or any mechanism that creates diagram_nodes), the new node is placed in the centre of the full virtual canvas (e.g. 2000×2000).
However, the visible portion of the canvas may be scrolled far away from this centre, causing newly added nodes to appear off-screen.

## Required Behaviour
### 1. Track the visible viewport rectangle
The diagram renderer must continuously maintain an up-to-date `viewport` object representing the visible region of the canvas:

viewport = {
  x: number,      // left edge of visible area in canvas coordinates
  y: number,      // top edge of visible area in canvas coordinates
  width: number,  // width of visible area (after adjusting for zoom)
  height: number  // height of visible area (after adjusting for zoom)
}

This must update whenever:
- The user scrolls horizontally or vertically
- The window is resized
- The zoom level changes

### 2. Spawn new nodes at the centre of the visible viewport
All node-creation paths must be updated to use:

newNode.pos_x = viewport.x + viewport.width / 2
newNode.pos_y = viewport.y + viewport.height / 2

This applies to:
- Adding an entity from the right-hand palette (left-click or right-click → Add)
- "Add with business processes"
- "Add with app components"
- Decorative node creation (boxes/lines), if applicable
- Any future node creation mechanism

### 3. Behavioural Requirements
- The node must always appear fully visible on creation.
- Works correctly regardless of current zoom.
- Works correctly regardless of scroll position.
- Works correctly on all diagrams (large or small).

### 4. Technical Notes
- Use the canvas scroll container's scrollLeft/scrollTop as the top-left origin of the viewport.
- Compute viewport size as:

  viewport.width = canvasVisibleWidth / zoomScale
  viewport.height = canvasVisibleHeight / zoomScale

- Introduce a shared helper (e.g. `getViewportCenter()`) for all node-creation logic.

### 5. Acceptance Criteria
- When scrolled far away, adding a node creates it in the visible centre.
- At any zoom level, added nodes appear in the viewport centre.
- "Add with business processes" positions the parent Application Point and child Process nodes in the visible centre.
- No node ever appears off-screen on creation.
