# Spec Requirements: Increment 5 -- Wire Confirmation -> Mission Generation -> Tool Execution (End-to-End Flow)

## Initial Description

Complete the Product Manager flow by wiring: discovery -> ready -> user confirmation -> mission generation -> MCP tool execution. On confirmation, the PM generates MISSION.MD content and invokes save_product_artifacts. Mission content must NOT be persisted in transcript files.

### Full Scope from Initialization

**Include:**
- Enable tool usage for product_manager mode (save_product_artifacts only)
- Detect explicit user confirmation
- Generate missionMarkdown after confirmation
- Invoke MCP tool with missionMarkdown + productName
- Handle tool success/failure cleanly
- Persist conversation under kind="product"

**Exclude:**
- Structured extraction into ProductDefinition beyond productName
- Additional artifacts beyond MISSION.MD
- UI changes beyond minimal loading handling
- Reset/start-over controls
- Versioning of mission file

**Systems:**
- Primary: gateway
- Dependency: mcp-server (save_product_artifacts already implemented in Increment 4)

## Requirements Discussion

### First Round Questions

**Q1:** Confirmation detection approach: I assume the gateway will detect confirmation by inspecting the previous assistant turn's `productManagerResponse.phase === "ready"` (which is already parsed and available in conversation history) AND matching the latest user message against the regex pattern. Is that correct, or should confirmation detection also work without the structured `productManagerResponse` (e.g., from rehydrated conversations where the phase data might not be in session memory)?
**Answer:** Detect confirmation by checking BOTH: previous assistant phase === "ready" (from rehydrated transcript if needed) AND regex match on user message; it must work even after server restarts.

**Q2:** Mission generation prompt -- separate call vs. same call: I assume the mission generation will be a NEW OpenAI call with a different system prompt (a "mission generation prompt" that includes the full discovery transcript and instructs the model to ONLY return a `save_product_artifacts` tool call). This would mean the confirmation-detection branch constructs a fresh `messages` array with a mission-generation system prompt, then calls `sendChatRequest` with tools enabled (but restricted to `save_product_artifacts` only). Is that correct, or should the model generate missionMarkdown as JSON content and then the gateway programmatically constructs the tool call?
**Answer:** Use a NEW OpenAI call dedicated to mission generation with a focused system prompt + full discovery transcript + forced tool call; do not generate JSON then construct tool call programmatically.

**Q3:** Tool restriction mechanism: Currently, `sendChatRequest` in `openaiClient.ts` either sends ALL `TOOL_DEFINITIONS` (when `jsonMode: false`) or sends NO tools (when `jsonMode: true`). For this feature, we need to send only the `save_product_artifacts` tool. I assume we should extend `ChatRequestOptions` with a `tools` override (e.g., `tools?: ToolDefinition[]`) so the mission generation call can pass only the one tool, and possibly use `tool_choice: { type: "function", function: { name: "save_product_artifacts" } }` to force it. Is that the preferred approach, or should we add a separate mode flag?
**Answer:** Yes -- extend `ChatRequestOptions` to support `tools` override and force `tool_choice` to `save_product_artifacts` for this branch only.

**Q4:** Transcript exclusion of missionMarkdown: The spec says tool arguments must NOT appear in the transcript. Currently the product_manager mode bypasses the agent loop (`shouldBypassToolExecution` returns true), so tool calls are never processed. For Increment 5, the mission-generation branch will need to actually execute the tool call. I assume the approach is: (a) the mission-generation branch is a special code path that does NOT go through the normal agent loop, (b) the tool call is executed directly by the gateway, (c) the tool call arguments (including missionMarkdown) are NEVER appended to the transcript or conversation persistence, and (d) only the user confirmation and the assistant success/failure message are written. Is that correct?
**Answer:** Yes -- mission-generation must use a special code path where tool call arguments (including missionMarkdown) are NEVER appended to transcript.

**Q5:** Session/conversation state for the mission generation call: The mission generation prompt needs the "full discovery transcript (excluding system)." I assume this means we reconstruct the transcript from the current session's `conversation` array (which persists prior messages via `persistConversation`). The confirmation message itself should be added as a user message in the conversation. But the mission-generation system prompt and the tool call/result exchange should NOT be persisted to the conversation. Only the final success/failure assistant message gets persisted. Is that the correct interpretation?
**Answer:** Correct -- do NOT persist the mission-generation prompt, tool call arguments, or tool response; persist only user confirmation + final assistant success/failure message.

**Q6:** ProductName sourcing: The spec says "productName (from ProductDefinition)." Currently the `ProductPage.tsx` fetches `ProductDefinition` via `getProductDefinition(projectId)` and displays it in an input field, but the `ProductManagerChatPanel` does not have access to the productName state. I assume the gateway should fetch productName itself (via a call to the MCP server or stored-backend API) rather than relying on the frontend to pass it. Or should the frontend pass `productName` in the chat context for this request? The current `ChatContext` type does not have a `productName` field.
**Answer:** Gateway should fetch productName server-side from architecture-model-service (source of truth), not rely on frontend context.

**Q7:** Frontend changes -- loading indicator: The spec says "show loading indicator during tool execution." The current `ProductManagerChatPanel` already shows a "Thinking..." indicator while `loading` is true. I assume this existing indicator is sufficient and no new UI element is needed -- the gateway call will simply take longer during tool execution, and the existing spinner handles that. Is that correct, or do you want a distinct "Generating MISSION.MD..." indicator?
**Answer:** Existing "Thinking..." indicator is sufficient for v0.1.

**Q8:** Is there anything explicitly out of scope that I should be aware of beyond what the spec already lists? For example: should the gateway handle the case where the user says "yes" during the `questions` phase (not `ready`), or should that be ignored? Should there be any rate limiting on the confirmation detection (e.g., prevent double-submission)?
**Answer:** No additional items beyond what is already listed in the spec.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: OAS assistant agent loop (tool call loop) - Path: `gateway/src/routes/chat.ts` (lines 535-602)
  - The mission generation branch will be a simplified, single-pass version of this loop
  - Handles tool call execution, tool result building, and sending results back to OpenAI

- Feature: Product Manager validation+retry block - Path: `gateway/src/routes/chat.ts` (lines 817-926)
  - Pattern for the PM confirmation detection branch insertion point
  - Shows where the new mission-generation branch should be spliced in (before or replacing the existing PM validation when confirmation is detected)

- Feature: `shouldBypassToolExecution()` - Path: `gateway/src/routes/chat.ts` (lines 120-122)
  - Currently returns true for product_manager mode; must be updated for the confirmation branch to NOT bypass

- Feature: `flushTranscriptToDisk()` for product_manager mode - Path: `gateway/src/routes/chat.ts` (lines 223-302)
  - Already supports kind="product" for product_manager mode; can be reused as-is

- Feature: Tool executor (`executeToolCall`) - Path: `gateway/src/services/toolExecutor.ts` (lines 189-244)
  - Already supports `save_product_artifacts` with full validation
  - Required params: `projectParentFolder`, `projectId`, `productName`, `missionMarkdown`

- Feature: `sendChatRequest` in OpenAI client - Path: `gateway/src/services/openaiClient.ts` (lines 124-207)
  - Current `ChatRequestOptions` has only `jsonMode`; needs `tools` and `toolChoice` additions
  - Current logic: jsonMode=true skips tools; jsonMode=false sends ALL tools
  - New behavior needed: allow explicit `tools` override with forced `tool_choice`

- Feature: `TOOL_DEFINITIONS` for save_product_artifacts - Path: `gateway/src/types/tools.ts` (lines 255-288)
  - Full tool definition with all parameters; only this tool should be sent in the mission-generation call

- Feature: Product Manager system prompt - Path: `gateway/src/services/promptBuilder.ts` (lines 284-345)
  - The existing PM discovery prompt; a NEW mission-generation prompt will be needed alongside it

- Feature: `buildSystemPrompt()` routing for product_manager - Path: `gateway/src/services/promptBuilder.ts` (lines 1162-1165)
  - Currently returns `PRODUCT_MANAGER_PROMPT_TEMPLATE` for all product_manager calls
  - May need to route to a mission-generation prompt when confirmation is detected

- Feature: Product Manager response validator - Path: `gateway/src/services/productManagerResponseValidator.ts`
  - Validates `{ phase, questions, summary }` structure; phase="ready" detection is key for confirmation

- Feature: Frontend `ProductManagerChatPanel` - Path: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`
  - `buildProductManagerContext()` (line 51-58) constructs the context sent with every request
  - `latestPmResponse` state tracks the current PM phase; "ready" banner shown at line 331
  - Existing "Thinking..." indicator at line 343-346 is sufficient for v0.1

- Feature: Frontend `ProductPage` - Path: `frontend/src/components/ProductView/ProductPage.tsx`
  - Hosts `ProductManagerChatPanel` and the product name input
  - After success, may optionally refetch ProductDefinition (line 147)

- Feature: `getProductDefinition` API - Path: `frontend/src/api/productDefinitionApi.ts` (lines 92-123)
  - Frontend hits `GET /api/projects/{projectId}/product` on architecture-model-service
  - Gateway needs a similar server-side function to fetch productName

- Feature: `fetchProductSummary` in architecture model client - Path: `gateway/src/services/architectureModelClient.ts` (lines 296-340)
  - Pattern for gateway-side HTTP calls to architecture-model-service
  - New `fetchProductName` function should follow this exact pattern

- Feature: Transcript writer `normalizeKind` - Path: `gateway/src/services/transcriptWriter.ts` (lines 117-129)
  - Already supports kind="product" in the ALLOWED_KINDS list

- Feature: `appendTranscriptEntry` usage - Path: `gateway/src/routes/chat.ts` (lines 475-489, 605-609)
  - Shows the pattern for appending USER and ASSISTANT entries to the transcript
  - Mission-generation tool call/response must NOT be appended

### Follow-up Questions

No follow-up questions were needed. All requirements were sufficiently clarified in the first round.

## Visual Assets

### Files Provided:
No visual assets provided. The mandatory bash check of the visuals folder confirmed no image files are present.

### Visual Insights:
Not applicable -- no visual assets were provided.

## Requirements Summary

### Functional Requirements

- **Confirmation Detection**: When the previous assistant response has `phase === "ready"` AND the user's latest message matches a confirmation intent regex (`/yes|proceed|generate|go ahead|confirm/i`), the gateway triggers the mission generation branch instead of the normal PM discovery flow.
- **Confirmation Detection Resilience**: Detection must work across server restarts by checking rehydrated transcript data (from conversation.json), not just in-memory session state. The gateway must inspect prior conversation entries to determine if the last assistant message was in the "ready" phase.
- **Mission Generation via New OpenAI Call**: On confirmation, build a fresh messages array containing: (1) a dedicated mission-generation system prompt, (2) the full discovery transcript (excluding system messages), and (3) force the model to call `save_product_artifacts` via `tool_choice`.
- **Tool Policy -- Single Tool Only**: The mission-generation OpenAI call must include ONLY the `save_product_artifacts` tool definition (not all tools). All other tools must be excluded from this call.
- **Forced Tool Choice**: Use `tool_choice: { type: "function", function: { name: "save_product_artifacts" } }` to force the model to return a tool call, not text content.
- **ProductName Fetching Server-Side**: The gateway must fetch `productName` from the architecture-model-service (the source of truth) by calling `GET /api/projects/{projectId}/product`. This requires a new gateway function (e.g., `fetchProductName`) following the pattern of `fetchProductSummary` in `architectureModelClient.ts`.
- **Tool Execution**: Execute the `save_product_artifacts` tool via `executeToolCall()` with parameters: `sessionId`, `projectParentFolder`, `projectId`, `productName` (fetched server-side), and `missionMarkdown` (from the model's tool call arguments).
- **Success Handling**: On tool success, append assistant message: "MISSION.MD has been successfully created in agent-os/product/." to the transcript, persist conversation, and flush transcript (kind="product").
- **Failure Handling**: On tool failure, append assistant message: "Mission generation failed. Please review and try again." Log detailed error internally. Do not expose stack traces.
- **Validation Before Tool Call**: Ensure `productName` exists and is non-empty, `projectParentFolder` is provided, and `missionMarkdown` length > 0 before attempting the tool call. If any validation fails, respond with a safe assistant error message and do not attempt the tool call.

### Transcript and Persistence Rules

- **Transcript Exclusion**: The `missionMarkdown` content, tool call arguments, and tool execution response must NEVER be written to conversation.json or any transcript file.
- **Persisted Content Only**: Only these entries are persisted: (1) user confirmation message, (2) assistant success or failure message.
- **Mission-Generation System Prompt Exclusion**: The mission-generation system prompt (separate from the discovery prompt) must NOT be persisted to the transcript.
- **Existing Persistence**: All prior discovery conversation entries remain persisted as they are today under kind="product".

### Gateway Code Changes

- **`openaiClient.ts` -- `ChatRequestOptions`**: Add optional `tools` field (array of tool definitions) and optional `toolChoice` field. When `tools` is provided, use it instead of `getOpenAITools()`. When `toolChoice` is provided, use it instead of `'auto'`.
- **`chat.ts` -- Confirmation Detection Branch**: Add a new code path BEFORE the existing PM validation+retry block. This branch checks if confirmation is detected, then: (1) fetches productName server-side, (2) validates prerequisites, (3) builds mission-generation messages, (4) calls `sendChatRequest` with tools override and forced tool_choice, (5) extracts and executes the tool call, (6) appends only the user confirmation and final assistant message to transcript, (7) flushes transcript, (8) returns response.
- **`chat.ts` -- `shouldBypassToolExecution()`**: This function currently returns true for product_manager mode. The confirmation branch must handle tool execution in its own code path; the normal bypass remains for discovery-phase PM calls.
- **`promptBuilder.ts` -- Mission Generation Prompt**: Add a new `MISSION_GENERATION_PROMPT_TEMPLATE` that instructs the model to generate comprehensive MISSION.MD content based on the full discovery transcript and return it exclusively via the `save_product_artifacts` tool call.
- **`architectureModelClient.ts` -- `fetchProductName()`**: Add a new function to fetch productName from `GET /api/projects/{projectId}/product` on the architecture-model-service, following the existing `fetchProductSummary` pattern.
- **`services/index.ts`**: Export the new `fetchProductName` function.

### Frontend Code Changes

- **No new UI controls required**: Existing `ProductManagerChatPanel` handles the confirmation flow naturally via text input.
- **Existing "Thinking..." indicator is sufficient**: The loading state while the gateway processes the mission generation call uses the existing indicator.
- **Optional ProductDefinition refetch**: After a successful response, the frontend may optionally refetch ProductDefinition to reflect any updates.

### Reusability Opportunities

- `executeToolCall()` in `gateway/src/services/toolExecutor.ts` -- reuse directly for executing `save_product_artifacts`
- `appendTranscriptEntry()` pattern from `chat.ts` -- reuse for the confirmation and success/failure messages
- `flushTranscriptToDisk()` with kind="product" -- reuse as-is for product_manager transcript persistence
- `fetchProductSummary()` pattern in `architectureModelClient.ts` -- model the new `fetchProductName()` after this
- `sendChatRequest()` in `openaiClient.ts` -- extend with tools/toolChoice options rather than creating a new function
- `PRODUCT_MANAGER_PROMPT_TEMPLATE` -- reference structure for the new mission-generation prompt template
- `buildProductManagerContext()` in the frontend -- no changes needed; existing context is sufficient

### Scope Boundaries

**In Scope:**
- Confirmation detection (phase="ready" + regex match)
- New OpenAI call with mission-generation prompt and forced tool call
- `ChatRequestOptions` extension for tools/toolChoice override
- Server-side productName fetch from architecture-model-service
- `save_product_artifacts` tool execution
- Transcript exclusion of missionMarkdown and tool arguments
- Success/failure assistant messages
- Pre-tool-call validation (productName, projectParentFolder, missionMarkdown)
- Conversation persistence under kind="product"
- New mission-generation system prompt template

**Out of Scope:**
- Structured extraction into ProductDefinition beyond productName
- Additional artifacts beyond MISSION.MD
- UI changes beyond minimal loading handling (existing "Thinking..." is sufficient)
- Reset/start-over controls
- Versioning of mission file
- Handling "yes" during "questions" phase (not "ready") as a confirmation
- Rate limiting on confirmation detection
- Double-submission prevention

### Technical Considerations

- **Server Restart Resilience**: Confirmation detection must work even after a server restart, meaning the gateway cannot rely solely on in-memory session state. It must inspect rehydrated conversation entries (from conversation.json on disk or the session's conversation array) to determine if the previous assistant response was in the "ready" phase.
- **OpenAI tool_choice Forcing**: Using `tool_choice: { type: "function", function: { name: "save_product_artifacts" } }` ensures the model always returns a tool call, never text content. The response must be validated to ensure it contains a valid tool call.
- **Single-Pass Tool Execution**: Unlike the OAS assistant which runs a multi-turn agent loop, the mission-generation branch only needs a single tool call. No loop is necessary.
- **No Regression to Other Modes**: Changes to `sendChatRequest()` via `ChatRequestOptions` must be backward-compatible. When `tools`/`toolChoice` are not provided, existing behavior (jsonMode or default tools) must remain unchanged.
- **Mission Markdown Size**: The missionMarkdown content could be large. The OpenAI model generates it as a tool argument. The tool executor has a 30-second timeout which should be sufficient.
- **Error Isolation**: Tool execution failures must not crash the chat route. Failures are caught and returned as a safe assistant error message.
- **Existing JSON Validation Pattern**: The product_manager validation+retry pattern (corrective prompt + single retry) is NOT used for the mission-generation branch, since that branch produces a tool call rather than JSON content.
