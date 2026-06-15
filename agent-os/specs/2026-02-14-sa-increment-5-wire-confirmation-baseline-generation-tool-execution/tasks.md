# Task Breakdown: SA Increment 5 -- Wire Confirmation, Baseline Generation, Tool Execution

## Overview
Total Tasks: 47
Total Task Groups: 6

This increment completes the Solution Architect end-to-end flow: after the SA conversation reaches phase="ready" and the user confirms, the gateway generates an `architectureBaselineJson` via a dedicated LLM call, invokes the `save_architecture_baseline` MCP tool directly, and returns a success/failure message. The frontend renders a clickable link in the success message to navigate to the Architecture & Design tab.

## Task List

### Gateway -- Confirmation Detection

#### Task Group 1: Confirmation Detection Helper
**Dependencies:** None

- [x] 1.0 Complete confirmation detection helper
  - [x] 1.1 Write 4 focused tests for `isBaselineConfirmation()` helper
    - Test: returns `true` when most recent assistant message has `phase="ready"` AND user message is `"yes"`
    - Test: returns `false` when most recent assistant message has `phase="questions"` (even if user message is `"yes"`)
    - Test: returns `false` when most recent assistant message has `phase="ready"` but user message is a full sentence like `"Yes, but also add a caching layer"`
    - Test: returns `true` for edge-case confirmation words: `"ok"`, `"proceed"`, `"Go ahead!"`, `"CONFIRM"`, `"generate"`, `"y"`
  - [x] 1.2 Create `isBaselineConfirmation(messages: OpenAIMessage[], userMessage: string): boolean` function
    - Create as a named function in `gateway/src/routes/chat.ts` (same pattern as `shouldValidateSolutionArchitectResponse`, `shouldBypassToolExecution` helpers in the same file)
    - Parse `messages` array in reverse to find the most recent assistant message whose content is valid JSON with `phase === "ready"` (mirror the rehydration parse logic used in `SolutionArchitectChatPanel.tsx` lines 152-168)
    - If no assistant message with `phase="ready"` found, return `false` immediately
    - Apply strict case-insensitive regex against trimmed `userMessage`: `^\s*(yes|y|ok|okay|proceed|go ahead|confirm|generate)\s*[.!]?\s*$`
    - Both conditions must be `true` to return `true`
  - [x] 1.3 Wire `isBaselineConfirmation` call into the SA mode branch of POST `/api/chat`
    - Call site: AFTER the standards-missing short-circuit (line ~622) and AFTER `buildMessagesForTurn` (line ~659), but BEFORE `sendChatRequest` (line ~688)
    - When `isBaselineConfirmation(messages, message)` returns `true`, branch into the baseline generation flow (Task Group 3) and skip the normal `sendChatRequest` + SA validation path entirely
    - Use an early-return pattern similar to the standards-missing short-circuit block (lines 581-622)
  - [x] 1.4 Ensure confirmation detection tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify regex correctness across all confirmation words

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `isBaselineConfirmation` correctly requires BOTH `phase="ready"` in conversation history AND regex match on user message
- Full sentences containing confirmation words are rejected (regex anchored with `^` and `$`)
- Function is pure (no side effects, no I/O)

---

### Gateway -- Generation Prompt Template

#### Task Group 2: Architecture Baseline Generation Prompt Template
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete generation prompt template
  - [x] 2.1 Write 4 focused tests for the generation prompt template
    - Test: `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` is exported and is a non-empty string
    - Test: template contains the placeholder tokens `{missionContent}`, `{techStackContent}`, and `{conversationTranscript}`
    - Test: template contains the ArchitectureBaselineInput schema definition (check for key entity type names: `services`, `interfaces`, `interfaceEndpoints`, `logicalDataEntities`, `physicalDataEntities`, `businessLogic`, `dataMovements`)
    - Test: template contains the instruction "Return ONLY valid JSON matching the schema" (or substring thereof)
  - [x] 2.2 Create `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` constant in `gateway/src/services/promptBuilder.ts`
    - Follow the same pattern as `MISSION_GENERATION_PROMPT_TEMPLATE` (exported named constant, lines 505-570)
    - Instruct the LLM to act as an "Architecture Extraction Assistant"
    - Embed the full `ArchitectureBaselineInput` schema definition inline (all 7 entity types and their fields from `mcp-server/src/types/saveArchitectureBaseline.ts` -- `ServiceInput`, `InterfaceInput`, `InterfaceEndpointInput`, `LogicalDataEntityInput`, `PhysicalDataEntityInput`, `BusinessLogicInput`, `DataMovementInput`)
    - Include placeholder tokens: `{missionContent}`, `{techStackContent}`, `{conversationTranscript}`
    - Include explicit instruction: "Return ONLY valid JSON matching the schema. No markdown, no prose, no code blocks."
    - Include instruction to ensure at least one service exists (inject "Core Application Service" default if conversation did not identify any)
    - Include instruction that `name` is required for all entities and must be non-empty
    - Include instruction that `serviceRef` on interfaces must match a service name from the `services` array
  - [x] 2.3 Export `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` from `gateway/src/services/index.ts`
    - Add to the existing promptBuilder export line (line 20): add `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` alongside `MISSION_GENERATION_PROMPT_TEMPLATE`
  - [x] 2.4 Ensure generation prompt template tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify template content and placeholder tokens

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Template is exported from both `promptBuilder.ts` and `services/index.ts`
- Schema definition in the template covers all 7 entity types with their fields
- Placeholder tokens are present and match the expected format

---

### Gateway -- Baseline Generation + Tool Invocation

#### Task Group 3: Baseline Generation Flow, JSON Validation, and Direct Tool Invocation
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete baseline generation and tool invocation flow
  - [x] 3.1 Write 6 focused tests for the full generation flow
    - Test: when `isBaselineConfirmation` returns `true`, the normal `sendChatRequest` is NOT called for SA conversation (generation call is separate)
    - Test: generation call uses `sendChatRequest` with `{ jsonMode: true }` option (verifying `response_format: { type: "json_object" }` behavior)
    - Test: valid JSON response triggers `executeTool('save_architecture_baseline', ...)` with correct args shape `{ projectId, architectureBaselineJson }`
    - Test: `executeTool` returning `status: 200` produces success response with message `"The architecture has been saved and can be viewed and extended here."`
    - Test: `executeTool` returning `status: 400` produces failure response with message `"Architecture generation failed. Please review and try again."`
    - Test: persistence array contains ONLY system message, user confirmation message, and final assistant success/failure message (no generation prompt, no raw JSON)
  - [x] 3.2 Extend `ChatRequestOptions` in `gateway/src/services/openaiClient.ts` to support `temperature` and `maxTokens`
    - Add optional `temperature?: number` field to `ChatRequestOptions` interface (line ~103)
    - Add optional `maxTokens?: number` field to `ChatRequestOptions` interface
    - Wire these into the `createParams` object in `sendChatRequest` function (line ~164): `if (options?.temperature !== undefined) createParams.temperature = options.temperature;` and `if (options?.maxTokens !== undefined) createParams.max_tokens = options.maxTokens;`
    - These additions are backward-compatible (optional fields, no existing callers affected)
  - [x] 3.3 Add `executeTool` to the import statement in `gateway/src/routes/chat.ts`
    - `executeTool` is already exported from `gateway/src/services/index.ts` (line 27) but is NOT in the import block in `chat.ts` (lines 68-98)
    - Add `executeTool` to the import from `'../services'`
  - [x] 3.4 Add `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` to the import statement in `gateway/src/routes/chat.ts`
    - Add to the import from `'../services'` alongside the existing imports
  - [x] 3.5 Implement the baseline generation branch in the SA mode section of `chat.ts`
    - Location: immediately after `buildMessagesForTurn` and before `sendChatRequest`, inside the SA mode block (after the standards-missing short-circuit at line ~622)
    - Guard: `if (shouldValidateSolutionArchitectResponse(context) && isBaselineConfirmation(messages, message))`
    - Step 1 -- Build generation prompt: Replace `{missionContent}`, `{techStackContent}`, `{conversationTranscript}` in `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE`
      - `{conversationTranscript}`: format all user and assistant messages from `messages` array (excluding system messages) as `"User: ...\nAssistant: ..."` dialogue
      - `{missionContent}`: use `missionContent` variable (already loaded at line ~548) or `"Not available"` if undefined
      - `{techStackContent}`: use `techStackContent` variable (already loaded at line ~548) or `"Not available"` if undefined
    - Step 2 -- Dedicated OpenAI call: `sendChatRequest(generationMessages, requestId, effectiveSessionId, { jsonMode: true, temperature: 0.2, maxTokens: 8000 })` where `generationMessages` = `[{ role: 'system', content: populatedTemplate }, { role: 'user', content: 'Generate the architecture baseline JSON now.' }]`
    - Step 3 -- JSON validation (see 3.6)
    - Step 4 -- Tool invocation (see 3.7)
    - Step 5 -- Response construction (see 3.8)
    - Step 6 -- Persistence (see 3.9)
    - Early return with `res.json(chatResponse)` to skip the normal SA validation block
  - [x] 3.6 Implement JSON validation with corrective retry
    - Parse the LLM response content via `JSON.parse(response.content || '')`
    - Validate structural shape: result must be a plain object (not array, not null)
    - Validate each known array field (`services`, `interfaces`, `interfaceEndpoints`, `logicalDataEntities`, `physicalDataEntities`, `businessLogic`, `dataMovements`): if present, must be an array
    - Minimum service check: if `services` is absent or empty, inject `[{ name: "Core Application Service", description: "Default service" }]`
    - On first failure (parse error or structural validation): follow the exact corrective retry pattern from SA validation (lines 992-1006) -- append invalid response and corrective instruction to generation messages, resend once with same `sendChatRequest` options
    - On second failure: log detailed error via `logger.error` with `requestId` and `sessionId`, proceed to failure response (3.8)
    - Corrective instruction text: `'Your last response was not valid JSON matching the ArchitectureBaselineInput schema. Return ONLY a single JSON object with arrays for: services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, businessLogic, dataMovements. No markdown, no code blocks.'`
  - [x] 3.7 Implement direct `executeTool` invocation
    - After successful JSON validation: `const toolResult = await executeTool('save_architecture_baseline', { projectId: context!.filename!, architectureBaselineJson: JSON.stringify(parsedJson) }, session.mcpSessionId, requestId, effectiveSessionId)`
    - Check `toolResult.status`: `200` = success, any other = failure
    - Log tool result: `logger.info('save_architecture_baseline tool result', { requestId, sessionId: effectiveSessionId, status: toolResult.status, durationMs: toolResult.durationMs })`
    - On failure: log error details via `logger.error` with status code and error content, proceed to failure response (3.8)
  - [x] 3.8 Implement success and failure response construction
    - Success response (`toolResult.status === 200`):
      ```typescript
      const chatResponse: ChatResponse = {
        sessionId: effectiveSessionId,
        assistant: { message: 'The architecture has been saved and can be viewed and extended here.' },
      };
      ```
      - Do NOT include `solutionArchitectResponse` field (plain assistant message to avoid ready banner re-trigger)
    - Failure response (JSON validation failed after retry, or tool invocation failed):
      ```typescript
      const chatResponse: ChatResponse = {
        sessionId: effectiveSessionId,
        assistant: { message: 'Architecture generation failed. Please review and try again.' },
      };
      ```
      - Do NOT include `solutionArchitectResponse` field
      - Log detailed error via `logger.error` including: `requestId`, `sessionId`, step that failed, and error message/status code
  - [x] 3.9 Implement transcript persistence rules
    - Build custom `messagesForPersistence` array containing ONLY:
      1. The system message (first entry from `messages` array, index 0)
      2. The user confirmation message: `{ role: 'user', content: message }` (the original user message, not augmented)
      3. The final assistant message: `{ role: 'assistant', content: chatResponse.assistant.message }`
    - Do NOT include: the generation prompt, the LLM's raw JSON response, corrective retry messages, or tool call arguments
    - Call `persistConversation(effectiveSessionId, messagesForPersistence)` -- same function used in SA mode (line ~807)
    - Update session: `updateSession(effectiveSessionId, { filename: context?.filename || session.filename })` -- same pattern as line ~814
  - [x] 3.10 Add timing and logging
    - Log `durationMs` for the entire confirmation branch using `Date.now() - startTime` (reuse the `startTime` from line ~506)
    - Call `logRequestEnd(requestId, effectiveSessionId, 200, durationMs)` before returning
    - Log entry for the branch: `logger.info('SA baseline confirmation detected, starting generation', { requestId, sessionId: effectiveSessionId })`
  - [x] 3.11 Ensure baseline generation flow tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify the full flow: confirmation detection -> generation call -> JSON validation -> tool invocation -> response -> persistence

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- `ChatRequestOptions` extended with `temperature` and `maxTokens` (backward-compatible)
- `executeTool` and `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` imported in `chat.ts`
- Generation branch produces correct success/failure responses
- Persistence contains only system + user confirmation + final assistant message
- Corrective retry follows the same pattern as SA validation (lines 992-1006)
- No `solutionArchitectResponse` field on success or failure responses

---

### Frontend -- Success Message with Navigation Link

#### Task Group 4: Frontend Success Message Rendering with Architecture & Design Link
**Dependencies:** Task Group 3 (for understanding the response format)

- [x] 4.0 Complete frontend success message link rendering
  - [x] 4.1 Write 3 focused tests for the link rendering behavior
    - Test: assistant message containing `"can be viewed and extended here"` renders the word "here" as a clickable element with `data-testid="sa-architecture-link"`
    - Test: clicking the "here" link calls `dispatch({ type: 'SET_VIEW', payload: 'metamodel' })` via `useArchitectureDispatch()`
    - Test: assistant message NOT containing the success marker renders as plain text (no link elements)
  - [x] 4.2 Import `useArchitectureDispatch` into `SolutionArchitectChatPanel.tsx`
    - Add import: `import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';`
    - Call the hook at the top of the component: `const architectureDispatch = useArchitectureDispatch();`
  - [x] 4.3 Implement success message detection and link rendering in the message content area
    - In the message rendering block (inside `messages.map`, around line ~432-434), add a conditional branch for assistant messages
    - Detection: check if `msg.role === 'assistant'` AND `msg.content.includes('can be viewed and extended here')`
    - When detected: split the message content around the word "here" and render:
      ```tsx
      <div className={styles.messageContent}>
        {beforeHere}
        <span
          className={styles.architectureLink}
          onClick={() => architectureDispatch({ type: 'SET_VIEW', payload: 'metamodel' })}
          role="link"
          tabIndex={0}
          data-testid="sa-architecture-link"
        >
          here
        </span>
        {afterHere}
      </div>
      ```
    - Non-matching messages continue to render as plain text (current behavior at line ~433)
  - [x] 4.4 Add CSS styles for the clickable link element
    - In `SolutionArchitectChatPanel.module.css`, add `.architectureLink` class:
      - `color: #0066cc` (or the existing link color from the design system)
      - `text-decoration: underline`
      - `cursor: pointer`
      - On hover: slightly darker color
    - Keep consistent with existing link styling in the application
  - [x] 4.5 Ensure frontend link rendering tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify link renders correctly and dispatches the correct action

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Success messages render "here" as a clickable element
- Clicking "here" dispatches `{ type: 'SET_VIEW', payload: 'metamodel' }` to navigate to Architecture & Design
- Non-success assistant messages render as plain text (no regression)
- Link is visually styled as a clickable element (underline, pointer cursor, distinct color)

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests from Task Group 1 (confirmation detection)
    - Review the 4 tests from Task Group 2 (prompt template)
    - Review the 6 tests from Task Group 3 (generation flow)
    - Review the 3 tests from Task Group 4 (frontend link)
    - Total existing tests: 17 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to SA Increment 5 feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Potential gap: `ChatRequestOptions.temperature` and `ChatRequestOptions.maxTokens` are correctly wired into the OpenAI `createParams` object
    - Potential gap: corrective retry on JSON parse failure actually resends and re-validates
    - Potential gap: confirmation detection returns `false` when the most recent assistant message is the plain-text success message (post-save, no `phase` field), preventing re-confirmation naturally
    - Potential gap: the generation prompt transcript formatting correctly excludes system messages and formats as "User: ...\nAssistant: ..." dialogue
    - Potential gap: success response does NOT contain `solutionArchitectResponse` field (regression guard)
    - Potential gap: failure response does NOT contain `solutionArchitectResponse` field (regression guard)
    - Potential gap: minimum service injection when `services` is empty or absent
    - Potential gap: `executeTool` is called with the correct 5 arguments including `session.mcpSessionId`
    - Focus on integration points and end-to-end workflows
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to SA Increment 5 (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 17-27 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 17-27 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on SA Increment 5 feature requirements

---

### Verification

#### Task Group 6: Final Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete final verification
  - [x] 6.1 TypeScript compilation check
    - Run `npx tsc --noEmit` in `gateway/` directory to verify no type errors
    - Run `npx tsc --noEmit` in `frontend/` directory to verify no type errors
    - Fix any type errors introduced by new code
  - [x] 6.2 Cross-cutting consistency check
    - Verify `executeTool` import in `chat.ts` matches the exported signature from `gateway/src/services/toolExecutor.ts`
    - Verify `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` is exported from both `promptBuilder.ts` and `services/index.ts`
    - Verify `ChatRequestOptions` extensions (`temperature`, `maxTokens`) are correctly used in the `sendChatRequest` function body
    - Verify success message text in `chat.ts` matches the detection string in `SolutionArchitectChatPanel.tsx` (`"can be viewed and extended here"`)
    - Verify `useArchitectureDispatch` dispatch payload matches `{ type: 'SET_VIEW', payload: 'metamodel' }` which is the same action used by the TopBar Architecture & Design button
  - [x] 6.3 Run full feature test suite
    - Run ALL tests from Task Groups 1-5 together
    - Verify no test interdependencies or conflicts
    - Confirm all tests pass in a single run

**Acceptance Criteria:**
- TypeScript compiles without errors in both `gateway/` and `frontend/`
- All cross-cutting references are consistent (message text, imports, dispatch actions)
- Full feature test suite passes

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Confirmation Detection) and **Task Group 2** (Generation Prompt Template) -- these have no dependencies and can be implemented in parallel
2. **Task Group 3** (Baseline Generation + Tool Invocation) -- depends on TG1 and TG2; this is the largest and most critical group
3. **Task Group 4** (Frontend Success Message Link) -- depends on TG3 for understanding the response format
4. **Task Group 5** (Test Review & Gap Analysis) -- depends on TG1-TG4
5. **Task Group 6** (Final Verification) -- depends on all previous groups

## Key Files Modified

| File | Task Groups | Changes |
|------|------------|---------|
| `gateway/src/routes/chat.ts` | TG1, TG3, TG5 | `isBaselineConfirmation` helper, generation branch, tool invocation, persistence, exported helpers for testing |
| `gateway/src/services/promptBuilder.ts` | TG2 | `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` constant |
| `gateway/src/services/index.ts` | TG2 | Export new prompt template |
| `gateway/src/services/openaiClient.ts` | TG3 | Extend `ChatRequestOptions` with `temperature`, `maxTokens` |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` | TG4 | Success message link rendering, `useArchitectureDispatch` |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css` | TG4 | `.architectureLink` styles |

## Files NOT Modified (Already Complete from Previous Increments)

- `gateway/src/services/toolExecutor.ts` -- `save_architecture_baseline` already registered
- `gateway/src/types/chat.ts` -- No new types needed; success is a plain assistant message
- `mcp-server/src/types/saveArchitectureBaseline.ts` -- Schema already defined
- `gateway/src/services/transcriptWriter.ts` -- Persistence handled by `messagesForPersistence` pattern in `chat.ts`
