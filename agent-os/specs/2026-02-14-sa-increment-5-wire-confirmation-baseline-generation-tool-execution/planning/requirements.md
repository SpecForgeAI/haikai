# Spec Requirements: SA Increment 5 -- Wire Confirmation, Baseline Generation, Tool Execution

## Initial Description

**Title:** SA Increment 5 -- Wire Confirmation -> Baseline Generation -> Tool Execution + 'View and Extend Here' Link

**Intent:** Complete the Solution Architect flow end-to-end: SA conducts structured architecture discovery, transitions to phase="ready", user confirms baseline creation, gateway generates architectureBaselineJson, gateway invokes MCP tool save_architecture_baseline, assistant responds with success message including link to Architecture & Design. This increment performs the first architecture meta-model write (no diagrams).

**Scope -- Include:**
- Gateway changes: confirmation detection (regex, phase check), baseline generation branch (4 steps: build prompt, OpenAI call with JSON enforcement + corrective retry, validate minimum requirements, invoke MCP tool), transcript rules (no architectureBaselineJson on disk), success response with link, failure response
- Frontend changes: SolutionArchitectChatPanel loading state, success message with clickable link
- Non-functional requirements
- Acceptance criteria

**Scope -- Exclude:**
- Diagram generation (future increment)
- Advanced validation beyond minimum requirements
- User editing of baseline before save
- Multi-product support (single product context only)

**Systems Affected:**
- Gateway: chat route, prompt builder, tool executor, transcript writer
- Frontend: SolutionArchitectChatPanel component
- MCP Server: save_architecture_baseline tool (already implemented in Increment 4)

---

## Requirements Discussion

### First Round Questions

**Q1: Confirmation phase source of truth**
How should the gateway determine that the current conversation is in phase="ready" before checking the user's confirmation message?

- Option A: Frontend-derived -- the frontend sends a new context field (e.g., `saPhase: "ready"`) in the ChatRequest so the gateway trusts it.
- Option B: Gateway-derived -- the gateway parses the persisted conversation history and reads the most recent assistant solutionArchitectResponse.phase to confirm it was "ready".

**Answer:** Option B -- gateway-derived: parse the persisted conversation history and read the most recent assistant solutionArchitectResponse.phase to confirm it was "ready".

---

**Q2: Confirmation regex false-positive prevention**
The regex to detect "yes", "go ahead", "confirm", etc. could match mid-conversation answers that are not baseline confirmations. How strict should the regex be?

- Option A: Loose regex (current raw-idea approach) + phase="ready" as the only guard.
- Option B: Require BOTH phase="ready" AND regex match, but also make the regex stricter (e.g., require the entire trimmed message to be essentially just a confirmation word/phrase, not a longer sentence that happens to contain "yes").

**Answer:** Require BOTH: phase="ready" AND regex match; additionally make the regex stricter by requiring the user message to be essentially a confirmation (e.g., trimmed length small / matches `^\s*(yes|y|ok|okay|proceed|go ahead|confirm|generate)\s*[.!]?\s*$`).

---

**Q3: Baseline generation: Separate OpenAI call or extend existing conversation?**
When the user confirms, should the gateway:

- Option A: Make a dedicated, separate OpenAI call using an ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE with the full SA transcript as context, using response_format: { type: "json_object" }?
- Option B: Extend the existing SA conversation by appending a system/user message like "Generate the architectureBaselineJson now" and let the existing SA conversation flow produce it?

**Answer:** Option A -- dedicated baseline generation call using an ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE with full SA transcript; use response_format: { type: "json_object" }.

---

**Q4: architectureBaselineJson generation: LLM or programmatic?**
Should the LLM generate the full architectureBaselineJson, or should the LLM produce an intermediate format that is programmatically transformed into the ArchitectureBaselineInput schema?

**Answer:** LLM generates the full JSON (guided by the schema embedded in the generation prompt); no programmatic transformation in v0.1.

---

**Q5: Tool invocation: Direct executeTool or OpenAI agent loop?**
After JSON generation and validation, should the gateway:

- Call executeTool('save_architecture_baseline', ...) directly (bypassing the agent loop)?
- Use OpenAI function-calling to have the LLM decide to call the tool?

**Answer:** Call executeTool('save_architecture_baseline', ...) directly after JSON validation (bypass the agent loop for this branch, like the mission-generation special path).

---

**Q6: Transcript persistence rules**
What should be persisted to conversation.json and what should be stripped?

**Answer:** Exclude stripped items entirely (no placeholders): persist only user confirmation + final assistant success/failure; do not persist generation prompt, raw JSON, or tool args.

---

**Q7: Success message link: What is the Architecture & Design route?**
What route/path should the success message link navigate to?

**Answer:** Link should navigate to the existing Architecture & Design top tab route (same as current app navigation); implement as a React Router Link using the known route for that tab (use the same route/path builder used by the top nav).

---

**Q8: Frontend loading state**
Should the frontend show a special loading indicator during baseline generation (which takes longer than normal SA responses)?

**Answer:** Keep "Thinking..." for v0.1; no special indicator needed and no gateway signaling.

---

**Q9: Phase after successful save**
Should the SolutionArchitectResponse phase enum be extended with a new value (e.g., "completed" or "saved") after successful baseline save?

**Answer:** Do not extend the phase enum in v0.1; success message can be a plain assistant message without solutionArchitectResponse (or keep response with phase="ready" but no further action -- prefer plain message to avoid re-trigger logic).

---

**Q10: Re-confirmation prevention**
After a successful save, if the user sends another confirmatory message (e.g., "yes"), should the gateway detect "already saved" and respond differently?

**Answer:** Option A -- let it flow normally; no special "already saved" interception in v0.1.

---

**Q11: Error handling: Corrective retry and messages**
Should the baseline generation use the same corrective retry pattern as the SA response validation (one retry with corrective instruction)?

**Answer:** Yes -- use the same corrective retry once; user-facing errors should be friendly and non-technical (no schema details), with details only in logs.

---

**Q12: Model/temperature for generation call**
Should the baseline generation use the same model and temperature as the normal SA discovery calls?

**Answer:** Yes -- use same model family; set temperature ~0.2 and response_format json_object; increase max_tokens to ~8000 to reduce truncation risk for larger baselines.

---

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Product Manager Confirmation + Mission Generation -- Path: `gateway/src/routes/chat.ts` (PM confirmation detection and MISSION_GENERATION_PROMPT_TEMPLATE flow in the existing PM mode)
- Feature: PM Mission Generation Prompt -- Path: `gateway/src/services/promptBuilder.ts` (MISSION_GENERATION_PROMPT_TEMPLATE export and usage pattern)
- Feature: SA Corrective Retry Pattern -- Path: `gateway/src/routes/chat.ts` lines ~951-1055 (SA validation with corrective retry block)
- Feature: Tool Executor -- Path: `gateway/src/services/toolExecutor.ts` (executeTool function signature and save_architecture_baseline registration)
- Feature: SA Response Validator -- Path: `gateway/src/services/solutionArchitectResponseValidator.ts`
- Feature: MCP Save Architecture Baseline types -- Path: `mcp-server/src/types/saveArchitectureBaseline.ts` (ArchitectureBaselineInput schema)
- Feature: Frontend SA Chat Panel -- Path: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`
- Feature: Frontend Product Page sub-tabs -- Path: `frontend/src/components/ProductView/ProductPage.tsx`
- Feature: SA Persistence -- Path: `gateway/src/services/transcriptWriter.ts` (conversation persistence with kind="solution_architect")
- Feature: Conversation persistence with messagesForPersistence pattern -- Path: `gateway/src/routes/chat.ts` lines ~799-811

### Follow-up Questions

No follow-up questions were needed.

---

## Visual Assets

### Files Provided:
No visual assets provided. The visuals folder exists but is empty.

### Visual Insights:
N/A

---

## Codebase Technical Context

### Gateway: Chat Route (`gateway/src/routes/chat.ts`)

**SA Mode Handling Location:**
- SA mode is detected via `shouldValidateSolutionArchitectResponse(context)` at line ~210 which checks `context?.mode === 'solution_architect'`
- SA validation with corrective retry runs at lines ~955-1055
- SA standards-missing short-circuit runs at lines ~581-622
- SA file loading (MISSION.MD, TECH-STACK.MD) runs at lines ~544-575

**Corrective Retry Pattern (lines ~951-1055):**
- First validation: `validateSolutionArchitectResponse(response.content || '')`
- On failure: appends invalid assistant response + `SA_CORRECTIVE_INSTRUCTION` to messages
- Second call: `sendChatRequest(messages, requestId, effectiveSessionId)`
- Second validation: if fails, falls back to `createFallbackSolutionArchitectResponse()`

**MessagesForPersistence Pattern (lines ~799-811):**
- For SA mode with sources, creates a separate `messagesForPersistence` array
- Maps over `messages`, replacing augmented user content with original message
- Calls `persistConversation(effectiveSessionId, messagesForPersistence)`

**LoadProjectFile Helper (lines ~352-392):**
- `loadProjectFile(projectParentFolder, primaryPath, fallbackPath, requestId)` -> `string | undefined`
- Used for loading MISSION.MD and TECH-STACK.MD into SA mode prompt

**Key Imports from Services:**
```typescript
import {
  persistConversation,
  sendChatRequest,
  buildSystemPrompt,
  buildMessagesForTurn,
  executeTool, // NOT currently imported -- would need to add
  validateSolutionArchitectResponse,
  createFallbackSolutionArchitectResponse,
} from '../services';
```

### Gateway: Tool Executor (`gateway/src/services/toolExecutor.ts`)

**executeTool Function Signature:**
```typescript
export async function executeTool(
  toolName: ToolName,
  args: Record<string, unknown>,
  mcpSessionId: string,
  requestId: string,
  sessionId: string
): Promise<{ result: unknown; status: number; durationMs: number }>
```

**save_architecture_baseline Registration:**
- Registered in `TOOL_ENDPOINTS`: `save_architecture_baseline: '/mcp/tools/save_architecture_baseline'`
- Required params in `TOOL_REQUIRED_PARAMS`: `['projectId', 'architectureBaselineJson']`
- Already in `ALLOWED_TOOL_NAMES` and `ToolName` union type

### Gateway: Types (`gateway/src/types/chat.ts`)

**ChatRequest:**
```typescript
export interface ChatRequest {
  sessionId?: string;
  message: string;
  context?: ChatContext;
  sources?: string[];
}
```

**ChatResponse:**
```typescript
export interface ChatResponse {
  sessionId: string;
  assistant: AssistantResponse;
  solutionArchitectResponse?: SolutionArchitectResponse;
  error?: string;
  // ... other fields
}
```

**SolutionArchitectResponse:**
```typescript
export interface SolutionArchitectResponse {
  phase: 'questions' | 'ready';
  section: 'context_and_boundaries' | 'ui_and_channels' | ... | 'final_review';
  questions: string[];
  summary: string;
  assumptions: string[];
  openItems: string[];
}
```

**ChatContext includes:**
- `mode?: ChatMode` (where ChatMode includes 'solution_architect')
- `filename?: string` (used as projectId)
- `projectParentFolder?: string`
- `featureId?: string`
- `featureTitle?: string`

### Gateway: Prompt Builder (`gateway/src/services/promptBuilder.ts`)

**SOLUTION_ARCHITECT_PROMPT_TEMPLATE:**
- Full SA discovery system prompt with 9 sections, READINESS GATE, JSON response format
- Has `CONTEXT ALIGNMENT` section for MISSION/TECH-STACK injection
- Exported from `buildSystemPrompt()` when `context?.mode === 'solution_architect'`

**MISSION_GENERATION_PROMPT_TEMPLATE:**
- Precedent for "dedicated generation prompt" pattern
- Exported as named export for direct use
- Template instructs model to synthesize conversation into structured output

**READINESS GATE block** in SA template defines when phase="ready" is allowed:
- At least one service identified
- At least one data entity identified or explicitly acknowledged "none needed"
- At least one integration identified or explicitly acknowledged "none needed"
- High-level architecture summary exists
- All 9 sections visited or explicitly skipped

### Gateway: Transcript Writer (`gateway/src/services/transcriptWriter.ts`)

- `ALLOWED_KINDS` includes `'solution_architect'`
- Path structure: `<basePath>/conversations/solution_architect/<folderName>/`
- Conversation persistence uses `persistConversation(sessionId, messages)` from `conversation.ts`
- The SA mode currently persists all messages via the standard path in chat.ts

### Frontend: SolutionArchitectChatPanel (`frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`)

**State Management:**
- `saResponses: Map<string, SolutionArchitectResponse>` -- maps message ID to SA response
- `messages: ChatMessage[]` -- all messages displayed
- `sessionId: string | null` -- session identifier
- `loading: boolean` -- loading state
- `error: string | null` -- error banner text

**Ready Banner (lines ~493-497):**
```tsx
{saResponse.phase === 'ready' && (
  <div className={styles.readyBanner} data-testid="sa-chat-ready">
    Architecture baseline is complete. Would you like to save?
  </div>
)}
```

**Loading State (lines ~506-509):**
```tsx
{loading && messages.length > 0 && (
  <div className={styles.loadingIndicator} data-testid="sa-chat-thinking">
    Thinking...
  </div>
)}
```

**handleSend Function:**
- Builds context via `buildSolutionArchitectContext(projectId, projectParentFolder)`
- Calls `postChatMessage({ sessionId, message, context })`
- Stores `solutionArchitectResponse` in saResponses map
- Sets loading true/false around API call

**Context Builder:**
```typescript
function buildSolutionArchitectContext(projectId: string, projectParentFolder: string) {
  return {
    mode: 'solution_architect' as const,
    filename: projectId,
    projectParentFolder,
    featureId: projectId,
    featureTitle: 'Solution Architect',
  };
}
```

### Frontend: ProductPage (`frontend/src/components/ProductView/ProductPage.tsx`)

**Sub-Tab Structure:**
- Two tabs: "Product Manager" (`pm`) and "Discuss Architecture" (`sa`)
- Default tab: `pm`
- Uses `useProject()` hook for `activeProject?.id`, `activeProject?.projectParentFolder`
- Conditionally renders `ProductManagerChatPanel` or `SolutionArchitectChatPanel`
- Architecture & Design tab route is managed by the top-level navigation (not within ProductPage)

### Frontend: Chat API (`frontend/src/api/chatApi.ts`)

**Key Types:**
- `SolutionArchitectResponse` -- mirrors gateway type
- `ChatResponse.solutionArchitectResponse` -- optional field populated for SA mode
- `postChatMessage(request: ChatRequest): Promise<ChatResponse>`

### MCP Server: Save Architecture Baseline Types (`mcp-server/src/types/saveArchitectureBaseline.ts`)

**ArchitectureBaselineInput Schema:**
```typescript
export interface ArchitectureBaselineInput {
  services?: ServiceInput[];
  interfaces?: InterfaceInput[];
  interfaceEndpoints?: InterfaceEndpointInput[];
  logicalDataEntities?: LogicalDataEntityInput[];
  physicalDataEntities?: PhysicalDataEntityInput[];
  businessLogic?: BusinessLogicInput[];
  dataMovements?: DataMovementInput[];
}
```

**SaveArchitectureBaselineRequest:**
```typescript
export interface SaveArchitectureBaselineRequest {
  sessionId: string;
  projectId: string;
  architectureBaselineJson: string; // JSON string of ArchitectureBaselineInput
}
```

**SaveArchitectureBaselineResponse (success):**
```typescript
export interface SaveArchitectureBaselineResponse {
  success: boolean;
  projectId: string;
  filename: string;
  summary: {
    applications: number;
    appComponents: number;
    services: number;
    interfaces: number;
    interfaceEndpoints: number;
    logicalDataEntities: number;
    physicalDataEntities: number;
    businessLogic: number;
    dataMovements: number;
    applicationPoints: number;
    dataEntityPoints: number;
    interfaceLogicalEntities: number;
    logicalPhysicalMappings: number;
    applicationPointBusinessLogics: number;
  };
  createdEntities: Record<string, Array<{ name: string; id: string }>>;
}
```

**Required MCP Tool Parameters:** `['projectId', 'architectureBaselineJson']`

---

## Files That Will Need Changes

### Gateway (Must Change)

1. **`gateway/src/routes/chat.ts`** -- Main changes:
   - Add confirmation detection logic (phase="ready" check from conversation history + regex)
   - Add baseline generation branch (new function or inline block)
   - Build ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE call
   - Dedicated OpenAI call with response_format: json_object, temperature: 0.2, max_tokens: ~8000
   - Corrective retry for JSON generation
   - Minimum requirements validation
   - Direct executeTool('save_architecture_baseline', ...) invocation
   - Custom messagesForPersistence (strip generation prompt, raw JSON, tool args; keep only user confirmation + success/failure message)
   - Return success message with Architecture & Design link as plain assistant message (no solutionArchitectResponse)
   - Return friendly error message on failure

2. **`gateway/src/services/promptBuilder.ts`** -- Add:
   - New `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` constant
   - Schema of ArchitectureBaselineInput embedded in prompt text
   - Export the template for use in chat.ts

3. **`gateway/src/services/index.ts`** -- Add:
   - Export of new prompt template and any new helper functions

### Frontend (Must Change)

4. **`frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`** -- Changes:
   - Detect success message containing Architecture & Design link
   - Render clickable React Router `<Link>` for navigation to Architecture & Design tab
   - No changes to loading state (keep "Thinking...")

### Files That May Need Minor Changes

5. **`gateway/src/types/chat.ts`** -- Potentially no changes needed (success message is a plain assistant message, no new phase value)

6. **`mcp-server/src/types/saveArchitectureBaseline.ts`** -- No changes (already complete from Increment 4)

7. **`gateway/src/services/toolExecutor.ts`** -- No changes (save_architecture_baseline already registered)

8. **`gateway/src/services/transcriptWriter.ts`** -- No changes expected (persistence handled by messagesForPersistence pattern in chat.ts)

---

## Requirements Summary

### Functional Requirements

1. **Confirmation Detection:**
   - Gateway reads most recent assistant solutionArchitectResponse from persisted conversation history
   - Confirms phase="ready" before checking user message
   - Regex match: `^\s*(yes|y|ok|okay|proceed|go ahead|confirm|generate)\s*[.!]?\s*$` (case-insensitive)
   - Both conditions (phase + regex) must be true to trigger baseline generation

2. **Baseline Generation (4-Step Branch):**
   - Step 1: Build `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` with full SA transcript
   - Step 2: Dedicated OpenAI call with `response_format: { type: "json_object" }`, `temperature: 0.2`, `max_tokens: ~8000`
   - Step 3: Validate generated JSON against minimum requirements (at least one service, valid JSON structure matching ArchitectureBaselineInput)
   - Step 4: Call `executeTool('save_architecture_baseline', { projectId, architectureBaselineJson }, ...)` directly (bypass agent loop)

3. **Corrective Retry:**
   - If first JSON generation fails validation, append corrective instruction and retry once
   - If second attempt fails, return friendly error message to user
   - Error details only in server logs, not in user-facing messages

4. **Transcript Persistence:**
   - Persist only: user confirmation message + final assistant success/failure message
   - Do NOT persist: generation prompt, raw architectureBaselineJson, tool arguments
   - No placeholder entries for stripped items

5. **Success Response:**
   - Plain assistant message (no solutionArchitectResponse attached to avoid re-trigger)
   - Contains summary of what was created (entity counts from tool response)
   - Contains clickable link to Architecture & Design tab
   - Link uses React Router for client-side navigation

6. **Failure Response:**
   - Friendly, non-technical error message
   - No schema details or JSON structure in user-facing message
   - User can continue conversation or retry

7. **Frontend Changes:**
   - Keep "Thinking..." loading indicator (no special baseline generation indicator)
   - Parse success message for Architecture & Design link pattern
   - Render as React Router `<Link>` component using the same route as the top navigation

8. **No Re-Confirmation Prevention:**
   - No special interception after successful save in v0.1
   - Subsequent confirmation messages flow through normally

### Reusability Opportunities

- **PM Confirmation Detection Pattern:** The Product Manager mode has an analogous confirmation + generation flow. The SA confirmation detection can follow the same structural pattern.
- **MISSION_GENERATION_PROMPT_TEMPLATE:** The architecture baseline generation prompt should follow the same template pattern (dedicated constant, exported, used in a special branch of chat.ts).
- **SA Corrective Retry Block:** The existing corrective retry pattern in chat.ts lines ~951-1055 should be reused/adapted for JSON generation validation.
- **executeTool Direct Invocation:** The PM flow's direct tool call pattern (bypassing agent loop) is the model to follow.
- **messagesForPersistence Pattern:** The SA source-stripping pattern at lines ~799-811 demonstrates how to build a custom messages array for persistence.

### Scope Boundaries

**In Scope:**
- Gateway confirmation detection (phase check + regex)
- New ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE
- Dedicated OpenAI call for JSON generation with json_object response format
- Corrective retry for JSON generation (one retry)
- Minimum requirements validation (structural checks on generated JSON)
- Direct executeTool invocation for save_architecture_baseline
- Custom transcript persistence (strip generation artifacts)
- Success message with entity counts and Architecture & Design link
- Friendly failure messages
- Frontend: detect link in success message and render as React Router Link
- Frontend: keep "Thinking..." loading state unchanged

**Out of Scope:**
- Diagram generation (future increment)
- Advanced validation beyond minimum structural checks
- User editing of baseline before save
- Multi-product support
- New phase enum values (no "completed" or "saved" phase)
- Re-confirmation prevention / "already saved" detection
- Special frontend loading indicator for baseline generation
- Gateway signaling for generation progress

### Technical Considerations

- **Model Configuration:** Same model family as SA discovery; temperature: 0.2; response_format: { type: "json_object" }; max_tokens: ~8000
- **executeTool Signature:** `executeTool(toolName, args, mcpSessionId, requestId, sessionId)` returns `{ result, status, durationMs }`
- **Session Access:** Need `session.mcpSessionId` for tool execution; available from `getOrCreateSession(effectiveSessionId)`
- **Conversation History Reading:** Must parse persisted conversation to find most recent assistant message with solutionArchitectResponse.phase="ready". This means parsing `session.conversation` which holds the OpenAI message array.
- **JSON Generation Prompt:** Must embed the ArchitectureBaselineInput schema (from `mcp-server/src/types/saveArchitectureBaseline.ts`) in the prompt text so the LLM knows the target structure
- **Architecture & Design Route:** Must be determined from the existing app navigation structure (top-level tab routing)
- **Persistence Flow:** The confirmation detection branch must return a ChatResponse BEFORE the normal SA validation block runs. Similar to the standards-missing short-circuit pattern.
- **No solutionArchitectResponse on Success:** To avoid the ready banner re-triggering confirmation logic, the success response should be a plain assistant message without `solutionArchitectResponse` field
