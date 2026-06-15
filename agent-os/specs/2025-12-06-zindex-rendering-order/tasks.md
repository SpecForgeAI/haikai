# Task Breakdown: Z-Index Unified Rendering Order

## Overview
Total Tasks: 18

This spec fixes the disconnect between z_index values (correctly updated via context menu) and actual visual rendering order (still using category-based layering). After this change, z_index becomes the **sole determinant** of rendering order.

## Task List

### Test Infrastructure

#### Task Group 1: Test Setup for Z-Index Rendering
**Dependencies:** None

- [x] 1.0 Complete test infrastructure for z_index rendering
  - [x] 1.1 Create test file `frontend/src/__tests__/zindex-unified-rendering.test.ts`
    - Write 6-8 focused tests that will verify correct behavior after implementation
    - Tests should initially fail (TDD approach)
  - [x] 1.2 Test: Node with higher z_index renders after node with lower z_index
    - Create two nodes with different z_index values
    - Verify getSortedRenderOrder returns them in ascending z_index order
  - [x] 1.3 Test: Decoration with higher z_index renders after node with lower z_index
    - Create a line decoration with z_index=200 and node with z_index=100
    - Verify decoration appears after node in sorted order
  - [x] 1.4 Test: Node with higher z_index renders after decoration with lower z_index
    - Create a node with z_index=150 and box decoration with z_index=50
    - Verify node appears after decoration in sorted order
  - [x] 1.5 Test: Same z_index uses ID as deterministic tie-breaker
    - Create two elements with identical z_index
    - Verify consistent ordering based on element ID
  - [x] 1.6 Test: Legacy elements without z_index receive appropriate defaults
    - Create nodes, edges, decorations without z_index property
    - Verify defaults are applied (nodes=100, edges=110, shapes=50, lines=120)
  - [x] 1.7 Test: getSortedRenderOrder includes all element types
    - Provide nodes, edges, and decorations
    - Verify all are included in output with correct type field
  - [x] 1.8 Run tests to confirm they fail (TDD baseline)
    - Execute `npm test -- --testPathPattern=zindex-unified-rendering`
    - Confirm tests fail as expected before implementation

**Acceptance Criteria:**
- Test file created with 6-8 focused tests
- Tests cover node/edge/decoration z_index sorting
- Tests cover legacy element default assignment
- Tests currently fail (implementation not yet done)

---

### Canvas Rendering Layer

#### Task Group 2: Unified Rendering in Canvas.tsx
**Dependencies:** Task Group 1

- [x] 2.0 Complete unified z_index-based rendering in Canvas.tsx
  - [x] 2.1 Import getSortedRenderOrder and RenderableElement from zIndexUtils
    - Add import statement at top of `frontend/src/components/DiagramsView/Canvas.tsx`
    - `import { getSortedRenderOrder, RenderableElement } from '../../utils/zIndexUtils';`
  - [x] 2.2 Remove lowZIndexDecorations and highZIndexDecorations filtering (lines 565-570)
    - Delete the filter statements for `lowZIndexDecorations`
    - Delete the filter statements for `highZIndexDecorations`
    - Keep `sortedDecorations` variable for other uses if needed, or remove if only used for filtering
  - [x] 2.3 Create getSortedElements computation
    - Add: `const sortedElements = getSortedRenderOrder(nodes, edges, decorations);`
    - Place after nodes, edges, decorations are defined (around line 580)
    - Consider useMemo for performance: `useMemo(() => getSortedRenderOrder(...), [nodes, edges, decorations])`
  - [x] 2.4 Create renderElement dispatcher function
    - Add a function that dispatches to correct renderer based on RenderableElement.type
    - Handle 'node', 'edge', 'shape-decoration', 'line-decoration' types
    - Return appropriate JSX for each element type
  - [x] 2.5 Extract current node rendering into renderNode helper
    - Move existing inline node rendering logic (lines 2321-2538) into a named function
    - Function signature: `renderNode(nodeData: DiagramNode): JSX.Element | null`
    - Include all existing logic (business user, ERD, standard rectangle rendering)
  - [x] 2.6 Extract current edge rendering into renderEdge helper
    - Move existing inline edge rendering logic (lines 2541-2635) into a named function
    - Function signature: `renderEdge(edgeData: DiagramEdge): JSX.Element | null`
    - Include path, arrowhead, and label rendering
  - [x] 2.7 Update renderDecoration to match dispatcher interface
    - Existing `renderDecoration` function (lines 2031-2260) already exists
    - Verify it works with RenderableElement structure
    - Adjust if needed for consistent key handling
  - [x] 2.8 Replace four rendering loops with single unified loop
    - Remove: `{lowZIndexDecorations.map(renderDecoration)}` (line 2318)
    - Remove: `{nodes.map(...)}` inline rendering (lines 2321-2538)
    - Remove: `{edges.map(...)}` inline rendering (lines 2541-2635)
    - Remove: `{highZIndexDecorations.map(renderDecoration)}` (line 2638)
    - Add: `{sortedElements.map((item) => renderElement(item))}`
  - [x] 2.9 Ensure selection indicators render after all content
    - Keep selection indicator rendering (lines 2640-2675) in place after unified loop
    - Verify handles rendering (lines 2677-2727) remains after content
  - [x] 2.10 Run Canvas-related tests to verify no regressions
    - Run existing Canvas tests if any
    - Verify application still renders correctly (manual check)

**Acceptance Criteria:**
- Four separate rendering loops replaced with single z_index-sorted loop
- All element types render through unified dispatcher
- Selection indicators and handles still render on top
- No visual regressions in existing functionality

---

### Context/State Layer

#### Task Group 3: Legacy Support in ArchitectureContext.tsx
**Dependencies:** Task Group 2

- [x] 3.0 Complete legacy z_index support on model load
  - [x] 3.1 Import z_index utilities in ArchitectureContext
    - Add import: `import { Z_INDEX_DEFAULTS, isShapeDecoration } from '../utils/zIndexUtils';`
    - Or use existing Z_INDEX_DEFAULTS from config/defaults if already imported
  - [x] 3.2 Update LOAD_MODEL case to assign z_index to nodes
    - In LOAD_MODEL handler (around line 195), add z_index assignment
    - Map diagram_nodes to ensure each has z_index: `node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE`
    - Consider adding small offset based on array index to preserve original order
  - [x] 3.3 Update LOAD_MODEL case to assign z_index to edges
    - Map diagram_edges to ensure each has z_index: `edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE`
    - Add array index offset if needed for deterministic ordering
  - [x] 3.4 Update LOAD_MODEL case to assign z_index to decorations
    - Map decorations array to assign defaults based on type
    - Shape decorations get Z_INDEX_DEFAULTS.BOX_DECORATION
    - Line decorations get Z_INDEX_DEFAULTS.LINE_DECORATION
    - Add index offset for deterministic ordering within type
  - [x] 3.5 Ensure backwards compatibility with existing diagrams
    - Test loading a diagram file without z_index properties
    - Verify elements receive correct defaults
    - Verify visual order is sensible (decorations below nodes, edges above nodes, line decorations on top)
  - [x] 3.6 Run LOAD_MODEL related tests
    - Execute tests related to model loading if they exist
    - Verify no regressions in diagram loading

**Acceptance Criteria:**
- Legacy diagrams without z_index load correctly
- Default z_index values match spec (50, 100, 110, 120)
- Array index offsets preserve original relative ordering
- Existing diagram files continue to work

---

### Verification Layer

#### Task Group 4: Test Verification and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Verify implementation and fill test gaps
  - [x] 4.1 Run z_index-unified-rendering tests
    - Execute: `npm test -- --testPathPattern=zindex-unified-rendering`
    - All 6-8 tests from Task Group 1 should now pass
  - [x] 4.2 Review hit testing consistency
    - Check `findDecorationAtPoint` in `decorationUtils.ts` (lines 910-934)
    - Verify it checks decorations in reverse z_index order (topmost first)
    - Check `findNodeAtPoint` respects z_index ordering
  - [x] 4.3 Add up to 4 integration tests for hit testing if needed
    - Test: Click on overlapping elements selects highest z_index element
    - Test: After "Bring to Front", element is selected on click over previously-top element
    - Test: Context menu "Send to Back" makes element clickable only when uncovered
  - [x] 4.4 Manual acceptance testing
    - Load application in browser
    - Create elements with overlapping positions
    - Use context menu to change z_index (Bring to Front, Send to Back)
    - Verify visual order changes immediately
    - Verify click/selection follows visual order
  - [x] 4.5 Test save/reload cycle
    - Create diagram with custom z_index values
    - Save to JSON file
    - Reload the file
    - Verify visual order matches saved z_index values
  - [x] 4.6 Run full test suite for this feature
    - Run all tests related to Canvas, z_index, decorations
    - Expected: All tests pass
    - Total feature tests: approximately 10-14 tests

**Acceptance Criteria:**
- All z_index-unified-rendering tests pass
- Hit testing matches visual rendering order
- Manual testing confirms expected behavior
- Save/reload preserves z_index values and visual order
- No more than 4 additional tests added for gaps

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Test Infrastructure** - Write failing tests first (TDD)
2. **Task Group 2: Canvas Rendering** - Replace category-based with z_index-sorted rendering
3. **Task Group 3: Legacy Support** - Ensure old diagrams load correctly
4. **Task Group 4: Verification** - Run tests, verify behavior, fill gaps

---

## Key Files to Modify

| File | Primary Changes |
|------|-----------------|
| `frontend/src/__tests__/zindex-unified-rendering.test.ts` | New test file (Task 1.1) |
| `frontend/src/__tests__/zindex-hit-testing.test.ts` | New test file for hit testing (Task 4.3) |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Replace 4 rendering loops with 1 z_index-sorted loop (Tasks 2.1-2.9) |
| `frontend/src/contexts/ArchitectureContext.tsx` | Assign default z_index on LOAD_MODEL (Tasks 3.2-3.4) |
| `frontend/src/utils/zIndexUtils.ts` | Verify getSortedRenderOrder (no changes expected) |

---

## Existing Code to Leverage

The implementation primarily leverages existing utilities:

1. **`getSortedRenderOrder()`** in `zIndexUtils.ts` (lines 132-180)
   - Already collects nodes, edges, decorations
   - Already wraps each in RenderableElement interface
   - Already sorts by zIndex ascending
   - **No changes needed** - just needs to be used

2. **`RenderableElement`** interface in `zIndexUtils.ts` (lines 121-126)
   - Already defined with type, element, zIndex fields
   - Ready for use in dispatcher

3. **`Z_INDEX_DEFAULTS`** in `zIndexUtils.ts` (lines 30-35)
   - BOX_DECORATION: 50
   - DIAGRAM_NODE: 100
   - DIAGRAM_EDGE: 110
   - LINE_DECORATION: 120

4. **`renderDecoration()`** in `Canvas.tsx` (lines 2031-2260)
   - Already handles all decoration types
   - Can be called from dispatcher

---

## Acceptance Criteria Summary

1. Element with higher z_index appears above lower z_index (regardless of type)
2. "Bring to Front" immediately moves element to visual top
3. "Send to Back" immediately moves element to visual bottom
4. Mixed-type layering works (node above decoration, decoration above edge, etc.)
5. Reload preserves z_index values and visual order
6. Legacy diagrams without z_index load correctly with defaults
7. Hit testing matches visual order (topmost element selected on click)

---

## Implementation Summary

**Date Completed:** 2025-12-06

**Changes Made:**

1. **Test Infrastructure (Task Group 1):**
   - Created `frontend/src/__tests__/zindex-unified-rendering.test.ts` with 17 tests
   - Tests verify z_index ordering for nodes, edges, decorations
   - Tests verify legacy element default assignment
   - All 17 tests pass

2. **Canvas Rendering Layer (Task Group 2):**
   - Added `useMemo` to React imports
   - Added `getSortedRenderOrder` and `RenderableElement` imports from zIndexUtils
   - Removed `lowZIndexDecorations` and `highZIndexDecorations` filtering
   - Removed unused `sortDecorationsByZIndex` and `getDecorationZIndex` imports
   - Added `sortedElements` useMemo computation after nodes/edges definitions
   - Added `renderNode` helper function for node rendering
   - Added `renderEdge` helper function for edge rendering
   - Added `renderElement` dispatcher function
   - Replaced four rendering loops with single unified loop

3. **Legacy Support (Task Group 3):**
   - Added `Z_INDEX_DEFAULTS` and `isShapeDecoration` imports from zIndexUtils
   - Modified LOAD_MODEL to assign z_index to nodes (default 100+index)
   - Modified LOAD_MODEL to assign z_index to edges (default 110+index)
   - Modified LOAD_MODEL to assign z_index to decorations (shapes: 50+index, lines: 120+index)

4. **Verification (Task Group 4):**
   - Created `frontend/src/__tests__/zindex-hit-testing.test.ts` with 6 integration tests
   - Verified findDecorationAtPoint respects z_index ordering
   - All 49 z-index related tests pass
   - TypeScript compiles without errors for Canvas.tsx and ArchitectureContext.tsx

**Test Results:**
- zindex-rendering.test.ts: 13 tests pass
- position-zindex-types.test.ts: 13 tests pass
- zindex-unified-rendering.test.ts: 17 tests pass
- zindex-hit-testing.test.ts: 6 tests pass
- Total: 49 z-index related tests pass
