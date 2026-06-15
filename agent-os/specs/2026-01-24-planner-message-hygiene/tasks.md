# Task Breakdown: Planner Message Hygiene

## Overview
Total Tasks: 4 Task Groups, 19 Sub-Tasks

This spec ensures the Planner LLM's `message` field is a short, high-level progress update only, preventing verbose or duplicative content from bloating Team Chat bubbles. Implementation involves prompt updates, a new sanitization service, integration into the validator, and comprehensive testing.

## Task List

### Task Group 1: System Prompt Updates
**Dependencies:** None
**Specialist:** Gateway Developer

- [x] 1.0 Complete system prompt updates to constrain message content
  - [x] 1.1 Update IMPLEMENT_PLANNER_PROMPT_TEMPLATE in `gateway/src/services/promptBuilder.ts`
    - Locate the `## FIELD GUIDELINES` section (around line 118-128)
    - Update the `"message"` guidance on line 119 from:
      ```
      "message": Conversational text shown to the user. Acknowledge their input, summarize understanding, ask questions.
      ```
      to a more restrictive constraint:
      ```
      "message": Chat bubble text (1-2 sentences max, single paragraph). Keep brief. Do NOT include bullet lists, numbered lists, section headers, or duplicated content from openQuestions/scope/acceptanceCriteria. If questions exist, say "I have N questions" without repeating them.
      ```
    - Add an explicit rule in `## RULES - DO NOT VIOLATE` section (around line 129-138):
      ```
      10. Keep "message" under 300 characters. Do not use bullets, numbered lists, or repeat structured content.
      ```
  - [x] 1.2 Ensure prompt changes do not break existing JSON output format
    - Verify `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` still produces valid JSON responses
    - Confirm no changes to required fields or schema version

**Acceptance Criteria:**
- The `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` includes explicit message brevity constraints
- A new rule in the `RULES` section enforces the 300-character limit and forbids structured content
- Existing prompt functionality remains intact (JSON output, required fields)

**Files to Modify:**
- `gateway/src/services/promptBuilder.ts` (lines 82-144)

---

### Task Group 2: Message Sanitizer Service Implementation
**Dependencies:** None (can be developed in parallel with Task Group 1)
**Specialist:** Gateway Developer

- [x] 2.0 Complete message sanitizer service with detection and replacement logic
  - [x] 2.1 Write 6-8 focused unit tests for sanitizer detection patterns
    - Create test file: `gateway/src/__tests__/planner-message-sanitizer.test.ts`
    - Test bullet point detection: lines starting with `-` or `*`
    - Test numbered list detection: patterns like `1.`, `1)`, `2.`, etc.
    - Test field label detection: "Questions:", "Scope:", "Acceptance Criteria:", "Assumptions:"
    - Test section header detection (without colons): "Open Questions", "Assumptions", "Scope"
    - Test multiple newlines detection: 2+ newlines
    - Test length threshold: message exceeds 300 characters
    - Test substring matching: openQuestions content found in message
    - Test clean message passthrough: valid short message returns unchanged
  - [x] 2.2 Create `gateway/src/services/plannerMessageSanitizer.ts`
    - Export function signature:
      ```typescript
      export function sanitizePlannerMessage(
        message: string,
        openQuestions: OpenQuestion[]
      ): SanitizationResult
      ```
    - Define `SanitizationResult` interface:
      ```typescript
      export interface SanitizationResult {
        sanitized: boolean;
        message: string;
        reasons: string[];
      }
      ```
  - [x] 2.3 Implement pattern detection functions
    - `hasBulletPoints(message: string): boolean` - regex: `/^\s*[-*]\s/m`
    - `hasNumberedList(message: string): boolean` - regex: `/^\s*\d+[.)]\s/m`
    - `hasFieldLabels(message: string): boolean` - case-insensitive match for "Questions:", "Scope:", "Acceptance Criteria:", "Assumptions:"
    - `hasSectionHeaders(message: string): boolean` - case-insensitive match for standalone "Open Questions", "Assumptions", "Scope", "Acceptance Criteria"
    - `hasMultipleNewlines(message: string): boolean` - regex: `/\n.*\n/`
    - `exceedsLengthLimit(message: string, limit: number): boolean` - check `message.length > limit`
  - [x] 2.4 Implement substring matching for openQuestions
    - `hasQuestionSubstring(message: string, openQuestions: OpenQuestion[]): { matched: boolean; matchedQuestions: string[] }`
    - Case-insensitive substring matching
    - Return list of matched question texts for logging
  - [x] 2.5 Implement deterministic replacement templates
    - If `openQuestions.length > 0`:
      ```
      "I've updated my understanding, scope, and acceptance criteria. I have {N} questions for you to answer."
      ```
    - If `openQuestions.length === 0`:
      ```
      "I've updated my understanding, scope, and acceptance criteria based on our discussion."
      ```
  - [x] 2.6 Implement main `sanitizePlannerMessage` function
    - Check all detection patterns in order
    - Collect all violation reasons
    - If any violation detected, return replacement template
    - If no violations, return original message unchanged
    - Return `SanitizationResult` with `sanitized` flag and `reasons` array
  - [x] 2.7 Ensure sanitizer unit tests pass
    - Run ONLY the tests in `planner-message-sanitizer.test.ts`
    - Verify all detection patterns work correctly
    - Verify replacement templates are correctly applied

**Acceptance Criteria:**
- The 6-8 unit tests in `planner-message-sanitizer.test.ts` pass
- All pattern detection functions correctly identify violations
- Substring matching correctly detects duplicated question content
- Replacement templates are applied deterministically
- Clean messages pass through unchanged

**Files to Create:**
- `gateway/src/services/plannerMessageSanitizer.ts`
- `gateway/src/__tests__/planner-message-sanitizer.test.ts`

**Reference Files:**
- `gateway/src/types/chat.ts` (OpenQuestion interface at line 324-329)
- `gateway/src/services/logger.ts` (logging patterns)

---

### Task Group 3: Integration into Response Validator
**Dependencies:** Task Group 2
**Specialist:** Gateway Developer

- [x] 3.0 Complete integration of sanitizer into validatePlannerResponse
  - [x] 3.1 Write 4-6 focused integration tests for sanitization in validation flow
    - Create test file or extend: `gateway/src/__tests__/planner-message-sanitization-integration.test.ts`
    - Test that verbose message is sanitized after JSON parse
    - Test that sanitized message appears in returned `PlannerResponse`
    - Test that clean message is not modified
    - Test sanitization logging occurs at correct levels
    - Test that sanitization works for both `refine` and `implementation_planning` phases
  - [x] 3.2 Import sanitizer into `plannerResponseValidator.ts`
    - Add import: `import { sanitizePlannerMessage, SanitizationResult } from './plannerMessageSanitizer';`
    - Import logger: `import { logger } from './logger';`
  - [x] 3.3 Integrate sanitization call in `validatePlannerResponse`
    - After JSON parse and validation (around line 232-252)
    - Before constructing the final `PlannerResponse` object
    - Call `sanitizePlannerMessage(obj.message as string, transformedOpenQuestions)`
    - Use sanitized message in the returned `plannerResponse.message`
  - [x] 3.4 Add logging for sanitization events
    - Log at INFO level when sanitization is triggered:
      ```typescript
      logger.info('Planner message sanitized', {
        event: 'planner_message_sanitized',
        reasonCount: result.reasons.length,
        reasons: result.reasons,
      });
      ```
    - Log at DEBUG level with additional details:
      ```typescript
      logger.debug('Planner message sanitization details', {
        event: 'planner_message_sanitization_details',
        originalLength: originalMessage.length,
        sanitizedLength: result.message.length,
        detectedPatterns: result.reasons,
      });
      ```
  - [x] 3.5 Ensure integration tests pass
    - Run ONLY the integration tests for sanitization
    - Verify sanitization occurs in validation flow
    - Verify logging output is correct

**Acceptance Criteria:**
- The 4-6 integration tests pass
- Sanitization is called after JSON parse, before returning `PlannerResponse`
- Sanitized message is correctly included in the returned response
- INFO log is emitted when sanitization occurs with reason summary
- DEBUG log includes original length, sanitized length, and detected patterns
- Sanitization runs for both `refine` and `implementation_planning` phases

**Files to Modify:**
- `gateway/src/services/plannerResponseValidator.ts` (lines 156-258)

**Files to Create:**
- `gateway/src/__tests__/planner-message-sanitization-integration.test.ts`

**Reference Files:**
- `gateway/src/services/logger.ts` (logging patterns)
- `gateway/src/routes/chat.ts` (lines 638-648 for response construction context)

---

### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3
**Specialist:** QA / Gateway Developer

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 2-3
    - Review the 6-8 unit tests from Task Group 2 (sanitizer detection)
    - Review the 4-6 integration tests from Task Group 3 (validator integration)
    - Estimated total: 10-14 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify edge cases in pattern detection not covered
    - Check if prompt changes need any verification tests
    - Verify end-to-end flow from chat route to sanitized response
  - [x] 4.3 Write up to 6 additional strategic tests if needed
    - Add maximum of 6 new tests to fill identified critical gaps
    - Focus on:
      - Edge cases: empty message, message with only whitespace
      - Combined violations: message with bullets AND exceeds length
      - Boundary cases: message at exactly 300 characters
      - OpenQuestion substring edge: partial match vs full match
      - Case sensitivity: "SCOPE:" vs "scope:" vs "Scope:"
    - Do NOT write exhaustive coverage for all permutations
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - `planner-message-sanitizer.test.ts`
      - `planner-message-sanitization-integration.test.ts`
      - Any new tests added in 4.3
    - Expected total: approximately 16-20 tests maximum
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-20 tests total)
- Critical edge cases are covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

**Test Files:**
- `gateway/src/__tests__/planner-message-sanitizer.test.ts` (from Task Group 2)
- `gateway/src/__tests__/planner-message-sanitization-integration.test.ts` (from Task Group 3)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: System Prompt Updates** - Can be done first and independently
2. **Task Group 2: Message Sanitizer Service** - Can be developed in parallel with Task Group 1
3. **Task Group 3: Integration into Response Validator** - Requires Task Group 2 completion
4. **Task Group 4: Test Review and Gap Analysis** - Final verification after all implementation complete

**Parallelization:**
- Task Groups 1 and 2 can be developed simultaneously
- Task Group 3 must wait for Task Group 2
- Task Group 4 must wait for all groups to complete

---

## Technical Notes

### Pattern Detection Regex Reference

| Pattern | Regex | Example Match |
|---------|-------|---------------|
| Bullet points | `/^\s*[-*]\s/m` | `- item` or `* item` |
| Numbered lists | `/^\s*\d+[.)]\s/m` | `1. item` or `2) item` |
| Field labels | case-insensitive contains | `Questions:`, `Scope:` |
| Section headers | case-insensitive contains | `Open Questions`, `Assumptions` |
| Multiple newlines | `/\n.*\n/` | Two or more line breaks |
| Length limit | `message.length > 300` | Over 300 characters |

### Replacement Template Strings

With questions (N > 0):
```
"I've updated my understanding, scope, and acceptance criteria. I have {N} questions for you to answer."
```

Without questions (N === 0):
```
"I've updated my understanding, scope, and acceptance criteria based on our discussion."
```

### Files Summary

**Files to Create:**
- `gateway/src/services/plannerMessageSanitizer.ts`
- `gateway/src/__tests__/planner-message-sanitizer.test.ts`
- `gateway/src/__tests__/planner-message-sanitization-integration.test.ts`

**Files to Modify:**
- `gateway/src/services/promptBuilder.ts` (IMPLEMENT_PLANNER_PROMPT_TEMPLATE)
- `gateway/src/services/plannerResponseValidator.ts` (validatePlannerResponse)

**Reference Files (read only):**
- `gateway/src/types/chat.ts` (OpenQuestion interface)
- `gateway/src/services/logger.ts` (logging patterns)
- `gateway/src/routes/chat.ts` (response construction context)
