# Task Breakdown: SA Increment 3 -- Structured SA Response Contract + Skip/Unknown Handling + Readiness Gate

## Overview
Total Tasks: 29

This increment expands the Solution Architect JSON response contract from 7 to 9 sections (renaming `non_functional_requirements` to `non_functional`, adding `artefact_review` and `final_review`), and enhances the system prompt with section progression, skip/unknown handling, and a deterministic readiness gate. All behavioral changes are prompt-level only -- no code-level tracking or enforcement.

**Key Constraint:** This is a hard cut-over. The section enum rename and expansion must be coordinated across all four files (validator, types, prompt, frontend) simultaneously. Old `non_functional_requirements` becomes immediately invalid.

## Task List

### Gateway Types & Validator Layer

#### Task Group 1: Section Enum Expansion -- Types and Validator (R-1, R-8)
**Dependencies:** None

- [x] 1.0 Complete gateway types and validator update (hard cut-over)
  - [x] 1.1 Write 6 focused tests for the updated 9-section validator
    - Test file: `gateway/src/__tests__/solutionArchitectResponseValidator.test.ts`
    - Test 1: Valid response with `non_functional` section is accepted
    - Test 2: Response with old `non_functional_requirements` section is rejected as invalid
    - Test 3: Valid response with `artefact_review` section is accepted
    - Test 4: Valid response with `final_review` section is accepted
    - Test 5: Valid `phase="ready"` response with `section="final_review"` is accepted
    - Test 6: `createFallbackSolutionArchitectResponse()` still returns `section: 'context_and_boundaries'` (R-8 confirmation)
    - Note: Existing tests 1-5 in the file will also need updating (see sub-task 1.5)
  - [x] 1.2 Update `SolutionArchitectResponse` type union in `gateway/src/types/chat.ts`
    - Line 704: Replace `'non_functional_requirements'` with `'non_functional'`
    - Line 704: Add `'artefact_review'` and `'final_review'` to the union
    - Full 9-value union: `'context_and_boundaries' | 'ui_and_channels' | 'integrations' | 'data_model' | 'service_decomposition' | 'business_logic' | 'non_functional' | 'artefact_review' | 'final_review'`
    - Update JSDoc comment (line 692) from "7 enumerated sections" to "9 enumerated sections"
  - [x] 1.3 Update `VALID_SECTIONS` set in `gateway/src/services/solutionArchitectResponseValidator.ts`
    - Lines 36-44: Replace `'non_functional_requirements'` with `'non_functional'`
    - Lines 36-44: Add `'artefact_review'` and `'final_review'` to the set
    - Full 9-value set: `context_and_boundaries`, `ui_and_channels`, `integrations`, `data_model`, `service_decomposition`, `business_logic`, `non_functional`, `artefact_review`, `final_review`
    - Update JSDoc comment (line 34) from "7 enumerated architecture discovery sections" to "9"
    - Update validation step 4 comment (line 104) from "7 enumerated values" to "9"
    - Update file-level JSDoc comment (line 12) from "7 enumerated architecture discovery sections" to "9"
  - [x] 1.4 Confirm fallback response is unchanged (R-8)
    - Verify `createFallbackSolutionArchitectResponse()` (line 196) still returns `section: 'context_and_boundaries'`
    - No code changes needed -- this is a verification-only sub-task
  - [x] 1.5 Update existing tests that reference old section names
    - In `gateway/src/__tests__/solutionArchitectResponseValidator.test.ts`:
      - Test at line 72: Change `section: 'non_functional_requirements'` to `section: 'final_review'` (or `'non_functional'`) in the valid "ready" phase test
      - Test at line 84: Update the assertion from `toBe('non_functional_requirements')` to match the new section value
    - Search for any other references to `non_functional_requirements` in gateway test files and update
  - [x] 1.6 Ensure validator tests pass
    - Run ONLY the tests in `gateway/src/__tests__/solutionArchitectResponseValidator.test.ts`
    - All 6 new tests from 1.1 plus the updated existing tests must pass
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- `SolutionArchitectResponse` type in `chat.ts` accepts all 9 section values and rejects `non_functional_requirements`
- `VALID_SECTIONS` set in the validator contains exactly 9 values
- Validator accepts `non_functional`, `artefact_review`, and `final_review` as valid sections
- Validator rejects `non_functional_requirements` as an invalid section
- Fallback response still returns `section: 'context_and_boundaries'`
- All JSDoc comments reference "9" instead of "7"
- All validator tests pass

---

### Prompt Template Layer

#### Task Group 2: Prompt Template Updates (R-2, R-3, R-4, R-5)
**Dependencies:** Task Group 1 (prompt references the section enum values that must be valid in the type system)

- [x] 2.0 Complete prompt template updates
  - [x] 2.1 Write 5 focused tests for prompt template content
    - Test file: `gateway/src/__tests__/sa-increment-3-prompt-template.test.ts` (new file)
    - Test 1: Prompt template contains all 9 section names including `non_functional`, `artefact_review`, `final_review`
    - Test 2: Prompt template does NOT contain the old `non_functional_requirements` string
    - Test 3: Prompt template contains a "SECTION PROGRESSION" block (or equivalent heading)
    - Test 4: Prompt template contains a "READINESS GATE" block (or equivalent heading)
    - Test 5: Prompt template contains skip/unknown trigger phrases ("I don't know", "Skip", "Pass")
  - [x] 2.2 Update the ARCHITECTURE DISCOVERY SECTIONS list (R-2)
    - File: `gateway/src/services/promptBuilder.ts`
    - Lines 382-388: Replace the 7-section list with the full 9-section list
    - Section 7: `non_functional` -- Performance targets, scalability needs, availability/SLA, security, compliance, observability
    - Section 8: `artefact_review` -- SA explicitly asks whether the user wants to upload any additional artefacts (documents, diagrams, specs); SA can ask brief follow-up questions about uploaded content
    - Section 9: `final_review` -- SA presents a consolidated architecture recap including all assumptions and open items; this is the last section before phase="ready"
    - Update the `"section"` field definition in the RESPONSE FORMAT block (line 431) to list all 9 values
    - Update RULES item 3 (line 440) to reference "9 enumerated values" instead of "7"
  - [x] 2.3 Update the QUESTION STRATEGY block to reference 9 sections
    - Lines 391-397: Update "Later rounds" guidance to reference `non_functional`, `artefact_review`, and `final_review` instead of `non_functional_requirements`
    - Ensure the question strategy references the correct section names throughout
  - [x] 2.4 Add SECTION PROGRESSION block (R-3)
    - Add a new "SECTION PROGRESSION" section to the prompt template (after QUESTION STRATEGY or after ARCHITECTURE DISCOVERY SECTIONS)
    - Define the expected order: context_and_boundaries, ui_and_channels, integrations, data_model, service_decomposition, business_logic, non_functional, artefact_review, final_review
    - Instruct the SA to progress through sections in logical order
    - Allow skipping sections and revisiting previous sections for clarification
    - State that the SA must reach `final_review` before setting `phase="ready"`
  - [x] 2.5 Expand HANDLING UNCERTAINTY block for skip/unknown handling (R-4)
    - Lines 399-404: Expand the existing block with explicit trigger phrases
    - Add trigger phrase list: "I don't know", "Not decided", "Skip", "Come back later", "No idea", "Pass"
    - Add instruction: when the user gives a skip/unknown response, do NOT repeat the question
    - Add instruction: record an assumption in the `assumptions` array
    - Add instruction: add the topic to `openItems`
    - Add instruction: move to the next question or section
    - State clearly that skipped items should never block section progression
  - [x] 2.6 Replace SUFFICIENCY TRACKING with READINESS GATE block (R-5)
    - Lines 409-414: Remove/replace the existing "SUFFICIENCY TRACKING" block
    - Add new "READINESS GATE" block defining minimum baseline requirements:
      - At least one service identified (or the default "Core Application Service")
      - At least one data entity identified or an explicit "none needed" acknowledgment
      - At least one integration identified or an explicit "none needed" acknowledgment
      - A high-level architecture summary exists in the conversation
      - All sections have been visited or explicitly skipped
    - Add "When ready" instructions:
      - Set `phase="ready"`
      - Set `section="final_review"`
      - Set `questions` to empty array
      - Include an architecture recap in `summary`
      - Ask the user for confirmation to save
  - [x] 2.7 Ensure prompt template tests pass
    - Run ONLY the tests in `gateway/src/__tests__/sa-increment-3-prompt-template.test.ts`
    - All 5 tests from 2.1 must pass
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- Prompt template lists all 9 sections with correct descriptions
- Old `non_functional_requirements` string does not appear anywhere in the prompt template
- SECTION PROGRESSION block defines the 9-section order and allows skipping/revisiting
- HANDLING UNCERTAINTY block explicitly lists trigger phrases and instructs graceful handling
- READINESS GATE block replaces SUFFICIENCY TRACKING with prescriptive minimum baseline
- RULES reference "9 enumerated values"
- All 5 prompt template tests pass

---

### Frontend Layer

#### Task Group 3: Frontend Updates (R-6, R-7)
**Dependencies:** Task Group 1 (frontend type references must align with updated type definitions)

- [x] 3.0 Complete frontend updates
  - [x] 3.1 Write 5 focused tests for frontend changes
    - Test file: `frontend/src/__tests__/solutionArchitect-frontend.test.ts` (update existing tests in place)
    - Test 1: `sectionDisplayName('non_functional')` returns `"Non-Functional"`
    - Test 2: `sectionDisplayName('artefact_review')` returns `"Artefact Review"`
    - Test 3: `sectionDisplayName('final_review')` returns `"Final Review"`
    - Test 4: `sectionDisplayName('non_functional_requirements')` falls through to the underscore-replace fallback (returns `"non functional requirements"`) since it is no longer in the map
    - Test 5: Ready banner text matches `"Architecture baseline is complete. Would you like to save?"`
  - [x] 3.2 Update `sectionDisplayName()` function (R-6)
    - File: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`
    - Lines 59-67: Remove `'non_functional_requirements': 'Non-Functional Requirements'` entry
    - Add `'non_functional': 'Non-Functional'` entry
    - Add `'artefact_review': 'Artefact Review'` entry
    - Add `'final_review': 'Final Review'` entry
    - Resulting map has 9 entries total
  - [x] 3.3 Update ready banner text (R-7)
    - File: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`
    - Line 492: Change text from `"Architecture baseline is ready. Save functionality coming in a future increment."` to `"Architecture baseline is complete. Would you like to save?"`
    - Note: Save functionality is not wired in this increment (deferred to Increment 5)
  - [x] 3.4 Update existing frontend tests that reference old section names
    - In `frontend/src/__tests__/solutionArchitect-frontend.test.ts`:
      - Test 5.1a "ready" phase test (line 50-51): Change `section: 'non_functional_requirements'` to `section: 'final_review'`
      - Test 5.1a "ready" phase assertion (line 59): Update `toBe('non_functional_requirements')` to `toBe('final_review')`
      - Test 5.1c sectionDisplayName mapping (line 129): Remove `non_functional_requirements` assertion, add assertions for `non_functional`, `artefact_review`, `final_review`
      - Test 5.1e ready banner (lines 184, 191-197): Update `section: 'non_functional_requirements'` to `section: 'final_review'` and update expected banner text to `"Architecture baseline is complete. Would you like to save?"`
    - In `frontend/src/__tests__/solutionArchitect-gap-tests.test.ts`:
      - Search for any references to `non_functional_requirements` and update if found
  - [x] 3.5 Ensure frontend tests pass
    - Run ONLY the tests in `frontend/src/__tests__/solutionArchitect-frontend.test.ts` and `frontend/src/__tests__/solutionArchitect-gap-tests.test.ts`
    - All updated and new tests must pass
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- `sectionDisplayName()` returns correct display names for all 9 sections
- `non_functional_requirements` is no longer in the `sectionDisplayName` map (falls through to fallback)
- Ready banner text reads `"Architecture baseline is complete. Would you like to save?"`
- All frontend tests pass with updated section names and banner text

---

### Test Review & Verification

#### Task Group 4: Test Review, Gap Analysis, and Cross-File Verification (R-9)
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 6 tests written/updated by Task Group 1 (validator)
    - Review the 5 tests written by Task Group 2 (prompt template)
    - Review the 5 tests written/updated by Task Group 3 (frontend)
    - Total existing tests from TG1-3: approximately 16 tests
  - [x] 4.2 Scan all existing SA test files for stale `non_functional_requirements` references
    - Check each of these files for any remaining references to `non_functional_requirements`:
      - `gateway/src/__tests__/solutionArchitectResponseValidator.test.ts`
      - `gateway/src/__tests__/solution-architect-system-prompt.test.ts`
      - `gateway/src/__tests__/solution-architect-chat-route.test.ts`
      - `gateway/src/__tests__/solution-architect-gap-tests.test.ts`
      - `gateway/src/__tests__/solution-architect-gap-chat-route.test.ts`
      - `gateway/src/__tests__/sa-increment-2-prompt-template.test.ts`
      - `gateway/src/__tests__/sa-increment-2-file-loading.test.ts`
      - `gateway/src/__tests__/sa-increment-2-short-circuit-persistence.test.ts`
      - `gateway/src/__tests__/sa-increment-2-gap-fill.test.ts`
      - `frontend/src/__tests__/solutionArchitect-frontend.test.ts`
      - `frontend/src/__tests__/solutionArchitect-gap-tests.test.ts`
    - Update any stale references to use valid 9-section values
  - [x] 4.3 Analyze test coverage gaps for this feature only
    - Identify critical workflows that lack test coverage across the hard cut-over
    - Focus on: cross-file consistency (type union matches validator set matches prompt list matches frontend map)
    - Focus on: edge cases around the new sections (`artefact_review` and `final_review`)
    - Do NOT assess entire application test coverage
  - [x] 4.4 Write up to 8 additional strategic tests to fill identified gaps
    - Add maximum of 8 new tests across existing or new test files
    - Suggested gap-fill tests:
      - Gateway: Validator error message for `non_functional_requirements` includes the full 9-section list in the hint
      - Gateway: All 9 sections from the `VALID_SECTIONS` set match exactly the 9 values in `SolutionArchitectResponse` type union
      - Gateway: Prompt template `"section"` field definition line lists all 9 values
      - Gateway: Prompt template does NOT contain the string `"SUFFICIENCY TRACKING"` (replaced by READINESS GATE)
      - Frontend: `sectionDisplayName()` has entries for all 9 valid section values (map completeness)
      - Frontend: Ready banner component text matches the updated string exactly
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests
  - [x] 4.5 Run all feature-specific tests
    - Run all SA-related test files in gateway:
      - `gateway/src/__tests__/solutionArchitectResponseValidator.test.ts`
      - `gateway/src/__tests__/sa-increment-3-prompt-template.test.ts`
      - `gateway/src/__tests__/solution-architect-system-prompt.test.ts`
      - `gateway/src/__tests__/solution-architect-gap-tests.test.ts`
      - `gateway/src/__tests__/sa-increment-2-prompt-template.test.ts`
    - Run all SA-related test files in frontend:
      - `frontend/src/__tests__/solutionArchitect-frontend.test.ts`
      - `frontend/src/__tests__/solutionArchitect-gap-tests.test.ts`
    - Verify all tests pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- No remaining references to `non_functional_requirements` in any SA test file (except in negative test cases that assert rejection)
- All stale test references updated to valid 9-section values
- Up to 8 gap-fill tests added covering cross-file consistency and edge cases
- All SA-related test files pass
- Testing focused exclusively on this spec's feature requirements

---

### Final Verification

#### Task Group 5: End-to-End Verification
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Final cross-cutting verification
  - [x] 5.1 Verify hard cut-over consistency across all four files
    - Confirm `gateway/src/types/chat.ts` section union has exactly 9 values
    - Confirm `gateway/src/services/solutionArchitectResponseValidator.ts` VALID_SECTIONS has exactly 9 values
    - Confirm `gateway/src/services/promptBuilder.ts` ARCHITECTURE DISCOVERY SECTIONS lists exactly 9 sections
    - Confirm `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` sectionDisplayName map has exactly 9 entries
    - Confirm all four files use identical section names (no typos, no mismatches)
  - [x] 5.2 Verify no stale references remain
    - Search entire `gateway/src/` for string `non_functional_requirements` -- should appear in zero production files
    - Search entire `frontend/src/` for string `non_functional_requirements` -- should appear in zero production files
    - Test files may contain `non_functional_requirements` only in negative test cases (asserting rejection)
  - [x] 5.3 Run full SA-related test suite
    - Run all gateway SA test files
    - Run all frontend SA test files
    - All tests must pass green

**Acceptance Criteria:**
- All four files contain exactly the same 9 section values with no mismatches
- No stale `non_functional_requirements` references in production code
- All SA-related tests pass
- Hard cut-over is complete and consistent

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Types & Validator** -- Must be first because the type definitions and validator are the source of truth for valid section values. Both the prompt template and frontend depend on these values being correct.
2. **Task Group 2: Prompt Template Updates** -- Second because the prompt references the section enum values and must align with the updated types. Contains all four prompt-level behavioral changes (section list, progression, skip/unknown, readiness gate).
3. **Task Group 3: Frontend Updates** -- Can run in parallel with TG2 (both depend only on TG1), but sequencing after TG2 is safer. Contains the `sectionDisplayName()` map update and banner text change.
4. **Task Group 4: Test Review & Gap Analysis** -- After all implementation is complete. Reviews tests from TG1-3, scans for stale references across all SA test files, and fills critical gaps.
5. **Task Group 5: Final Verification** -- Last step. Cross-cutting consistency check across all four files and final test run.

## Files Modified

| File | Task Groups | Changes |
|------|-------------|---------|
| `gateway/src/types/chat.ts` | TG1 | Section union: 7 to 9 values, rename `non_functional_requirements` to `non_functional`, update JSDoc |
| `gateway/src/services/solutionArchitectResponseValidator.ts` | TG1 | VALID_SECTIONS: 7 to 9 values, rename, update JSDoc comments |
| `gateway/src/services/promptBuilder.ts` | TG2, TG5 | 9-section list, SECTION PROGRESSION block, expanded HANDLING UNCERTAINTY, READINESS GATE replaces SUFFICIENCY TRACKING, JSDoc stale reference cleanup |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` | TG3 | sectionDisplayName map: 9 entries, ready banner text update |
| `gateway/src/__tests__/solutionArchitectResponseValidator.test.ts` | TG1, TG4 | New tests for 9-section validation, update existing tests |
| `gateway/src/__tests__/sa-increment-3-prompt-template.test.ts` | TG2 | New test file for prompt template content verification |
| `gateway/src/__tests__/sa-increment-3-cross-file-consistency.test.ts` | TG4 | New test file for cross-file consistency gap-fill tests |
| `frontend/src/__tests__/solutionArchitect-frontend.test.ts` | TG3, TG4 | Update section names, banner text, add new section display name tests |
| `frontend/src/__tests__/solutionArchitect-gap-tests.test.ts` | TG3, TG4 | Update any stale section references, add map completeness and banner text gap-fill tests |
| `gateway/src/__tests__/solution-architect-system-prompt.test.ts` | TG4 | Updated stale `non_functional_requirements` references to 9-section values |
| `gateway/src/__tests__/solution-architect-chat-route.test.ts` | TG4 | Updated stale `non_functional_requirements` references to `final_review` |
| `gateway/src/__tests__/sa-increment-2-gap-fill.test.ts` | TG4 | Updated stale `non_functional_requirements` in valid section list to 9-section values |
| `gateway/src/__tests__/chatTypes.solutionArchitectResponse.test.ts` | TG5 | Updated stale `non_functional_requirements` references to 9-section values (missed by TG4 scan) |
