# Spec Requirements: Fix Infinite Re-render Loop in Implementation Assistant

## Initial Description

Fix the infinite re-render loop (Maximum update depth exceeded) when navigating to Product & Delivery -> Implement tab. The root cause is unstable context getters in ProductUiStateContext.tsx that change identity on every state update, causing useEffect hooks in ImplementationAssistantPanel.tsx to re-run infinitely.

## Requirements Discussion

### First Round Questions

This is a focused bugfix with well-defined scope from the raw-idea.md. The user has already identified:
- The root cause (unstable getters with `[state]` dependency)
- The fix pattern (stateRef approach)
- The affected files

No clarifying questions were needed as the technical analysis was provided upfront.

### Existing Code to Reference

**Similar Features Identified:**
- The same ProductUiStateContext.tsx already has stable setters (using `setState(prev => ...)` pattern) that can serve as examples
- The stateRef pattern is a well-documented React pattern for stabilizing callback references

### Follow-up Questions

No follow-up questions were needed for this focused bugfix.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable for this bugfix.

## Code Analysis Findings

### ProductUiStateContext.tsx - Unstable Getters (Lines with `[state]` dependency)

| Getter Function | Line Numbers | Dependency Array | Status |
|-----------------|--------------|------------------|--------|
| `getExpandedIds` | 192-205 | `[state]` (line 204) | UNSTABLE |
| `getLastImplementWorkItemId` | 263-272 | `[state]` (line 271) | UNSTABLE |
| `getImplementChatState` | 297-306 | `[state]` (line 305) | UNSTABLE - PRIMARY ISSUE |

### ProductUiStateContext.tsx - Stable Setters (Lines with `[]` dependency)

| Setter Function | Line Numbers | Dependency Array | Status |
|-----------------|--------------|------------------|--------|
| `setExpandedIds` | 211-225 | `[]` (line 224) | STABLE |
| `toggleExpanded` | 231-254 | `[]` (line 253) | STABLE |
| `setLastImplementWorkItemId` | 277-291 | `[]` (line 290) | STABLE |
| `setImplementChatState` | 311-328 | `[]` (line 327) | STABLE |

### ProductUiStateContext.tsx - Context Value Memoization

| Element | Line Numbers | Issue |
|---------|--------------|-------|
| `contextValue` useMemo | 331-350 | Dependencies include unstable getters, causing new context value on every state change |

### ImplementationAssistantPanel.tsx - Problematic Effect Dependencies

| Effect/Callback | Line Numbers | Problematic Dependency | Issue |
|-----------------|--------------|------------------------|-------|
| `persistChatState` useCallback | 106-119 | `uiStateContext` (line 119) | Entire context object in deps causes recreation on every render |
| Hydration useEffect | 125-160 | `uiStateContext` (line 160) | Calls `uiStateContext.getImplementChatState` which changes identity |
| Persist useEffect | 166-171 | `persistChatState` (line 171) | Depends on unstable `persistChatState` callback |

### The Infinite Loop Mechanism

1. Component mounts or state changes
2. `persistChatState` callback is invoked
3. `setImplementChatState` updates context state
4. State update causes `ProductUiStateProvider` to re-render
5. `getImplementChatState` (with `[state]` dep) gets new function identity
6. `contextValue` useMemo recomputes (includes getters in deps)
7. Context value identity changes
8. `ImplementationAssistantPanel` re-renders with new context
9. `uiStateContext` reference changes (new context value)
10. `persistChatState` callback recreated (depends on `uiStateContext`)
11. Persist effect re-runs (depends on `persistChatState`)
12. Go to step 3 - INFINITE LOOP

## Requirements Summary

### Functional Requirements

1. **Stabilize getter functions in ProductUiStateContext.tsx**
   - Introduce `const stateRef = useRef(state)`
   - Add `useEffect` to keep `stateRef.current = state` synchronized
   - Change all getters to use `useCallback(..., [])` and read from `stateRef.current`
   - Getters to fix: `getExpandedIds`, `getLastImplementWorkItemId`, `getImplementChatState`

2. **Fix ImplementationAssistantPanel.tsx dependencies**
   - Destructure only required context members: `setImplementChatState`, `getImplementChatState`
   - Remove `uiStateContext` from all callback/effect dependencies
   - Ensure `persistChatState` only depends on stable values (project key, work item id, local state, stable setters)
   - Fix hydration effect to not re-run due to getter identity changes

3. **Add deep-equality guard in setImplementChatState (recommended)**
   - Compare new chat state with existing state before updating
   - Return `prev` unchanged if state is equivalent
   - Prevents unnecessary provider updates

4. **Add regression test**
   - Test that navigating to Implement does not trigger "Maximum update depth exceeded"
   - Verify `setImplementChatState` is called at most once during mount/hydration
   - Test chat persistence still works correctly

### Scope Boundaries

**In Scope:**
- Stabilizing getter function identities in ProductUiStateContext.tsx
- Fixing dependency arrays in ImplementationAssistantPanel.tsx
- Adding optional deep-equality guard in setter
- Adding regression test

**Out of Scope:**
- Changes to chat persistence semantics
- Backend changes
- UI/UX changes
- Other components that may use the context (unless they have similar issues)

### Technical Considerations

- React 18.x is used (per tech-stack.md)
- TypeScript 5.x for type safety
- Vitest for testing
- The stateRef pattern is the standard React solution for stable callbacks that need current state

### Fix Pattern Reference

The fix follows this established React pattern:

```typescript
// In ProductUiStateProvider:
const stateRef = useRef(state);

useEffect(() => {
  stateRef.current = state;
}, [state]);

const getImplementChatState = useCallback(
  (projectKey: string, workItemId: string): ImplementChatUiState | undefined => {
    const projectState = stateRef.current[projectKey];
    if (!projectState) {
      return undefined;
    }
    return projectState.implementChatState[workItemId];
  },
  [] // Empty deps - function identity is now stable
);
```

### Acceptance Criteria

1. Navigating to the Implement screen no longer logs "Maximum update depth exceeded"
2. The UI remains responsive with no repeated state updates in background
3. Implement chat state persistence continues to work:
   - Hydrates last conversation for selected work item
   - Persists changes when user sends messages
4. Provider getters used by Implement are stable (do not change identity on state updates)
5. Tests pass and include coverage preventing regression
