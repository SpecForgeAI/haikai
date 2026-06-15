# Task Breakdown: Diagram View Enhancements

## Overview

Total Tasks: 5 Task Groups, 32 Sub-tasks

This spec implements four enhancements to the Diagrams view:
1. Text alignment fields with 5px padding
2. Text wrapping with word breaks and 5px line spacing
3. Edge rendering using only edge_points (no auto node-center lines)
4. Zoom controls relocated to header bar

## Task List

---

### Type Definitions & Data Layer

#### Task Group 1: Schema Updates and Data Parsing
**Dependencies:** None
**Effort:** S (Small)

- [x] 1.0 Complete schema and data parsing updates
  - [ ] 1.1 Write 3 focused tests for type definitions and parsing
    - Test that DiagramNode accepts valid text_h_align values ('LEFT', 'CENTER', 'RIGHT')
    - Test that DiagramNode accepts valid text_v_align values ('TOP', 'MIDDLE', 'BOTTOM')
    - Test that parsing handles missing alignment fields with defaults
  - [x] 1.2 Update DiagramNode interface in model.ts
    - **File:** `frontend/src/types/model.ts`
    - Add `text_h_align?: 'LEFT' | 'CENTER' | 'RIGHT'`
    - Add `text_v_align?: 'TOP' | 'MIDDLE' | 'BOTTOM'`
  - [x] 1.3 Update fileOperations.ts to parse alignment fields
    - **File:** `frontend/src/utils/fileOperations.ts`
    - Parse `text_h_align` and `text_v_align` from JSON
    - Apply defaults: `'CENTER'` for horizontal, `'MIDDLE'` for vertical
  - [x] 1.4 Update sample-architecture.json with examples
    - **File:** `frontend/public/sample-architecture.json`
    - Add text alignment fields to 2-3 nodes demonstrating feature
    - Include at least one LEFT/TOP, one CENTER/MIDDLE, one RIGHT/BOTTOM
  - [x] 1.5 Run type definition and parsing tests
    - Run only the 3 tests from 1.1
    - Verify TypeScript compiles without errors
    - Verify JSON parsing works correctly

**Acceptance Criteria:**
- TypeScript interface updated with alignment fields
- JSON parsing extracts alignment values correctly
- Default values applied when fields missing
- Sample data demonstrates all alignment options
- 3 tests pass

---

### Rendering Utilities

#### Task Group 2: Text Wrapping and Measurement Utilities
**Dependencies:** Task Group 1
**Effort:** M (Medium)

- [x] 2.0 Complete text wrapping and measurement utilities
  - [ ] 2.1 Write 4 focused tests for text utilities
    - Test wrapText splits text at word boundaries correctly
    - Test wrapText breaks long words mid-token when necessary
    - Test measureTextWidth returns accurate pixel widths
    - Test calculateTextBlockHeight accounts for line spacing
  - [x] 2.2 Create text measurement utility function
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `measureTextWidth(text: string, fontSize: number): number`
    - Use canvas context or SVG text measurement
  - [x] 2.3 Implement wrapText utility function
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `wrapText(text: string, maxWidth: number, fontSize: number): string[]`
    - Break at word boundaries (spaces, hyphens)
    - Break mid-word if single word exceeds maxWidth
    - Return array of lines
  - [x] 2.4 Implement calculateTextBlockHeight function
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `calculateTextBlockHeight(lineCount: number, fontSize: number, lineSpacing: number): number`
    - Formula: `(lineCount * fontSize) + ((lineCount - 1) * lineSpacing)`
  - [x] 2.5 Add text positioning calculation utilities
    - **File:** `frontend/src/utils/rendering.ts`
    - Add `calculateTextPosition(node: DiagramNode, textBlockHeight: number): { startX: number, startY: number, anchor: string }`
    - Apply 5px padding constant
    - Handle all 9 alignment combinations
  - [x] 2.6 Run text utility tests
    - Run only the 4 tests from 2.1
    - Verify text wrapping handles edge cases
    - Do NOT run entire test suite

**Acceptance Criteria:**
- Text wrapping correctly breaks at word boundaries
- Long words break mid-token when necessary
- Text block height calculated with 5px line spacing
- Position calculations respect 5px padding on all sides
- All 9 alignment combinations produce correct positions
- 4 tests pass

---

### Canvas Rendering

#### Task Group 3: Node Text and Edge Rendering Updates
**Dependencies:** Task Group 2
**Effort:** L (Large)

- [x] 3.0 Complete canvas rendering updates
  - [ ] 3.1 Write 6 focused tests for canvas rendering
    - Test node text renders with 5px padding on all sides
    - Test wrapped text has 5px spacing between lines
    - Test horizontal alignment positions text correctly (LEFT/CENTER/RIGHT)
    - Test vertical alignment positions text correctly (TOP/MIDDLE/BOTTOM)
    - Test edge renders only edge_points segments (no node-center lines)
    - Test arrow tip positioned exactly at final edge_point
  - [x] 3.2 Refactor node text rendering in Canvas.tsx
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Replace existing text rendering with new algorithm
    - Use wrapText utility from rendering.ts
    - Apply 5px padding constant (not configurable)
  - [x] 3.3 Implement horizontal text alignment
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - LEFT: anchor='start', x = pos_x + 5
    - CENTER: anchor='middle', x = pos_x + width/2
    - RIGHT: anchor='end', x = pos_x + width - 5
    - Default to CENTER when text_h_align undefined
  - [x] 3.4 Implement vertical text alignment
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - TOP: startY = pos_y + 5 + fontSize
    - MIDDLE: startY = centered within height - 10
    - BOTTOM: startY = pos_y + height - 5 - blockHeight + fontSize
    - Default to MIDDLE when text_v_align undefined
  - [x] 3.5 Implement multi-line text rendering with spacing
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Render each line from wrapText result
    - Apply 5px vertical gap between consecutive lines
    - Maintain horizontal alignment per line
  - [x] 3.6 Update getEdgePoints to remove node-center logic
    - **File:** `frontend/src/utils/rendering.ts`
    - Remove any code that adds node center coordinates
    - Return only the edge_points from the edge data
    - Sort by sequence_order
  - [x] 3.7 Update edge rendering to use only edge_points
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Build SVG path from edge_points only
    - M for first point, L for subsequent points
    - Remove any implicit connector segments
  - [x] 3.8 Fix arrow tip positioning
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Arrow tip must be exactly at edge_points[n].pos_x, edge_points[n].pos_y
    - Calculate arrow wing direction from final segment
    - Wings extend back along final segment vector
  - [x] 3.9 Remove bottom-right zoom controls from canvas
    - **File:** `frontend/src/components/DiagramsView/Canvas.tsx`
    - Remove existing zoom widget/overlay from canvas
    - Clean up any associated state management
  - [x] 3.10 Run canvas rendering tests
    - Run only the 6 tests from 3.1
    - Verify visual rendering matches spec requirements
    - Do NOT run entire test suite

**Acceptance Criteria:**
- Node text has 5px padding on all sides
- Text wraps with 5px line spacing
- All horizontal alignment options work correctly
- All vertical alignment options work correctly
- Edges render only edge_points (no node-center lines)
- Arrow tip exactly at final edge_point coordinate
- Bottom-right zoom widget removed
- 6 tests pass

---

### UI Controls

#### Task Group 4: Header Bar Zoom Controls
**Dependencies:** Task Group 3 (requires zoom state access)
**Effort:** M (Medium)

- [x] 4.0 Complete zoom controls relocation
  - [ ] 4.1 Write 4 focused tests for zoom controls
    - Test zoom controls render in header bar (not canvas)
    - Test [+] button increases zoom by increment
    - Test [-] button decreases zoom by increment
    - Test [Fit to View] fits diagram bounds in visible area
  - [x] 4.2 Add zoom controls to DiagramsView header
    - **File:** `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Add controls to right side of header bar
    - Layout: `[+] 100% [-] [Fit to View]`
    - Single line, no wrapping
  - [x] 4.3 Implement zoom in/out buttons
    - **File:** `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - [+] increases zoom by 25% increment
    - [-] decreases zoom by 25% increment
    - Respect min/max zoom bounds
  - [x] 4.4 Implement zoom percentage display
    - **File:** `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Show current zoom level as percentage (e.g., "100%")
    - Update on zoom changes
  - [x] 4.5 Implement calculateDiagramFitZoom utility
    - **File:** `frontend/src/utils/rendering.ts`
    - Calculate bounding box of all diagram nodes
    - Determine zoom level to fit bounds in viewport
    - Return zoom level and pan offset
  - [x] 4.6 Implement Fit to View button
    - **File:** `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Call calculateDiagramFitZoom
    - Apply calculated zoom and pan values
    - Fit entire diagram in visible area
  - [x] 4.7 Style zoom controls for header bar
    - **File:** `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Match existing header bar styling
    - Appropriate spacing between controls
    - Responsive but no wrapping
  - [x] 4.8 Run zoom control tests
    - Run only the 4 tests from 4.1
    - Verify controls function correctly
    - Do NOT run entire test suite

**Acceptance Criteria:**
- Zoom controls appear in header bar (right side)
- Layout matches spec: `[+] 100% [-] [Fit to View]`
- Percentage updates on zoom changes
- [+] and [-] zoom by increments
- Fit to View fits entire diagram in viewport
- Controls stay on single line
- 4 tests pass

---

### Integration & Testing

#### Task Group 5: Test Review and Integration Testing
**Dependencies:** Task Groups 1-4
**Effort:** S (Small)

- [x] 5.0 Review tests and perform integration verification
  - [ ] 5.1 Review tests from Task Groups 1-4
    - Review 3 tests from Task Group 1 (type definitions)
    - Review 4 tests from Task Group 2 (text utilities)
    - Review 6 tests from Task Group 3 (canvas rendering)
    - Review 4 tests from Task Group 4 (zoom controls)
    - Total existing: 17 tests
  - [ ] 5.2 Analyze test coverage gaps for this feature
    - Focus only on diagram view enhancements feature
    - Identify integration gaps between components
    - Check round-trip data persistence
    - Do NOT assess entire application coverage
  - [ ] 5.3 Write up to 8 additional integration tests
    - Test full workflow: load diagram with alignment fields, verify rendering
    - Test round-trip: save diagram with alignments, reload, verify persistence
    - Test edge rendering integration: multiple edge_points polyline
    - Test zoom control state synchronization with canvas
    - Test all 9 alignment combinations render correctly
    - Test default values applied when fields missing
    - Test Fit to View with various diagram sizes
    - Test zoom controls remain visible when canvas scrolled
  - [x] 5.4 Run all feature-specific tests
    - Run tests from 1.1, 2.1, 3.1, 4.1, and 5.3
    - Expected total: approximately 17-25 tests
    - Do NOT run entire application test suite
    - Verify all enhancements work together
  - [x] 5.5 Manual visual verification
    - Load sample-architecture.json with alignment examples
    - Verify wrapped text displays with 5px padding and spacing
    - Verify alignment defaults to center/middle
    - Verify edge rendering uses only edge_points
    - Verify arrow tip at final coordinate
    - Verify zoom controls in header bar

**Acceptance Criteria:**
- All 17-25 feature tests pass
- Round-trip data persistence works
- Visual rendering matches spec requirements
- No regressions in existing diagram functionality
- All four enhancements work together correctly

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Schema Updates and Data Parsing** (S)
   - Foundation for all other work
   - No dependencies

2. **Task Group 2: Text Wrapping and Measurement Utilities** (M)
   - Required for text rendering
   - Depends on type definitions from Group 1

3. **Task Group 3: Node Text and Edge Rendering Updates** (L)
   - Core rendering changes
   - Depends on utilities from Group 2

4. **Task Group 4: Header Bar Zoom Controls** (M)
   - UI control relocation
   - Depends on canvas changes from Group 3

5. **Task Group 5: Test Review and Integration Testing** (S)
   - Final verification
   - Depends on all previous groups

## Effort Summary

| Task Group | Effort | Description |
|------------|--------|-------------|
| 1 | S | Schema and parsing updates |
| 2 | M | Text utility functions |
| 3 | L | Canvas rendering changes |
| 4 | M | Zoom control relocation |
| 5 | S | Integration testing |

**Total Estimated Effort:** M-L (Medium to Large)

## Files to Modify Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/types/model.ts` | 1 | Add alignment type definitions |
| `frontend/src/utils/fileOperations.ts` | 1 | Parse alignment fields |
| `frontend/public/sample-architecture.json` | 1 | Add alignment examples |
| `frontend/src/utils/rendering.ts` | 2, 3, 4 | Text utilities, edge points, fit zoom |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 3 | Text rendering, edge rendering, remove zoom |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 4 | Add header zoom controls |

## Key Constants

These values are fixed for v0.1 (not configurable):

- **Padding:** 5px on all sides
- **Line spacing:** 5px between lines
- **Zoom increment:** 25%
- **Default text_h_align:** 'CENTER'
- **Default text_v_align:** 'MIDDLE'
