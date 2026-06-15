# Specification: Palette Panel and BUSINESS_USER Node Enhancements

## Goal
Improve the usability and space efficiency of the Diagrams view palette panel through reduced font sizes and header heights, and extend the node resize functionality to support BUSINESS_USER stick figure nodes.

## User Stories
- As a user, I want to see more palette items without scrolling so that I can quickly browse and find entities to add to my diagram
- As a user, I want to resize BUSINESS_USER nodes just like other node types so that I can control the size of stick figures in my diagrams

## Specific Requirements

**Reduce palette panel text size**
- Apply smaller font size to all text within the right-hand palette panel to maximize visible items
- Reduce font size from current 13-14px to approximately 12px for all text elements
- Apply size reduction to section headers (e.g. "Applications", "Business Processes")
- Apply size reduction to item row names and IDs
- Apply size reduction to search input placeholder and entered text
- Maintain readability while creating more compact visual presentation
- Font size reduction should apply globally via CSS on palette panel container
- Ensure all text remains clearly legible at 12px size

**Reduce palette section header heights**
- Decrease vertical padding on section header rows to create more compact headers
- Reduce padding from current 8px to 2-4px on top and bottom
- Adjust line-height to match smaller font size for tighter vertical spacing
- Maintain clickable area and visual separation between sections
- Ensure chevron/triangle icon and label remain vertically aligned
- Header should still provide clear visual indication of collapsible area
- Reduced height applies to all section headers consistently

**Enable resize handles for BUSINESS_USER nodes**
- When a BUSINESS_USER diagram_node is selected, display the same 8 resize handles shown for rectangular nodes
- Handles appear at standard positions: top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right
- Each handle is a small filled circle with stroke as per existing handle styling
- Dragging any handle resizes the BUSINESS_USER node's bounding box (pos_x, pos_y, width, height)
- Remove the entity_type check that currently excludes BUSINESS_USER from resize handle rendering

**BUSINESS_USER resize behavior**
- Stick figure scales proportionally within the resized bounding box
- Head, body, arms, and legs adjust their dimensions based on new width and height
- Stick figure remains centered horizontally within the node width
- Text area below the stick figure adjusts based on text_area_width or default wrapping width
- Existing stick figure proportions are maintained: head 20% of height, body 40%, legs 40%
- Arm span and leg span scale relative to new node width
- Minimum size constraints apply to prevent unreadable stick figures (use existing minNodeWidth and minNodeHeight)
- Resize operations follow the same drag interaction pattern as rectangular nodes
- Changes persist to diagram_node width/height fields in model

**Preserve existing BUSINESS_USER rendering**
- Stick figure rendering logic remains unchanged except for scaling based on resized dimensions
- Text rendering below feet continues to use text_area_width if defined, or node.width - 10px otherwise
- Text alignment (text_h_align, text_v_align) continues to apply as currently implemented
- All font styling (text_font_size, text_font_weight, text_font_style) continues to work
- Selection indicator (blue outline) appears around resized bounding box

## Visual Design

No visual mockups provided. Implementation should follow these design principles:
- Palette panel maintains existing white/grey color scheme and border styling
- Smaller text creates denser information display without cluttering
- Section headers remain visually distinct despite reduced height
- BUSINESS_USER resize handles use identical styling to rectangular node handles
- Stick figure scales smoothly during resize drag operation with real-time preview

## Existing Code to Leverage

**PalettePanel.module.css, PaletteSection.module.css, PaletteItem.module.css styling**
- Current font-size values are 13-14px on various elements (searchInput, title, label, name, id)
- Padding on section headers is currently 8px top/bottom
- Apply new font-size and padding values via CSS updates to these modules
- Leverage existing CSS class structure without adding new classes
- Update specific pixel values in existing selectors

**Canvas.tsx resize handle logic for rectangular nodes**
- getHandlePositions function calculates 8 handle positions from node bounds
- getHandleAtPoint detects mouse over resize handles using handleSize radius
- calculateResize function computes new dimensions based on handle and drag delta
- Handle rendering code in selectedNode section (lines 933-945) with entity_type check
- Remove the !isBusinessUser condition to enable handles for BUSINESS_USER nodes
- Existing resize drag state and preview node logic applies without modification

**calculateStickManDimensions in rendering.ts**
- Function already calculates stick figure proportions based on node.width and node.height
- Head radius, body positions, arm span, and leg span all derive from dimensions
- Function is called during rendering and will automatically use updated dimensions after resize
- No changes needed to this function - it naturally handles arbitrary width/height values

**Canvas.tsx BUSINESS_USER rendering (lines 697-778)**
- Stick figure SVG elements render based on dims from calculateStickManDimensions
- Text area width and wrapping logic handles variable node dimensions
- Selection indicator rectangle already uses node bounding box dimensions
- Preview node state updates during drag operations provide real-time feedback
- Existing code structure supports resizing without rendering changes

**diagramEditing config in defaults.ts**
- minNodeWidth and minNodeHeight values provide minimum size constraints
- handleSize defines resize handle radius for hit detection and rendering
- selectionColor and handle styling constants apply to all node types
- These existing constants apply to BUSINESS_USER resize without modification

## Out of Scope
- Making palette panel width dynamically resizable (remains fixed 300px)
- Changing search input height or styling beyond font size
- Adding visual zoom/preview for palette items
- Constraining BUSINESS_USER resize to maintain aspect ratio
- Animating stick figure during resize operation
- Adding separate text_area_width resize handle
- Custom minimum size constraints specific to BUSINESS_USER
- Undo/redo for resize operations (general feature, not specific to this spec)
- Snap-to-grid during BUSINESS_USER resize
- Visual guides showing stick figure proportions during resize
