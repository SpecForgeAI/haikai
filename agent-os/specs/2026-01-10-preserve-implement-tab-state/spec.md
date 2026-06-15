# Specification: Preserve Implement Tab State Across Product & Delivery Tab Switches

## Goal
When a user switches away from the Implement tab and returns, the tab must automatically restore the last active work item and its full chat conversation state (messages, session identity, generated specs panel) without requiring URL query parameters to remain set. State must be scoped per project.

## User Stories
- As a developer, I want to switch to Backlog or Roadmap and return to Implement without losing my clarification chat so that my conversation context is preserved.
- As a developer working on multiple projects, I want my Implement state to be isolated per project so that switching projects does not leak conversation context.

## Specific Requirements

**Extend ProductUiStateContext with Implement state storage**
- Add `lastImplementWorkItemId: Record<projectKey, string | null>` to track the last selected work item per project
- Add `implementChatStateByWorkItemId: Record<projectKey, Record<workItemId, ImplementChatUiState>>` to store chat state per project per work item
- Define `ImplementChatUiState` interface containing: `sessionId: string | null`, `messages: ChatMessage[]`, `generatedSpecs: string[] | null`, `error: string | null`, `inputDraft: string`
- Expose context methods: `getLastImplementWorkItemId(projectKey)`, `setLastImplementWorkItemId(projectKey, workItemId)`, `getImplementChatState(projectKey, workItemId)`, `setImplementChatState(projectKey, workItemId, state)`
- State remains in-memory only; no localStorage or backend persistence for this increment

**ProductView: Store and resolve lastImplementWorkItemId on tab switch**
- When navigating to Implement via `handleWorkOnThis(itemId)`, call `setLastImplementWorkItemId(projectKey, itemId)` in addition to existing URL update
- When leaving Implement tab via `handleTabChange('backlog')` or `handleTabChange('roadmap')`, do NOT clear the stored `lastImplementWorkItemId`
- When entering Implement tab with `workItemId === null` (URL cleared), resolve `effectiveWorkItemId` from `getLastImplementWorkItemId(projectKey)` and pass to ProductImplementPage
- URL remains without `workItemId` param when entering via tab click; state is in-memory only

**ProductImplementPage: Accept effectiveWorkItemId**
- No behavioural change required; continue rendering based on received `workItemId` prop
- Empty state shown only when both `workItemId` is null AND no `lastImplementWorkItemId` exists for the project

**ImplementationAssistantPanel: Hydrate and persist chat state to context**
- On mount or when `workItemId` changes, call `getImplementChatState(projectKey, workItemId)` to load existing state
- If stored state exists, hydrate `sessionId`, `messages`, `generatedSpecs`, `error`, and `inputDraft` from it
- On any state change (new message, sessionId set, specs generated, error set, input draft change), call `setImplementChatState(projectKey, workItemId, updatedState)` to write-through
- Remove the `useEffect` that unconditionally resets all state on `workItemId` change; only reset when workItemId changes to a NEW item with no stored state
- Preserve `inputMessage` (input draft) across tab switches

**Project isolation guarantees**
- All state is keyed by `projectKey` derived from `loadedFileName` via existing `deriveProjectKey()` utility
- When project changes (different `loadedFileName`), the new project has its own independent Implement state
- No state leaks between projects; switching projects shows the correct Implement state for that project

**Handle edge cases**
- If stored `lastImplementWorkItemId` references a work item that no longer exists in the loaded work items list, fall back to empty state
- If `loadedFileName` is null (no project loaded), continue showing the existing "No project loaded" empty state
- If a project has never had an Implement selection, continue showing the existing empty state prompting user to select from Backlog

## Existing Code to Leverage

**ProductUiStateContext (`src/contexts/ProductUiStateContext.tsx`)**
- Already provides project-scoped in-memory state management with `ProductUiState = Record<projectKey, ProjectTabState>` pattern
- Implements `deriveProjectKey(loadedFileName)` utility for consistent project keying
- Uses `useState` with callback-based `setState` for immutable updates
- Exposes context via `useProductUiState()` hook; follow same pattern for new methods
- Contains `useProductExpansion` convenience hook pattern that can be replicated for Implement state

**ProductView (`src/components/ProductView/ProductView.tsx`)**
- Already manages `workItemId` state and URL query parameters via `updateUrl()` helper
- Uses `handleWorkOnThis(itemId)` for navigation from Backlog to Implement; add context update here
- Uses `handleTabChange(tab)` for tab switching; conditionally preserve/clear workItemId based on target tab
- Already wrapped with `ProductUiStateProvider` so context access is available

**ImplementationAssistantPanel (`src/components/ProductView/ImplementationAssistantPanel.tsx`)**
- Manages `sessionId`, `messages`, `generatedSpecs`, `error`, `inputMessage`, `isLoading` as local state
- Has `useEffect` on `[workItemId]` that resets all state; modify to check for existing stored state first
- ChatMessage type defined in `src/api/chatApi.ts` with `id`, `role`, `content`, `timestamp` fields
- Uses callbacks `handleSend`, `handleImplement` that update state; add write-through to context in these

**ProductImplementPage (`src/components/ProductView/ProductImplementPage.tsx`)**
- Receives `workItemId` prop from ProductView and passes to ImplementationAssistantPanel
- Uses `loadedFileName` from `useArchitecture()` context; same pattern for project key derivation

## Out of Scope
- Persisting chat conversations to backend storage (audit/history/resume after page reload)
- Surviving full browser refresh or hard reload (state is in-memory only)
- Any changes to Gateway, MCP server, or architecture-model-service
- Adding workItemId back to URL when navigating to Implement via tab click
- localStorage persistence of chat state
- Clearing old/stale Implement state when work items are deleted from backend
- UI for manually clearing Implement state or resetting conversations
- Supporting multiple concurrent chat sessions per work item
- Chat history pagination or virtualization
- Undo/redo for chat state changes
