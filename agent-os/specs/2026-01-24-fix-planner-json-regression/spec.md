# Specification: Fix Planner JSON Parsing Regression

## Goal
Fix a regression where `sanitizePlannerMessage()` corrupts JSON by being applied before `JSON.parse`, causing parse failures and exposing raw JSON in the chat UI while clearing the LHS Feature Definition panel.

## User Stories
- As a user of the Implementation Assistant, I want planner responses to parse correctly so that my chat shows readable messages and the Feature Definition panel displays structured content.
- As a developer debugging planner issues, I want parse failures logged with context so that I can diagnose problems efficiently.

## Specific Requirements

**Part A.1: Fix Parse Order in validatePlannerResponse**
- Parse/extract JSON FIRST using existing `extractJson()` function before any sanitization
- Apply `sanitizePlannerMessage()` ONLY to the parsed `message` field after successful JSON parse and validation
- Current code already follows this order (parse first, then sanitize in Step 10), so verify the actual call site in chat.ts is not pre-sanitizing
- The issue is likely that `sanitizePlannerMessage()` is being called on raw content somewhere outside validatePlannerResponse

**Part A.2: Fix Fallback Response Handling**
- `createFallbackPlannerResponse()` currently accepts `rawMessage` and puts it in the message field - this is wrong
- Change fallback to use a safe short message: "I couldn't parse the structured response. Please try again."
- NEVER include raw LLM content (which may be JSON) in `plannerResponse.message` or `assistant.message`
- Gateway fallback path in chat.ts (lines 657-674) currently calls `createFallbackPlannerResponse(response.content)` - fix this

**Part A.3: Add Logging for Parse/Validation Failures**
- Log at the point where parse/validation fails inside `validatePlannerResponse`
- Log must include: sessionId (passed as new parameter), error reason, first 200 chars of raw LLM content
- Use the original raw content parameter (not extracted JSON) for logging since extraction may fail
- Log level: WARN for visibility in production logs
- Add sessionId parameter to validatePlannerResponse function signature

**Part B.1: Gateway Must Not Return Raw JSON as assistant.message**
- When validation fails, `chatResponse.assistant.message` must be the safe fallback message, not raw content
- The current code at lines 657-674 sets `plannerResponse: fallback` but does NOT override `assistant.message`
- Fix: also set `assistant.message` to the safe fallback message when validation fails

**Part B.2: Frontend Must Not Apply Fallback plannerResponse to State**
- In ImplementationAssistantPanel, when `response.plannerResponse` is a fallback (has empty structured fields), do NOT call `setLatestPlannerResponse`
- Preserve the previous `latestPlannerResponse` state to keep LHS Feature Definition panel intact
- Detection: if `plannerResponse.featureUnderstanding` is empty string AND `plannerResponse.scope.in` is empty array, treat as fallback
- Existing code at lines 774-776 and 1430-1431 unconditionally sets plannerResponse - add guard condition

**Part C.1: Test Valid JSON Parse Success**
- Test that valid JSON parses successfully
- Verify `assistant.message` equals `plannerResponse.message` (sanitized version)
- Verify `plannerResponse` contains all structured fields correctly

**Part C.2: Test Invalid JSON Fallback Behavior**
- Test that invalid/malformed JSON returns safe `assistant.message` (no raw blob)
- Verify `plannerResponse` is either null or omitted from response (not a fallback object with raw content)
- Verify safe message text: "I couldn't parse the structured response. Please try again."

**Part C.3: Test Frontend LHS State Preservation**
- Test that when response has fallback plannerResponse, frontend does NOT update `latestPlannerResponse`
- Mock a sequence: valid response -> fallback response -> verify latestPlannerResponse still has valid data

**Part C.4: Test Logging on Failure**
- Use jest spy/mock on logger.warn
- Verify logger.warn is called when validation fails
- Verify log payload includes sessionId, error string, and truncated raw content

## Visual Design
No visual mockups provided. This is a logic fix with no UI changes.

## Existing Code to Leverage

**gateway/src/services/plannerResponseValidator.ts**
- Contains `validatePlannerResponse()` - add sessionId parameter and logging on failure
- Contains `extractJson()` - already correctly extracts JSON before parse
- Contains `createFallbackPlannerResponse()` - change to use safe message instead of rawMessage parameter
- Contains sanitization logic in Step 10 (lines 246-268) - this is correctly applied after parse

**gateway/src/routes/chat.ts**
- Lines 623-675 handle planner response validation and fallback
- Line 659 creates fallback with raw content: `createFallbackPlannerResponse(response.content || '')`
- Lines 663-665 set chatResponse but do not override assistant.message
- Need to pass sessionId to validatePlannerResponse

**gateway/src/services/plannerMessageSanitizer.ts**
- Contains `sanitizePlannerMessage()` function
- Already correctly designed to operate on parsed message field
- No changes needed here

**frontend/src/components/ProductView/ImplementationAssistantPanel.tsx**
- Lines 774-776 and 1430-1431 set latestPlannerResponse unconditionally
- Need to add guard: only update if plannerResponse is not a fallback (check for non-empty structured fields)

**gateway/src/__tests__/planner-response-validator.test.ts**
- Existing test patterns for validatePlannerResponse
- Add new tests for logging and fallback message behavior

## Out of Scope
- Streaming OAS endpoint (GET /api/chat/stream) - only fix non-streaming POST /api/chat
- ImplementerResponse (SA phase) validation - only fix PlannerResponse validation
- Handoff/implementationPlan schema changes - no schema modifications
- UI layout changes - no visual redesign
- Adding retry logic for failed parses - just fail gracefully
- Changing the PlannerResponse TypeScript type definition
- Modifying the sanitization detection patterns in plannerMessageSanitizer
- Adding user-facing error toasts or notifications
- Persisting parse failure state across sessions
- Metrics/telemetry beyond logging
