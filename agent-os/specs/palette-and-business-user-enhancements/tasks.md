# Task Breakdown: Palette Panel and BUSINESS_USER Node Enhancements

## Overview
Total Tasks: 2 task groups with 8 sub-tasks
Estimated Complexity: Low - primarily CSS changes and a simple conditional removal

## Task List

### Palette Panel Styling

#### Task Group 1: Reduce Font Sizes and Header Heights
**Dependencies:** None

- [x] 1.0 Complete palette panel styling improvements
  - [x] 1.1 Write 2-4 focused tests for palette panel rendering
    - Test that palette panel displays with correct styling
    - Test that section headers are rendered and collapsible
    - Test that palette items are displayed with name and ID
    - Test that search input is functional
  - [x] 1.2 Update PalettePanel.module.css font sizes
    - Change `.title` font-size from 14px to 12px (line 54)
    - Change `.searchInput` font-size from 14px to 12px (line 71)
    - Change `.emptyState` font-size from 14px to 12px (line 90)
    - File location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.module.css`
  - [x] 1.3 Update PaletteSection.module.css styling
    - Change `.header` padding from 8px 16px to 3px 16px (line 9) - reduces vertical padding to 3px
    - Change `.label` font-size from 13px to 12px (line 28)
    - Add line-height: 1.3 to `.label` for tighter vertical spacing
    - File location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteSection.module.css`
  - [x] 1.4 Update PaletteItem.module.css font sizes
    - Change `.name` font-size from 13px to 12px (line 32)
    - Keep `.id` font-size at 11px (already smaller, no change needed)
    - Maintain line-height: 1.4 for readability
    - File location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteItem.module.css`
  - [x] 1.5 Visual verification of palette panel changes
    - Launch application and navigate to Diagrams view
    - Verify all text is legible at 12px font size
    - Verify section headers have reduced height while maintaining clickability
    - Verify chevron/triangle icons remain aligned with header text
    - Verify more palette items are visible without scrolling
    - Verify search input text is clearly readable
  - [x] 1.6 Ensure palette panel tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify palette panel renders correctly with updated styling
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- All palette panel text uses 12px font (except item IDs at 11px)
- Section header vertical padding reduced to 3px top/bottom
- Section headers remain clickable and visually distinct
- Text remains clearly legible at reduced sizes
- More palette items visible in viewport without scrolling
- Visual alignment maintained for all elements

### BUSINESS_USER Node Resize

#### Task Group 2: Enable Resize Handles for BUSINESS_USER Nodes
**Dependencies:** None

- [x] 2.0 Complete BUSINESS_USER resize functionality
  - [x] 2.1 Write 2-4 focused tests for BUSINESS_USER resize
    - Test that BUSINESS_USER node displays 8 resize handles when selected
    - Test that dragging a resize handle updates node dimensions
    - Test that stick figure scales proportionally after resize
    - Test that minimum size constraints are enforced
  - [x] 2.2 Remove entity type check in Canvas.tsx
    - Locate line 934: `{!isBusinessUser && getHandlePositions(displayNode).map(...`
    - Remove the `!isBusinessUser &&` condition
    - Change to: `{getHandlePositions(displayNode).map(...`
    - This enables resize handles for all node types including BUSINESS_USER
    - File location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\Canvas.tsx`
  - [x] 2.3 Verify existing resize logic works for BUSINESS_USER
    - Confirm getHandlePositions function calculates positions correctly for BUSINESS_USER bounds
    - Confirm calculateResize function works with BUSINESS_USER dimensions
    - Confirm resize preview state updates during drag
    - No code changes needed - existing logic already supports BUSINESS_USER
  - [x] 2.4 Verify stick figure scaling logic
    - Confirm calculateStickManDimensions in rendering.ts uses node.width and node.height
    - Confirm stick figure elements scale proportionally based on resized dimensions
    - Confirm text area adjusts based on resized node width
    - No code changes needed - existing rendering automatically handles resized dimensions
    - File location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\rendering.ts`
  - [x] 2.5 Manual testing of BUSINESS_USER resize
    - Create or select a BUSINESS_USER node in diagram
    - Verify 8 resize handles appear (corners and midpoints)
    - Drag each handle type (corner, side) to resize node
    - Verify stick figure scales proportionally within new bounds
    - Verify text below stick figure adjusts to new width
    - Verify minimum size constraints prevent too-small nodes
    - Verify resize changes persist after deselection and reselection
    - Verify selection indicator (blue outline) matches resized bounds
  - [x] 2.6 Ensure BUSINESS_USER resize tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify resize handles render for BUSINESS_USER nodes
    - Verify resize operations work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- BUSINESS_USER nodes display 8 resize handles when selected
- All resize handles function correctly (corners and sides)
- Stick figure scales proportionally within resized bounds
- Head, body, arms, and legs maintain correct proportions (20%, 40%, 40% of height)
- Text area below stick figure adjusts to resized width
- Minimum size constraints (minNodeWidth, minNodeHeight) enforced
- Resize preview shows real-time updates during drag
- Resized dimensions persist to diagram_node model
- Selection indicator matches resized bounding box

## Execution Order

Recommended implementation sequence:
1. Palette Panel Styling (Task Group 1) - Independent, can be done first
2. BUSINESS_USER Node Resize (Task Group 2) - Independent, can be done in parallel with Task Group 1

**Note:** These two task groups are completely independent and can be implemented in parallel or in any order. No dependencies exist between them.

## Implementation Notes

**Palette Panel Styling:**
- Changes are purely CSS - no JavaScript/TypeScript modifications needed
- Three CSS module files need updates: PalettePanel.module.css, PaletteSection.module.css, PaletteItem.module.css
- Font size reduction: 14px -> 12px for most elements
- Header padding reduction: 8px -> 3px (vertical only)
- Verify visual appearance in browser after changes

**BUSINESS_USER Resize:**
- Only one line of code needs modification in Canvas.tsx (line 934)
- Remove `!isBusinessUser &&` condition from resize handle rendering
- All other resize logic already supports BUSINESS_USER nodes
- The calculateStickManDimensions function automatically scales to any width/height
- Existing resize drag handlers, preview state, and persistence all work without modification

**Testing Strategy:**
- Each task group writes only 2-4 highly focused tests
- Tests verify critical functionality only, not exhaustive coverage
- Task Group 1: Focus on palette rendering and styling
- Task Group 2: Focus on BUSINESS_USER resize handles and scaling behavior
- Total expected tests: 4-8 tests maximum
- Manual verification important for visual appearance and user interaction

**Files to Modify:**
1. `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PalettePanel.module.css`
2. `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteSection.module.css`
3. `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\PaletteItem.module.css`
4. `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\Canvas.tsx` (line 934)

**Files to Reference (no changes needed):**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\rendering.ts` (calculateStickManDimensions function)
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\defaults.ts` (diagramEditing config)
