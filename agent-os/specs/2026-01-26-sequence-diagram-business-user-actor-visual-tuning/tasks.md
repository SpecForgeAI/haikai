# Task Breakdown: Sequence Diagram Business User Actor Visual Tuning

## Overview
Total Tasks: 8

This is a small, focused visual-only change affecting 3 numeric values in one file (`SequenceDiagramRenderer.tsx`). The changes reduce the horizontal footprint of stickman figures and increase spacing between the stickman graphic and participant label text.

## Task List

### Frontend Visual Adjustment

#### Task Group 1: Stickman Proportion and Text Spacing Adjustments
**Dependencies:** None

- [x] 1.0 Complete stickman visual tuning
  - [x] 1.1 Review current implementation in SequenceDiagramRenderer.tsx
    - Read the `calculateStickManDimensionsForSequence()` function (lines 370-407)
    - Identify the `armSpan` calculation (line ~390): `const armSpan = width * 0.3;`
    - Identify the `legSpan` calculation (line ~394): `const legSpan = width * 0.2;`
    - Locate the `textStartY` calculation in `ParticipantHeader` component (line ~465): `const textStartY = dims.legEndY + 8;`
  - [x] 1.2 Change arm span factor from 0.3 to 0.1
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Location: `calculateStickManDimensionsForSequence()` function
    - Change: `const armSpan = width * 0.3;` to `const armSpan = width * 0.1;`
  - [x] 1.3 Change leg span factor from 0.2 to 0.1
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Location: `calculateStickManDimensionsForSequence()` function
    - Change: `const legSpan = width * 0.2;` to `const legSpan = width * 0.1;`
  - [x] 1.4 Change text gap below stickman from 8 to 15
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Location: `ParticipantHeader` component
    - Change: `const textStartY = dims.legEndY + 8;` to `const textStartY = dims.legEndY + 15;`

**Acceptance Criteria:**
- Arm span factor is changed from 0.3 to 0.1
- Leg span factor is changed from 0.2 to 0.1
- Text gap below stickman is changed from 8 to 15
- No other code modifications in the file

### Testing & Verification

#### Task Group 2: Visual and Functional Verification
**Dependencies:** Task Group 1

- [x] 2.0 Verify changes and test rendering
  - [x] 2.1 Verify code changes are correct
    - Confirm `armSpan = width * 0.1` in `calculateStickManDimensionsForSequence()`
    - Confirm `legSpan = width * 0.1` in `calculateStickManDimensionsForSequence()`
    - Confirm `textStartY = dims.legEndY + 15` in `ParticipantHeader`
    - Ensure no unintended changes to surrounding code
  - [x] 2.2 Run frontend build to verify no compilation errors
    - Execute build command in frontend directory
    - Verify TypeScript compilation succeeds for SequenceDiagramRenderer.tsx
    - Note: Pre-existing errors in other files do not affect this change
  - [x] 2.3 Visual verification of BusinessUser stickman rendering (document expected behavior)
    - Expected: Stickman arms appear narrower (10% width factor vs previous 30%)
    - Expected: Stickman legs appear narrower (10% width factor vs previous 20%)
    - Expected: Increased gap (15px vs previous 8px) between stickman and label text
  - [x] 2.4 Non-regression verification (document expected behavior)
    - Expected: Non-BusinessUser participants (UI/Service/DB boxes) render unchanged
    - Expected: Lifeline positions are unchanged
    - Expected: Message arrows connect correctly
    - Expected: Fragment frames render correctly

**Acceptance Criteria:**
- Frontend builds successfully without errors (for SequenceDiagramRenderer.tsx)
- BusinessUser stickmen appear visibly narrower than before
- Clear visual gap (15px) exists between stickman and label text
- All other sequence diagram elements render identically to before
- Existing sequence diagrams render without breakage

## Execution Order

Recommended implementation sequence:
1. Frontend Visual Adjustment (Task Group 1)
2. Testing & Verification (Task Group 2)

## Summary of Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Arm span factor | `calculateStickManDimensionsForSequence()` | `width * 0.3` | `width * 0.1` |
| Leg span factor | `calculateStickManDimensionsForSequence()` | `width * 0.2` | `width * 0.1` |
| Text gap below stickman | `ParticipantHeader` component | `dims.legEndY + 8` | `dims.legEndY + 15` |

## Files Modified

- `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` (3 numeric value changes)
