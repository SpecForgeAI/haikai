# Specification: Increment 3 -- Introduce Product Manager Chat Mode (Tool-less LLM Persona)

## Goal
Introduce a new "product_manager" chat mode in the gateway that conducts structured product discovery via a Senior Product Manager persona, with structured JSON responses, validation with retry, and transcript persistence under kind="product" -- paired with a new lightweight frontend chat panel on the ProductPage that replaces the placeholder card.

## User Stories
- As a product owner, I want to have a structured PM discovery conversation on the Product tab so that I can define my product mission through guided questions before any mission file is generated.
- As a product owner, I want my PM conversation to be persisted and rehydrated so that I can navigate away and return without losing progress.

## Specific Requirements

**Add "product_manager" to ChatMode union and bypass tool execution**
- Add `'product_manager'` to the `ChatMode` type union in `gateway/src/types/chat.ts` (currently `'oas_assistant' | 'implement_feature'`, becomes a three-value union)
- Update `shouldBypassToolExecution()` in `gateway/src/routes/chat.ts` to return `true` for `product_manager` mode (tool-less, same pattern as `implement_feature`)
- No MCP tool definitions or tool calls are permitted in this mode

**Build the Product Manager system prompt**
- Create a new system prompt template constant (e.g., `PRODUCT_MANAGER_PROMPT_TEMPLATE`) in `gateway/src/services/promptBuilder.ts`
- Persona: "Senior Product Manager" conducting structured product discovery
- The prompt must instruct the LLM to: determine new vs. existing product, ask for existing documentation first, gather minimum required information (project name confirmation, new vs. existing, documentation availability, core problem, target audience, desired outcome, success criteria, constraints, scope boundaries, delivery expectations)
- Instruct concise high-signal questions, soft cap of ~10 total question rounds, and internal sufficiency tracking
- When sufficient, switch phase to "ready" and ask: "I now have enough information to generate the MISSION.MD. Would you like me to proceed?"
- The prompt must enforce JSON-only output: no markdown, no prose outside the JSON structure, no `missionMarkdown` field
- Add a new branch in `buildSystemPrompt()` for `context?.mode === 'product_manager'` that returns this prompt, placed before the `implement_feature` branch

**Structured JSON response contract and new response type**
- Define a new interface `ProductManagerResponse` in `gateway/src/types/chat.ts`: `{ phase: "questions" | "ready", questions: string[], summary: string }`
- Add a corresponding `ProductManagerValidationResult` interface: `{ valid: boolean, productManagerResponse?: ProductManagerResponse, error?: string }`
- Add an optional `productManagerResponse` field to the `ChatResponse` interface, following the same pattern as `plannerResponse` and `implementerResponse`
- Export all new types from `gateway/src/types/index.ts`

**Create productManagerResponseValidator.ts**
- Create `gateway/src/services/productManagerResponseValidator.ts` following the `plannerResponseValidator.ts` pattern
- Implement `validateProductManagerResponse(content: string): ProductManagerValidationResult` -- parse JSON, validate `phase` is one of `"questions" | "ready"`, validate `questions` is a string array, validate `summary` is a string
- Implement `createFallbackProductManagerResponse(): ProductManagerResponse` returning `{ phase: "questions", questions: [], summary: "" }` with a safe fallback
- Reuse the existing `extractJson()` function from `plannerResponseValidator.ts` for robust JSON extraction
- Export both functions from `gateway/src/services/index.ts`

**Integrate validation and retry in chat route for product_manager mode**
- In `gateway/src/routes/chat.ts`, add a new helper `shouldValidateProductManagerResponse(context)` that returns `true` when `context?.mode === 'product_manager'`
- Use OpenAI JSON mode (`{ jsonMode: true }`) for product_manager requests, following the same pattern as planner phases
- After the initial OpenAI response, validate with `validateProductManagerResponse()`
- On validation failure, send a corrective prompt and retry once (same corrective-prompt + single-retry pattern as planner validation in the chat route)
- On success, set `chatResponse.productManagerResponse` and use the parsed `summary` as `chatResponse.assistant.message`
- On fallback, set `chatResponse.assistant.message` to the safe fallback message

**Extend transcript persistence for product_manager mode**
- Update `shouldAppendToTranscript()` in `gateway/src/routes/chat.ts` to also return `true` for `product_manager` mode
- Update `flushTranscriptToDisk()` to also handle `product_manager` mode: use `projectId` (from `context.filename`) as the `featureId` parameter, use constant string `"Product"` as the `featureTitle` parameter, and pass `"product"` as the `kind` parameter
- This produces the folder path: `<projectParentFolder>/conversations/product/<derived-folder-name>/`
- `context.projectParentFolder` is required for persistence (same skip-with-warning pattern when missing)
- `context.featureId` for product_manager mode should be populated from `context.filename` (the projectId); `context.featureTitle` should be the constant `"Product"`

**Add ProductManagerResponse to frontend chatApi.ts**
- Define `ProductManagerResponse` interface in `frontend/src/api/chatApi.ts`: `{ phase: "questions" | "ready", questions: string[], summary: string }`
- Add optional `productManagerResponse?: ProductManagerResponse` field to the frontend `ChatResponse` interface
- No new API functions are needed; reuse existing `postChatMessage()` and `getImplementConversation()` with `kind="product"`

**Create ProductManagerChatPanel.tsx component**
- Create a new dedicated lightweight component at `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`
- Props: `projectId: string`, `projectParentFolder: string`
- State: `messages: ChatMessage[]`, `sessionId: string | null`, `loading: boolean`, `error: string | null`, `inputDraft: string`, `isBootstrapped: boolean`
- On mount, attempt conversation rehydration via `getImplementConversation(projectId, projectId, projectParentFolder, "Product", "product")` -- if conversation exists, populate messages and set `isBootstrapped = true`
- If no conversation exists, auto-send bootstrap message "Help me create a MISSION.MD for this product." as the first user message (no special phase plumbing; just a regular user message)
- Build chat context as: `{ mode: "product_manager", filename: projectId, projectParentFolder, featureId: projectId, featureTitle: "Product" }`
- On user send: append user message to messages, call `postChatMessage()`, append assistant response, update sessionId
- Phase-based rendering: when `productManagerResponse.phase === "questions"`, render the questions list; when `phase === "ready"`, display the confirmation message but do NOT auto-trigger anything
- Loading spinner during API calls, error banner on failure (consistent with implement chat patterns)
- Style with a new `ProductManagerChatPanel.module.css` following the design system in `ProductPage.module.css`

**Replace ProductPage placeholder with working chat panel**
- In `frontend/src/components/ProductView/ProductPage.tsx`, replace the "Product Manager (Coming Soon)" placeholder div with `<ProductManagerChatPanel projectId={projectId} projectParentFolder={activeProject?.projectParentFolder} />`
- Import the new component; conditionally render only when `projectId` and `projectParentFolder` are available
- Keep the Product Name form card above the chat panel

## Visual Design
No visual mockups were provided. The chat panel should follow the existing design system established in `ProductPage.module.css` and use similar patterns to the chat rendering in `ImplementationAssistantPanel.tsx` (message bubbles, input field, send button, loading states).

## Existing Code to Leverage

**`gateway/src/services/plannerResponseValidator.ts` -- JSON validation pattern**
- Contains `extractJson()` for robust JSON extraction from LLM output (tries direct JSON, markdown code blocks, embedded JSON)
- Contains `validatePlannerResponse()` with shape validation, fallback generation, and logging
- Contains `createFallbackPlannerResponse()` for safe fallback when parsing fails
- The new `productManagerResponseValidator.ts` should follow this exact pattern but with the simpler `{ phase, questions, summary }` schema

**`gateway/src/routes/chat.ts` -- Chat route mode branching and retry**
- `shouldBypassToolExecution()`, `shouldAppendToTranscript()`, and `flushTranscriptToDisk()` already branch on mode; extend with `product_manager` conditions
- Planner validation block (lines ~656-765) demonstrates the corrective-prompt + single-retry + fallback pattern that should be replicated for product_manager validation
- JSON mode is already used via `ChatRequestOptions: { jsonMode: true }` for planner phases

**`gateway/src/services/transcriptWriter.ts` -- Transcript persistence with kind**
- `writeTranscriptToFile()` already accepts an optional `kind` parameter and routes to `conversations/<kind>/<folderName>/`
- `deriveFolderName(workItemTitle, featureId)` generates filesystem-safe folder names
- `normalizeKind()` validates kind against the `ALLOWED_KINDS` array (already includes `'product'`)
- No changes needed to transcriptWriter itself; the chat route just needs to call it with the right parameters

**`frontend/src/api/chatApi.ts` -- Rehydration and chat API**
- `getImplementConversation()` already accepts an optional `kind` parameter for conversation type routing
- `postChatMessage()` sends to `/api/chat` and returns `ChatResponse` -- can be called with `product_manager` mode context
- `convertMessageEntryToChatMessage()` converts persisted entries to displayable `ChatMessage` objects
- `ChatMessage`, `DisplayedMessage` interfaces are reusable as-is

**`frontend/src/components/ProductView/ProductPage.tsx` -- Target integration point**
- Currently renders a "Product Manager (Coming Soon)" placeholder card at lines 142-148
- Uses `useProject()` hook to get `activeProject` with `id` and `projectParentFolder`
- The placeholder div should be replaced with the new `ProductManagerChatPanel` component

## Out of Scope
- Any MCP tool definitions or tool calls in product_manager mode
- MISSION.MD file generation or writing (deferred to a future increment)
- Database updates beyond the existing minimal ProductDefinition entity
- Architecture or roadmap automation
- Any changes to `implement_feature` mode or `oas_assistant` mode behavior
- Conversation reset or "start over" button
- Streaming endpoint support for product_manager mode
- Using `productName` in transcript folder naming (use `projectId` only)
- Any `missionMarkdown` field in the response contract or system prompt
- Changes to architecture-model-service or mcp-server
