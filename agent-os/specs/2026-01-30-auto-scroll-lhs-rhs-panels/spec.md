# Specification: Auto-scroll LHS Feature Content Panel and RHS Team Chat Panel

## Goal
Ensure two internal scroll containers on the Implement screen auto-scroll to bottom as new content arrives, while never programmatically scrolling the page/root scrollbar. Both panels must respect user scroll position and only auto-scroll when the user is near the bottom.

## User Stories
- As a user viewing the Implement screen, I want the RHS chat panel to auto-scroll as new streamed messages arrive so that I can see the latest assistant responses without manual scrolling.
- As a user viewing the Implement screen, I want the LHS feature content panel to auto-scroll when new sections appear or grow (like Open Questions) so that I can see newly added content without manual scrolling.

## Specific Requirements

**Near-bottom detection threshold**
- Use consistent 20px threshold for both panels
- Calculation: `scrollHeight - scrollTop - clientHeight <= 20`
- Track near-bottom state via onScroll handler that updates React state
- State should reset to "near bottom" when user scrolls back down

**Never scroll page/root**
- Do NOT use `window.scrollTo`, `document.body.scrollTop`, or `scrollIntoView` with default behavior
- Only set `scrollTop` on the internal container element (the one with `overflow-y: auto`)
- Verify scroll operations target the correct ref element, not any ancestor

**Use requestAnimationFrame for scroll timing**
- Wrap `scrollTop` assignment inside `requestAnimationFrame` within `useEffect`
- This ensures DOM has updated before measuring/scrolling
- Pattern: `useEffect(() => { requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; }); }, [deps])`

**RHS ChatMessageList audit and fix**
- Current implementation in `ChatMessageList.tsx` uses direct `scrollTop` assignment without `requestAnimationFrame`
- Audit that it only scrolls `.container` (the internal scroll container) and never page/root
- Add `requestAnimationFrame` wrapper for reliable scroll timing during streaming
- Ensure auto-scroll triggers on both message count changes AND content changes (already partially implemented)

**LHS FeatureDefinitionPanel auto-scroll implementation**
- Add `useRef` for the `.content` scroll container element
- Add `useState` for tracking whether user has scrolled up from bottom
- Add `onScroll` handler to `.content` div that updates near-bottom state
- Add `useEffect` that triggers auto-scroll when content height grows and user is near bottom

**LHS content growth detection**
- Track previous `scrollHeight` using `useRef` to detect content growth
- Trigger auto-scroll when: `scrollHeight > prevScrollHeight && userNearBottom`
- This captures: Open Questions appearing, sections expanding, any content additions
- Do NOT force-scroll when user is not near bottom (respects user scroll position)

**Respect user scroll position**
- If user has scrolled up (not near bottom), do not auto-scroll on content changes
- If user scrolls back to near-bottom, resume auto-scrolling behavior
- This applies to both expand/collapse of sections and new content arriving

## Visual Design
No visual assets provided - this spec is behavior-only with no UI changes.

## Existing Code to Leverage

**ChatMessageList.tsx auto-scroll pattern**
- Located at `frontend/src/components/chat/ChatMessageList.tsx`
- Uses `containerRef` with `useRef<HTMLDivElement>` for the scroll container
- Uses `userHasScrolledUp` state with `handleScroll` callback to track near-bottom
- Uses 20px threshold: `scrollHeight - scrollTop - clientHeight < 20`
- This pattern should be replicated for FeatureDefinitionPanel

**FeatureDefinitionPanel.tsx scroll container**
- Located at `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
- The `.content` div (line 834) is the internal scroll container with `overflow-y: auto`
- Currently has no ref attached - needs ref added for auto-scroll
- CSS in `FeatureDefinitionPanel.module.css` confirms `.content` has `overflow-y: auto`

**ChatMessageList.module.css scroll container**
- Located at `frontend/src/components/chat/ChatMessageList.module.css`
- The `.container` class has `overflow-y: auto` and `flex: 1 1 0`
- This is the correct element to scroll in the RHS panel

**ChatMessageList.test.ts test patterns**
- Located at `frontend/src/__tests__/ChatMessageList.test.ts`
- Has helper functions for simulating scroll state and testing auto-scroll logic
- Pattern can be extended to test the requestAnimationFrame enhancement

## Out of Scope
- Removing or hiding the page/root scrollbar
- Changing the overall page layout or flex structure
- Adding "Scroll to bottom" buttons or scroll indicators
- Persisting scroll positions across navigation or tab switches
- Smooth scrolling animations (use instant scroll)
- Any backend changes
- Changes to any components other than ChatMessageList and FeatureDefinitionPanel
- Scroll behavior for any panels other than the two specified (LHS feature content, RHS chat)
- User preference settings for auto-scroll behavior
