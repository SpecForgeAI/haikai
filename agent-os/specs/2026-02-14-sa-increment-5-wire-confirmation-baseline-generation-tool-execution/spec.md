# Specification: SA Increment 5 -- Wire Confirmation, Baseline Generation, Tool Execution

## Goal
Complete the Solution Architect end-to-end flow: detect user confirmation after phase="ready", generate an architectureBaselineJson via a dedicated OpenAI call, invoke the save_architecture_baseline MCP tool directly, and return a success message with a clickable link to the Architecture & Design view.

## User Stories
- As a user, I want to confirm baseline creation after the SA conversation reaches "ready" so that the architecture is saved to the model without manual JSON authoring.
- As a user, I want a clickable link in the success message so that I can navigate directly to the Architecture & Design view to inspect what was created.

## Specific Requirements

**R-1: Confirmation Detection Helper**
- Create a pure helper function `isBaselineConfirmation(messages: OpenAIMessage[], userMessage: string): boolean` in `chat.ts` (or a new file imported into chat.ts)
- Parse `messages` in reverse to find the most recent assistant message whose content is valid JSON with `phase === "ready"` (this mirrors how rehydration parses SA responses)
- If the most recent assistant SA response is not phase="ready", return false immediately
- Apply a strict case-insensitive regex against the trimmed `userMessage`: `^\s*(yes|y|ok|okay|proceed|go ahead|confirm|generate)\s*[.!]?\s*$`
- Both conditions (phase="ready" AND regex match) must be true to return true
- This helper must be called early in the SA mode branch of the POST /api/chat handler, AFTER the standards-missing short-circuit and AFTER `buildMessagesForTurn` (so `messages` includes conversation history), but BEFORE `sendChatRequest`
- When `isBaselineConfirmation` returns true, branch into the baseline generation flow and skip the normal SA conversation/validation path entirely

**R-2: ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE**
- Add a new exported constant in `gateway/src/services/promptBuilder.ts`
- The prompt instructs the LLM to act as an "Architecture Extraction Assistant" that synthesizes the entire SA conversation into a single JSON object matching the `ArchitectureBaselineInput` schema
- Embed the full ArchitectureBaselineInput schema definition (all 7 entity types and their fields from `mcp-server/src/types/saveArchitectureBaseline.ts`) inline in the prompt text so the LLM knows the exact target structure
- Include placeholder tokens `{missionContent}` and `{techStackContent}` for injecting MISSION.MD and TECH-STACK.MD content (already loaded in the SA mode path)
- Include placeholder token `{conversationTranscript}` for the full SA conversation transcript (user + assistant messages only, system messages excluded)
- The prompt must explicitly instruct: "Return ONLY valid JSON matching the schema. No markdown, no prose, no code blocks."
- The prompt must instruct the LLM to ensure at least one service exists (inject "Core Application Service" if the conversation did not identify any)
- Follow the same pattern as `MISSION_GENERATION_PROMPT_TEMPLATE` (exported named constant, used directly in chat.ts)

**R-3: Dedicated OpenAI Generation Call**
- After confirmation detection returns true, build the generation prompt by replacing `{missionContent}`, `{techStackContent}`, and `{conversationTranscript}` placeholders in `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE`
- The conversation transcript should include all user and assistant messages from the `messages` array (excluding system messages), formatted as a readable dialogue (e.g., "User: ...\nAssistant: ...")
- Make a separate `sendChatRequest` call with custom options: `temperature: 0.2`, `response_format: { type: "json_object" }`, `max_tokens: 8000`
- The system prompt for this call is the populated generation template; the messages array should contain a single user message requesting generation (or use the template as the system message with the transcript as user content)
- Use the same model family as the normal SA conversation (no model override)
- This is a dedicated call, not an extension of the existing SA conversation flow

**R-4: JSON Validation + Corrective Retry**
- Parse the LLM response content as JSON using `JSON.parse`
- Validate structural shape: the parsed object must be a plain object, not an array
- Validate minimum requirements: at least one entry in `services` array; if `services` is empty or absent, inject `[{ name: "Core Application Service", description: "Default service" }]`
- Validate that if present, each array in the parsed object (`services`, `interfaces`, `interfaceEndpoints`, `logicalDataEntities`, `physicalDataEntities`, `businessLogic`, `dataMovements`) is actually an array
- On first failure (parse error or structural validation failure): append the invalid response and a corrective instruction to the messages, then resend once using the same `sendChatRequest` parameters -- follow the exact same corrective retry pattern used by the existing SA validation block (lines ~992-1006 of chat.ts)
- On second failure: log the detailed error via `console.error` with `requestId`, and return a user-friendly failure response (R-8)

**R-5: Direct Tool Invocation**
- After successful JSON validation, call `executeTool('save_architecture_baseline', { projectId: context.filename, architectureBaselineJson: JSON.stringify(parsedJson) }, session.mcpSessionId, requestId, effectiveSessionId)` directly
- The `executeTool` import is already exported from `gateway/src/services/index.ts` but is NOT currently imported in `chat.ts` -- it must be added to the import statement
- Bypass the OpenAI agent loop entirely (no tool_calls, no function-calling); this follows the same direct-invocation pattern used by the PM confirmation flow
- Handle the `executeTool` return value: check `status` for success (200) vs failure (400 = validation error, 502 = MCP server error, 500 = unknown)
- On success (status 200): proceed to success response (R-7)
- On failure (any non-200 status): log error details internally, proceed to failure response (R-8)

**R-6: Transcript Persistence Rules**
- Build a custom `messagesForPersistence` array containing ONLY: the system message (first entry, to maintain structure), the user confirmation message, and the final assistant success or failure message
- Do NOT include in persistence: the generation prompt, the LLM's raw JSON response, the corrective retry messages, or the tool call arguments
- Exclude stripped items entirely -- no placeholder entries, no redacted markers
- Call `persistConversation(effectiveSessionId, messagesForPersistence)` using the same function already used in the SA mode path
- This follows the existing `messagesForPersistence` pattern from SA Increment 2 (lines ~799-811 of chat.ts) but is more aggressive in stripping

**R-7: Success Response**
- Return a `ChatResponse` with `assistant.message` set to: `"The architecture has been saved and can be viewed and extended here."`
- The word "here" in the message acts as a marker that the frontend will detect and render as a clickable element
- Do NOT include a `solutionArchitectResponse` field on the success response -- this must be a plain assistant message to avoid the ready banner re-triggering confirmation detection
- The response should NOT include any entity counts or summary data in v0.1 (keep it simple)
- Persist this success message in the transcript via the messagesForPersistence array

**R-8: Failure Response**
- Return a `ChatResponse` with `assistant.message` set to: `"Architecture generation failed. Please review and try again."`
- Do NOT include a `solutionArchitectResponse` field on failure responses either
- Log detailed error information via `logger.error` including: `requestId`, `sessionId`, step that failed (JSON parse, validation, tool invocation), and the error message or status code
- Do NOT expose schema details, JSON content, or technical error messages to the user
- Persist this failure message in the transcript via the messagesForPersistence array

**R-9: Frontend -- Success Message with Navigation Link**
- In `SolutionArchitectChatPanel.tsx`, detect assistant messages containing the exact text "can be viewed and extended here" (or a similar stable substring)
- When detected, render the message with the word "here" as a clickable element that navigates to the Architecture & Design view
- Navigation uses `useArchitectureDispatch()` to dispatch `{ type: 'SET_VIEW', payload: 'metamodel' }` -- this is the same mechanism used by the TopBar buttons (NOT React Router, since the app uses dispatch-based view switching)
- The clickable element should be styled as a link (underline, pointer cursor, distinct color) but implemented as a `<button>` or `<span>` with an onClick handler that calls dispatch
- No special loading indicator is needed; keep the existing "Thinking..." indicator during the API call
- Messages without the success marker continue to render as plain text (no changes to existing rendering)

**R-10: No Phase Enum Extension**
- Do NOT add "saved", "completed", or any new value to the `SolutionArchitectResponse.phase` enum
- The success response is a plain assistant message without any `solutionArchitectResponse` field
- No re-confirmation prevention logic is needed in v0.1 -- if the user sends another "yes" after save, it flows through the normal SA conversation path (the most recent assistant message in history will be the plain success message, not a phase="ready" SA response, so `isBaselineConfirmation` will return false naturally)

**R-11: Model and Temperature Settings**
- Use the same model family as the SA discovery conversation (no model override needed; `sendChatRequest` already uses the configured model)
- Pass `temperature: 0.2` to the generation call for deterministic output
- Pass `response_format: { type: "json_object" }` to enforce JSON-only output from OpenAI
- Pass `max_tokens: 8000` to reduce truncation risk for larger baselines
- These options may require extending the `sendChatRequest` function signature or passing them via an options object (check `ChatRequestOptions` in `openaiClient.ts`)

## Visual Design
No visual assets provided. The visuals folder is empty.

## Existing Code to Leverage

**SA Corrective Retry Pattern (`gateway/src/routes/chat.ts` lines ~951-1055)**
- Validates SA response, on failure appends invalid response + corrective instruction to messages array, resends once via `sendChatRequest`, validates again, falls back on second failure
- The baseline generation JSON validation + corrective retry should follow this exact same structural pattern (append invalid response, append corrective message, resend, validate again)

**MISSION_GENERATION_PROMPT_TEMPLATE (`gateway/src/services/promptBuilder.ts`)**
- Exported named constant used as a dedicated generation prompt for a separate OpenAI call
- The new `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` should follow this same export and usage pattern
- The PM confirmation flow in chat.ts shows how to build a dedicated `sendChatRequest` call with a custom system prompt outside the normal conversation flow

**messagesForPersistence Pattern (`gateway/src/routes/chat.ts` lines ~799-811)**
- Creates a separate array for persistence that strips augmented content while preserving the original user message
- The baseline generation branch should create its own `messagesForPersistence` array containing only the system message, user confirmation, and final assistant success/failure message

**executeTool Function (`gateway/src/services/toolExecutor.ts`)**
- Signature: `executeTool(toolName, args, mcpSessionId, requestId, sessionId)` returns `{ result, status, durationMs }`
- `save_architecture_baseline` is already registered in TOOL_ENDPOINTS and TOOL_REQUIRED_PARAMS
- The PM flow demonstrates direct tool invocation bypassing the agent loop; the SA baseline save should follow the same pattern

**Architecture & Design Navigation (`frontend/src/components/TopBar/TopBar.tsx` line ~947)**
- The "Architecture & Design" tab dispatches `{ type: 'SET_VIEW', payload: 'metamodel' }` via `useArchitectureDispatch()`
- The frontend success message link must use this same dispatch mechanism (not React Router, since the app does not use URL-based routing for top-level views)

## Out of Scope
- Diagram generation from the architecture baseline (future increment)
- Advanced validation beyond minimum structural checks on the generated JSON (e.g., cross-referencing serviceRef names)
- User editing or previewing the baseline JSON before save
- Multi-product support (assumes single product context)
- New phase enum values ("saved", "completed") on SolutionArchitectResponse
- Re-confirmation prevention logic (detecting "already saved" and blocking re-save)
- Special frontend loading indicator for baseline generation (keep "Thinking...")
- Gateway-to-frontend progress signaling for the generation steps
- Entity count summary in the success message (deferred to future increment)
- Extending `sendChatRequest` for streaming in this branch (non-streaming only)
