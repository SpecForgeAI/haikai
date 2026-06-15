---
title: Fix infinite re-render loop in Implementation Assistant (max update depth) by removing unstable context dependencies and stabilizing getters
date: 2026-01-11
owner: product-delivery-ui
type: bugfix

## Goal
Eliminate the runaway render/update loop when navigating to **Product & Delivery → Implement** that produces:
- `Warning: Maximum update depth exceeded...`
and results in thousands of repeated errors per minute.

## Root cause
`ImplementationAssistantPanel` triggers `setState` inside a `useEffect` to persist chat state into `ProductUiStateContext`.
That context update causes the Provider to re-render and recreate context functions (notably getters like `getImplementChatState` that depend on `[state]`), which changes the context value identity and causes the effect dependencies to change on every render. The effect runs again immediately, creating an infinite loop.

## Scope
### In-scope
- Fix `ImplementationAssistantPanel.tsx` to depend only on stable setter functions and stable keys, not the whole context object or unstable getters.
- Stabilize `getImplementChatState` (and related getters if needed) in `ProductUiStateContext.tsx` so consumers are not forced into rerender cascades due to function identity churn.
- Add a regression test to ensure navigating to Implement does not produce the React max update depth warning.

### Out-of-scope
- Any changes to chat persistence semantics beyond removing the loop
- Backend changes

## Fix requirements

### 1) ImplementationAssistantPanel: remove unstable context object dependencies
In `ImplementationAssistantPanel.tsx`:
- Do NOT use `uiStateContext` object directly inside callbacks/effects.
- Destructure only the required context members:
  - `setImplementChatState` (setter; should be stable)
  - `getImplementChatState` (getter; may be unstable today—see provider changes below)

Update persistence callback:
- Ensure `persistChatState()` depends on:
  - `projectKey`, `workItemId`
  - current local chat state inputs (messages, sessionId, etc.)
  - `setImplementChatState`
- It MUST NOT depend on the entire context object (`uiStateContext`) and MUST NOT include unstable getters as dependencies.

Update persistence effect:
- Ensure the "persist to context" effect runs only when local chat state meaningfully changes and when an active project/work item exists.
- Its dependency array must not include unstable context values or functions whose identity changes on every provider update.

Update hydration effect:
- Ensure "hydrate from persisted chat state" runs when:
  - `projectKey` changes OR
  - `workItemId` changes
- Do not make this effect re-run because a context getter function identity changed.
  - If necessary, read persisted state via a stable accessor (see provider change below).

### 2) ProductUiStateContext: stabilize getImplementChatState getter identity
In `ProductUiStateContext.tsx` (ProductUiStateProvider):
- Current issue: `getImplementChatState` is created with `useCallback(..., [state])` so it changes identity on every state update.
- Change to a stable getter pattern:
  - Maintain `const stateRef = useRef(state)`
  - Update `stateRef.current = state` in a `useEffect([state])`
  - Implement `getImplementChatState` with `useCallback(..., [])` and read from `stateRef.current`

Do the same for any other getters used by `ImplementationAssistantPanel` that are currently defined with `[state]` and therefore unstable.

Setters (e.g. `setImplementChatState`) should remain stable (use `setState(prev => ...)` pattern).

### 3) Guard against unnecessary writes (optional but recommended)
In `setImplementChatState`, avoid writing identical state repeatedly:
- If the new chat state is deep-equal to existing stored state for that project/workItem, return `prev` unchanged.
This prevents redundant provider updates and improves performance even outside the infinite loop scenario.

### 4) Regression test
Add a test (unit or integration) that:
- Renders `ProductUiStateProvider` + `ImplementationAssistantPanel` with a valid active project/work item.
- Asserts no infinite loop occurs:
  - no "Maximum update depth exceeded" warning logged
  - and `setImplementChatState` is not called repeatedly without user input (at most once for initial persist/hydrate if applicable).

If test harness cannot easily mount the full screen, target the smallest component boundary that previously reproduced the issue.

## Acceptance criteria
1. Navigating to the Implement screen no longer logs `Maximum update depth exceeded`.
2. The UI remains responsive; no repeated state updates occur in the background.
3. Implement chat state persistence still works:
   - it hydrates the last conversation for the selected work item
   - it persists changes when the user sends messages (or when messages update)
4. Provider getters used by Implement are stable (do not change identity every state update).
5. Tests pass and include coverage preventing regression.

## Implementation notes (non-exhaustive)
- Prefer destructuring `const { setImplementChatState, getImplementChatState } = useProductUiStateContext()` and using those rather than passing context object through callbacks.
- Avoid including context getter functions in dependency arrays if their identity is not guaranteed stable; instead, make them stable via `stateRef` in provider.
- Ensure any effects that call setters have tight dependency arrays and explicit guards on projectKey/workItemId presence.
