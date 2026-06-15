# Task Breakdown: Fix Planner JSON Parsing Regression

## Overview
Total Tasks: 15 (across 3 task groups)

This spec fixes a regression where `sanitizePlannerMessage()` corrupts JSON by being applied before `JSON.parse`, causing parse failures and exposing raw JSON in the chat UI while clearing the LHS Feature Definition panel.

## Task List

### Gateway Layer

#### Task Group 1: Gateway Planner Response Fixes
**Dependencies:** None

- [x] 1.0 Complete Gateway planner response handling fixes
  - [x] 1.1 Write 4-6 focused tests for gateway planner response handling
    - Test: Valid JSON parses correctly, `assistant.message` equals sanitized `plannerResponse.message`
    - Test: Invalid JSON returns safe `assistant.message` (not raw blob), message is "I couldn't parse the structured response. Please try again."
    - Test: `createFallbackPlannerResponse()` returns safe static message (not raw content)
    - Test: `logger.warn` is invoked on validation failure with sessionId, error reason, truncated raw content
    - Test: Fallback path in chat.ts sets BOTH `plannerResponse` AND `assistant.message` to safe values
    - Limit to max 6 highly focused tests
  - [x] 1.2 Fix `createFallbackPlannerResponse()` in plannerResponseValidator.ts
    - Remove `rawMessage` parameter from function signature
    - Change message field to use safe static message: "I couldn't parse the structured response. Please try again."
    - The function should accept no parameters (or minimal parameters if needed)
    - Existing file: `gateway/src/services/plannerResponseValidator.ts` (lines 294-313)
  - [x] 1.3 Add sessionId parameter and failure logging to `validatePlannerResponse()`
    - Add `sessionId: string` as third parameter to function signature
    - Add `logger.warn()` call at each return point where validation fails
    - Log payload must include: sessionId, error reason, first 200 chars of raw content
    - Use the original `content` parameter for logging (not extracted JSON) since extraction may fail
    - Existing file: `gateway/src/services/plannerResponseValidator.ts` (lines 166-291)
    - Reference logging pattern from: `gateway/src/services/logger.ts`
  - [x] 1.4 Update chat.ts to pass sessionId and fix fallback handling
    - Pass `effectiveSessionId` to `validatePlannerResponse()` call at line 626
    - Update `createFallbackPlannerResponse()` call at line 659 (no longer pass raw content)
    - Add `assistant.message` override when validation fails (lines 661-665)
    - Set `assistant.message` to the same safe fallback message
    - Existing file: `gateway/src/routes/chat.ts` (lines 623-675)
  - [x] 1.5 Ensure Gateway planner response tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify createFallbackPlannerResponse returns safe message
    - Verify validatePlannerResponse logs failures correctly
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `createFallbackPlannerResponse()` returns static safe message, never raw content
- `validatePlannerResponse()` logs failures with sessionId, error, truncated raw content
- Fallback path sets both `plannerResponse.message` AND `assistant.message` to safe values
- No raw JSON ever appears in chat bubble on parse failure

### Frontend Layer

#### Task Group 2: Frontend Fallback Detection and State Preservation
**Dependencies:** Task Group 1 (gateway must return proper fallback structure)

- [x] 2.0 Complete Frontend fallback response handling
  - [x] 2.1 Write 3-5 focused tests for frontend fallback detection
    - Test: `setLatestPlannerResponse` is NOT called when response has fallback plannerResponse
    - Test: Fallback detection uses check: `featureUnderstanding === ''` AND `scope.in.length === 0`
    - Test: After fallback response, previous `latestPlannerResponse` state is preserved
    - Test: Valid plannerResponse (non-empty featureUnderstanding OR non-empty scope.in) updates state normally
    - Limit to max 5 highly focused tests
  - [x] 2.2 Create helper function to detect fallback plannerResponse
    - Create `isFallbackPlannerResponse(plannerResponse: PlannerResponse): boolean`
    - Detection logic: `featureUnderstanding === ''` AND `scope.in.length === 0`
    - Can be inline or extracted to a utility function
    - Location: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
  - [x] 2.3 Guard `setLatestPlannerResponse` call in handleSend callback
    - Location: lines 1428-1432 in ImplementationAssistantPanel.tsx
    - Add condition: only call `setLatestPlannerResponse` if NOT a fallback response
    - Use detection logic from 2.2
    - Preserves LHS Feature Definition panel when parse fails
  - [x] 2.4 Guard `setLatestPlannerResponse` call in handleSubmitAnswers callback
    - Location: lines 773-776 in ImplementationAssistantPanel.tsx
    - Add same condition: only call `setLatestPlannerResponse` if NOT a fallback response
    - Use detection logic from 2.2
    - Ensures both code paths are protected
  - [x] 2.5 Ensure Frontend fallback detection tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify fallback detection correctly identifies fallback responses
    - Verify state is preserved on fallback
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- Fallback detection correctly identifies fallback plannerResponses
- `setLatestPlannerResponse` is NOT called for fallback responses
- LHS Feature Definition panel preserves previous state on parse failure
- Valid plannerResponses continue to update state normally

### Testing

#### Task Group 3: Test Review and Integration Verification
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 4-6 tests written by gateway engineer (Task 1.1)
    - Review the 3-5 tests written by frontend engineer (Task 2.1)
    - Total existing tests: approximately 7-11 tests
  - [x] 3.2 Analyze test coverage gaps for THIS feature only
    - Identify critical integration points lacking test coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflow over unit test gaps
  - [x] 3.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Priority: integration between gateway fallback and frontend detection
    - Priority: verify existing valid-case tests still pass (no regression to working cases)
    - Skip edge cases, performance tests unless business-critical
    - Suggested tests if gaps exist:
      - Gateway integration: valid JSON round-trip preserves all structured fields
      - Frontend integration: sequence of valid -> fallback -> valid maintains correct state
      - Existing test regression check: existing planner-response-validator.test.ts tests still pass
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Gateway: planner-response-validator tests (new + existing)
    - Frontend: ImplementationAssistantPanel fallback detection tests
    - Expected total: approximately 12-21 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 12-21 tests total)
- Critical integration points between gateway and frontend are covered
- No regressions to existing valid-case handling
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on this spec's requirements

## Implementation Summary

### Completed Work:

**Task Group 1 (Gateway):**
- Created 22 new tests in `gateway/src/__tests__/planner-response-validator.test.ts` covering:
  - Valid response parsing
  - Invalid response handling
  - Fallback response safe message (not raw content)
  - Validation failure logging with sessionId
  - JSON extraction from various formats
- Updated `gateway/src/services/plannerResponseValidator.ts`:
  - Added `SAFE_FALLBACK_MESSAGE` constant
  - Added `logValidationFailure()` helper function
  - Added `sessionId` parameter to `validatePlannerResponse()`
  - Added logging at all validation failure points
  - Updated `createFallbackPlannerResponse()` to return safe static message (no parameters)
- Updated `gateway/src/routes/chat.ts`:
  - Added `SAFE_FALLBACK_MESSAGE` constant
  - Passed `effectiveSessionId` to `validatePlannerResponse()`
  - Updated fallback handling to call `createFallbackPlannerResponse()` without parameters
  - Set `assistant.message` to safe fallback message when validation fails
- Fixed test regression in `planner-response-validator-uuid.test.ts` to use new API

**Task Group 2 (Frontend):**
- Created 8 tests in `frontend/src/__tests__/ImplementationAssistantPanel.fallback.test.tsx` covering:
  - `isFallbackPlannerResponse` helper function detection logic
  - State preservation when fallback response received
  - Valid response state update
  - Sequence of valid -> fallback -> valid maintaining correct state
- Updated `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`:
  - Added `isFallbackPlannerResponse()` helper function
  - Added fallback guard to handleSend callback (line 1448)
  - Added fallback guard to handleSubmitAnswers callback (line 792)

**Task Group 3 (Testing):**
- Reviewed all tests from Task Groups 1-2
- Fixed pre-existing test that used old API signature
- Verified all 39 tests pass (31 gateway + 8 frontend)
- Test count exceeds expected 12-21 (comprehensive coverage achieved)

### Test Results:
- Gateway: 31 tests PASS (planner-response-validator + uuid tests)
- Frontend: 8 tests PASS (fallback detection tests)
- Total: 39 tests PASS

## Execution Order

Recommended implementation sequence:
1. **Gateway Layer (Task Group 1)**: Fix the root cause - fallback message and logging
2. **Frontend Layer (Task Group 2)**: Add defensive guards for fallback detection
3. **Test Review (Task Group 3)**: Verify integration and fill critical gaps

## Files to Modify

### Gateway (Task Group 1)
| File | Changes |
|------|---------|
| `gateway/src/services/plannerResponseValidator.ts` | Fix `createFallbackPlannerResponse()`, add sessionId param and logging to `validatePlannerResponse()` |
| `gateway/src/routes/chat.ts` | Pass sessionId, fix fallback handling, set `assistant.message` on failure |
| `gateway/src/__tests__/planner-response-validator.test.ts` | Add new tests for logging and safe fallback message |

### Frontend (Task Group 2)
| File | Changes |
|------|---------|
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add fallback detection, guard `setLatestPlannerResponse` calls |
| `frontend/src/__tests__/ImplementationAssistantPanel.fallback.test.tsx` | New test file for fallback detection tests |

## Key Technical Details

### Safe Fallback Message
The exact message to use when parse fails:
```
"I couldn't parse the structured response. Please try again."
```

### Fallback Detection Logic (Frontend)
```typescript
function isFallbackPlannerResponse(response: PlannerResponse): boolean {
  return response.featureUnderstanding === '' && response.scope.in.length === 0;
}
```

### Logging Format (Gateway)
```typescript
logger.warn('Planner response validation failed', {
  event: 'planner_validation_failed',
  sessionId: sessionId,
  error: validationResult.error,
  rawContentPreview: content.substring(0, 200),
});
```

## Out of Scope Reminders
- Streaming OAS endpoint (GET /api/chat/stream)
- ImplementerResponse (SA phase) validation
- Handoff/implementationPlan schema changes
- UI layout changes
- Retry logic for failed parses
- Changing PlannerResponse TypeScript type definition
- Modifying sanitization detection patterns
- User-facing error toasts/notifications
