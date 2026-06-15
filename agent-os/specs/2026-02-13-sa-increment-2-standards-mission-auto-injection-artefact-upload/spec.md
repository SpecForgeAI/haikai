# Specification: SA Increment 2 -- Standards + MISSION Auto-Injection + Artefact Upload

## Goal
Enhance the Solution Architect mode so that every SA turn automatically receives MISSION.MD (business context) and TECH-STACK.MD (technical standards) injected into the system prompt, enforce a gateway-level short-circuit when standards are missing, and ensure user-uploaded artefacts flow through the existing pipeline to OpenAI without persisting artefact content to any on-disk file.

## User Stories
- As a Solution Architect user, I want the SA to automatically reason against my product mission and tech standards so that architecture decisions are grounded in established project context without me manually providing those files.
- As a Solution Architect user, I want to upload reference documents (files or URLs) that the SA uses for reasoning, without those large document contents polluting my conversation history on disk.

## Specific Requirements

**Auto-load MISSION.MD into system prompt on every SA turn**
- In `chat.ts`, before `buildSystemPrompt` is called, read `<projectParentFolder>/agent-os/product/MISSION.MD` using `fs.readFile` (async)
- Fall back to `mission.md` (lowercase) if the uppercase file is not found; use try/catch on each read attempt
- Construct `projectParentFolder` from `context.projectParentFolder` which is already sent by `buildSolutionArchitectContext` in the frontend (line 79 of SolutionArchitectChatPanel.tsx)
- If neither casing exists, proceed gracefully without mission content (MISSION.MD absence is NOT a hard stop)
- Truncate content at 50KB to match the existing size limit convention in `buildAugmentedMessage`

**Auto-load TECH-STACK.MD into system prompt on every SA turn**
- Read `<projectParentFolder>/agent-os/product/TECH-STACK.MD`, falling back to `tech-stack.md` (lowercase)
- If neither casing exists, trigger the standards-missing short-circuit (see next requirement)
- Truncate content at 50KB

**Standards-missing short-circuit (gateway-level, no LLM call)**
- If TECH-STACK.MD is not found (neither casing), the gateway must return a deterministic `ChatResponse` immediately with `assistant.message` set to `"Project standards have not been generated. Please generate standards before proceeding."`
- This short-circuit must occur BEFORE `buildSystemPrompt`, BEFORE `buildAugmentedMessage`, BEFORE `sendChatRequest`, and BEFORE the SA validation block (lines 781-881 in chat.ts)
- The short-circuit must still persist the user message and the deterministic assistant response into the session conversation via `persistConversation`, so the halt message appears in rehydrated conversations
- Include a `solutionArchitectResponse` in the response using a purpose-built fallback object with `phase: "questions"`, `section: "context_and_boundaries"`, empty questions, and the halt message as summary, so the frontend SA rendering does not break

**Inject MISSION and TECH-STACK content into the SA system prompt**
- Pass the loaded file contents as new parameters to `buildSystemPrompt` (or to a new SA-specific helper called from the SA branch)
- Since `buildSystemPrompt` is synchronous and file reads are async, perform the reads in `chat.ts` and pass content strings into the prompt builder
- Append the content after `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` using delimited headers: `=== PRODUCT MISSION ===` followed by the mission content, then `=== TECHNICAL STANDARDS ===` followed by the tech-stack content
- If mission content is absent (file not found), omit the PRODUCT MISSION section entirely

**Update SOLUTION_ARCHITECT_PROMPT_TEMPLATE with alignment instructions**
- Add a new section (e.g., `## CONTEXT ALIGNMENT`) to the template instructing the SA that architecture decisions must align with the injected PRODUCT MISSION context and technology choices must align with the injected TECHNICAL STANDARDS context
- Instruct the SA to never output or quote the mission or standards content to the user; use them only as internal reasoning context
- Keep additions concise (5-8 lines) and place them after the existing `## RULES - DO NOT VIOLATE` section

**Artefact upload via existing buildAugmentedMessage pipeline**
- No changes needed to `buildAugmentedMessage` itself; it already handles file paths and URLs with 50KB limits and error handling
- The SA frontend already sends `sources` in `postChatMessage` via `handleSendWithSources` (line 348 of SolutionArchitectChatPanel.tsx)
- The augmented message (with artefact content appended) is sent to OpenAI as the user message; this is the existing behavior and requires no modification

**Prevent artefact content from persisting to disk**
- Currently, `buildMessagesForTurn` at line 501 of chat.ts builds the messages array using `augmentedMessage` (which includes artefact content), and this full array is passed to `persistConversation` at line 637
- For `solution_architect` mode when `sources` are present: before calling `persistConversation`, replace the last user message in the `messages` array with the original `message` (not the `augmentedMessage`)
- One approach: after the assistant response is appended to `messages` (line 626), rebuild the persistence array by finding the user message entry and swapping its content from `augmentedMessage` to `message`
- This ensures `conversation.json` (via `updateSession`) contains only the short user sharing message, not the full document text
- The `shouldAppendToTranscript` function already returns `false` for `solution_architect` mode (line 134-136), so `full-conversation.txt` transcript is not a concern for SA mode

**buildSystemPrompt signature extension**
- Add two optional string parameters to `buildSystemPrompt`: `missionContent?: string` and `techStackContent?: string`
- In the SA branch (line 1355-1356 of promptBuilder.ts), use these parameters to append the delimited context sections to the returned prompt string
- All existing callers pass `undefined` for these new params, maintaining backward compatibility

## Visual Design
No visual assets provided. The frontend is already fully wired (UploadDocumentsModal, handleSendWithSources, sources field in postChatMessage). No frontend UI changes are required.

## Existing Code to Leverage

**buildAugmentedMessage in gateway/src/routes/chat.ts (lines 294-320)**
- Reads local files and URLs, appends to user message with 50KB per-source size limit
- Already called for SA mode at line 498; no modifications needed to this function
- Provides the pattern for file reading (try/catch, fs.readFile, size truncation) to replicate for MISSION.MD and TECH-STACK.MD loading

**buildSystemPrompt SA branch in gateway/src/services/promptBuilder.ts (lines 1353-1357)**
- Currently returns bare `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` with no dynamic context injection
- This is the exact insertion point for appending MISSION.MD and TECH-STACK.MD content
- The function signature needs extension with two optional string parameters

**persistConversation in gateway/src/services/conversation.ts (lines 95-119)**
- Filters out system messages, applies truncation, then calls `updateSession` with the conversation
- The modification point is in chat.ts BEFORE calling this function: swap augmented user content with original message content
- The function itself does not need modification

**SolutionArchitectChatPanel in frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx**
- Already sends `projectParentFolder` in context (line 79 via `buildSolutionArchitectContext`)
- Already has UploadDocumentsModal integrated (lines 541-545) and handleSendWithSources (lines 328-375)
- Already sends `sources` field in postChatMessage call (line 348)
- No frontend changes required

**SA validation with corrective retry in gateway/src/routes/chat.ts (lines 781-881)**
- The standards-missing short-circuit must be placed before this block in the request flow
- The short-circuit response must include a valid `solutionArchitectResponse` object so the frontend SA panel renders correctly

## Out of Scope
- Architecture meta-model writes or any persistence of architecture decisions
- MCP save tool for architecture artifacts
- Diagram creation or generation
- Modification of Product Manager behavior or PM prompt templates
- Structured extraction or parsing of uploaded artefact content
- Disabling the upload button when standards are missing
- Visual indicators showing that MISSION.MD or TECH-STACK.MD have been loaded
- Any changes to the UploadDocumentsModal component
- Any changes to the SolutionArchitectChatPanel frontend component
- Conversation reset or "start over" functionality
