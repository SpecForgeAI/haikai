# Spec Requirements: Implement Assistant Stage 2 - Phased Conversations

## Initial Description

Introduce an explicit "phase" concept for Implement Assistant conversations while preserving existing behavior. This change lays the groundwork for future staged interactions (bootstrap, refinement, handoff) without yet introducing new context sources or altering user-visible functionality.

Key points from raw idea:
- Add a "phase" field to Implement Assistant chat requests
- Default phase is "refine" for normal discussion
- Phase is "handoff" when user clicks the "Implement" button
- Gateway selects system prompt based on phase value
- No UX changes - phase is invisible metadata
- Frontend and Gateway changes only (no backend changes)

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea mentions extending "all Implement Assistant chat requests" with a phase field. I assume this means modifying the chat request payload structure in the frontend's API call layer. Is that correct, or is there a different mechanism for sending chat requests?
**Answer:** Yes, this means modifying the chat request payload structure in the frontend's API call layer. Look for where `ImplementChatContext` is defined and where chat API calls are made.

**Q2:** I'm assuming the "Implement" button that triggers `phase: "handoff"` is a distinct button separate from the regular "Send" button in the chat interface. Is that correct, or is it the same button with different behavior based on context?
**Answer:** Yes, the "Implement" button is distinct from the regular "Send" button. It's a separate action that triggers spec generation. Look for a button labeled "Implement" or "Generate" or similar that triggers a different type of request.

**Q3:** For the Gateway's prompt selection, I assume there are already two separate prompt templates - one for regular conversation ("planner prompt") and one for generating specs ("generate specs prompt"). Should we simply map: `phase=refine` -> existing planner prompt, `phase=handoff` -> existing generate specs prompt? Or is there currently only one prompt template that needs to be duplicated?
**Answer:** Yes, there are likely already two separate code paths: Regular chat uses a "planner prompt" for conversation, the "Implement" action uses a "generate specs prompt". Map: `phase=refine` -> existing planner prompt, `phase=handoff` -> existing generate specs prompt. Analyze the Gateway to confirm this structure.

**Q4:** I assume the phase field should be a string literal type (e.g., `"refine" | "handoff"`) rather than an enum or numeric value. Is that the preferred approach?
**Answer:** Yes, use a string literal type: `phase?: "refine" | "handoff"`. This is cleaner than enums for simple two-value cases.

**Q5:** For error handling, if the Gateway receives an unknown phase value, the raw idea says to default to `phase=refine`. Should this also log a warning for debugging purposes, or silently default without logging?
**Answer:** Yes, log a WARN level message when an unknown phase is received, then default to "refine". This aids debugging without breaking functionality.

**Q6:** Is there anything specific that should NOT be included in this implementation?
**Answer:** Explicitly avoid:
- Adding UI indicators showing the current phase (no UX changes)
- Persisting phase to conversation history
- Analytics/telemetry for phase transitions
- Any changes to implement-context resolution logic
- Any changes to model selection or token budgeting

### Existing Code to Reference

**Similar Features Identified:**

Frontend:
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Main chat component
- `frontend/src/api/chatApi.ts` - Where `ImplementChatContext` is defined and `postChatMessage` function sends requests

Gateway:
- `gateway/src/routes/chat.ts` - Chat route handler
- `gateway/src/services/promptBuilder.ts` - Where prompt templates are defined and selected
- `gateway/src/types/chat.ts` - Where `ChatContext`, `ChatIntent`, and related types are defined

### Follow-up Questions

No follow-up questions were needed - the initial answers were comprehensive.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - this is invisible infrastructure with no UX changes.

## Requirements Summary

### Functional Requirements

**Frontend Changes:**

1. **Add `phase` field to `ImplementChatContext` interface** (in `frontend/src/api/chatApi.ts`):
   - Type: `phase?: "refine" | "handoff"`
   - Optional field to maintain backward compatibility

2. **Modify `buildContext` function** (in `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`):
   - For `handleSend` (normal chat): Set `phase: "refine"`
   - For `handleImplement` (Implement button): Set `phase: "handoff"`

3. **Current code analysis findings:**
   - `ImplementationAssistantPanel.tsx` (lines 218-240): `buildContext()` function constructs `ImplementChatContext` with `intent` field
   - Currently uses `intent: 'normal_chat'` for Send button (line 261)
   - Currently uses `intent: 'generate_specs'` for Implement button (line 319)
   - The `postChatMessage()` function (line 264, 322) sends requests to Gateway
   - **Key insight**: The existing `intent` field already distinguishes between normal chat and generate specs - the new `phase` field will provide an additional semantic layer

4. **Existing types in `chatApi.ts`:**
   - `ImplementChatIntent = 'normal_chat' | 'generate_specs'` (line 47)
   - `ImplementChatContext` interface (lines 53-68) - needs new `phase` field

**Gateway Changes:**

1. **Add `phase` field to `ChatContext` interface** (in `gateway/src/types/chat.ts`):
   - Type: `phase?: "refine" | "handoff"`
   - Add new `ChatPhase` type: `"refine" | "handoff"`

2. **Modify `buildSystemPrompt` function** (in `gateway/src/services/promptBuilder.ts`):
   - Current logic (lines 159-176):
     - If `mode === 'implement_feature'` and `intent === 'generate_specs'` -> use `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE`
     - If `mode === 'implement_feature'` (and intent is normal_chat or undefined) -> use `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`
   - **New logic should map:**
     - `phase === 'handoff'` -> use `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE`
     - `phase === 'refine'` or undefined/unknown -> use `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`
   - Log WARN when unknown phase is received

3. **Current prompt templates confirmed:**
   - `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` (lines 43-90): For refinement/clarification dialog
   - `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE` (lines 98-148): For generating specs

4. **No changes needed to:**
   - `chat.ts` route handler - it already passes context to `buildSystemPrompt`
   - Context resolution logic (`tryResolveImplementContext`)
   - Tool execution bypass logic (`shouldBypassToolExecution`)
   - Session management, token budgeting, or model selection

### Reusability Opportunities

1. **Existing `intent` field pattern**: The current implementation uses `intent: 'normal_chat' | 'generate_specs'` which is very similar to the proposed `phase` field. The spec-writer should consider:
   - Whether `phase` should replace `intent` or be additive
   - The relationship between `intent` and `phase` (they currently map 1:1)

2. **Type definition patterns**: Follow the existing pattern in `gateway/src/types/chat.ts` for defining `ChatPhase` type

3. **Prompt selection pattern**: Follow the existing branching logic in `buildSystemPrompt` function

### Scope Boundaries

**In Scope:**
- Add `phase` field to `ImplementChatContext` (frontend) and `ChatContext` (gateway)
- Set `phase: "refine"` for Send button actions
- Set `phase: "handoff"` for Implement button actions
- Gateway routes `phase=refine` to planner prompt, `phase=handoff` to generate specs prompt
- Log WARN when unknown phase received, default to "refine"

**Out of Scope:**
- UI indicators showing current phase
- Persisting phase to conversation history or disk
- Analytics/telemetry for phase transitions
- Changes to implement-context resolution logic
- Changes to model selection or token budgeting
- New phases beyond "refine" and "handoff"
- Any changes to prompt template content (only routing logic changes)

### Technical Considerations

1. **Backward Compatibility**: The `phase` field should be optional to maintain backward compatibility with existing requests

2. **Relationship with `intent`**: The raw idea mentions that the current `intent` field serves a similar purpose. The implementation should clarify:
   - `intent` = what the user wants to accomplish (normal_chat vs generate_specs)
   - `phase` = which stage of the workflow the conversation is in (refine vs handoff)
   - Currently these map 1:1, but the phase concept enables future phases like "bootstrap"

3. **Logging**: Use existing `logger.warn()` pattern for unknown phase values

4. **Testing**: Follow patterns in `gateway/src/__tests__/prompt-selection-implement-feature.test.ts` for new phase-based tests
