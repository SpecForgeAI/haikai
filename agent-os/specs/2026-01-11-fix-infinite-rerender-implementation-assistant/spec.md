# Specification: Fix Infinite Re-render Loop in Implementation Assistant

## Goal
Eliminate the infinite re-render loop ("Maximum update depth exceeded") when navigating to Product & Delivery -> Implement tab by stabilizing context getter function identities and fixing effect dependencies in the consumer component.

## User Stories
- As a user, I want to navigate to the Implement tab without encountering errors so that I can use the Implementation Assistant normally
- As a developer, I want stable context getter functions so that useEffect hooks do not re-run infinitely when context state changes

## Specific Requirements

**Introduce stateRef pattern in ProductUiStateContext.tsx**
- Add `const stateRef = useRef(state)` near line 186 after the `useState` declaration
- Add `useEffect(() => { stateRef.current = state; }, [state])` to keep ref synchronized
- This pattern allows getter functions to access current state without depending on state identity

**Stabilize getExpandedIds getter (lines 192-205)**
- Change from `useCallback(..., [state])` to `useCallback(..., [])`
- Replace `state[projectKey]` with `stateRef.current[projectKey]` inside the callback
- Function identity will now remain stable across state updates

**Stabilize getLastImplementWorkItemId getter (lines 263-272)**
- Change from `useCallback(..., [state])` to `useCallback(..., [])`
- Replace `state[projectKey]` with `stateRef.current[projectKey]` inside the callback
- Function identity will now remain stable across state updates

**Stabilize getImplementChatState getter (lines 297-306)**
- Change from `useCallback(..., [state])` to `useCallback(..., [])`
- Replace `state[projectKey]` with `stateRef.current[projectKey]` inside the callback
- This is the primary getter causing the infinite loop in ImplementationAssistantPanel

**Update contextValue useMemo dependencies (lines 331-350)**
- After stabilizing getters, the useMemo dependencies array will still include getter references
- With stable getters (empty deps), contextValue identity will remain stable
- Verify that the dependency array no longer causes contextValue recreation on state changes

**Fix persistChatState callback in ImplementationAssistantPanel.tsx (lines 106-119)**
- Remove `uiStateContext` from the dependency array (currently at line 119)
- Destructure `setImplementChatState` from context at component top level
- Add only `setImplementChatState` to dependencies (it is already stable with `[]` deps)
- Resulting deps: `[projectKey, workItemId, sessionId, messages, generatedSpecs, error, inputMessage, setImplementChatState]`

**Fix hydration useEffect in ImplementationAssistantPanel.tsx (lines 125-160)**
- Remove `uiStateContext` from dependency array (currently at line 160)
- Destructure `getImplementChatState` from context at component top level
- After context fix, `getImplementChatState` will be stable and safe to include in deps
- Resulting deps: `[projectKey, workItemId, getImplementChatState]`

**Fix persist useEffect in ImplementationAssistantPanel.tsx (lines 166-171)**
- Ensure `persistChatState` in deps (line 171) does not cause infinite loop
- After persistChatState callback is fixed, this effect will only re-run on meaningful state changes
- Verify effect does not fire repeatedly after fixes are applied

**Add deep-equality guard in setImplementChatState (recommended)**
- Before updating state, compare new chatState with existing stored state
- If values are equivalent, return `prev` unchanged to avoid unnecessary re-renders
- Use shallow comparison of chatState fields or JSON.stringify comparison

**Add regression test for infinite loop prevention**
- Create test that renders ProductUiStateProvider with ImplementationAssistantPanel
- Verify "Maximum update depth exceeded" warning is not logged
- Verify setImplementChatState is called at most once during initial mount/hydration
- Verify chat state persistence still functions correctly after the fix

## Existing Code to Leverage

**Stable setter pattern in ProductUiStateContext.tsx (lines 211-328)**
- Existing setters (`setExpandedIds`, `toggleExpanded`, `setLastImplementWorkItemId`, `setImplementChatState`) already use `useCallback(..., [])` with `setState(prev => ...)` pattern
- These are already stable and should not be changed
- The getter functions should follow the same empty-deps pattern using stateRef

**ProductUiStateContext.test.ts test structure**
- Existing test file at `frontend/src/__tests__/ProductUiStateContext.test.ts` (388 lines)
- Uses `renderHook` from `@testing-library/react` with wrapper pattern
- New regression test should follow the same test structure and helper patterns

**isPersisting ref guard in ImplementationAssistantPanel.tsx (line 99)**
- Existing `isPersisting.current` flag prevents re-entrant calls to persistChatState
- This pattern can remain as an additional safeguard but should not be the primary fix

**deriveProjectKey utility function (lines 432-439)**
- Already stable utility function for deriving project key from filename
- No changes needed; continue using for projectKey derivation

**createEmptyProjectTabState factory (lines 166-174)**
- Existing factory function creates default ProjectTabState structure
- Used by setters when project state does not exist; no changes needed

## Out of Scope
- Changes to chat persistence semantics or behavior beyond fixing the loop
- Backend or API changes
- UI/UX visual changes to the Implementation Assistant
- Refactoring other components that use ProductUiStateContext (unless they exhibit the same issue)
- Adding new features to the Implementation Assistant
- Modifying the ChatMessageList or ChatInput components
- Changes to sessionId management or chat API integration
- Performance optimizations beyond what is needed to fix the infinite loop
- Migration to external state management libraries (e.g., Zustand, Redux)
- Adding localStorage persistence for chat state
