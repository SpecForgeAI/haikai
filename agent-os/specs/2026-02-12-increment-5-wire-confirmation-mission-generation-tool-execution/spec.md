# Specification: Increment 5 -- Wire Confirmation, Mission Generation, and Tool Execution

## Goal
Complete the Product Manager end-to-end flow by wiring: discovery phase completion, user confirmation detection, MISSION.MD generation via a dedicated OpenAI call, and `save_product_artifacts` tool execution -- all while ensuring mission content never leaks into transcript files.

## User Stories
- As a user in the Product Manager chat, I want to confirm "yes" after the PM says it is ready, so that MISSION.MD is automatically generated and saved to my project without manual steps.
- As a developer maintaining the gateway, I want the mission generation branch to be a self-contained code path isolated from the normal PM validation flow, so that tool call arguments (including large missionMarkdown) never pollute conversation transcripts.

## Specific Requirements

**Confirmation Detection Logic**
- Trigger when BOTH conditions are true: (1) the previous assistant turn's parsed `productManagerResponse.phase === "ready"`, and (2) the incoming user message matches `/yes|proceed|generate|go ahead|confirm/i`
- Must work after server restarts by inspecting the rehydrated conversation array (from `conversation.json` on disk), not just in-memory session state
- When both conditions are met, the gateway branches into the mission-generation code path BEFORE the normal PM validation+retry block (lines 817-926 in `chat.ts`)
- If only one condition is met (e.g. user says "yes" but last phase was "questions"), fall through to the normal PM discovery flow

**Mission Generation via New OpenAI Call**
- Build a fresh `messages` array containing: (1) a new `MISSION_GENERATION_PROMPT_TEMPLATE` as the system message, (2) all prior user and assistant messages from the discovery transcript (excluding system messages)
- Call `sendChatRequest` with the `tools` override set to ONLY the `save_product_artifacts` tool definition from `TOOL_DEFINITIONS`, and `toolChoice` forced to `{ type: "function", function: { name: "save_product_artifacts" } }`
- This is a single-pass call (no agent loop). The response MUST contain a tool call; if it contains text content instead, treat as failure
- Add `MISSION_GENERATION_PROMPT_TEMPLATE` to `promptBuilder.ts` as a new constant that instructs the model to synthesize everything from the discovery transcript into comprehensive MISSION.MD content and return it exclusively via the `save_product_artifacts` tool call

**ChatRequestOptions Extension**
- Add optional `tools` field (`ToolDefinition[]`) and optional `toolChoice` field to the existing `ChatRequestOptions` interface in `openaiClient.ts`
- When `tools` is provided, use it in the OpenAI `createParams` instead of `getOpenAITools()`; when `toolChoice` is provided, use it instead of `'auto'`
- When neither `tools` nor `toolChoice` is provided, existing behavior (jsonMode toggle or default all-tools) remains unchanged -- no regression to OAS assistant or planner modes

**ProductName Fetching Server-Side**
- Add a new `fetchProductName(projectId: string): Promise<string | null>` function in `architectureModelClient.ts` following the exact pattern of `fetchProductSummary` (lines 296-340)
- Call `GET /api/projects/{projectId}/product` on architecture-model-service, extract `product_name` from the response (snake_case per backend convention), return it as a string
- Return `null` on HTTP error or missing data; log warning but do not throw
- Export `fetchProductName` from `services/index.ts`

**Pre-Tool-Call Validation**
- Before executing the tool call, validate: (1) `productName` is a non-empty string (fetched server-side), (2) `projectParentFolder` is present in the chat context, (3) `missionMarkdown` from the model's tool call arguments has length > 0
- If any validation fails, skip the tool call entirely and return a safe assistant error message: "Unable to generate MISSION.MD: missing required data. Please ensure the product name is set and try again."

**Tool Execution via toolExecutor**
- Call `executeToolCall()` from `toolExecutor.ts` with: `callId` from OpenAI response, tool name `save_product_artifacts`, arguments merged with `{ projectParentFolder, projectId, productName, missionMarkdown }`, the session's `mcpSessionId`, `requestId`, and `sessionId`
- The `executeToolCall` function already validates required params and calls the MCP server endpoint `/mcp/tools/save_product_artifacts` -- reuse it directly, no modifications needed to `toolExecutor.ts`

**Transcript Exclusion Rules**
- The mission-generation system prompt, tool call arguments (including `missionMarkdown`), and tool execution response MUST NEVER be appended to the transcript via `appendTranscriptEntry` or persisted via `persistConversation`
- Only two entries are persisted: (1) the user's confirmation message (appended as a USER transcript entry), (2) the final assistant success or failure message (appended as an ASSISTANT transcript entry)
- The mission-generation branch must NOT call `persistConversation` with the mission-generation messages array; it should persist only the original discovery messages plus the confirmation and result messages

**Success and Failure Handling**
- On success: construct an assistant message "MISSION.MD has been successfully created in agent-os/product/.", append it as ASSISTANT transcript entry, persist conversation (discovery + confirmation + success message only), flush transcript to disk (kind="product"), return `ChatResponse` with the success message
- On failure (tool execution error or OpenAI call failure): construct assistant message "Mission generation failed. Please review and try again.", append it as ASSISTANT transcript entry, log the detailed error internally with `logger.error`, return `ChatResponse` with the failure message
- Wrap the entire mission-generation branch in try/catch so errors never crash the chat route

**shouldBypassToolExecution Unchanged**
- The existing `shouldBypassToolExecution()` continues to return `true` for `product_manager` mode, keeping the normal agent loop bypassed
- The confirmation branch handles its own tool execution in a dedicated code path before the bypass check matters for the normal response flow

## Visual Design
Not applicable -- no visual assets were provided. The existing "Thinking..." loading indicator in `ProductManagerChatPanel` is sufficient for this increment.

## Existing Code to Leverage

**`sendChatRequest` in `gateway/src/services/openaiClient.ts` (lines 124-207)**
- Currently supports `ChatRequestOptions` with only `jsonMode`; extend with `tools` and `toolChoice` fields
- The `createParams` block at lines 145-155 has the branching logic between jsonMode and standard mode; add a third branch for when `tools` is explicitly provided
- The `parseToolCalls` helper at lines 77-89 already parses tool calls from the response and can be reused directly

**OAS Agent Loop in `gateway/src/routes/chat.ts` (lines 535-602)**
- The mission-generation branch is a simplified single-pass version of this loop: make one OpenAI call, extract the tool call, execute it, done
- Reuse the same `executeToolCall` invocation pattern (lines 562-569) and error handling
- Unlike the agent loop, no `while` loop is needed -- the forced `tool_choice` guarantees a single tool call

**`fetchProductSummary` in `gateway/src/services/architectureModelClient.ts` (lines 296-340)**
- The new `fetchProductName` function should follow this exact pattern: construct URL from config base, make GET request with fetch, handle non-OK responses by returning null, log at debug and warn levels
- The endpoint is `GET /api/projects/{projectId}/product` which returns a `ProductDefinitionDtoSnake` with `product_name` field

**PM Validation Block in `gateway/src/routes/chat.ts` (lines 817-926)**
- The confirmation detection branch inserts BEFORE this block; when confirmation IS detected, the mission-generation path runs and returns early, completely skipping the PM validation+retry logic
- When confirmation is NOT detected, execution falls through to this existing block unchanged

**`PRODUCT_MANAGER_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts` (lines 284-345)**
- Reference for tone and structure of the new `MISSION_GENERATION_PROMPT_TEMPLATE`
- The new prompt will instruct the model to synthesize the full discovery conversation into MISSION.MD content, covering all 10 information areas from the PM discovery prompt

## Out of Scope
- Structured extraction into ProductDefinition beyond `productName` (no parsing of vision, goals, etc. into DB fields)
- Additional artifacts beyond MISSION.MD (no README, no roadmap, no backlog generation)
- UI changes beyond the existing "Thinking..." loading indicator
- Reset/start-over controls for the PM conversation
- Versioning of the mission file (always overwrites)
- Handling "yes" during the "questions" phase as a confirmation trigger
- Rate limiting or double-submission prevention on the confirmation detection
- Changes to `toolExecutor.ts` or `save_product_artifacts` tool definition (already complete from Increment 4)
- Changes to the frontend `ProductManagerChatPanel` component (existing component handles the flow naturally)
- Modifications to the streaming endpoint (`GET /api/chat/stream`) -- PM mode uses the POST endpoint only
