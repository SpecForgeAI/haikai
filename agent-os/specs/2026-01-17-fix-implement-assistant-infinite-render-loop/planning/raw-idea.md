title: Fix Implement Assistant Infinite Render Loop on Conversation Rehydration (Stabilize ProductUiState getters)

context:
  Navigating away from the Implement screen and returning triggers a React warning:
    "Maximum update depth exceeded"
  The error stack points to ImplementationAssistantPanel. This occurs after introducing
  Implement chat rehydration/persistence via ProductUiStateContext.

problem:
  ProductUiStateContext exposes getter functions (e.g., getImplementChatState) that are
  recreated on every state update because they are defined with useCallback([...state]).
  ImplementationAssistantPanel has useEffects that depend on these getters. When chat state is
  persisted (setImplementChatState), ProductUiStateContext state updates, the getter function
  identity changes, the hydration effect re-runs, which triggers more setState calls, causing a
  render loop and the "maximum update depth" warning.

goal:
  Eliminate the recursive re-render/setState loop by making ProductUiStateContext getter
  function identities stable across state updates, while still returning current state.

scope:
  - Frontend only
  - Fix in ProductUiStateContext (preferred single-source fix)
  - Minimal/no changes in ImplementationAssistantPanel beyond dependency cleanup if needed
  - Add/adjust a regression test to prevent reintroduction of the loop

requirements:
  stabilize_context_getters:
    - Update ProductUiStateContext to ensure getter functions do NOT depend on `state` in their
      useCallback dependency arrays.
    - Implement a state ref pattern:
        - Maintain `const stateRef = useRef(state)`
        - Keep stateRef.current updated whenever state changes
          (either via a useEffect([state]) or within setState updater before returning).
    - Define getter functions to read from `stateRef.current` and memoize them with useCallback([])
      so their identity remains stable:
        - getExpandedIds
        - getLastImplementWorkItemId
        - getImplementChatState
      (Any other getters currently using [state] must also be stabilized.)

  preserve_setters:
    - Setter functions (setImplementChatState, setExpandedIds, etc.) may remain stable as they
      already use useCallback([]) with setState updaters.
    - Ensure updating state still correctly triggers re-renders for consumers that read derived
      values (e.g., components that call getters during render).

  context_value_memoization:
    - Keep the context `value` object stable using useMemo, but ensure its dependencies include
      the stabilized getters and existing setters.
    - After this change, context consumers should not observe function identity changes for
      getters when only the underlying state changes.

  implementation_assistant_panel_safety:
    - Review ImplementationAssistantPanel useEffects that include getImplementChatState in
      dependency arrays.
    - After stabilizing getters, these effects should no longer re-run due solely to getter
      identity changes.
    - If any effect still loops due to state changes it triggers itself, add a guard:
        - do not set local state from storedState if it is already equivalent (length and key
          fields match), to prevent redundant setState cycles.

  testing_regression:
    - Add or update a regression test that:
        - mounts ImplementationAssistantPanel
        - simulates chat state persistence (setImplementChatState called)
        - verifies getImplementChatState identity remains stable across state updates
        - verifies no "Maximum update depth exceeded" warning is produced
    - The test should fail if getters are recreated per state update.

acceptance_criteria:
  - Navigating away from Implement screen and returning does NOT wipe the conversation and does
    NOT produce "Maximum update depth exceeded" warnings.
  - ProductUiStateContext getter function identities (especially getImplementChatState) remain
    stable across calls to setImplementChatState.
  - ImplementationAssistantPanel can hydrate from stored context state without triggering a
    render loop.
  - A regression test exists that would catch reintroduction of this issue.

non_goals:
  - No changes to gateway persistence APIs
  - No changes to conversation disk hydration logic other than preventing redundant setState
    cycles if necessary
