# Specification: Viewport-Centered Node Spawn

## Goal
Update node spawn positioning to use the centre of the currently visible viewport instead of the centre of the full canvas, ensuring newly created nodes always appear on-screen regardless of scroll position or zoom level.

## User Stories
- As a diagram author, I want newly added nodes to appear in the visible area of the canvas so that I don't have to scroll to find them.
- As a diagram author, I want nodes added via "Add with business processes" to appear in the visible area so compound entities are immediately visible.

## Specific Requirements

**Viewport Tracking**
- Maintain a viewport object with structure: `{ x, y, width, height }` in canvas coordinates
- Update viewport on scroll events via scroll container event listener
- Update viewport on window resize events
- Update viewport on zoom level changes
- Calculate: `viewport.x = scrollContainer.scrollLeft / zoomScale`
- Calculate: `viewport.y = scrollContainer.scrollTop / zoomScale`
- Calculate: `viewport.width = container.clientWidth / zoomScale`
- Calculate: `viewport.height = container.clientHeight / zoomScale`

**Viewport Center Calculation Helper**
- Create shared utility function `getViewportCenter(viewportInfo: ViewportInfo): { x: number, y: number }`
- Compute: `x = viewportInfo.scrollX + viewportInfo.width / 2`
- Compute: `y = viewportInfo.scrollY + viewportInfo.height / 2`
- Return type should be `{ x: number, y: number }` for spawn position
- Single source of truth for all node creation paths

**Node Position Calculation**
- Apply viewport center to: `newNode.pos_x = centerX - nodeWidth / 2`
- Apply viewport center to: `newNode.pos_y = centerY - nodeHeight / 2`
- Offset node position so node center aligns with viewport center
- Fallback to canvas center (e.g., 400, 300) if viewport info unavailable

**Palette Left-Click Add Path**
- Modify `handleItemClick` in PalettePanel.tsx to use viewport center
- Pass viewportInfo from DiagramsView through PalettePanel props
- Apply center position when calling `createDiagramNodeFromEntity` or when constructing node

**Palette Right-Click Context Menu Add Path**
- Modify `handleContextMenuAdd` in PalettePanel.tsx to use viewport center
- Reuse same viewport center calculation as left-click path
- Ensure consistency between left-click and context menu add behaviour

**Add with Business Processes Path**
- Modify `handleAddWithBusinessProcesses` in PalettePanel.tsx
- Already uses viewportInfo for new Applications - verify and extend pattern
- Apply viewport center to parent Application node position
- Recalculate child Business Process positions based on parent's new position

**Add with App Components Path**
- Modify `handleAddWithAppComponents` in PalettePanel.tsx
- Already uses viewportInfo for new Applications - verify and extend pattern
- Apply viewport center to parent Application node position
- Recalculate child App Component positions based on parent's new position

**Decorative Elements Path**
- Decorative boxes and lines use canvas click position (not affected)
- Verify InspectorPanel.tsx decoration add mode uses click coordinates correctly
- No changes needed for decoration creation as they use gesture-based placement

**Update createDiagramNodeFromEntity Utility**
- Optionally extend `createDiagramNodeFromEntity` in nodeCreation.ts to accept optional viewport center
- Alternative: keep utility simple and apply position after node creation in calling code
- Maintain backward compatibility with existing callers

## Existing Code to Leverage

**ViewportInfo Type and Tracking (Canvas.tsx lines 64-69, 638-689)**
- `ViewportInfo` interface already defined with `scrollX`, `scrollY`, `width`, `height`
- `reportViewportInfo()` callback already calculates and reports viewport state
- Scroll, resize, and zoom event listeners already wired up
- `onViewportChange` prop propagates info to DiagramsView

**DiagramsView Viewport State (DiagramsView.tsx lines 334, 477-479, 1306)**
- `viewportInfo` state already maintained via `useState<ViewportInfo | null>`
- `handleViewportChange` callback already updates state from Canvas
- `viewportInfo` already passed to PalettePanel as prop

**PalettePanel Viewport Usage (PalettePanel.tsx lines 34-40, 62, 80, 206-208, 572-606)**
- `ViewportInfo` interface already defined locally
- `viewportInfo` prop already accepted and used
- Compound handlers already calculate `centerX`, `centerY` from viewportInfo
- Pattern for viewport-centered positioning already established

**createDiagramNodeFromEntity (nodeCreation.ts lines 55-81)**
- Creates DiagramNode with default position from `calculateNodePlacement`
- Returns complete node structure that can be modified post-creation
- `calculateNodePlacement` uses cascading offset from base position - needs override

## Out of Scope
- Node sizing or styling changes
- Edge creation positioning
- Drag-and-drop behaviour from palette to specific canvas location
- Node movement after creation
- Auto-layout or collision detection for overlapping nodes
- Scroll-to-node after creation (nodes will already be visible)
- Changes to existing node positions on load
- Undo/redo for node creation (separate feature)
- Changes to decorative box/line creation (gesture-based)
- Multi-node spawn with automatic offset/stacking
