# Specification: Implement Generate Specs - Iteration 4

## Goal
Extend the Implement screen Planner so that after the clarification dialog (steps 1a-1e), the user can click an Implement button to have the OpenAI Planner convert the agreed feature and architecture context into a JSON array of /agent-os:write-spec commands (step 2a), displayed read-only without execution.

## User Stories
- As a Product Owner, I want to click an Implement button after clarifying requirements so that the assistant generates structured specification commands ready for later execution.
- As a Developer, I want to see the generated specs displayed in a read-only format so that I can review them before any execution occurs.

## Specific Requirements

**Implement Button in ImplementationAssistantPanel**
- Add an Implement button adjacent to the Send button in the input area of ImplementationAssistantPanel.tsx.
- Use a distinct visual style (different background color, e.g., green or secondary accent) to differentiate from the Send button.
- Implement button is disabled when: (1) no sessionId exists (no conversation started), or (2) isLoading is true, or (3) no workItemId is provided.
- Implement button is enabled when: sessionId exists AND isLoading is false AND workItemId is present.
- Button label text: "Implement" with an optional icon indicating spec generation action.

**Implement Button Click Handler**
- On Implement button click, call postChatMessage with: sessionId (current session), message (empty string or "Proceed to implementation planning"), and context with intent: "generate_specs".
- Construct the context object with: mode: "implement_feature", intent: "generate_specs", projectId (from props), workItem (id, title, type, description), architectureContext (entityIds, diagramIds from contextState).
- Set isLoading to true during the request; handle errors similarly to handleSend.
- On success, extract the specs array from response and display it in the UI.

**Frontend ChatRequest and Context Interface Extension**
- Extend ImplementChatContext interface in chatApi.ts to allow intent: "normal_chat" | "generate_specs".
- Extend ChatResponse interface to include optional specs?: string[] field returned when intent is generate_specs.
- No changes to postChatMessage function body; it already serializes the full request object.

**Generated Specs Display Panel**
- After receiving specs from the generate_specs response, display them in a read-only modal or inline panel within ImplementationAssistantPanel.
- Each spec string is displayed in a pre-formatted code block with monospace font.
- Include a visual header: "Generated Specifications (Not Yet Executed)".
- Provide a copy-to-clipboard button for each spec or a "Copy All" button for convenience.
- Display a warning/info message that specs have not been executed and no changes have been made.

**Generated Specs State Management**
- Add new state variable generatedSpecs: string[] | null initialized to null.
- When generate_specs response is received, store the specs array in generatedSpecs state.
- Clear generatedSpecs when workItemId changes (same as sessionId/messages reset).
- The generatedSpecs panel is shown only when generatedSpecs is non-null and has length > 0.

**Gateway ChatIntent Type Extension**
- Extend ChatIntent type in gateway/src/types/chat.ts to include "generate_specs": type ChatIntent = "normal_chat" | "generate_specs".
- No changes to ChatRequest structure; intent is already part of ChatContext.

**Gateway Generate Specs System Prompt**
- Create a new system prompt template IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE in promptBuilder.ts.
- When mode is "implement_feature" and intent is "generate_specs", use this new prompt template instead of IMPLEMENT_PLANNER_PROMPT_TEMPLATE.
- Prompt instructs the model to: consider the full conversation history and clarified feature understanding, use the architectureContext as implementation constraints, produce ONLY a JSON array of strings as the response.
- Each string in the array must be a complete /agent-os:write-spec command including the YAML content inline.
- Prompt explicitly forbids: explanatory prose outside the JSON, executing commands, modifying code, calling tools, suggesting partial specs.

**Gateway Generate Specs Prompt Content**
- Include injected context: workItem (title, type, description), architectureContext (entityIds, diagramIds), and resolvedContext (if available from Iteration 3).
- Instruct the model to decide on single vs multiple incremental specs based on feature complexity.
- Specify the exact format: [ "/agent-os:write-spec ...", "/agent-os:write-spec ..." ] as a valid JSON array of strings.
- Require each /agent-os:write-spec string to include the full YAML spec content after the command prefix.
- Include example format in the prompt to guide the model output structure.

**Gateway Response Handling for Generate Specs**
- In chat.ts route handler, after receiving OpenAI response when intent is "generate_specs", attempt to parse the assistant content as JSON.
- Validate the parsed result: must be an array, each element must be a non-empty string, each string must start with "/agent-os:write-spec".
- If validation succeeds: return ChatResponse with assistant.message set to the raw JSON string, and add a new specs: string[] field with the parsed array.
- If validation fails: return ChatResponse with assistant.message containing an error explanation and no specs field.

**Gateway Validation Logic**
- Create a helper function validateGeneratedSpecs(content: string): { valid: boolean; specs?: string[]; error?: string } in a new file gateway/src/services/specsValidator.ts.
- Parse content with JSON.parse wrapped in try-catch; if parse fails, return { valid: false, error: "Response is not valid JSON" }.
- Check Array.isArray on parsed result; if false, return { valid: false, error: "Response is not a JSON array" }.
- Check each element is a non-empty string; if any fails, return { valid: false, error: "Array contains non-string elements" }.
- Check each string starts with "/agent-os:write-spec"; if any fails, return { valid: false, error: "Invalid spec format" }.
- If all checks pass, return { valid: true, specs: parsedArray }.

**Gateway ChatResponse Type Extension**
- Extend ChatResponse interface in gateway/src/types/chat.ts to include optional specs?: string[] field.
- This field is only populated when intent is "generate_specs" and validation succeeds.
- Extend AssistantResponse interface similarly if specs are nested under assistant.

**Conversation History Preservation**
- The generate_specs request reuses the same sessionId from steps 1a-1e, so OpenAI has full conversation context.
- The conversation.ts persistConversation function continues to work; the generate_specs turn is appended to history.
- If user sends another normal_chat message after generate_specs, conversation continues seamlessly.

## Existing Code to Leverage

**frontend/src/components/ProductView/ImplementationAssistantPanel.tsx**
- Contains handleSend callback pattern to replicate for handleImplement.
- Session state management (sessionId, messages, isLoading, error) to extend with generatedSpecs.
- JSX structure with inputArea div to add the Implement button alongside ChatInput.
- useEffect for workItemId change to add generatedSpecs reset.

**frontend/src/api/chatApi.ts**
- ImplementChatContext interface to extend intent field.
- ChatResponse interface to extend with optional specs field.
- postChatMessage function handles the API call; no changes needed to function body.

**gateway/src/services/promptBuilder.ts**
- buildSystemPrompt function with mode-based prompt selection pattern.
- buildImplementPlannerPrompt function structure to replicate for buildGenerateSpecsPrompt.
- formatResolvedContext helper to reuse for resolved context injection.

**gateway/src/routes/chat.ts**
- shouldBypassToolExecution pattern; extend or add condition for generate_specs intent.
- Response building pattern for ChatResponse; add specs field conditionally.
- tryResolveImplementContext function; reuse for generate_specs mode to include resolved context.

**frontend/src/components/chat/ChatInput.module.css**
- buttonRow class provides flex layout for multiple buttons.
- sendButton class provides button styling to adapt for implementButton variant.

## Out of Scope
- Executing the generated specs via Agent-OS or MCP tools.
- Storing generated specs in architecture-model-service database.
- Any MCP tool calls or changes to MCP server.
- Editing or modifying individual specs in the UI before execution.
- Streaming responses for generate_specs intent.
- Persisting generated specs to localStorage or backend.
- Changes to the OAS Chat Panel or its behavior.
- Mobile or responsive layout considerations for the specs display panel.
- Syntax highlighting or YAML parsing in the specs display.
- Retry logic for failed spec generation beyond standard error display.
