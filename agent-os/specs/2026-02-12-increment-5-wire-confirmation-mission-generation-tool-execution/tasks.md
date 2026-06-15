# Task Breakdown: Increment 5 -- Wire Confirmation, Mission Generation, and Tool Execution

## Overview
Total Tasks: 32 (across 5 task groups)

This is a gateway-only change. No frontend or mcp-server modifications are required. The implementation wires together: confirmation detection, mission generation via a dedicated OpenAI call, `save_product_artifacts` tool execution, and transcript exclusion of mission content.

**Key Reference Files:**
- `gateway/src/routes/chat.ts` -- main chat route, PM validation block, `shouldBypassToolExecution`, `flushTranscriptToDisk`
- `gateway/src/services/openaiClient.ts` -- `sendChatRequest`, `ChatRequestOptions`
- `gateway/src/services/promptBuilder.ts` -- `PRODUCT_MANAGER_PROMPT_TEMPLATE`, `buildSystemPrompt`
- `gateway/src/services/architectureModelClient.ts` -- `fetchProductSummary` pattern
- `gateway/src/services/toolExecutor.ts` -- `executeToolCall`
- `gateway/src/services/transcriptWriter.ts` -- transcript persistence
- `gateway/src/services/index.ts` -- service exports
- `gateway/src/types/chat.ts` -- `ChatMode`, `ChatContext`, `ChatResponse`
- `gateway/src/types/tools.ts` -- `TOOL_DEFINITIONS`, `save_product_artifacts`

## Task List

### Gateway Service Layer

#### Task Group 1: ChatRequestOptions Extension (tools/toolChoice Override)
**Dependencies:** None
**File:** `gateway/src/services/openaiClient.ts`

- [x] 1.0 Complete ChatRequestOptions extension for tools and toolChoice override
  - [x] 1.1 Write 4 focused tests for ChatRequestOptions extension
    - Test file: `gateway/src/__tests__/openai-client-tools-override.test.ts`
    - Test 1: When `options.tools` is provided, the OpenAI `createParams.tools` uses the provided tools array instead of `getOpenAITools()`
    - Test 2: When `options.toolChoice` is provided, `createParams.tool_choice` uses the provided value instead of `'auto'`
    - Test 3: When neither `tools` nor `toolChoice` is provided and `jsonMode` is false, existing behavior is preserved (all tools with `tool_choice: 'auto'`)
    - Test 4: When `jsonMode` is true, existing behavior is preserved (no tools, `response_format: json_object`) regardless of tools/toolChoice fields
    - Mock `OpenAI` client and capture the `createParams` passed to `client.chat.completions.create`
  - [x] 1.2 Extend the `ChatRequestOptions` interface with optional fields
    - Add `tools?: ToolDefinition[]` field (accepts array of tool definitions matching the shape in `TOOL_DEFINITIONS`)
    - Add `toolChoice?: unknown` field (accepts OpenAI `tool_choice` parameter, e.g. `{ type: "function", function: { name: "save_product_artifacts" } }` or `'auto'`)
    - Preserve the existing `jsonMode?: boolean` field unchanged
  - [x] 1.3 Update `sendChatRequest` branching logic in `createParams` construction (lines 145-155)
    - Current logic: `if (jsonMode) { response_format } else { tools + tool_choice: 'auto' }`
    - New logic: `if (jsonMode) { response_format }` then `else if (options.tools) { createParams.tools = options.tools; createParams.tool_choice = options.toolChoice || 'auto' }` then `else { getOpenAITools() + 'auto' }`
    - The `jsonMode` branch takes precedence over `tools` override to prevent regression
  - [x] 1.4 Update debug logging to include whether custom tools are being used
    - Add `hasCustomTools: !!options?.tools` and `hasCustomToolChoice: !!options?.toolChoice` to the logger.debug call at line 135
  - [x] 1.5 Update the `ChatRequestOptions` export in `gateway/src/services/index.ts` (already exported, verify no changes needed)
  - [x] 1.6 Ensure ChatRequestOptions tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify existing `jsonMode` behavior is not regressed

**Acceptance Criteria:**
- The 4 tests from 1.1 pass
- `ChatRequestOptions` has `tools` and `toolChoice` optional fields
- When `tools` is provided, `sendChatRequest` uses it instead of `getOpenAITools()`
- When `toolChoice` is provided, `sendChatRequest` uses it instead of `'auto'`
- When neither is provided, existing behavior is unchanged (no regression to OAS assistant or planner modes)
- `jsonMode: true` still takes precedence, producing no tools and `response_format: json_object`

---

#### Task Group 2: fetchProductName Function and Mission Generation Prompt
**Dependencies:** None (can be done in parallel with Task Group 1)
**Files:** `gateway/src/services/architectureModelClient.ts`, `gateway/src/services/promptBuilder.ts`, `gateway/src/services/index.ts`

- [x] 2.0 Complete fetchProductName and MISSION_GENERATION_PROMPT_TEMPLATE
  - [x] 2.1 Write 6 focused tests for fetchProductName and mission generation prompt
    - Test file: `gateway/src/__tests__/fetch-product-name.test.ts`
    - Test 1: `fetchProductName` returns `product_name` string when API responds 200 with valid JSON containing `product_name` field
    - Test 2: `fetchProductName` returns `null` when API responds with non-OK status (e.g. 404)
    - Test 3: `fetchProductName` returns `null` when fetch throws a network error; logs warning but does not throw
    - Test 4: `fetchProductName` returns `null` when response JSON has no `product_name` field or it is empty
    - Test file: `gateway/src/__tests__/mission-generation-prompt.test.ts`
    - Test 5: `MISSION_GENERATION_PROMPT_TEMPLATE` is a non-empty string containing instructions about `save_product_artifacts`
    - Test 6: `MISSION_GENERATION_PROMPT_TEMPLATE` contains references to all 10 information areas from the PM discovery prompt (project name, new vs. existing, documentation, core problem, target audience, vision, success criteria, constraints, scope, delivery expectations)
  - [x] 2.2 Create `fetchProductName` function in `architectureModelClient.ts`
    - Follow the exact pattern of `fetchProductSummary` (lines 296-340)
    - Signature: `export async function fetchProductName(projectId: string): Promise<string | null>`
    - Endpoint: `GET /api/projects/{projectId}/product` on architecture-model-service
    - Extract `product_name` from the JSON response (snake_case per backend convention)
    - Return `null` on HTTP error, network error, or missing/empty `product_name`
    - Log at debug level on success, warn level on failure
    - Do NOT throw on error
  - [x] 2.3 Export `fetchProductName` from `gateway/src/services/index.ts`
    - Add to the existing `architectureModelClient` export block (alongside `fetchProductSummary`, `fetchMetaModelSummary`, etc.)
  - [x] 2.4 Create `MISSION_GENERATION_PROMPT_TEMPLATE` constant in `promptBuilder.ts`
    - Add as a new `const` after the existing `PRODUCT_MANAGER_PROMPT_TEMPLATE` block (around line 345)
    - The prompt must instruct the model to:
      - Synthesize the full discovery conversation into comprehensive MISSION.MD content
      - Cover all 10 information areas from the PM discovery prompt
      - Return the content EXCLUSIVELY via the `save_product_artifacts` tool call
      - Use the `missionMarkdown` parameter for the full MISSION.MD markdown content
      - NOT return text content -- only the tool call
    - Export the constant (it will be imported by `chat.ts` in Task Group 3)
  - [x] 2.5 Export `MISSION_GENERATION_PROMPT_TEMPLATE` from `promptBuilder.ts`
    - Add to the existing exports or export it directly as a named export
  - [x] 2.6 Ensure fetchProductName and prompt template tests pass
    - Run ONLY the 6 tests written in 2.1
    - Mock `fetch` for the `fetchProductName` tests (follow the pattern in existing tests like `bootstrap-client.test.ts`)

**Acceptance Criteria:**
- The 6 tests from 2.1 pass
- `fetchProductName` follows the same pattern as `fetchProductSummary`
- `fetchProductName` is exported from `services/index.ts`
- `MISSION_GENERATION_PROMPT_TEMPLATE` instructs the model to generate MISSION.MD content and return it via `save_product_artifacts` tool call only
- The prompt references all 10 information areas
- No changes to `buildSystemPrompt` routing (the mission generation prompt is used directly in `chat.ts`, not via `buildSystemPrompt`)

---

### Gateway Route Layer

#### Task Group 3: Confirmation Detection and Mission Generation Branch in chat.ts
**Dependencies:** Task Group 1, Task Group 2
**File:** `gateway/src/routes/chat.ts`

This is the core implementation task group. It adds the confirmation detection logic, mission generation code path, tool execution, and transcript exclusion -- all within the existing `chat.ts` route handler.

- [x] 3.0 Complete the confirmation detection and mission generation branch
  - [x] 3.1 Write 8 focused tests for the confirmation and mission generation flow
    - Test file: `gateway/src/__tests__/confirmation-mission-generation.test.ts`
    - Test 1: **Confirmation detected** -- When last assistant message has `phase === "ready"` AND user message matches `/yes/i`, the mission generation branch is triggered (does NOT fall through to PM validation block)
    - Test 2: **Confirmation NOT detected (wrong phase)** -- When last assistant message has `phase === "questions"` AND user says "yes", falls through to normal PM discovery flow
    - Test 3: **Confirmation NOT detected (no match)** -- When last assistant message has `phase === "ready"` AND user says something unrelated like "tell me more", falls through to normal PM discovery flow
    - Test 4: **Rehydration resilience** -- Confirmation detection works when conversation is rehydrated from persisted messages (simulates server restart by constructing session with pre-populated conversation array containing a ready-phase assistant message)
    - Test 5: **Successful mission generation** -- On confirmation, the response message is "MISSION.MD has been successfully created in agent-os/product/." and no `productManagerResponse` is set
    - Test 6: **Pre-tool-call validation failure** -- When `productName` is null (fetchProductName fails), returns error message "Unable to generate MISSION.MD: missing required data. Please ensure the product name is set and try again."
    - Test 7: **Transcript exclusion** -- The mission generation system prompt, tool call arguments (missionMarkdown), and tool response are NEVER appended to transcript; only the user confirmation and final assistant message are appended
    - Test 8: **Error isolation** -- When `sendChatRequest` throws during mission generation, the route does not crash; returns "Mission generation failed. Please review and try again."
    - Mock: `sendChatRequest`, `executeToolCall`, `fetchProductName`, `appendTranscriptEntry`, `persistConversation`, `flushTranscriptToDisk`
  - [x] 3.2 Create a helper function `isConfirmationDetected` for confirmation detection
    - Signature: `function isConfirmationDetected(conversation: OpenAIMessage[], userMessage: string, context?: ChatContext): boolean`
    - Returns `true` when BOTH conditions are met:
      - (a) The previous assistant turn's parsed `productManagerResponse` has `phase === "ready"` -- inspect the last assistant message in the `conversation` array, parse its JSON content, and check the `phase` field
      - (b) The incoming user message matches the regex `/yes|proceed|generate|go ahead|confirm/i`
    - Must work with rehydrated conversations (from `conversation.json` on disk) by inspecting the `conversation` array, not in-memory session state
    - If the last assistant message cannot be parsed as JSON or does not contain `phase`, return `false`
    - Place this function near `shouldBypassToolExecution` (around line 120) for locality
  - [x] 3.3 Create the confirmation regex constant
    - `const CONFIRMATION_REGEX = /yes|proceed|generate|go ahead|confirm/i;`
    - Place near the top of the file with other constants
  - [x] 3.4 Implement the mission generation branch in the POST /api/chat handler
    - Insert the branch BEFORE the existing PM validation block (line 817)
    - Guard: `if (context?.mode === 'product_manager' && isConfirmationDetected(session.conversation || [], message, context))`
    - The branch must:
      1. Append the user's confirmation message as a USER transcript entry
      2. Fetch `productName` via `fetchProductName(context.filename!)` (imported from services)
      3. Validate prerequisites: `productName` is non-empty string, `context.projectParentFolder` is present, then after the OpenAI call validate `missionMarkdown` length > 0
      4. Build a fresh `messages` array: `MISSION_GENERATION_PROMPT_TEMPLATE` as system message + all prior user/assistant messages from `session.conversation` (excluding system messages)
      5. Call `sendChatRequest` with `options: { tools: [save_product_artifacts_tool_definition], toolChoice: { type: "function", function: { name: "save_product_artifacts" } } }`
      6. Extract the tool call from the response; if no tool call present, treat as failure
      7. Merge tool call arguments with `{ projectParentFolder, projectId: context.filename, productName, missionMarkdown }` -- `missionMarkdown` comes from the model's tool call arguments; `projectParentFolder`, `projectId`, and `productName` are injected/overridden by the gateway
      8. Call `executeToolCall` with the merged arguments
      9. On success: construct assistant message, append as ASSISTANT transcript entry, persist conversation (original discovery messages + confirmation + success message ONLY), flush transcript (kind="product"), return `ChatResponse`
      10. On failure: construct error assistant message, append as ASSISTANT transcript entry, log error, return `ChatResponse`
    - Wrap the entire branch in try/catch for error isolation
    - Return early from the branch -- do NOT fall through to the PM validation block
  - [x] 3.5 Implement transcript exclusion within the mission generation branch
    - The mission generation system prompt MUST NOT be appended via `appendTranscriptEntry`
    - The tool call arguments (including `missionMarkdown`) MUST NOT be appended via `appendTranscriptEntry`
    - The tool execution response MUST NOT be appended via `appendTranscriptEntry`
    - Only TWO entries are persisted via `appendTranscriptEntry`:
      1. The user's confirmation message (USER entry)
      2. The final assistant success/failure message (ASSISTANT entry)
    - `persistConversation` is called with the original discovery messages plus the confirmation message and the final assistant message -- NOT with the mission-generation messages array
  - [x] 3.6 Implement success handling
    - Success message: `"MISSION.MD has been successfully created in agent-os/product/."`
    - Append as ASSISTANT transcript entry
    - Persist conversation: discovery messages + confirmation user message + success assistant message
    - Flush transcript to disk (kind="product") via `flushTranscriptToDisk`
    - Return `ChatResponse` with `sessionId`, `assistant: { message: successMessage }`
  - [x] 3.7 Implement failure handling
    - Failure message: `"Mission generation failed. Please review and try again."`
    - Append as ASSISTANT transcript entry
    - Log detailed error internally via `logger.error` (include the raw error, requestId, sessionId)
    - Return `ChatResponse` with `sessionId`, `assistant: { message: failureMessage }`
    - Do NOT expose stack traces or internal error details to the client
  - [x] 3.8 Implement pre-tool-call validation
    - Before executing the tool call, validate:
      1. `productName` is a non-empty string (from `fetchProductName`)
      2. `context.projectParentFolder` is present and non-empty
      3. `missionMarkdown` from the model's tool call arguments has `length > 0`
    - If any validation fails:
      - Skip the tool call entirely
      - Return assistant error message: `"Unable to generate MISSION.MD: missing required data. Please ensure the product name is set and try again."`
      - Log the specific validation failure via `logger.warn`
  - [x] 3.9 Import required dependencies at the top of `chat.ts`
    - Import `MISSION_GENERATION_PROMPT_TEMPLATE` from `../services/promptBuilder` (or from `../services`)
    - Import `fetchProductName` from `../services` (already exported from `architectureModelClient.ts` via `services/index.ts`)
    - Import `TOOL_DEFINITIONS` from `../types` (may already be imported for `ToolResult`)
    - Verify `executeToolCall` is already imported (it is used in the OAS agent loop)
  - [x] 3.10 Ensure confirmation and mission generation tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify the confirmation detection correctly identifies ready-phase + confirmation regex
    - Verify the mission generation branch returns the correct success/failure messages
    - Verify transcript exclusion is enforced

**Acceptance Criteria:**
- The 8 tests from 3.1 pass
- Confirmation detection works with BOTH conditions: `phase === "ready"` AND regex match
- Confirmation detection works across server restarts (rehydrated conversations)
- Mission generation uses a fresh OpenAI call with only the `save_product_artifacts` tool
- Tool execution uses `executeToolCall` with the correct arguments
- Transcript exclusion is enforced: only user confirmation and final assistant message are persisted
- Errors are caught and returned as safe assistant messages without crashing the route
- Pre-tool-call validation prevents execution when required data is missing
- The normal PM discovery flow is unchanged when confirmation is NOT detected

---

### Integration Verification

#### Task Group 4: End-to-End Integration Tests
**Dependencies:** Task Groups 1-3
**File:** `gateway/src/__tests__/confirmation-mission-generation-e2e.test.ts`

- [x] 4.0 Complete end-to-end integration tests for the full confirmation-to-mission-generation flow
  - [x] 4.1 Write 6 integration tests covering the full flow
    - Test file: `gateway/src/__tests__/confirmation-mission-generation-e2e.test.ts`
    - Test 1: **Full happy path** -- Simulate a complete PM conversation: multiple discovery rounds reaching `phase === "ready"`, then user sends "yes", gateway triggers mission generation, `sendChatRequest` returns tool call with `missionMarkdown`, `executeToolCall` succeeds, response contains success message
    - Test 2: **Multiple confirmation keywords** -- Verify each keyword in the regex (`yes`, `proceed`, `generate`, `go ahead`, `confirm`) triggers the branch when phase is "ready"
    - Test 3: **Conversation persistence correctness** -- After successful mission generation, verify that `persistConversation` was called with the original discovery messages + confirmation message + success message, and that no mission-generation-internal messages are present
    - Test 4: **fetchProductName integration** -- Verify that `fetchProductName` is called with the correct `projectId` (from `context.filename`) and that the returned `productName` is passed to `executeToolCall` arguments
    - Test 5: **Tool call argument merging** -- Verify that `executeToolCall` receives the merged arguments: `projectParentFolder` from context, `projectId` from context.filename, `productName` from fetchProductName, and `missionMarkdown` from the model's tool call response
    - Test 6: **Double confirmation prevention (natural)** -- After a successful mission generation, if the user sends "yes" again, the conversation's last assistant message will be the success text (not a ready-phase PM response), so confirmation detection returns false and falls through to the normal PM flow
  - [x] 4.2 Ensure all integration tests pass
    - Run ONLY the 6 tests written in 4.1
    - These tests should mock external I/O (`sendChatRequest`, `executeToolCall`, `fetchProductName`, `fetch`) but exercise the full route handler logic

**Acceptance Criteria:**
- The 6 integration tests from 4.1 pass
- The full happy path from confirmation detection through tool execution and response is verified
- Conversation persistence correctness is verified (no leaked mission content)
- Argument merging and productName fetching are verified
- Natural double-confirmation prevention works (no explicit guard needed)

---

### Test Review and Gap Analysis

#### Task Group 5: Test Review and Gap Fill
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests from Task Group 1 (ChatRequestOptions extension)
    - Review the 6 tests from Task Group 2 (fetchProductName + prompt template)
    - Review the 8 tests from Task Group 3 (confirmation detection + mission generation)
    - Review the 6 tests from Task Group 4 (integration tests)
    - Total existing tests: 24 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical workflows that lack test coverage
    - Focus ONLY on gaps related to confirmation detection, mission generation, transcript exclusion, and tools override
    - Do NOT assess entire gateway test suite coverage
    - Prioritize edge cases in confirmation detection and transcript persistence
  - [x] 5.3 Write up to 8 additional strategic tests maximum to fill identified gaps
    - Potential gap areas to evaluate (write tests ONLY where gaps exist):
      - Confirmation regex edge cases: case insensitivity, partial matches within larger messages (e.g., "yes, please proceed" should match; "yesterday" should NOT match -- note: the spec regex `/yes|proceed|generate|go ahead|confirm/i` WILL match substrings, so test the actual behavior)
      - `isConfirmationDetected` when conversation array is empty (should return false)
      - `isConfirmationDetected` when last assistant message is not valid JSON (should return false gracefully)
      - `sendChatRequest` with tools override where the OpenAI response has no tool call (treated as failure)
      - `fetchProductName` called with empty string projectId
      - `MISSION_GENERATION_PROMPT_TEMPLATE` does not contain the word "missionMarkdown" literally (the model should use the tool parameter, not a hardcoded field name -- or verify it does reference the tool parameter correctly)
      - Verify `shouldBypassToolExecution` still returns true for `product_manager` mode (existing function is unchanged)
      - Verify the existing PM validation block still runs when confirmation is NOT detected
    - Maximum 8 new tests total
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this feature: tests from 1.1, 2.1, 3.1, 4.1, and 5.3
    - Expected total: approximately 24-32 tests maximum
    - Do NOT run the entire gateway test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-32 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: ChatRequestOptions Extension        (gateway service layer - openaiClient.ts)
2. Task Group 2: fetchProductName + Prompt Template   (gateway service layer - architectureModelClient.ts, promptBuilder.ts)
   -- Task Groups 1 and 2 can be done in PARALLEL --
3. Task Group 3: Confirmation Detection + Mission Generation Branch  (gateway route layer - chat.ts)
   -- Depends on Task Groups 1 and 2 --
4. Task Group 4: End-to-End Integration Tests         (integration verification)
   -- Depends on Task Groups 1-3 --
5. Task Group 5: Test Review and Gap Fill             (quality assurance)
   -- Depends on Task Groups 1-4 --
```

## Key Implementation Notes

1. **No changes to `toolExecutor.ts`**: The existing `executeToolCall` function already supports `save_product_artifacts` with full validation. Reuse it directly.

2. **No changes to `shouldBypassToolExecution`**: It continues to return `true` for `product_manager` mode. The confirmation branch handles its own tool execution in a dedicated code path BEFORE the bypass check matters.

3. **No changes to frontend**: The existing `ProductManagerChatPanel` "Thinking..." loading indicator is sufficient. The gateway POST endpoint takes longer during tool execution; the frontend naturally waits.

4. **No changes to mcp-server**: The `save_product_artifacts` MCP tool was already implemented in Increment 4.

5. **Transcript safety is critical**: The `missionMarkdown` content can be very large. It must NEVER appear in transcript files. The mission generation branch constructs its own internal messages array for the OpenAI call and does NOT persist it.

6. **The confirmation branch returns early**: When confirmation is detected, the code path runs the mission generation flow and returns a `ChatResponse` before reaching the PM validation block (lines 817-926). The PM validation block is completely skipped.

7. **Argument merging strategy**: The model's tool call will contain `missionMarkdown` in its arguments. The gateway overrides/injects `projectParentFolder`, `projectId`, and `productName` from server-side sources (context and fetchProductName). This ensures the tool gets authoritative values from the gateway, not from the model.
