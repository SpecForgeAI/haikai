# Task Breakdown: Auto-scroll LHS Feature Content Panel and RHS Team Chat Panel

## Overview
Total Tasks: 3 Task Groups, approximately 16 sub-tasks

This feature ensures two internal scroll containers on the Implement screen auto-scroll to bottom as new content arrives, while never programmatically scrolling the page/root scrollbar. Both panels must respect user scroll position and only auto-scroll when the user is near the bottom.

## Task List

### RHS Panel Layer

#### Task Group 1: RHS ChatMessageList Audit and Fix
**Dependencies:** None

- [x] 1.0 Complete RHS ChatMessageList auto-scroll audit and fix
  - [x] 1.1 Write 2-4 focused tests for RHS auto-scroll reliability
    - Test that auto-scroll fires during streaming content updates (multi-bubble pattern)
    - Test that scrollTop is set on internal `.container` element, not page/root
    - Test that requestAnimationFrame is used for scroll timing
    - Test near-bottom detection with 20px threshold
  - [x] 1.2 Audit existing ChatMessageList auto-scroll implementation
    - Review `frontend/src/components/chat/ChatMessageList.tsx`
    - Verify `containerRef` targets the correct scroll container (`.container` div)
    - Confirm current 20px threshold calculation: `scrollHeight - scrollTop - clientHeight < 20`
    - Document any issues with streaming reliability or page/root scrolling
  - [x] 1.3 Add requestAnimationFrame wrapper for scroll timing
    - Wrap `scrollTop` assignment inside `requestAnimationFrame` within `useEffect`
    - Pattern: `useEffect(() => { requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; }); }, [deps])`
    - Ensures DOM has updated before measuring/scrolling
  - [x] 1.4 Verify and fix scroll container targeting
    - Ensure scroll operations only target `.container` ref element
    - Verify no usage of `window.scrollTo`, `document.body.scrollTop`, or `scrollIntoView` with default behavior
    - Confirm only `scrollTop` is set on the internal container element
  - [x] 1.5 Ensure RHS auto-scroll tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify requestAnimationFrame enhancement works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- Auto-scroll reliably fires during streaming content updates
- Scroll operations only target internal `.container` element
- requestAnimationFrame is used for scroll timing
- Near-bottom detection uses consistent 20px threshold

---

### LHS Panel Layer

#### Task Group 2: LHS FeatureDefinitionPanel Auto-scroll Implementation
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete LHS FeatureDefinitionPanel auto-scroll implementation
  - [x] 2.1 Write 2-4 focused tests for LHS auto-scroll behavior
    - Test near-bottom detection with 20px threshold
    - Test auto-scroll triggers when content height grows and user is near bottom
    - Test that user scroll position is respected (no auto-scroll when user scrolled up)
    - Test that scrollTop is set on internal `.content` element, not page/root
  - [x] 2.2 Add ref to scroll container
    - Add `useRef<HTMLDivElement>` for the `.content` scroll container element
    - Attach ref to the `.content` div (currently at line 834 in FeatureDefinitionPanel.tsx)
    - Verify `.content` has `overflow-y: auto` in CSS module
  - [x] 2.3 Add near-bottom tracking state
    - Add `useState` for `userHasScrolledUp` (or similar naming for consistency)
    - Implement `onScroll` handler for `.content` div
    - Handler updates near-bottom state: `scrollHeight - scrollTop - clientHeight <= 20`
    - State resets to "near bottom" when user scrolls back down
  - [x] 2.4 Track scrollHeight changes for content growth detection
    - Add `useRef` to track previous `scrollHeight` value
    - Update previous height after each scroll height comparison
    - Content growth detected when: `scrollHeight > prevScrollHeight`
  - [x] 2.5 Add auto-scroll effect on content growth
    - Add `useEffect` that monitors scroll height changes
    - Trigger auto-scroll when: `scrollHeight > prevScrollHeight && userNearBottom`
    - Use requestAnimationFrame wrapper: `requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; })`
    - Do NOT force-scroll when user is not near bottom
  - [x] 2.6 Ensure LHS auto-scroll tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify content growth detection works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- Ref correctly attached to `.content` scroll container
- Near-bottom tracking uses 20px threshold
- Auto-scroll triggers on content growth (Open Questions, section expansions, etc.)
- User scroll position is respected when scrolled up
- requestAnimationFrame is used for scroll timing
- No page/root scrolling occurs

---

### Testing Layer

#### Task Group 3: Test Review and Integration Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Review tests and verify integrated behavior
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 2-4 tests written for RHS ChatMessageList (Task 1.1)
    - Review the 2-4 tests written for LHS FeatureDefinitionPanel (Task 2.1)
    - Total existing tests: approximately 4-8 tests
  - [x] 3.2 Analyze test coverage gaps for this feature only
    - Identify if any critical user workflows lack test coverage
    - Focus ONLY on gaps related to auto-scroll behavior
    - Prioritize cross-panel consistency verification
  - [x] 3.3 Write up to 4 additional integration tests if needed
    - Test that both panels use consistent 20px threshold
    - Test that neither panel ever triggers page/root scroll
    - Test requestAnimationFrame usage in both implementations
    - Test near-bottom state reset when user scrolls back down (if not already covered)
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, and 3.3)
    - Expected total: approximately 8-12 tests maximum
    - Do NOT run the entire application test suite
    - Verify all auto-scroll behaviors work correctly

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 8-12 tests total)
- Both panels have consistent auto-scroll behavior
- No page/root scrolling in either implementation
- requestAnimationFrame timing verified in both panels
- Near-bottom detection consistent with 20px threshold

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 (RHS ChatMessageList)** and **Task Group 2 (LHS FeatureDefinitionPanel)** can run in **parallel** since they are independent
2. **Task Group 3 (Test Review & Integration)** runs after both Task Groups 1 and 2 are complete

```
Task Group 1 (RHS) ─────────┐
                            ├──> Task Group 3 (Testing)
Task Group 2 (LHS) ─────────┘
```

## Key Implementation Rules

These rules apply to ALL task groups:

1. **Never scroll page/root**
   - Do NOT use `window.scrollTo`, `document.body.scrollTop`, or `scrollIntoView` with default behavior
   - Only set `scrollTop` on the internal container element (the one with `overflow-y: auto`)

2. **Use requestAnimationFrame for scroll timing**
   - Pattern: `useEffect(() => { requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; }); }, [deps])`

3. **Consistent 20px threshold**
   - Near-bottom calculation: `scrollHeight - scrollTop - clientHeight <= 20`

4. **Respect user scroll position**
   - If user has scrolled up (not near bottom), do not auto-scroll on content changes
   - If user scrolls back to near-bottom, resume auto-scrolling behavior

## Files to Modify

| File | Task Group | Changes |
|------|------------|---------|
| `frontend/src/components/chat/ChatMessageList.tsx` | 1 | Add requestAnimationFrame wrapper, verify scroll container targeting |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | 2 | Add ref, near-bottom tracking, content growth detection, auto-scroll effect |
| `frontend/src/__tests__/ChatMessageList.test.ts` | 1, 3 | Add/extend tests for requestAnimationFrame and scroll targeting |
| `frontend/src/__tests__/FeatureDefinitionPanel.test.ts` | 2, 3 | Add tests for new auto-scroll behavior (create if needed) |

## Out of Scope Reminders

- Removing or hiding the page/root scrollbar
- Changing the overall page layout or flex structure
- Adding "Scroll to bottom" buttons or scroll indicators
- Persisting scroll positions across navigation or tab switches
- Smooth scrolling animations (use instant scroll)
- Any backend changes
- Changes to any components other than ChatMessageList and FeatureDefinitionPanel
- Scroll behavior for any panels other than the two specified
- User preference settings for auto-scroll behavior
