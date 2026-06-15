# Task Breakdown: PM Tasks Captured Decisions Integration + Delivery Sequencing

## Overview

Single-commit, backend-only spec. Closes the migration-workflow loop so the architect-persona captured decisions (Spec 3) drive Book of Work and Shape-Spec generation, and introduces a new single-turn `product-manager--migration-delivery-sequencing` task whose answer is itself persisted as a captured decision via the Spec 2 POST endpoint.

Total Task Groups: 4
Total Sub-tasks: 36
Test surfaces: 6 (capped at 4-8 tests each, ~40 tests total). All LLM calls mocked.

Files touched:
- Updated prompts: `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`, `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
- Updated task configs: `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`, `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
- New task config: `gateway/src/config/tasks/product-manager--migration-delivery-sequencing.json`
- New prompt: `gateway/src/config/prompts/product-manager.migration-delivery-sequencing.task.md`
- New handler: `gateway/src/services/migrationDeliverySequencingHandler.ts`
- New validator: `gateway/src/services/migrationDeliverySequencingResponseValidator.ts`
- Extended validator: `gateway/src/services/specGenerationResponseValidator.ts`
- Handler hook (ordering): `gateway/src/services/migrationShapeSpecGenerationHandler.ts`

## Task List

### Group 1 - Prompt + Config Updates for Existing PM Tasks

#### Task Group 1: Update existing delivery-plan and shape-spec-generation prompts + configs
**Dependencies:** None

- [x] 1.0 Complete additive prompt + config updates for both existing PM tasks
  - [x] 1.1 Write 4-8 focused tests for the additive prompt + config updates
    - Test file: `gateway/src/__tests__/migrationPmTaskPromptAndConfigUpdates.test.ts` (new)
    - Cover (sub-cap 4-8 total across the two surfaces):
      - delivery-plan prompt: new heading `## Target State Decisions Context` present
      - delivery-plan prompt: anti-rule "do not ask the user follow-up questions about technology choices" substring present
      - delivery-plan prompt: `[decision:<code>]` tagging mention present
      - delivery-plan prompt: each of the 8 existing rules still present (one assertion per rule or grouped)
      - shape-spec-generation prompt: new heading + `evidenceRefs[]` + `{type: 'captured_decision', id:` substring + Postgres/MySQL anti-rule substring + existing 8 rules preserved
      - both task-config `.json` files: `contextNeeds` array contains `target-state-decisions-context` AND still contains `migration-discovery-context`
      - both task-config `.json` files: no other top-level keys changed (snapshot existing keys list)
    - Skip golden-file diffs; structural substring assertions only per Q6
  - [x] 1.2 Update `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
    - Add new section `## Target State Decisions Context` explaining captured decisions are facts (not alternatives)
    - Add rule: "Initiative grouping must align with captured decisions" with `db.engine` and `service.framework` examples
    - Add rule: "Stories must reference the decision codes that drove them in their rationale / evidence section"
    - Add rule: "Use `[decision:<code>]` tags inline in story rationale where applicable" (mirrors Spec 3 mapping-row convention)
    - Add anti-rule: "Do not ask the user follow-up questions about technology choices - flag inferred gaps as warnings in the structured response instead"
    - Preserve existing 8 prompt rules verbatim - additive only, no deletions
  - [x] 1.3 Update `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`
    - Append `target-state-decisions-context` to `contextNeeds` array (keep `migration-discovery-context`)
    - Do not modify `availableFrom`, persona, model, or turn-limit
  - [x] 1.4 Update `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
    - Add `## Target State Decisions Context` section
    - Add rule: "Every generated shape-spec must include `evidenceRefs[]` entries with `{type: 'captured_decision', id: '<decision_code>'}` naming the decision codes that drove the story. If no decision applies, the story should explain why in its rationale."
    - Add rule: "Use `[decision:<code>]` tags inline in story rationale where applicable"
    - Add anti-rule: "Do not generate technology-specific implementation detail that contradicts a captured decision" with Postgres-not-MySQL example
    - Add gap-handling rule: "If the captured decisions context appears incomplete relative to the story scope, flag the gap as a structured warning rather than inventing a default"
    - Preserve existing 8 prompt rules verbatim
  - [x] 1.5 Update `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
    - Append `target-state-decisions-context` to `contextNeeds` array
    - No other changes
  - [x] 1.6 Ensure Group 1 tests pass
    - Run ONLY the tests written in 1.1 (`npx jest gateway/src/__tests__/migrationPmTaskPromptAndConfigUpdates.test.ts`)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 1.1 pass
- Both updated `.task.md` files contain the new section and rules, with the existing 8 rules untouched
- Both updated `.json` files contain `target-state-decisions-context` in `contextNeeds` with no other changes

### Group 2 - New Sequencing Task: Config + Prompt + Handler + Validator

#### Task Group 2: Build the new `product-manager--migration-delivery-sequencing` task end-to-end
**Dependencies:** Task Group 1 (none functional, but logical follow-on; can run independently)

- [x] 2.0 Complete the new sequencing task across all four new files plus tests
  - [x] 2.1 Write 4-8 focused tests for the sequencing handler
    - Test file: `gateway/src/__tests__/migrationDeliverySequencingHandler.test.ts` (new)
    - Mock the LLM client, `fetchLatestCapturedDecisions`, `fetchActiveTargetArchitectureId`, and the captured-decisions POST surface on `targetStateCapturedDecisionsClient.ts`
    - Cover (cap 4-8 total):
      - Happy path: handler posts to the Spec 2 captured-decisions endpoint with `decision_code='delivery.sequencing'`, `scope_kind='architecture'`, `createdByTask='product-manager--migration-delivery-sequencing'`, `conversationThreadId=null`, `conversationTurnRef=null`, `answer_value` = JSON-stringified `initiativeOrder` - returns `{ sequenceId, summary }`
      - No active target architecture: returns `status='insufficient_context'`, `recommendedNextAction='Define a target architecture first'`
      - No captured decisions: returns `status='insufficient_context'`, `recommendedNextAction='Run the architect conversation first'`
      - LLM error: returns `status='failed'`
      - Validator hard fail (e.g. unknown initiative ID in LLM response): returns `status='failed'` with validator messages
      - Token-budget overflow: handler throws `TokenBudgetOverflowError` when combined cascade + decisions block exceeds cap
      - Re-run path: second POST does NOT carry a `previousDecisionId` parameter (supersession via Spec 2 data plane)
  - [x] 2.2 Write 4-8 focused tests for the sequencing validator
    - Test file: `gateway/src/__tests__/migrationDeliverySequencingResponseValidator.test.ts` (new)
    - Cover (cap 4-8 total):
      - Three response variants parse correctly: `status='sequenced'`, `status='insufficient_context'`, `status='failed'`
      - Hard fail: `initiativeId` not present in supplied book of work
      - Hard fail: `parallelisableWith` entry not a valid initiative ID
      - Hard fail: `blockedBy` entry not a valid initiative ID
      - Hard fail: non-positive-integer `sequence` value
      - Hard fail: `status='sequenced'` with empty `initiativeOrder`
      - Warning only (no hard fail): cycle in `blockedBy` graph yields a structured warning but `status` is preserved
  - [x] 2.3 Create `gateway/src/config/tasks/product-manager--migration-delivery-sequencing.json`
    - `contextNeeds: ['migration-discovery-context', 'target-state-decisions-context']`
    - `persona: 'product-manager'`
    - Static `availableFrom` mirroring the existing two PM tasks (no dynamic gating at config surface per Q3 + Q10)
    - Single-turn-only behaviour
  - [x] 2.4 Create `gateway/src/config/prompts/product-manager.migration-delivery-sequencing.task.md`
    - Asks one question: given the captured decisions plus the supplied book of work, what is the recommended initiative ordering?
    - Mandatory rules: must cite decision codes in `rationale`; must reference initiative IDs from the supplied book of work; mandatory functional-equivalence clause
    - Describe the structured response shape (`initiativeOrder` with `sequence` / `parallelisableWith` / `blockedBy` / `rationale`)
    - Wording finalised at write-time per Q14
  - [x] 2.5 Create `gateway/src/services/migrationDeliverySequencingResponseValidator.ts`
    - Hand-rolled (NOT JSON-schema-library style) per Q11
    - Mirror error/warning return shape from `gateway/src/services/specGenerationResponseValidator.ts`
    - Exported entry point validates structured response: `{ status, initiativeOrder, confidence, warnings, recommendedNextAction? }`
    - Hard fails listed in 2.2 enforced; cycle in `blockedBy` graph adds a structured warning only
    - Validator takes the supplied book of work as a parameter so it can validate initiative ID membership
  - [x] 2.6 Create `gateway/src/services/migrationDeliverySequencingHandler.ts`
    - Model on `gateway/src/services/migrationBookOfWorkHandler.ts` (context resolution, token-budget cascade, single synchronous LLM call, structured-response validation, persist, return shape)
    - Required input parameter: `bookOfWorkId` (frontend supplies it; no new AMS endpoint per Q12)
    - Resolves: supplied book of work + `target-state-decisions-context` + `migration-discovery-context`
    - Runtime gating:
      - If `fetchActiveTargetArchitectureId(projectId)` returns null -> return `status='insufficient_context'`, `recommendedNextAction='Define a target architecture first'`
      - Else if `fetchLatestCapturedDecisions(projectId, targetArchitectureId)` returns zero entries -> return `status='insufficient_context'`, `recommendedNextAction='Run the architect conversation first'`
    - Token-budget cascade: decisions block appended post-cascade and never truncated; combined overflow throws `TokenBudgetOverflowError`
    - Persist: POST to Spec 2's existing captured-decisions endpoint via `targetStateCapturedDecisionsClient.ts` (reuse existing client surface; no new method) with the write attributes specified in 2.1
    - Return shape: `{ sequenceId, summary }`
    - Use plain-English "Architecture Model Service" in log lines / error messages per `feedback_no_invented_acronyms.md`
  - [x] 2.7 Ensure Group 2 tests pass
    - Run ONLY the tests written in 2.1 and 2.2
    - Commands: `npx jest gateway/src/__tests__/migrationDeliverySequencingHandler.test.ts gateway/src/__tests__/migrationDeliverySequencingResponseValidator.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 handler tests in 2.1 and 4-8 validator tests in 2.2 pass (cap respected per surface)
- The new sequencing task appears in the PM-task menu via existing task-config-driven menu rendering (no frontend change required)
- Handler posts to Spec 2 with the exact write attributes specified; both `insufficient_context` paths return distinct `recommendedNextAction` strings
- Validator hard fails enforce the four rules and cycle detection is warning-only

### Group 3 - Shape-Spec Validator Extension

#### Task Group 3: Extend `specGenerationResponseValidator.ts` + wire handler ordering
**Dependencies:** Task Group 1 (uses the updated shape-spec prompt context); independent of Task Group 2

- [x] 3.0 Extend the existing hand-rolled shape-spec validator with missing-citation warning and confidence downgrade
  - [x] 3.1 Write 4-8 focused tests for the validator extension
    - Test file: `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts` (new)
    - Mock `fetchLatestCapturedDecisions` to control the captured-decisions list per test case
    - Cover (cap 4-8 total):
      - Missing-citation: project has captured decisions, story `evidenceRefs[]` has zero `captured_decision` entries -> appends `{kind: 'missing_decision_citation', recommendedNextAction: 'review and add decision codes'}` warning
      - Confidence downgrade `high` -> `medium`
      - Confidence downgrade `medium` -> `low`
      - Confidence stays `low` -> `low`
      - No downgrade when project has zero captured decisions
      - No downgrade when story already contains at least one `evidenceRef` with `type: 'captured_decision'`
      - Per-story scope: one story missing citation while another in the same response has a citation - only the missing one is downgraded / warned
  - [x] 3.2 Extend `gateway/src/services/specGenerationResponseValidator.ts`
    - For responses with `status='generated'` or `status='generated_with_warnings'`:
      - If project has captured decisions (loaded via existing `fetchLatestCapturedDecisions` on `targetStateCapturedDecisionsClient.ts` - no new client method per Q17) AND a story's `evidenceRefs[]` contains zero entries with `type: 'captured_decision'`, append `{kind: 'missing_decision_citation', recommendedNextAction: 'review and add decision codes'}` warning to that story and downgrade its LLM-rated confidence by one notch (`high`->`medium`, `medium`->`low`, `low` stays `low`)
    - Per-story check; do NOT cross-check whether the story's scope actually intersects a decision domain (deferred per Out of Scope)
    - Additive: no behaviour change for projects with zero captured decisions
  - [x] 3.3 Wire ordering inside `gateway/src/services/migrationShapeSpecGenerationHandler.ts`
    - Confirm and (if needed) adjust call sequence to: parse LLM response -> validator extension (warnings + confidence downgrade) -> auto-seed (existing May-19 behaviour) -> persist (per Q18)
    - No other handler behaviour change
  - [x] 3.4 Ensure Group 3 tests pass
    - Run ONLY the tests written in 3.1 (`npx jest gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 3.1 pass
- Validator extension fires only when project has captured decisions AND a story has zero `captured_decision` evidenceRefs
- Confidence downgrade is one-notch and bounded at `low`
- Handler ordering inside `migrationShapeSpecGenerationHandler.ts` is parse -> validator extension -> auto-seed -> persist

### Group 4 - Verification

#### Task Group 4: Test review, gap analysis, and Definition-of-Done verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Verify the feature meets the spec's Definition of Done and contains no out-of-scope changes
  - [x] 4.1 Review the focused tests from Task Groups 1-3
    - Review 4-8 tests written by Group 1 (prompts + config)
    - Review 4-8 + 4-8 tests written by Group 2 (handler + validator)
    - Review 4-8 tests written by Group 3 (shape-spec validator extension)
    - Total existing tests: approximately 16-32 across 5 test files
  - [x] 4.2 Analyze test coverage gaps for THIS spec only
    - Identify critical end-to-end seams that lack coverage: e.g. the `contextNeeds` -> resolver -> prompt context delivery seam for the two existing PM tasks; the sequencing handler -> POST captured-decisions integration; the validator extension -> handler ordering seam
    - Focus ONLY on this spec's feature requirements; do NOT assess application-wide coverage
    - Do not chase edge cases, performance tests, or accessibility tests
  - [x] 4.3 Write up to 10 additional strategic tests maximum (if needed)
    - Candidate gap-fillers (only add if gap is clearly critical):
      - End-to-end: a delivery-plan-handler test that asserts the resolved context fed to the LLM includes the rendered `target-state-decisions-context` block (mock the resolver, snapshot the prompt input)
      - End-to-end: a shape-spec-generation-handler test that asserts the parse -> validator extension -> auto-seed -> persist ordering is preserved (mock each stage, assert call order)
      - End-to-end: re-running the sequencing task twice in the same test to confirm second POST omits `previousDecisionId` (if not already covered in 2.1)
    - Cap: 10 additional tests max across the spec; prefer skipping a gap rather than over-testing
  - [x] 4.4 Grep sweeps to confirm no out-of-scope changes
    - Confirm no new files under `architecture-model-service/` (no new AMS endpoints)
    - Confirm no new files under `frontend/` (no frontend changes)
    - Confirm no new method added to `gateway/src/services/targetStateCapturedDecisionsClient.ts` (reuse existing surface only)
    - Confirm no Liquibase changeset added
    - Confirm no new `fetchLatestCapturedDecisionsStructured` symbol introduced anywhere
    - Confirm `evidenceRefs` entries use the snake_case `type: 'captured_decision'` convention (not `capturedDecision` camelCase)
  - [x] 4.5 Walk the spec's Definition of Done bullet-by-bullet
    - Verify each of the 10 DoD bullets in `spec.md` lines 156-166 is satisfied by the implemented code + tests
    - Specifically confirm:
      - Sequencing task POSTs with the exact write attributes (decision_code, scope_kind, createdByTask, null thread/turn ref)
      - Both `insufficient_context` paths have distinct `recommendedNextAction` text
      - Token-budget overflow throws `TokenBudgetOverflowError` and never silently drops decision lines
      - Re-run path does not carry `previousDecisionId`
      - `evidenceRefs[]` object shape is `{type: 'captured_decision', id: '<decision_code>'}`
  - [x] 4.6 Run feature-specific tests only
    - Run ONLY the 5 test files added/extended by this spec (plus any added in 4.3)
    - Expected total: approximately 16-42 tests
    - Do NOT run the entire application test suite
    - Verify all pass
  - [x] 4.7 Confirm pre-existing test failures untouched
    - Per project memory, the listed pre-existing failures (`bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-integration.test.ts`, `chatV2-panel-context-and-filtering.test.ts`) are unrelated to this work
    - Do NOT modify any of these tests; confirm by `git status` showing no edits to those files

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-42 tests total across 5-6 files)
- All 10 Definition-of-Done bullets in `spec.md` are demonstrably satisfied
- No more than 10 additional tests added in 4.3
- Grep sweeps confirm no out-of-scope changes (no AMS endpoints, no frontend, no new client method, no Liquibase changeset, no `fetchLatestCapturedDecisionsStructured`)
- Pre-existing test failures from project memory are untouched

## Execution Order

Recommended implementation sequence:
1. **Group 1** - Prompt + config updates for the two existing PM tasks (additive, lowest-risk, unblocks resolver wiring for downstream prompts)
2. **Group 2** - New sequencing task end-to-end (config + prompt + handler + validator); can run in parallel with Group 3 since they touch disjoint files
3. **Group 3** - Shape-spec validator extension + handler ordering hook
4. **Group 4** - Verification, grep sweeps, Definition-of-Done walkthrough, feature-scoped test run

All work lands in a single commit per the spec's commit-boundary requirement.
