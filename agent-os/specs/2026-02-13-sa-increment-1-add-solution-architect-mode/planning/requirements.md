# Spec Requirements: SA Increment 1 -- Add Solution Architect Mode + UI Entry Point (Tool-less, No Saving)

## Initial Description
Introduce a new chat persona "solution_architect" that allows high-level architecture discussion based on the existing Product. This increment is tool-less and does NOT persist any architecture changes. It only enables structured architecture discovery conversation.

Key scope:
- New chat mode "solution_architect" in gateway
- Dedicated SolutionArchitectChatPanel in frontend
- UI entry point on Product screen ("Discuss Architecture" button)
- Structured JSON response contract (questions | ready phases)
- Transcript persistence under kind="solution_architect"

Excludes: MCP tools, architecture writes, diagram creation, standards injection, MISSION/TECH-STACK auto-injection.

## Requirements Discussion

### First Round Questions

**Q1:** The existing `product_manager` mode does NOT bypass tool execution (it goes through the normal OAS agent loop) and does NOT use in-route transcript appending. However, the user's requirements explicitly call for `shouldBypassToolExecution = true` and transcript persistence for `solution_architect`. Should the SA mode follow a hybrid pattern where `shouldBypassToolExecution` and `shouldAppendToTranscript` in `gateway/src/routes/chat.ts` (lines 105-119) are updated to return `true` for `solution_architect`, or follow the PM's current approach?
**Answer:** Follow the PM approach (no shouldBypassToolExecution change, use the same session-level persistence pattern); do not introduce a hybrid pattern in this increment.

**Q2:** Currently `sendChatRequest` is called in `chat.ts` WITHOUT `jsonMode: true` for any mode -- even `product_manager` relies solely on the system prompt instruction to emit JSON (not the OpenAI `response_format: { type: 'json_object' }` parameter). Should the SA mode explicitly pass `{ jsonMode: true }` to `sendChatRequest` to get OpenAI's native JSON enforcement?
**Answer:** Stick with prompt-only JSON enforcement like PM; do not introduce response_format jsonMode yet (keep consistency).

**Q3:** The PM validation (`validateProductManagerResponse` / `createFallbackProductManagerResponse`) exists in `productManagerResponseValidator.ts` but is not yet wired into the chat route handler -- there are zero references to these functions in `chat.ts`. Should we implement full validation-and-retry for SA in the route handler, and also wire up the PM validation in the same spec?
**Answer:** Yes -- implement full validation + single retry for SA in the route handler; do NOT retroactively fix PM wiring in this spec (separate concern).

**Q4:** The `transcriptWriter.ts` (line 39) has `ALLOWED_KINDS = ['implement', 'product']`. Should the kind value be exactly `"solution_architect"` (matching the chat mode name), or a shorter alias?
**Answer:** Use the full explicit kind "solution_architect" (match mode name for clarity and future extensibility).

**Q5:** The current `ProductPage.tsx` renders ONLY the `ProductManagerChatPanel` (full-page). Which layout approach for adding the "Discuss Architecture" entry point?
- Option A (Tab/Split): Sub-tab bar within ProductPage toggling between PM and SA chat panels.
- Option B (Button + Modal/Slide-over): Button that opens SA panel replacing or overlaying PM panel.
- Option C (Sibling Tab): New top-level tab in ProductView.tsx tab bar.
**Answer:** Option A -- sub-tab toggle inside ProductPage between Product Manager and Solution Architect panels (cleanest separation, no new top-level tab).

**Q6:** The proposed SA JSON response is `{ phase, section, questions, summary, assumptions, openItems }`. Should the `section` field be an enumerated set or free-form? What are `openItems` and `assumptions`?
**Answer:** `section` should be an enumerated set of known section names. `openItems` is a string[] capturing deferred or unresolved decisions. `assumptions` is a string[] of assumptions the SA has made.

**Q7:** The PM panel auto-sends a bootstrap message including the product name. Should the SA bootstrap include the product name as well?
**Answer:** Yes -- include productName in the bootstrap message (e.g., "Help me define the high-level architecture for ${productName}.").

**Q8:** Acceptance criteria says "SA asks confirmation to save baseline." Since this increment does NOT persist architecture data, does this mean the SA shows a phase="ready" confirmation message but no save action is wired?
**Answer:** Correct -- SA shows phase="ready" and confirmation message only; no save action wired in this increment.

**Q9:** Is there anything explicitly out of scope not yet captured?
**Answer:** Reset/start-over, mid-conversation persona switching logic, reading existing architecture model data, generating files/artifacts, diagram creation, or any persistence of meta-model data.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ProductManagerChatPanel - Path: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`
  - Closest frontend component pattern; SA panel should mirror its structure (state management, rehydration, bootstrap, send handler, phase-based rendering, Upload Documents support)
- Feature: ProductManagerChatPanel CSS - Path: `frontend/src/components/ProductView/ProductManagerChatPanel.module.css`
  - CSS module styling pattern to replicate for SA panel
- Feature: ProductPage - Path: `frontend/src/components/ProductView/ProductPage.tsx`
  - Currently renders only PM panel; needs sub-tab bar added for PM vs SA toggle
- Feature: ProductPage CSS - Path: `frontend/src/components/ProductView/ProductPage.module.css`
  - Will need sub-tab bar styles added
- Feature: productManagerResponseValidator - Path: `gateway/src/services/productManagerResponseValidator.ts`
  - Closest validation pattern; SA validator should follow the same structure (extractJson, field validation, fallback creation) but with the richer SA response schema
- Feature: PRODUCT_MANAGER_PROMPT_TEMPLATE - Path: `gateway/src/services/promptBuilder.ts` (line 287)
  - Closest prompt pattern; SA prompt should follow the same structure (persona, question strategy, sufficiency tracking, response format, rules) but with SA-specific sections
- Feature: ChatMode type - Path: `gateway/src/types/chat.ts` (line 76)
  - Must add `'solution_architect'` to the union type
- Feature: ChatResponse type - Path: `gateway/src/types/chat.ts` (line 728)
  - Must add `solutionArchitectResponse` field parallel to `productManagerResponse`
- Feature: transcriptWriter ALLOWED_KINDS - Path: `gateway/src/services/transcriptWriter.ts` (line 39)
  - Must add `'solution_architect'` to the ALLOWED_KINDS array
- Feature: services/index.ts exports - Path: `gateway/src/services/index.ts`
  - Must export new SA validator functions
- Feature: chat route handler - Path: `gateway/src/routes/chat.ts`
  - Validation + retry logic to be added for SA mode (lines ~628-744 show existing planner/implementer validation patterns)
- Feature: openaiClient sendChatRequest - Path: `gateway/src/services/openaiClient.ts` (line 140)
  - Understands `jsonMode` option but SA will NOT use it (prompt-only enforcement per user decision)
- Feature: chatApi frontend - Path: `frontend/src/api/chatApi.ts`
  - `postChatMessage`, `getImplementConversation`, `convertMessageEntryToChatMessage` -- all reused by SA panel
- Feature: UploadDocumentsModal - Path: `frontend/src/components/ProductView/UploadDocumentsModal.tsx`
  - Reused by SA panel for document upload support
- Feature: buildSystemPrompt - Path: `gateway/src/services/promptBuilder.ts` (line ~1250)
  - Must add `'solution_architect'` mode routing branch (before or after `product_manager` check)

### Follow-up Questions

**Follow-up 1:** For the validation + single retry pattern, should the retry resend the exact same messages array, or append a corrective instruction message before resending?
**Answer:** Corrective retry. Append a short corrective system/developer-style instruction (not user-visible) like: "Your last response was not valid JSON. Return ONLY a single JSON object matching the required schema; no markdown or extra text." Then resend once; if it still fails, fall back to the safe fallback response.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
No visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Gateway -- New chat mode:**
- Add `"solution_architect"` to the `ChatMode` union type in `gateway/src/types/chat.ts`
- Chat mode name: `"solution_architect"`
- Tool-less behavior: follows the PM pattern (no changes to `shouldBypassToolExecution`; the normal agent loop runs but the system prompt instructs no tool calls)
- JSON enforcement: prompt-only (no `response_format: { type: 'json_object' }`), consistent with PM mode
- System prompt persona: "Senior Solution Architect"

**Gateway -- System prompt:**
- New `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` constant in `promptBuilder.ts`
- Persona: Senior Solution Architect conducting structured architecture discovery
- Question sections (enumerated): context_and_boundaries, ui_and_channels, integrations, data_model, service_decomposition, business_logic, non_functional_requirements
- Must allow user to say "I don't know", "Skip this", "Not decided yet" (these map to openItems)
- Must always create at least one "Core Application Service" if user cannot define service boundaries
- When enough info gathered, transition to phase="ready"
- New mode routing branch in `buildSystemPrompt()` for `context?.mode === 'solution_architect'`

**Gateway -- Structured JSON response contract:**
- New `SolutionArchitectResponse` interface in `gateway/src/types/chat.ts`:
  - `phase`: `"questions"` | `"ready"`
  - `section`: enumerated string -- one of: `"context_and_boundaries"` | `"ui_and_channels"` | `"integrations"` | `"data_model"` | `"service_decomposition"` | `"business_logic"` | `"non_functional_requirements"`
  - `questions`: `string[]` -- discovery questions for the user (empty when phase is "ready")
  - `summary`: `string` -- conversational summary text for the chat bubble
  - `assumptions`: `string[]` -- assumptions the SA has made based on user's answers
  - `openItems`: `string[]` -- deferred or unresolved decisions (user said skip/don't know)
- New `SolutionArchitectValidationResult` interface (follows PM/Planner pattern)
- New `solutionArchitectResponse` field on `ChatResponse`

**Gateway -- Validation + corrective retry:**
- New `solutionArchitectResponseValidator.ts` service file following the `productManagerResponseValidator.ts` pattern
- `validateSolutionArchitectResponse(content: string)` function
- `createFallbackSolutionArchitectResponse()` function
- Validation rules: valid JSON, phase is "questions" or "ready", section is one of the enumerated values, questions is string[], summary is string (always present), assumptions is string[], openItems is string[]
- Additional rules: no markdown outside JSON, no tool calls, summary always present, questions non-empty when phase="questions"
- Wired in `chat.ts` route handler with corrective retry: if first validation fails, append a corrective instruction message ("Your last response was not valid JSON. Return ONLY a single JSON object matching the required schema; no markdown or extra text."), resend once, validate again; if still invalid, use fallback
- This is a NEW pattern in the route handler (existing planner/implementer validators do not retry)

**Gateway -- Transcript persistence:**
- Add `'solution_architect'` to `ALLOWED_KINDS` array in `transcriptWriter.ts` (line 39)
- Transcript persisted under `kind="solution_architect"` with deterministic folder naming (featureId=projectId, featureTitle="Solution Architect")
- Path structure: `<projectParentFolder>/conversations/solution_architect/<folderName>/`
- Follows the same session-level persistence pattern as PM (via `getImplementConversation` / `putImplementConversation` with `kind` parameter)

**Frontend -- SolutionArchitectChatPanel:**
- New `SolutionArchitectChatPanel.tsx` component mirroring `ProductManagerChatPanel.tsx`
- Props: `projectId`, `projectParentFolder`, `productName` (same as PM panel)
- Builds chat context with `mode: 'solution_architect'`, `featureId: projectId`, `featureTitle: 'Solution Architect'`
- Calls `/api/chat` via `postChatMessage` with mode `"solution_architect"`
- Rehydrates conversation on mount via `getImplementConversation` with `kind='solution_architect'`
- Auto-sends bootstrap message: `"Help me define the high-level architecture for ${productName}."`
- Renders questions when phase="questions" (listed as `<ul>` items, same as PM)
- Shows section label for current discovery section
- Renders assumptions and openItems lists when present
- Renders readiness banner when phase="ready" with confirmation message (no save action wired)
- Upload Documents support (reuses `UploadDocumentsModal`)
- Persona label: "Solution Architect" (PM uses "Product Manager")
- Message ID prefix: `"sa-msg-"` (PM uses `"pm-msg-"`)
- New `SolutionArchitectChatPanel.module.css` for styling

**Frontend -- ProductPage sub-tab layout:**
- Modify `ProductPage.tsx` to add a sub-tab bar with two tabs: "Product Manager" and "Discuss Architecture"
- Default tab: "Product Manager" (preserves current behavior)
- When "Discuss Architecture" is selected, render `SolutionArchitectChatPanel` instead of `ProductManagerChatPanel`
- Sub-tab state is local to ProductPage (no URL parameter needed)
- Both panels receive the same props (`projectId`, `projectParentFolder`, `productName`)

**Frontend -- chatApi types:**
- Add `SolutionArchitectResponse` type mirroring the gateway type
- Add `solutionArchitectResponse` field to the frontend ChatResponse type

### Reusability Opportunities
- `ProductManagerChatPanel.tsx` structure directly reused as template for SA panel (state, rehydration, bootstrap, send, phase rendering, Upload Documents)
- `productManagerResponseValidator.ts` structure directly reused as template for SA validator
- `PRODUCT_MANAGER_PROMPT_TEMPLATE` structure reused as template for SA prompt
- `UploadDocumentsModal` component reused as-is
- `chatApi.ts` functions (`postChatMessage`, `getImplementConversation`, `convertMessageEntryToChatMessage`) reused as-is with different `kind` parameter
- `extractJson` from `plannerResponseValidator.ts` reused for SA JSON extraction
- `ProductManagerChatPanel.module.css` patterns reused for SA panel styling

### Scope Boundaries

**In Scope:**
- New `"solution_architect"` chat mode in gateway types
- New SA system prompt template in promptBuilder.ts
- New SA response validator with corrective retry pattern in route handler
- Add `'solution_architect'` to ALLOWED_KINDS for transcript persistence
- New SolutionArchitectChatPanel frontend component
- Sub-tab bar in ProductPage toggling between PM and SA panels
- Bootstrap auto-send with product name
- Phase-based rendering (questions with section labels, assumptions, openItems, ready banner)
- Upload Documents support in SA panel
- Conversation rehydration from disk on mount

**Out of Scope:**
- Any MCP tools
- Any architecture meta-model writes or reads
- Any diagram creation
- Any modification of existing architecture data
- Standards injection (handled in later increment)
- MISSION/TECH-STACK auto-injection (handled later)
- Conversation reset or "start over" functionality
- Mid-conversation persona switching between PM and SA
- Reading existing architecture model data to seed context
- Generating any files or artifacts
- Wiring the PM validation into the chat route handler (separate concern)
- Introducing `response_format: { type: 'json_object' }` for any mode
- Modifying `shouldBypassToolExecution` or `shouldAppendToTranscript` functions
- Any changes to mcp-server or architecture-model-service
- The actual "save baseline" action when user confirms on ready phase

### Technical Considerations
- **Gateway route handler validation + retry is a new pattern:** The corrective retry (append instruction, resend once, then fallback) does not exist in any current validator wiring. The planner and implementer validators validate once and fall back. This SA-specific retry should be implemented as a self-contained block in `chat.ts` that can later be generalized.
- **ALLOWED_KINDS must be updated:** `transcriptWriter.ts` line 39 must include `'solution_architect'` or the `normalizeKind()` function will throw an error and persistence will fail.
- **PM mode is NOT wired for validation in chat.ts:** This is a known gap. The SA mode will be the first "lightweight" (non-implement_feature) mode to have route-level validation. This should not affect PM behavior since PM validation functions exist but are simply not called.
- **Section enumeration in validator:** The validator must check that `section` is one of the 7 known values. This should be a `ReadonlySet<string>` constant, same pattern as `VALID_PHASES` in the PM validator.
- **Sub-tab state in ProductPage:** The sub-tab toggle should be `useState` local state, not URL-driven. Both PM and SA panels should remain unmounted when not active (no hidden rendering) to avoid duplicate bootstrap messages.
- **Conversation isolation:** PM conversations persist under `kind='product'` and SA conversations persist under `kind='solution_architect'`. They use different `featureTitle` values ("Product" vs "Solution Architect") ensuring separate folders on disk.
- **No changes to openaiClient.ts:** The SA mode uses the same `sendChatRequest` call without `jsonMode` option, consistent with PM mode.
- **Systems affected:** primary=gateway (types, services, routes), frontend=ProductPage + new SolutionArchitectChatPanel. No changes to mcp-server or architecture-model-service.
