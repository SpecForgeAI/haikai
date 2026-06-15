# Specification: Planner Message Hygiene (No Structured Content Duplication)

## Goal
Ensure the Planner LLM's `message` field is a short, high-level progress update only, and does not duplicate structured content from `openQuestions`, `scope`, `acceptanceCriteria`, or other JSON fields. Prevent verbose planner messages from bloating Team Chat bubbles.

## User Stories
- As a developer reviewing the Team Chat, I want the planner's chat bubble to be concise so I can quickly understand the conversation progress without reading duplicated structured content.
- As a product owner, I want assistant messages to be focused summaries so that the dedicated panels (Questions, Scope, Acceptance Criteria) remain the authoritative source for structured information.

## Specific Requirements

**Update Planner System Prompt with Message Constraints**
- Add explicit instruction in `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` constraining the `message` field content
- Specify that `message` must be 1-2 sentences, single-paragraph, high-level progress summary
- Instruct the LLM to NOT include bullet lists, numbered lists, or section headers in `message`
- Instruct the LLM that if questions exist, `message` should reference them without repeating their content
- Example instruction: "The message field is for chat display only - keep it brief (1-2 sentences). Do not duplicate content from openQuestions, scope, or acceptanceCriteria in the message."

**Create Message Sanitization Service**
- Create new file `gateway/src/services/plannerMessageSanitizer.ts`
- Export function `sanitizePlannerMessage(message: string, openQuestions: OpenQuestion[]): string`
- Function returns sanitized message or original if no violations detected
- Place sanitization call in `plannerResponseValidator.ts` after JSON parse, before returning `PlannerResponse`

**Implement Pattern Detection for Violations**
- Bullet point lists: lines starting with `-` or `*` (regex: `/^\s*[-*]\s/m`)
- Numbered lists: patterns like "1.", "1)", "2.", etc. (regex: `/^\s*\d+[.)]\s/m`)
- Field labels with colons: "Questions:", "Scope:", "Acceptance Criteria:", "Assumptions:" (case-insensitive)
- Section headers without colons: "Open Questions", "Assumptions", "Scope", "Acceptance Criteria" (case-insensitive)
- Multiple newlines: 2 or more newline characters (`/\n.*\n/`)
- Length exceeds 300 characters

**Implement Substring Matching for OpenQuestions**
- Check if any `openQuestions[i].question` string appears as substring within `message`
- Use case-insensitive substring matching
- Trigger sanitization if any question content is found duplicated in message
- Log which question(s) triggered the match for debugging

**Deterministic Replacement Templates**
- If `openQuestions.length > 0`: Return "I've updated my understanding, scope, and acceptance criteria. I have {N} questions for you to answer." where {N} is the count
- If `openQuestions.length === 0`: Return "I've updated my understanding, scope, and acceptance criteria based on our discussion."
- No truncation or partial stripping - always use full template replacement when violations detected

**Integrate Sanitization into Validation Flow**
- Call `sanitizePlannerMessage()` inside `validatePlannerResponse()` after successful JSON parse
- Apply sanitization before constructing the final `PlannerResponse` object
- Ensure `plannerResponse.message` in `ChatResponse` uses the sanitized value
- Sanitization runs for both `refine` and `implementation_planning` phases

**Logging for Sanitization Events**
- Log at INFO level when sanitization is triggered with reason summary
- Log at DEBUG level with details: original message length, detected patterns, replacement used
- Include `requestId` and `sessionId` in log context for traceability
- Do NOT surface sanitization events to the user (internal logging only)
- Use existing `logger` from `gateway/src/services/logger.ts`

## Visual Design
N/A - No visual mockups provided. This is a backend-only change affecting chat message content.

## Existing Code to Leverage

**`gateway/src/services/plannerResponseValidator.ts`**
- Contains `validatePlannerResponse()` function where sanitization should be integrated
- Already handles JSON extraction, parsing, and validation of PlannerResponse schema
- Transforms `openQuestions` from `string[]` to `OpenQuestion[]` with UUIDs
- Returns `PlannerValidationResult` with the validated response

**`gateway/src/services/promptBuilder.ts` - IMPLEMENT_PLANNER_PROMPT_TEMPLATE**
- System prompt template at line 82-144 for the Implementation Planner
- Contains `## FIELD GUIDELINES` section where message constraints should be added
- Current guidance on line 119: `"message": Conversational text shown to the user. Acknowledge their input, summarize understanding, ask questions.`
- Update this guidance to enforce brevity and no duplication

**`gateway/src/types/chat.ts` - PlannerResponse and OpenQuestion**
- `PlannerResponse` interface defines the structure being validated (line 341-370)
- `OpenQuestion` interface with `id` and `question` fields (line 324-329)
- `message` field is currently typed as `string` with description "Chat bubble text"

**`gateway/src/services/logger.ts`**
- Winston-based structured logger with JSON output
- Supports levels: error, warn, info, debug
- Use `logger.info()` and `logger.debug()` for sanitization events

**`gateway/src/routes/chat.ts` - Response Construction**
- Lines 638-648 show how `plannerResponse.message` is used in `ChatResponse`
- The `assistant.message` is overwritten with `validationResult.plannerResponse.message`
- Sanitization must occur before this point to ensure sanitized message reaches frontend

## Out of Scope
- Changes to planner JSON schema fields (the schema remains unchanged)
- UI layout changes or frontend modifications
- Question/table mechanics changes in the Implement panel
- "Smart summarization" or AI-powered content rewriting (only use fixed templates)
- User-facing notifications or alerts about sanitization
- Special verbose allowances or exceptions for any scenario
- Changes to `implementation_clarification` phase or `ImplementerResponse`
- Truncation as primary strategy (only deterministic replacement)
- Modifying how `openQuestions` are displayed in the UI
- Any changes to the streaming chat endpoint
