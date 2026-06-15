# Specification: Fix Implement Assistant Infinite Render Loop

## Goal
Eliminate the "Maximum update depth exceeded" React warning caused by unstable getter function identities in ProductUiStateContext, which triggers infinite re-render loops when navigating to or returning to the Implement tab.

## User Stories
- As a user, I want to navigate away from the Implement screen and return without losing my conversation or seeing error warnings
- As a developer, I want context getter functions to have stable identities so that useEffect dependencies behave predictably

## Specific Requirements

**Implement stateRef pattern in ProductUiStateContext**
- Add `const stateRef = useRef<ProductUiState>(state)` immediately after the `useState` declaration at line 206
- Add a synchronization effect: `useEffect(() => { stateRef.current = state; }, [state])` to keep the ref current
- This enables getters to read current state without needing `state` in their dependency arrays
- Import `useRef` in the imports section (line 18)

**Stabilize getExpandedIds getter (lines 212-225)**
- Change dependency array from `[state]` to `[]`
- Replace `state[projectKey]` with `stateRef.current[projectKey]` inside the callback body
- The function identity will remain stable across all state updates while still returning current data

**Stabilize getLastImplementWorkItemId getter (lines 283-292)**
- Change dependency array from `[state]` to `[]`
- Replace `state[projectKey]` with `stateRef.current[projectKey]` inside the callback body
- Ensures work item ID retrieval does not cause re-renders in dependent effects

**Stabilize getImplementChatState getter (lines 317-326)**
- Change dependency array from `[state]` to `[]`
- Replace `state[projectKey]` with `stateRef.current[projectKey]` inside the callback body
- This is the critical getter causing the infinite loop in ImplementationAssistantPanel's hydration effects

**Verify contextValue useMemo remains effective (lines 351-370)**
- With stable getters (empty deps), the contextValue useMemo dependencies will no longer change on state updates
- The context object identity remains stable, preventing unnecessary consumer re-renders
- No code changes required here if getters are properly stabilized

**Review ImplementationAssistantPanel hydration useEffect (lines 233-284)**
- After getter stabilization, `getImplementChatState` in the dependency array (line 284) will not cause re-runs
- The effect should only run on mount, workItemId change, or projectKey change
- No code changes needed in the panel if the context fix is complete

**Review ImplementationAssistantPanel disk hydration useEffect (lines 301-376)**
- The dependency on `getImplementChatState` at line 372 will become stable after the context fix
- Verify this effect does not trigger redundant disk hydration calls
- Add guard to skip setState if hydrated messages are equivalent to current messages (length check)

**Add equality guard in setImplementChatState setter (optional optimization)**
- Inside the setState updater, compare incoming chatState with existing state
- If sessionId matches and messages.length matches, return `prev` unchanged
- This prevents no-op state updates that would still trigger ref synchronization

## Existing Code to Leverage

**Stable setter pattern already in place**
- Existing setters (`setExpandedIds`, `setLastImplementWorkItemId`, `setImplementChatState`) already use `useCallback([], ...)` with `setState(prev => ...)` pattern
- The getters should adopt the same empty-dependency pattern but read from stateRef instead of closure

**ProductUiStateContext.test.ts getter stability tests (lines 417-557)**
- Test cases 1.1.1, 1.1.2, 1.1.3 already verify getter identity stability across state changes
- These tests currently pass because they check reference equality, but the production issue persists
- The tests validate the expected behavior; the implementation must be updated to match

**isPersisting ref guard in ImplementationAssistantPanel (line 189)**
- Existing `isPersisting.current` flag prevents re-entrant persistChatState calls
- This remains as a secondary safeguard but is not the primary fix

**deriveProjectKey utility function (lines 452-459)**
- Stable utility for project key derivation from filename
- No changes needed; continue using for consistent key generation

## Out of Scope
- Backend API changes or gateway modifications
- Chat persistence semantics beyond preventing the render loop
- Visual or UX changes to the Implementation Assistant panel
- Refactoring to external state management libraries (Zustand, Redux)
- Performance optimizations unrelated to the infinite loop fix
- Adding new features to chat state management
- Changes to ChatMessageList or ChatInput components
- Modifications to bootstrap phase or disk hydration logic beyond loop prevention
- localStorage persistence for chat state
- Changes to other consumers of ProductUiStateContext unless they exhibit the same bug
