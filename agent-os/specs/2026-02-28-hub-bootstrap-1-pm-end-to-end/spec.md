# Specification: Hub Bootstrap 1 -- Product Definition (PM) End-to-End

## Goal

Wire the first complete bootstrap conversation flow through the Increments 1-3 infrastructure: a PM "Define Product" discovery conversation that reaches readiness, generates a MISSION.md artifact via a dedicated LLM call, presents a rendered markdown preview with Confirm/Reject buttons, saves via the existing `save_product_artifacts` MCP tool on confirm, seals the segment with a completion chip, and reflects the saved state on the Dashboard -- establishing the canonical pattern for all subsequent bootstrap increments (5-7).

## User Stories

- As a user on the Dashboard Hub Chat, I want to @PM, select "Define Product", answer discovery questions, review a generated MISSION.md preview, and confirm to save it so that my product definition is persisted and the Dashboard reflects its existence.
- As a user who has completed a PM bootstrap, I want a sealed completion chip in the thread with a transcript download so that I can reference the full conversation later.

## Specific Requirements

**Task definition update (`gateway/src/config/tasks/product-manager--define-product.json`)**
- Add an `artifacts` array entry declaring the MISSION.md artifact slot: `{ "artifactId": "mission-md", "filename": "MISSION.MD", "tool": "save_product_artifacts", "description": "Product mission statement" }`
- Leave `contextNeeds` as `[]` and `phases` as `null` for this increment; the generation step is handled by a separate endpoint, not as a formal task phase
- The existing `responseFormat` (phase/questions/summary) and task prompt remain unchanged; the PM prompt already returns questions as plain strings and the frontend will normalize them

**Frontend question normalization in `MessageBubble.tsx`**
- Update the `hasQuestions` type guard at `frontend/src/components/UnifiedChat/MessageBubble.tsx` to also detect arrays of plain strings (e.g., `["Question 1", "Question 2"]`) in addition to the existing `{ id, question }` object arrays
- Update the `extractQuestions` function to normalize plain string items into `{ id: string; question: string }` objects by auto-generating IDs (e.g., `q-0`, `q-1`, ...) -- this allows the PM task's existing responseFormat to work without prompt changes
- The `StructuredQuestionsRenderer` component itself requires no changes; it already accepts `{ id, question }[]`

**Generation endpoint (`POST /api/chat/v2/generate`)**
- Add a new POST handler in `gateway/src/routes/chatV2.ts` mounted at `/generate` on the `chatV2Router`
- Request body: `{ threadKey: ThreadKey, personaId: string, taskId: string }` -- no user message needed; the endpoint reads the full thread history from `threadStore.getThread()`
- The handler assembles transcript messages from the thread: filter to messages with `taskId === request.taskId`, skip system messages, map to OpenAI message format (`role: 'user' | 'assistant'`, `content: string`)
- Build generation messages array: `[{ role: 'system', content: MISSION_GENERATION_PROMPT_TEMPLATE }, ...transcriptMessages, { role: 'user', content: 'Generate the MISSION.MD now.' }]`
- Import `MISSION_GENERATION_PROMPT_TEMPLATE` from `gateway/src/services/promptBuilder.ts` (line 664); reuse it directly without modification
- Call `sendChatRequest()` with `tools: [save_product_artifacts tool definition]` and `toolChoice: { type: 'function', function: { name: 'save_product_artifacts' } }` -- this forces the LLM to return the mission content via a tool call, matching the v1 pattern at `chat.ts` lines 1621-1637
- Extract `missionMarkdown` from the tool call arguments (`generationResponse.toolCalls[0].arguments.missionMarkdown`)
- On success: return `{ success: true, missionMarkdown: string }` (the raw markdown content for the frontend to preview)
- On failure (no tool call returned, missing missionMarkdown, or LLM error): return `{ success: false, error: string }` with appropriate error message
- Do NOT save the artifact in this endpoint; saving is a separate step triggered after user confirms the preview

**Save endpoint (`POST /api/chat/v2/save-artifact`)**
- Add a new POST handler in `gateway/src/routes/chatV2.ts` mounted at `/save-artifact` on the `chatV2Router`
- Request body: `{ threadKey: ThreadKey, taskId: string, artifactId: string, content: string }` -- where `content` is the `missionMarkdown` string from the generate step
- Resolve `projectParentFolder` server-side: use `getConfig().conversationPersistBasePath` as the workspace root (this is the same `process.cwd()` value used throughout the gateway); derive the project parent folder from this config value -- MUST NOT accept `projectParentFolder` from the frontend request body
- Resolve `projectId` from `threadKey.projectId`
- Resolve `productName` by calling `fetchProductName(projectId)` from `gateway/src/services/architectureModelClient.ts` (line 441); fall back to `projectId` if null
- Generate a fresh `mcpSessionId` via `uuidv4()` for this single tool execution call (no long-lived session store needed)
- Call `executeToolCall()` from `gateway/src/services/toolExecutor.ts` with tool name `'save_product_artifacts'`, args `{ projectParentFolder, projectId, productName, missionMarkdown: content, overwrite: true }`, the fresh `mcpSessionId`, a request UUID, and a correlation session string
- On success (tool result status 200): persist a completion chip `ThreadMessage` to the thread via `appendMessage()` with `role: 'assistant'`, `personaId: request persona from thread`, `taskId: request.taskId`, `content: 'Product Definition complete.'`, `structuredResponse: { type: 'completion-chip', artifactId: 'mission-md', artifactName: 'MISSION.MD', taskId: request.taskId, personaId, timestamp }` -- then return `{ success: true }`
- On failure: return `{ success: false, error: string }` with the MCP error message; do NOT insert a completion chip

**ArtifactPreviewBubble component (`frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx`)**
- New React component rendered inside `MessageBubble` when `structuredResponse.type === 'artifact-preview'`
- Props: `{ markdownContent: string; onConfirm: () => void; onReject: () => void; isConfirming: boolean; disabled: boolean }`
- Renders the `markdownContent` as rendered HTML using a lightweight markdown-to-HTML approach (use `dangerouslySetInnerHTML` with a simple markdown renderer, or render line-by-line with heading/bullet detection -- keep it minimal, no heavy markdown library)
- Displays two action buttons below the preview: "Confirm" (primary, green-tinted) and "Reject" (secondary, outlined) -- Confirm button shows a spinner/disabled state when `isConfirming` is true
- Both buttons are disabled when the `disabled` prop is true (used when the segment is sealed)
- Wrapped in a bordered container with a header label like "Generated MISSION.MD" and a subtle background tint
- CSS module: `ArtifactPreviewBubble.module.css`; max-height with overflow-y scroll for long content

**CompletionChip component (`frontend/src/components/UnifiedChat/CompletionChip.tsx`)**
- New React component rendered inside `MessageBubble` when `structuredResponse.type === 'completion-chip'`
- Props: `{ taskLabel: string; personaColor: string; artifactName: string; timestamp: string; onDownloadTranscript: () => void }`
- Renders as a distinct horizontal pill/chip (not a regular message bubble): persona-colored left border or accent, task label text (e.g., "Product Definition Complete"), artifact name, and a small download icon/button for transcript
- Clicking the chip or a "Details" affordance could expand a brief summary; for this increment, the chip is static with a download transcript button
- CSS module: `CompletionChip.module.css`

**MessageBubble updates for new structured response types**
- Add a new type guard `isArtifactPreview(sr)` that checks for `structuredResponse.type === 'artifact-preview'` with a `markdownContent` string field
- Add a new type guard `isCompletionChip(sr)` that checks for `structuredResponse.type === 'completion-chip'` with `taskId`, `personaId`, `artifactName` fields
- When `isArtifactPreview` is true: render `ArtifactPreviewBubble` inline, passing `markdownContent` and wiring `onConfirm`/`onReject` to new callback props on `MessageBubbleProps`
- When `isCompletionChip` is true: render `CompletionChip` inline, looking up persona color from `getPersonaConfig()`
- Add new optional callback props to `MessageBubbleProps`: `onConfirmArtifact?: () => void`, `onRejectArtifact?: () => void`, `onDownloadTranscript?: () => void`

**StructuredQuestionsRenderer disabled state for sealed segments**
- The `StructuredQuestionsRenderer` already accepts a `disabled` prop -- no component changes needed
- `ChatThread` must determine which messages are in a sealed segment: scan the `messages` array for `completion-chip` entries; all messages above a completion chip that share the same `taskId` are sealed
- Pass `disabled={true}` to `StructuredQuestionsRenderer` (via `MessageBubble`) for messages within sealed segments
- Add a `sealedTaskIds` computation in `ChatThread` (or in `UnifiedChatPanel`): iterate messages to find completion chips and collect their `taskId` values; for each message, check if its `taskId` is in the sealed set

**useChatThread hook extensions for generate/save/reject flow**
- Add new state: `isGenerating: boolean`, `isSaving: boolean`, `artifactPreview: { taskId: string; content: string } | null`
- Add `generateArtifact(taskId: string): Promise<void>`: calls `postGenerateArtifact()` API function; on success, inserts a local assistant `ThreadMessage` with `structuredResponse: { type: 'artifact-preview', markdownContent: response.missionMarkdown }` into the messages array and sets `artifactPreview` state; on failure, inserts an error system message with retry guidance
- Add `confirmArtifact(): Promise<void>`: calls `postSaveArtifact()` API function using `artifactPreview.content`; on success, inserts a completion chip `ThreadMessage` (the backend also persists it, but the frontend adds it optimistically), clears `artifactPreview`, and triggers a dashboard re-fetch callback; on failure, inserts an error system message and keeps the preview/Confirm button available for retry
- Add `rejectArtifact(): Promise<void>`: clears `artifactPreview` state, sends a follow-up message to the PM persona with content like "I'd like to make changes." to resume discovery, appends a system message "What would you like to change?"
- The hook must detect when the PM's structured response has `phase === 'ready'` and the user sends a confirmation-like message: when the latest assistant message has `structuredResponse.phase === 'ready'`, automatically trigger `generateArtifact` after the user's confirmation message is sent -- this replaces the v1 `isMissionConfirmation()` detection, moving it to the frontend
- Return new values: `isGenerating`, `isSaving`, `artifactPreview`, `generateArtifact`, `confirmArtifact`, `rejectArtifact`

**chatV2Api client additions (`frontend/src/api/chatV2Api.ts`)**
- Add `postGenerateArtifact(threadKey: ThreadKey, personaId: string, taskId: string): Promise<{ success: boolean; missionMarkdown?: string; error?: string }>` -- POST to `/api/chat/v2/generate` with JSON body
- Add `postSaveArtifact(threadKey: ThreadKey, taskId: string, artifactId: string, content: string): Promise<{ success: boolean; error?: string }>` -- POST to `/api/chat/v2/save-artifact` with JSON body
- Follow the same fetch + error-throw pattern as `postChatV2` and `postHandoff`

**Transcript download**
- Implement a `buildTranscriptMarkdown(messages: ThreadMessage[], artifactContent: string): string` utility function in a new file `frontend/src/utils/transcriptExport.ts`
- The function filters messages to the relevant task segment (by `taskId`), formats each as a markdown section attributed to the persona or "You" for user messages, and appends the final MISSION.md content as an appendix section with the marker `> Saved artifact: agent-os/product/MISSION.MD`
- The `CompletionChip.onDownloadTranscript` callback triggers a browser download of the generated markdown string as a `.md` file using a Blob + URL.createObjectURL + click pattern

**Re-run / update flow with overwrite warning**
- When the user selects "Define Product" via the task menu and `missionExists` is truthy in the dashboard state, the frontend inserts a local system message into the thread: "A Product Definition (MISSION.md) already exists. Completing this conversation will replace it."
- This requires `DashboardView` to pass a `dashboardData` prop (or a simpler `missionExists: boolean` prop) down to `UnifiedChatPanel`, which passes it to `useChatThread` via options
- The warning is purely frontend-sourced using the already-loaded dashboard summary data; no backend existence check needed for this increment

**Dashboard summary endpoint real data migration**
- Update `gateway/src/routes/dashboardSummary.ts` to check whether `MISSION.MD` exists on disk for the Product Definition card
- Import `getConfig` and use `path.join(getConfig().conversationPersistBasePath, 'agent-os', 'product', 'MISSION.MD')` (or the equivalent path where the MCP tool writes the file) to check file existence via `fs.access()`
- Set `productDefinition.missionExists` to `card('Mission Exists', 1)` if the file exists, `card('Mission Exists', 0)` if not
- Set `productDefinition.state` to `card('State', 100)` (representing "Defined") if mission exists, or `card('State', 0)` (representing "Not Started") if not
- All other cards remain mock data; only the Product Definition card gets real data in this increment
- The existing `buildMockDashboardSummary` function signature and return type remain unchanged; the real check is injected into the `productDefinition` fields after the mock is built, or the function is updated to accept an optional `missionExists` boolean

**Frontend dashboard re-fetch after artifact save**
- After `confirmArtifact()` succeeds in `useChatThread`, trigger a re-fetch of the dashboard summary so the Product Definition card updates immediately
- This can be done via a callback prop passed from `DashboardView` to `UnifiedChatPanel` to `useChatThread` (e.g., `onArtifactSaved?: () => void`), or by exposing a `refetch` function from the dashboard data fetching hook
- The simplest approach: `DashboardView` passes a `refetchDashboard` callback; `useChatThread` calls it after successful save

**Error handling: generation failure, save failure, MCP timeout**
- Generation failure (POST `/generate` returns `success: false`): insert a system error message in the thread like "Mission generation failed: {error}. You can try again." with retry guidance; do not show an artifact preview; keep the conversation in its current state so the user can re-trigger generation
- Save failure (POST `/save-artifact` returns `success: false`): insert a system error message like "Failed to save MISSION.md: {error}. Click Confirm to retry."; keep the artifact preview and its Confirm button enabled so the user can retry
- MCP timeout: the `executeToolCall` in `toolExecutor.ts` already has a 30-second timeout; on timeout, the save endpoint returns a failure response; the frontend shows a specific timeout message: "Save timed out. Please try again."

## Existing Code to Leverage

**`gateway/src/routes/chatV2.ts` (POST handler, lines 386-597)**
- The existing POST handler pattern (validate request, resolve thread, look up registries, build messages, call LLM, append messages) is the template for both the `/generate` and `/save-artifact` handlers
- The `buildContentPartsV2` function (lines 167-203) demonstrates the file content handling pattern
- The handoff handler (lines 287-363) demonstrates the pattern for a simple POST handler that validates input, resolves/creates a thread, appends a message, and returns a success response

**`gateway/src/services/promptBuilder.ts` MISSION_GENERATION_PROMPT_TEMPLATE (line 664)**
- Import and reuse this constant directly in the new generate handler; no modifications needed to promptBuilder.ts
- The template instructs the LLM to return content exclusively via the `save_product_artifacts` tool call, which provides the `missionMarkdown` field the generate handler extracts

**`gateway/src/routes/chat.ts` mission generation flow (lines 1580-1704)**
- The v1 flow demonstrates the exact pattern to replicate: fetch product name, build generation messages from conversation history, call `sendChatRequest` with restricted tools, extract tool call arguments, merge gateway-authoritative values, execute tool call
- Key difference in v2: the generation and save are split into separate endpoints with a user-confirmed preview step in between

**`gateway/src/services/toolExecutor.ts` executeToolCall (lines 205-260)**
- Reuse directly for the save-artifact endpoint; no modifications needed
- Accepts `callId`, `toolName`, `args`, `mcpSessionId`, `requestId`, `sessionId` and returns a result with status, output, and error

**`frontend/src/components/UnifiedChat/MessageBubble.tsx` (lines 46-77)**
- The existing type guard pattern (`isTaskMenu`, `hasQuestions`, `extractQuestions`) is the exact template for adding `isArtifactPreview` and `isCompletionChip` type guards
- The rendering switch in the component body (lines 130-161) shows where to add new branches for the two new structured response types

## Out of Scope

- Streaming responses (the v2 endpoint returns full responses, not SSE)
- Conversation summarization for context window management (Increment 11)
- Side panel PM usage on non-Dashboard screens (Increments 8-9)
- Removal of the v1 ProductManagerChatPanel (Increment 10); it remains fully functional
- Multi-artifact batches (generating and saving multiple artifacts in a single flow)
- Version diff/merge UI for comparing old and new MISSION.md content
- Fine-grained permissions or role-based access control for artifact operations
- Per-persona history filtering in the thread view
- Implement screen changes of any kind
- Full context resolver system (transcript assembly is handled internally in the generation endpoint)
- Standardizing the PM task prompt to emit `{ id, question }` structured objects instead of plain strings (deferred)
- Backend-sourced overwrite warning via a real context resolver checking MISSION.md existence (deferred as hardening)
- Heavy markdown rendering library (use a lightweight approach for the artifact preview)
