# Spec Requirements: Fix Planner JSON Regression

## Initial Description

Fix a regression in the planner chat endpoint where `sanitizePlannerMessage()` is being applied to the raw LLM content string (JSON) BEFORE `JSON.parse`, which corrupts the JSON and causes parse failure. The error at position 2226 is consistent with string mutation before parse.

The bug manifests as:
- Chat bubble showing raw JSON (assistant.message contains raw JSON)
- LHS panel being cleared/empty (plannerResponse overwritten with fallback whose structured fields are empty)

## Requirements Discussion

### First Round Questions

**Q1:** Root cause confirmation - is the issue that sanitizePlannerMessage() is applied before JSON.parse?
**Answer:** Yes, confirmed. The bug is that `sanitizePlannerMessage()` is being applied to the raw LLM content string (the JSON) BEFORE JSON.parse, which corrupts the JSON and causes parse failure. The error at position 2226 is consistent with string mutation before parse.

**Q2:** What should the parse order be?
**Answer:** Parse/extract JSON FIRST, then sanitize only the parsed `message` field (not the raw string).

**Q3:** What should happen on parse failure (fallback behavior)?
**Answer:** NEVER preserve raw content in `plannerResponse.message` or `assistant.message`. Fallback must use safe short message: "I couldn't parse the structured response. Please try again."

**Q4:** What logging is needed for parse failures?
**Answer:** Log at the point where parse/validation fails (inside validatePlannerResponse). Include: sessionId, error reason, first 200 chars of raw LLM content. Use raw LLM content (not extracted JSON) because extraction may itself fail.

**Q5:** What are the two frontend regressions observed?
**Answer:** Both regressions are happening:
1. Chat bubble shows raw JSON (assistant.message is raw JSON)
2. LHS is cleared/empty (plannerResponse overwritten with fallback whose structured fields are empty)

**Q6:** How should the frontend handle parse failures?
**Answer:** Frontend must NOT apply fallback plannerResponse to state. Gateway must NOT return raw JSON as assistant.message.

**Q7:** What test coverage is required?
**Answer:** Include automated tests for:
- Valid JSON parses and returns assistant.message = plannerResponse.message (sanitized)
- Invalid JSON returns safe assistant.message (no raw blob) and plannerResponse is null/omitted
- Frontend preserves LHS state on parse failure
- Logging is invoked on failure (spy/mock)

**Q8:** What is explicitly out of scope?
**Answer:**
- Streaming OAS endpoint (ONLY non-streaming implement_feature chat endpoint)
- ImplementerResponse (SA phase) validation
- Handoff/implementationPlan schema changes
- UI layout changes

### Existing Code to Reference

**Similar Features Identified:**
- Gateway planner response handling: `gateway/` - contains the validatePlannerResponse and sanitizePlannerMessage functions
- Frontend planner state management: `frontend/src/` - contexts and components handling planner responses

### Follow-up Questions

No follow-up questions were needed - user provided comprehensive confirmation of all requirements.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

**Part A: Gateway Fix**
- Parse order: Parse/extract JSON FIRST, then sanitize only the parsed `message` field (not the raw string)
- Fallback behavior: NEVER preserve raw content in `plannerResponse.message` or `assistant.message`
- Fallback must use safe short message: "I couldn't parse the structured response. Please try again."
- Logging: Log at the point where parse/validation fails (inside validatePlannerResponse)
- Log must include: sessionId, error reason, first 200 chars of raw LLM content
- Use raw LLM content for logging (not extracted JSON) because extraction may itself fail

**Part B: Frontend Fix**
- Frontend must NOT apply fallback plannerResponse to state (preserves LHS panel)
- Gateway must NOT return raw JSON as assistant.message (fixes chat bubble showing JSON)

**Part C: Test Coverage**
- Test: Valid JSON parses and returns assistant.message = plannerResponse.message (sanitized)
- Test: Invalid JSON returns safe assistant.message (no raw blob) and plannerResponse is null/omitted
- Test: Frontend preserves LHS state on parse failure
- Test: Logging is invoked on failure (spy/mock verification)

### Reusability Opportunities
- Existing validatePlannerResponse function in gateway (to be modified)
- Existing sanitizePlannerMessage function in gateway (reorder when called)
- Existing planner state management in frontend contexts

### Scope Boundaries

**In Scope:**
- Non-streaming implement_feature chat endpoint (planner flow)
- Gateway parse order fix
- Gateway fallback message fix
- Gateway logging enhancement
- Frontend state preservation on failure
- Automated test coverage for all above

**Out of Scope:**
- Streaming OAS endpoint
- ImplementerResponse (SA phase) validation
- Handoff/implementationPlan schema changes
- UI layout changes

### Technical Considerations
- Fix must be in gateway layer for parse order and fallback message
- Frontend must be defensive about applying fallback responses to state
- Logging should capture enough context for debugging without exposing full LLM responses
- Tests should use spies/mocks to verify logging behavior
