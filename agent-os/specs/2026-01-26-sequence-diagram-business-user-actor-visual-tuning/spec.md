# Spec: Sequence Diagram Business User Actor Visual Tuning

## Overview

This specification defines visual rendering adjustments for Business User actors (stickmen) in Sequence Diagrams. The goal is to improve visual clarity by reducing the horizontal footprint of stickman figures and increasing spacing between the stickman graphic and the participant label text.

## Motivation

Business User participants in sequence diagrams are rendered as stickman figures. The current proportions result in stickmen that are horizontally wide relative to their utility, making them visually dominant compared to system participants (UI/Service/DB boxes). Additionally, the label text sits too close to the bottom of the stickman legs, reducing readability.

## Scope

- **Type**: Visual rendering adjustment
- **Component**: Frontend only
- **Diagram Type**: Sequence Diagrams
- **Participant Type**: BusinessUser (stickman actors)

## Constraints

- No changes to diagram data model
- No changes to participant semantics or types
- No changes to system participants (UI/Service/DB boxes) - these continue to render as rectangular headers
- No user-configurable settings introduced
- Deterministic rendering across all sequence diagrams
- No changes to lifeline positioning
- No changes to participant header width or column layout
- No changes to message routing, fragments, or interactions
- No modification to rendering of non-BusinessUser participants

## Technical Context

### Affected File

**File**: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

**Function**: `calculateStickManDimensionsForSequence()` (lines 370-407)

This function calculates the proportions of BusinessUser stickman figures for sequence diagram rendering. It is called only when rendering BusinessUser participants.

### Current Implementation

```typescript
function calculateStickManDimensionsForSequence(
  x: number,
  y: number,
  width: number,
  height: number
): StickManDimensions {
  const centerX = x + width / 2;
  const topY = y;
  const figureHeight = height;

  // Head is 20% of total height (radius is 10%)
  const headRadius = figureHeight * 0.1;
  const headCenterY = topY + headRadius;

  // Body starts after head and is 40% of height
  const bodyStartY = headCenterY + headRadius;
  const bodyEndY = topY + figureHeight * 0.6;

  // Arms positioned at 20% down the body
  const armY = bodyStartY + (bodyEndY - bodyStartY) * 0.2;
  const armSpan = width * 0.3;  // <-- CHANGE REQUIRED

  // Legs are 40% of height
  const legEndY = topY + figureHeight;
  const legSpan = width * 0.2;  // <-- CHANGE REQUIRED

  return {
    centerX,
    headRadius,
    headCenterY,
    bodyStartY,
    bodyEndY,
    armY,
    armSpan,
    legEndY,
    legSpan,
  };
}
```

The label text Y-position is calculated in the `ParticipantHeader` component (line 465):

```typescript
const textStartY = dims.legEndY + 8; // <-- CHANGE REQUIRED
```

## Required Changes

### Change 1: Reduce Arm Span Factor

**Location**: `calculateStickManDimensionsForSequence()` function, line 390

**Current**: `const armSpan = width * 0.3;`

**Required**: `const armSpan = width * 0.1;`

**Rationale**: Reducing the arm span from 30% to 10% of the participant width creates a narrower stickman figure that is less visually dominant.

### Change 2: Reduce Leg Span Factor

**Location**: `calculateStickManDimensionsForSequence()` function, line 394

**Current**: `const legSpan = width * 0.2;`

**Required**: `const legSpan = width * 0.1;`

**Rationale**: Reducing the leg span from 20% to 10% of the participant width maintains visual consistency with the narrower arm span.

### Change 3: Increase Text Spacing Below Stickman

**Location**: `ParticipantHeader` component within `SequenceDiagramRenderer.tsx`, line 465

**Current**: `const textStartY = dims.legEndY + 8;`

**Required**: `const textStartY = dims.legEndY + 15;`

**Rationale**: Increasing the gap from 8px to 15px creates clearer visual separation between the stickman graphic and the participant label text.

## Visual Impact

### Before Changes
- Stickman arms extend to 30% of participant width on each side (total arm width = 60% of participant width)
- Stickman legs extend to 20% of participant width on each side (total leg spread = 40% of participant width)
- Label text begins 8px below the bottom of the stickman feet

### After Changes
- Stickman arms extend to 10% of participant width on each side (total arm width = 20% of participant width)
- Stickman legs extend to 10% of participant width on each side (total leg spread = 20% of participant width)
- Label text begins 15px below the bottom of the stickman feet

## Implementation Notes

1. **No Data Migration Required**: These are purely rendering-time calculations. No stored data is affected.

2. **No Layout Impact**: The participant header width (`headerBoxWidth` = 150px from `LAYOUT_CONSTANTS`) remains unchanged. Only the visual proportions within that space are adjusted.

3. **Lifeline Position Unchanged**: The lifeline X position is calculated from the participant header center, which is unaffected by stickman proportions.

4. **SVG Elements Affected**: The following SVG elements rendered by `ParticipantHeader` will have different coordinate values:
   - Arms line: `x1` and `x2` coordinates will be closer to `centerX`
   - Left leg line: `x2` coordinate will be closer to `centerX`
   - Right leg line: `x2` coordinate will be closer to `centerX`
   - Text elements: `y` coordinate will start 7px lower than before

## Acceptance Criteria

1. Business User stickmen appear visibly narrower than before (arms and legs at 10% width factor instead of 30%/20%)
2. Business User stickmen appear less visually dominant relative to system participants (rectangular boxes)
3. A clear visual gap (15px) exists between the bottom of the stickman graphic and the participant label text
4. Existing sequence diagrams render without data migration or breakage
5. All other sequence diagram elements (system participants, lifelines, messages, fragments) render identically to before
6. The rendering is deterministic - the same diagram data produces identical visual output

## Non-Goals

- Altering lifeline positioning or behavior
- Altering participant header width or column layout spacing
- Affecting message routing, fragments, or interactions
- Modifying rendering of non-BusinessUser participants (Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class)
- Introducing user-configurable stickman proportions
- Modifying the general-purpose `calculateStickManDimensions()` function in `rendering.ts` (used for non-sequence diagram contexts)

## Testing Considerations

1. **Visual Regression Testing**: Compare rendered output of sequence diagrams containing BusinessUser participants before and after changes
2. **Proportion Verification**: Verify arm span and leg span are calculated correctly with the new 0.1 factors
3. **Text Position Verification**: Verify label text Y position is `legEndY + 15`
4. **Non-Regression**: Verify that:
   - Non-BusinessUser participants render identically
   - Lifeline positions are unchanged
   - Message arrows connect correctly
   - Fragment frames render correctly

## Related Code (Not Modified)

The following related code is NOT modified by this specification:

- `frontend/src/utils/rendering.ts`: Contains `calculateStickManDimensions()` for general diagram contexts (not sequence diagrams)
- `frontend/src/utils/sequenceLayout.ts`: Contains layout constants and computation logic (no rendering)
- `LAYOUT_CONSTANTS` in `sequenceLayout.ts`: `headerBoxWidth`, `headerBoxHeight`, `userHeaderHeight` remain unchanged
