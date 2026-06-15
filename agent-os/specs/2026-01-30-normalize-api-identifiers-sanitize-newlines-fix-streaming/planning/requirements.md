# Spec Requirements: Normalize API Identifiers, Sanitize Newlines, Fix Streaming

## Initial Description

This spec addresses three frontend issues related to the /api/v1 integration:

1. **Normalize API Identifiers**: Company and project identifiers sent to the API need consistent normalization (trim, lowercase, whitespace-to-hyphen) before building request payloads.

2. **Sanitize Newlines in Spec Intent**: The composed spec intent message must be sanitized to remove newlines before sending to the API, as upstream parsing requires single-line messages.

3. **Fix Streaming Message Attribution**: Streaming responses need proper persona/type tracking so that messages are correctly attributed to "Software Architect" and each content delta creates a new ChatMessage bubble rather than accumulating content.

## Requirements Discussion

### First Round Questions

**Q1:** Should the identifier normalization happen in a single shared frontend util (e.g., `src/utils/normalizeIdentifier.ts`) that's called right before building `/api/v1` request payloads, or do you want it duplicated inline wherever company/project are used?
**Answer:** Yes - a single shared frontend util (e.g., `src/utils/normalizeIdentifier.ts`) called right before building /api/v1 request payloads.

**Q2:** For the normalization order, I'm assuming: (1) trim leading/trailing whitespace, (2) convert to lowercase, (3) replace one or more consecutive whitespace characters with a single hyphen. So "  Rivvy   Studios  " becomes "rivvy-studios". Is that correct?
**Answer:** Yes - trim -> toLowerCase -> replace 1+ whitespace with "-" (so "  Rivvy   Studios  " -> "rivvy-studios").

**Q3:** Should the same normalization rule apply to both company and project identifiers, or do they have different requirements?
**Answer:** Yes - apply identically to BOTH company and project.

**Q4:** For newline sanitization in the spec intent, should we replace newlines with a single space (preserving word boundaries), or completely remove them (potentially joining words)? Also, should we flatten any markdown formatting like bullet points into plain text?
**Answer:** Yes - intentional. Upstream parsing is the priority; formatting isn't needed. Single-line is required.

**Q5:** Where should the newline sanitization occur - inside `composeSpecIntent()` itself, or as a separate step right before sending the request?
**Answer:** After `composeSpecIntent()` (i.e., just before sending the request), so `composeSpecIntent` can remain reusable and you guarantee the final outbound message is newline-free.

**Q6:** For the streaming message persona fix, I'm seeing options: (a) Track streaming messages explicitly as "Software Architect" regardless of what phase the orchestration is in, or (b) Derive the persona from the current orchestration phase. Which approach fits better?
**Answer:** (a) Track streaming messages explicitly as "Software Architect" regardless of phase. Do not rely on phase staying a certain value.

**Q7:** Should the persona/type be stored on the ChatMessage object itself (so it can't change after the message is created), or looked up dynamically based on some identifier?
**Answer:** Yes - store persona/type on the ChatMessage object itself (or an equivalent stable flag) so it can't flip after completion.

**Q8:** For streaming content deltas, should each delta append to an existing ChatMessage (accumulating content), or should each delta create a new ChatMessage with only that delta's content?
**Answer:** Yes - each content/delta event creates a NEW ChatMessage (new id), `role: 'assistant'`, `content = delta` only (no accumulation).

**Q9:** If a streaming delta contains empty or whitespace-only content, should we still create a ChatMessage for it, or skip those?
**Answer:** Skip empty/whitespace-only deltas (no bubble).

**Q10:** Is there anything that should be explicitly OUT of scope for this spec? For example: changes to the backend API contracts, handling of other SSE event types like `skill_invoked`, or adding any orchestration polling/progress logic?
**Answer:** Yes - do not change backend contracts, keep `skill_invoked` ignored, and do not add orchestration polling/progress logic in this spec.

### Existing Code to Reference

No similar existing features identified for reference.

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

**Identifier Normalization:**
- Create a shared utility function at `src/utils/normalizeIdentifier.ts`
- Normalization algorithm: trim -> toLowerCase -> replace 1+ consecutive whitespace with single hyphen
- Apply to both company and project identifiers
- Call the utility right before building /api/v1 request payloads
- Example: "  Rivvy   Studios  " becomes "rivvy-studios"

**Newline Sanitization:**
- Sanitize the composed spec intent to a single line before sending to API
- Replace newlines with spaces (preserving word boundaries)
- Flatten any markdown formatting into plain text
- Apply sanitization AFTER `composeSpecIntent()` returns, immediately before sending the request
- Keep `composeSpecIntent()` reusable without side effects

**Streaming Message Attribution:**
- Track streaming messages explicitly as "Software Architect" persona
- Do NOT derive persona from orchestration phase (phases can change)
- Store persona/type directly on the ChatMessage object as a stable flag
- Persona must not flip or change after the message is created

**Streaming Delta Handling:**
- Each content/delta event creates a NEW ChatMessage with a new unique id
- Set `role: 'assistant'` on each new message
- Set `content` to ONLY the delta content (no accumulation)
- Skip empty or whitespace-only deltas (do not create bubbles for them)

### Reusability Opportunities

- The `normalizeIdentifier` utility can be reused for any future API calls requiring normalized identifiers
- The newline sanitization approach (post-compose, pre-send) keeps `composeSpecIntent` pure and reusable for other purposes

### Scope Boundaries

**In Scope:**
- Frontend utility for identifier normalization
- Newline sanitization of spec intent before API calls
- Storing persona/type on ChatMessage objects
- Creating new ChatMessage per streaming delta
- Skipping empty/whitespace deltas

**Out of Scope:**
- Backend API contract changes
- Handling `skill_invoked` SSE events (remain ignored)
- Orchestration polling or progress logic
- Any backend modifications

### Technical Considerations

- **Tech Stack**: React 18.x, TypeScript 5.x, Vite 5.x (per product tech-stack.md)
- **State Management**: React Context for application state, useState/useReducer for local state
- **Integration Points**: /api/v1 request payloads, SSE streaming response handling
- **File Location**: New utility at `src/utils/normalizeIdentifier.ts`
- **ChatMessage Structure**: Must support storing persona/type as a stable property
