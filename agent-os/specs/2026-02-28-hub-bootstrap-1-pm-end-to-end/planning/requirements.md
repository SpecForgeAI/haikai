# Spec Requirements: Hub Bootstrap 1 -- Product Definition (PM) End-to-End

## Initial Description

Increment 4 of the 11-increment unified conversation engine plan. This is the FIRST real bootstrap conversation flow, putting Increments 1-3 infrastructure to actual use. The spec covers four areas:

1. **PM "Define Product Definition" Task Registration** -- Wire the PM's "Define Product Definition" task through the task registry so it appears in the PM's task menu when @PM is mentioned in the Hub chat. Use the existing PRODUCT_MANAGER_PROMPT_TEMPLATE via the prompt composition pipeline.

2. **Artifact Hook with Preview -> Confirm -> Save Flow** -- When the PM conversation produces an artifact (MISSION.md content), display a preview in the chat. User can confirm or reject. On confirm, save MISSION.md using existing save infrastructure. Content generated using existing MISSION_GENERATION_PROMPT_TEMPLATE.

3. **Completion Chip (Sealed Segment)** -- After the PM bootstrap conversation completes, a completion chip appears marking the segment as sealed. Chip is clickable with summary and allows transcript download.

4. **Dashboard Integration** -- MISSION.md saved from PM conversation reflected in Dashboard strategic foundation section. Dashboard shows updated state after artifact is saved.

Key constraint: Focus on getting one complete end-to-end bootstrap flow working correctly as a template for subsequent bootstrap increments (5-7).

## Requirements Discussion

### First Round Questions

**Q1:** The PM "define-product" task already exists in the task registry at `gateway/src/config/tasks/product-manager--define-product.json` with its task prompt at `gateway/src/config/prompts/product-manager.define-product.task.md`, and the existing prompt content is already extracted from PRODUCT_MANAGER_PROMPT_TEMPLATE. The task definition currently has `"contextNeeds": []`, `"artifacts": []`, and `"phases": null`. I assume that for this increment we need to: (a) update `contextNeeds` if any context injection is needed (e.g., existing MISSION.md for re-run detection), (b) populate the `artifacts` array with the MISSION.md artifact slot declaration, and (c) potentially add a "generation" phase or handle the generation flow differently since the current responseFormat only covers the discovery phase (questions/ready) but NOT the mission generation step. The existing v1 flow uses a separate LLM call with MISSION_GENERATION_PROMPT_TEMPLATE when the user confirms -- should the v2 flow follow this same two-call pattern (discovery -> user confirms -> separate generation call), or should we design a different approach?

**Answer:** Keep the same two-call pattern: discovery conversation first, then on Confirm run a separate mission-generation call using a dedicated generation prompt (do not model this as a formal task "phase" yet).

**Q2:** The existing v1 PM flow uses an MCP tool call (`save_product_artifacts`) to save MISSION.md. The tool writes to `agent-os/product/MISSION.MD` on disk and upserts a minimal ProductDefinition record. For the v2 flow, I see two options: (a) Reuse the same MCP tool execution pipeline from `chat.ts` (which requires session management and tool infrastructure), or (b) Create a new dedicated REST endpoint (e.g., `POST /api/chat/v2/artifact/save`) that handles MISSION.md generation and saving without MCP tools -- the endpoint would receive the conversation transcript, call LLM with MISSION_GENERATION_PROMPT_TEMPLATE to generate the mission content, then write to disk directly. Which approach do you prefer? The dedicated endpoint approach seems simpler for v2 and avoids coupling to the v1 MCP tool infrastructure.

**Answer:** Reuse the existing MCP tool execution pipeline (save_product_artifacts) for saving MISSION.md in v2.

**Q3:** For the artifact preview in the chat UI: when the PM discovery conversation reaches `phase: "ready"` and the user confirms, the LLM generates MISSION.md content. I assume the generated markdown content should appear as a preview within the chat thread -- but how should this look? Options: (a) An inline expandable markdown preview panel within the chat thread (rendered markdown with a collapsible header like "Generated MISSION.md"), (b) A modal overlay showing the full rendered markdown with Confirm/Reject buttons, (c) A new message bubble type with rendered markdown and inline Confirm/Reject buttons below it. I am leaning toward option (c) as it keeps the flow within the chat thread and is most consistent with the conversational UI pattern. What is your preference?

**Answer:** Use a new chat message bubble type that renders the markdown preview with inline Confirm/Reject buttons beneath it.

**Q4:** For the Confirm/Reject interaction after the artifact preview: I assume the Confirm and Reject buttons appear directly within or below the artifact preview message bubble. On Confirm, the system saves MISSION.md and appends a success system message. On Reject, what should happen? Options: (a) The PM re-asks "What would you like to change?" and the discovery conversation resumes at `phase: "questions"` with the previous context, (b) The artifact preview is simply dismissed with a system message "Mission generation cancelled" and the user must explicitly re-trigger generation, (c) A text input appears asking "What changes would you like?" before regenerating. Which approach should we take?

**Answer:** On Reject, resume discovery with a simple "What would you like to change?" prompt (no special inline edit UI yet).

**Q5:** For the completion chip (sealed segment): the design doc describes a chip that appears after the bootstrap conversation completes, marking the segment as sealed. I assume "complete" means MISSION.md has been successfully saved (Confirm was clicked and save succeeded). The chip should: (a) Display text like "Product Definition Complete" with the PM persona color, (b) Be rendered as a distinct message type in the thread (not a regular message bubble), (c) Mark all preceding PM define-product messages as part of the sealed segment. How should the sealed state be persisted? Should it be a special ThreadMessage with a `structuredResponse.type === 'completion-chip'`, stored in the thread like any other message? And should it prevent the user from interacting with the questions/answers in the sealed portion of the thread (i.e., disable answer inputs and submit buttons on older StructuredQuestionsRenderer instances)?

**Answer:** Yes: store the completion chip as a special ThreadMessage (e.g., structuredResponse.type='completion-chip') and disable interactions on structured-question blocks within the sealed segment.

**Q6:** For the transcript download from the completion chip: I assume the transcript should include all messages from the PM define-product segment of the hub thread (from when the task was selected to the completion chip), formatted as a readable document. What format should this be? Options: (a) Plain text with timestamps and role labels, (b) Markdown with persona-attributed sections, (c) JSON export of the raw thread messages. And should the generated MISSION.md content itself be included in the transcript? I am assuming Markdown (option b) including the final artifact content.

**Answer:** Export Markdown with persona-attributed sections, and include the final MISSION.md content (plus a link/marker to the saved artifact revision if available).

**Q7:** For Dashboard integration: the Dashboard currently uses mock data from `buildMockDashboardSummary()` for the Strategic Foundation section. The Product Definition card shows `strategicFoundation.productDefinition.missionExists` and `strategicFoundation.productDefinition.state`. I assume for this increment we need to: (a) Replace at least the `missionExists` metric with a real check (does `agent-os/product/MISSION.MD` exist on disk?), (b) Potentially update `state` to reflect "Defined" vs "Not Started" based on whether MISSION.md exists. Should the dashboard summary endpoint be updated to read real data for the Product Definition card specifically (while keeping other cards as mock), or should we take a different approach like having the frontend re-fetch dashboard data after a successful MISSION.md save?

**Answer:** Do both: after save, frontend re-fetches dashboard summary, and the summary endpoint should perform a real mission-existence check as soon as feasible.

**Q8:** The existing v1 ProductManagerChatPanel at `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` uses the v1 `POST /api/chat` endpoint with `mode: 'product_manager'`. Should this existing PM chat panel continue to work alongside the new Hub-based PM flow for this increment? The design doc (Increment 10) says legacy panels are removed later. I assume the v1 PM chat panel remains untouched and functional -- the new Hub flow is an additional path, not a replacement yet. Is that correct?

**Answer:** Correct: the v1 ProductManagerChatPanel stays untouched and functional until Increment 10.

**Q9:** The current `product-manager--define-product.json` task definition has a `responseFormat` with `phase: "questions" | "ready"` but the existing v1 questions come back as an array of plain strings (e.g., `["Question 1", "Question 2"]`). However, the StructuredQuestionsRenderer in the UnifiedChat panel expects questions in the format `{ id: string; question: string }[]`. The MessageBubble's `hasQuestions` type guard looks for `questions` or `openQuestions` arrays containing objects with `id` and `question` fields. This means the PM task's responseFormat needs to be updated so the LLM returns questions as objects with `id` fields instead of plain strings. Should we update the PM task prompt and responseFormat to emit `{ id, question }` objects, or should the frontend adapt to handle both plain string arrays and structured question objects?

**Answer:** Frontend should adapt to handle both string questions and {id, question} objects for now; standardize prompts to structured objects later.

**Q10:** Edge case -- re-running the PM conversation: if a user has already completed the PM bootstrap (MISSION.md exists, completion chip is in the thread), and they @PM again and select "Define Product", what should happen? Options: (a) Prevent re-selection (disable the "Define Product" task in the menu with a "Complete" badge), (b) Allow it and start a fresh discovery with the existing MISSION.md injected as context (an "update" flow), (c) Show a warning "Product Definition already complete. To modify, go to the Product screen." For this increment, should we keep it simple with option (c) or implement the re-run capability?

**Answer:** Keep it simple: allow re-running as an "update" flow (same task) with a brief warning message that it will overwrite/replace the existing mission on confirm.

**Q11:** The current context resolvers at `gateway/src/services/contextResolvers.ts` are all stubs returning empty strings. For this increment, the PM define-product task has `"contextNeeds": []` so no context injection is needed for the discovery phase. However, the mission generation step needs the full conversation transcript. Should we implement a real context resolver for this increment (e.g., a `conversation-transcript` resolver that extracts thread history), or should the generation endpoint/flow handle transcript assembly internally without going through the context resolver system?

**Answer:** Handle transcript assembly internally in the generation flow/endpoint (don't build a full resolver system yet just for this).

**Q12:** For error handling during the artifact save: if the MISSION.md file write fails (disk error, permission issue), I assume we should: (a) Show an error message in the chat thread, (b) Keep the Confirm/Reject buttons available so the user can retry, (c) NOT insert the completion chip. Are there any other error scenarios to consider -- for example, what if the LLM generation call itself fails (produces invalid content or times out)?

**Answer:** Yes: on save failure, show an in-thread error and keep Confirm available to retry; also handle generation failure and MCP timeout with clear retry guidance.

**Q13:** The raw idea mentions that this increment should serve as a "template for subsequent bootstrap increments (5-7)." This implies the artifact hook, completion chip, and sealed segment patterns should be designed as reusable infrastructure. Should the spec explicitly define reusable abstractions (e.g., a generic `ArtifactPreviewBubble` component, a generic `CompletionChip` component, a generic artifact save endpoint that accepts different artifact types), or should we build it specifically for MISSION.md first and extract reusable patterns in Increment 5 when the second bootstrap (Roadmap) needs the same machinery?

**Answer:** Build specifically for MISSION.md first, but name components/endpoints generically enough to extract in Increment 5 (avoid heavy abstractions now).

**Q14:** Is there anything that should explicitly be OUT OF SCOPE for this increment? For instance: (a) Streaming responses (the v2 endpoint currently returns full responses, not SSE), (b) Conversation summarization (Increment 11), (c) Side panel PM usage (Increments 8-9), (d) Removal of the v1 PM chat panel (Increment 10), (e) Any other features or edge cases you want to explicitly exclude?

**Answer:** Also out of scope: multi-artifact batches, version diff/merge UI, fine-grained permissions/roles, and per-persona history filtering.

### Existing Code to Reference

Based on the thorough codebase exploration performed during research, the following existing features and code paths are directly relevant:

**Backend -- Task Registry and Prompt Pipeline (Increment 1):**
- Persona config: `gateway/src/config/personas/product-manager.json`
- Task config: `gateway/src/config/tasks/product-manager--define-product.json`
- Task prompt: `gateway/src/config/prompts/product-manager.define-product.task.md`
- Persona identity: `gateway/src/config/prompts/product-manager.identity.md`
- Registry loader: `gateway/src/services/registryLoader.ts`
- Prompt composer: `gateway/src/services/promptComposer.ts`
- Thread store: `gateway/src/services/threadStore.ts`
- ChatV2 route: `gateway/src/routes/chatV2.ts`
- ChatV2 types: `gateway/src/types/chatV2.ts`
- Context resolvers (stubs): `gateway/src/services/contextResolvers.ts`

**Backend -- Existing v1 Mission Save Infrastructure:**
- MISSION_GENERATION_PROMPT_TEMPLATE: `gateway/src/services/promptBuilder.ts` (line 664)
- PRODUCT_MANAGER_PROMPT_TEMPLATE: `gateway/src/services/promptBuilder.ts` (line 329)
- Mission confirmation detection: `gateway/src/routes/chat.ts` (line 532 `isMissionConfirmation()`, line 1580-1704 generation flow)
- MCP tool executor: `gateway/src/services/toolExecutor.ts` (lines 205-260 `executeToolCall()`)
- Tool definitions: `gateway/src/types/tools.ts` (line 281 `save_product_artifacts` definition, line 143 `SaveProductArtifactsParams`)
- Session store (provides mcpSessionId): `gateway/src/services/sessionStore.ts` (line 160 `getOrCreateSession`)
- Product name fetcher: `gateway/src/services/architectureModelClient.ts` (line 441 `fetchProductName`)
- Dashboard summary (mock): `gateway/src/routes/dashboardSummary.ts`
- Dashboard mock service: `gateway/src/services/dashboardSummaryMockService.ts`
- Dashboard types: `gateway/src/types/dashboard.ts` (line 163 `ProductDefinitionMetrics`)
- Gateway config: `gateway/src/config.ts` (line 153 `mcpBaseUrl`, line 86 `threadPersistBasePath`)

**Frontend -- UnifiedChat Components (Increments 2-3):**
- UnifiedChatPanel: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- ChatThread: `frontend/src/components/UnifiedChat/ChatThread.tsx`
- MessageBubble: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
- TaskMenu: `frontend/src/components/UnifiedChat/TaskMenu.tsx`
- StructuredQuestionsRenderer: `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx`
- useChatThread hook: `frontend/src/hooks/useChatThread.ts`
- chatV2Api client: `frontend/src/api/chatV2Api.ts`

**Frontend -- Existing v1 PM Chat Panel:**
- ProductManagerChatPanel: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`
- Dashboard view: `frontend/src/components/DashboardView/DashboardView.tsx` (line 265 Product Definition card, line 272 `renderMetric`)

**Design Document:**
- Unified conversation engine analysis: `docs/unified-conversation-engine-analysis.txt` (sections 4, 6, 7, 11, 14 -- Increment 4)

### Follow-up Questions

Based on the answers provided and detailed codebase analysis, 3 follow-up questions were identified covering critical technical gaps. All have been answered.

**Follow-up 1:** You chose to reuse the existing MCP tool execution pipeline (`save_product_artifacts` via `executeToolCall`). Codebase analysis reveals two critical dependencies that the v2 flow currently lacks:

(a) **`projectParentFolder`**: The `save_product_artifacts` tool requires `projectParentFolder` (the absolute filesystem path to the project root, e.g., `C:\Workspaces\SSD\architecture-store-and-diagrams`). In v1, this comes from `context.projectParentFolder` in the frontend request body. The v2 `ChatV2Request` does NOT include this field -- it only has `threadKey.projectId`. The spec needs to resolve how the v2 generation endpoint obtains `projectParentFolder`. Options: (a) Add `projectParentFolder` to the ChatV2Request (or a new generation-specific request), (b) Derive it from gateway config (e.g., `conversationPersistBasePath` or a new config field), (c) Look it up from the architecture-model-service by projectId. Which approach?

(b) **`mcpSessionId`**: The `executeToolCall` function requires an `mcpSessionId` (UUID passed to the MCP server via the request body). In v1, this comes from `session.mcpSessionId` in the `InMemorySessionStore`. The v2 flow has no session store -- threads replaced sessions. Should the v2 generation endpoint: (a) Generate a fresh UUID per generation call (simplest), (b) Store an mcpSessionId on the Thread object, (c) Reuse the v1 session store just for MCP calls? A fresh UUID per call seems simplest since the MCP server treats sessionId as a correlation identifier rather than a stateful session.

**Answer:** projectParentFolder should be derived server-side from the project (lookup via architecture-model-service/project metadata or a gateway-configured workspace root + projectId mapping) and MUST NOT be sent from the frontend; mcpSessionId should be generated fresh per tool execution (UUID) and used only for that call (no long-lived v2 session store needed).

**Follow-up 2:** The two-call pattern means the generation flow needs a new endpoint or a special mode in the existing POST handler. In v1, the flow is: (1) `isMissionConfirmation()` detects the user's "yes" message, (2) builds generation messages from conversation history, (3) calls LLM with `MISSION_GENERATION_PROMPT_TEMPLATE` + restricted `save_product_artifacts` tool, (4) extracts tool call with `missionMarkdown`, (5) merges `projectParentFolder`/`projectId`/`productName` into args, (6) calls `executeToolCall`. For v2, this generation call is triggered AFTER the user clicks "Confirm" on the artifact preview. But the artifact preview itself contains the generated MISSION.md content (from the generation LLM call). This means the flow is actually THREE steps: (1) Discovery reaches `phase: "ready"`, (2) User confirms readiness -> generation LLM call produces the MISSION.md markdown -> display in artifact preview bubble, (3) User clicks Confirm on preview -> execute MCP tool to save to disk. So the generation LLM call (step 2) and the MCP save (step 3) are separate actions. Is this the correct interpretation? Or should the generation and save happen in a single server round-trip when the user clicks Confirm (i.e., the user never sees the preview until it's already saved)?

**Answer:** Use the three-step flow: generate -> show preview -> user confirms -> then save (never save before explicit confirm).

**Follow-up 3:** For the "update" flow (re-running PM conversation when MISSION.md already exists, per Q10 answer): you mentioned a "brief warning message." Should this warning come from the backend (i.e., when the task is selected and `product-manager--define-product` is invoked, the backend detects MISSION.md exists and injects a warning into the first response), or from the frontend (i.e., the frontend checks dashboard data for `missionExists` and shows a local warning before starting the conversation)? If from the backend, this means implementing a real `mission` context resolver to check file existence during the discovery task, which ties into the `contextNeeds` array. If from the frontend, it is simpler but less reliable.

**Answer:** Source the overwrite warning from the frontend using already-loaded dashboard/missionExists state (backend existence checks can come later as a hardening step).

## Visual Assets

### Files Provided:
No visual assets provided. The visuals folder at `C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-02-28-hub-bootstrap-1-pm-end-to-end/planning/visuals/` exists but contains no image files.

### Visual Insights:
N/A -- no visuals to analyze.

## Requirements Summary

### Functional Requirements

**PM Task Registration and Discovery Conversation:**
- PM "Define Product Definition" task wired through the v2 registry and prompt composition pipeline
- Existing task definition at `gateway/src/config/tasks/product-manager--define-product.json` updated with artifact slot declaration in the `artifacts` array
- Discovery conversation uses existing structured JSON response format (`phase: "questions" | "ready"`, `questions: string[]`, `summary: string`)
- Frontend adapts `MessageBubble.hasQuestions()` and `extractQuestions()` to handle both plain string question arrays and `{id, question}` structured objects (normalizing strings to objects with auto-generated IDs)

**Three-Step Artifact Flow (Generate -> Preview -> Save):**
- Step 1 -- Discovery reaches `phase: "ready"` and user sends a confirmation message (e.g., "yes", "proceed")
- Step 2 -- Backend generation endpoint calls LLM with `MISSION_GENERATION_PROMPT_TEMPLATE` + thread conversation history as transcript (assembled internally, not via context resolver system); returns generated MISSION.md markdown content to frontend; frontend displays content in a new `artifact-preview` message bubble type with rendered markdown and inline Confirm/Reject buttons
- Step 3 -- On Confirm: frontend calls a save endpoint; backend resolves `projectParentFolder` server-side (via architecture-model-service lookup or gateway-configured workspace root + projectId mapping -- MUST NOT come from frontend); backend generates a fresh `mcpSessionId` UUID for the call; backend calls `executeToolCall` with `save_product_artifacts` tool including `projectParentFolder`, `projectId`, `productName`, and `missionMarkdown`; on success, frontend appends a success system message and inserts a completion chip
- On Reject: backend sends the conversation back to the PM persona with a "What would you like to change?" prompt, resuming the discovery conversation with existing context

**Completion Chip and Sealed Segments:**
- Completion chip stored as a special `ThreadMessage` with `structuredResponse.type = 'completion-chip'` and metadata including task ID, persona ID, artifact name, and timestamp
- Chip rendered as a distinct visual element (not a regular message bubble) with PM persona color
- All `StructuredQuestionsRenderer` instances above the completion chip in the thread are rendered in a disabled/read-only state (inputs disabled, submit button hidden or disabled)
- Chip is clickable to expand a summary and offer a transcript download link

**Transcript Download:**
- Markdown format with persona-attributed sections (e.g., `### Product Manager`, `### You`)
- Includes all messages from the PM define-product segment (task selection through completion chip)
- Includes the final generated MISSION.md content as an appendix section
- Includes a marker/link referencing the saved artifact path (`agent-os/product/MISSION.MD`)

**Dashboard Integration:**
- Dashboard summary endpoint (`GET /dashboard/summary`) updated to perform a real MISSION.md file-existence check for the `ProductDefinitionMetrics` card (`missionExists` value is 1 if file exists, 0 if not; `state` value reflects "Defined" vs "Not Started"); other cards remain mock data
- Frontend re-fetches dashboard summary after a successful artifact save to reflect the updated state immediately

**Re-Run / Update Flow:**
- Re-running the PM conversation when MISSION.md already exists is allowed (same task, no blocking)
- Frontend sources the overwrite warning from already-loaded dashboard `missionExists` state -- displays a local warning message in the chat (e.g., "A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.") before the conversation proceeds
- No backend existence check or context resolver needed for the warning in this increment

**Error Handling:**
- LLM generation failure (step 2): show an in-thread error message with retry guidance; do not display an artifact preview; allow user to retry the generation
- MCP save failure (step 3): show an in-thread error message; keep the Confirm button available on the artifact preview so the user can retry saving; do NOT insert the completion chip
- MCP timeout: treat as a save failure with specific timeout messaging

### Reusability Opportunities
- Components named generically (e.g., `ArtifactPreviewBubble` not `MissionPreviewBubble`, `CompletionChip` not `MissionCompletionChip`) for extraction in Increment 5
- Completion chip pattern reusable for all 5 bootstrap conversations
- Transcript download pattern reusable across bootstrap conversations
- MCP tool execution from v2 handler pattern (server-side `projectParentFolder` resolution, fresh `mcpSessionId` generation) reusable for Increments 5-7 (roadmap, architecture, standards, test strategy)
- The three-step artifact flow (generate -> preview -> confirm-save) is the canonical pattern for all bootstrap artifact production

### Scope Boundaries

**In Scope:**
- PM define-product task registration updates (artifacts array declaration)
- New v2 backend endpoint for artifact generation (LLM call with MISSION_GENERATION_PROMPT_TEMPLATE, transcript assembly, returns markdown)
- New v2 backend endpoint for artifact save (resolves projectParentFolder server-side, generates fresh mcpSessionId, calls executeToolCall with save_product_artifacts)
- Server-side projectParentFolder resolution (architecture-model-service lookup or gateway config)
- New frontend components: ArtifactPreviewBubble (rendered markdown + Confirm/Reject buttons), CompletionChip (sealed segment marker with transcript download)
- MessageBubble updates to handle new structuredResponse types (`artifact-preview`, `completion-chip`)
- MessageBubble and extractQuestions adaptation to normalize plain string question arrays into `{id, question}` objects
- StructuredQuestionsRenderer disabled/read-only state for messages within sealed segments
- ChatThread awareness of completion chips to determine which messages are in sealed segments
- useChatThread hook updates for generation, save, and completion chip flows
- chatV2Api client updates with new endpoint functions for generation and save
- Dashboard summary endpoint partial real-data migration (ProductDefinition card file-existence check)
- Frontend dashboard re-fetch after artifact save
- Frontend-sourced overwrite warning using dashboard missionExists state
- Error handling for generation failure, save failure, and MCP timeout with retry capability

**Out of Scope:**
- Streaming responses (v2 endpoint returns full responses, not SSE)
- Conversation summarization (Increment 11)
- Side panel PM usage (Increments 8-9)
- Removal of v1 PM chat panel (Increment 10)
- Multi-artifact batches
- Version diff/merge UI
- Fine-grained permissions/roles
- Per-persona history filtering
- Implement screen changes
- Full context resolver system (transcript assembled internally in generation flow)
- Standardizing PM prompt to emit structured question objects (deferred)
- Backend-sourced overwrite warning via context resolver (deferred as hardening)

### Technical Considerations
- The v2 backend (Increment 1) is complete with registry, prompt composer, thread store, and POST /api/chat/v2
- The UnifiedChatPanel (Increment 2) and Hub Chat MVP wiring (Increment 3) are complete
- The PM task definition and prompt already exist in the registry but need updates to the `artifacts` array
- The v1 MISSION_GENERATION_PROMPT_TEMPLATE exists at `gateway/src/services/promptBuilder.ts` line 664 and can be reused directly
- The v1 `save_product_artifacts` MCP tool and `executeToolCall` function at `gateway/src/services/toolExecutor.ts` can be reused
- **RESOLVED**: `projectParentFolder` will be resolved server-side (architecture-model-service lookup or gateway config); MUST NOT come from frontend
- **RESOLVED**: `mcpSessionId` will be a fresh UUID generated per tool execution call; no v2 session store needed
- **RESOLVED**: The flow is three steps (generate -> preview -> confirm-save); the LLM generation and the MCP save are separate server round-trips with an explicit user confirmation in between
- **RESOLVED**: Overwrite warning sourced from frontend using dashboard missionExists state; no backend context resolver needed
- The PM task responseFormat returns questions as plain strings but `MessageBubble.hasQuestions()` expects `{id, question}` objects -- frontend normalization layer needed in `extractQuestions()`
- The `MessageBubble` component currently handles 2 structuredResponse types (`task-menu` and questions); 2 new types needed (`artifact-preview` and `completion-chip`)
- Dashboard mock service at `gateway/src/services/dashboardSummaryMockService.ts` hardcodes `missionExists: card('Mission Exists', 1)` -- needs real file check via the architecture-model-service or direct filesystem access
- The v1 PM chat panel (`ProductManagerChatPanel.tsx`) remains completely untouched
- Context resolvers remain stubs; transcript assembly handled internally in generation flow
- The `fetchProductName` function at `gateway/src/services/architectureModelClient.ts` line 441 can be reused for the generation flow's productName parameter
