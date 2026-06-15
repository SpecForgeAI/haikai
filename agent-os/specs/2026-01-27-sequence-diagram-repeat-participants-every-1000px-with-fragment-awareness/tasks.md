# Task Breakdown: Sequence Diagram Repeat Participants Every 1000px with Fragment Awareness

## Overview
Total Tasks: 3 Task Groups, ~24 sub-tasks

## Task List

### Layout Engine

#### Task Group 1: Layout Engine -- Redraw Position Computation and Y-Shift
**Dependencies:** None

- [x] 1.0 Complete layout engine changes in `frontend/src/utils/sequenceLayout.ts`
  - [x] 1.1 Write 6 focused tests for layout engine redraw computation
    - Test 1: Diagram shorter than 1000px returns empty `participantRedrawYPositions`
    - Test 2: Diagram ~2000px tall produces exactly one redraw position
    - Test 3: Diagram ~3500px tall produces multiple redraw positions at correct intervals
    - Test 4: Redraw deferred when threshold is exceeded inside a fragment -- redraw appears after fragment closes
    - Test 5: Nested fragments -- redraw deferred until outermost fragment closes, not inner
    - Test 6: All message/fragment Y positions after a redraw are shifted down by cumulative inserted space
  - [x] 1.2 Add `PARTICIPANT_REDRAW_THRESHOLD` constant
    - Add `PARTICIPANT_REDRAW_THRESHOLD: 1000` to `LAYOUT_CONSTANTS`
  - [x] 1.3 Extend `SequenceLayoutResult` interface
    - Add field `participantRedrawYPositions: number[]`
    - Initialize to empty array in `computeSequenceLayout` return value
  - [x] 1.4 Implement first pass: compute raw redraw positions after DFS traversal
    - Walk `messageLayouts` sorted by `rowIndex`
    - Track `lastRedrawY` initialized to `topMargin`
    - At each message, check if `messageY - lastRedrawY >= PARTICIPANT_REDRAW_THRESHOLD`
    - If threshold exceeded and not inside any fragment, record redraw at `messageY - rowHeight/2`
    - If threshold exceeded and inside a fragment, set `redrawPending = true`
    - Use `fragmentRowExtents` to determine if current row is inside any fragment
    - Track `fragmentDepth` or scan extents to find outermost open fragment
    - When outermost fragment closes and `redrawPending`, record redraw after fragment's `bottomY`
    - Update `lastRedrawY` on each recorded redraw
  - [x] 1.5 Implement second pass: shift all Y coordinates below each redraw insertion point
    - Compute insertion height as `headerAreaHeight + 20` per redraw
    - Iterate redraw positions in order; for each, shift all `messageLayouts[].y`, `fragmentLayouts[].topY`/`bottomY`, and `lifelineBottomY` that fall below the insertion point
    - Update `participantRedrawYPositions` entries to their post-adjustment values
    - Update cumulative offset tracker for each subsequent redraw
  - [x] 1.6 Ensure layout engine tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify empty array for short diagrams
    - Verify correct positions and Y-shifts for tall diagrams
    - Verify fragment deferral logic

**Acceptance Criteria:**
- The 6 tests from 1.1 pass
- `participantRedrawYPositions` is empty for diagrams under 1000px
- Redraw positions are correctly computed at ~1000px intervals
- Redraws are never placed inside a fragment
- Nested fragment deferral works (waits for outermost close)
- All Y coordinates after a redraw are shifted by the correct cumulative amount
- `lifelineBottomY` reflects total inserted space

---

### Renderer

#### Task Group 2: Renderer -- Redrawn Headers, Lifeline Segmentation, Height Adjustment
**Dependencies:** Task Group 1

- [x] 2.0 Complete renderer changes in `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
  - [x] 2.1 Write 6 focused tests for renderer redraw rendering
    - Test 1: No extra `ParticipantHeader` components rendered when `participantRedrawYPositions` is empty
    - Test 2: One redraw position produces a full set of participant headers at the redraw Y
    - Test 3: Redrawn headers have correct unique keys incorporating redraw index
    - Test 4: Lifeline is segmented into correct intervals (gap at each redraw header)
    - Test 5: Lifeline segments do not overlap with redrawn header bounding boxes
    - Test 6: SVG total height accounts for all inserted vertical space
  - [x] 2.2 Render additional ParticipantHeader components at each redraw Y position
    - After original header rendering block (~line 1277), iterate `layout.participantRedrawYPositions`
    - For each redraw Y and each participant, render `ParticipantHeader` with `layout.y` overridden to redraw Y
    - Use key format incorporating redraw index (e.g., `participant-redraw-${redrawIndex}-${participantId}`)
    - Redrawn headers use identical props (classification, icon, colour, stickman/box) as originals
  - [x] 2.3 Segment lifelines at redraw points
    - Modify lifeline rendering in `ParticipantHeader` (stickman path ~line 879, box path ~line 950)
    - Instead of single line from `lifelineTopY` to `lifelineBottomY`, compute segments from `participantRedrawYPositions` and `headerAreaHeight`
    - Segments: `[lifelineTopY, firstRedrawY]`, `[firstRedrawY + headerHeight + 20, secondRedrawY]`, ..., `[lastRedrawY + headerHeight + 20, lifelineBottomY]`
    - Render each segment as a separate `<line>` element
    - If `participantRedrawYPositions` is empty, render single line as before (no regression)
  - [x] 2.4 Verify SVG total height adjustment
    - Confirm container sizing uses `lifelineBottomY` from layout result (already shifted in Task Group 1)
    - Verify SVG viewBox or wrapper height expands correctly with inserted space
    - No additional renderer changes should be needed if layout returns correct `lifelineBottomY`
  - [x] 2.5 Ensure renderer tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify no regressions for short diagrams
    - Verify redrawn headers appear at correct positions
    - Verify lifeline segmentation gaps

**Acceptance Criteria:**
- The 6 tests from 2.1 pass
- Redrawn participant headers render identically to originals
- Lifelines are interrupted at each redraw header (gap, no line through header)
- Short diagrams (under 1000px) render with no changes
- SVG height is correct for diagrams with redraws

---

### Testing and Verification

#### Task Group 3: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and fill critical gaps
  - [x] 3.1 Review tests from Task Groups 1 and 2
    - Review the 6 layout engine tests from 1.1
    - Review the 6 renderer tests from 2.1
    - Total existing tests: 12
  - [x] 3.2 Analyze test coverage gaps for this feature
    - Identify untested interactions between layout and renderer
    - Check edge cases: exactly 1000px distance, diagram with only fragments, zero participants
    - Check integration: full render of a tall diagram with fragments and verify visual output
  - [x] 3.3 Write up to 8 additional tests to fill critical gaps
    - Test 1 (integration): Full layout + render of a 2500px diagram produces correct number of redrawn header groups
    - Test 2 (edge case): Threshold crossed exactly at fragment start row -- redraw deferred correctly
    - Test 3 (edge case): Threshold crossed inside a fragment that spans >1000px itself -- single redraw after fragment
    - Test 4 (edge case): Multiple fragments in sequence with threshold exceeded between them -- redraw placed between fragments
    - Test 5 (integration): Self-message exchanges do not break redraw computation
    - Test 6 (regression): Diagram with no fragments behaves identically to simple threshold logic
    - Test 7 (edge case): Fragment closes and redrawPending is true but next message is also inside another fragment -- continue deferring
    - Test 8 (integration): Lifeline segment count equals `participantRedrawYPositions.length + 1` for each participant
  - [x] 3.4 Run all feature-specific tests
    - Run the 12 tests from Task Groups 1-2 plus up to 8 new tests from 3.3
    - Expected total: up to 20 tests
    - Do NOT run the entire application test suite
    - Verify all pass

**Acceptance Criteria:**
- All ~20 feature-specific tests pass
- Critical edge cases covered (fragment boundaries, nested fragments, large fragments)
- Integration between layout engine and renderer verified
- No regressions for short diagrams or diagrams without fragments

---

## Execution Order

1. **Layout Engine** (Task Group 1) -- all computation logic, no rendering dependencies
2. **Renderer** (Task Group 2) -- consumes layout output from Group 1
3. **Test Review and Gap Analysis** (Task Group 3) -- validates end-to-end after both components complete

## Key Files

| File | Role |
|------|------|
| `frontend/src/utils/sequenceLayout.ts` | Layout engine -- constants, interface, redraw computation, Y-shift |
| `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` | Renderer -- redrawn headers, lifeline segmentation |
