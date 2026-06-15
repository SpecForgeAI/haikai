# Spec Requirements: Force RHS Team Chat Scroll to Bottom

## Initial Description
The initialization file was not found, but based on the clarifying questions and answers, this spec addresses the need to force the Right-Hand Side (RHS) "Team Chat" panel on the Implement screen to always scroll to the bottom when new messages arrive, including during streaming.

## Requirements Discussion

### First Round Questions

**Q1:** What does "RHS" refer to - is this the Right-Hand Side "Team Chat" panel on the Implement screen?
**Answer:** Yes - RHS = the Right-Hand Side "Team Chat" panel on the Implement screen.

**Q2:** Should ChatMessageList's scroll behavior be removed entirely, disabled, or bypassed for this specific screen?
**Answer:** Disable/bypass it (don't delete if it's used elsewhere). For this screen, ChatMessageList should not own scrolling; scrolling should be controlled by the RHS panel container in ImplementationAssistantPanel.

**Q3:** During streaming, should every new streamed bubble (one per delta) trigger scroll-to-bottom?
**Answer:** Yes - every new streamed bubble (one per delta) must trigger scroll-to-bottom.

**Q4:** Should scroll-to-bottom be unconditional, or should it respect user scroll position (e.g., if user scrolls up, don't force them back down)?
**Answer:** Yes - unconditional. Even if the user scrolls up, any new message forces scroll back to the bottom.

**Q5:** Are the primary files to change ChatMessageList.tsx and ImplementationAssistantPanel.tsx?
**Answer:** Yes - those are the correct primary files to change:
- `ChatMessageList.tsx` (remove/bypass scroll ownership for this screen)
- `ImplementationAssistantPanel.tsx` (add ref + scroll-to-bottom effect on message append)

**Q6:** Should ChatMessageList's existing scroll code be preserved for other contexts, or removed entirely?
**Answer:** Keep ChatMessageList's scroll code available for other contexts, but make it optional/disabled for this Implement Team Chat usage (so RHS panel is the single scroll owner here).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ChatMessageList - Path: `ChatMessageList.tsx`
- Feature: ImplementationAssistantPanel - Path: `ImplementationAssistantPanel.tsx`
- Components to potentially reuse: Existing scroll behavior in ChatMessageList (to be made optional)
- Backend logic to reference: None identified - this is a frontend-only change

### Follow-up Questions
None required - all questions were answered comprehensively.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable.

## Requirements Summary

### Functional Requirements
- Force scroll-to-bottom on the RHS Team Chat panel whenever new messages arrive
- Scroll must trigger on every streaming delta (each new bubble)
- Scroll behavior must be unconditional - override any user scroll position
- ImplementationAssistantPanel.tsx becomes the single owner of scroll behavior for this context
- ChatMessageList.tsx scroll behavior must be bypassed/disabled when used within the Implement screen

### Reusability Opportunities
- ChatMessageList's existing scroll logic should be preserved and made optional via prop or context
- The scroll-to-bottom pattern in ImplementationAssistantPanel could potentially be extracted as a reusable hook if similar behavior is needed elsewhere

### Scope Boundaries
**In Scope:**
- Modifying ChatMessageList.tsx to make scroll behavior optional/disableable
- Adding scroll-to-bottom effect to ImplementationAssistantPanel.tsx
- Adding ref to scrollable container in ImplementationAssistantPanel.tsx
- Ensuring scroll triggers on every streamed message delta

**Out of Scope:**
- Changing scroll behavior in other screens/contexts where ChatMessageList is used
- Adding user preference to toggle auto-scroll behavior
- Smart scroll behavior (e.g., only scroll if already at bottom)
- Any backend changes

### Technical Considerations
- React ref needed on scrollable container in ImplementationAssistantPanel
- useEffect hook to trigger scroll when message list changes
- ChatMessageList needs a prop or mechanism to disable its internal scroll handling
- Must handle streaming messages where content updates incrementally
- Tech stack: React 18.x with TypeScript 5.x (per product tech-stack.md)
- Similar code patterns to follow: Existing ChatMessageList scroll logic (to understand current implementation before making it optional)
