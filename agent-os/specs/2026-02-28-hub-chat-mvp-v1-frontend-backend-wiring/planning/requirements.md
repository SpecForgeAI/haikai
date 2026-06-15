# Spec Requirements: Hub Chat MVP v1 (Frontend + Backend Wiring)

## Initial Description

Increment 3 of the 11-increment unified conversation engine plan. Increments 1 (Backend) and 2 (Frontend) are complete and verified:
- Increment 1: POST /api/chat/v2 endpoint, persona/task registries, thread persistence, prompt composition pipeline (88 tests passing)
- Increment 2: Reusable UnifiedChatPanel React component with ChatThread, ChatInputBar, MentionInput, TaskMenu, StructuredQuestionsRenderer, useChatThread hook, GET /api/chat/v2/thread endpoint, Dashboard integration (44 tests passing)

This increment wires everything together for a working Hub Chat experience on the Dashboard:

1. Hub Chat as Primary Dashboard Experience -- Replace PersonaHelperPanel placeholder with the real UnifiedChatPanel as the primary chat experience.
2. @-Mention Persona Selection Flow (End-to-End) -- Wire the full @-mention -> persona selection -> task menu -> task selection -> conversation flow.
3. Persona Handoff Protocol -- When user @-mentions a different persona mid-conversation, switch persona, reset task, show system message.
4. Remove/Replace PersonaHelperPanel -- Remove placeholder panel, clean up PersonaPanelContext if no longer used.
5. Hub Thread Identity -- Hub threads use ThreadKey { type: 'hub', projectId }, one per project, persist across refreshes.

Key Constraint: This is about WIRING -- connecting Increment 2 components to create a working end-to-end chat experience. Minimal new component creation; mostly integration, flow validation, and cleanup.

## Requirements Discussion

### First Round Questions

**Q1:** Current dual-panel situation on Dashboard. Right now, `DashboardView.tsx` renders both `UnifiedChatPanel` (fixed-position RHS, always visible when a project is selected) and triggers `PersonaHelperPanel` (also fixed-position RHS, toggled via `openPanel()` on card clicks). These two panels would overlap visually since both are right-anchored. I assume the intent for this increment is to remove PersonaHelperPanel entirely and replace its role with UnifiedChatPanel -- so that clicking a Dashboard card's "Open" button either (a) navigates to the target screen only, or (b) navigates AND switches the UnifiedChatPanel to the relevant persona. Which behavior do you want for Dashboard card "Open" buttons?

**Answer:** Navigate AND switch the UnifiedChatPanel to the relevant persona.

*Note from code analysis: All current card "Open" buttons in DashboardView navigate away from the Dashboard to other screens (metamodel, product, roadmap, backlog, implement). Since UnifiedChatPanel is currently only rendered inside DashboardView, navigating away causes the panel to disappear. The "navigate AND switch" behavior described here will require consideration of when/where UnifiedChatPanel is visible. For this increment (Dashboard Hub MVP), the practical effect is: (1) remove the `openPanel()` calls that triggered PersonaHelperPanel, (2) for cards that navigate away from Dashboard, the existing navigation behavior continues as-is, and (3) the UnifiedChatPanel on the Dashboard itself is always available when the user is on the Dashboard. Wiring side panels on non-Dashboard screens is Increment 8-9 scope.*

*Additionally, DashboardView uses display names that don't all match the persona config: "Solution Architect" (persona config uses "Architect"), and "Implementation Assistant" (no matching persona). The mapping from card actions to persona IDs will need to be resolved during implementation.*

---

**Q2:** PersonaPanelContext cleanup scope. My grep shows `PersonaPanelContext` is consumed by exactly three places: (a) `DashboardView.tsx` via `useOpenPersonaPanel`, (b) `PersonaHelperPanel.tsx` via `usePersonaPanel` and `useClosePersonaPanel`, and (c) `App.tsx` (provider + renders `PersonaHelperPanel`). No other screens use it. I assume we should remove `PersonaPanelContext.tsx`, `PersonaPanelProvider`, `PersonaHelperPanel.tsx`, and `PersonaHelperPanel.module.css` entirely as part of this increment, and update the three consumer files accordingly. Is that correct, or should we keep the context/provider infrastructure for potential future use?

**Answer:** Remove PersonaPanelContext entirely (context, provider, component, CSS).

*Files to remove:*
- `frontend/src/contexts/PersonaPanelContext.tsx`
- `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx`
- `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css`

*Files to update:*
- `frontend/src/App.tsx` -- Remove `PersonaPanelProvider` wrapper and `PersonaHelperPanel` render
- `frontend/src/components/DashboardView/DashboardView.tsx` -- Remove `useOpenPersonaPanel` import and all `openPanel()` calls from card buttons

*Test files affected (mocking PersonaPanelContext):*
- `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx`
- `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`
- `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx`
- `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx`
- `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx`
- `frontend/src/__tests__/DashboardView.personaPanel.test.tsx`
- `frontend/src/__tests__/DashboardView.test.tsx`
- `frontend/src/__tests__/PersonaHelperPanel.test.tsx`
- `frontend/src/__tests__/PersonaPanelContext.test.tsx`
- `frontend/src/components/UnifiedChat/__tests__/containerIntegration.test.tsx`

---

**Q3:** End-to-end @-mention flow gap: first message triggers task menu before conversation. Currently in `useChatThread.ts`, when the user types `@Architect` and sends a message, the flow is: (a) `MentionInput` calls `onPersonaSelected('architect')` which calls `selectPersona('architect')` -- this sets `activePersonaId='architect'` and `activeTaskId='unknown'`, (b) then `sendMessage` fires with `taskId='unknown'`, (c) the backend sees `taskId='unknown'` and returns the task menu without ever sending the user's actual message to the LLM. The user's typed message content is effectively lost -- the backend short-circuits at Step 4 and returns the menu. I assume the intended UX is: user types `@Architect`, persona switches, task menu appears, user picks a task, then the original message (or a new one) goes to the LLM. Should the first message after an @-mention be suppressed/queued until a task is selected, or should we auto-send the first message after the task menu is displayed and a task is chosen?

**Answer:** Suppress/queue the first message after @-mention and auto-send it once a task is selected.

*Implementation implications: The `useChatThread` hook needs a "pending message" concept. When a persona is selected via @-mention and the user sends a message while `activeTaskId='unknown'`:*
1. *The message text is stored in a pending/queued state (not sent to the API yet)*
2. *A POST is made to get the task menu (with the current short-circuit behavior)*
3. *The task menu is displayed*
4. *When the user selects a task, `selectTask` fires, sets the `activeTaskId`, and automatically sends the queued message with the now-known `taskId`*
5. *The `@PersonaName` prefix must be stripped from the queued message before sending (per Q7)*

---

**Q4:** Persona handoff mid-conversation. The raw idea mentions "when user @-mentions a different persona mid-conversation, switch persona, reset task, show system message." Currently `selectPersona` just sets state silently (no system message, no visual indicator in the thread). I assume for this increment we should: (a) insert a system-role message like "Switched to Architect" into the thread, (b) reset `activeTaskId` to `'unknown'` (already done), (c) trigger the task menu display for the new persona. Should the system message include any context summary for the new persona, or is a simple "Switched to [Persona Name]" sufficient for MVP?

**Answer:** Insert a simple system message like "Switched to Architect" with no additional context summary.

*The system message uses the persona's `displayName` from `personaConfig.ts` (e.g., "Switched to Architect", "Switched to Product Manager"). This is a simple local system message in the frontend.*

---

**Q5:** Hub thread creation timing. Currently `useChatThread` calls `getThreadHistory(threadKey)` on mount. If no thread exists, the backend GET handler returns an empty thread object (not persisted to disk). The thread is only persisted when `POST /api/chat/v2` is first called (which calls `createThread` if none exists). I assume this is the correct behavior -- the hub thread is created lazily on first message send, not eagerly on Dashboard load. Is that correct?

**Answer:** Yes, lazy thread creation on first send with GET returning empty thread is correct.

---

**Q6:** Backend changes needed: task menu response and persona handoff. Looking at the POST handler, when `taskId='unknown'` the backend returns the task menu but does not persist the user's message to the thread (it short-circuits before the append step). For the task menu flow, this seems intentional -- the initial "greeting" message doesn't need LLM processing. However, for persona handoff (switching mid-conversation), should the backend persist a system message marking the handoff, or should that be purely a frontend concern (inserting a local system message)?

**Answer:** Persist the persona handoff as a system message in the backend.

*This means the backend needs a new mechanism to accept and persist a system-role "persona handoff" message. Options include:*
- *A new endpoint (e.g., POST /api/chat/v2/handoff) that accepts threadKey and newPersonaId, persists a system message, and returns the updated thread*
- *Or extending the existing POST /api/chat/v2 handler to recognize a special request type for handoff*
- *The persisted system message ensures handoff markers appear when thread history is rehydrated across page reloads*

---

**Q7:** Should the @-mention text be stripped from the sent message? When the user types `@Architect what's your take on microservices?`, the `MentionInput` inserts `@Architect ` into the textarea value. Currently `sendMessage` would send the raw text including `@Architect` prefix to the backend. Should we strip the `@PersonaName` prefix from the message before sending it to the API, or keep it in the message content?

**Answer:** Yes, strip the @Persona token from the message before sending to the API.

*Implementation: Before sending, strip any leading `@DisplayName ` pattern from the message text. The stripping should handle all persona display names from `PERSONA_CONFIGS`. This should happen in `useChatThread.sendMessage` or at the call site before the API request.*

---

**Q8:** Initial welcome/greeting behavior. When the Dashboard loads and UnifiedChatPanel appears with an empty thread, should it: (a) show an empty chat with just the input bar and placeholder text, (b) auto-send a greeting from the Assistant persona (e.g., "Welcome! Type @PersonaName to start a conversation"), or (c) show a static welcome message (not from the API, just a local UI element)?

**Answer:** Start with an empty chat and a placeholder (no auto-send greeting yet).

*The existing MentionInput already has placeholder text: "Type a message... Use @ to mention a persona". This is sufficient for MVP.*

---

**Q9:** Error handling for API failures. The current `useChatThread` already appends a system-role error message to the local message list on API failure, and sets `error` state. I assume this is sufficient for MVP -- no toast notifications, no retry buttons, no special error UI beyond the in-thread error message. Is that correct?

**Answer:** Yes, simple in-thread error messages are sufficient for MVP.

---

**Q10:** Existing v1 chat panels (ProductManagerChatPanel, SolutionArchitectChatPanel, etc.). The design document's Increment 10 explicitly covers removing these legacy chat surfaces. I assume this increment (Increment 3) should NOT touch or modify any of the existing v1 chat panels -- they continue working independently via the original `POST /api/chat` endpoint. Correct?

**Answer:** Correct, existing v1 chat panels remain untouched and continue using POST /api/chat.

---

**Q11:** Multiple personas overlapping in the same thread. When a user starts with `@ProductManager`, completes a task, then switches to `@Architect` -- the thread history contains messages from both personas. When the backend composes the system prompt for Architect, it includes the full thread history (all PM messages too). Is this intentional for MVP (the architect "sees" the PM conversation), or should thread history be filtered to only include messages from the currently active persona?

**Answer:** Full thread history should be sent across persona switches (no per-persona filtering).

*The full thread history is intentional -- each persona benefits from seeing the complete conversation context. The backend's current behavior in `chatV2.ts` (Step 7) already sends all non-system messages from thread history, which aligns with this requirement.*

---

**Q12:** What does "Increment 3" scope explicitly exclude? Based on the design document, I want to confirm the following are explicitly out of scope for this increment: (a) artifact hooks/saves (Increments 4-7), (b) completion chips for sealed segments (Increments 4-7), (c) assistant "What's Next?" project-state awareness (requires context resolvers not yet wired), (d) side panel on non-Dashboard screens (Increments 8-9), (e) thread summarisation (Increment 11). Are there any other items you want explicitly in or out of scope?

**Answer:** Correct, all listed items are out of scope; also out of scope: streaming and advanced task orchestration logic.

### Existing Code to Reference

No additional similar features were identified beyond the already-known Increment 1 and Increment 2 codebases.

**Key existing code paths for the spec-writer to reference:**

Frontend (Increment 2 -- already built):
- `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` -- Container component
- `frontend/src/components/UnifiedChat/ChatThread.tsx` -- Message list renderer
- `frontend/src/components/UnifiedChat/ChatInputBar.tsx` -- Input bar with MentionInput
- `frontend/src/components/UnifiedChat/MentionInput.tsx` -- @-mention dropdown
- `frontend/src/components/UnifiedChat/TaskMenu.tsx` -- Task selection cards
- `frontend/src/components/UnifiedChat/MessageBubble.tsx` -- Message rendering (handles task-menu and questions)
- `frontend/src/hooks/useChatThread.ts` -- State management hook (primary modification target)
- `frontend/src/api/chatV2Api.ts` -- API client
- `frontend/src/config/personaConfig.ts` -- Persona configs (6 personas with IDs, displayNames, colors, initials)

Dashboard integration:
- `frontend/src/components/DashboardView/DashboardView.tsx` -- Already renders UnifiedChatPanel; needs PersonaPanelContext removal
- `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` -- To be deleted
- `frontend/src/contexts/PersonaPanelContext.tsx` -- To be deleted
- `frontend/src/App.tsx` -- Provider and component removal

Backend (Increment 1 -- already built):
- `gateway/src/routes/chatV2.ts` -- POST and GET endpoints (needs handoff system message support)
- `gateway/src/services/registryLoader.ts` -- Persona/task registries
- `gateway/src/services/promptComposer.ts` -- Prompt composition
- `gateway/src/services/threadStore.ts` -- Thread persistence (createThread, getThread, appendMessage, rehydrate)
- `gateway/src/config/personas/` -- 6 persona JSON configs
- `gateway/src/config/tasks/` -- 16 task JSON configs

Design document:
- `docs/unified-conversation-engine-analysis.txt` -- Full design (sections 9-14 most relevant for Hub Chat UI, thread lifecycle, and increment plan)

### Follow-up Questions

No follow-up questions were needed. All 12 answers were clear and specific.

## Visual Assets

### Files Provided:
No visual assets provided. The mandatory filesystem check confirmed no image files exist in `agent-os/specs/2026-02-28-hub-chat-mvp-v1-frontend-backend-wiring/planning/visuals/`.

### Visual Insights:
N/A -- No visual assets to analyze.

## Requirements Summary

### Functional Requirements

1. **Hub Chat as primary Dashboard experience**: UnifiedChatPanel is the sole chat interface on the Dashboard. PersonaHelperPanel is removed entirely.

2. **End-to-end @-mention flow with message queuing**: When the user types `@PersonaName` and sends a message:
   - The persona switches (activePersonaId updates)
   - The user's message is queued (not sent to API yet)
   - The `@PersonaName` prefix is stripped from the queued message
   - A POST with `taskId='unknown'` triggers the task menu display
   - When the user selects a task from the menu, the queued message is auto-sent with the selected taskId

3. **Persona handoff with persisted system message**: When a user @-mentions a different persona mid-conversation:
   - A system message "Switched to [Persona DisplayName]" is persisted to the backend thread
   - activeTaskId resets to 'unknown'
   - The task menu for the new persona is displayed
   - Full thread history (cross-persona) is sent to the LLM -- no per-persona filtering

4. **PersonaPanelContext complete removal**: Delete `PersonaPanelContext.tsx`, `PersonaHelperPanel.tsx`, `PersonaHelperPanel.module.css`. Remove provider from `App.tsx`. Remove all `openPanel()` calls from `DashboardView.tsx`. Update/remove affected tests.

5. **Hub thread identity**: ThreadKey `{ type: 'hub', projectId }`, one per project, lazy creation on first message send, persists across page reloads via GET /api/chat/v2/thread rehydration.

6. **Empty initial state**: Chat panel loads with empty thread and placeholder text. No auto-greeting or welcome message.

7. **Simple error handling**: In-thread system-role error messages on API failure. No toast, retry button, or special error UI.

8. **Backend handoff persistence**: The backend needs a mechanism to accept and persist system-role "persona handoff" messages so they survive thread rehydration across page reloads.

### Reusability Opportunities

- All Increment 2 components are reused as-is (UnifiedChatPanel, ChatThread, ChatInputBar, MentionInput, TaskMenu, MessageBubble)
- The `useChatThread` hook is the primary modification target (add message queuing, @-mention stripping, handoff system messages)
- `personaConfig.ts` provides the display name to ID mapping needed for @-mention stripping
- Backend `threadStore.ts` `appendMessage` can be reused for persisting handoff system messages
- Backend `chatV2.ts` POST handler's existing `taskId='unknown'` short-circuit behavior remains the mechanism for task menu retrieval

### Scope Boundaries

**In Scope:**
- Wiring @-mention -> persona selection -> task menu -> task selection -> conversation (end-to-end)
- Message queuing: suppress message on @-mention, auto-send after task selection
- Stripping @PersonaName prefix from messages before API send
- Persona handoff: system message insertion (frontend + backend persistence)
- Removing PersonaHelperPanel and PersonaPanelContext entirely
- Removing openPanel() calls from DashboardView card buttons
- Hub thread identity with lazy creation
- Updating/removing affected test files

**Out of Scope:**
- Artifact hooks and saves (Increments 4-7)
- Completion chips for sealed bootstrap segments (Increments 4-7)
- Assistant "What's Next?" project-state awareness and context resolvers (future increment)
- Side panels on non-Dashboard screens (Increments 8-9)
- Removing legacy v1 chat panels -- ProductManagerChatPanel, SolutionArchitectChatPanel, etc. (Increment 10)
- Thread summarisation (Increment 11)
- Streaming responses
- Advanced task orchestration logic
- Auto-greeting or welcome message on empty threads
- Toast notifications, retry buttons, or advanced error UI

### Technical Considerations

- **PersonaName display mismatch**: DashboardView card actions currently use display names like "Solution Architect" and "Implementation Assistant" that don't match `personaConfig.ts` entries ("Architect" and no match). After removing `openPanel()` calls, these mismatches become irrelevant for this increment but will need attention in Increments 8-9 when side panels are added to other screens.
- **@-mention stripping**: Must handle all 6 persona display names from `PERSONA_CONFIGS`: "Assistant", "Product Manager", "Architect", "UX Designer", "Test Engineer", "Software Developer". The strip logic must match the `@DisplayName ` pattern that `MentionInput` inserts.
- **Message queuing in useChatThread**: This is new state management that needs to interact correctly with the existing `sendMessage`, `selectPersona`, and `selectTask` functions. The queued message must survive the task menu round-trip.
- **Backend handoff endpoint design**: Need to decide between a new dedicated endpoint (e.g., POST /api/chat/v2/handoff) or extending the existing POST handler. The endpoint must accept a threadKey and newPersonaId, persist a system message, and optionally update the thread's activePersonaId/activeTaskId fields.
- **Test file cleanup**: 10+ test files mock or reference PersonaPanelContext. These need updating as part of the removal. Some test files (e.g., `PersonaHelperPanel.test.tsx`, `PersonaPanelContext.test.tsx`, `DashboardView.personaPanel.test.tsx`) can be deleted entirely. Others need their PersonaPanelContext mocks removed.
- **Thread history includes system messages**: The backend currently skips system-role messages from thread history when building the LLM messages array (chatV2.ts Step 7). This means persisted handoff system messages will not pollute the LLM context, which is correct behavior.
