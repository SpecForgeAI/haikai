# Spec Requirements: Sequence Diagram Repeat Participants Every 1000px with Fragment Awareness

## Initial Description
Improve readability of very tall Sequence Diagrams by re-drawing participants vertically at regular intervals, without breaking fragment boundaries. The trigger rule checks the Y-position distance from where participants were last drawn, using a 1000px threshold. When inside a fragment, redrawing is deferred until the outermost fragment closes. Participants must never be drawn mid-fragment, and fragment layout/semantics remain unchanged.

## Requirements Discussion

### First Round Questions

**Q1:** Should redrawn participants appear identical to the original headers (same stickman/box, colours, icons), or should they have a visual distinction such as reduced opacity or a subtle border to indicate they are repeats?
**Answer:** Identical to the original headers (same stickman/box, colours, icons). No opacity change.

**Q2:** How should lifelines behave at redraw points -- should they pass through the redrawn header continuously, or should they be interrupted (stop above and resume below)?
**Answer:** Lifelines should be interrupted -- stop above the redrawn header and resume below (no line through header).

**Q3:** When participants are redrawn, does the redraw insert real vertical space (pushing subsequent content down by the header height), or does it overlay on top of existing content?
**Answer:** Yes, redraws insert real vertical space (header height) and push subsequent content down. No overlay.

**Q4:** Should the 1000px threshold be a hard-coded constant or user-configurable?
**Answer:** Hard-coded constant for now (not user-configurable).

**Q5:** For nested fragments, should the redraw wait until the outermost fragment closes, or can it happen between the close of an inner fragment and the close of the outer one?
**Answer:** Wait until the outermost open fragment closes before redrawing.

**Q6:** Where should the redraw logic live -- in the layout engine (computeSequenceLayout) returning redraw Y positions, or in the renderer?
**Answer:** Put it in the layout engine (computeSequenceLayout) and return redraw Y positions; renderer just draws.

**Q7:** Are there any explicit exclusions -- for example, should there be a user-facing toggle, or any changes to fragment rendering/semantics, or export/print-specific behavior?
**Answer:** No user-facing toggle/settings. No changes to fragment rendering/semantics. No export/print-specific behavior changes.

### Existing Code to Reference

No similar existing features identified for reference. The layout engine `computeSequenceLayout` and the `SequenceDiagramRenderer` component are the primary touchpoints for this feature.

### Follow-up Questions
None required -- answers were comprehensive.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Re-draw all participant headers at regular vertical intervals (~every 1000px) in tall sequence diagrams
- Redrawn headers are visually identical to the original participant headers (same stickman/box, colours, icons)
- Lifelines are segmented -- interrupted at each redraw header (stop above, resume below)
- Each redraw inserts real vertical space equal to header height, pushing all subsequent content down
- Redrawing is deferred when inside a fragment; it waits until the outermost open fragment closes
- Participants are never drawn mid-fragment; fragment layout and semantics remain unchanged
- Applies to all message types (normal, self-loop, etc.)

### Key Architectural Decisions
- Layout engine (`computeSequenceLayout`) computes a `participantRedrawYPositions` array as part of its output
- Renderer consumes these positions and draws headers at them -- no redraw logic in the renderer
- Each redraw inserts real vertical space (~header height), shifting subsequent messages down
- Lifelines are segmented into intervals between original header and each redraw point
- Nested fragment rule: threshold is exceeded inside nested fragments, but redraw waits for outermost fragment to close
- 1000px threshold is a hard-coded constant (not user-configurable)

### Reusability Opportunities
- Existing participant header rendering logic can be reused directly for redrawn headers
- Existing lifeline rendering can be adapted to support segmented drawing

### Scope Boundaries
**In Scope:**
- Layout engine changes to compute redraw Y positions with fragment awareness
- Renderer changes to draw participant headers at computed redraw positions
- Lifeline segmentation at redraw points
- Vertical space insertion for each redraw

**Out of Scope:**
- User-facing toggle or configuration for the feature
- Changes to fragment rendering or semantics
- Export/print-specific behavior changes
- Configurable threshold value (future enhancement)
- Sticky/floating participant headers

### Technical Considerations
- Scope is frontend only
- Primary touchpoints: `computeSequenceLayout` (layout engine) and `SequenceDiagramRenderer` (renderer)
- The layout engine must track fragment nesting depth to determine when redraw is safe
- Total diagram height will increase with each redraw insertion (e.g., a 2500px diagram becomes taller by N * headerHeight where N is the number of redraws)
