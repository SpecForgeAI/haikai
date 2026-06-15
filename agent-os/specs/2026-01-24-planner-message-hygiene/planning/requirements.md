# Spec Requirements: Planner Message Hygiene

## Initial Description
Ensure the Planner (Product Owner) LLM's `message` field is a short, high-level progress update only, and does not duplicate any structured content that belongs in other JSON fields (especially openQuestions, scope, acceptanceCriteria, assumptions, featureUnderstanding). Prevent verbose or duplicative planner messages from bloating Team Chat bubbles.

Key behaviors from initialization:
- `message` must be single-paragraph, short (1-2 sentences), high-level progress summary
- If openQuestions present, message should be like: "I have N questions for you to answer."
- Gateway rewrites message if it contains duplicated structured content

In scope:
- Strengthen Planner system prompt to constrain `message` content
- Add a gateway-side "sanitization" safety net to rewrite `message` when it violates the rule
- Ensure Team Chat uses the sanitized `message` field

Out of scope:
- Any changes to planner JSON schema fields (beyond existing fields)
- Any UI layout changes
- Any changes to question/table mechanics

## Requirements Discussion

### First Round Questions

**Q1:** Where does the Planner system prompt live - in the gateway (prompt template file or prompt builder code used for the OpenAI call) or in the MCP server?
**Answer:** Yes - prompt lives in the gateway (prompt template file or prompt builder code used for the OpenAI call). Not MCP.

**Q2:** Should the sanitization be implemented as a post-processing step in the existing Planner LLM response handler (right after JSON parse/validation, before returning to frontend/persisting), or as a separate middleware/filter?
**Answer:** Implement as a post-processing step in the existing Planner LLM response handler (right after JSON parse/validation, before returning to frontend/persisting).

**Q3:** What patterns should be detected as "structured content duplication"?
**Answer:** Yes to all listed patterns, plus:
- Direct substring matches of any `openQuestions[]` content inside `message`
- "Section header" patterns (e.g., "Open Questions", "Assumptions") even without colons
- Excessive newline count (e.g., >= 2 newlines)

Full pattern list:
- Bullet point lists (lines starting with `-` or `*`)
- Numbered lists (e.g., "1.", "1)")
- Field labels like "Questions:", "Scope:", "Acceptance Criteria:"
- Multi-paragraph text (multiple newline breaks)
- Direct substring matches of openQuestions content
- Section headers without colons ("Open Questions", "Assumptions", "Scope", "Acceptance Criteria")
- >= 2 newlines in message

**Q4:** When a violation is detected, what is the rewrite approach?
**Answer:** Option A preferred - generate deterministic replacement message using N questions if present. No truncation/stripping as primary; only use truncation as last-resort fallback if needed.

Replacement templates:
- If `openQuestions.length > 0`: "I've updated my understanding, scope, and acceptance criteria. I have <N> questions for you to answer."
- Else: "I've updated my understanding, scope, and acceptance criteria based on our discussion."

**Q5:** Should sanitization events be logged/flagged?
**Answer:** Correct. Log internally (DEBUG/INFO) when sanitization happens; do not surface to the user.

**Q6:** Should there be a length constraint on the message field?
**Answer:** Enforce a character limit as additional guard (200-300 chars) in addition to pattern detection. Suggested: 300 characters as threshold.

**Q7:** Are there any edge cases or exclusions to consider?
**Answer:**
- No special verbose allowances - keep it strict
- Exclude any "smart summarization" attempts in this iteration
- Don't try to algorithmically rewrite content beyond the fixed template
- Simple, deterministic replacement only

### Existing Code to Reference
No similar existing features identified for reference.

### Follow-up Questions
None required - user provided comprehensive answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Update Planner system prompt to constrain message content to short, high-level progress updates
- Add gateway post-processing sanitization after JSON parse/validation step
- Detect violations via pattern matching (bullets, numbered lists, field labels, section headers)
- Detect violations via substring matching (openQuestions content appearing in message)
- Detect violations via structural checks (>= 2 newlines in message)
- Detect violations via length check (> 300 characters)
- Rewrite violating messages using deterministic template replacement
- Template with questions: "I've updated my understanding, scope, and acceptance criteria. I have <N> questions for you to answer."
- Template without questions: "I've updated my understanding, scope, and acceptance criteria based on our discussion."
- Log sanitization events at DEBUG/INFO level (internal only, not user-facing)

### Reusability Opportunities
- Existing Planner LLM response handler in gateway (for post-processing hook location)
- Existing prompt template/builder code in gateway (for prompt updates)

### Scope Boundaries
**In Scope:**
- Planner system prompt updates to constrain message content
- Gateway-side post-processing sanitization logic
- Pattern detection for structured content (bullets, numbered lists, field labels, section headers)
- Substring detection for openQuestions content in message
- Length constraint enforcement (300 character limit)
- Newline count enforcement (< 2 newlines)
- Deterministic template-based message replacement
- Internal logging of sanitization events

**Out of Scope:**
- Changes to planner JSON schema fields
- UI layout changes
- Question/table mechanics changes
- "Smart summarization" or algorithmic content rewriting
- User-facing notifications about sanitization
- Special verbose allowances or exceptions

### Technical Considerations
- Implementation location: Gateway service (not MCP)
- Processing stage: Post-processing after JSON parse/validation, before returning to frontend/persisting
- Replacement approach: Deterministic templates only (no truncation as primary strategy)
- Logging level: DEBUG or INFO for sanitization events
- Character limit: 300 characters as threshold
- Newline limit: Less than 2 newlines allowed
