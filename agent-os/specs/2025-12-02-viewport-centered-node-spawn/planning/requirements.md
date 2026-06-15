# Spec Requirements: Viewport-Centered Node Spawn

## Initial Description

Update the diagram node spawn-position behaviour so newly created nodes appear at the centre of the currently visible viewport, not the centre of the full canvas. This ensures users always see newly added nodes immediately, regardless of their current scroll position or zoom level.

## Context / Current Behaviour

Currently, when adding a node to a diagram via any creation mechanism (palette, context menu, "Add with business processes", "Add with app components", etc.), the new node is placed at the centre of the full virtual canvas (e.g., 2000x2000 pixels).

**Problem:** The visible portion of the canvas may be scrolled far away from this centre, causing newly added nodes to appear off-screen. Users must then pan/scroll to locate the newly created node, disrupting their workflow.

**Affected User Personas:**
- Enterprise Architects working on large diagrams with many nodes
- Technical Leads adding entities while focused on a specific region of a diagram
- Domain Owners building out architecture views iteratively

This directly impacts the product goal of enabling "new users to add application and data movement in under 5 minutes" - users should not waste time searching for nodes they just created.

## Desired Behaviour

### 1. Track the Visible Viewport Rectangle

The diagram renderer must continuously maintain an up-to-date `viewport` object representing the visible region of the canvas:

```typescript
viewport = {
  x: number,      // left edge of visible area in canvas coordinates
  y: number,      // top edge of visible area in canvas coordinates
  width: number,  // width of visible area (after adjusting for zoom)
  height: number  // height of visible area (after adjusting for zoom)
}
```

This viewport object must update whenever:
- The user scrolls horizontally or vertically
- The window/container is resized
- The zoom level changes

### 2. Spawn New Nodes at the Centre of the Visible Viewport

All node-creation paths must calculate spawn position using:

```typescript
newNode.pos_x = viewport.x + viewport.width / 2
newNode.pos_y = viewport.y + viewport.height / 2
```

### 3. All Node Creation Paths Affected

The following creation mechanisms must use viewport-centered positioning:
- Palette left-click add (clicking an entity in the right-hand palette)
- Palette right-click context menu "Add" action
- "Add with business processes" (creates Application Point with child Process nodes)
- "Add with app components" (creates Application with child Component nodes)
- Decorative boxes creation
- Decorative lines creation
- Any future node creation mechanism

### 4. Behavioural Requirements

- The node must always appear fully visible on creation
- Works correctly regardless of current zoom level
- Works correctly regardless of scroll position
- Works correctly on all diagrams (large or small virtual canvas sizes)

## Technical Notes

### Viewport Calculation

Use the canvas scroll container's `scrollLeft`/`scrollTop` as the top-left origin of the viewport.

Compute viewport size accounting for zoom:

```typescript
viewport.x = scrollContainer.scrollLeft / zoomScale
viewport.y = scrollContainer.scrollTop / zoomScale
viewport.width = canvasVisibleWidth / zoomScale
viewport.height = canvasVisibleHeight / zoomScale
```

Where:
- `canvasVisibleWidth` = the pixel width of the visible canvas container
- `canvasVisibleHeight` = the pixel height of the visible canvas container
- `zoomScale` = current zoom level (e.g., 1.0 = 100%, 0.5 = 50%, 2.0 = 200%)

### Implementation Guidance

- Introduce a shared helper function (e.g., `getViewportCenter()`) that all node-creation logic can use
- The viewport state should be maintained in the diagram rendering context/state
- Consider using event listeners for scroll, resize, and zoom changes to keep viewport state current
- The helper function should be the single source of truth for spawn position calculation

### Relevant Code Areas

Based on the tech stack (React, TypeScript, Canvas/SVG rendering):
- Canvas component handling scroll and zoom events
- Palette components triggering node creation
- Context menu actions for node creation
- Any existing node creation utility functions

## Acceptance Criteria

1. **Scrolled viewport test:** When scrolled far away from canvas centre, adding a node via any method creates it in the visible centre of the current viewport
2. **Zoom level test:** At any zoom level (50%, 100%, 200%, etc.), added nodes appear in the viewport centre
3. **Compound entity test:** "Add with business processes" positions the parent Application Point and all child Process nodes in the visible centre region
4. **Visibility guarantee:** No node ever appears off-screen on creation - newly created nodes are always immediately visible
5. **Resize handling:** After resizing the window/container, the viewport calculation correctly updates and new nodes still spawn in the visible centre

## Visual Assets

No visual assets provided.

## Scope Boundaries

### In Scope

- Updating all existing node creation paths to use viewport-centered positioning
- Implementing viewport tracking (scroll, resize, zoom events)
- Creating shared helper function for viewport centre calculation
- Handling compound entity creation (e.g., Application Point with children)
- Ensuring correct behaviour at all zoom levels

### Out of Scope

- Changes to node sizing or styling
- Changes to edge/relationship creation
- Changes to drag-and-drop behaviour (dragging from palette to specific canvas location)
- Changes to node movement after creation
- Auto-layout or collision detection for overlapping nodes
- Undo/redo for node creation (separate feature)
