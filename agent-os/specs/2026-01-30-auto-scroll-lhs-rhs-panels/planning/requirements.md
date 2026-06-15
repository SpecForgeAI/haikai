# Spec Requirements: Auto-Scroll LHS & RHS Panels

## Initial Description

The initialization file was not found, but based on the clarifying questions and answers, this spec addresses implementing consistent auto-scroll behavior for both the Left-Hand Side (LHS) feature content panel and the Right-Hand Side (RHS) chat message panel. The goal is to keep users pinned to the bottom of scrollable content as new content arrives (such as streaming messages or expanding sections), while respecting user scroll position when they scroll away from the bottom.

## Requirements Discussion

### First Round Questions

**Q1:** What threshold should be used for "near bottom" detection?
**Answer:** Use the same 20px "near bottom" threshold for BOTH panels for consistency.

**Q2:** How should the LHS implementation be structured?
**Answer:** Add a ref + near-bottom tracking + auto-scroll effect for the LHS feature content scroll container, analogous to ChatMessageList.

**Q3:** What is the current behavior of the RHS panel auto-scroll?
**Answer:** Audit it. The issue is that current auto-scroll isn't reliably firing (especially with streaming) and we must ensure it never scrolls the page/root. Keep scrolling strictly on the internal container only.

**Q4:** Which container should be targeted for RHS scrolling?
**Answer:** Target the actual scrollable element (the one with overflow:auto and the scrollbar). If `.messagesContainer` is the scroll container, scroll that; if ChatMessageList `.container` is the scroll container, scroll that. Choose the element that actually owns scrollTop changes in the DOM.

**Q5:** What should trigger auto-scroll on the LHS panel?
**Answer:** Trigger auto-scroll on any LHS content growth (including Open Questions appearing/expanding, and any sections whose rendered content increases height), but only if user is near bottom.

**Q6:** What scroll timing approach should be used?
**Answer:** Prefer `requestAnimationFrame` inside `useEffect` (scroll after DOM updates). `useLayoutEffect` is acceptable if it doesn't cause jank, but default to rAF in useEffect.

**Q7:** Are there any exclusions or special cases to handle?
**Answer:** Do NOT force-scroll on user-driven collapses/expands if the user is not near-bottom. If the user IS near-bottom, it's fine to keep them pinned to bottom even when sections expand/collapse. No other special exclusions needed.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ChatMessageList - The existing RHS chat message list component that has auto-scroll behavior (to be audited and fixed)
- Components to potentially reuse: The near-bottom detection logic and auto-scroll effect pattern from ChatMessageList can serve as the template for the LHS implementation

### Follow-up Questions

No follow-up questions were required.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable.

## Requirements Summary

### Functional Requirements
- Implement consistent 20px "near bottom" threshold detection for both LHS and RHS panels
- LHS panel: Add ref-based scroll container tracking with near-bottom detection and auto-scroll on content growth
- RHS panel: Audit and fix existing auto-scroll to ensure reliability during streaming and prevent page/root scrolling
- Auto-scroll triggers when user is near bottom (within 20px of scrollable area bottom)
- Auto-scroll fires on any content growth: new messages (RHS), Open Questions appearing/expanding (LHS), or any section height increases
- Scroll timing uses `requestAnimationFrame` inside `useEffect` to scroll after DOM updates
- When user IS near-bottom, keep them pinned even during section expand/collapse
- When user is NOT near-bottom, do not force-scroll on any content changes

### Technical Considerations
- Use refs to track the actual scrollable DOM element (the one with `overflow: auto` and the scrollbar)
- For RHS: Identify whether `.messagesContainer` or `.container` owns the scrollTop - target whichever element actually has the scrollbar
- Never scroll the page/root document - scrolling must be strictly confined to the internal scroll container
- Prefer `requestAnimationFrame` in `useEffect` over `useLayoutEffect` to avoid jank
- Near-bottom calculation: `scrollHeight - scrollTop - clientHeight <= 20`

### Reusability Opportunities
- The near-bottom tracking hook/logic should be shared or consistent between LHS and RHS implementations
- Consider extracting a reusable `useAutoScroll` hook that both panels can consume
- Pattern from ChatMessageList (ref + near-bottom tracking + auto-scroll effect) serves as the template

### Scope Boundaries

**In Scope:**
- Implementing near-bottom detection with 20px threshold for LHS panel
- Adding auto-scroll behavior to LHS feature content scroll container
- Auditing and fixing RHS ChatMessageList auto-scroll reliability
- Ensuring RHS auto-scroll works correctly during streaming
- Ensuring neither panel scrolls the page/root element
- Scroll timing via requestAnimationFrame in useEffect

**Out of Scope:**
- Changes to the visual layout or styling of either panel
- Scroll position persistence/restoration across navigation
- Smooth scrolling animations (unless already present)
- Scroll behavior configuration or user preferences
- Any other panels or scrollable areas in the application

### Technical Considerations
- React 18.x with TypeScript 5.x (per tech stack)
- CSS Modules for any styling needs
- React hooks (useState, useEffect, useRef) for state and DOM interaction
- No external libraries needed - vanilla React patterns suffice
- Must handle streaming content updates efficiently without performance degradation
