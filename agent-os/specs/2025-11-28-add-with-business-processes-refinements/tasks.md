# Task Breakdown: Add with Business Processes Refinements

## Overview
Total Tasks: 25 sub-tasks across 5 task groups

This feature refines the "Add with business processes" functionality to produce more polished compound layouts with:
1. Application label styling (bold, top-aligned)
2. Dynamic height calculation for process boxes based on text content
3. Viewport-centered placement for new Application groups

## Task List

### Utilities Layer

#### Task Group 1: Text Measurement Helper Functions
**Dependencies:** None

This task group creates reusable helper functions that compute node heights based on text content, leveraging existing text measurement utilities from `rendering.ts`.

- [x] 1.0 Complete text measurement helper functions
  - [x] 1.1 Write 3-5 focused tests for height calculation utilities
    - Test `calculateProcessNodeHeight()` returns correct height for single-line text
    - Test `calculateProcessNodeHeight()` returns correct height for multi-line wrapped text
    - Test `calculateApplicationLabelHeight()` returns correct height for Application label
    - Test edge case: empty string returns minimum height
  - [x] 1.2 Create `calculateProcessNodeHeight()` function in compoundLayout.ts
    - Import `measureTextWidth`, `wrapText`, `calculateTextBlockHeight` from rendering.ts
    - Accept parameters: `processName: string`, `nodeWidth: number = 120`, `fontSize: number = 12`
    - Calculate wrapped lines using `wrapText(processName, nodeWidth - 10, fontSize)` (10px = 2 * 5px padding)
    - Calculate text height using `calculateTextBlockHeight(lines.length, fontSize)`
    - Return: `5 + textHeight + 5` (top padding + text + bottom padding)
    - File: `frontend/src/utils/compoundLayout.ts`
  - [x] 1.3 Create `calculateApplicationLabelHeight()` function in compoundLayout.ts
    - Accept parameters: `appName: string`, `nodeWidth: number`, `fontSize: number = 12`, `fontWeight: string = 'bold'`
    - Calculate wrapped lines using `wrapText(appName, nodeWidth - 10, fontSize, fontWeight)`
    - Return text block height using `calculateTextBlockHeight(lines.length, fontSize)`
    - File: `frontend/src/utils/compoundLayout.ts`
  - [x] 1.4 Export new functions from compoundLayout.ts
    - Add exports for `calculateProcessNodeHeight` and `calculateApplicationLabelHeight`
  - [x] 1.5 Ensure text measurement helper tests pass
    - Run ONLY the tests written in 1.1
    - Verify all height calculations are correct

**Acceptance Criteria:**
- `calculateProcessNodeHeight()` returns `5 + text_height + 5` for any process label
- `calculateApplicationLabelHeight()` returns correct height accounting for text wrapping
- All 3-5 tests pass

---

### Layout Algorithm Layer

#### Task Group 2: Update compoundLayout.ts Layout Functions
**Dependencies:** Task Group 1

Update the layout calculation functions to accept dynamic child heights instead of using fixed `DEFAULT_CHILD_HEIGHT`.

- [x] 2.0 Complete layout algorithm updates
  - [x] 2.1 Write 3-5 focused tests for updated layout functions
    - Test `calculateChildPosition()` with variable heights array positions children correctly
    - Test `calculateParentSize()` with variable heights array computes correct total height
    - Test `calculateParentSize()` with dynamic label height computes correctly
    - Test edge case: empty childHeights array returns minimum parent size
  - [x] 2.2 Update `calculateChildPosition()` signature and implementation
    - Add optional parameter: `childHeights?: number[]`
    - When `childHeights` provided, compute Y position by summing heights of preceding children
    - Formula: `pos_y = parent.pos_y + PADDING + labelHeight + PADDING + sum(childHeights[0..actualIndex-1]) + (PADDING * actualIndex)`
    - Maintain backward compatibility when `childHeights` not provided (use DEFAULT_CHILD_HEIGHT)
    - File: `frontend/src/utils/compoundLayout.ts`
  - [x] 2.3 Update `calculateParentSize()` signature and implementation
    - Change signature to: `calculateParentSize(childHeights: number[], maxChildWidth?: number, labelHeight?: number)`
    - Compute total height: `PADDING + labelHeight + PADDING + sum(childHeights) + (PADDING * childCount)`
    - Use dynamic `labelHeight` parameter (default to LABEL_HEIGHT constant)
    - File: `frontend/src/utils/compoundLayout.ts`
  - [x] 2.4 Update existing usages of `calculateParentSize()` for backward compatibility
    - Search for usages in PalettePanel.tsx
    - Temporarily support old signature or update call sites
  - [x] 2.5 Ensure layout algorithm tests pass
    - Run ONLY the tests written in 2.1
    - Verify layout calculations produce correct results

**Acceptance Criteria:**
- `calculateChildPosition()` correctly positions children using variable heights
- `calculateParentSize()` correctly computes parent size with dynamic child heights and label height
- All 3-5 tests pass
- Existing functionality not broken

---

### Viewport Access Layer

#### Task Group 3: Expose Viewport Information to PalettePanel
**Dependencies:** None (can run in parallel with Task Groups 1-2)

Expose canvas viewport information (scroll position and dimensions) so PalettePanel can center new Application nodes in the visible area.

- [x] 3.0 Complete viewport access implementation
  - [x] 3.1 Write 2-4 focused tests for viewport info passing
    - Test viewport info is correctly passed from DiagramsView to PalettePanel
    - Test visible center calculation: `(scrollX + viewportWidth/2, scrollY + viewportHeight/2)`
    - Test centering calculation: `pos_x = centerX - width/2, pos_y = centerY - height/2`
  - [x] 3.2 Add viewport state to DiagramsView.tsx
    - Add state: `const [viewportInfo, setViewportInfo] = useState<{ scrollX: number; scrollY: number; width: number; height: number } | null>(null)`
    - Create callback: `handleViewportChange(info)` to update viewport state
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - [x] 3.3 Update Canvas.tsx to report viewport info
    - Add prop: `onViewportChange?: (info: { scrollX: number; scrollY: number; width: number; height: number }) => void`
    - Use `useEffect` with scroll event listener on container to call `onViewportChange`
    - Report initial viewport on mount and on scroll/resize
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
  - [x] 3.4 Update PalettePanel props interface
    - Add optional prop: `viewportInfo?: { scrollX: number; scrollY: number; width: number; height: number }`
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 3.5 Wire up viewport info in DiagramsView.tsx
    - Pass `onViewportChange={handleViewportChange}` to Canvas
    - Pass `viewportInfo={viewportInfo}` to PalettePanel
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - [x] 3.6 Ensure viewport access tests pass
    - Run ONLY the tests written in 3.1
    - Verify viewport info flows correctly through components

**Acceptance Criteria:**
- Canvas reports scroll position and viewport dimensions
- PalettePanel receives viewport info via props
- Visible center can be calculated from viewport info
- All 2-4 tests pass

---

### Feature Implementation Layer

#### Task Group 4: Update handleAddWithBusinessProcesses Handler
**Dependencies:** Task Groups 1, 2, 3

Apply all refinements to the `handleAddWithBusinessProcesses` function in PalettePanel.tsx.

- [x] 4.0 Complete handler refinements
  - [x] 4.1 Write 4-6 focused tests for refined handler behavior
    - Test NEW Application node has `text_v_align = "TOP"` and `text_font_weight = "bold"`
    - Test EXISTING Application node gets updated with `text_v_align = "TOP"` and `text_font_weight = "bold"`
    - Test child Business Process node heights are calculated dynamically (not fixed 60px)
    - Test NEW Application is centered in viewport (when viewportInfo available)
    - Test EXISTING Application retains its position when augmented
  - [x] 4.2 Apply Application label styling for NEW nodes
    - In `handleAddWithBusinessProcesses`, when creating new Application node:
    - Set `text_v_align: 'TOP'` on the node
    - Set `text_font_weight: 'bold'` on the node
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (around line 180-185)
  - [x] 4.3 Apply Application label styling for EXISTING nodes
    - When parent Application already exists on diagram:
    - Call `onUpdateNode(parentNodeId, { text_v_align: 'TOP', text_font_weight: 'bold' })`
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (around line 188-189)
  - [x] 4.4 Calculate dynamic heights for Business Process children
    - Import `calculateProcessNodeHeight` from compoundLayout.ts
    - For each `processId` in `newProcessIds`:
      - Look up process name from `metaModel.entities.business_processes`
      - Calculate height: `calculateProcessNodeHeight(processName, 120)`
      - Store heights in array for parent size calculation
    - Replace hardcoded `height: 60` with calculated height
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (around lines 221-243)
  - [x] 4.5 Calculate dynamic Application parent height
    - Import `calculateApplicationLabelHeight` from compoundLayout.ts
    - Look up Application name from `metaModel.entities.applications`
    - Calculate label height: `calculateApplicationLabelHeight(appName, parentWidth)`
    - Call updated `calculateParentSize(childHeights, maxWidth, labelHeight)`
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (around lines 250-258)
  - [x] 4.6 Implement viewport-centered placement for NEW Applications
    - Check if `viewportInfo` is available and parent is NEW (not existing)
    - Calculate visible center: `centerX = viewportInfo.scrollX + viewportInfo.width / 2`
    - Calculate visible center: `centerY = viewportInfo.scrollY + viewportInfo.height / 2`
    - Set Application position: `pos_x = centerX - width/2`, `pos_y = centerY - height/2`
    - Existing Applications retain their current position
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 4.7 Update `calculateChildPosition` calls with dynamic heights
    - Pass `childHeights` array to `calculateChildPosition()`
    - Ensure child Y positions account for variable heights of preceding children
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 4.8 Ensure handler refinement tests pass
    - Run ONLY the tests written in 4.1
    - Verify all refinements work correctly

**Acceptance Criteria:**
- NEW Application nodes have `text_v_align = "TOP"` and `text_font_weight = "bold"`
- EXISTING Application nodes get updated with same styling
- Child Business Process heights are calculated from text content (5px + text_height + 5px)
- Application parent height fits children exactly
- NEW Application groups appear centered in visible viewport
- EXISTING Application nodes retain position when augmented
- All 4-6 tests pass

---

### Testing Layer

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

Review existing tests and fill critical gaps for end-to-end feature verification.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 3-5 tests from Task Group 1 (text measurement helpers)
    - Review the 3-5 tests from Task Group 2 (layout algorithms)
    - Review the 2-4 tests from Task Group 3 (viewport access)
    - Review the 4-6 tests from Task Group 4 (handler refinements)
    - Total existing tests: approximately 12-20 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus on integration between components
    - Check end-to-end flow: palette action -> node creation -> layout
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Integration test: Full "Add with business processes" flow produces correct layout
    - Integration test: Multiple processes with varying text lengths layout correctly
    - Visual regression check: Application label renders bold and top-aligned
    - Edge case: Application with no linked processes
    - Edge case: Very long process names wrap correctly
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 20-28 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-28 tests total)
- Critical user workflows are covered
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Text Measurement Helpers ----+
                                           |
Task Group 2: Layout Algorithm Updates ----+---> Task Group 4: Handler Updates ---> Task Group 5: Testing
                                           |
Task Group 3: Viewport Access -------------+
```

**Parallel execution possible:**
- Task Groups 1, 2, and 3 can be developed in parallel (no interdependencies)
- Task Group 4 depends on completion of Task Groups 1, 2, and 3
- Task Group 5 depends on completion of Task Group 4

**Suggested specialist assignments:**
- Task Groups 1-2: Backend/algorithm engineer (layout calculations)
- Task Group 3: Frontend engineer (React component wiring)
- Task Group 4: Full-stack engineer (integration of all pieces)
- Task Group 5: QA engineer (test review and gap analysis)

---

## Key Files to Modify

| File | Task Groups | Description |
|------|-------------|-------------|
| `frontend/src/utils/compoundLayout.ts` | 1, 2 | Add height calculation helpers, update layout functions |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 3, 4 | Add viewport prop, refine handler |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 3 | Report viewport info |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 3 | Wire viewport info between Canvas and PalettePanel |

---

## Existing Utilities to Leverage

From `frontend/src/utils/rendering.ts`:
- `measureTextWidth(text, fontSize, fontWeight, fontStyle)` - Measure text width using canvas API
- `wrapText(text, maxWidth, fontSize, fontWeight, fontStyle)` - Wrap text into lines
- `calculateTextBlockHeight(lineCount, fontSize, lineSpacing)` - Calculate total text block height

From `frontend/src/utils/compoundLayout.ts` (current constants):
- `PADDING = 5`
- `LABEL_HEIGHT = 20`
- `DEFAULT_CHILD_HEIGHT = 60`
- `DEFAULT_CHILD_WIDTH = 120`
