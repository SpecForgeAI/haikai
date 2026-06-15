# Task Breakdown: Unified Chat Panel v1 (Frontend)

## Overview
Total Tasks: 49
Task Groups: 8
Estimated Build Order: Foundation -> Backend GET Endpoint -> API Client -> State Hook -> Core Components -> Feature Components -> Container & Integration -> Test Review

This is Increment 2 of the 11-increment plan. Increment 1 (backend) is complete with POST /api/chat/v2, persona/task registries, thread persistence, and prompt composition pipeline all working. This increment builds the frontend chat panel that consumes it.

---

## Task List

### Foundation Layer

#### Task Group 1: Frontend Types and Persona Config
**Dependencies:** None (uses backend types from `gateway/src/types/chatV2.ts` as reference only -- no cross-project imports)

- [x] 1.0 Complete foundation types and persona config
  - [x] 1.1 Write 4 focused tests for foundation layer
    - Test `threadKeyToString` produces correct serialized strings for hub, feature, and panel keys
    - Test `getPersonaConfig` returns correct config for a known persona ID
    - Test `getPersonaConfig` returns grey fallback for an unknown persona ID
    - Test that all 6 persona IDs in `PERSONA_CONFIGS` have unique `id`, `color`, and `initials` values
  - [x] 1.2 Create frontend v2 type definitions in `frontend/src/api/chatV2Api.ts` (types section)
    - Mirror from `gateway/src/types/chatV2.ts`: `HubThreadKey`, `FeatureThreadKey`, `PanelThreadKey`, `ThreadKey` (discriminated union)
    - Mirror: `ThreadMessage` (id, role, personaId, taskId, content, structuredResponse, timestamp)
    - Mirror: `Thread` (threadKey, projectId, messages, activePersonaId, activeTaskId, createdAt, updatedAt)
    - Mirror: `ChatV2Request` (threadKey, personaId, taskId, message, optional files array)
    - Mirror: `ChatV2Response` (threadKey, personaId, taskId, assistant.message, structuredResponse, optional error)
    - Mirror: `FileAttachment` type `{ filename: string; mimeType: string; base64: string }`
    - These are frontend-only interfaces -- do NOT import from gateway
  - [x] 1.3 Implement `threadKeyToString` utility in `frontend/src/api/chatV2Api.ts`
    - Match the exact serialization logic from `gateway/src/types/chatV2.ts` lines 65-76
    - Hub: `project:{projectId}:hub`
    - Feature: `project:{projectId}:feature:{featureId}`
    - Panel: `project:{projectId}:panel:{screen}` or `project:{projectId}:panel:{screen}:{entityId}`
  - [x] 1.4 Create persona config file `frontend/src/config/personaConfig.ts`
    - Define interface: `PersonaConfig { id: string; displayName: string; color: string; initials: string }`
    - Create static array `PERSONA_CONFIGS` with 6 entries mirroring `gateway/src/config/personas/*.json`:
      - `{ id: 'assistant', displayName: 'Assistant', color: '#5C6BC0', initials: 'AS' }`
      - `{ id: 'product-manager', displayName: 'Product Manager', color: '#00897B', initials: 'PM' }`
      - `{ id: 'architect', displayName: 'Architect', color: '#7B1FA2', initials: 'AR' }`
      - `{ id: 'ux-designer', displayName: 'UX Designer', color: '#F57C00', initials: 'UX' }`
      - `{ id: 'test-engineer', displayName: 'Test Engineer', color: '#2E7D32', initials: 'TE' }`
      - `{ id: 'software-developer', displayName: 'Software Developer', color: '#455A64', initials: 'SD' }`
    - Export `getPersonaConfig(personaId: string): PersonaConfig` -- returns matching entry or fallback `{ id: personaId, displayName: personaId, color: '#9E9E9E', initials: '??' }`
    - Pure data file with no React dependencies
  - [x] 1.5 Ensure foundation tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify type definitions compile without errors

**Acceptance Criteria:**
- All 4 foundation tests pass
- `threadKeyToString` matches backend serialization for all 3 key types
- `getPersonaConfig` returns correct data for all 6 personas and a sensible fallback for unknowns
- Type definitions align with `gateway/src/types/chatV2.ts` field shapes
- No imports from `gateway/` in any frontend file

---

### Backend Addition

#### Task Group 2: GET /api/chat/v2/thread Endpoint
**Dependencies:** None (existing backend infrastructure from Increment 1)

- [x] 2.0 Complete GET thread endpoint
  - [x] 2.1 Write 3 focused tests for the GET endpoint
    - Test GET `/api/chat/v2/thread?key=project:abc:hub` returns a Thread object (or empty thread with `messages: []` if no thread exists)
    - Test GET `/api/chat/v2/thread` without `key` param returns 400
    - Test GET `/api/chat/v2/thread?key=invalid` with unparseable key returns 400
  - [x] 2.2 Add GET handler to `gateway/src/routes/chatV2.ts`
    - Add `chatV2Router.get('/thread', ...)` alongside the existing POST handler
    - Accept query param `key` (the serialized thread key string)
    - Import `parseThreadKey` from `gateway/src/types/chatV2.ts`
    - Import `getThread` from `gateway/src/services/threadStore.ts`
    - Parse key using `parseThreadKey(key)` -- catch errors and return 400
    - Call `getThread(parsedKey)` -- if null, return empty Thread with `messages: []`, current timestamps, and null activePersonaId/activeTaskId
    - Return the full `Thread` object as JSON with 200 status
    - Return 400 with `{ error: '...' }` if `key` query param is missing or `parseThreadKey` throws
  - [x] 2.3 Ensure GET endpoint tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify the route is accessible at GET `/api/chat/v2/thread`

**Acceptance Criteria:**
- All 3 GET endpoint tests pass
- GET with valid key returns Thread JSON (or empty thread)
- GET without key or with invalid key returns 400
- Existing POST /api/chat/v2 endpoint is unaffected

---

### API Client Layer

#### Task Group 3: Chat V2 API Client Service
**Dependencies:** Task Group 1 (types), Task Group 2 (GET endpoint)

- [x] 3.0 Complete API client service
  - [x] 3.1 Write 4 focused tests for the API client
    - Test `postChatV2` sends correct JSON body to `/api/chat/v2` and returns parsed `ChatV2Response`
    - Test `postChatV2` throws on non-2xx response
    - Test `getThreadHistory` calls GET `/api/chat/v2/thread?key={serialized}` and returns parsed `Thread`
    - Test `getThreadHistory` throws on non-2xx response
  - [x] 3.2 Implement `postChatV2` in `frontend/src/api/chatV2Api.ts`
    - Signature: `async function postChatV2(request: ChatV2Request): Promise<ChatV2Response>`
    - POST to `${GATEWAY_BASE}/api/chat/v2` with JSON body
    - Follow the fetch + `res.ok` check + `throw new Error` pattern from `chatApi.ts` lines 763-775
    - Use `GATEWAY_BASE` from `import.meta.env.VITE_GATEWAY_BASE_URL ?? ''` matching `chatApi.ts` line 39
  - [x] 3.3 Implement `getThreadHistory` in `frontend/src/api/chatV2Api.ts`
    - Signature: `async function getThreadHistory(threadKey: ThreadKey): Promise<Thread>`
    - Serialize key using `threadKeyToString(threadKey)`
    - GET to `${GATEWAY_BASE}/api/chat/v2/thread?key=${encodeURIComponent(serialized)}`
    - Follow same fetch + error pattern as `postChatV2`
    - Return the parsed Thread object
  - [x] 3.4 Implement `generateMessageId` utility in `frontend/src/api/chatV2Api.ts`
    - Generate a UUID-style string for optimistic client-side message IDs
    - Follow the pattern from `chatApi.ts` `generateMessageId()` (line 941-943)
  - [x] 3.5 Ensure API client tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify both functions handle success and error cases

**Acceptance Criteria:**
- All 4 API client tests pass
- `postChatV2` correctly calls POST endpoint and parses response
- `getThreadHistory` correctly calls GET endpoint with serialized key
- Both functions throw on non-2xx responses
- `GATEWAY_BASE` sourced from environment variable matching existing pattern

---

### State/Hook Layer

#### Task Group 4: useChatThread Custom Hook
**Dependencies:** Task Group 3 (API client)

- [x] 4.0 Complete useChatThread hook
  - [x] 4.1 Write 6 focused tests for the hook
    - Test hook initializes with empty messages and calls `getThreadHistory` on mount
    - Test hook populates messages from loaded thread history
    - Test `sendMessage` appends optimistic user message, calls `postChatV2`, and appends assistant response
    - Test `sendMessage` sets `isLoading` true during request and false after
    - Test `selectPersona` updates `activePersonaId` and resets `activeTaskId` to `'unknown'`
    - Test `selectTask` updates `activeTaskId` and auto-sends a system-style message
  - [x] 4.2 Create `frontend/src/hooks/useChatThread.ts`
    - Signature: `useChatThread(threadKey: ThreadKey, options?: { initialPersonaId?: string; allowedPersonaIds?: string[] })`
    - Local state via `useState`: `messages: ThreadMessage[]`, `activePersonaId: string` (default from `options.initialPersonaId` or `'assistant'`), `activeTaskId: string` (default `'unknown'`), `isLoading: boolean` (default false), `error: string | null` (default null)
    - `useEffect` on mount and `threadKey` changes: call `getThreadHistory(threadKey)`, populate `messages` from returned Thread, set `activePersonaId` and `activeTaskId` from Thread if they are non-null
    - Implement `sendMessage(text: string, files?: FileAttachment[])`:
      - Build optimistic user `ThreadMessage` with `generateMessageId()`, role `'user'`, current timestamp
      - Append to messages state immediately
      - Build `ChatV2Request` with current `activePersonaId`, `activeTaskId`, `threadKey`
      - Call `postChatV2(request)` -- set `isLoading` true before, false after
      - On success: build assistant `ThreadMessage` from response and append to messages
      - On success: if `response.structuredResponse` has `type === 'task-menu'`, keep `activeTaskId` as `'unknown'`
      - On error: set `error` state with message, optionally append error-indicator message
    - Implement `selectPersona(personaId: string)`: set `activePersonaId`, reset `activeTaskId` to `'unknown'`
    - Implement `selectTask(taskId: string)`: set `activeTaskId`, call `sendMessage("Selected task: {menuLabel}")` to auto-send system-style message (use the task's menuLabel from the structuredResponse data if available, otherwise use taskId)
  - [x] 4.3 Ensure hook returns the correct shape
    - Return object: `{ messages, activePersonaId, activeTaskId, isLoading, error, sendMessage, selectPersona, selectTask }`
    - Use `useCallback` for stable function references where appropriate
  - [x] 4.4 Ensure hook tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify hook state transitions are correct

**Acceptance Criteria:**
- All 6 hook tests pass
- Hook loads thread history on mount
- `sendMessage` performs optimistic update and handles response
- `selectPersona` resets task to unknown
- `selectTask` auto-sends a message
- No React Context introduced -- pure local state hook

---

### Core Components

#### Task Group 5: MessageBubble, ChatThread, and ChatInputBar
**Dependencies:** Task Group 1 (persona config), Task Group 4 (hook provides data shape)

- [x] 5.0 Complete core display and input components
  - [x] 5.1 Write 6 focused tests for core components
    - Test `MessageBubble` renders user message right-aligned with "You" label
    - Test `MessageBubble` renders assistant message left-aligned with persona avatar (colored circle with initials) and displayName
    - Test `MessageBubble` renders system message centered with muted styling
    - Test `ChatThread` renders a list of messages and shows typing indicator when `isLoading` is true
    - Test `ChatInputBar` calls `onSend` with text on Enter key press (without Shift)
    - Test `ChatInputBar` disables send button when textarea is empty and no files attached
  - [x] 5.2 Create `MessageBubble` component at `frontend/src/components/UnifiedChat/MessageBubble.tsx`
    - Props: `{ message: ThreadMessage; onSelectTask?: (taskId: string) => void; onSubmitAnswers?: (answers: Array<{ id: string; question: string; answer: string }>) => void }`
    - For `role === 'assistant'`: render colored circle avatar (28px, `border-radius: 50%`, white text, background from `getPersonaConfig(message.personaId)`), persona displayName above message content
    - For `role === 'user'`: right-aligned bubble with "You" label, no avatar
    - For `role === 'system'`: centered muted text, no avatar
    - If `message.structuredResponse` exists with `type === 'task-menu'`: render `TaskMenu` inline instead of plain text (pass `onSelectTask`)
    - If `message.structuredResponse` contains a `questions` array (or `openQuestions`): render `StructuredQuestionsRenderer` below message text (pass `onSubmitAnswers`)
    - Message content rendered as plain text (no markdown in v1)
    - Create `MessageBubble.module.css` with styles following spec font sizes (persona label 12px/600, content 14px/400, timestamps 11px/400)
  - [x] 5.3 Create `ChatThread` component at `frontend/src/components/UnifiedChat/ChatThread.tsx`
    - Props: `{ messages: ThreadMessage[]; isLoading: boolean; onSelectTask?: (taskId: string) => void; onSubmitAnswers?: (answers: Array<{ id: string; question: string; answer: string }>) => void }`
    - Scrollable container with auto-scroll adapted from `ChatMessageList.tsx`
    - Render each message using `MessageBubble`
    - Auto-scroll to bottom on new messages unless user has scrolled up (use 20px threshold logic from `ChatMessageList.tsx`)
    - Show typing indicator (three-dot animation or spinner) when `isLoading` is true, positioned at bottom of message list
    - Create `ChatThread.module.css` with scrollable container styles
  - [x] 5.4 Create `ChatInputBar` component at `frontend/src/components/UnifiedChat/ChatInputBar.tsx`
    - Props: `{ onSend: (text: string, files?: FileAttachment[]) => void; disabled?: boolean; allowedPersonaIds?: string[]; onPersonaSelected: (personaId: string) => void }`
    - Contains `MentionInput` textarea, `FileAttachmentBar`, send button, and Paperclip (file attach) button
    - Enter (without Shift) sends the message; Shift+Enter inserts newline (matching `ChatInput.tsx` pattern)
    - Paperclip button (lucide-react `Paperclip` icon) opens a hidden `<input type="file">` -- selected files stored in local state
    - File validation uses `validateFiles` and `readFilesAsBase64` from `frontend/src/utils/fileUploadUtils.ts` (import directly, no modifications)
    - Send button disabled when textarea is empty/whitespace AND no files attached, OR when `disabled` prop is true
    - On send: clear textarea, clear files, call `onSend(text, processedFiles)`
    - Create `ChatInputBar.module.css`
  - [x] 5.5 Ensure core component tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify rendering and interaction behaviors

**Acceptance Criteria:**
- All 6 core component tests pass
- MessageBubble renders all 3 roles correctly with proper alignment and styling
- MessageBubble delegates to TaskMenu and StructuredQuestionsRenderer when structuredResponse is present
- ChatThread scrolls correctly and shows loading indicator
- ChatInputBar handles Enter/Shift+Enter, file attachment, and send-button enable/disable logic

---

### Feature Components

#### Task Group 6: MentionInput, TaskMenu, StructuredQuestionsRenderer, FileAttachmentBar
**Dependencies:** Task Group 1 (persona config)

- [x] 6.0 Complete feature subcomponents
  - [x] 6.1 Write 8 focused tests for feature components
    - Test `MentionInput` shows dropdown when `@` is typed
    - Test `MentionInput` filters dropdown by text after `@` character
    - Test `MentionInput` calls `onPersonaSelected` and inserts `@DisplayName ` on selection
    - Test `MentionInput` supports keyboard navigation (ArrowUp/ArrowDown/Enter/Escape)
    - Test `TaskMenu` renders task cards with menuLabel and description
    - Test `TaskMenu` calls `onSelectTask` with correct taskId on click
    - Test `StructuredQuestionsRenderer` renders question rows with text inputs and a Submit button
    - Test `StructuredQuestionsRenderer` disables Submit when all answers are empty, enables when at least one is non-empty
  - [x] 6.2 Create `MentionInput` component at `frontend/src/components/UnifiedChat/MentionInput.tsx`
    - Props: `{ value: string; onChange: (value: string) => void; onPersonaSelected: (personaId: string) => void; allowedPersonaIds?: string[]; disabled?: boolean; onSubmit: () => void }`
    - Textarea that detects `@` character and opens a filterable dropdown
    - Dropdown positioned above the cursor listing personas filtered by text after `@`
    - If `allowedPersonaIds` provided, only show those personas; otherwise show all 6
    - Keyboard navigation: ArrowUp/ArrowDown to move selection, Enter to select, Escape to dismiss
    - On selection: insert `@DisplayName ` into textarea text at cursor position; call `onPersonaSelected(personaId)`
    - Dropdown styled as floating list with persona color dots (small colored circles) and display names
    - Create `MentionInput.module.css`
  - [x] 6.3 Create `TaskMenu` component at `frontend/src/components/UnifiedChat/TaskMenu.tsx`
    - Props: `{ tasks: Array<{ taskId: string; menuLabel: string; description: string }>; onSelectTask: (taskId: string) => void }`
    - Render each task as a clickable card/button with `menuLabel` as primary text and `description` as secondary text
    - On click: call `onSelectTask(taskId)`
    - Styled as outlined cards (`border: 1px solid #e0e0e0`) with hover state (background highlight); stacked vertically
    - Create `TaskMenu.module.css`
  - [x] 6.4 Create `StructuredQuestionsRenderer` component at `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx`
    - Props: `{ questions: Array<{ id: string; question: string }>; onSubmitAnswers: (answers: Array<{ id: string; question: string; answer: string }>) => void; disabled?: boolean }`
    - New self-contained component inspired by `QuestionsTable.tsx` and `QuestionsTableRow.tsx` layout patterns
    - Render a header row ("Question" / "Answer") and one row per question with question text and a single-line text input
    - Local state tracks answers per question id (e.g., `Record<string, string>`)
    - "Submit Answers" button enabled when at least one answer is non-empty (replicate enable logic from `QuestionsTable.tsx` lines 134-138); disabled when `disabled` prop is true or during submission
    - On submit: call `onSubmitAnswers` with answered questions; parent formats as numbered list and sends via `sendMessage`
    - Does NOT import or reuse existing `QuestionsTable` or `QuestionsTableRow`
    - Create `StructuredQuestionsRenderer.module.css`
  - [x] 6.5 Create `FileAttachmentBar` component at `frontend/src/components/UnifiedChat/FileAttachmentBar.tsx`
    - Props: `{ files: File[]; onRemove: (index: number) => void }`
    - Horizontal row of file chips below the textarea
    - Each chip shows truncated filename (max 20 chars with ellipsis) with full name as `title` tooltip attribute
    - X button on each chip calls `onRemove(index)`
    - Follows chip pattern from `ProductManagerChatPanel.tsx` file attachment display
    - Create `FileAttachmentBar.module.css`
  - [x] 6.6 Ensure feature component tests pass
    - Run ONLY the 8 tests written in 6.1
    - Verify all interaction behaviors

**Acceptance Criteria:**
- All 8 feature component tests pass
- MentionInput opens dropdown on `@`, filters, supports keyboard nav, and inserts persona name
- TaskMenu renders task cards and fires selection callback
- StructuredQuestionsRenderer renders questions with inputs and manages Submit button enable/disable
- FileAttachmentBar displays file chips with remove capability

---

### Container & Integration

#### Task Group 7: UnifiedChatPanel Container and Dashboard Wiring
**Dependencies:** Task Groups 4 (hook), 5 (core components), 6 (feature components)

- [x] 7.0 Complete container and dashboard integration
  - [x] 7.1 Write 5 focused tests for container and integration
    - Test `UnifiedChatPanel` renders in expanded state with header, ChatThread, and ChatInputBar
    - Test `UnifiedChatPanel` toggles between collapsed (slim tab) and expanded states
    - Test `UnifiedChatPanel` persists width to localStorage on resize
    - Test `UnifiedChatPanel` reads initial width from localStorage on mount
    - Test `DashboardView` renders `UnifiedChatPanel` when `activeProject` is not null
  - [x] 7.2 Create `UnifiedChatPanel` container at `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
    - Props: `{ threadKey: ThreadKey; initialPersonaId?: string; allowedPersonaIds?: string[] }`
    - Call `useChatThread(threadKey, { initialPersonaId, allowedPersonaIds })` for all state and actions
    - Panel width state with localStorage persistence (key: `unified-chat-panel-width`; default 380px; min 280px; max 50vw)
    - Collapsed/expanded boolean state (default expanded)
    - Collapsed state: slim vertical tab (32px wide) with chat icon (lucide-react `MessageSquare` or similar) and vertical "Chat" label; match `ChatPanel.module.css` `.collapsedTab` pattern
    - Expanded state: render header (panel title, active persona indicator, collapse button), `ChatThread`, `ChatInputBar` (with `MentionInput` and `FileAttachmentBar` integrated)
    - Left-edge drag handle for width resize -- follow mousedown/mousemove/mouseup pattern from `ChatPanel.tsx` lines 88-154; note: drag handle on LEFT edge (opposite from ChatPanel's right edge) since panel is right-anchored
    - Wire `onSelectTask` from `useChatThread.selectTask` through ChatThread -> MessageBubble -> TaskMenu
    - Wire `onSubmitAnswers` through ChatThread -> MessageBubble -> StructuredQuestionsRenderer, formatting answers as numbered list string (e.g., `"1. Q: ... A: ..."`) and calling `sendMessage`
    - Wire `onPersonaSelected` from ChatInputBar -> MentionInput to `useChatThread.selectPersona`
  - [x] 7.3 Create `UnifiedChatPanel.module.css`
    - Position: fixed, right: 0, top: 60px (below TopBar), height: `calc(100vh - 60px)`, z-index: 900
    - Background: white; border-left: `1px solid #e0e0e0`; box-shadow: `-2px 0 8px rgba(0, 0, 0, 0.08)`
    - Reference `PersonaHelperPanel.module.css` for consistent panel positioning and header layout
    - Header: flex row, `padding: 16px 20px`, `border-bottom: 1px solid #e0e0e0`, title 16px/600
    - Collapsed tab: 32px wide, full height, flex column centered, cursor pointer
    - Resize handle: 4px wide strip on left edge, cursor `col-resize`, hover highlight
  - [x] 7.4 Create component barrel export at `frontend/src/components/UnifiedChat/index.ts`
    - Export `UnifiedChatPanel` as the primary public component
    - Subcomponents (ChatThread, MessageBubble, etc.) are internal -- only export if needed elsewhere
  - [x] 7.5 Integrate into `DashboardView` at `frontend/src/components/DashboardView/DashboardView.tsx`
    - Import `UnifiedChatPanel` from `../UnifiedChat`
    - Import `ThreadKey` type from `../../api/chatV2Api`
    - When `activeProject` is not null: render `<UnifiedChatPanel threadKey={{ type: 'hub', projectId: activeProject.id }} initialPersonaId="assistant" />`
    - When `activeProject` is null: do not render UnifiedChatPanel
    - Panel is fixed-position right-anchored, so no layout changes to dashboard grid are needed
    - Existing `PersonaHelperPanel` continues to render as-is (both panels coexist; PersonaHelperPanel removed in Increment 10)
  - [x] 7.6 Ensure container and integration tests pass
    - Run ONLY the 5 tests written in 7.1
    - Verify panel renders, toggles, resizes, persists, and appears on Dashboard

**Acceptance Criteria:**
- All 5 container/integration tests pass
- UnifiedChatPanel renders correctly in both collapsed and expanded states
- Width resize works with left-edge drag handle and persists to localStorage
- All subcomponents are wired correctly (messages flow, task selection works, @-mention triggers persona change, file attachment works, structured questions submit works)
- DashboardView conditionally renders the panel based on activeProject
- Existing PersonaHelperPanel is unaffected

---

### Test Review

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7 (all implementation complete)

- [x] 8.0 Review all tests and fill critical gaps
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 tests from Task Group 1 (foundation types and persona config)
    - Review the 3 tests from Task Group 2 (GET endpoint)
    - Review the 4 tests from Task Group 3 (API client)
    - Review the 6 tests from Task Group 4 (useChatThread hook)
    - Review the 6 tests from Task Group 5 (core components)
    - Review the 8 tests from Task Group 6 (feature components)
    - Review the 5 tests from Task Group 7 (container and integration)
    - Total existing tests: 36
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end user workflows that lack coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration workflows: e.g., user types message -> optimistic append -> API call -> response rendered; user selects @-mention -> persona changes -> task menu returned -> task selected -> conversation continues
  - [x] 8.3 Write up to 10 additional strategic tests to fill critical gaps
    - Possible gap areas (assess and add only where critical coverage is missing):
      - End-to-end: UnifiedChatPanel sends a message and receives a response that renders in ChatThread
      - End-to-end: @-mention persona selection changes activePersonaId and subsequent messages use new persona
      - End-to-end: task-menu response renders TaskMenu, clicking a task sends auto-message
      - End-to-end: structured questions response renders StructuredQuestionsRenderer, submitting answers sends formatted message
      - Integration: useChatThread hook handles API error gracefully (sets error state, clears loading)
      - Integration: ChatInputBar with file attachment sends files through to onSend callback
      - Edge case: MentionInput with `allowedPersonaIds` constraint only shows allowed personas
      - Edge case: UnifiedChatPanel does not render when threadKey changes (re-fetches history)
    - Add a maximum of 10 new tests to fill identified gaps
    - Do NOT write exhaustive edge-case or stress tests
  - [x] 8.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 36-46 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (36-46 total)
- Critical end-to-end user workflows are covered
- No more than 10 additional tests added
- Testing focused exclusively on Unified Chat Panel v1 feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Foundation Types and Persona Config** -- No dependencies. Establishes all shared types and persona data needed by every other group.
2. **Task Group 2: GET /api/chat/v2/thread Endpoint** -- No dependencies on frontend work. Can be done in parallel with Group 1 if two developers are available.
3. **Task Group 3: Chat V2 API Client** -- Depends on Group 1 (types) and Group 2 (GET endpoint exists). Bridges frontend to backend.
4. **Task Group 4: useChatThread Hook** -- Depends on Group 3 (API client). Central state management layer that all components consume.
5. **Task Group 6: Feature Components** -- Depends on Group 1 (persona config). Can be done in parallel with Group 4 since these are leaf components with no hook dependency.
6. **Task Group 5: Core Components** -- Depends on Group 1 (persona config) and Group 6 (feature components are rendered within MessageBubble/ChatInputBar). Can overlap with Group 6.
7. **Task Group 7: Container and Integration** -- Depends on Groups 4, 5, and 6. Wires everything together and mounts on Dashboard.
8. **Task Group 8: Test Review** -- Depends on all groups complete. Final quality pass.

### Parallelization Opportunities

```
Group 1 ──┬──> Group 3 ──> Group 4 ──┐
           │                          ├──> Group 7 ──> Group 8
Group 2 ──┘    Group 6 ──> Group 5 ──┘
```

- Groups 1 and 2 can run in parallel (frontend types vs. backend endpoint)
- Group 6 (feature components) can start as soon as Group 1 is done, in parallel with Groups 3 and 4
- Group 5 (core components) can overlap with Group 6 once Group 1 is done

---

## File Inventory

### New Files to Create
| File | Task Group |
|------|-----------|
| `frontend/src/config/personaConfig.ts` | 1 |
| `frontend/src/api/chatV2Api.ts` | 1, 3 |
| `frontend/src/hooks/useChatThread.ts` | 4 |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | 5 |
| `frontend/src/components/UnifiedChat/MessageBubble.module.css` | 5 |
| `frontend/src/components/UnifiedChat/ChatThread.tsx` | 5 |
| `frontend/src/components/UnifiedChat/ChatThread.module.css` | 5 |
| `frontend/src/components/UnifiedChat/ChatInputBar.tsx` | 5 |
| `frontend/src/components/UnifiedChat/ChatInputBar.module.css` | 5 |
| `frontend/src/components/UnifiedChat/MentionInput.tsx` | 6 |
| `frontend/src/components/UnifiedChat/MentionInput.module.css` | 6 |
| `frontend/src/components/UnifiedChat/TaskMenu.tsx` | 6 |
| `frontend/src/components/UnifiedChat/TaskMenu.module.css` | 6 |
| `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx` | 6 |
| `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.module.css` | 6 |
| `frontend/src/components/UnifiedChat/FileAttachmentBar.tsx` | 6 |
| `frontend/src/components/UnifiedChat/FileAttachmentBar.module.css` | 6 |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | 7 |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css` | 7 |
| `frontend/src/components/UnifiedChat/index.ts` | 7 |

### Existing Files to Modify
| File | Task Group | Change |
|------|-----------|--------|
| `gateway/src/routes/chatV2.ts` | 2 | Add GET `/thread` handler |
| `frontend/src/components/DashboardView/DashboardView.tsx` | 7 | Import and render UnifiedChatPanel |

### Existing Files Referenced (read-only)
| File | Purpose |
|------|---------|
| `gateway/src/types/chatV2.ts` | Type reference for frontend mirrors |
| `gateway/src/config/personas/*.json` | Persona data source for frontend config |
| `gateway/src/services/threadStore.ts` | Thread persistence (used by GET handler) |
| `frontend/src/api/chatApi.ts` | API client patterns to follow |
| `frontend/src/components/chat/ChatPanel.tsx` | Collapse/resize patterns to replicate |
| `frontend/src/components/chat/ChatMessageList.tsx` | Auto-scroll logic to adapt |
| `frontend/src/components/chat/ChatInput.tsx` | Enter/Shift+Enter pattern |
| `frontend/src/components/ProductView/QuestionsTable.tsx` | Layout inspiration for StructuredQuestionsRenderer |
| `frontend/src/components/ProductView/QuestionsTableRow.tsx` | Row interaction patterns |
| `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` | Panel positioning and styling reference |
| `frontend/src/utils/fileUploadUtils.ts` | File validation and base64 utilities (import directly) |
