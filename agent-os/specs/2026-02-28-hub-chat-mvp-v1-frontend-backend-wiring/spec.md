# Specification: Hub Chat MVP v1 (Frontend + Backend Wiring)

## Goal

Wire the Increment 2 UnifiedChatPanel components to the Increment 1 backend for a working end-to-end Hub Chat experience on the Dashboard -- connecting @-mention persona selection, task menu flow, persona handoff, and message queuing -- while removing the now-replaced PersonaHelperPanel infrastructure entirely.

## User Stories

- As a user on the Dashboard, I want to type `@Architect` in the chat panel, see a task menu, select a task, and have my original message sent to the selected persona so that I can have a complete conversation without re-typing my question.
- As a user mid-conversation, I want to @-mention a different persona and see a "Switched to [Persona]" system message so that I know the conversation context has changed and can select a new task for the new persona.
- As a user returning to the Dashboard after a page reload, I want to see my full Hub Chat history including persona handoff markers so that I have continuity across sessions.

## Specific Requirements

**Message queuing in useChatThread on @-mention**
- Add a `pendingMessage` ref (or state) to `useChatThread.ts` that holds the user's queued message text when `activeTaskId` is `'unknown'` at the time of send
- When `sendMessage` is called and `activeTaskId === 'unknown'`, store the message text in `pendingMessage` instead of sending it to the API; then fire a POST with `taskId='unknown'` and an empty/minimal message to retrieve the task menu
- The optimistic user message should still be appended to the local messages array so the user sees their message in the thread
- When `selectTask` is called and a `pendingMessage` exists, auto-send the queued message with the newly selected `taskId` via `sendMessage`, then clear `pendingMessage`
- If `selectTask` is called with no `pendingMessage`, fall back to the current behaviour (send "Selected task: {label}")
- The queued message must survive the full task menu round-trip (POST for menu, user clicks task card, then auto-send)

**Strip @-mention token from messages before API send**
- In `useChatThread.sendMessage`, before building the `ChatV2Request`, strip any leading `@DisplayName ` pattern from the message text
- Build a regex or string match using all 6 display names from `PERSONA_CONFIGS` in `personaConfig.ts`: "Assistant", "Product Manager", "Architect", "UX Designer", "Test Engineer", "Software Developer"
- The strip should handle the exact pattern that `MentionInput.handleSelectPersona` inserts: `@{displayName} ` (with trailing space) at the start of the message
- The stripped text is what gets stored in `pendingMessage`, sent to the API, and shown in the optimistic user message (the user sees the clean message, not the raw `@Persona` prefix)

**Persona handoff with system message (frontend)**
- In `useChatThread.selectPersona`, when the persona is actually changing (new `personaId !== current activePersonaId`), insert a local system-role `ThreadMessage` into the messages array with content `"Switched to {displayName}"` using the persona's `displayName` from `getPersonaConfig(personaId)`
- After inserting the local system message, call a new backend endpoint to persist the handoff system message so it survives page reloads
- Continue resetting `activeTaskId` to `'unknown'` as currently implemented
- If `selectPersona` is called with the same persona that is already active, skip the handoff system message (no-op beyond what already happens)

**Backend persona handoff endpoint**
- Add a new POST route `POST /api/chat/v2/handoff` to `chatV2Router` in `gateway/src/routes/chatV2.ts`
- Request body: `{ threadKey: ThreadKey, personaId: string }` -- the new persona being switched to
- The handler should: (1) resolve or create the thread via `getThread`/`createThread`, (2) build a system-role `ThreadMessage` with content `"Switched to {displayName}"` using the persona registry to look up the display name, (3) call `appendMessage(threadKey, systemMessage)` to persist it, (4) return `{ success: true, threadKey: string }` as JSON
- Return 400 if `threadKey` or `personaId` is missing/invalid; return 400 if `personaId` is not found in the persona registry
- The backend's existing POST handler (Step 7) already skips system messages from thread history when building LLM messages, so persisted handoff markers will not pollute LLM context

**Frontend API client for handoff**
- Add a new function `postHandoff(threadKey: ThreadKey, personaId: string): Promise<void>` to `frontend/src/api/chatV2Api.ts`
- POST to `/api/chat/v2/handoff` with JSON body `{ threadKey, personaId }`
- Follow the same fetch + error-throw pattern as `postChatV2`
- `useChatThread.selectPersona` should call this function; failures should be logged to console but not block the frontend persona switch (fire-and-forget with error logging)

**DashboardView cleanup: remove PersonaHelperPanel wiring**
- Remove the `import { useOpenPersonaPanel } from '../../contexts/PersonaPanelContext'` line from `DashboardView.tsx`
- Remove the `const openPanel = useOpenPersonaPanel()` call (line 125)
- Remove all `openPanel(...)` calls from every card "Open" button's `onClick` handler (lines 271, 285, 300, 319, 400, 415, 430, 457, 469) -- the `navigateTo(dispatch, ...)` calls remain as-is
- No new "switch UnifiedChatPanel persona" wiring is needed on card buttons for this increment because all card buttons navigate away from Dashboard (causing UnifiedChatPanel to unmount); side-panel persona switching on non-Dashboard screens is Increments 8-9 scope

**App.tsx cleanup: remove PersonaPanelProvider and PersonaHelperPanel**
- Remove the `import { PersonaPanelProvider } from './contexts/PersonaPanelContext'` line
- Remove the `import { PersonaHelperPanel } from './components/PersonaHelperPanel/PersonaHelperPanel'` line
- Remove the `<PersonaPanelProvider>` wrapper around `<AppContent />` (line 160-162) -- `AppContent` becomes a direct child of `<ArchitectureProvider>`
- Remove the `<PersonaHelperPanel />` render (line 147)

**File deletions**
- Delete `frontend/src/contexts/PersonaPanelContext.tsx` entirely
- Delete `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` entirely
- Delete `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` entirely
- Delete test files that solely test removed code: `frontend/src/__tests__/PersonaHelperPanel.test.tsx`, `frontend/src/__tests__/PersonaPanelContext.test.tsx`, `frontend/src/__tests__/DashboardView.personaPanel.test.tsx`

**Test file updates (remove PersonaPanelContext mocks)**
- Update the following test files to remove `PersonaPanelContext` mocking, `PersonaPanelProvider` wrappers, and `openPanel` assertions: `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx`, `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`, `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx`, `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx`, `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx`, `frontend/src/__tests__/DashboardView.test.tsx`, `frontend/src/components/UnifiedChat/__tests__/containerIntegration.test.tsx`
- Any test assertions that verify `openPanel` was called on card click should be removed or replaced with assertions that only `navigateTo` behaviour occurs
- Add new tests for `useChatThread` covering: message queuing when `activeTaskId='unknown'`, @-mention stripping, auto-send after task selection, persona handoff system message insertion, and fire-and-forget `postHandoff` call

**Hub thread identity and lazy creation**
- No changes needed -- the current implementation already handles this correctly: `useChatThread` calls `getThreadHistory` on mount which returns an empty thread from the GET handler; the thread is only persisted to disk when the first `POST /api/chat/v2` fires (which calls `createThread` in the POST handler if no thread exists)
- The `chatThreadKey` construction in `DashboardView.tsx` (line 231) already builds `{ type: 'hub', projectId: activeProject.id }` correctly

**Empty initial state and error handling**
- No changes needed -- the current `MentionInput` placeholder "Type a message... Use @ to mention a persona" is sufficient for MVP; the existing error handling in `useChatThread.sendMessage` (appending a system-role error message to the thread) remains as-is

## Existing Code to Leverage

**`frontend/src/hooks/useChatThread.ts` (lines 74-286)**
- Primary modification target; all new logic (message queuing, @-mention stripping, handoff system messages) is added to this single file
- Existing `sendMessage` (lines 146-231) provides the optimistic append + API call + error handling pattern that the queuing logic wraps around
- Existing `selectPersona` (lines 237-240) provides the hook point for inserting handoff system messages
- Existing `selectTask` (lines 246-270) provides the hook point for auto-sending queued messages
- Existing `lastStructuredResponseRef` pattern (line 91) demonstrates how to use refs for cross-callback state, which the `pendingMessage` ref should follow

**`frontend/src/config/personaConfig.ts` (lines 39-46)**
- `PERSONA_CONFIGS` array provides all 6 display names needed for building the @-mention stripping regex/pattern
- `getPersonaConfig(personaId)` provides the `displayName` lookup needed for handoff system message content ("Switched to {displayName}")

**`gateway/src/routes/chatV2.ts` (lines 292-503)**
- The POST handler's Step 4 (lines 336-361) shows the `taskId='unknown'` short-circuit pattern that returns the task menu; this existing behaviour is relied upon for the task menu retrieval step of the queuing flow
- The POST handler's Step 7 (lines 397-426) shows that system messages are already skipped from thread history when building LLM messages, confirming that persisted handoff messages will not pollute LLM context
- The GET handler (lines 216-269) shows the empty thread return pattern used on first load

**`gateway/src/services/threadStore.ts` (lines 174-204)**
- `appendMessage(threadKey, message)` is the exact function the new handoff endpoint will call to persist the system-role handoff message
- The atomic write pattern is already handled internally; the handoff endpoint just needs to call `appendMessage` with a properly formed `ThreadMessage`

**`frontend/src/api/chatV2Api.ts` (lines 213-243)**
- `postChatV2` (lines 213-225) provides the exact fetch + error-throw pattern to replicate for the new `postHandoff` function
- `generateMessageId` (lines 192-194) provides the ID generation needed for creating the local system message in `selectPersona`

## Out of Scope

- Streaming responses (SSE or WebSocket) -- all responses remain synchronous request/response
- Artifact hooks, saves, or preview UX (Increments 4-7)
- Completion chips for sealed bootstrap segments (Increments 4-7)
- Assistant "What's Next?" project-state awareness and context resolvers (future increment)
- Side panels on non-Dashboard screens (Increments 8-9) -- card "Open" buttons continue to navigate only; no persona switching on non-Dashboard screens
- Removing legacy v1 chat panels (ProductManagerChatPanel, SolutionArchitectChatPanel, etc.) -- they remain untouched and continue using POST /api/chat (Increment 10)
- Thread summarisation and context windowing (Increment 11)
- Advanced task orchestration logic beyond the single @-mention to task-menu to conversation flow
- Auto-greeting, welcome message, or static welcome UI on empty threads
- Toast notifications, retry buttons, or any error UI beyond in-thread system error messages
- Markdown rendering in message content (plain text only)
- Modifying any existing v1 chat components or the POST /api/chat endpoint
