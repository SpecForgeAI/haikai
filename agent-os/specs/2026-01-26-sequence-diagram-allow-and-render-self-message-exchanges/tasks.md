# Task Breakdown: Sequence Diagram Self-Message Exchanges

## Overview
Total Tasks: 15
Scope: Frontend-only

This feature enables users to create message exchanges where the source and target participants are the same (self-messages) and renders them as UML-standard loopback arrows. The implementation spans modal validation changes, SVG rendering, and CSS styling.

## Task List

### Frontend - Modal UX Layer

#### Task Group 1: Add Message Exchange Drawer - Self-Message Support
**Dependencies:** None

- [x] 1.0 Complete modal UX changes for self-message support
  - [x] 1.1 Write 4 focused tests for self-message modal behavior
    - Test: allows selecting same participant for From and To (no validation error)
    - Test: disables "Include Response Message" checkbox when From === To
    - Test: auto-unchecks "Include Response Message" when changing to self-message
    - Test: displays warning text when From === To
  - [x] 1.2 Remove same-participant validation in `validateForm` function
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Remove the validation block that sets error when `fromParticipantId === toParticipantId`
    - Location: around line 240-242 in the `validateForm` function
  - [x] 1.3 Add `isSelfMessage` computed value
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Add `useMemo` hook after form state declarations
    - Returns true when both participant IDs are non-empty and equal
  - [x] 1.4 Add `useEffect` to auto-disable response for self-messages
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - When `isSelfMessage` becomes true and `includeResponse` is checked, set `includeResponse` to false
  - [x] 1.5 Update "Include Response Message" checkbox to use `isSelfMessage`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Add `disabled={isSelfMessage}` prop to the checkbox input
  - [x] 1.6 Add self-message warning text JSX
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Add conditional `<span>` with class `styles.selfMessageWarning` above the checkbox
    - Text: "Source Participant and To Participant are the same"
    - Add `data-testid="self-message-warning"` for testing
  - [x] 1.7 Ensure modal UX tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify validation removal works
    - Verify checkbox disable/enable behavior

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Users can select same participant for From and To without validation error
- "Include Response Message" checkbox is disabled when From === To
- Warning text appears above checkbox when From === To
- Save button remains enabled for valid self-message configurations

### Frontend - CSS Styling Layer

#### Task Group 2: Self-Message Warning Styling
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete CSS styling for self-message warning
  - [x] 2.1 Write 2 focused tests for warning text styling
    - Test: warning text has red color (#d32f2f)
    - Test: warning text has appropriate font size (12px)
  - [x] 2.2 Add `.selfMessageWarning` CSS class
    - File: `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css`
    - Properties: `font-size: 12px`, `color: #d32f2f`, `display: block`, `margin-bottom: 4px`
  - [x] 2.3 Ensure CSS styling tests pass
    - Run ONLY the 2 tests written in 2.1
    - Verify warning text renders with correct styling

**Acceptance Criteria:**
- The 2 tests written in 2.1 pass
- Warning text displays in red (#d32f2f)
- Warning text has 12px font size
- Warning text has 4px bottom margin

### Frontend - SVG Rendering Layer

#### Task Group 3: Self-Message Loopback Arrow Rendering
**Dependencies:** None (can run in parallel with Task Groups 1 and 2)

- [x] 3.0 Complete self-message loopback arrow rendering
  - [x] 3.1 Write 6 focused tests for self-message rendering
    - Test: `isSelfMessage()` returns true when from_participant_id === to_participant_id
    - Test: `isSelfMessage()` returns false when from_participant_id !== to_participant_id
    - Test: self-message renders `SelfMessageArrow` component (check for `.sequence-self-message` class)
    - Test: regular message renders `MessageArrow` component (no `.sequence-self-message` class)
    - Test: loopback arrow path has correct shape (right, down, left pattern)
    - Test: label is positioned above the initial horizontal segment
  - [x] 3.2 Add self-message layout constants
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Add `SELF_MESSAGE_LOOP_WIDTH = 40` constant
    - Add `SELF_MESSAGE_LOOP_HEIGHT = 30` constant
    - Location: after existing message arrow constants (around line 316)
  - [x] 3.3 Add `isSelfMessage()` helper function
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Export function that checks if `from_participant_id === to_participant_id`
    - Location: after `shouldRenderMessage` function (around line 452)
  - [x] 3.4 Create `SelfMessageArrow` component
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Props: `layout: MessageLayout`, `label: string`
    - Render SVG `<g>` with class `sequence-message sequence-self-message`
    - Render loopback `<path>`: right from lifeline, down, back to lifeline
    - Render arrowhead `<path>` pointing left on returning segment
    - Render `<text>` label above initial horizontal segment
    - Use existing `getMessageStrokeStyle()` for stroke styling
    - Use existing `calculateArrowhead()` for arrowhead path
    - Location: after `MessageArrow` component (around line 951)
  - [x] 3.5 Update message rendering logic to use `SelfMessageArrow`
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - In the message rendering map section (around line 1141)
    - Add conditional: if `isSelfMessage(message)`, render `<SelfMessageArrow>`, else render `<MessageArrow>`
  - [x] 3.6 Ensure rendering tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify self-messages render as loopback arrows
    - Verify regular messages continue to render as horizontal arrows

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- Self-messages render as loopback arrows extending right from lifeline
- Loopback arrow has correct shape: right, down, left with arrowhead pointing to lifeline
- Label appears above the initial outgoing horizontal segment
- Regular (non-self) messages continue rendering unchanged

### Testing - Integration and Gap Analysis

#### Task Group 4: Test Review and Integration Testing
**Dependencies:** Task Groups 1, 2, 3 (all completed)

Tests already created:
- Task Group 1: 12 tests in AddMessageExchangeDrawer.selfMessage.test.tsx
- Task Group 2: 4 tests in selfMessageWarning.styling.test.tsx
- Task Group 3: 15 tests in SequenceDiagramRenderer.selfMessage.test.tsx

- [x] 4.0 Review existing tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 12 tests from Task Group 1 (modal UX)
    - Review the 4 tests from Task Group 2 (CSS styling)
    - Review the 15 tests from Task Group 3 (rendering)
    - Total existing tests: 31 tests
  - [x] 4.2 Analyze test coverage gaps for self-message feature
    - Identify any critical user workflows lacking coverage
    - Focus on integration points between modal and renderer
    - Focus on backward compatibility with existing diagrams
  - [x] 4.3 Write up to 6 additional integration tests if needed
    - Test: end-to-end flow - create self-message via drawer, verify renders as loopback
    - Test: mixed diagram with regular and self-messages renders correctly
    - Test: re-enabling response checkbox when changing from self-message to regular message
    - Test: existing diagrams without self-messages render unchanged (backward compatibility)
    - Test: self-message with label renders label in correct position
    - Test: form submission creates message with matching from/to participant IDs
  - [x] 4.4 Run all feature-specific tests
    - Run all self-message related tests
    - Verify all pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 12-18 tests total)
- End-to-end workflow from modal to diagram rendering is covered
- Backward compatibility with existing diagrams is verified
- No regressions in regular message rendering

**Implementation Notes (Task Group 4):**
- Reviewed all 31 existing tests from Task Groups 1-3
- Created 9 additional integration tests in `SequenceDiagramSelfMessage.integration.test.tsx`
- Total tests for self-message feature: 40 tests (all passing)
- Integration tests cover:
  1. Mixed diagram with regular and self-messages (2 tests)
  2. Re-enabling response checkbox when changing from self-message to regular (1 test)
  3. Backward compatibility with existing diagrams (2 tests)
  4. Form submission creates message with matching from/to participant IDs (2 tests)
  5. Self-message with label renders correctly (1 test)
  6. Full end-to-end workflow (1 test)

## Execution Order

Recommended implementation sequence:

**Phase 1 (Parallel):**
- Task Group 1: Modal UX Layer (can start immediately)
- Task Group 2: CSS Styling Layer (can start immediately)
- Task Group 3: SVG Rendering Layer (can start immediately)

**Phase 2 (Sequential):**
- Task Group 4: Integration Testing (requires Groups 1-3 complete)

## File Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx` | 1 | Remove validation, add isSelfMessage, disable response checkbox, add warning text |
| `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css` | 2 | Add .selfMessageWarning CSS class |
| `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` | 3 | Add constants, isSelfMessage helper, SelfMessageArrow component, update rendering logic |
| `frontend/src/__tests__/AddMessageExchangeDrawer.selfMessage.test.tsx` | 1, 4 | New test file for modal self-message tests |
| `frontend/src/__tests__/selfMessageWarning.styling.test.tsx` | 2, 4 | New test file for CSS styling tests |
| `frontend/src/__tests__/SequenceDiagramRenderer.selfMessage.test.tsx` | 3, 4 | New test file for rendering self-message tests |
| `frontend/src/__tests__/SequenceDiagramSelfMessage.integration.test.tsx` | 4 | New test file for integration tests |

## Notes

- **No backend changes required** - the data model already supports self-messages
- **No migration required** - existing diagrams are unaffected
- **Layout code unchanged** - `sequenceLayout.ts` already handles same from/to correctly
- All three implementation task groups can be developed in parallel by different engineers
