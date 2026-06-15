# Task Breakdown: Preserve Implement Tab State Across Product & Delivery Tab Switches

## Overview
Total Tasks: 24 (across 4 task groups)

This feature extends the existing `ProductUiStateContext` to store Implement tab chat state (session ID, messages, generated specs, input draft) per project per work item, enabling seamless tab switching without losing conversation context.

---

## Task List

### Context Layer

#### Task Group 1: Extend ProductUiStateContext with Implement Chat State
**Dependencies:** None

- [x] 1.0 Complete context layer extensions
  - [x] 1.1 Write 4 focused tests for Implement state context methods
    - Test `getLastImplementWorkItemId` returns null for unknown project
    - Test `setLastImplementWorkItemId` stores and retrieves work item ID
    - Test `getImplementChatState` returns undefined for unknown project/workItem
    - Test `setImplementChatState` stores and retrieves chat state correctly
  - [x] 1.2 Define `ImplementChatUiState` interface in `ProductUiStateContext.tsx`
    - Fields: `sessionId: string | null`, `messages: ChatMessage[]`, `generatedSpecs: string[] | null`, `error: string | null`, `inputDraft: string`
    - Import `ChatMessage` type from `src/api/chatApi.ts`
  - [x] 1.3 Extend `ProjectTabState` interface with Implement-specific fields
    - Add `lastImplementWorkItemId: string | null` field
    - Add `implementChatState: Record<string, ImplementChatUiState>` field (keyed by workItemId)
  - [x] 1.4 Update `createEmptyProjectTabState()` factory function
    - Initialize `lastImplementWorkItemId` to `null`
    - Initialize `implementChatState` to empty object `{}`
  - [x] 1.5 Implement `getLastImplementWorkItemId(projectKey: string)` method
    - Return `state[projectKey]?.lastImplementWorkItemId ?? null`
    - Add to context type and provider value
  - [x] 1.6 Implement `setLastImplementWorkItemId(projectKey: string, workItemId: string | null)` method
    - Use callback-based `setState` for immutable update
    - Follow existing pattern from `setExpandedIds`
  - [x] 1.7 Implement `getImplementChatState(projectKey: string, workItemId: string)` method
    - Return `state[projectKey]?.implementChatState[workItemId] ?? undefined`
    - Return `undefined` (not empty state) to distinguish "never stored" from "empty"
  - [x] 1.8 Implement `setImplementChatState(projectKey: string, workItemId: string, chatState: ImplementChatUiState)` method
    - Use callback-based `setState` for immutable update
    - Create project entry if not exists
  - [x] 1.9 Ensure context layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all new methods work correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `ImplementChatUiState` interface is properly typed
- All 4 new context methods are implemented and exposed
- Existing expansion state functionality is unaffected

---

### ProductView Integration

#### Task Group 2: ProductView Tab Switch State Management
**Dependencies:** Task Group 1

- [x] 2.0 Complete ProductView integration
  - [x] 2.1 Write 5 focused tests for ProductView tab state behavior
    - Test `handleWorkOnThis` stores workItemId via `setLastImplementWorkItemId`
    - Test tab switch to Backlog/Roadmap does NOT clear stored `lastImplementWorkItemId`
    - Test entering Implement tab with null URL `workItemId` resolves from `getLastImplementWorkItemId`
    - Test entering Implement with URL `workItemId` uses URL value (URL takes precedence)
    - Test entering Implement with no stored state shows empty state
  - [x] 2.2 Import `useProductUiState` hook and `deriveProjectKey` utility in `ProductView.tsx`
    - Add to existing imports from `ProductUiStateContext`
  - [x] 2.3 Get `loadedFileName` from architecture context in `ProductViewContent`
    - Import `useArchitecture` from `ArchitectureContext`
    - Derive `projectKey` using `deriveProjectKey(loadedFileName)`
  - [x] 2.4 Modify `handleWorkOnThis` to persist work item ID to context
    - Call `setLastImplementWorkItemId(projectKey, itemId)` after setting local state
    - Keep existing URL update logic unchanged
  - [x] 2.5 Modify `handleTabChange` to preserve `lastImplementWorkItemId` on tab leave
    - Remove or gate the `setWorkItemId(null)` call when leaving Implement
    - Continue clearing URL `workItemId` param when leaving Implement (URL is ephemeral)
  - [x] 2.6 Compute `effectiveWorkItemId` when entering Implement tab
    - If `workItemId` from URL is non-null, use it
    - Otherwise, resolve via `getLastImplementWorkItemId(projectKey)`
    - Pass `effectiveWorkItemId` to `ProductImplementPage`
  - [x] 2.7 Ensure ProductView tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify tab switch state preservation works

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Switching to Backlog/Roadmap and back restores the last work item
- URL `workItemId` param is not required for state restoration
- Projects are isolated (different projects have different stored work items)

---

### ImplementationAssistantPanel Integration

#### Task Group 3: Chat State Hydration and Persistence
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete ImplementationAssistantPanel integration
  - [x] 3.1 Write 5 focused tests for chat state hydration and persistence
    - Test component hydrates `messages` from stored state on mount
    - Test component hydrates `sessionId`, `generatedSpecs`, `error`, `inputDraft` from stored state
    - Test state changes (new message) trigger `setImplementChatState` write-through
    - Test switching to NEW workItemId with no stored state resets to empty
    - Test `inputMessage` (draft) is preserved across tab switches
  - [x] 3.2 Import context hook and derive project key in `ImplementationAssistantPanel.tsx`
    - Import `useProductUiState`, `deriveProjectKey` from `ProductUiStateContext`
    - Receive `projectId` prop (already exists as `loadedFileName`)
    - Derive `projectKey` using `deriveProjectKey(projectId)`
  - [x] 3.3 Modify `useEffect` to check for stored state before resetting
    - On `workItemId` change, call `getImplementChatState(projectKey, workItemId)`
    - If stored state exists, hydrate all fields: `sessionId`, `messages`, `generatedSpecs`, `error`, `inputMessage` (from `inputDraft`)
    - If stored state is `undefined` (new work item), reset to empty defaults
    - Remove unconditional reset of all state
  - [x] 3.4 Create `persistChatState` helper function
    - Build `ImplementChatUiState` object from current local state
    - Call `setImplementChatState(projectKey, workItemId, state)`
  - [x] 3.5 Add write-through persistence on state changes
    - Call `persistChatState` after `setMessages` updates in `handleSend` and `handleImplement`
    - Call `persistChatState` after `setSessionId` updates
    - Call `persistChatState` after `setGeneratedSpecs` updates
    - Call `persistChatState` after `setError` updates
  - [x] 3.6 Persist `inputDraft` on input change
    - Modify `setInputMessage` handler to also call `persistChatState`
    - Use debounce or throttle if needed for performance (optional optimization)
  - [x] 3.7 Ensure ImplementationAssistantPanel tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify chat state persists and hydrates correctly

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Chat messages, session, and specs persist across tab switches
- Input draft is preserved when switching tabs
- New work items start with empty state
- Returning to a previously-visited work item restores full conversation

---

### Testing and Edge Cases

#### Task Group 4: Test Review, Gap Analysis, and Edge Cases
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written for context layer (Task 1.1)
    - Review the 5 tests written for ProductView (Task 2.1)
    - Review the 5 tests written for ImplementationAssistantPanel (Task 3.1)
    - Total existing tests: 14 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify edge cases not covered by existing tests
    - Focus on cross-component integration scenarios
    - Prioritize error recovery and boundary conditions
  - [x] 4.3 Write up to 6 additional strategic tests for edge cases
    - Test: Stored `lastImplementWorkItemId` references deleted work item - falls back to empty state
    - Test: Project switch (different `loadedFileName`) isolates Implement state completely
    - Test: Browser back/forward navigation preserves resolved effective work item ID
    - Test: Multiple rapid tab switches do not corrupt state
    - Test: Context handles empty projectKey (no project loaded) gracefully
    - Test: Chat state with `Date` objects in messages serializes/hydrates correctly
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: 20 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (48 tests total - exceeds expected 20)
- Edge cases for deleted work items and project switching are covered
- No state leakage between projects
- Graceful handling of missing or invalid stored state

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Context Layer** - Foundation for all state storage
2. **Task Group 2: ProductView Integration** - Tab switch handling and work item ID resolution
3. **Task Group 3: ImplementationAssistantPanel Integration** - Chat state hydration and persistence
4. **Task Group 4: Test Review and Edge Cases** - Verify integration and handle edge cases

---

## Summary Table

| Task Group | Description | Task Count | Dependencies |
|------------|-------------|------------|--------------|
| 1 | Context Layer Extensions | 9 | None |
| 2 | ProductView Integration | 7 | Group 1 |
| 3 | ImplementationAssistantPanel Integration | 7 | Groups 1, 2 |
| 4 | Test Review and Edge Cases | 4 | Groups 1-3 |
| **Total** | | **27 sub-tasks** | |

---

## Key Files Modified

| File | Purpose |
|------|---------|
| `frontend/src/contexts/ProductUiStateContext.tsx` | Added Implement state types and context methods |
| `frontend/src/components/ProductView/ProductView.tsx` | Store/resolve lastImplementWorkItemId on tab switches |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Hydrate and persist chat state to context |

---

## Test Files Created

| File | Tests |
|------|-------|
| `frontend/src/__tests__/ImplementChatStateContext.test.ts` | 15 tests - Context method tests |
| `frontend/src/__tests__/ProductViewTabState.test.ts` | 10 tests - Tab switch state behavior |
| `frontend/src/__tests__/ImplementChatStatePersistence.test.ts` | 11 tests - Chat state persistence |
| `frontend/src/__tests__/ImplementTabStateEdgeCases.test.ts` | 12 tests - Edge case coverage |
| **Total** | **48 tests** |

---

## Notes

- **In-memory only**: This feature stores state in React context only. No localStorage or backend persistence is required for this increment.
- **Project isolation**: All state is keyed by `projectKey` derived from `loadedFileName`. Switching projects shows completely isolated Implement state.
- **URL is ephemeral**: The URL `workItemId` param is cleared when leaving Implement tab but the context retains the stored work item ID for restoration.
- **ChatMessage serialization**: The `ChatMessage` type contains `Date` objects for `timestamp`. These are preserved correctly through the in-memory context storage.
