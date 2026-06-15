# Task Breakdown: Force RHS Team Chat Scroll to Bottom

## Overview
Total Tasks: 12

This feature ensures the Right-Hand Side (RHS) "Team Chat" panel on the Implement screen unconditionally auto-scrolls to the bottom whenever new messages arrive, including during streaming updates.

## Task List

### Component Modification Layer

#### Task Group 1: ChatMessageList Scroll Bypass
**Dependencies:** None

- [x] 1.0 Complete ChatMessageList scroll behavior bypass
  - [x] 1.1 Write 2-4 focused tests for ChatMessageList disableAutoScroll prop
    - Test that when `disableAutoScroll={true}`, no scroll event handlers are attached
    - Test that when `disableAutoScroll={true}`, useEffect scroll logic is skipped
    - Test that when `disableAutoScroll={false}` or undefined, existing scroll behavior is preserved
    - Test that `userHasScrolledUp` state is not tracked when disabled
  - [x] 1.2 Add `disableAutoScroll?: boolean` prop to ChatMessageListProps interface
    - Add optional boolean prop to the existing TypeScript interface
    - Default behavior (undefined/false) preserves current scroll logic
  - [x] 1.3 Guard useEffect scroll logic with disableAutoScroll check
    - Wrap the useEffect that sets `containerRef.current.scrollTop` with prop check
    - When `disableAutoScroll` is true, return early from the effect
    - Preserve original code path for when prop is false/undefined
  - [x] 1.4 Guard scroll event handler attachment with disableAutoScroll check
    - Conditionally attach `handleScroll` callback based on prop
    - Skip `userHasScrolledUp` state tracking when disabled
    - Preserve near-bottom detection logic for other contexts
  - [x] 1.5 Ensure ChatMessageList tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify that disableAutoScroll prop works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- ChatMessageList accepts `disableAutoScroll` prop
- When `disableAutoScroll={true}`, no scroll operations occur within ChatMessageList
- When `disableAutoScroll={false}` or undefined, original scroll behavior is unchanged
- Existing usages of ChatMessageList without the prop continue to work

---

#### Task Group 2: ImplementationAssistantPanel Scroll Control
**Dependencies:** Task Group 1

- [x] 2.0 Complete ImplementationAssistantPanel scroll implementation
  - [x] 2.1 Write 3-5 focused tests for ImplementationAssistantPanel scroll behavior
    - Test that `messagesContainerRef` is attached to the `.messagesContainer` div
    - Test that scroll-to-bottom triggers on every `messages` array change
    - Test that scroll-to-bottom triggers during streaming message deltas
    - Test that scroll is unconditional (does not check near-bottom position)
    - Test that only `messagesContainerRef.current.scrollTop` is modified (no window/document scroll)
  - [x] 2.2 Add messagesContainerRef to ImplementationAssistantPanel
    - Create `messagesContainerRef` using `useRef<HTMLDivElement>(null)`
    - Attach ref to the `div.messagesContainer` element (line ~1830 in JSX)
    - Ensure ref targets the element with `overflow: auto` that owns the scrollbar
  - [x] 2.3 Implement unconditional scroll-to-bottom useEffect
    - Add useEffect hook with `messages` array as dependency
    - Use `requestAnimationFrame` wrapper for reliable DOM timing
    - Set `messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight`
    - No near-bottom checks or user-scroll detection
    - Guard against null ref (check `messagesContainerRef.current` exists)
  - [x] 2.4 Pass disableAutoScroll prop to ChatMessageList
    - Add `disableAutoScroll={true}` to the ChatMessageList component props
    - This transfers scroll ownership from ChatMessageList to ImplementationAssistantPanel
    - ChatMessageList no longer attempts any scrolling in this context
  - [x] 2.5 Ensure ImplementationAssistantPanel tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify scroll triggers on message changes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- `messagesContainerRef` is correctly attached to `.messagesContainer` div
- Every message change (including streaming deltas) triggers scroll-to-bottom
- Scroll is unconditional - always scrolls regardless of user position
- Only the `messagesContainerRef` element is scrolled (no window/document effects)
- `disableAutoScroll={true}` is passed to ChatMessageList

---

### Testing Layer

#### Task Group 3: Test Review and Integration Verification
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Review existing tests and verify integration
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 2-4 tests written for ChatMessageList (Task 1.1)
    - Review the 3-5 tests written for ImplementationAssistantPanel (Task 2.1)
    - Total existing tests: approximately 5-9 tests
  - [x] 3.2 Analyze test coverage gaps for this feature only
    - Identify any critical scroll behavior scenarios not covered
    - Focus ONLY on gaps related to RHS Team Chat scroll requirements
    - Prioritize edge cases: rapid message streaming, empty to non-empty transitions
  - [x] 3.3 Write up to 4 additional strategic tests if needed
    - Test rapid sequential message additions (streaming simulation)
    - Test scroll behavior when container initially renders
    - Test that scrollIntoView() is not used anywhere
    - Test that window/document scroll is never affected
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 9-13 tests maximum
    - Verify all scroll scenarios work correctly
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 9-13 tests total)
- Scroll behavior verified for normal and streaming message scenarios
- No regressions in ChatMessageList behavior for other contexts
- Integration between ChatMessageList and ImplementationAssistantPanel works correctly

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: ChatMessageList Scroll Bypass** - Modify ChatMessageList to accept `disableAutoScroll` prop and bypass internal scroll logic when enabled. This must be completed first as Task Group 2 depends on this prop.

2. **Task Group 2: ImplementationAssistantPanel Scroll Control** - Add ref to scroll container, implement unconditional scroll-to-bottom effect, and pass `disableAutoScroll={true}` to ChatMessageList.

3. **Task Group 3: Test Review and Integration Verification** - Review all tests from previous groups, identify gaps, add strategic tests, and verify complete integration.

---

## Key Implementation Notes

### Scroll Behavior Rules
- **Unconditional scroll**: No near-bottom checks - always scroll to bottom
- **Every message triggers scroll**: Including streamed deltas
- **Single scroll owner**: ImplementationAssistantPanel owns scrolling for RHS chat
- **Never scroll window/document**: Only scroll the `messagesContainerRef` element

### Code Patterns to Follow
- Use `requestAnimationFrame` for scroll timing (existing pattern in ChatMessageList)
- Use `scrollTop = scrollHeight` assignment pattern
- Guard refs with null checks before accessing `.current`

### Files to Modify
- `ChatMessageList.tsx` - Add prop, guard scroll logic
- `ImplementationAssistantPanel.tsx` - Add ref, add useEffect, pass prop
