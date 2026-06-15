# Specification: Sequence Diagram Repeat Participants Every 1000px with Fragment Awareness

## Goal
Improve readability of tall sequence diagrams by re-drawing participant headers at ~1000px vertical intervals, deferring redraws when inside fragments so that no fragment boundary is visually split.

## User Stories
- As a diagram viewer, I want participant headers to reappear periodically on long diagrams so that I can identify lifelines without scrolling back to the top.
- As a diagram viewer, I want fragment frames to remain visually intact so that control-flow semantics are never obscured by a participant redraw.

## Specific Requirements

**PARTICIPANT_REDRAW_THRESHOLD constant**
- Add a hard-coded constant `PARTICIPANT_REDRAW_THRESHOLD = 1000` (pixels) to `LAYOUT_CONSTANTS` in `frontend/src/utils/sequenceLayout.ts`
- This value is not user-configurable

**participantRedrawYPositions array in layout result**
- Add a new field `participantRedrawYPositions: number[]` to the `SequenceLayoutResult` interface in `frontend/src/utils/sequenceLayout.ts` (line ~158)
- Each entry is the Y coordinate where a full set of participant headers should be redrawn
- The array is empty for diagrams shorter than the threshold

**Layout engine: redraw position computation**
- Compute redraw positions inside `computeSequenceLayout` after the DFS traversal completes (after Step 4, line ~380)
- Walk through `messageLayouts` (sorted by `rowIndex`) and track `lastRedrawY` (initialized to `topMargin`, the Y of the original headers)
- At each message Y, check: `messageY - lastRedrawY >= PARTICIPANT_REDRAW_THRESHOLD`
- If threshold exceeded AND the message is not inside any open fragment, record a redraw at `messageY - rowHeight/2` (insert redraw between rows)
- If threshold exceeded AND the message is inside a fragment, set a `redrawPending` flag; when the outermost fragment closes (i.e., the next message Y is past that fragment's `bottomY`), record the redraw at that post-fragment Y position
- To determine "inside a fragment": compare each message's rowIndex against `fragmentRowExtents` entries; a message is inside a fragment if any fragment's `startRow <= rowIndex <= endRow`
- For nested fragments, only the outermost open fragment matters; defer until the outermost closes

**Vertical space insertion for each redraw**
- Each redraw inserts vertical space equal to `headerAreaHeight + 20` pixels (header height plus spacing gap)
- All message Y positions, fragment topY/bottomY, and lifelineBottomY values occurring after a redraw must be shifted downward by the cumulative inserted space
- This means a second pass is needed: after determining redraw positions, re-adjust all layout Y coordinates that fall below each redraw insertion point
- The `participantRedrawYPositions` values themselves are post-adjustment Y coordinates

**Fragment awareness: nested fragment rule**
- Track a `fragmentDepth` counter or use `fragmentRowExtents` to determine whether the current row is inside any fragment
- When depth > 0 (inside any fragment), never insert a redraw
- When the outermost fragment ends (depth returns to 0) and `redrawPending` is true, insert the redraw immediately after that fragment's adjusted bottomY

**Renderer: draw participant headers at redraw positions**
- In `SequenceDiagramRenderer.tsx`, after rendering the original participant headers (~line 1277), iterate over `layout.participantRedrawYPositions`
- For each redraw Y, render a full set of `ParticipantHeader` components with `layout.y` overridden to the redraw Y value
- Redrawn headers are visually identical to originals (same stickman/box, colours, icons, classification)
- Each redrawn header group should use a unique key incorporating the redraw index

**Renderer: segment lifelines at redraw points**
- Currently `ParticipantHeader` draws a single lifeline from `lifelineTopY` to `lifelineBottomY` (line ~879 for stickman, line ~950 for box)
- Change lifeline rendering so that instead of one continuous line, it draws multiple segments
- Segments: `[lifelineTopY, firstRedrawY]`, `[firstRedrawY + headerHeight, secondRedrawY]`, ..., `[lastRedrawY + headerHeight, lifelineBottomY]`
- The layout result should include a new field `lifelineSegments: Array<{topY: number; bottomY: number}>` or the renderer can compute segments from `participantRedrawYPositions` and `headerAreaHeight`
- Lifelines must not pass through any redrawn header box

**Total diagram height adjustment**
- `lifelineBottomY` must account for all inserted vertical space from redraws
- The SVG viewBox or container sizing in the parent component will naturally expand since it uses `lifelineBottomY`

## Visual Design
No visual mockups provided. Redrawn headers are identical copies of the original top-of-diagram headers, placed at the computed Y positions. Lifelines are interrupted (gap) at each redraw header.

## Existing Code to Leverage

**`computeSequenceLayout` in `frontend/src/utils/sequenceLayout.ts`**
- Pure layout function that returns `SequenceLayoutResult`; all new computation should be added here
- DFS traversal (line 314-377) already computes `fragmentRowExtents` which maps fragmentId to `{startRow, endRow}` -- reuse this to determine fragment boundaries
- `messageLayouts` array is already sorted by DFS order (rowIndex); walk this to find threshold crossings
- `LAYOUT_CONSTANTS.headerBoxHeight` (50), `userHeaderHeight` (70), `rowHeight` (60) are needed for space insertion math

**`ParticipantHeader` component in `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`**
- Renders a single participant (box or stickman) with lifeline (lines 775-960)
- Already accepts `layout`, `lifelineTopY`, `lifelineBottomY` as props; lifeline segmentation can be achieved by passing segment arrays instead of single top/bottom values
- Classification, icon, and colour logic is already encapsulated and will work identically for redrawn headers

**`SequenceLayoutResult` interface in `frontend/src/utils/sequenceLayout.ts`**
- Extend with `participantRedrawYPositions: number[]` to communicate redraw positions from layout to renderer
- Optionally extend with `lifelineSegments` if segment computation is done in layout rather than renderer

**Fragment layout computation (lines 396-425 in `sequenceLayout.ts`)**
- Fragment `topY` and `bottomY` are computed from row extents; these will need to be adjusted in the second pass when vertical space is inserted
- Fragment extents are already stored in `dfsContext.fragmentRowExtents` for reuse during redraw computation

## Out of Scope
- User-facing toggle or setting to enable/disable participant redraws
- Configurable threshold value (always 1000px)
- Sticky or floating participant headers (redraws are static SVG elements)
- Any changes to fragment rendering, semantics, or visual appearance
- Any changes to message ordering, spacing rules, or arrow rendering
- Export or print-specific behavior changes
- Backend or API changes (this is frontend-only)
- Horizontal scrolling or participant pinning
- Animated transitions when redraws appear
- Changes to the sequence diagram editor or data model
