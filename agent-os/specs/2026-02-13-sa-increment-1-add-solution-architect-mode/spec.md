# Specification: SA Increment 1 -- Add Solution Architect Mode + UI Entry Point (Tool-less, No Saving)

## Goal
Introduce a new `solution_architect` chat mode in the gateway and a corresponding `SolutionArchitectChatPanel` in the frontend, enabling structured architecture discovery conversations scoped to a Product. This increment is tool-less and does NOT persist any architecture changes -- it only enables the conversation and its transcript.

## User Stories
- As a product team member, I want to discuss high-level architecture with a Solution Architect persona so that I can iteratively discover and clarify the architectural shape of my product before any formal artifacts are created.
- As a product team member, I want to switch between the Product Manager and Solution Architect panels within the Product screen so that I can manage both product definition and architecture discovery from the same location.

## Specific Requirements

**Add `solution_architect` to the ChatMode union type**
- In `gateway/src/types/chat.ts`, extend the `ChatMode` union on line 76 to include `'solution_architect'` as a fourth literal value
- In `gateway/src/types/chat.ts`, add a new `SolutionArchitectResponse` interface with fields: `phase` (`"questions"` | `"ready"`), `section` (enumerated string), `questions` (`string[]`), `summary` (`string`), `assumptions` (`string[]`), `openItems` (`string[]`)
- The `section` field must be one of 7 enumerated values: `"context_and_boundaries"`, `"ui_and_channels"`, `"integrations"`, `"data_model"`, `"service_decomposition"`, `"business_logic"`, `"non_functional_requirements"`
- Add a `SolutionArchitectValidationResult` interface following the same pattern as `ProductManagerValidationResult` (valid, solutionArchitectResponse, error)
- Add a `solutionArchitectResponse` optional field to the `ChatResponse` interface, parallel to `productManagerResponse`

**Create the Solution Architect system prompt template**
- Add a new `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` constant in `gateway/src/services/promptBuilder.ts`, following the structural pattern of `PRODUCT_MANAGER_PROMPT_TEMPLATE` (persona, question strategy, sufficiency tracking, response format, rules)
- Persona: "Senior Solution Architect conducting structured architecture discovery"
- Question sections should progress through the 7 enumerated sections in a logical order (context_and_boundaries first, non_functional_requirements last)
- The prompt must instruct the LLM to allow user responses of "I don't know", "Skip this", or "Not decided yet" and map those to the `openItems` array
- The prompt must instruct the LLM to always create at least one "Core Application Service" if the user cannot define service boundaries
- When enough information is gathered, the LLM transitions to `phase="ready"` with an empty questions array
- JSON enforcement is prompt-only (no `response_format: { type: 'json_object' }`), consistent with PM mode
- The response format block in the prompt must describe the full 6-field JSON schema (phase, section, questions, summary, assumptions, openItems)

**Add `solution_architect` mode routing in `buildSystemPrompt`**
- In the `buildSystemPrompt()` function in `promptBuilder.ts` (around line 1250), add a new check for `context?.mode === 'solution_architect'` that returns `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`
- Place this check adjacent to the existing `product_manager` check (before the `implement_feature` block)

**Create the Solution Architect response validator**
- Create a new file `gateway/src/services/solutionArchitectResponseValidator.ts` following the structure of `productManagerResponseValidator.ts`
- Implement `validateSolutionArchitectResponse(content: string)` that: extracts JSON via `extractJson()` from `plannerResponseValidator.ts`, parses JSON, validates `phase` is one of `"questions"` or `"ready"`, validates `section` is one of the 7 enumerated values (use a `ReadonlySet<string>` constant), validates `questions` is `string[]`, validates `summary` is a non-empty string, validates `assumptions` is `string[]`, validates `openItems` is `string[]`, and validates that `questions` is non-empty when `phase="questions"`
- Implement `createFallbackSolutionArchitectResponse()` returning safe defaults: `phase: "questions"`, `section: "context_and_boundaries"`, `questions: []`, `summary: ""`, `assumptions: []`, `openItems: []`
- Export both functions from `gateway/src/services/index.ts`

**Wire validation with corrective retry in the chat route handler**
- In `gateway/src/routes/chat.ts`, add a new validation block for `solution_architect` mode, positioned alongside the existing implementer and planner validation blocks (around lines 628-744)
- First attempt: call `validateSolutionArchitectResponse(response.content)`. If valid, attach `solutionArchitectResponse` to `chatResponse` and use `summary` as `assistant.message`
- If first validation fails: append a corrective instruction message to the messages array (e.g., "Your last response was not valid JSON. Return ONLY a single JSON object matching the required schema; no markdown or extra text."), resend once via `sendChatRequest`, then validate again
- If second validation also fails: use the fallback from `createFallbackSolutionArchitectResponse()` and set `chatResponse.error` with the validation error message
- This corrective-retry pattern is new to the codebase (existing validators validate once and fallback); implement it as a self-contained block that can later be generalized

**Add `solution_architect` to transcript ALLOWED_KINDS**
- In `gateway/src/services/transcriptWriter.ts` line 39, add `'solution_architect'` to the `ALLOWED_KINDS` array
- Transcripts will persist under path `<projectParentFolder>/conversations/solution_architect/<folderName>/` using `featureId=projectId` and `featureTitle="Solution Architect"`

**Create the SolutionArchitectChatPanel frontend component**
- Create `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` mirroring the full structure of `ProductManagerChatPanel.tsx`
- Props: `projectId`, `projectParentFolder`, `productName` (identical signature to PM panel)
- Build chat context with `mode: 'solution_architect'`, `featureId: projectId`, `featureTitle: 'Solution Architect'` (PM uses `featureTitle: 'Product'`)
- Bootstrap message: `"Help me define the high-level architecture for ${productName}."` (PM uses `"Help me create a MISSION.MD for the ${productName} product."`)
- Message ID prefix: `"sa-msg-"` (PM uses `"pm-msg-"`)
- Persona label for assistant messages: `"Solution Architect"` (PM uses `"Product Manager"`)
- Rehydrate conversation on mount via `getImplementConversation` with `kind='solution_architect'` (PM uses `kind='product'`)
- Store structured responses in a `Map<string, SolutionArchitectResponse>` keyed by message ID, same pattern as PM's `pmResponses` map
- Render questions as `<ul>` items when `phase="questions"` (same as PM)
- Render a section label indicating the current discovery section (e.g., a small styled badge or label showing "Context & Boundaries", "Integrations", etc.)
- Render `assumptions` list when non-empty, styled distinctly from questions
- Render `openItems` list when non-empty, styled to indicate deferred/unresolved items
- Render a ready banner when `phase="ready"` with text like "Architecture baseline is ready. Save functionality coming in a future increment." (no save action wired)
- Include Upload Documents support by reusing the `UploadDocumentsModal` component as-is, with the same `handleSendWithSources` pattern as PM
- During rehydration, parse assistant message content as JSON to extract `SolutionArchitectResponse` fields (same pattern as PM rehydration)

**Create the SolutionArchitectChatPanel CSS module**
- Create `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css` replicating the styling patterns from `ProductManagerChatPanel.module.css`
- Add additional styles for: section label (small colored badge), assumptions list (visually distinct from questions list, e.g., amber/neutral tones), openItems list (visually distinct, e.g., muted/grey tones to indicate deferred items)
- The ready banner should follow the same green pattern as PM's `.readyBanner` but with adjusted text

**Add sub-tab layout to ProductPage**
- Modify `ProductPage.tsx` to add a sub-tab bar with two tabs: "Product Manager" and "Discuss Architecture"
- Use `useState` local state to track the active tab (default: "Product Manager")
- When "Product Manager" is active, render `ProductManagerChatPanel` (preserving current behavior)
- When "Discuss Architecture" is active, render `SolutionArchitectChatPanel`
- Both panels receive the same props (`projectId`, `projectParentFolder`, `productName`)
- Conditionally render only the active panel (do NOT render the inactive panel as hidden) to avoid duplicate bootstrap messages on mount
- Add sub-tab bar styles to `ProductPage.module.css` following the existing design system (colors: `#1976D2` primary, `#333` text; border-radius: `6px`; font-sizes: `12-13px`)

**Add frontend types for SolutionArchitectResponse**
- In `frontend/src/api/chatApi.ts`, add a `SolutionArchitectResponse` interface mirroring the gateway type (phase, section, questions, summary, assumptions, openItems)
- Add a `solutionArchitectResponse` optional field to the frontend `ChatResponse` interface

## Visual Design
No visual mockups were provided for this spec. The SA panel should visually mirror the existing ProductManagerChatPanel with the following differences: a section label badge for the current discovery section, dedicated assumption and open-items list styling, and the "Solution Architect" persona label instead of "Product Manager".

## Existing Code to Leverage

**ProductManagerChatPanel.tsx (`frontend/src/components/ProductView/ProductManagerChatPanel.tsx`)**
- Full component structure to replicate: state management (`messages`, `sessionId`, `loading`, `error`, `inputDraft`, `isBootstrapped`, structured response map), conversation rehydration on mount via `getImplementConversation`, auto-bootstrap message send, `handleSend` / `handleFormSubmit` / `handleKeyDown` / `handleSendWithSources` handlers, phase-based rendering (questions list, ready banner), Upload Documents integration via `UploadDocumentsModal`
- The SA panel should be a near-copy with swapped mode, kind, featureTitle, bootstrap message, persona label, message ID prefix, and additional rendering for section/assumptions/openItems

**productManagerResponseValidator.ts (`gateway/src/services/productManagerResponseValidator.ts`)**
- Structural pattern to replicate for the SA validator: import `extractJson` from `plannerResponseValidator`, define `VALID_PHASES` as `ReadonlySet<string>`, implement `validate` function (extract JSON, parse, validate each field, return typed result), implement `createFallback` function, implement `logValidationFailure` helper
- SA validator extends this with additional field validations for `section` (enumerated set), `assumptions` (string array), and `openItems` (string array)

**PRODUCT_MANAGER_PROMPT_TEMPLATE (`gateway/src/services/promptBuilder.ts`, line 287)**
- Template structure to replicate for SA prompt: role description, minimum required information sections, question strategy with round guidance, sufficiency tracking instructions, response format with JSON schema, rules section
- SA prompt replaces product discovery topics with architecture discovery sections and adjusts the persona, format schema, and rules accordingly

**chat.ts route handler validation blocks (`gateway/src/routes/chat.ts`, lines 628-744)**
- Pattern for wiring validators: check mode/phase condition, call validator, if valid attach structured response to `chatResponse` and use message/summary field for `assistant.message`, if invalid use fallback and set `chatResponse.error`
- The SA block adds the corrective-retry pattern (append instruction, resend once, validate again) which is not present in existing validators

**UploadDocumentsModal (`frontend/src/components/ProductView/UploadDocumentsModal.tsx`)**
- Reused as-is in the SA panel; no modifications needed
- SA panel opens the modal and handles the `onSubmit` callback identically to the PM panel's `handleUploadDocuments` pattern

## Out of Scope
- Any MCP tools or tool execution for the solution_architect mode
- Any architecture meta-model writes, reads, or modifications
- Any diagram creation or generation
- Standards injection into the SA prompt (deferred to a future increment)
- MISSION/TECH-STACK auto-injection into the SA context (deferred to a future increment)
- Conversation reset or "start over" functionality for either PM or SA panels
- Mid-conversation persona switching logic between PM and SA
- Reading existing architecture model data to seed the SA conversation context
- Generating any files or artifacts from the SA conversation
- Wiring the existing PM validation into the chat route handler (separate concern; PM validation functions exist but are not called in chat.ts)
- Introducing `response_format: { type: 'json_object' }` for any mode
- Modifying `shouldBypassToolExecution` or `shouldAppendToTranscript` functions in chat.ts
- Any changes to the mcp-server or architecture-model-service packages
- The actual "save baseline" action when user confirms on the ready phase (deferred to a future increment)
