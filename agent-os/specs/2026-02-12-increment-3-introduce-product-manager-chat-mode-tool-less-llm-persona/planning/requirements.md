# Spec Requirements: Increment 3 -- Introduce Product Manager Chat Mode (Tool-less LLM Persona)

## Initial Description

Introduce a new chat mode "product_manager" in the gateway that enables a structured Product Manager (PM) persona conversation. This increment is tool-less (no MCP calls) and does NOT generate or write MISSION.MD. It only conducts structured discovery and persists conversation under kind="product".

### Full Context Provided

**Title:** Increment 3 -- Introduce Product Manager Chat Mode (Tool-less LLM Persona)

**Intent:** Introduce a new chat mode "product_manager" in the gateway that enables a structured Product Manager (PM) persona conversation. This increment is tool-less (no MCP calls) and does NOT generate or write MISSION.MD. It only conducts structured discovery and persists conversation under kind="product".

**Scope -- Include:**
- new chat mode "product_manager" in gateway
- structured system prompt for PM persona
- structured JSON response contract with validation
- transcript persistence under kind="product"
- ProductPage chat panel integration

**Scope -- Exclude:**
- any MCP tool definitions
- mission file generation
- DB updates beyond minimal ProductDefinition
- architecture or roadmap automation
- changes to implement_feature mode

**Systems:**
- Primary: gateway
- Frontend: ProductPage
- No changes: architecture-model-service, mcp-server

**Backend (Gateway) Details:**

- Chat Mode name: "product_manager"
- Behavior: tool-less OpenAI call, no MCP tools allowed, transcript persisted with kind="product"
- System Prompt Persona: "Senior Product Manager"
- System Prompt Responsibilities: conduct structured product discovery, determine whether product is new or existing, ask for existing documentation first, gather minimum required information (project name confirmation, new vs existing product, existing documentation availability, core problem, target audience, desired outcome, success criteria, constraints, scope boundaries, delivery expectations), ask concise high-signal questions, limit total question rounds (soft cap ~10), internally track sufficiency, when sufficient switch phase to "ready", ask "I now have enough information to generate the MISSION.MD. Would you like me to proceed?", never generate mission content in this increment
- Structured Response Contract: `{ phase: "questions" | "ready", questions: string[], summary: string }`
- Rules: always return valid JSON, no markdown outside JSON, no missionMarkdown field, no tool calls
- Validation: reuse planner-style JSON parsing + safe fallback pattern, if parsing fails return safe error message and do not break transcript

**Transcript Persistence:**
- use existing conversation persistence mechanism
- pass kind="product"
- folder path: `<projectParentFolder>/conversations/product/<derivedFolderName>/`
- keep atomic write behavior
- do not store mission markdown (none generated yet)

**Frontend (ProductPage) Details:**
- Add chat panel below Product Name field
- Reuse existing chat component patterns from ImplementationAssistantPanel
- On first load (if no transcript exists), auto-bootstrap with: "Help me define the mission for this product."
- API endpoint: /api/chat with mode: "product_manager", projectId, projectParentFolder, kind: "product", messages: conversation history
- Render assistant questions when phase="questions"
- When phase="ready": display assistant confirmation message, do NOT auto-trigger anything
- Maintain loading + error state consistent with implement chat

**Non-Functional:**
- No regression to implement_feature mode
- No MCP tool exposure in this mode
- Strict separation between product_manager and other modes
- Follow existing logging and session handling patterns

**Acceptance Criteria:**
- Product screen displays working PM chat
- Conversation persists under conversations/product/...
- PM asks structured discovery questions
- PM eventually transitions to phase="ready"
- PM asks for user confirmation to proceed
- No mission file is generated in this increment
- Implement and OAS assistant flows remain unaffected

## Requirements Discussion

### First Round Questions

**Q1:** I assume the new "product_manager" mode should be added to the existing ChatMode type in gateway/src/types/chat.ts (currently 'oas_assistant' | 'implement_feature'), making it a union of three modes. I also assume shouldBypassToolExecution() in chat.ts should return true for product_manager mode (since it is tool-less, same as implement_feature). Is that correct, or should we introduce a different mechanism to prevent tool calls for this mode?
**Answer:** Yes -- add product_manager to the ChatMode union and have shouldBypassToolExecution() return true for it (tool-less in Increment 3).

**Q2:** Currently, shouldAppendToTranscript() and flushTranscriptToDisk() only activate for implement_feature mode. I assume these should be extended to also activate for product_manager mode, using kind="product" for persistence. The flush function currently requires featureId, featureTitle, and projectParentFolder -- for product mode, I assume we would use a product-level identifier (like projectId or the product name) in place of featureId/featureTitle for folder naming. What should be used as the deterministic folder name for product conversations?
**Answer:** Use projectId as the deterministic "featureId" and a constant title like "Product" (or "Product Mission") as "featureTitle" for deriveFolderName; do not use productName yet.

**Q3:** The spec calls for a structured JSON response with { phase: "questions" | "ready", questions: string[], summary: string }. I assume we should create a new validator following the same pattern as plannerResponseValidator.ts and implementerResponseValidator.ts -- parse JSON, validate shape, create fallback on failure, and include the validated response in ChatResponse. Should the validated response be added to ChatResponse as a new field (e.g., productManagerResponse), similar to how plannerResponse and implementerResponse are added?
**Answer:** Yes -- add a new optional field on ChatResponse, e.g. productManagerResponse, mirroring plannerResponse patterns.

**Q4:** The existing planner response uses OpenAI JSON mode ({ jsonMode: true } in ChatRequestOptions) to guarantee valid JSON from the LLM. I assume we should also use JSON mode for the product_manager chat to enforce the structured response contract. Should we also implement the same automatic retry pattern (corrective prompt + retry on validation failure) that exists for the planner response, or is a simpler fallback-only approach sufficient?
**Answer:** Yes -- use OpenAI JSON mode; implement the same corrective-prompt + single retry on validation failure (then fallback) to prevent brittle UX.

**Q5:** The current ProductPage has a "Product Manager (Coming Soon)" placeholder card. I assume this placeholder gets replaced with the actual chat panel. Looking at ImplementationAssistantPanel, it is a very large component (~1000+ lines) with extensive state management for phases, questions, increments, and streaming. For this increment, I assume we need a much simpler, purpose-built chat component since the product_manager mode only has two phases ("questions" and "ready") and no shaping/planning/orchestration workflow. Should we create a new dedicated component (e.g., ProductManagerChatPanel.tsx) with its own simple state management, rather than trying to reuse the complex ImplementationAssistantPanel?
**Answer:** Yes -- create a dedicated lightweight ProductManagerChatPanel.tsx; do not reuse ImplementationAssistantPanel (too complex/feature-specific).

**Q6:** The spec says on first load (if no transcript exists), auto-bootstrap with: "Help me define the mission for this product." I assume this follows the same pattern as the implement_feature bootstrap phase. Should the bootstrap use a distinct phase value (e.g., phase: 'bootstrap' or phase: 'questions') in the API call, or should it simply send the first user message with phase: 'questions' and let the system prompt handle the discovery flow from there?
**Answer:** No new phase plumbing -- just auto-send an initial user message (e.g., "Help me create a MISSION.MD for this product.") and let the system prompt drive discovery.

**Q7:** The implement_feature mode has conversation rehydration (loading persisted conversation from disk). I assume we need the same rehydration capability for the product_manager conversation so that navigating away and back preserves the chat. The existing getImplementConversation API already supports a kind parameter. Should we reuse this same endpoint with kind="product", or is a new endpoint needed?
**Answer:** Reuse the existing implement-conversations endpoint with kind="product" (no new endpoint).

**Q8:** The spec explicitly excludes mission file generation, DB updates beyond minimal ProductDefinition, architecture/roadmap automation, and changes to implement_feature mode. Is there anything else that should be explicitly excluded or noted as a boundary for this increment? For example, should the chat panel support any form of conversation reset or "start over" button, or is that out of scope?
**Answer:** Out of scope -- no reset/start-over button.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Chat route mode branching - Path: `gateway/src/routes/chat.ts`
- Feature: System prompt construction - Path: `gateway/src/services/promptBuilder.ts`
- Feature: Transcript persistence with kind support - Path: `gateway/src/services/transcriptWriter.ts`
- Feature: Planner JSON response validation pattern - Path: `gateway/src/services/plannerResponseValidator.ts`
- Feature: Implementer JSON response validation pattern - Path: `gateway/src/services/implementerResponseValidator.ts`
- Feature: Chat panel integration (complex reference, do NOT reuse directly) - Path: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- Feature: Target page with placeholder to replace - Path: `frontend/src/components/ProductView/ProductPage.tsx`
- Feature: Chat API types and functions - Path: `frontend/src/api/chatApi.ts`
- Feature: Gateway types including ChatMode, ChatContext, ChatResponse - Path: `gateway/src/types/chat.ts` and `gateway/src/types/index.ts`
- Feature: Gateway services barrel export - Path: `gateway/src/services/index.ts`
- Feature: OpenAI client with JSON mode support - Path: `gateway/src/services/openaiClient.ts`
- Feature: Conversation rehydration endpoint (supports kind parameter) - Path: existing implement-conversations endpoint
- Feature: ProductPage styles - Path: `frontend/src/components/ProductView/ProductPage.module.css`
- Feature: Product definition API - Path: `frontend/src/api/productDefinitionApi.ts`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of `agent-os/specs/2026-02-12-increment-3-introduce-product-manager-chat-mode-tool-less-llm-persona/planning/visuals/` confirmed no image files found.

### Visual Insights:
Not applicable -- no visual assets were provided.

## Requirements Summary

### Functional Requirements
- Add `product_manager` to the `ChatMode` union type in gateway types
- Bypass tool execution for `product_manager` mode (return `true` from `shouldBypassToolExecution`)
- Build a new system prompt for a "Senior Product Manager" persona that conducts structured product discovery
- Enforce structured JSON response contract: `{ phase: "questions" | "ready", questions: string[], summary: string }`
- Use OpenAI JSON mode for `product_manager` chat requests
- Implement corrective-prompt + single-retry on JSON validation failure (matching planner retry pattern)
- Create a new `productManagerResponse` optional field on `ChatResponse` for the validated response
- Create a new validator (e.g., `productManagerResponseValidator.ts`) following planner/implementer validator patterns
- Extend transcript append and flush logic to support `product_manager` mode with `kind="product"`
- Use `projectId` as the deterministic folder identifier and `"Product"` (or `"Product Mission"`) as the constant title for `deriveFolderName`
- Persist conversations to: `<projectParentFolder>/conversations/product/<derivedFolderName>/`
- Replace the "Product Manager (Coming Soon)" placeholder on ProductPage with a working chat panel
- Create a new dedicated lightweight `ProductManagerChatPanel.tsx` component
- On first load with no existing transcript, auto-send: "Help me create a MISSION.MD for this product."
- No new phase plumbing -- the auto-bootstrap message is simply the first user message; the system prompt drives discovery
- Render assistant questions when `phase="questions"`
- When `phase="ready"`, display the assistant's confirmation message but do NOT auto-trigger anything
- Support conversation rehydration via the existing implement-conversations endpoint with `kind="product"`
- Maintain loading and error states consistent with the implement chat pattern

### Reusability Opportunities
- `shouldBypassToolExecution()` in `chat.ts` can be extended with a simple additional condition
- `shouldAppendToTranscript()` and `flushTranscriptToDisk()` can be extended to also handle `product_manager` mode
- `plannerResponseValidator.ts` pattern should be followed closely for the new `productManagerResponseValidator.ts`
- `chatApi.ts` functions can be called with the new mode parameter
- Existing implement-conversations endpoint reused with `kind="product"` for rehydration
- `ProductPage.module.css` already has styles for form card, loading state, and error state that can be extended
- `writeTranscriptToFile` already accepts a `kind` parameter (added in Spec 2026-02-12) so persistence infrastructure is ready

### Scope Boundaries

**In Scope:**
- New `product_manager` chat mode in gateway
- Structured PM persona system prompt
- Structured JSON response contract with validation, JSON mode, and retry
- `productManagerResponse` field on `ChatResponse`
- Transcript persistence under `kind="product"`
- Dedicated `ProductManagerChatPanel.tsx` component on ProductPage
- Auto-bootstrap message on first load
- Conversation rehydration via existing endpoint with `kind="product"`
- Loading and error state handling

**Out of Scope:**
- Any MCP tool definitions or tool calls
- Mission file (MISSION.MD) generation or writing
- Database updates beyond minimal ProductDefinition
- Architecture or roadmap automation
- Changes to `implement_feature` mode or OAS assistant mode
- Conversation reset / "start over" button
- Streaming endpoint support for this mode
- Using `productName` in folder naming (use `projectId` only)
- Any `missionMarkdown` field in the response contract

### Technical Considerations
- Gateway types file (`gateway/src/types/chat.ts` and `gateway/src/types/index.ts`) must be updated with the new ChatMode value and new response type
- The chat route (`gateway/src/routes/chat.ts`) needs new branching logic for `product_manager` mode, following the existing pattern of mode-specific validation and response handling
- `flushTranscriptToDisk` currently hard-codes `implement_feature` mode check and `"implement"` kind -- must be generalized or extended for `product_manager` with `"product"` kind
- The system prompt must enforce JSON-only responses with no markdown or prose outside the JSON structure
- The PM system prompt should include the soft cap of ~10 question rounds and internal sufficiency tracking instructions
- The `ProductManagerChatPanel` should be lightweight: simple message list, input field, send button, loading spinner, and phase-aware rendering
- No regression allowed to existing `implement_feature` and `oas_assistant` flows -- strict separation of mode logic
- Follow existing logging and session handling patterns (request IDs, session IDs, structured logger calls)
