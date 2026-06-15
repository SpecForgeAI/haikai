# Task Breakdown: Implement Assistant Stage 5 - Structured Refinement Loop for Feature Intent Locking

## Overview
Total Tasks: 15

This is a gateway-only prompt template change. The implementation involves replacing `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts` with a new structured protocol that enforces a 4-part response structure during the refine phase.

## Task List

### Gateway Layer

#### Task Group 1: Test Infrastructure for Structured Refinement Prompt
**Dependencies:** None

- [x] 1.0 Complete test infrastructure for the new structured refinement prompt
    - [x] 1.1 Write 6 focused tests for the new prompt template structure
    - Test 1: Verify prompt contains "Part 1" / "Restate" section with required subsections (feature goal, scope, primary flows, edge cases, dependencies)
    - Test 2: Verify prompt contains "Part 2" / "Assumptions" section instructing bulleted list format
    - Test 3: Verify prompt contains "Part 3" / "Clarifying Questions" section with 3-7 question guidance
    - Test 4: Verify prompt contains "Part 4" / "Proposed Final Feature Definition" section with handoff rules
    - Test 5: Verify prompt preserves all existing placeholders (`{workItemTitle}`, `{workItemType}`, `{workItemDescription}`, `{entityIds}`, `{diagramIds}`, `{resolvedContext}`)
    - Test 6: Verify prompt preserves existing DO NOT VIOLATE rules (no write-spec, no code generation, no MCP tools)
    - [x] 1.2 Write 2 focused tests for prompt behavior rules
    - Test 1: Verify prompt instructs assistant to avoid speculative implementation details and new requirements
    - Test 2: Verify prompt instructs assistant to reference entities by name (not raw IDs) and prefer clarity over verbosity
    - [x] 1.3 Ensure tests are structured to fail initially (TDD red phase)
    - Tests should run against the current `IMPLEMENT_PLANNER_PROMPT_TEMPLATE`
    - Tests should fail because the new structured protocol sections do not exist yet

**Test File:** `gateway/src/__tests__/structured-refinement-prompt.test.ts`

**Acceptance Criteria:**
- 8 tests created and executable via `npm test`
- Tests fail when run against the current prompt template (red phase)
- Tests cover all 4 parts of the structured protocol
- Tests verify placeholder preservation
- Tests verify behavior rule instructions

---

#### Task Group 2: Implement Structured Refinement Prompt Template
**Dependencies:** Task Group 1

- [x] 2.0 Complete implementation of the new structured refinement prompt
    - [x] 2.1 Update `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts` (lines 44-91)
    - Replace the current `CONVERSATION PROCESS` section (steps 1a-1e) with the new 4-part structured protocol
    - Preserve all existing placeholders: `{workItemTitle}`, `{workItemType}`, `{workItemDescription}`, `{entityIds}`, `{diagramIds}`, `{resolvedContext}`
    - Preserve the `YOUR ROLE`, `WORK ITEM CONTEXT`, `LINKED ARCHITECTURE CONTEXT`, and `RESOLVED ARCHITECTURE CONTEXT` sections
    - [x] 2.2 Add Part 1: Restate (Replay) Current Understanding section
    - Instruct assistant to replay feature definition in concise, structured form
    - Include subsections: feature goal/user value, scope (in-scope/out-of-scope), primary flows, key edge cases, dependencies/integrations
    - Specify this section should appear first in every response
    - [x] 2.3 Add Part 2: Explicit Assumptions List section
    - Instruct assistant to enumerate assumptions as bulleted list
    - Each assumption must be specific and falsifiable
    - Include instruction to state "No assumptions at this time" when none exist
    - Assumptions must be grounded in provided context
    - [x] 2.4 Add Part 3: Focused Clarifying Questions section
    - Instruct assistant to ask 3-7 focused, answerable questions
    - Questions must be specific, not vague or open-ended
    - Prefer fewer questions when possible
    - Include instruction to state "No blocking questions remain" when resolved
    - [x] 2.5 Add Part 4: Proposed Final Feature Definition section
    - Instruct assistant to present final definition when questions answered and assumptions confirmed
    - Definition should be single coherent description suitable for implementor
    - Explicitly forbid automatic transition to `phase=handoff`
    - Mark definition as proposed, awaiting user confirmation
    - [x] 2.6 Update the RULES section with new behavior constraints
    - Add rule: avoid speculative implementation details unless explicitly requested
    - Add rule: avoid introducing new requirements not mentioned by user
    - Add rule: use background and highlighted context to ground clarifications
    - Add rule: prefer clarity and determinism over verbosity
    - Preserve existing rules (no write-spec, no code generation, no MCP tools, reference entities by name)
    - [x] 2.7 Ensure Task Group 1 tests pass
    - Run `npm test -- structured-refinement-prompt.test.ts`
    - Verify all 8 tests from Task Group 1 pass (green phase)

**File:** `gateway/src/services/promptBuilder.ts`

**Acceptance Criteria:**
- All 8 tests from Task Group 1 pass
- `buildImplementPlannerPrompt()` function signature unchanged
- Placeholder replacement logic unchanged
- New prompt template enforces 4-part structured protocol
- All existing context sections preserved

---

#### Task Group 3: Verify Other Prompts Unchanged
**Dependencies:** Task Group 2

- [x] 3.0 Complete verification that other prompts remain unchanged
    - [x] 3.1 Write 4 focused regression tests to verify other prompts are unchanged
    - Test 1: Verify `SYSTEM_PROMPT_TEMPLATE` (OAS assistant mode) unchanged - contains "OpenAPI specification assistant" and "save_oas_spec"
    - Test 2: Verify `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` (bootstrap phase) unchanged - contains "greeting" instructions and "short, welcoming message"
    - Test 3: Verify `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE` (handoff phase) unchanged - contains "Specification Generator" and JSON array output format
    - Test 4: Verify `buildSystemPrompt()` routing unchanged - phase=refine routes to buildImplementPlannerPrompt, phase=bootstrap routes to buildBootstrapPrompt, phase=handoff routes to buildGenerateSpecsPrompt
    - [x] 3.2 Run regression tests to confirm other prompts unaffected
    - Run `npm test -- other-prompts-unchanged.test.ts`
    - Verify all 4 regression tests pass

**Test File:** `gateway/src/__tests__/other-prompts-unchanged.test.ts`

**Acceptance Criteria:**
- All 4 regression tests pass
- `SYSTEM_PROMPT_TEMPLATE` content unchanged
- `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` content unchanged
- `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE` content unchanged
- `buildSystemPrompt()` routing logic unchanged

---

### Testing

#### Task Group 4: Test Review and Final Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and run full verification
    - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 8 tests written in Task 1.1 and 1.2 (structured refinement prompt)
    - Review the 4 tests written in Task 3.1 (other prompts unchanged)
    - Total new tests: 12 tests
    - [x] 4.2 Run all existing prompt-related tests to verify no regressions
    - Run `npm test -- prompt-selection-implement-feature.test.ts`
    - Run `npm test -- bootstrap-prompt.test.ts`
    - Run `npm test -- generate-specs-prompt.test.ts`
    - Run `npm test -- phase-handling.test.ts`
    - Verify existing tests still pass
    - [x] 4.3 Run all new tests from this spec
    - Run `npm test -- structured-refinement-prompt.test.ts`
    - Run `npm test -- other-prompts-unchanged.test.ts`
    - Verify all 12 new tests pass
    - [x] 4.4 Verify end-to-end routing works correctly
    - Manually verify that `phase=refine` with `mode=implement_feature` returns the new structured prompt
    - Verify placeholders are correctly replaced with actual values

**Acceptance Criteria:**
- All 12 new tests pass
- All existing prompt-related tests pass (no regressions)
- No changes to bootstrap phase behavior
- No changes to handoff phase behavior
- No changes to OAS assistant mode behavior
- `buildImplementPlannerPrompt()` correctly returns the new structured prompt

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Test Infrastructure** (TDD red phase)
   - Write tests first that define expected behavior
   - Tests should fail against current implementation

2. **Task Group 2: Implement Structured Refinement Prompt** (TDD green phase)
   - Update `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` to pass all tests
   - Preserve existing functionality while adding new protocol

3. **Task Group 3: Verify Other Prompts Unchanged** (Regression verification)
   - Confirm no unintended changes to other prompts
   - Verify routing logic preserved

4. **Task Group 4: Test Review and Final Verification** (Integration)
   - Run full test suite for prompt-related functionality
   - Verify all acceptance criteria met

---

## Key Files

| File | Action |
|------|--------|
| `gateway/src/services/promptBuilder.ts` | UPDATE - Replace `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` (lines 44-91) |
| `gateway/src/__tests__/structured-refinement-prompt.test.ts` | CREATE - New test file for structured protocol |
| `gateway/src/__tests__/other-prompts-unchanged.test.ts` | CREATE - Regression tests for unchanged prompts |

---

## Notes

- This is a **prompt-only change** - no new API endpoints, no frontend changes, no database changes
- The `buildImplementPlannerPrompt()` function signature and replacement logic remain unchanged
- Only the template string content changes
- All existing placeholders must be preserved for backward compatibility
- The spec explicitly states: "only the user's Implement button triggers handoff" - the prompt must forbid automatic phase transitions
