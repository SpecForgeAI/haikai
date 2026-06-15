# Task Breakdown: Increment 3 -- Introduce Product Manager Chat Mode (Tool-less LLM Persona)

## Overview
Total Tasks: 38

This feature introduces a new `product_manager` chat mode in the gateway and a companion frontend chat panel on the ProductPage. The mode is tool-less (no MCP), uses structured JSON responses with validation and retry, persists conversations under `kind="product"`, and replaces the "Coming Soon" placeholder with a working PM discovery chat.

**Systems affected:** Gateway (types, services, routes), Frontend (API types, new component, ProductPage integration)
**Systems NOT affected:** architecture-model-service, mcp-server, jira-service

## Task List

### Gateway Types and Contracts

#### Task Group 1: ChatMode Union, Response Types, and Type Exports
**Dependencies:** None

- [x] 1.0 Complete gateway type definitions for product_manager mode
  - [x] 1.1 Write 3 focused tests for new type definitions
    - Test that `ProductManagerResponse` interface accepts valid `{ phase: "questions", questions: ["q1"], summary: "s" }`
    - Test that `ProductManagerResponse` rejects invalid phase values at runtime (via a helper or validator stub)
    - Test that `ProductManagerValidationResult` shape includes `valid`, optional `productManagerResponse`, and optional `error`
  - [x] 1.2 Add `'product_manager'` to the `ChatMode` type union
    - File: `gateway/src/types/chat.ts` (line 69)
    - Change from `'oas_assistant' | 'implement_feature'` to `'oas_assistant' | 'implement_feature' | 'product_manager'`
    - Update the JSDoc comment to document the new mode
  - [x] 1.3 Define `ProductManagerResponse` interface
    - File: `gateway/src/types/chat.ts`
    - Add after the ImplementerResponse section (~line 609)
    - Fields: `phase: "questions" | "ready"`, `questions: string[]`, `summary: string`
    - Include JSDoc referencing this spec
  - [x] 1.4 Define `ProductManagerValidationResult` interface
    - File: `gateway/src/types/chat.ts`
    - Fields: `valid: boolean`, `productManagerResponse?: ProductManagerResponse`, `error?: string`
    - Follow the pattern of `PlannerValidationResult` (line 549) and `ImplementerValidationResult` (line 601)
  - [x] 1.5 Add optional `productManagerResponse` field to `ChatResponse` interface
    - File: `gateway/src/types/chat.ts` (line 674, inside `ChatResponse`)
    - Add `productManagerResponse?: ProductManagerResponse` following the pattern of `plannerResponse` (line 700) and `implementerResponse` (line 708)
    - Include JSDoc referencing this spec
  - [x] 1.6 Export all new types from `gateway/src/types/index.ts`
    - Add `ProductManagerResponse` and `ProductManagerValidationResult` to the exports from `'./chat'`
    - Place in a new comment section: `// Product Manager Response types (Spec 2026-02-12: Increment 3)`
  - [x] 1.7 Ensure type definition tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify TypeScript compilation succeeds with `npx tsc --noEmit` in the gateway directory

**Acceptance Criteria:**
- `ChatMode` is a three-value union: `'oas_assistant' | 'implement_feature' | 'product_manager'`
- `ProductManagerResponse` and `ProductManagerValidationResult` interfaces exist and compile
- `ChatResponse` includes optional `productManagerResponse` field
- All new types are exported from `gateway/src/types/index.ts`
- The 3 tests written in 1.1 pass
- Gateway compiles with `npx tsc --noEmit`

---

### Gateway Services

#### Task Group 2: Product Manager System Prompt
**Dependencies:** Task Group 1 (COMPLETE)

- [x] 2.0 Complete the Product Manager system prompt
  - [x] 2.1 Write 4 focused tests for the system prompt
    - Test that `buildSystemPrompt()` returns the PM prompt when `context.mode === 'product_manager'`
    - Test that the PM prompt contains key persona phrases: "Senior Product Manager", "structured product discovery"
    - Test that the PM prompt enforces JSON-only output (contains instruction text about valid JSON, no markdown)
    - Test that `buildSystemPrompt()` still returns OAS prompt for `mode === undefined` and planner prompt for `mode === 'implement_feature'` (non-regression)
  - [x] 2.2 Create `PRODUCT_MANAGER_PROMPT_TEMPLATE` constant
    - File: `gateway/src/services/promptBuilder.ts`
    - Persona: "Senior Product Manager" conducting structured product discovery
    - Include discovery requirements: determine new vs. existing product, ask for existing documentation, gather minimum required information (project name confirmation, new vs. existing, documentation availability, core problem, target audience, desired outcome, success criteria, constraints, scope boundaries, delivery expectations)
    - Instruct concise high-signal questions, soft cap of ~10 total question rounds, internal sufficiency tracking
    - When sufficient: switch phase to "ready", ask user "I now have enough information to generate the MISSION.MD. Would you like me to proceed?"
    - Enforce JSON-only output: `{ "phase": "questions" | "ready", "questions": ["..."], "summary": "..." }`
    - Explicitly forbid: markdown, prose outside JSON, `missionMarkdown` field, tool calls
  - [x] 2.3 Add `product_manager` branch in `buildSystemPrompt()`
    - File: `gateway/src/services/promptBuilder.ts` (inside `buildSystemPrompt()`, before the `implement_feature` branch at line 1080)
    - Add: `if (context?.mode === 'product_manager') { return PRODUCT_MANAGER_PROMPT_TEMPLATE; }`
    - Place BEFORE the `implement_feature` check so it takes priority
  - [x] 2.4 Ensure system prompt tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify the new branch does not regress existing prompt logic

**Acceptance Criteria:**
- `PRODUCT_MANAGER_PROMPT_TEMPLATE` exists with all required PM persona instructions
- `buildSystemPrompt()` returns PM prompt for `product_manager` mode
- Existing `oas_assistant` and `implement_feature` prompts are unaffected
- The 4 tests written in 2.1 pass

---

#### Task Group 3: Product Manager Response Validator
**Dependencies:** Task Group 1 (COMPLETE)

- [x] 3.0 Complete the response validator service
  - [x] 3.1 Write 6 focused tests for the validator
    - Test valid "questions" phase response parses correctly
    - Test valid "ready" phase response parses correctly
    - Test invalid phase value (e.g., `"unknown"`) returns `{ valid: false }` with error
    - Test missing `questions` array returns `{ valid: false }` with error
    - Test non-JSON content triggers `extractJson()` fallback and fails gracefully
    - Test `createFallbackProductManagerResponse()` returns safe default `{ phase: "questions", questions: [], summary: "" }`
  - [x] 3.2 Create `gateway/src/services/productManagerResponseValidator.ts`
    - Import `extractJson` from `./plannerResponseValidator`
    - Import `ProductManagerResponse`, `ProductManagerValidationResult` from `../types/chat`
    - Import `logger` from `./logger`
    - Follow the same file structure pattern as `plannerResponseValidator.ts`
  - [x] 3.3 Implement `validateProductManagerResponse(content: string): ProductManagerValidationResult`
    - Step 1: Use `extractJson(content)` to extract JSON string
    - Step 2: `JSON.parse()` the extracted string
    - Step 3: Validate `phase` is `"questions"` or `"ready"`
    - Step 4: Validate `questions` is an array of strings
    - Step 5: Validate `summary` is a string
    - Return `{ valid: true, productManagerResponse: { phase, questions, summary } }` on success
    - Return `{ valid: false, error: "..." }` on any failure
    - Log validation failures with `logger.warn` including content preview (first 200 chars)
  - [x] 3.4 Implement `createFallbackProductManagerResponse(): ProductManagerResponse`
    - Return `{ phase: "questions", questions: [], summary: "" }`
    - This is the safe fallback when all parsing/retry fails
  - [x] 3.5 Export both functions from `gateway/src/services/index.ts`
    - Add new section: `// Product Manager Response Validator (Spec 2026-02-12: Increment 3)`
    - Export: `validateProductManagerResponse`, `createFallbackProductManagerResponse`
  - [x] 3.6 Ensure validator tests pass
    - Run ONLY the 6 tests written in 3.1

**Acceptance Criteria:**
- `validateProductManagerResponse()` correctly validates conforming JSON and rejects malformed input
- `createFallbackProductManagerResponse()` returns a safe default response
- Both functions are exported from `gateway/src/services/index.ts`
- Reuses `extractJson()` from `plannerResponseValidator.ts` (no duplication)
- The 6 tests written in 3.1 pass

---

### Gateway Route Integration

#### Task Group 4: Chat Route -- Mode Branching, Validation, Retry, and Transcript Persistence
**Dependencies:** Task Groups 1, 2, 3 (ALL COMPLETE)

- [x] 4.0 Complete chat route integration for product_manager mode
  - [x] 4.1 Write 7 focused tests for chat route integration
    - Test `shouldBypassToolExecution()` returns `true` for `product_manager` mode
    - Test `shouldAppendToTranscript()` returns `true` for `product_manager` mode
    - Test `shouldValidateProductManagerResponse()` returns `true` for `product_manager` mode
    - Test `shouldValidateProductManagerResponse()` returns `false` for `implement_feature` mode (non-regression)
    - Test that valid product_manager response sets `chatResponse.productManagerResponse` and uses `summary` as `assistant.message`
    - Test that validation failure triggers corrective prompt retry (mock OpenAI client)
    - Test that `flushTranscriptToDisk()` calls `writeTranscriptToFile()` with `kind="product"` and `featureTitle="Product"` for `product_manager` mode
  - [x] 4.2 Extend `shouldBypassToolExecution()` for product_manager
    - File: `gateway/src/routes/chat.ts` (line 108)
    - Change from: `return context?.mode === 'implement_feature';`
    - Change to: `return context?.mode === 'implement_feature' || context?.mode === 'product_manager';`
  - [x] 4.3 Extend `shouldAppendToTranscript()` for product_manager
    - File: `gateway/src/routes/chat.ts` (line 121)
    - Change from: `return context?.mode === 'implement_feature';`
    - Change to: `return context?.mode === 'implement_feature' || context?.mode === 'product_manager';`
  - [x] 4.4 Add `shouldValidateProductManagerResponse()` helper function
    - File: `gateway/src/routes/chat.ts`
    - Add after `shouldValidateImplementerResponse()` (~line 168)
    - Returns `true` when `context?.mode === 'product_manager'`
    - Returns `false` for all other modes
  - [x] 4.5 Enable JSON mode for product_manager requests
    - In the main chat route handler, where `ChatRequestOptions` is constructed
    - Add condition: when `shouldValidateProductManagerResponse(context)` is true, set `{ jsonMode: true }`
    - Follow the same pattern used for planner phases (search for existing `jsonMode: true` usage)
  - [x] 4.6 Add product_manager validation and retry block
    - File: `gateway/src/routes/chat.ts`, after the existing planner/implementer validation blocks
    - Pattern: replicate the corrective-prompt + single-retry flow from the planner validation block (~lines 656-765)
    - On initial response: call `validateProductManagerResponse(assistantContent)`
    - On validation success: set `chatResponse.productManagerResponse = validationResult.productManagerResponse`, set `chatResponse.assistant.message = validationResult.productManagerResponse.summary`
    - On validation failure: send corrective prompt ("Your previous response was not valid JSON matching the required schema. Please respond with ONLY valid JSON: { phase, questions, summary }"), retry once with `sendChatRequest()` and `{ jsonMode: true }`
    - On retry success: use retried response
    - On retry failure or fallback: set `chatResponse.productManagerResponse = createFallbackProductManagerResponse()`, set `chatResponse.assistant.message` to safe fallback message
  - [x] 4.7 Extend `flushTranscriptToDisk()` for product_manager mode
    - File: `gateway/src/routes/chat.ts` (line 195, inside `flushTranscriptToDisk()`)
    - Currently returns early if `context?.mode !== 'implement_feature'`
    - Change to: return early if mode is neither `'implement_feature'` nor `'product_manager'`
    - For `product_manager` mode: use `context.filename` (projectId) as the `featureId` parameter, use constant `"Product"` as the `featureTitle` parameter, pass `"product"` as the `kind` parameter
    - For `implement_feature` mode: keep existing behavior with `"implement"` kind
  - [x] 4.8 Import new functions in chat route
    - Add imports for `validateProductManagerResponse`, `createFallbackProductManagerResponse` from `'../services'`
    - Add import for `ProductManagerResponse` from `'../types'` if needed for type annotations
  - [x] 4.9 Ensure chat route integration tests pass
    - Run ONLY the 7 tests written in 4.1
    - Verify no regressions to implement_feature or oas_assistant flows

**Acceptance Criteria:**
- `product_manager` mode bypasses tool execution (tool-less)
- `product_manager` mode uses OpenAI JSON mode
- Validation with retry is applied to product_manager responses
- On success, `productManagerResponse` is set on `ChatResponse` and `summary` is used as `assistant.message`
- Transcript is flushed with `kind="product"`, `featureId=projectId`, `featureTitle="Product"`
- `implement_feature` and `oas_assistant` modes are unaffected
- The 7 tests written in 4.1 pass

---

### Frontend API Types

#### Task Group 5: Frontend ChatApi Type Updates
**Dependencies:** Task Group 1 (COMPLETE)

- [x] 5.0 Complete frontend API type updates
  - [x] 5.1 Write 2 focused tests for frontend type definitions
    - Test that `ProductManagerResponse` can be constructed with valid phase, questions, and summary
    - Test that `ChatResponse` type allows optional `productManagerResponse` field
  - [x] 5.2 Define `ProductManagerResponse` interface in frontend
    - File: `frontend/src/api/chatApi.ts`
    - Add after the `ImplementerResponse` interface (~line 481)
    - Fields: `phase: "questions" | "ready"`, `questions: string[]`, `summary: string`
    - Include JSDoc referencing this spec
  - [x] 5.3 Add `productManagerResponse` to frontend `ChatResponse`
    - File: `frontend/src/api/chatApi.ts` (inside `ChatResponse` interface, ~line 501)
    - Add: `productManagerResponse?: ProductManagerResponse`
    - Include JSDoc referencing this spec
  - [x] 5.4 Ensure frontend type tests pass
    - Run ONLY the 2 tests written in 5.1
    - Verify TypeScript compilation with `npx tsc --noEmit` in the frontend directory

**Acceptance Criteria:**
- `ProductManagerResponse` interface exists in `frontend/src/api/chatApi.ts`
- `ChatResponse` includes optional `productManagerResponse` field
- Types align with gateway contract (same field names and types)
- The 2 tests written in 5.1 pass
- Frontend compiles with `npx tsc --noEmit`

---

### Frontend Component

#### Task Group 6: ProductManagerChatPanel Component and ProductPage Integration
**Dependencies:** Task Groups 4, 5 (ALL COMPLETE)

- [x] 6.0 Complete the ProductManagerChatPanel and ProductPage integration
  - [x] 6.1 Write 6 focused tests for the chat panel component
    - Test that component renders loading state during conversation rehydration
    - Test that component auto-sends bootstrap message when no existing conversation is found
    - Test that user can type a message and submit it (input + send button interaction)
    - Test that assistant response with `phase="questions"` renders the questions list
    - Test that assistant response with `phase="ready"` renders the confirmation message without auto-triggering anything
    - Test that error state displays an error banner when API call fails
  - [x] 6.2 Create `ProductManagerChatPanel.module.css`
    - File: `frontend/src/components/ProductView/ProductManagerChatPanel.module.css`
    - Follow the design system from `ProductPage.module.css` (colors: #1976D2, #333, #888; border-radius: 6px; font-sizes: 12-13px)
    - Styles for: `.chatContainer`, `.messageList`, `.messageBubble`, `.userMessage`, `.assistantMessage`, `.questionsList`, `.questionItem`, `.inputRow`, `.chatInput`, `.sendButton`, `.loadingIndicator`, `.errorBanner`, `.readyBanner`
    - Message list should be scrollable with `overflow-y: auto` and `flex: 1`
    - Use similar patterns to chat rendering in `ImplementationAssistantPanel.tsx`
  - [x] 6.3 Create `ProductManagerChatPanel.tsx` component
    - File: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`
    - Props: `projectId: string`, `projectParentFolder: string`
    - State: `messages: ChatMessage[]`, `sessionId: string | null`, `loading: boolean`, `error: string | null`, `inputDraft: string`, `isBootstrapped: boolean`
    - Import `ChatMessage`, `postChatMessage`, `getImplementConversation`, `convertMessageEntryToChatMessage`, `ProductManagerResponse` from `../../api/chatApi`
  - [x] 6.4 Implement conversation rehydration on mount
    - In a `useEffect` that depends on `[projectId, projectParentFolder]`
    - Call `getImplementConversation(projectId, projectId, projectParentFolder, "Product", "product")`
    - If `response.exists` and `response.messages.length > 0`: populate messages via `convertMessageEntryToChatMessage()`, set `isBootstrapped = true`
    - If no conversation exists: auto-send bootstrap message (sub-task 6.5)
    - Handle errors: set `error` state, log to console
    - Include cleanup with `cancelled` flag pattern (same as ProductPage useEffect at line 44)
  - [x] 6.5 Implement auto-bootstrap message
    - If `!isBootstrapped` and no rehydrated conversation: auto-send "Help me create a MISSION.MD for this product." as first user message
    - Append user message to `messages` state
    - Call `postChatMessage()` with context: `{ mode: "product_manager", filename: projectId, projectParentFolder, featureId: projectId, featureTitle: "Product" }`
    - Append assistant response to `messages`, update `sessionId`, set `isBootstrapped = true`
    - Handle errors: set `error` state
  - [x] 6.6 Implement user send message handler
    - On form submit or send button click:
    - Guard: return early if `inputDraft.trim() === ''` or `loading`
    - Append user message to `messages`, clear `inputDraft`, set `loading = true`
    - Build chat context: `{ mode: "product_manager", filename: projectId, projectParentFolder, featureId: projectId, featureTitle: "Product" }`
    - Call `postChatMessage({ sessionId, message: inputDraft.trim(), context })`
    - On success: append assistant `ChatMessage` to `messages`, update `sessionId` from response, set `loading = false`
    - On error: set `error` state, set `loading = false`
  - [x] 6.7 Implement phase-based rendering
    - Parse the last assistant message's `productManagerResponse` from the API response
    - Store the latest `productManagerResponse` in component state or derive from the last response
    - When `phase === "questions"`: render questions as a styled list below the message bubble
    - When `phase === "ready"`: render the summary/confirmation message with a distinct "ready" banner style
    - Do NOT auto-trigger any action on "ready" phase
  - [x] 6.8 Implement loading spinner and error banner
    - Loading: show a spinner or "Thinking..." indicator below the message list while `loading === true`
    - Error: show a dismissible error banner at the top of the chat container when `error !== null`
    - Follow the same visual patterns as `ProductPage.module.css` `.errorState` and `.loadingState`
  - [x] 6.9 Replace ProductPage placeholder with ProductManagerChatPanel
    - File: `frontend/src/components/ProductView/ProductPage.tsx`
    - Remove the placeholder div at lines 142-148 (`data-testid="product-manager-placeholder"`)
    - Import `ProductManagerChatPanel` from `./ProductManagerChatPanel`
    - Add: `{projectId && activeProject?.projectParentFolder && (<ProductManagerChatPanel projectId={projectId} projectParentFolder={activeProject.projectParentFolder} />)}`
    - Keep the Product Name form card above the chat panel
    - The chat panel should fill the remaining vertical space below the form card
  - [x] 6.10 Ensure component tests pass
    - Run ONLY the 6 tests written in 6.1
    - Verify the component renders correctly in all states (loading, questions, ready, error)

**Acceptance Criteria:**
- `ProductManagerChatPanel.tsx` exists as a self-contained component
- Conversation is rehydrated from disk on mount via `getImplementConversation()` with `kind="product"`
- Auto-bootstrap sends first message when no existing conversation is found
- User can type and submit messages
- Questions are rendered as a list when `phase === "questions"`
- Ready state shows confirmation message without auto-triggering
- Loading and error states display correctly
- ProductPage placeholder is replaced with working chat panel
- Chat panel only renders when `projectId` and `projectParentFolder` are available
- The 6 tests written in 6.1 pass

---

### Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6 (ALL COMPLETE)

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 3 tests written in Task 1.1 (gateway types)
    - Review the 4 tests written in Task 2.1 (system prompt)
    - Review the 6 tests written in Task 3.1 (response validator)
    - Review the 7 tests written in Task 4.1 (chat route integration)
    - Review the 2 tests written in Task 5.1 (frontend types)
    - Review the 6 tests written in Task 6.1 (frontend component)
    - Total existing tests: 28 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize: full chat round-trip (user message -> product_manager response -> transcript persistence), conversation rehydration flow, non-regression of implement_feature mode
  - [x] 7.3 Write up to 6 additional strategic tests maximum
    - End-to-end: full product_manager chat round-trip with mocked OpenAI returning valid JSON
    - End-to-end: conversation rehydration loads previously persisted product conversation
    - Non-regression: `implement_feature` mode still works unchanged after product_manager additions
    - Non-regression: `oas_assistant` mode still works unchanged
    - Edge case: product_manager mode with missing `projectParentFolder` skips transcript persistence with warning
    - Edge case: bootstrap message triggers correctly when `getImplementConversation()` returns `{ exists: false }`
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3)
    - Expected total: approximately 34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34 tests total)
- Critical user workflows for this feature are covered (chat round-trip, rehydration, phase rendering)
- No more than 6 additional tests added when filling in testing gaps
- Non-regression verified for `implement_feature` and `oas_assistant` modes
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Types** (no dependencies) -- Define `ProductManagerResponse`, `ProductManagerValidationResult`, extend `ChatMode` and `ChatResponse`
2. **Task Group 2: System Prompt** (depends on TG1) -- Create the PM persona prompt template and wire into `buildSystemPrompt()`
3. **Task Group 3: Response Validator** (depends on TG1) -- Create `productManagerResponseValidator.ts` with validation and fallback
4. **Task Group 4: Chat Route Integration** (depends on TG1, TG2, TG3) -- Wire mode branching, validation+retry, JSON mode, and transcript persistence into `chat.ts`
5. **Task Group 5: Frontend API Types** (depends on TG1 for contract alignment) -- Add `ProductManagerResponse` to frontend `chatApi.ts`
6. **Task Group 6: Frontend Component** (depends on TG4, TG5) -- Build `ProductManagerChatPanel.tsx` and replace ProductPage placeholder
7. **Task Group 7: Test Review** (depends on TG1-TG6) -- Review all tests, fill critical gaps, run full feature test suite

**Note:** Task Groups 2 and 3 can be implemented in parallel since they both depend only on Task Group 1 and are independent of each other. Task Group 5 can also be started in parallel with Task Groups 2-4 since it only needs the type contract from Task Group 1.

---

## Key File Reference

| File | Action | Task Group |
|------|--------|------------|
| `gateway/src/types/chat.ts` | Modify: add ChatMode value, new interfaces, extend ChatResponse | TG1 |
| `gateway/src/types/index.ts` | Modify: export new types | TG1 |
| `gateway/src/services/promptBuilder.ts` | Modify: add PM prompt template and buildSystemPrompt branch | TG2 |
| `gateway/src/services/productManagerResponseValidator.ts` | **Create**: new file with validator and fallback | TG3 |
| `gateway/src/services/index.ts` | Modify: export new validator functions | TG3 |
| `gateway/src/routes/chat.ts` | Modify: extend 4 helper functions, add validation block | TG4 |
| `frontend/src/api/chatApi.ts` | Modify: add ProductManagerResponse, extend ChatResponse | TG5 |
| `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` | **Create**: new component | TG6 |
| `frontend/src/components/ProductView/ProductManagerChatPanel.module.css` | **Create**: new stylesheet | TG6 |
| `frontend/src/components/ProductView/ProductPage.tsx` | Modify: replace placeholder with chat panel | TG6 |
