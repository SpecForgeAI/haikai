# Task Breakdown: Implement Chat - Planner Conversation Loop (Iteration 2)

## Overview
Total Tasks: 24

This feature adds a dedicated Planner conversation loop to the Implement screen using the existing /api/chat endpoint. The implementation requires extending the Gateway to support a new `implement_feature` mode with a specialized system prompt, then updating the Frontend to integrate functional chat components into the ImplementationAssistantPanel.

**Execution Order Rationale:** Gateway changes must be completed first as they provide the backend infrastructure (mode-based prompt selection, tool execution bypass) that the Frontend depends on.

## Task List

### Gateway Layer

#### Task Group 1: ChatContext Type Extension
**Dependencies:** None

- [x] 1.0 Complete ChatContext type extension
  - [x] 1.1 Write 3-4 focused tests for ChatContext type handling
    - Test that mode field accepts "oas_assistant" | "implement_feature" | undefined
    - Test that workItem object is properly typed with id, title, type, description
    - Test that architectureContext object accepts entityIds and diagramIds arrays
    - Test that intent field accepts "normal_chat" | undefined
  - [x] 1.2 Extend ChatContext interface in gateway/src/types/chat.ts
    - Add mode?: "oas_assistant" | "implement_feature"
    - Add intent?: "normal_chat"
    - Add workItem?: { id: string; title: string; type: string; description: string; }
    - Add architectureContext?: { entityIds: string[]; diagramIds: string[]; }
  - [x] 1.3 Update type exports in gateway/src/types/index.ts if needed
  - [x] 1.4 Ensure ChatContext type tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify types compile correctly

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- ChatContext interface includes all new optional fields
- Existing OAS assistant code continues to work (mode undefined = oas_assistant behavior)
- TypeScript compilation succeeds

---

#### Task Group 2: Implement Feature System Prompt
**Dependencies:** Task Group 1

- [x] 2.0 Complete implement_feature system prompt implementation
  - [x] 2.1 Write 4-5 focused tests for prompt selection and content
    - Test that undefined mode uses SYSTEM_PROMPT_TEMPLATE
    - Test that "oas_assistant" mode uses SYSTEM_PROMPT_TEMPLATE
    - Test that "implement_feature" mode with "normal_chat" intent uses IMPLEMENT_PLANNER_PROMPT_TEMPLATE
    - Test that workItem context (title, type, description) is injected into prompt
    - Test that architectureContext (entityIds, diagramIds) is injected into prompt
  - [x] 2.2 Create IMPLEMENT_PLANNER_PROMPT_TEMPLATE constant in gateway/src/services/promptBuilder.ts
    - Instruct model to: (1a) Replay understanding in own words
    - Instruct model to: (1b) Ask clarifying questions, surface assumptions
    - Instruct model to: (1c) Incorporate responses, refine understanding
    - Instruct model to: (1d) Repeat until understanding complete
    - Instruct model to: (1e) Ask if user satisfied and ready to proceed
    - Explicitly forbid: /agent-os:write-spec emission
    - Explicitly forbid: generating implementation steps or code
    - Explicitly forbid: taking actions on behalf of user
    - Explicitly forbid: calling MCP tools
    - Include placeholders for: workItem.title, workItem.type, workItem.description
    - Include placeholders for: entityIds, diagramIds
    - Instruct responses to be concise and grounded in provided context
  - [x] 2.3 Modify buildSystemPrompt function to select prompt based on context.mode
    - When mode is undefined or "oas_assistant": use existing SYSTEM_PROMPT_TEMPLATE
    - When mode is "implement_feature" and intent is "normal_chat": use IMPLEMENT_PLANNER_PROMPT_TEMPLATE
    - Inject workItem and architectureContext values into placeholders
  - [x] 2.4 Update buildContextSummary for logging new context fields
  - [x] 2.5 Ensure prompt selection tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify correct prompt template is selected for each mode

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- IMPLEMENT_PLANNER_PROMPT_TEMPLATE follows Planner-style exploratory dialog pattern
- Prompt explicitly forbids tool calls and code generation
- Context values are properly injected into prompt placeholders
- Existing OAS assistant behavior unchanged

---

#### Task Group 3: Tool Execution Bypass for implement_feature Mode
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete tool execution bypass for implement_feature mode
  - [x] 3.1 Write 3-4 focused tests for tool execution bypass
    - Test that implement_feature mode skips agent loop (lines 96-163 in chat.ts)
    - Test that implement_feature mode returns response directly without tool execution
    - Test that implement_feature mode treats response as always final
    - Test that oas_assistant mode (or undefined) continues normal agent loop behavior
  - [x] 3.2 Modify POST /api/chat handler in gateway/src/routes/chat.ts
    - Check if context.mode === "implement_feature" after initial sendChatRequest
    - When implement_feature mode: skip the while loop (lines 96-163) entirely
    - Return OpenAI response directly without attempting MCP tool execution
    - Ensure toolTrace and artifacts remain empty for implement_feature mode
  - [x] 3.3 Ensure conversation is still persisted correctly for implement_feature mode
    - Verify persistConversation is called after response
    - Verify session context updates apply correctly
  - [x] 3.4 Ensure tool bypass tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify no side effects occur during clarification phase

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- implement_feature mode returns response immediately after first OpenAI call
- No MCP tool calls are executed when mode is implement_feature
- Conversation history is properly persisted
- OAS assistant behavior remains unchanged

---

### Frontend Layer

#### Task Group 4: Frontend Chat API Extension
**Dependencies:** Task Group 3 (Gateway must be ready)

- [x] 4.0 Complete frontend chat API extension
  - [x] 4.1 Write 3-4 focused tests for ChatRequest interface extension
    - Test that ChatRequest can include optional context field
    - Test that ImplementChatContext interface has all required fields
    - Test that postChatMessage serializes context object correctly
  - [x] 4.2 Create ImplementChatContext interface in frontend/src/api/chatApi.ts
    - mode: "implement_feature"
    - intent: "normal_chat"
    - workItem: { id, title, type, description }
    - architectureContext: { entityIds: string[]; diagramIds: string[]; }
  - [x] 4.3 Extend ChatRequest interface in frontend/src/api/chatApi.ts
    - Add context?: ImplementChatContext
    - Existing postChatMessage function will automatically serialize context via JSON.stringify
  - [x] 4.4 Ensure frontend API tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify types compile correctly

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- ImplementChatContext interface contains all required fields per spec
- ChatRequest interface extended with optional context field
- postChatMessage function serializes requests correctly

---

#### Task Group 5: ImplementationAssistantPanel Chat Integration
**Dependencies:** Task Group 4

- [x] 5.0 Complete ImplementationAssistantPanel chat integration
  - [x] 5.1 Write 5-6 focused tests for ImplementationAssistantPanel chat functionality
    - Test empty state displays "Start a conversation to clarify this work item."
    - Test ChatInput and ChatMessageList components render correctly
    - Test sessionId is initialized to null and set after first message response
    - Test sessionId and messages are cleared when workItemId prop changes
    - Test context object is constructed with correct mode, intent, and work item data
    - Test architectureContext is derived from contextState.entity_refs and contextState.diagram_refs
  - [x] 5.2 Update ImplementationAssistantPanel props interface
    - Add workItemId: string
    - Add workItemTitle: string
    - Add workItemType: string
    - Add workItemDescription: string
    - Add projectId: string
    - Add contextState: ContextState
  - [x] 5.3 Add state management to ImplementationAssistantPanel
    - Add sessionId state (string | null), initialized to null
    - Add messages state (ChatMessage[]), initialized to empty array
    - Add isLoading state (boolean)
    - Add error state (string | null)
  - [x] 5.4 Implement useEffect to clear state when workItemId changes
    - Reset sessionId to null
    - Reset messages to empty array
    - Clear any error state
  - [x] 5.5 Replace placeholder content with functional chat components
    - Import ChatInput from '../chat/ChatInput'
    - Import ChatMessageList from '../chat/ChatMessageList'
    - Display empty state message when messages array is empty
    - Display ChatMessageList when messages exist
    - Render ChatInput at bottom of panel
  - [x] 5.6 Implement handleSend callback for ChatInput
    - Add user message to messages state immediately
    - Set isLoading to true
    - Construct ImplementChatContext with mode, intent, projectId, workItem data
    - Derive architectureContext from contextState.entity_refs and contextState.diagram_refs
    - Call postChatMessage with message, sessionId (optional), and context
    - On success: store sessionId from response, add assistant message to messages
    - On error: set error state, add error as assistant message
    - Set isLoading to false
  - [x] 5.7 Maintain header "Implementation Assistant" and panel layout structure
    - Keep existing styles.header and styles.title
    - Keep data-testid="implementation-assistant-panel"
  - [x] 5.8 Ensure ImplementationAssistantPanel tests pass
    - Run ONLY the 5-6 tests written in 5.1
    - Verify component renders and behaves correctly

**Acceptance Criteria:**
- The 5-6 tests written in 5.1 pass
- Placeholder input/button replaced with functional ChatInput and ChatMessageList
- Empty state message displayed when no messages
- Session management works per-work-item with proper reset on workItemId change
- Context object includes all required fields including architectureContext
- Header and layout structure preserved

---

#### Task Group 6: ProductImplementPage Integration
**Dependencies:** Task Group 5

- [x] 6.0 Complete ProductImplementPage integration with ImplementationAssistantPanel
  - [x] 6.1 Write 2-3 focused tests for ProductImplementPage prop passing
    - Test that ImplementationAssistantPanel receives workItemId, workItemTitle, workItemType, workItemDescription
    - Test that ImplementationAssistantPanel receives projectId (loadedFileName) and contextState
  - [x] 6.2 Update ImplementationAssistantPanel invocation in ProductImplementPage
    - Pass workItemId prop from workItemId prop
    - Pass workItemTitle from selectedItem.title
    - Pass workItemType from selectedItem.type
    - Pass workItemDescription from selectedItem.description
    - Pass projectId from loadedFileName
    - Pass contextState from contextState
  - [x] 6.3 Ensure ProductImplementPage tests pass
    - Run ONLY the 2-3 tests written in 6.1
    - Verify props flow correctly to ImplementationAssistantPanel

**Acceptance Criteria:**
- The 2-3 tests written in 6.1 pass
- All required props passed from ProductImplementPage to ImplementationAssistantPanel
- Work item metadata flows correctly for context construction
- contextState available for architectureContext derivation

---

### Integration & Verification

#### Task Group 7: Test Review & Integration Verification
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and verify end-to-end integration
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 10 tests from Gateway ChatContext (Task 1.1)
    - Review 12 tests from Prompt Selection (Task 2.1)
    - Review 8 tests from Tool Bypass (Task 3.1)
    - Review 6 tests from Frontend API (Task 4.1)
    - Review 10 tests from ImplementationAssistantPanel (Task 5.1)
    - Review 3 tests from ProductImplementPage (Task 6.1)
    - Total existing tests: 49 tests
  - [x] 7.2 Analyze critical integration gaps
    - Identify end-to-end workflow: user sends message -> Gateway receives with context -> correct prompt selected -> response returned without tool calls -> Frontend displays response
    - Verify OAS ChatPanel isolation: existing ChatPanel unchanged, uses default mode
    - Verify session isolation: two chat surfaces operate independently
  - [x] 7.3 Write up to 6 additional integration tests if needed
    - Test full request/response cycle with implement_feature mode
    - Test that OAS ChatPanel still works with no mode specified
    - Test session independence between ChatPanel and ImplementationAssistantPanel
    - Test workItem context appears in Gateway logs/prompt
    - Test architectureContext appears in Gateway logs/prompt
    - Test error handling displays correctly in ImplementationAssistantPanel
  - [x] 7.4 Run all feature-specific tests
    - Run tests from Task Groups 1-6 plus integration tests from 7.3
    - Total: 58 tests (39 Gateway + 19 Frontend)
    - All tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (58 tests total)
- End-to-end workflow verified: message -> Gateway -> prompt selection -> response
- OAS ChatPanel continues to function unchanged
- Two chat surfaces operate independently with separate sessions
- implement_feature mode does not execute any MCP tools

---

## Execution Order

Recommended implementation sequence:

1. **Gateway: ChatContext Type Extension (Task Group 1)**
   - Foundation for all subsequent changes
   - No dependencies, can start immediately

2. **Gateway: Implement Feature System Prompt (Task Group 2)**
   - Depends on Task Group 1 for extended types
   - Creates the Planner-style prompt template

3. **Gateway: Tool Execution Bypass (Task Group 3)**
   - Depends on Task Groups 1 & 2
   - Modifies chat route to skip agent loop for implement_feature mode

4. **Frontend: Chat API Extension (Task Group 4)**
   - Depends on Task Group 3 (Gateway must be complete)
   - Extends TypeScript interfaces for context passing

5. **Frontend: ImplementationAssistantPanel Chat Integration (Task Group 5)**
   - Depends on Task Group 4 for API types
   - Core implementation of functional chat UI

6. **Frontend: ProductImplementPage Integration (Task Group 6)**
   - Depends on Task Group 5 for updated component
   - Wires props from parent to ImplementationAssistantPanel

7. **Integration & Verification (Task Group 7)**
   - Depends on Task Groups 1-6
   - Verifies complete feature works end-to-end

---

## Key Files Modified

### Gateway
- `gateway/src/types/chat.ts` - ChatContext interface extension
- `gateway/src/types/index.ts` - Updated type exports
- `gateway/src/services/promptBuilder.ts` - New prompt template and selection logic
- `gateway/src/routes/chat.ts` - Tool execution bypass for implement_feature mode

### Frontend
- `frontend/src/api/chatApi.ts` - ImplementChatContext interface, ChatRequest extension
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Full chat integration
- `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` - Updated styles
- `frontend/src/components/ProductView/ProductImplementPage.tsx` - Props wiring to child component

### Test Files Created
- `gateway/src/__tests__/chat-context-implement-feature.test.ts`
- `gateway/src/__tests__/prompt-selection-implement-feature.test.ts`
- `gateway/src/__tests__/tool-bypass-implement-feature.test.ts`
- `gateway/src/__tests__/implement-chat-integration.test.ts`
- `frontend/src/__tests__/implement-chat-api.test.ts`
- `frontend/src/__tests__/ImplementationAssistantPanel.test.tsx`
- `frontend/src/__tests__/ProductImplementPage-chat-props.test.tsx`

---

## Out of Scope Reminders

- Spec generation (/agent-os:write-spec) - Iteration 4
- Execution pipeline and task running - Iteration 5
- Streaming responses for implement chat
- Persisting chat history to backend database
- Changes to OAS ChatPanel behavior or styling
- Unit tests beyond the focused set per task group
- Mobile/responsive layout considerations
- Markdown rendering in chat bubbles
