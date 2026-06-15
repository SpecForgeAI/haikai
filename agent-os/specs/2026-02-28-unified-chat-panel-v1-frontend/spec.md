# Specification: Unified Chat Panel v1 (Frontend)

## Goal

Build a reusable, decomposed React chat panel component (`UnifiedChatPanel`) that consumes the v2 conversation engine backend (POST /api/chat/v2), renders persona-attributed message threads with @-mention routing, task menus, structured question tables, file attachment, and collapse/resize behaviour. This is Increment 2 of the 11-increment unified conversation engine plan; the backend (Increment 1) is complete.

## User Stories

- As a user on the Dashboard, I want to see a right-hand chat panel with an Assistant persona so that I can verify the unified chat infrastructure is wired end-to-end.
- As a user chatting with a persona, I want to type `@` and select a persona from a filterable dropdown so that I can direct my message to a specific team member.
- As a user receiving a structured response with questions, I want to see them rendered in a questions table with per-question answer inputs so that I can respond to each question individually and submit answers as a numbered list.

## Specific Requirements

**Frontend persona config (`frontend/src/config/personaConfig.ts`)**
- Create a static config array mirroring the 6 backend persona JSON files under `gateway/src/config/personas/`
- Each entry: `{ id: string; displayName: string; color: string; initials: string }` where `initials` is derived (e.g., "PM", "AR", "AS", "UX", "TE", "SD")
- Persona hex colors: Assistant `#5C6BC0`, Product Manager `#00897B`, Architect `#7B1FA2`, UX Designer `#F57C00`, Test Engineer `#2E7D32`, Software Developer `#455A64`
- Export a lookup helper `getPersonaConfig(personaId: string)` that returns the config entry or a fallback grey default
- This is a pure data file with no React dependencies; no backend fetch

**Chat v2 API client (`frontend/src/api/chatV2Api.ts`)**
- New file alongside existing `chatApi.ts`; do not modify `chatApi.ts`
- Mirror the backend types `ChatV2Request`, `ChatV2Response`, `ThreadKey`, `ThreadMessage`, `Thread` from `gateway/src/types/chatV2.ts` as frontend-side TypeScript interfaces (do not import across project boundaries)
- Include a `threadKeyToString(key: ThreadKey): string` utility matching the backend serialisation logic
- `postChatV2(request: ChatV2Request): Promise<ChatV2Response>` -- POST to `/api/chat/v2` with JSON body; throw on non-2xx
- `getThreadHistory(threadKey: ThreadKey): Promise<Thread>` -- GET to `/api/chat/v2/thread?key={serialised}` ; return the Thread object with messages array
- Follow the fetch + error-throw pattern from `postChatMessage` in `frontend/src/api/chatApi.ts` (lines 763-775)
- Use `GATEWAY_BASE` from `import.meta.env.VITE_GATEWAY_BASE_URL ?? ''` matching chatApi.ts

**GET /api/chat/v2/thread backend endpoint (`gateway/src/routes/chatV2.ts`)**
- Add a GET handler to the existing `chatV2Router` alongside the POST handler
- Accept query param `key` (the serialised thread key string)
- Parse it using `parseThreadKey(key)` from `gateway/src/types/chatV2.ts`
- Call `getThread(threadKey)` from `gateway/src/services/threadStore.ts`; if null, return an empty Thread with `messages: []`
- Return the full `Thread` object as JSON (threadKey, projectId, messages, activePersonaId, activeTaskId, createdAt, updatedAt)
- Return 400 if `key` query param is missing or `parseThreadKey` throws

**Custom hook `useChatThread` (`frontend/src/hooks/useChatThread.ts`)**
- Signature: `useChatThread(threadKey: ThreadKey, options?: { initialPersonaId?: string; allowedPersonaIds?: string[] })`
- Local state via `useState`: `messages: ThreadMessage[]`, `activePersonaId: string`, `activeTaskId: string`, `isLoading: boolean`, `error: string | null`
- On mount (and when `threadKey` changes), call `getThreadHistory(threadKey)` to load existing messages; set `activePersonaId` and `activeTaskId` from the returned Thread
- `sendMessage(text: string, files?: FileAttachment[])`: builds `ChatV2Request` using current `activePersonaId`, `activeTaskId`, and `threadKey`; appends optimistic user message; calls `postChatV2`; appends assistant response; handles task-menu responses by updating state
- `selectPersona(personaId: string)`: sets `activePersonaId`; resets `activeTaskId` to `'unknown'`
- `selectTask(taskId: string)`: sets `activeTaskId`; auto-sends a system-style message like `"Selected task: {menuLabel}"` via `sendMessage`
- Return: `{ messages, activePersonaId, activeTaskId, isLoading, error, sendMessage, selectPersona, selectTask }`
- No React Context; pure local state hook

**UnifiedChatPanel container (`frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`)**
- Thin container; delegates all rendering to subcomponents
- Props: `{ threadKey: ThreadKey; initialPersonaId?: string; allowedPersonaIds?: string[] }`
- Calls `useChatThread(threadKey, { initialPersonaId, allowedPersonaIds })` for all state
- Manages panel width state with localStorage persistence (key: `unified-chat-panel-width`; default 380px; min 280px; max 50% viewport)
- Manages collapsed/expanded boolean state
- Collapsed state renders a slim vertical tab (32px wide) with a chat icon and vertical "Chat" label, matching `ChatPanel.module.css` `.collapsedTab` pattern
- Expanded state renders: header, ChatThread, ChatInputBar (with MentionInput + FileAttachmentBar), left-edge resize handle
- Left-edge drag handle for width resize (opposite side from ChatPanel which uses right-edge) following the same mousedown/mousemove/mouseup pattern from `ChatPanel.tsx` (lines 88-154)
- CSS module: `UnifiedChatPanel.module.css`; position fixed, right-anchored, top 60px (below TopBar), height `calc(100vh - 60px)`, z-index 900 (matching PersonaHelperPanel)

**ChatThread subcomponent (`frontend/src/components/UnifiedChat/ChatThread.tsx`)**
- Scrollable message list with auto-scroll behaviour adapted from `ChatMessageList.tsx`
- Props: `{ messages: ThreadMessage[]; isLoading: boolean }`
- Renders each message using `MessageBubble` subcomponent
- User messages right-aligned; assistant messages left-aligned with persona avatar and name; system messages centered with muted styling
- Shows a typing indicator (three-dot animation or spinner) when `isLoading` is true
- Auto-scrolls to bottom on new messages unless user has scrolled up (same 20px threshold logic from ChatMessageList)

**MessageBubble subcomponent (`frontend/src/components/UnifiedChat/MessageBubble.tsx`)**
- Props: `{ message: ThreadMessage }`
- For assistant messages: renders a coloured circle avatar (28px diameter) with persona initials using `getPersonaConfig(message.personaId)` for colour and initials; displays persona displayName above the message content
- For user messages: right-aligned bubble with "You" label; no avatar
- For system messages: centered, muted text, no avatar
- If `message.structuredResponse` exists and has `type === 'task-menu'`, renders a `TaskMenu` inline instead of plain text
- If `message.structuredResponse` exists and contains a `questions` array (or `openQuestions`), renders a `StructuredQuestionsRenderer` below the message text
- Message content rendered as plain text (no markdown parsing in v1)

**TaskMenu subcomponent (`frontend/src/components/UnifiedChat/TaskMenu.tsx`)**
- Props: `{ tasks: Array<{ taskId: string; menuLabel: string; description: string }>; onSelectTask: (taskId: string) => void }`
- Renders each task as a clickable card/button with `menuLabel` as primary text and `description` as secondary text
- On click, calls `onSelectTask(taskId)` which triggers `useChatThread.selectTask`
- Styled as outlined cards with hover state; stacked vertically within the message bubble area

**StructuredQuestionsRenderer subcomponent (`frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx`)**
- New generic component inspired by `QuestionsTable.tsx` and `QuestionsTableRow.tsx` layout and interaction patterns
- Props: `{ questions: Array<{ id: string; question: string }>; onSubmitAnswers: (answers: Array<{ id: string; question: string; answer: string }>) => void; disabled?: boolean }`
- Renders a header row ("Question" / "Answer") and one row per question with question text and a single-line text input
- Local state tracks answers per question id
- "Submit Answers" button enabled when at least one answer is non-empty; disabled during submission
- On submit, calls `onSubmitAnswers` with the answered questions; the parent formats answers as a numbered list string (e.g., `"1. Q: ... A: ..."`) and sends via `sendMessage`
- Does NOT reuse existing `QuestionsTable` or `QuestionsTableRow`; is a self-contained new component

**ChatInputBar subcomponent (`frontend/src/components/UnifiedChat/ChatInputBar.tsx`)**
- Contains `MentionInput` (textarea with @-mention) + `FileAttachmentBar` + send button + Paperclip button
- Props: `{ onSend: (text: string, files?: FileAttachment[]) => void; disabled?: boolean; allowedPersonaIds?: string[]; onPersonaSelected: (personaId: string) => void }`
- Enter (without Shift) sends the message; Shift+Enter inserts newline (matching `ChatInput.tsx` pattern)
- Paperclip button opens a hidden file input; selected files appear as removable chips below the textarea
- File validation uses `validateFiles` and `readFilesAsBase64` from `frontend/src/utils/fileUploadUtils.ts` directly (no modifications to that file)
- Send button disabled when textarea is empty/whitespace-only AND no files are attached, or when `disabled` is true

**MentionInput subcomponent (`frontend/src/components/UnifiedChat/MentionInput.tsx`)**
- Textarea that detects `@` character and opens a filterable dropdown
- Props: `{ value: string; onChange: (value: string) => void; onPersonaSelected: (personaId: string) => void; allowedPersonaIds?: string[]; disabled?: boolean; onSubmit: () => void }`
- When user types `@`, show a dropdown positioned above the cursor listing personas filtered by the text after `@`
- If `allowedPersonaIds` is provided, only show those personas; otherwise show all 6
- Keyboard navigation: ArrowUp/ArrowDown to move selection, Enter to select, Escape to dismiss
- On selection: insert `@DisplayName ` into the textarea text; call `onPersonaSelected(personaId)` to update `useChatThread.selectPersona`
- Dropdown styled as a floating list with persona colour dots and display names

**FileAttachmentBar subcomponent (`frontend/src/components/UnifiedChat/FileAttachmentBar.tsx`)**
- Props: `{ files: File[]; onRemove: (index: number) => void }`
- Renders a horizontal row of file chips (filename + X remove button) below the textarea
- Each chip shows truncated filename (max 20 chars) with full name as title tooltip
- Follows the same chip pattern used in `ProductManagerChatPanel.tsx`

**Dashboard integration (`frontend/src/components/DashboardView/DashboardView.tsx`)**
- Import and render `UnifiedChatPanel` in the DashboardView component
- Pass `threadKey: { type: 'hub', projectId: activeProject.id }` and `initialPersonaId: 'assistant'`
- The panel renders alongside the existing dashboard content (right-anchored fixed position, so no layout changes to the dashboard grid)
- The existing `PersonaHelperPanel` continues to render as-is; both panels can coexist for now (PersonaHelperPanel will be removed in Increment 10)
- When `activeProject` is null, do not render the UnifiedChatPanel

**CSS and styling conventions**
- All new components use CSS Modules (`.module.css` files) following the project convention
- No CSS framework (no Tailwind, no MUI); vanilla CSS only
- Persona avatar circles: 28px diameter, `border-radius: 50%`, white text, background colour from persona config
- Panel border-left: `1px solid #e0e0e0`; box-shadow: `-2px 0 8px rgba(0, 0, 0, 0.08)` (matching PersonaHelperPanel)
- Font sizes: header title 16px/600, persona label 12px/600, message content 14px/400, timestamps 11px/400

## Existing Code to Leverage

**`frontend/src/components/chat/ChatPanel.tsx`**
- Reuse the collapse/expand toggle pattern (lines 34-36, 157-179): slim vertical tab with chat icon when collapsed, header with collapse button when expanded
- Reuse the horizontal resize pattern with mousedown/mousemove/mouseup on document (lines 88-154): `isResizing` ref, min/max width clamping, cursor override during drag
- Reuse the optimistic message append + error handling pattern (lines 39-85)

**`frontend/src/api/chatApi.ts`**
- Follow the same API client structure: `GATEWAY_BASE` from env, async function with fetch + `res.ok` check + `throw new Error` on failure (lines 39, 763-775)
- Mirror the `ChatMessage` interface pattern but adapted for `ThreadMessage` from v2 types
- Reuse `generateMessageId()` pattern (line 941-943) for any client-side IDs

**`frontend/src/components/ProductView/QuestionsTable.tsx` + `QuestionsTableRow.tsx`**
- Inspire the layout structure of `StructuredQuestionsRenderer`: header row, per-question rows with text input, submit button with enable/disable logic
- Replicate the "at least one answer non-empty" button enable logic (QuestionsTable lines 134-138)
- Replicate the disabled input pattern during submission (QuestionsTableRow lines 62-65)

**`frontend/src/utils/fileUploadUtils.ts`**
- Import and use directly without modification: `validateFiles`, `readFilesAsBase64`, `ACCEPTED_MIME_TYPES`, `MAX_FILES`, `MAX_FILE_SIZE_BYTES`
- Already handles all validation (count, extension, size) and base64 reading needed by the ChatInputBar

**`frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css`**
- Reference for panel positioning: fixed, `top: 60px`, `right: 0`, `height: calc(100vh - 60px)`, `z-index: 900`, white background, left border and shadow
- Reference for header layout: flex row, `padding: 16px 20px`, `border-bottom: 1px solid #e0e0e0`

## Out of Scope

- Streaming responses (SSE or WebSocket) -- all responses are synchronous request/response
- Artifact preview, confirmation, or save UX (deferred to Increments 4-7)
- Completion chips for sealed bootstrap segments (deferred to Increment 4+)
- Thread summarisation and context windowing (deferred to Increment 11)
- Mobile or responsive layout refinements
- Markdown rendering in message content (plain text only in v1)
- Refactoring the existing QuestionsTable or QuestionsTableRow to be generic
- Introducing a new React Context for chat state management
- Full Hub integration with multi-persona @-mention routing and bootstrap flows (Increment 3)
- Side Panel integration on Architecture/Product/Roadmap screens (Increments 8-9)
- Backend persona GET endpoint (using frontend static config instead)
- Removal of PersonaHelperPanel or legacy chat panels (deferred to Increment 10)
