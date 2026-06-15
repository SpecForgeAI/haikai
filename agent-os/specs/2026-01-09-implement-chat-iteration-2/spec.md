# Specification: Implement Chat - Planner Conversation Loop (Iteration 2)

## Goal
Add a dedicated Planner conversation loop to the Implement screen using the existing /api/chat endpoint, powered by an OpenAI model with a new implement_feature mode, enabling structured exploratory dialog (steps 1a-1e) without generating specs or executing commands.

## User Stories
- As a Product Owner, I want to chat with an AI assistant about my selected work item so that I can clarify requirements before implementation begins.
- As a Developer, I want the assistant to ask clarifying questions and confirm understanding so that the final specification captures all necessary details.

## Specific Requirements

**ImplementationAssistantPanel Chat Activation**
- Replace the current disabled placeholder input/button with functional ChatInput and ChatMessageList components from the existing chat component library.
- Display an empty state message when no messages exist: "Start a conversation to clarify this work item."
- Show scrollable message history once conversation begins using ChatMessageList pattern.
- Maintain header "Implementation Assistant" and overall panel layout structure.

**Session Management per Work Item**
- Maintain a per-work-item chat sessionId in component state, initialized to null.
- On first message send, call /api/chat without sessionId; store the returned sessionId from response.
- Reuse the stored sessionId for all subsequent messages tied to the same work item.
- When workItemId prop changes (user navigates to different work item), clear the sessionId and message history to start fresh.
- Store messages in component state (not localStorage) since sessions are ephemeral per page load.

**Chat Request Payload Structure**
- Extend the frontend ChatRequest interface to include optional context object.
- POST to /api/chat with: message, sessionId (optional on first call), and context object.
- Context object includes: mode ("implement_feature"), intent ("normal_chat"), projectId, workItemId, workItemTitle, workItemType, workItemDescription.
- Context object includes architectureContext: { entityIds: string[], diagramIds: string[] } derived from contextState.entity_refs and contextState.diagram_refs.
- Pass workItemId, workItemTitle, workItemType, workItemDescription from ProductImplementPage props through to ImplementationAssistantPanel.

**Frontend Chat API Extension**
- Extend chatApi.ts ChatRequest interface to include context?: ImplementChatContext.
- Create ImplementChatContext interface with mode, intent, projectId, workItemId, workItemTitle, workItemType, workItemDescription, architectureContext.
- The postChatMessage function already serializes the request body; context object will be included automatically.

**Gateway ChatContext Type Extension**
- Extend the ChatContext interface in gateway/src/types/chat.ts to include new optional fields for implement_feature mode.
- Add mode?: "oas_assistant" | "implement_feature" (default behavior is oas_assistant when undefined).
- Add intent?: "normal_chat" (extensible for future intents like "generate_spec").
- Add workItem?: { id, title, type, description } object for work item metadata.
- Add architectureContext?: { entityIds: string[], diagramIds: string[] } for linked entities/diagrams.

**Gateway System Prompt Selection**
- Modify buildSystemPrompt in gateway/src/services/promptBuilder.ts to select prompt based on context.mode.
- When mode is undefined or "oas_assistant", use existing SYSTEM_PROMPT_TEMPLATE (current OAS assistant behavior).
- When mode is "implement_feature" and intent is "normal_chat", use new IMPLEMENT_PLANNER_PROMPT_TEMPLATE.
- The implement_feature prompt instructs the model to conduct Planner-style exploratory back-and-forth (steps 1a-1e).

**Implement Feature System Prompt Content**
- Prompt must instruct the model to: (1a) Replay understanding of the feature in its own words, (1b) Ask clarifying questions and surface explicit assumptions, (1c) Incorporate user responses and refine understanding, (1d) Repeat until understanding appears complete, (1e) Ask whether user is satisfied and ready to proceed.
- Prompt must explicitly forbid: emitting /agent-os:write-spec, generating implementation steps or code, taking actions on behalf of the user, calling MCP tools.
- Prompt must include injected context: workItem.title, workItem.type, workItem.description, linked entityIds, linked diagramIds.
- Prompt should instruct responses to be concise and grounded in the provided work item and architecture context.

**Gateway Tool Execution Bypass**
- When mode is "implement_feature", skip the agent loop that executes tool calls (lines 96-163 in chat.ts).
- Return the OpenAI response directly without attempting MCP tool execution.
- This ensures no side effects occur during the clarification phase.
- The existing sendChatRequest call returns { content, isFinal, toolCalls }; when mode is implement_feature, treat response as always final.

**OAS Chat Panel Isolation**
- The existing ChatPanel component in frontend/src/components/chat/ remains unchanged.
- It continues to use the default OAS assistant mode (no mode field in context).
- ImplementationAssistantPanel uses its own chat state and passes mode: "implement_feature" in context.
- Two chat surfaces operate independently with separate sessions.

## Visual Design
No visual mockups provided. Follow existing patterns from ChatPanel, ChatMessageList, ChatInput, and ChatBubble components for consistent styling.

## Existing Code to Leverage

**frontend/src/components/chat/ChatPanel.tsx**
- Demonstrates session management pattern: sessionId state, first-message session creation, subsequent reuse.
- Shows integration of ChatMessageList and ChatInput components.
- Provides error handling and loading state patterns to replicate.

**frontend/src/components/chat/ChatInput.tsx**
- Reusable input component with onSend callback, disabled state, and Enter-to-send behavior.
- Can be imported directly into ImplementationAssistantPanel.

**frontend/src/components/chat/ChatMessageList.tsx and ChatBubble.tsx**
- Reusable message display components with auto-scroll behavior.
- ChatBubble provides role-based styling (user vs assistant).
- Can be imported directly into ImplementationAssistantPanel.

**frontend/src/api/chatApi.ts**
- Existing postChatMessage function handles fetch to /api/chat.
- Extend ChatRequest interface to include optional context field.
- Function body already uses JSON.stringify(request), so context will serialize automatically.

**gateway/src/services/promptBuilder.ts**
- buildSystemPrompt function handles context injection into prompt template.
- Add conditional logic to select between OAS and Implement prompts based on context.mode.
- Follow existing pattern of placeholder replacement for context values.

## Out of Scope
- Spec generation (/agent-os:write-spec command output) - deferred to Iteration 4.
- Execution pipeline and task running - deferred to Iteration 5.
- LLM tool calls via MCP during implement_feature mode.
- Streaming responses for implement chat (use non-streaming POST endpoint only).
- Persisting chat history to backend database (in-memory/component-state only).
- Changes to the Architecture & Design OAS chat panel behavior or styling.
- New REST endpoints beyond extending existing /api/chat payload schema.
- Unit tests for new components (testing scope defined separately).
- Mobile or responsive layout considerations.
- Markdown rendering in chat bubbles (plain text only for this iteration).
