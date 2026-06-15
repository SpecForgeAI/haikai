# Specification: BUSINESS_PROCESS Node Green Background Styling

## Goal
Update diagram rendering to automatically apply a green background color to all nodes with entity_type === "BUSINESS_PROCESS", distinguishing them visually from other node types without requiring changes to the JSON schema.

## User Stories
- As a diagram viewer, I want BUSINESS_PROCESS nodes to appear with green background so that I can easily identify business processes at a glance
- As an architect, I want this styling applied automatically based on entity type so that I don't need to manually configure colors for each node

## Specific Requirements

**Automatic green background for BUSINESS_PROCESS nodes**
- When Canvas component renders a diagram_node with entity_type === "BUSINESS_PROCESS", apply green background fill
- Recommended default color: #d6f5d6 (soft light green) or similar pastel green
- Border color, thickness, and radius remain consistent with current rectangular node styling
- Text color remains black or dark grey for readability and contrast
- No changes to JSON schema required - color determination is render-time only

**Color configuration centralization**
- Define the green color value in the entityColors configuration object in defaults.ts
- Update BUSINESS_PROCESS entry from current grey (#F5F5F5 background) to green
- Ensures consistency and maintainability through centralized color management

**Rendering logic update**
- getEntityColor() function in rendering.ts already retrieves colors by entity_type
- Canvas.tsx already uses getEntityColor() to get background and border colors
- Update only the entityColors configuration - no rendering logic changes needed

**Interaction consistency preservation**
- BUSINESS_PROCESS nodes support all existing interactions without changes
- Selection highlighting with blue border appears on top of green background
- Drag and move behavior works unchanged
- Resize handles appear and function identically to other rectangular nodes
- Containment behavior (parent-child relationships) functions normally

**Persistence and JSON compatibility**
- Green background is derived from entity_type at render time
- No new fields added to DiagramNode interface
- Saving and loading JSON preserves green styling automatically
- Existing diagrams with BUSINESS_PROCESS nodes render green immediately after code update

## Visual Design

**No visual mockups provided - styling is programmatic**
- BUSINESS_PROCESS nodes appear as rounded rectangles (existing style)
- Background fill: soft green (#d6f5d6 or equivalent)
- Border: medium grey or dark green (maintain visibility)
- Text: centered, black/dark grey, existing font styling
- Selection state: blue outline overlays green background

## Existing Code to Leverage

**entityColors configuration in frontend/src/config/defaults.ts (lines 134-143)**
- Already defines background and border colors for all entity types
- BUSINESS_PROCESS currently has grey background (#F5F5F5) and grey border (#616161)
- Simply update the background value to green color
- Border can remain grey or be changed to complementary green shade

**getEntityColor() function in frontend/src/utils/rendering.ts (lines 47-50)**
- Returns { background, border } object for a given entity_type
- Already used by Canvas component for all node rendering
- No changes needed to this function - it will return updated colors from entityColors config

**Canvas component rendering logic in frontend/src/components/DiagramsView/Canvas.tsx (lines 684-825)**
- Non-BUSINESS_USER nodes render as rectangles (lines 781-825)
- Uses getEntityColor() to get colors (line 687)
- Applies colors.background as fill attribute (line 798)
- Applies colors.border as stroke attribute (line 799)
- No changes needed - will automatically use green when entity_type === "BUSINESS_PROCESS"

**Selection and interaction logic in Canvas.tsx (lines 913-948)**
- Selection indicator renders blue outline 2px outside node bounds
- Uses diagramEditing.selectionColor (#1976D2) which will contrast well with green
- Resize handles use blue fill which will be visible on green background
- No changes needed to selection or interaction code

**BUSINESS_USER stick man rendering as reference (Canvas.tsx lines 697-778)**
- Shows pattern for entity_type-based conditional rendering
- BUSINESS_PROCESS nodes render as rectangles (not stick men)
- Use existing rectangle rendering path with updated colors from getEntityColor()

## Out of Scope
- Customizable node colors via JSON style_override field
- Different green shades for different BUSINESS_PROCESS subtypes
- User preference settings for color schemes
- Color picker UI for manual color selection
- High contrast or accessibility color mode
- Applying colored backgrounds to other entity types
- Gradient fills or texture patterns
- Border color customization separate from entity type
- Shadow or glow effects around BUSINESS_PROCESS nodes
- Animation or transitions when loading diagrams
