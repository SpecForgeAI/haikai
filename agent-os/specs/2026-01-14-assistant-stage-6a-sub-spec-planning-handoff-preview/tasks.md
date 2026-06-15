# Task Breakdown: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview

## Overview
Total Tasks: 25 sub-tasks across 5 task groups

This feature introduces a structured handoff plan that the Planner LLM generates when the user clicks Implement. Instead of directly generating specs, the system first produces a preview of the plan showing how the feature will be split into sub-specs (if needed). The UI displays this plan for user review before any execution occurs.

## Task List

### Gateway Types Layer

#### Task Group 1: Type Definitions and Schema
**Dependencies:** None

- [x] 1.0 Complete Gateway type definitions
  - [x] 1.1 Write 3-5 focused tests for HandoffPlanResponse schema validation
    - Test valid HandoffPlanResponse parsing
    - Test is_split consistency with handoff_intents length
    - Test minimum handoff_intents.length >= 1 constraint
    - Test HandoffIntent field presence (id, title, intent, dependencies)
  - [x] 1.2 Define HandoffIntent interface in `gateway/src/types/chat.ts`
    - Fields: id (string), title (string), intent (string)
    - Fields: in_scope (string[]), out_of_scope (string[])
    - Fields: acceptance_criteria (string[]), dependencies (string[])
    - Follow ResolvedEntitySummary pattern for interface structure
  - [x] 1.3 Define HandoffPlanResponse interface in `gateway/src/types/chat.ts`
    - Fields: is_split (boolean), handoff_plan_summary (string)
    - Fields: handoff_intents (HandoffIntent[])
    - Add JSDoc comments describing constraints
  - [x] 1.4 Extend ChatResponse interface with optional handoffPlan field
    - Add `handoffPlan?: HandoffPlanResponse` to ChatResponse in `gateway/src/types/chat.ts`
    - Document that field is populated for phase='handoff' responses
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- HandoffIntent and HandoffPlanResponse interfaces compile without errors
- ChatResponse includes optional handoffPlan field
- Type constraints documented in JSDoc comments

---

### Gateway Prompt Layer

#### Task Group 2: Handoff Planning Prompt Template and Builder
**Dependencies:** Task Group 1

- [x] 2.0 Complete handoff planning prompt template and builder
  - [x] 2.1 Write 4-6 focused tests for buildHandoffPlanningPrompt function
    - Test prompt includes work item context placeholders
    - Test prompt includes architecture context placeholders
    - Test prompt includes resolved context when provided
    - Test prompt includes splitting heuristics instructions
    - Test prompt instructs JSON-only output
  - [x] 2.2 Create IMPLEMENT_HANDOFF_PLANNING_PROMPT_TEMPLATE in `gateway/src/services/promptBuilder.ts`
    - Template instructs LLM to output ONLY JSON (no prose before/after)
    - Include splitting heuristics: multi-service boundary, multiple user behaviors, data+UI, prompt orchestration
    - Specify HandoffPlanResponse JSON schema with examples
    - Instruct to keep sub-intents minimal but implementation-ready
    - Include placeholders: {workItemTitle}, {workItemType}, {workItemDescription}, {entityIds}, {diagramIds}, {resolvedContext}
  - [x] 2.3 Implement buildHandoffPlanningPrompt function in `gateway/src/services/promptBuilder.ts`
    - Mirror signature of buildGenerateSpecsPrompt(): accepts ChatContext and optional ResolvedImplementContextDto
    - Extract work item values with fallbacks
    - Extract architecture context (entityIds, diagramIds)
    - Format resolved context using existing formatResolvedContext helper
    - Replace all template placeholders
  - [x] 2.4 Update buildSystemPrompt to route handoff phase to new prompt builder
    - In buildSystemPrompt(), when phase === 'handoff', call buildHandoffPlanningPrompt() instead of buildGenerateSpecsPrompt()
    - Keep existing behavior for phase === 'bootstrap' and phase === 'refine'
  - [x] 2.5 Export buildHandoffPlanningPrompt from `gateway/src/services/index.ts`
    - Add to existing exports from promptBuilder
  - [x] 2.6 Ensure prompt builder tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify prompt template contains all required sections

**Acceptance Criteria:**
- IMPLEMENT_HANDOFF_PLANNING_PROMPT_TEMPLATE includes all heuristics from requirements
- buildHandoffPlanningPrompt() produces valid prompt string
- buildSystemPrompt() correctly routes handoff phase to new builder
- Function exported from services index

---

### Gateway Validation and Routing Layer

#### Task Group 3: Handoff Plan Validation and Chat Route Integration
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete handoff validation and chat route integration
  - [x] 3.1 Write 5-7 focused tests for validateHandoffPlan function
    - Test valid JSON parsing
    - Test invalid JSON returns error
    - Test schema validation (required fields present)
    - Test handoff_intents.length >= 1 constraint
    - Test is_split consistency (length > 1 means is_split = true)
    - Test is_split consistency (length == 1 means is_split = false)
  - [x] 3.2 Create `gateway/src/services/handoffPlanValidator.ts` with validation logic
    - Define HandoffPlanValidationResult interface: { valid: boolean; plan?: HandoffPlanResponse; error?: string }
    - Implement validateHandoffPlan(content: string): HandoffPlanValidationResult
    - Validation rules: valid JSON, schema match, length >= 1, is_split consistency
    - Follow pattern from specsValidator.ts
  - [x] 3.3 Export validateHandoffPlan from `gateway/src/services/index.ts`
    - Add HandoffPlanValidationResult type export
    - Add validateHandoffPlan function export
  - [x] 3.4 Update chat route POST handler for handoff phase validation
    - In `gateway/src/routes/chat.ts`, detect when context.phase === 'handoff'
    - After LLM response, call validateHandoffPlan(response.content)
    - If valid: include handoffPlan in ChatResponse
    - If invalid: log error and build fallback single-intent plan
  - [x] 3.5 Implement fallback plan generation in chat route
    - Build fallback HandoffPlanResponse when validation fails
    - Use work item context for single intent: is_split=false, handoff_plan_summary from title
    - Single handoff_intents entry with id="S1", title from work item, intent from description
  - [x] 3.6 Ensure validation and routing tests pass
    - Run ONLY the 5-7 tests written in 3.1
    - Verify chat route handles both valid and invalid handoff responses

**Acceptance Criteria:**
- validateHandoffPlan correctly validates all schema constraints
- Chat route includes handoffPlan in response for valid plans
- Fallback plan generated for invalid LLM responses
- Errors logged for invalid responses

---

### Frontend Types Layer

#### Task Group 4: Frontend Type Definitions and State Management
**Dependencies:** Task Group 1 (for type alignment)

- [x] 4.0 Complete frontend type definitions and state management
  - [x] 4.1 Write 3-5 focused tests for handoffPlan state management
    - Test handoffPlan state initialized as null
    - Test handoffPlan state updates when response contains plan
    - Test handoffPlan state persisted to ProductUiStateContext
    - Test handoffPlan state hydrated from context on mount
  - [x] 4.2 Define HandoffIntent and HandoffPlanResponse interfaces in `frontend/src/api/chatApi.ts`
    - Mirror gateway type definitions for consistency
    - HandoffIntent: id, title, intent, in_scope, out_of_scope, acceptance_criteria, dependencies
    - HandoffPlanResponse: is_split, handoff_plan_summary, handoff_intents
  - [x] 4.3 Extend ChatResponse interface in `frontend/src/api/chatApi.ts`
    - Add optional `handoffPlan?: HandoffPlanResponse` field
    - Matches gateway ChatResponse extension
  - [x] 4.4 Add handoffPlan state to ImplementationAssistantPanel
    - Add state: `const [handoffPlan, setHandoffPlan] = useState<HandoffPlanResponse | null>(null)`
    - Update handleImplement to extract handoffPlan from response
    - Store handoffPlan when response.handoffPlan is present
  - [x] 4.5 Update ImplementChatUiState for handoffPlan persistence
    - Add handoffPlan field to ImplementChatUiState in ProductUiStateContext
    - Update persistChatState callback to include handoffPlan
    - Update hydration logic to restore handoffPlan from stored state
  - [x] 4.6 Ensure frontend state tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Verify state management works correctly

**Acceptance Criteria:**
- HandoffIntent and HandoffPlanResponse interfaces defined in frontend
- ChatResponse extended with handoffPlan field
- handoffPlan state properly managed in ImplementationAssistantPanel
- State persisted across tab switches via ProductUiStateContext

---

### Frontend UI Layer

#### Task Group 5: Handoff Plan Preview Panel UI
**Dependencies:** Task Group 4

- [x] 5.0 Complete handoff plan preview panel UI
  - [x] 5.1 Write 4-6 focused tests for HandoffPlanPreview rendering
    - Test panel renders when handoffPlan is non-null
    - Test panel shows handoff_plan_summary text
    - Test panel lists all sub-intents with id and title
    - Test panel hidden when handoffPlan is null
    - Test panel shows single intent differently than multiple
  - [x] 5.2 Add CSS classes to `ImplementationAssistantPanel.module.css`
    - `.handoffPlanPanel`: container with max-height, overflow, distinct border color (purple/indigo)
    - `.handoffPlanHeader`: sticky header with title and accent background
    - `.handoffPlanSummary`: prominent summary text display
    - `.handoffIntentList`: list container for sub-intents
    - `.handoffIntentItem`: individual intent item styling (id badge + title)
    - Use purple/indigo accent (#7c4dff or similar) to differentiate from green specs panel
  - [x] 5.3 Implement HandoffPlanPreview section in ImplementationAssistantPanel
    - Add conditional rendering: `{handoffPlan && <div className={styles.handoffPlanPanel}>...}`
    - Render header with "Handoff Plan Preview" title
    - Render handoff_plan_summary prominently
    - Map handoff_intents to list items showing id + title
    - Panel is view-only (no Execute or Confirm buttons in this stage)
  - [x] 5.4 Position preview panel appropriately in component layout
    - Place after messages/content area and before or alongside specsPanel
    - Ensure scroll behavior works correctly
    - Match visual pattern of existing specsPanel but with different accent
  - [x] 5.5 Handle single vs multiple intents display
    - When is_split=false (single intent): show simplified "Single implementation unit" indicator
    - When is_split=true: show full list with numbered items (S1, S2, etc.)
  - [x] 5.6 Ensure UI component tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify visual rendering matches requirements

**Acceptance Criteria:**
- Handoff Plan Preview panel renders correctly when handoffPlan is present
- Summary and sub-intent list displayed clearly
- Panel uses distinct visual treatment (purple/indigo accent)
- Panel is view-only with no execution controls
- Responsive and scrollable

---

### Test Review

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-5 tests from schema validation (Task 1.1)
    - Review the 4-6 tests from prompt builder (Task 2.1)
    - Review the 5-7 tests from validation and routing (Task 3.1)
    - Review the 3-5 tests from frontend state (Task 4.1)
    - Review the 4-6 tests from UI components (Task 5.1)
    - Total existing tests: approximately 19-29 tests
  - [x] 6.2 Analyze test coverage gaps for handoff planning feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to this spec's requirements
    - Prioritize integration between gateway validation and frontend display
    - Check fallback plan generation is tested
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Add integration test: full handoff flow from Implement click to preview display
    - Add test: LLM returns invalid JSON, fallback plan used
    - Add test: LLM returns valid plan with multiple intents
    - Add test: handoffPlan persists across tab switch and hydrates correctly
    - Skip edge cases, performance tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to handoff planning feature
    - Expected total: approximately 27-37 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 27-37 tests total)
- Critical handoff planning workflows covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Type Definitions** - Gateway types foundation (no dependencies)
2. **Task Group 2: Prompt Template** - Handoff planning prompt (depends on types)
3. **Task Group 3: Validation and Routing** - Gateway integration (depends on prompt)
4. **Task Group 4: Frontend Types and State** - Frontend foundation (depends on gateway types)
5. **Task Group 5: UI Preview Panel** - Visual implementation (depends on frontend state)
6. **Task Group 6: Test Review** - Final verification (depends on all groups)

## Key Files to Modify

**Gateway:**
- `gateway/src/types/chat.ts` - Add HandoffIntent, HandoffPlanResponse, extend ChatResponse
- `gateway/src/services/promptBuilder.ts` - Add template and buildHandoffPlanningPrompt function
- `gateway/src/services/handoffPlanValidator.ts` - New file for validation logic
- `gateway/src/services/index.ts` - Export new functions
- `gateway/src/routes/chat.ts` - Add handoff phase handling and fallback logic

**Frontend:**
- `frontend/src/api/chatApi.ts` - Add type definitions, extend ChatResponse
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Add state and preview panel
- `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` - Add handoff panel styles
- `frontend/src/contexts/ProductUiStateContext.tsx` - Extend ImplementChatUiState for persistence

## Out of Scope Reminders

- No execution or handoff to implementing LLM in this stage
- No persistence of handoff plans to database or file system
- No status tracking or work-item creation for sub-specs
- No user confirmation/approval workflow before execution
- No editing or modification of the handoff plan by the user
- No retry or regeneration of handoff plan from UI

## Test Summary

Final test counts after Task Group 6 completion:
- **Gateway tests**: 47 tests across 4 test files
  - `handoff-plan-types.test.ts`: 8 tests
  - `handoff-planning-prompt.test.ts`: 16 tests
  - `handoff-plan-validator.test.ts`: 16 tests
  - `handoff-chat-route-integration.test.ts`: 7 tests (new)
- **Frontend tests**: 19 tests across 3 test files
  - `handoff-plan-frontend-types.test.ts`: 4 tests
  - `handoff-plan-preview-panel.test.ts`: 8 tests
  - `handoff-plan-state-persistence.test.ts`: 7 tests (new)

**Total: 66 tests** - All passing
