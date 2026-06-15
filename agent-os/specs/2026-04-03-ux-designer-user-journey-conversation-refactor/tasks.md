# Task Breakdown: UX Designer User Journey Conversation Refactor

## Overview
Total Tasks: 17

This spec modifies exactly 2 files -- a task JSON config and a task prompt markdown file -- to refactor the UX Designer "Define Users & Interactions" task into a spreadsheet-first "Define User Journeys" conversation. No new code paths, components, or persistence flows are introduced. The changes are purely configuration and prompt authoring, but they require careful validation that the rest of the system (registry loading, context injection, artifact flow suppression) continues to work correctly.

## Task List

### Gateway Configuration Layer

#### Task Group 1: Task Card Configuration Update
**Dependencies:** None

- [x] 1.0 Complete task card configuration update
  - [x] 1.1 Write 4 focused tests for the updated task configuration
    - Test 1: Registry loader loads `ux-designer--users-interactions` successfully after config changes (responseFormat null, artifacts empty)
    - Test 2: The loaded task has `menuLabel` equal to `"Define User Journeys"`
    - Test 3: The loaded task has `responseFormat` equal to `null` and `artifacts` equal to `[]`
    - Test 4: The loaded task retains unchanged fields (`mode: "discovery"`, `contextNeeds: ["mission"]`, `persistence: "hub"`, `availableFrom: ["hub", "panel"]`)
    - Add these tests to a new file `gateway/src/__tests__/ux-designer-user-journey-task-config.test.ts`
    - Follow the pattern in `gateway/src/__tests__/registryLoader.test.ts` (mock config to point at real config dir, call `initializeRegistries()`, then query `getTaskRegistry()`)
  - [x] 1.2 Update `gateway/src/config/tasks/ux-designer--users-interactions.json`
    - Change `menuLabel` from `"Define Users & Interactions"` to `"Define User Journeys"`
    - Change `description` to: `"Ingests structured spreadsheet input to define user journeys, activity steps, and pain points. Validates structure, identifies gaps, and prepares data for persistence into the Business Architecture meta-model."`
    - Set `responseFormat` to `null` (remove the entire JSON schema object with phase/section/questions/summary)
    - Set `artifacts` to `[]` (remove the `save_users_interactions` object)
    - Preserve unchanged fields: `id: "ux-designer--users-interactions"`, `personaId: "ux-designer"`, `mode: "discovery"`, `taskPromptRef: "prompts/ux-designer.users-interactions.task.md"`, `contextNeeds: ["mission"]`, `persistence: "hub"`, `phases: null`, `availableFrom: ["hub", "panel"]`
    - Reference `gateway/src/config/tasks/ux-designer--ui-domain.json` as the target configuration pattern (it already uses `responseFormat: null` and `artifacts: []`)
  - [x] 1.3 Verify existing registry loader test still passes
    - Run the existing `gateway/src/__tests__/registryLoader.test.ts` to confirm the updated JSON loads without validation errors
    - The task count assertions (15-17 range) and spot-check assertions should still pass since the task ID is preserved
  - [x] 1.4 Ensure task config tests pass
    - Run ONLY the 4 tests written in 1.1 plus the existing `registryLoader.test.ts`
    - Verify the updated task config loads correctly and all field values match expectations

**Acceptance Criteria:**
- The 4 tests from 1.1 pass
- The existing `registryLoader.test.ts` continues to pass
- `ux-designer--users-interactions.json` has `menuLabel: "Define User Journeys"`, `responseFormat: null`, `artifacts: []`
- All unchanged fields (`id`, `personaId`, `mode`, `taskPromptRef`, `contextNeeds`, `persistence`, `phases`, `availableFrom`) are preserved exactly
- The task config matches the pattern established by `ux-designer--ui-domain.json`

---

### Prompt Authoring Layer

#### Task Group 2: Spreadsheet-First Conversation Prompt
**Dependencies:** Task Group 1

- [x] 2.0 Complete new task prompt file
  - [x] 2.1 Write 3 focused tests for prompt file integrity
    - Test 1: The prompt file `gateway/src/config/prompts/ux-designer.users-interactions.task.md` exists and is non-empty
    - Test 2: The prompt file does NOT contain any of the old structured-questions format keywords (`"phase"`, `"section"`, `"questions"`, `RESPONSE FORMAT`, `valid JSON`, `"ready"`, `"user_roles"`, `"business_processes"`, `"process_activities"`, `"ui_screens"`)
    - Test 3: The prompt file contains key spreadsheet-first keywords (`CSV`, `User Journey`, `Activity Step`, `Process Activit`, `ARCHITECTURE CONTEXT`, `sequence_order`, `clarifying`)
    - Add these tests to a new file `gateway/src/__tests__/ux-designer-user-journey-prompt.test.ts`
    - These are file-content validation tests using `fs.readFile` -- they verify the prompt was fully replaced, not partially edited
  - [x] 2.2 Replace entire content of `gateway/src/config/prompts/ux-designer.users-interactions.task.md`
    - Remove ALL existing content (the structured Q&A prompt with sections, looping strategy, JSON response format rules)
    - Write the new spreadsheet-first conversation prompt covering all sections below (2.3 through 2.9)
  - [x] 2.3 Write the "Your Role" section
    - Instruct the LLM that it is leading a spreadsheet-first User Journey ingestion conversation
    - State that responses must be free-text markdown (not JSON)
    - Reference the ARCHITECTURE CONTEXT section for cross-referencing
  - [x] 2.4 Write the "First Turn: Request CSV Input" section
    - Instruct the LLM to begin by requesting three CSV files (one per worksheet-equivalent) or pasted tab/comma-separated text
    - The three inputs: (1) Process Activities, (2) User Journeys, (3) Activity Steps
    - If the user asks for help or does not provide files, describe the expected columns for each CSV
  - [x] 2.5 Write the "Expected CSV Column Structures" section
    - CSV 1 -- Process Activities: process activity name, associated business process, actor/role hints, sequence ordering
    - CSV 2 -- User Journeys: journey name, description (optional), primary business user (optional), parent business process (optional)
    - CSV 3 -- Activity Steps: user journey name, process activity name, business user name, application name, sequence order, description (optional)
    - Note: accept both CSV (comma-separated) and PSV (pipe-separated) multi-value fields for roles and applications
  - [x] 2.6 Write the "Intermediate Structured Representation" section
    - Define `user_journeys` fields: name, description, primary_business_user, parent_business_process
    - Define `activity_steps` fields: user_journey_name, process_activity_name, business_user_name, application_name, sequence_order, description
    - Fields limited strictly to what matches `UserJourneyEntity` and `ActivityStepEntity` column schemas
    - Explicitly state that `activity_related_issues` and `ui_related_issues` are excluded
  - [x] 2.7 Write the "Architecture Context Cross-Referencing" section
    - Instruct the LLM to cross-reference parsed entity names (business users, applications, process activities, business processes) against the injected ARCHITECTURE CONTEXT section
    - Unknown references should be flagged as warnings
  - [x] 2.8 Write the "Validation Rules" section
    - Hard validation (errors): activity steps referencing unknown/unmatched journey names; missing required fields (journey name, step journey reference, process activity reference, business user reference, application reference)
    - Soft validation (warnings): missing sequence_order; duplicate sequence_order within same journey; role/application/process names not found in architecture context; missing optional descriptions; orphaned roles or applications appearing in steps but not in any journey
  - [x] 2.9 Write the "Clarifying Questions" section
    - Maximum approximately 5 targeted, gap-filling questions
    - Questions must be grouped together in a single turn (not spread across multiple rounds)
    - Must NOT attempt to recreate spreadsheet data via exploratory Q&A
    - Must NOT ask broad exploratory UX questions
    - Focus on: missing required references, ambiguous name mappings, obvious structural inconsistencies
  - [x] 2.10 Write the "Final Summary Output" section
    - After clarification, present a final summary listing: detected User Journeys, Activity Steps per journey (ordered by sequence_order), highlighted structural issues/unknown references
    - Summary must be human-readable markdown, not raw JSON
    - Rendered as a regular markdown message bubble
  - [x] 2.11 Write the "Prohibitions" section
    - Must NOT call any MCP save tools
    - Must NOT emit diagram JSON
    - Must NOT attempt to render diagrams
    - Must NOT use the old structured-questions format
    - Must NOT ask the user to confirm/save (there is no artifact flow)
  - [x] 2.12 Ensure prompt tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify the prompt file exists, contains no old format remnants, and contains key new format keywords

**Acceptance Criteria:**
- The 3 tests from 2.1 pass
- The prompt file is a complete replacement with no remnants of the old structured Q&A format
- The prompt covers all seven conversation aspects: role definition, first-turn CSV request, column structures, structured representation, architecture cross-referencing, validation rules, clarifying questions, final summary, and prohibitions
- The prompt instructs free-text markdown responses (not JSON)
- The prompt references ARCHITECTURE CONTEXT for cross-referencing
- Entity field boundaries match `UserJourneyEntity` and `ActivityStepEntity` schemas

---

### Integration Verification Layer

#### Task Group 3: System Integration and Dead Code Verification
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete integration verification
  - [x] 3.1 Write 4 focused tests for integration correctness
    - Test 1: The `fullArchContextTasks` set in `chatV2.ts` still contains `'ux-designer--users-interactions'` (verify context injection is wired)
    - Test 2: The task's `taskPromptRef` value (`prompts/ux-designer.users-interactions.task.md`) resolves to an existing file relative to the config directory
    - Test 3: The `ux-designer--ui-domain` task config is unchanged (no accidental modifications to sibling task)
    - Test 4: The `ux-designer.identity.md` persona prompt file is unchanged (compare hash or content snapshot against a known substring)
    - Add these tests to the file created in 1.1 (`gateway/src/__tests__/ux-designer-user-journey-task-config.test.ts`) as additional describe block, or create `gateway/src/__tests__/ux-designer-user-journey-integration.test.ts`
  - [x] 3.2 Verify artifact flow is dead code for this task
    - Confirm that with `artifacts: []`, the generation path at `chatV2.ts` line ~1688 (`if (artifactType === 'users-interactions')`) is unreachable for this task
    - Confirm the save path at `chatV2.ts` line ~2183 (`else if (artifactType === 'users-interactions')`) is unreachable for this task
    - This is a manual code review verification -- no code changes needed in `chatV2.ts`
  - [x] 3.3 Verify no changes leaked to out-of-scope files
    - Confirm `gateway/src/routes/chatV2.ts` has zero modifications
    - Confirm `gateway/src/services/promptComposer.ts` has zero modifications
    - Confirm `gateway/src/services/promptBuilder.ts` has zero modifications
    - Confirm `frontend/src/utils/fileUploadUtils.ts` has zero modifications
    - Confirm `frontend/src/components/UnifiedChat/UsersInteractionsPreviewBubble.tsx` has zero modifications
    - Confirm `gateway/src/config/prompts/ux-designer.identity.md` has zero modifications
    - Confirm `gateway/src/config/tasks/ux-designer--ui-domain.json` has zero modifications
    - Use `git diff` to verify only the 2 target files are modified
  - [x] 3.4 Ensure integration tests pass
    - Run ONLY the tests written in 3.1
    - Verify architecture context injection remains wired
    - Verify sibling tasks and persona prompts are untouched

**Acceptance Criteria:**
- The 4 tests from 3.1 pass
- The `fullArchContextTasks` set still includes this task ID
- The task prompt file resolves correctly from the registry
- No out-of-scope files were modified
- The artifact generation and save paths in `chatV2.ts` are confirmed as dead code for this task (no code changes needed)

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests from Task Group 1 (task config validation)
    - Review the 3 tests from Task Group 2 (prompt file integrity)
    - Review the 4 tests from Task Group 3 (integration correctness)
    - Total existing tests: 11 new tests plus existing `registryLoader.test.ts` (6 tests)
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify any critical validation scenarios not covered by the 11 new tests
    - Focus on: configuration correctness, prompt content integrity, and integration wiring
    - Do NOT assess entire application test coverage
    - Consider whether the `whatsNextEvaluator.test.ts` (which references `users-interactions`) needs verification
  - [x] 4.3 Write up to 5 additional strategic tests if needed
    - Potential gap: Verify the `ux-designer.json` persona file still lists `ux-designer--users-interactions` in its tasks array
    - Potential gap: Verify the prompt file does not exceed a reasonable size (sanity check that it was not accidentally truncated or left empty)
    - Potential gap: Verify the updated task description matches the spec exactly (string comparison)
    - Do NOT write tests for chatV2.ts behavior (no code changes there)
    - Do NOT write tests for frontend components (no component changes)
  - [x] 4.4 Run all feature-specific tests
    - Run ONLY tests related to this spec (the 11+ new tests from groups 1-3, plus any added in 4.3)
    - Also run the existing `registryLoader.test.ts` to confirm no regression
    - Expected total: approximately 11-16 feature-specific tests
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 11-16 tests total)
- Critical configuration, prompt integrity, and integration scenarios are covered
- No more than 5 additional tests added in gap analysis
- Testing focused exclusively on the 2 modified files and their integration points

---

## Execution Order

Recommended implementation sequence:
1. **Task Card Configuration** (Task Group 1) -- Update the JSON config first since the prompt depends on understanding the new config shape
2. **Prompt Authoring** (Task Group 2) -- Write the new spreadsheet-first prompt after the config is finalized
3. **Integration Verification** (Task Group 3) -- Verify the full system integration after both files are modified
4. **Test Review and Gap Analysis** (Task Group 4) -- Final review of all tests and coverage

## Files Modified

| File | Change Type |
|------|-------------|
| `gateway/src/config/tasks/ux-designer--users-interactions.json` | Modify in place: menuLabel, description, responseFormat, artifacts |
| `gateway/src/config/prompts/ux-designer.users-interactions.task.md` | Full rewrite: replace structured Q&A with spreadsheet-first prompt |

## Files Created (Tests Only)

| File | Purpose |
|------|---------|
| `gateway/src/__tests__/ux-designer-user-journey-task-config.test.ts` | Task config validation tests (Task Groups 1 and 3) |
| `gateway/src/__tests__/ux-designer-user-journey-prompt.test.ts` | Prompt file integrity tests (Task Group 2) |

## Files Unchanged (Verified in Task Group 3)

| File | Reason |
|------|--------|
| `gateway/src/routes/chatV2.ts` | No code changes needed; existing wiring handles null responseFormat, empty artifacts, architecture context injection |
| `gateway/src/services/promptComposer.ts` | Pipeline works unchanged with null responseFormat |
| `gateway/src/services/promptBuilder.ts` | USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE becomes dead code |
| `frontend/src/utils/fileUploadUtils.ts` | CSV already in accepted extensions and MIME types |
| `frontend/src/components/UnifiedChat/UsersInteractionsPreviewBubble.tsx` | Never triggered with empty artifacts array |
| `gateway/src/config/prompts/ux-designer.identity.md` | Persona identity prompt reused as-is |
| `gateway/src/config/tasks/ux-designer--ui-domain.json` | Sibling task unchanged |
| `gateway/src/config/personas/ux-designer.json` | Persona definition unchanged; tasks array still references same task ID |
