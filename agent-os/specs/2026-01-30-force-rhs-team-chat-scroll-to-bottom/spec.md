# Specification: Force RHS Team Chat Panel to Always Scroll to Bottom

## Goal
Ensure the Right-Hand Side (RHS) "Team Chat" panel on the Implement screen unconditionally auto-scrolls to the bottom whenever new messages arrive, including during streaming updates.

## User Stories
- As a user chatting with the Implementation Assistant, I want the chat to always show the latest message so that I never miss new content during conversations.
- As a user during streaming responses, I want the chat to continuously scroll to bottom with each delta so that I can follow the Software Architect's responses in real-time.

## Specific Requirements

**ChatMessageList scroll behavior bypass**
- Add optional prop `disableAutoScroll?: boolean` to ChatMessageListProps interface
- When `disableAutoScroll` is true, skip all scroll-related behavior in the component
- Do not execute the useEffect that sets `containerRef.current.scrollTop`
- Do not track `userHasScrolledUp` state when disabled
- Do not attach scroll event handler when disabled
- Preserve existing scroll code for other contexts that may use ChatMessageList

**ImplementationAssistantPanel scroll container identification**
- The actual scrollable container is the `div.messagesContainer` element (line 1830 in JSX)
- This element has CSS `overflow: auto` via `.messagesContainer` class
- ChatMessageList renders inside this container with its own `.container` class that has `overflow-y: auto`
- The problem: ChatMessageList's scroll logic targets its inner container which is not the visible scrollbar owner

**ImplementationAssistantPanel scroll ref addition**
- Add a React ref (e.g., `messagesContainerRef`) of type `RefObject<HTMLDivElement>`
- Attach this ref to the `div.messagesContainer` element that wraps ChatMessageList
- This ref targets the element at line 1830: `<div className={styles.messagesContainer}>`

**Unconditional scroll-to-bottom effect**
- Add useEffect hook that depends on `messages` array
- On every change to messages array (including streamed deltas), scroll to bottom
- Use `requestAnimationFrame` wrapper for reliable timing after DOM updates
- Set `scrollTop = scrollHeight` on the messagesContainerRef element
- No near-bottom checks - always scroll unconditionally
- No user-scroll detection or override prevention

**Scroll ownership isolation**
- Pass `disableAutoScroll={true}` to ChatMessageList component in ImplementationAssistantPanel
- ImplementationAssistantPanel becomes the single scroll owner for RHS chat
- ChatMessageList should not attempt any scrolling when used in this context

**Scroll target restrictions**
- Only scroll the `messagesContainerRef.current` element
- Never use `window.scrollTo()`, `document.body.scrollTop`, or `document.documentElement.scrollTop`
- Never use `scrollIntoView()` which can affect parent containers
- Only set `scrollTop` property on the identified container element

## Visual Design
No visual assets provided - this is a behavioral fix with no UI changes.

## Existing Code to Leverage

**ChatMessageList.tsx scroll implementation (lines 127-166)**
- Contains existing auto-scroll pattern using `containerRef`, `useEffect`, and `requestAnimationFrame`
- Uses `scrollTop = scrollHeight` assignment pattern which should be replicated
- Contains `userHasScrolledUp` state tracking - this logic should be bypassed, not deleted
- Contains `handleScroll` callback with near-bottom detection - this should be skippable via prop

**ImplementationAssistantPanel.tsx ChatMessageList usage (lines 1830-1837)**
- ChatMessageList is wrapped in `div.messagesContainer` which is the actual scroll container
- Already passes `messages` and `currentPhase` props to ChatMessageList
- The `messagesContainer` div is only rendered when `hasMessages` is true (conditional render)

**ImplementationAssistantPanel.module.css messagesContainer class (lines 221-226)**
- Has `overflow: auto` which creates the scrollable region
- Has `flex: 1` and `min-height: 0` for proper flex sizing
- This is the element that owns the visible scrollbar

**ChatMessageList.module.css container class (lines 1-8)**
- Has `overflow-y: auto` on the inner container
- This inner scrollbar is nested inside the panel's scrollbar, causing the scroll targeting issue

## Out of Scope
- LHS panel (Feature Definition) scroll behavior
- Near-bottom detection or "polite" scroll behavior that respects user scroll position
- User preference settings for auto-scroll
- Scroll-to-bottom button UI
- Any changes to ChatMessageList styling or layout
- Changes to streaming message content or timing
- Changes to message persistence or state management
- Performance optimization for large message lists
- Scroll position persistence across tab switches
- Mobile-specific scroll behavior changes
