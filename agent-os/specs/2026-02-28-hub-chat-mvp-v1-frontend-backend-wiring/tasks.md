# Task Breakdown: Hub Chat MVP v1 (Frontend + Backend Wiring)

## Overview
Total Tasks: 36
Task Groups: 6
Estimated Build Order: Backend Handoff Endpoint -> Frontend API Client Extension -> useChatThread Hook Enhancements -> PersonaHelperPanel & Context Cleanup (parallelizable with TG3) -> Dashboard Card Wiring -> Test Review & Gap Analysis

This is Increment 3 of the 11-increment plan. Increments 1 (backend POST /api/chat/v2, registries, thread persistence, prompt composition -- 88 tests) and 2 (frontend UnifiedChatPanel components, useChatThread hook, GET /api/chat/v2/thread, Dashboard integration -- 44 tests) are complete and verified. This increment wires everything together for a working end-to-end Hub Chat experience on the Dashboard: @-mention persona selection, message queuing, persona handoff with persisted system messages, and removal of the now-replaced PersonaHelperPanel infrastructure.

---

## Task List

### Backend Layer

#### Task Group 1: Backend Handoff Endpoint
**Dependencies:** None (uses existing backend infrastructure from Increment 1)

- [x] 1.0 Complete backend handoff endpoint
  - [x] 1.1 Write 4 focused tests for POST /api/chat/v2/handoff
    - Test POST `/api/chat/v2/handoff` with valid `{ threadKey: { type: 'hub', projectId: 'test-proj' }, personaId: 'architect' }` returns `{ success: true, threadKey: 'project:test-proj:hub' }` with 200 status
    - Test POST `/api/chat/v2/handoff` without `threadKey` returns 400 with error message
    - Test POST `/api/chat/v2/handoff` without `personaId` returns 400 with error message
    - Test POST `/api/chat/v2/handoff` with invalid `personaId` (not in persona registry) returns 400 with error message
  - [x] 1.2 Add POST `/handoff` route handler to `gateway/src/routes/chatV2.ts`
    - Add `chatV2Router.post('/handoff', ...)` handler after the existing GET `/thread` handler (after line 269)
    - Extract `threadKey` and `personaId` from `req.body`
    - Return 400 if `threadKey` is missing or not an object with `type` and `projectId`
    - Return 400 if `personaId` is missing or is not a string
    - Look up `personaId` in the persona registry via `getPersonaRegistry().get(personaId)` -- return 400 if not found
    - Resolve or create the thread: call `getThread(threadKey)`, if null call `createThread(threadKey)`
    - Look up the persona's `displayName` from `persona.displayName` (from the persona registry entry)
    - Build a system-role `ThreadMessage` with `id: uuidv4()`, `role: 'system'`, `personaId: null`, `taskId: null`, `content: "Switched to {displayName}"`, `structuredResponse: null`, `timestamp: new Date().toISOString()`
    - Call `appendMessage(threadKey, systemMessage)` to persist
    - Return `{ success: true, threadKey: threadKeyToString(threadKey) }` as JSON with 200 status
    - Wrap in try/catch with 500 error handling following the same pattern as the POST `/` handler (lines 492-502)
  - [x] 1.3 Ensure backend handoff endpoint tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify the route is accessible at POST `/api/chat/v2/handoff`
    - Verify system message is persisted to thread via `appendMessage`

**Acceptance Criteria:**
- All 4 handoff endpoint tests pass
- POST with valid threadKey and personaId persists a system message "Switched to {displayName}" and returns success
- POST without threadKey or personaId returns 400
- POST with unknown personaId returns 400
- Existing POST `/` and GET `/thread` endpoints are unaffected

---

### Frontend API Client Layer

#### Task Group 2: Frontend API Client Extension
**Dependencies:** Task Group 1 (handoff endpoint must exist)

- [x] 2.0 Complete frontend API client extension
  - [x] 2.1 Write 2 focused tests for postHandoff function
    - Test `postHandoff` sends correct JSON body `{ threadKey, personaId }` to `/api/chat/v2/handoff` via POST and resolves successfully on 200
    - Test `postHandoff` throws on non-2xx response (matching `postChatV2` error pattern)
  - [x] 2.2 Implement `postHandoff` in `frontend/src/api/chatV2Api.ts`
    - Add function signature: `export async function postHandoff(threadKey: ThreadKey, personaId: string): Promise<void>`
    - POST to `${GATEWAY_BASE}/api/chat/v2/handoff` with JSON body `{ threadKey, personaId }`
    - Follow the exact `fetch` + `res.ok` check + `throw new Error` pattern from `postChatV2` (lines 213-225)
    - Do NOT return the response body -- the function is fire-and-forget from the caller's perspective
    - Add the function after the existing `getThreadHistory` function (after line 243)
  - [x] 2.3 Ensure API client tests pass
    - Run ONLY the 2 tests written in 2.1
    - Verify the function follows the same error pattern as `postChatV2`

**Acceptance Criteria:**
- Both API client tests pass
- `postHandoff` correctly calls POST `/api/chat/v2/handoff` with threadKey and personaId
- `postHandoff` throws on non-2xx responses
- Existing `postChatV2` and `getThreadHistory` functions are unaffected

---

### Hook Layer

#### Task Group 3: useChatThread Hook Enhancements
**Dependencies:** Task Group 2 (postHandoff must be available in chatV2Api.ts)

- [x] 3.0 Complete useChatThread hook enhancements
  - [x] 3.1 Write 8 focused tests for useChatThread enhancements
    - Test `sendMessage` strips leading `@Architect ` from message text before building the optimistic user message (user sees clean text, not `@Architect what about X?`)
    - Test `sendMessage` strips leading `@Product Manager ` (multi-word display name) from message text
    - Test `sendMessage` does NOT strip `@` patterns that are not at the start of the message (e.g., "ask @Architect" remains unchanged)
    - Test `sendMessage` when `activeTaskId === 'unknown'` stores the stripped message text in `pendingMessage` and still appends the optimistic user message to the messages array
    - Test `sendMessage` when `activeTaskId === 'unknown'` fires a POST with `taskId='unknown'` and an empty/minimal message to retrieve the task menu
    - Test `selectTask` when `pendingMessage` exists auto-sends the queued message with the newly selected `taskId` and clears `pendingMessage`
    - Test `selectTask` when no `pendingMessage` exists falls back to sending "Selected task: {label}" (current behavior)
    - Test `selectPersona` with a different personaId inserts a system message "Switched to {displayName}" into the messages array and calls `postHandoff` (fire-and-forget)
  - [x] 3.2 Implement @-mention stripping in `sendMessage`
    - Import `PERSONA_CONFIGS` from `../config/personaConfig` at top of file
    - At the beginning of `sendMessage` (before building the optimistic user message, around line 151), build a regex pattern from all 6 display names: `new RegExp('^@(' + PERSONA_CONFIGS.map(p => p.displayName.replace(/\s/g, '\\s')).join('|') + ')\\s', 'i')`
    - The regex matches the exact pattern `MentionInput.handleSelectPersona` inserts: `@{displayName} ` (with trailing space) at the start of the message
    - Apply `text = text.replace(mentionRegex, '')` to strip the @-mention prefix
    - Use the stripped text for BOTH the optimistic user message `content` field AND the API request `message` field
    - Display names to handle: "Assistant", "Product Manager", "Architect", "UX Designer", "Test Engineer", "Software Developer"
  - [x] 3.3 Implement `pendingMessage` queuing in `sendMessage` and `selectTask`
    - Add a new ref: `const pendingMessageRef = useRef<string | null>(null)` (after `activeTaskIdRef` at line 99, following the `lastStructuredResponseRef` pattern)
    - In `sendMessage`, after stripping @-mention and building the optimistic user message, check `activeTaskIdRef.current === 'unknown'`:
      - If true: store the stripped text in `pendingMessageRef.current`, append the optimistic user message to `messages` (so the user sees their message), then fire `postChatV2` with `taskId: 'unknown'` and `message: ''` (empty string) to retrieve the task menu -- do NOT store the stripped text in the API call message field
      - If false: proceed with the existing `postChatV2` call using the stripped text as the `message` field (normal flow)
    - In `selectTask` (currently lines 246-270), after `setActiveTaskId(taskId)`, check `pendingMessageRef.current`:
      - If non-null: call `sendMessage(pendingMessageRef.current)` with the queued message (which now has a valid `taskId` set), then set `pendingMessageRef.current = null`
      - If null: fall back to the current behavior of `sendMessage("Selected task: {label}")`
    - The queued message must survive the full round-trip: user sends message -> POST returns task menu -> user clicks task card -> queued message auto-sends with selected taskId
  - [x] 3.4 Implement persona handoff system message in `selectPersona`
    - Import `postHandoff` from `../api/chatV2Api` and `getPersonaConfig` from `../config/personaConfig`
    - In `selectPersona` (currently lines 237-240), before `setActivePersonaId(personaId)`, check if `personaId !== activePersonaIdRef.current` (actual persona change):
      - If different persona: look up display name via `getPersonaConfig(personaId).displayName`, build a system-role `ThreadMessage` with `id: generateMessageId()`, `role: 'system'`, `personaId: null`, `taskId: null`, `content: "Switched to {displayName}"`, `structuredResponse: null`, `timestamp: new Date().toISOString()`, append to messages via `setMessages(prev => [...prev, systemMessage])`
      - After inserting the local system message, call `postHandoff(threadKeyRef.current, personaId).catch(err => console.error('Failed to persist handoff:', err))` -- fire-and-forget with error logging, does NOT block the persona switch
      - If same persona: skip the handoff system message (no-op beyond what already happens)
    - Continue with existing `setActivePersonaId(personaId)` and `setActiveTaskId('unknown')` calls
  - [x] 3.5 Ensure hook enhancement tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify @-mention stripping works for all 6 persona display names
    - Verify message queuing survives the task menu round-trip
    - Verify persona handoff inserts system message and calls postHandoff

**Acceptance Criteria:**
- All 8 hook enhancement tests pass
- @-mention prefix is stripped from messages before display and API send
- Messages are queued when `activeTaskId === 'unknown'` and auto-sent after task selection
- Persona handoff inserts "Switched to {displayName}" system message and persists via `postHandoff`
- `postHandoff` failures are logged but do not block the persona switch
- Existing sendMessage, selectPersona, and selectTask behaviors are preserved for non-queued and same-persona cases

---

### Cleanup Layer

#### Task Group 4: PersonaHelperPanel & Context Cleanup
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Complete PersonaHelperPanel and context cleanup
  - [x] 4.1 Write 2 focused tests for cleanup verification
    - Test that `App` renders without `PersonaPanelProvider` and `PersonaHelperPanel` (no `[data-testid="persona-helper-panel"]` in the DOM)
    - Test that `DashboardView` card "Open" buttons call `navigateTo` but do NOT call `openPanel` (no `PersonaPanelContext` dependency)
  - [x] 4.2 Delete PersonaPanelContext and PersonaHelperPanel source files
    - Delete `frontend/src/contexts/PersonaPanelContext.tsx`
    - Delete `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx`
    - Delete `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css`
  - [x] 4.3 Delete test files that solely test removed code
    - Delete `frontend/src/__tests__/PersonaHelperPanel.test.tsx`
    - Delete `frontend/src/__tests__/PersonaPanelContext.test.tsx`
    - Delete `frontend/src/__tests__/DashboardView.personaPanel.test.tsx`
  - [x] 4.4 Update `frontend/src/App.tsx` to remove PersonaPanelProvider and PersonaHelperPanel
    - Remove line 8: `import { PersonaPanelProvider } from './contexts/PersonaPanelContext';`
    - Remove line 19: `import { PersonaHelperPanel } from './components/PersonaHelperPanel/PersonaHelperPanel';`
    - Remove lines 160-162: the `<PersonaPanelProvider>` wrapper around `<AppContent />` -- `<AppContent />` becomes a direct child of `<ArchitectureProvider>`
    - Remove line 147: the `<PersonaHelperPanel />` render inside `AppContent`
    - Update spec comment on line 7 to note removal: `Spec 2026-02-28: Hub Chat MVP v1 - Removed PersonaPanelProvider (replaced by UnifiedChatPanel)`
  - [x] 4.5 Update `frontend/src/components/DashboardView/DashboardView.tsx` to remove openPanel wiring
    - Remove line 25: `import { useOpenPersonaPanel } from '../../contexts/PersonaPanelContext';`
    - Remove line 125: `const openPanel = useOpenPersonaPanel();`
    - On 9 card "Open" button `onClick` handlers, remove the `openPanel(...)` call while keeping the `navigateTo(dispatch, ...)` call:
      - Line 271: `onClick={() => { navigateTo(dispatch, 'product', 'product'); }}` (remove `openPanel('Product Manager')`)
      - Line 285: `onClick={() => { navigateTo(dispatch, 'product', 'roadmap'); }}` (remove `openPanel('Product Manager')`)
      - Line 300: `onClick={() => { navigateTo(dispatch, 'product', 'product'); }}` (remove `openPanel('Product Manager')`)
      - Line 319: `onClick={() => { navigateTo(dispatch, 'metamodel'); }}` (remove `openPanel('Solution Architect')`)
      - Line 400: `onClick={() => { navigateTo(dispatch, 'product', 'backlog'); }}` (remove `openPanel('Product Manager')`)
      - Line 415: `onClick={() => { navigateTo(dispatch, 'metamodel'); }}` (remove `openPanel('Solution Architect')`)
      - Line 430: `onClick={() => { navigateTo(dispatch, 'product', 'implement'); }}` (remove `openPanel('Test Engineer')`)
      - Line 457: `onClick={() => { navigateTo(dispatch, 'product', 'implement'); }}` (remove `openPanel('Implementation Assistant')`)
      - Line 469: `onClick={() => { navigateTo(dispatch, 'product', 'implement'); }}` (remove `openPanel('Test Engineer')`)
  - [x] 4.6 Update test files to remove PersonaPanelContext mocking and openPanel assertions
    - Update `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx`:
      - Remove `jest.mock('../../contexts/PersonaPanelContext')` or equivalent mock
      - Remove any `PersonaPanelProvider` wrapper from render calls
      - Remove any assertions that verify `openPanel` was called
    - Update `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`:
      - Same pattern: remove PersonaPanelContext mock, provider wrapper, and openPanel assertions
    - Update `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx`:
      - Same pattern: remove PersonaPanelContext mock, provider wrapper, and openPanel assertions
    - Update `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx`:
      - Same pattern: remove PersonaPanelContext mock, provider wrapper, and openPanel assertions
    - Update `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx`:
      - Same pattern: remove PersonaPanelContext mock, provider wrapper, and openPanel assertions
    - Update `frontend/src/__tests__/DashboardView.test.tsx`:
      - Same pattern: remove PersonaPanelContext mock, provider wrapper, and openPanel assertions
    - Update `frontend/src/components/UnifiedChat/__tests__/containerIntegration.test.tsx`:
      - Same pattern: remove PersonaPanelContext mock and provider wrapper if present
    - For all files: any test assertions that verify `openPanel` was called on card click should be removed or replaced with assertions that only `navigateTo` behavior occurs
  - [x] 4.7 Ensure cleanup tests pass
    - Run ONLY the 2 tests written in 4.1
    - Run the 7 updated test files from 4.6 to verify they still pass without PersonaPanelContext mocks
    - Verify no import resolution errors for deleted files

**Acceptance Criteria:**
- Both cleanup verification tests pass
- All 7 updated test files pass without PersonaPanelContext references
- `PersonaPanelContext.tsx`, `PersonaHelperPanel.tsx`, `PersonaHelperPanel.module.css` are deleted
- `PersonaHelperPanel.test.tsx`, `PersonaPanelContext.test.tsx`, `DashboardView.personaPanel.test.tsx` are deleted
- `App.tsx` renders without `PersonaPanelProvider` wrapper and without `PersonaHelperPanel`
- `DashboardView.tsx` card "Open" buttons call only `navigateTo`, with no `openPanel` references
- No broken imports or test failures from removed code

---

### Integration Layer

#### Task Group 5: Dashboard Card Wiring (Navigation-Only Confirmation)
**Dependencies:** Task Group 3 (useChatThread enhancements complete), Task Group 4 (cleanup complete)

- [x] 5.0 Complete Dashboard card wiring confirmation
  - [x] 5.1 Write 3 focused tests for Dashboard card navigation behavior
    - Test that clicking "Product Definition" card's "Open" button calls `navigateTo(dispatch, 'product', 'product')` and does NOT attempt any persona switching on UnifiedChatPanel (since navigation away from Dashboard unmounts the panel)
    - Test that clicking "High-Level Architecture" card's "Open" button calls `navigateTo(dispatch, 'metamodel')` and does NOT attempt any persona switching
    - Test that UnifiedChatPanel is rendered on the Dashboard when `activeProject` is present and accepts persona selection via @-mention in the chat input (end-to-end: type `@Architect` in MentionInput, verify `selectPersona('architect')` is called on the hook)
  - [x] 5.2 Verify DashboardView renders UnifiedChatPanel with correct threadKey
    - Confirm `DashboardView.tsx` line 231 still builds `chatThreadKey: ThreadKey = { type: 'hub', projectId: activeProject.id }`
    - Confirm `UnifiedChatPanel` is rendered with `threadKey={chatThreadKey}` and `initialPersonaId="assistant"` (lines 505-508)
    - No new wiring is needed for card buttons in this increment because all card buttons navigate away from the Dashboard (causing UnifiedChatPanel to unmount); side-panel persona switching on non-Dashboard screens is Increments 8-9 scope
  - [x] 5.3 Add spec comments documenting the navigation-only behavior
    - Update the `DashboardView.tsx` header comment block to note: `Spec 2026-02-28: Hub Chat MVP v1 -- Removed openPanel wiring; card buttons navigate only (UnifiedChatPanel unmounts on navigation); side-panel wiring deferred to Increments 8-9`
    - Ensure the existing `UnifiedChatPanel` render block comment (lines 498-503) is updated to note PersonaHelperPanel has been removed (not "continues to render as-is")
  - [x] 5.4 Ensure Dashboard card wiring tests pass
    - Run ONLY the 3 tests written in 5.1
    - Verify card clicks trigger navigation without persona panel side effects

**Acceptance Criteria:**
- All 3 Dashboard card wiring tests pass
- Card "Open" buttons navigate via `navigateTo` only (no persona switching side effects)
- UnifiedChatPanel renders correctly on Dashboard with hub threadKey
- Persona selection on Dashboard works end-to-end via @-mention in UnifiedChatPanel
- No side-panel persona switching on non-Dashboard screens (confirmed out of scope)

---

### Test Review

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5 (all implementation complete)

- [x] 6.0 Review all tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests from Task Group 1 (backend handoff endpoint)
    - Review the 2 tests from Task Group 2 (frontend API client postHandoff)
    - Review the 8 tests from Task Group 3 (useChatThread hook enhancements)
    - Review the 2 tests from Task Group 4 (cleanup verification)
    - Review the 3 tests from Task Group 5 (Dashboard card wiring)
    - Total existing tests: 19
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements (message queuing, @-mention stripping, persona handoff, cleanup)
    - Do NOT assess entire application test coverage
    - Prioritize integration workflows: user types `@Architect what about X?` -> persona switches -> message queued -> task menu appears -> user clicks task -> queued message auto-sends with task ID; user switches persona mid-conversation -> "Switched to {Name}" appears in thread -> page reload shows the handoff marker
  - [x] 6.3 Write up to 8 additional strategic tests to fill critical gaps
    - Possible gap areas (assess and add only where critical coverage is missing):
      - End-to-end: full @-mention -> queue -> task menu -> task select -> auto-send round-trip in useChatThread
      - End-to-end: persona handoff system message persists across simulated page reload (GET thread history includes the "Switched to" message)
      - Integration: `sendMessage` with `activeTaskId !== 'unknown'` sends stripped message directly (no queuing, normal path)
      - Integration: `selectPersona` with the same persona that is already active does NOT insert a system message (no-op check)
      - Integration: `postHandoff` failure is caught and logged but does not throw or block persona switch
      - Integration: `sendMessage` strips `@UX Designer ` (multi-word with space) correctly
      - Integration: `pendingMessageRef` is cleared after auto-send in `selectTask` (no double-send)
      - Edge case: backend handoff endpoint creates thread if it does not exist before appending system message
    - Add a maximum of 8 new tests to fill identified gaps
    - Do NOT write exhaustive edge-case or stress tests
  - [x] 6.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 19-27 tests
    - Also verify the 7 updated test files from Task 4.6 still pass
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 19-27 total)
- Critical end-to-end user workflows for Hub Chat MVP are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements
- All 7 updated legacy test files (from Task 4.6) pass without PersonaPanelContext references

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Backend Handoff Endpoint** -- No dependencies. Adds the POST `/api/chat/v2/handoff` route that the frontend will call for persona handoff persistence.
2. **Task Group 2: Frontend API Client Extension** -- Depends on Group 1 (endpoint must exist for integration). Adds `postHandoff` function to `chatV2Api.ts`.
3. **Task Group 4: PersonaHelperPanel & Context Cleanup** -- No dependencies on Groups 1-2. Can start in parallel with Groups 1-2 since it only removes existing code and updates existing tests.
4. **Task Group 3: useChatThread Hook Enhancements** -- Depends on Group 2 (needs `postHandoff`). Core logic for message queuing, @-mention stripping, and persona handoff system messages.
5. **Task Group 5: Dashboard Card Wiring** -- Depends on Groups 3 and 4. Confirms navigation-only behavior and verifies UnifiedChatPanel integration on Dashboard.
6. **Task Group 6: Test Review** -- Depends on all groups complete. Final quality pass and gap analysis.

### Parallelization Opportunities

```
Group 1 ──> Group 2 ──> Group 3 ──┐
                                   ├──> Group 5 ──> Group 6
Group 4 ──────────────────────────┘
```

- Group 4 (cleanup) can run in parallel with Groups 1, 2, and 3 since it only removes old code and has no dependency on the new handoff endpoint or hook enhancements
- Groups 1 and 2 are sequential (frontend API client needs backend endpoint)
- Group 3 depends on Group 2 (needs `postHandoff` in the API client)
- Group 5 depends on both Group 3 (hook enhancements) and Group 4 (cleanup complete)
- Group 6 is always last (reviews all work)

---

## File Inventory

### New Files to Create
| File | Task Group | Purpose |
|------|-----------|---------|
| (none) | -- | This increment creates no new files; all changes are modifications to existing files or deletions |

### Existing Files to Modify
| File | Task Group | Change |
|------|-----------|--------|
| `gateway/src/routes/chatV2.ts` | 1 | Add POST `/handoff` route handler after GET `/thread` handler |
| `frontend/src/api/chatV2Api.ts` | 2 | Add `postHandoff` function after `getThreadHistory` |
| `frontend/src/hooks/useChatThread.ts` | 3 | Add `pendingMessageRef`, @-mention stripping in `sendMessage`, message queuing logic in `sendMessage`/`selectTask`, persona handoff system message in `selectPersona` |
| `frontend/src/App.tsx` | 4 | Remove `PersonaPanelProvider` import/wrapper and `PersonaHelperPanel` import/render |
| `frontend/src/components/DashboardView/DashboardView.tsx` | 4, 5 | Remove `useOpenPersonaPanel` import, `openPanel` const, and all `openPanel(...)` calls from card buttons; update spec comments |
| `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx` | 4 | Remove PersonaPanelContext mock, provider wrapper, openPanel assertions |
| `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` | 4 | Remove PersonaPanelContext mock, provider wrapper, openPanel assertions |
| `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx` | 4 | Remove PersonaPanelContext mock, provider wrapper, openPanel assertions |
| `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx` | 4 | Remove PersonaPanelContext mock, provider wrapper, openPanel assertions |
| `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx` | 4 | Remove PersonaPanelContext mock, provider wrapper, openPanel assertions |
| `frontend/src/__tests__/DashboardView.test.tsx` | 4 | Remove PersonaPanelContext mock, provider wrapper, openPanel assertions |
| `frontend/src/components/UnifiedChat/__tests__/containerIntegration.test.tsx` | 4 | Remove PersonaPanelContext mock and provider wrapper |

### Files to Delete
| File | Task Group | Reason |
|------|-----------|--------|
| `frontend/src/contexts/PersonaPanelContext.tsx` | 4 | Entire context replaced by UnifiedChatPanel -- no consumers remain |
| `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` | 4 | Component replaced by UnifiedChatPanel |
| `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` | 4 | Styles for deleted component |
| `frontend/src/__tests__/PersonaHelperPanel.test.tsx` | 4 | Tests for deleted component |
| `frontend/src/__tests__/PersonaPanelContext.test.tsx` | 4 | Tests for deleted context |
| `frontend/src/__tests__/DashboardView.personaPanel.test.tsx` | 4 | Tests for deleted openPanel integration |

### Existing Files Referenced (read-only)
| File | Purpose |
|------|---------|
| `frontend/src/config/personaConfig.ts` | `PERSONA_CONFIGS` array for @-mention stripping regex; `getPersonaConfig` for handoff displayName lookup |
| `gateway/src/services/threadStore.ts` | `getThread`, `createThread`, `appendMessage` functions used by handoff endpoint |
| `gateway/src/services/registryLoader.ts` | `getPersonaRegistry` for persona displayName lookup in handoff endpoint |
| `gateway/src/types/chatV2.ts` | `ThreadKey`, `ThreadMessage`, `threadKeyToString`, `parseThreadKey` types used by handoff endpoint |
