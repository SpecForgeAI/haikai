# Specification: Implement Assistant Stage 2 - Phased Conversations

## Goal
Introduce an explicit "phase" field for Implement Assistant conversations to distinguish between refinement dialog and implementation handoff, laying groundwork for future staged workflows while preserving existing behavior.

## User Stories
- As a developer using the Implement Assistant, I want the system to track which phase of conversation I'm in so that future workflow improvements can be built on a solid foundation.
- As a system maintainer, I want phase metadata captured in requests so that I can evolve the assistant toward more deterministic staged behavior.

## Specific Requirements

**Add phase field to ImplementChatContext interface**
- File: `frontend/src/api/chatApi.ts`
- Add new type: `export type ImplementChatPhase = 'refine' | 'handoff';`
- Add field to `ImplementChatContext` interface (lines 53-68): `phase?: ImplementChatPhase`
- Field is optional for backward compatibility
- Place type definition near `ImplementChatIntent` (line 47) for consistency

**Modify buildContext function to include phase**
- File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- Update `buildContext` function (lines 218-240) to accept a `phase` parameter
- When building context, include the `phase` field in the returned object
- The phase should be determined by the calling handler, not inferred from intent

**Set phase to "refine" for normal chat messages**
- File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- In `handleSend` function (line 245), when calling `buildContext('normal_chat')` (line 261)
- Pass `phase: 'refine'` to buildContext or include it in the returned context
- This represents the exploratory dialog phase (steps 1a-1e in the workflow)

**Set phase to "handoff" for Implement button**
- File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- In `handleImplement` function (line 305), when calling `buildContext('generate_specs')` (line 319)
- Pass `phase: 'handoff'` to buildContext or include it in the returned context
- This represents transition from clarification to spec generation

**Add phase field to Gateway ChatContext interface**
- File: `gateway/src/types/chat.ts`
- Add new type: `export type ChatPhase = 'refine' | 'handoff';`
- Add field to `ChatContext` interface (lines 51-82): `phase?: ChatPhase`
- Place type definition near `ChatIntent` (line 21) for consistency

**Update buildSystemPrompt to use phase for prompt selection**
- File: `gateway/src/services/promptBuilder.ts`
- Modify `buildSystemPrompt` function (lines 159-176) to check `context.phase` value
- For `phase === 'handoff'`: use `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE`
- For `phase === 'refine'` or undefined/unknown: use `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`
- Existing `intent` check can remain as fallback for backward compatibility

**Add warning log for unknown phase values**
- File: `gateway/src/services/promptBuilder.ts`
- When `context.phase` is present but not 'refine' or 'handoff'
- Log a WARN level message: "Unknown phase value received: {phase}, defaulting to refine"
- Import logger if not already imported in file
- Then default to using `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`

**Update buildContextSummary for logging**
- File: `gateway/src/services/promptBuilder.ts`
- In `buildContextSummary` function (lines 327-368), add phase to logged summary
- Add `summary.phase = context.phase` when phase is present (similar to intent at line 346)

## Visual Design
No visual assets provided - this is invisible infrastructure with no UX changes.

## Existing Code to Leverage

**ImplementChatIntent type pattern**
- Location: `frontend/src/api/chatApi.ts` line 47
- Pattern: `export type ImplementChatIntent = 'normal_chat' | 'generate_specs';`
- Use identical string literal union type pattern for `ImplementChatPhase`

**ChatIntent type pattern in Gateway**
- Location: `gateway/src/types/chat.ts` line 21
- Pattern: `export type ChatIntent = 'normal_chat' | 'generate_specs';`
- Use identical pattern for `ChatPhase` type definition

**buildSystemPrompt branching logic**
- Location: `gateway/src/services/promptBuilder.ts` lines 164-172
- Current logic: checks `context.mode === 'implement_feature'` then `context.intent === 'generate_specs'`
- Extend with phase check before or alongside intent check

**buildContext function structure**
- Location: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` lines 218-240
- Function accepts intent parameter and builds complete context object
- Add phase parameter following same pattern

**buildContextSummary pattern**
- Location: `gateway/src/services/promptBuilder.ts` lines 341-347
- Shows pattern for adding optional fields to summary: `if (context.intent) { summary.intent = context.intent; }`
- Follow same pattern for phase field

## Out of Scope
- Adding UI indicators showing the current phase to the user
- Persisting phase to conversation history, disk, or database
- Analytics or telemetry for phase transitions
- Changes to implement-context resolution logic (tryResolveImplementContext)
- Changes to model selection or token budgeting
- New phases beyond "refine" and "handoff"
- Changes to prompt template content (only routing logic changes)
- Changes to tool execution bypass logic (shouldBypassToolExecution)
- Changes to session management
- Removing or replacing the existing intent field
