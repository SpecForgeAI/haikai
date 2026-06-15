# Specification: Implement Assistant Stage 5 — Structured Refinement Loop for Feature Intent Locking

## Goal
Enhance the `phase=refine` system prompt in implement_feature mode to enforce a structured conversational protocol that guides the user through a disciplined refinement loop, culminating in an unambiguous, implementation-ready feature definition.

## User Stories
- As a product owner, I want the assistant to replay my feature description back to me so that I can verify it understood my intent correctly
- As a developer, I want the assistant to surface explicit assumptions and ask focused clarifying questions so that we converge on unambiguous requirements before implementation begins

## Specific Requirements

**Replace IMPLEMENT_PLANNER_PROMPT_TEMPLATE with Structured Protocol**
- Update the prompt template in `gateway/src/services/promptBuilder.ts` (lines 44-91)
- The new template must enforce a 4-part response structure on every assistant reply during refine phase
- Keep all existing placeholders: `{workItemTitle}`, `{workItemType}`, `{workItemDescription}`, `{entityIds}`, `{diagramIds}`, `{resolvedContext}`
- Maintain the same `buildImplementPlannerPrompt()` function signature and replacement logic

**Part 1: Restate (Replay) Current Understanding**
- Instruct the assistant to replay the user's feature definition in concise, structured form
- Include subsections: feature goal/user value, scope (in-scope/out-of-scope), primary flows (happy path), key edge cases (if mentioned), dependencies/integrations (if mentioned)
- Keep the replay concise and structured using bullet points or short paragraphs
- This section should appear first in every assistant response

**Part 2: Explicit Assumptions List**
- Instruct the assistant to enumerate any assumptions it is making as a bulleted list
- Each assumption should be specific and falsifiable
- If no assumptions exist, the assistant should state "No assumptions at this time"
- Assumptions must be grounded in provided context (work item, architecture, highlighted entities)

**Part 3: Focused Clarifying Questions**
- Instruct the assistant to ask 3-7 focused, answerable questions that block implementation
- Questions must be specific (not vague or open-ended)
- Prefer fewer questions when possible; only ask what is truly blocking
- If no blocking questions remain, state "No blocking questions remain"

**Part 4: Proposed Final Feature Definition (When Ready)**
- When all questions are answered and assumptions confirmed, present a "Proposed Final Feature Definition" section
- This section should be a single coherent description suitable for an implementor
- The prompt must explicitly forbid automatic transition to `phase=handoff`; only the user's Implement button triggers handoff
- Mark the definition as proposed, awaiting user confirmation

**Response Behavior Rules**
- Avoid speculative implementation details unless explicitly requested by the user
- Avoid introducing new requirements that the user did not mention
- Use background context (work item) and highlighted context (resolved entities/diagrams) to ground clarifications
- Prefer clarity and determinism over verbosity
- Reference entities by their names from resolved context, not by raw IDs

**Preserve Existing Prompt Sections**
- Keep the WORK ITEM CONTEXT section with title, type, description
- Keep the LINKED ARCHITECTURE CONTEXT section with entityIds and diagramIds
- Keep the RESOLVED ARCHITECTURE CONTEXT section with `{resolvedContext}` placeholder
- Keep the existing DO NOT VIOLATE rules (no /agent-os:write-spec, no code generation, no MCP tools)

**Do Not Modify Other Prompts**
- Leave IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE unchanged (bootstrap phase behavior preserved)
- Leave IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE unchanged (handoff phase behavior preserved)
- Leave SYSTEM_PROMPT_TEMPLATE unchanged (OAS assistant mode preserved)

## Visual Design
No visual mockups provided; this is a gateway-only prompt change with no frontend UI modifications.

## Existing Code to Leverage

**`gateway/src/services/promptBuilder.ts` - IMPLEMENT_PLANNER_PROMPT_TEMPLATE (lines 44-91)**
- Current template defines CONVERSATION PROCESS with steps 1a-1e (replay, ask, incorporate, repeat, confirm)
- Template uses placeholders for work item and architecture context injection
- Existing RULES section can be preserved and extended with the new protocol constraints
- `buildImplementPlannerPrompt()` function handles placeholder replacement

**`gateway/src/services/promptBuilder.ts` - formatResolvedContext() (lines 477-512)**
- Formats resolved entities and diagrams as compact JSON for prompt injection
- Used to populate `{resolvedContext}` placeholder
- Output should be referenced in the new prompt as source for grounding clarifications

**`gateway/src/services/promptBuilder.ts` - formatHighlightedContext() (lines 526-568)**
- Formats highlighted entities with name, type, category, and relevant fields
- Pattern can inform how the assistant should reference architecture elements in its responses

**`gateway/src/types/chat.ts` - ChatPhase type (line 36)**
- Defines `'bootstrap' | 'refine' | 'handoff'` union type
- No changes needed; refine phase already exists and is routed correctly

**`gateway/src/routes/chat.ts` - Phase routing (lines 227-239)**
- Routes refine phase to `buildImplementPlannerPrompt()` via `buildSystemPrompt()`
- No changes needed; existing routing correctly handles `phase=refine`

## Out of Scope
- No new phases (e.g., "finalize") introduced in this stage
- No automatic "ready" detection that triggers handoff; only the user Implement button triggers handoff
- No conversation transcript persistence to disk
- No changes to backend domain models or storage
- No frontend UI changes; all changes are gateway prompt-only
- No changes to bootstrap phase (`phase=bootstrap`) behavior
- No changes to handoff phase (`phase=handoff`) behavior
- No changes to OAS assistant mode (`mode=oas_assistant`)
- No changes to implement context resolution logic in `chat.ts`
- No addition of new API endpoints or request/response fields
