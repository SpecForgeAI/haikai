# Task Breakdown: Execute Increment Pipeline

## Overview

**Spec ID:** 2026-01-23-execute-increment-pipeline
**Total Tasks:** 52
**Estimated Effort:** Medium-Large (Frontend React + State Management)

This implementation enables users to execute a 4-step implementation pipeline for increments (Shape Spec, Write Spec, Create Tasks, Implement Tasks), with progress tracking, status badges, chat messages, and completion/failure handling.

---

## Task List

### Status Type Definition

#### Task Group 1: Extend IncrementStatus Type to 6 Values
**Dependencies:** None

- [x] 1.0 Complete IncrementStatus type extension
  - [x] 1.1 Write 3-4 focused tests for IncrementStatus type
    - **File:** `frontend/src/__tests__/incrementStatus.type.test.ts`
    - Test IncrementStatus type includes all 6 values: NOT_STARTED, IN_CLARIFICATION, READY_TO_EXECUTE, EXECUTING, COMPLETED, FAILED
    - Test type guards correctly identify each status value
    - Test status derivation logic based on SA questions state
    - Test TypeScript compilation succeeds with extended type
  - [x] 1.2 Replace IncrementClarificationStatus with IncrementStatus type
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Replace existing `IncrementClarificationStatus` type with new `IncrementStatus` type
    - New type union: `'NOT_STARTED' | 'IN_CLARIFICATION' | 'READY_TO_EXECUTE' | 'EXECUTING' | 'COMPLETED' | 'FAILED'`
    - Export type for use in other components
  - [x] 1.3 Update incrementStatuses Map to use IncrementStatus
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Change Map type from `Map<string, IncrementClarificationStatus>` to `Map<string, IncrementStatus>`
    - Update all existing status assignments to use new type values
  - [x] 1.4 Implement status derivation rules
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - NOT_STARTED: No SA questions exist for this incrementId
    - IN_CLARIFICATION: SA questions exist with status='Open' for this incrementId
    - READY_TO_EXECUTE: SA questions exist, all are status='Answered' for this incrementId
    - EXECUTING, COMPLETED, FAILED: Set programmatically during pipeline execution
  - [x] 1.5 Ensure IncrementStatus type tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- IncrementStatus type includes all 6 status values
- incrementStatuses Map uses new IncrementStatus type
- Status derivation rules correctly determine status from SA questions state

---

### IncrementCard Badge Updates

#### Task Group 2: Update IncrementCard to Display All 6 Status Badges
**Dependencies:** Task Group 1

- [x] 2.0 Complete IncrementCard badge updates for 6 statuses
  - [x] 2.1 Write 5-6 focused tests for IncrementCard status badges
    - **File:** `frontend/src/__tests__/IncrementCard.allStatuses.test.tsx`
    - Test NOT_STARTED shows gray badge with "Not Started" text
    - Test IN_CLARIFICATION shows amber badge with "In Clarification" text
    - Test READY_TO_EXECUTE shows blue badge with "Ready to Execute" text
    - Test EXECUTING shows pulsing blue badge with step name (e.g., "Shaping Spec...")
    - Test COMPLETED shows green badge with "Completed" text
    - Test FAILED shows red badge with "Failed" text
  - [x] 2.2 Extend getBadgeConfig function for all 6 statuses
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Update getBadgeConfig() to return config for all 6 status values
    - Return object with: { text: string, className: string }
    - Handle executingStep prop for dynamic text during EXECUTING state
  - [x] 2.3 Add status prop accepting IncrementStatus type
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Replace or extend clarificationStatus prop with status: IncrementStatus
    - Add executingStep?: string prop for step name during execution
  - [x] 2.4 Add CSS classes for new badge states
    - **File:** `frontend/src/components/ProductView/IncrementCard.module.css`
    - Add `.statusBadgeNotStarted` - gray background (#9E9E9E)
    - Add `.statusBadgeInClarification` - amber background (#FFA726)
    - Add `.statusBadgeReadyToExecute` - blue background (#42A5F5)
    - Add `.statusBadgeExecuting` - pulsing blue background with animation
    - Add `.statusBadgeCompleted` - green background (#66BB6A)
    - Add `.statusBadgeFailed` - red background (#EF5350)
  - [x] 2.5 Add pulsing animation keyframes for EXECUTING state
    - **File:** `frontend/src/components/ProductView/IncrementCard.module.css`
    - Add @keyframes pulseBlue animation
    - Apply animation to .statusBadgeExecuting class
    - Subtle pulse effect to indicate active processing
  - [x] 2.6 Update badge rendering to show step name during EXECUTING
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - When status is EXECUTING and executingStep is provided:
    - Display executingStep text instead of "Executing"
    - Examples: "Shaping Spec...", "Writing Spec...", "Creating Tasks...", "Implementing..."
  - [x] 2.7 Ensure IncrementCard badge tests pass
    - Run ONLY the 5-6 tests written in 2.1
    - Verify all 6 badge states display correctly

**Acceptance Criteria:**
- The 5-6 tests written in 2.1 pass
- All 6 status badges display with correct colors and text
- EXECUTING state shows pulsing animation with step name
- Badge styling is consistent with existing design system

---

### Start Implementation Button

#### Task Group 3: Add Start Implementation Button to ImplementationPlanSection
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete Start Implementation button
  - [x] 3.1 Write 4-5 focused tests for Start Implementation button
    - **File:** `frontend/src/__tests__/StartImplementationButton.test.tsx`
    - Test button is visible when implementationMode=true and implementationPlan exists
    - Test button is enabled only when activeIncrement.status=READY_TO_EXECUTE
    - Test button is disabled with tooltip when status is NOT_STARTED or IN_CLARIFICATION
    - Test button text changes to "Executing..." during EXECUTING state
    - Test onClick calls controller.startPipeline(incrementId)
  - [x] 3.2 Create StartImplementationButton component
    - **File:** `frontend/src/components/ProductView/StartImplementationButton.tsx` (NEW)
    - Props: incrementId, status, onStartPipeline, isExecuting
    - Render button with conditional styling and text
    - Include disabled state tooltip
  - [x] 3.3 Implement button enabled/disabled logic
    - **File:** `frontend/src/components/ProductView/StartImplementationButton.tsx`
    - Enabled when: status === 'READY_TO_EXECUTE' AND !isExecuting
    - Disabled when: status !== 'READY_TO_EXECUTE' OR isExecuting
    - Disabled tooltip: "Answer all clarifying questions to start implementation"
  - [x] 3.4 Add button styling
    - **File:** `frontend/src/components/ProductView/StartImplementationButton.module.css` (NEW)
    - Primary button styling matching existing design system
    - Disabled state styling (grayed out)
    - Loading/executing state styling
  - [x] 3.5 Integrate button into ImplementationPlanSection
    - **File:** `frontend/src/components/ProductView/ImplementationPlanSection.tsx`
    - Position button below increment list
    - Pass required props from context
    - Wire onClick to execution controller
  - [x] 3.6 Ensure Start Implementation button tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify button behavior in all states

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Button positioned below Implementation Plan section
- Button enabled only when READY_TO_EXECUTE
- Button shows "Executing..." during pipeline execution
- Disabled tooltip displays correctly

---

### Execution State Management

#### Task Group 4: Add Execution State (executingStep, incrementArtifacts)
**Dependencies:** Task Group 1

- [x] 4.0 Complete execution state management
  - [x] 4.1 Write 4-5 focused tests for execution state
    - **File:** `frontend/src/__tests__/executionState.test.ts`
    - Test executingStep state initializes as null
    - Test executingStep updates correctly for each pipeline step
    - Test incrementArtifacts Map stores artifacts per incrementId
    - Test IncrementArtifacts type includes all required fields
    - Test state resets correctly on pipeline completion/failure
  - [x] 4.2 Define IncrementArtifacts type
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Create IncrementArtifacts interface:
      ```typescript
      interface IncrementArtifacts {
        shapeSpecArtifact?: string;
        writeSpecArtifact?: string;
        tasksSummary?: string;
        implementationResult?: string;
        error?: string;
      }
      ```
  - [x] 4.3 Add executingStep state
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [executingStep, setExecutingStep] = useState<string | null>(null)`
    - Step values: 'Shape Spec', 'Write Spec', 'Create Tasks', 'Implement Tasks'
  - [x] 4.4 Add incrementArtifacts state
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [incrementArtifacts, setIncrementArtifacts] = useState<Map<string, IncrementArtifacts>>(new Map())`
    - Stores captured outputs per incrementId
  - [x] 4.5 Add executingIncrementId state
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [executingIncrementId, setExecutingIncrementId] = useState<string | null>(null)`
    - Tracks which increment is currently executing
  - [x] 4.6 Ensure execution state tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify state initialization and updates

**Acceptance Criteria:**
- The 4-5 tests written in 4.1 pass
- executingStep state tracks current pipeline step
- incrementArtifacts stores outputs per increment
- executingIncrementId tracks active execution
- IncrementArtifacts type is properly defined

---

### Pipeline Execution Logic

#### Task Group 5: Implement executeIncrement Function with 4-Step Pipeline
**Dependencies:** Task Groups 1, 4

- [x] 5.0 Complete pipeline execution logic
  - [x] 5.1 Write 6-8 focused tests for executeIncrement function
    - **File:** `frontend/src/__tests__/executeIncrement.test.ts`
    - Test pipeline executes 4 steps in sequence: Shape Spec, Write Spec, Create Tasks, Implement Tasks
    - Test each step calls startOrchestration with correct parameters
    - Test executingStep updates at each step start
    - Test step outputs are captured in incrementArtifacts
    - Test pipeline halts on step failure
    - Test status set to EXECUTING at start
    - Test status set to COMPLETED on success
    - Test status set to FAILED on error
  - [x] 5.2 Create IncrementExecutionController hook
    - **File:** `frontend/src/hooks/useIncrementExecution.ts` (NEW)
    - Custom hook to manage pipeline execution
    - Returns: { startPipeline, executingIncrementId, executingStep, incrementArtifacts }
    - Encapsulates all pipeline execution logic
  - [x] 5.3 Implement startPipeline function
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Parameters: incrementId, workItemId, proposedFinalSubFeatureDefinition, architectureContext
    - Validate execution gating conditions
    - Set status to EXECUTING
    - Begin sequential step execution
  - [x] 5.4 Implement Step 1: Shape Spec
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Set executingStep to 'Shape Spec'
    - Call startOrchestration with shapeSpec task type
    - Capture shapeSpecArtifact output
    - Handle success/failure
  - [x] 5.5 Implement Step 2: Write Spec
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Set executingStep to 'Write Spec'
    - Call startOrchestration with writeSpec task type
    - Capture writeSpecArtifact output
    - Handle success/failure
  - [x] 5.6 Implement Step 3: Create Tasks
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Set executingStep to 'Create Tasks'
    - Call startOrchestration with createTasks task type
    - Capture tasksSummary output
    - Handle success/failure
  - [x] 5.7 Implement Step 4: Implement Tasks
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Set executingStep to 'Implement Tasks'
    - Call startOrchestration with implementTasks task type
    - Capture implementationResult output
    - Handle success/failure
  - [x] 5.8 Implement error handling and pipeline halt
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - On step failure: capture error message in incrementArtifacts
    - Set status to FAILED
    - Clear executingStep and executingIncrementId
    - Do not proceed to next step
  - [x] 5.9 Ensure pipeline execution tests pass
    - Run ONLY the 6-8 tests written in 5.1
    - Verify all 4 steps execute correctly

**Acceptance Criteria:**
- The 6-8 tests written in 5.1 pass
- Pipeline executes 4 steps sequentially
- Each step calls startOrchestration correctly
- Step outputs captured in incrementArtifacts
- Failure at any step halts pipeline
- Status transitions: READY_TO_EXECUTE -> EXECUTING -> COMPLETED/FAILED

---

### Progress Chat Messages

#### Task Group 6: Post Progress Messages to Team Chat
**Dependencies:** Task Group 5

- [x] 6.0 Complete progress chat messages
  - [x] 6.1 Write 4-5 focused tests for progress chat messages
    - **File:** `frontend/src/__tests__/pipelineProgressMessages.test.ts`
    - Test message posted when pipeline starts: "Starting implementation for [increment title]..."
    - Test message posted for each step: "Step 1/4: Shaping spec..."
    - Test message posted on completion: "Implementation completed for [increment title]"
    - Test message posted on failure with step name and error details
    - Test messages appear in Team Chat component
  - [x] 6.2 Define pipeline progress message types
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Create helper function for formatting progress messages
    - Include increment title in start/completion messages
    - Include step number and name in step messages
  - [x] 6.3 Implement postPipelineStartMessage
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Called at start of startPipeline
    - Message: "Starting implementation for [increment title]..."
    - Post to Team Chat via context/callback
  - [x] 6.4 Implement postStepProgressMessage
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Called at start of each step
    - Messages: "Step 1/4: Shaping spec...", "Step 2/4: Writing spec...", etc.
    - Post to Team Chat via context/callback
  - [x] 6.5 Implement postCompletionMessage
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Called on successful pipeline completion
    - Message: "Implementation completed for [increment title]"
    - Post to Team Chat via context/callback
  - [x] 6.6 Implement postFailureMessage
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Called on pipeline failure
    - Message: "Implementation failed at step [step name]: [error message]"
    - Include error details for debugging
    - Post to Team Chat via context/callback
  - [x] 6.7 Ensure progress message tests pass
    - Run ONLY the 4-5 tests written in 6.1
    - Verify all message types display correctly

**Acceptance Criteria:**
- The 4-5 tests written in 6.1 pass
- Pipeline start message posted to Team Chat
- Step progress messages posted for each step
- Completion message posted on success
- Failure message posted with error details on failure

---

### Completion and Failure Handling

#### Task Group 7: Handle Pipeline Completion and Failure States
**Dependencies:** Task Groups 5, 6

- [x] 7.0 Complete completion and failure handling
  - [x] 7.1 Write 4-5 focused tests for completion/failure handling
    - **File:** `frontend/src/__tests__/pipelineCompletionFailure.test.ts`
    - Test on completion: status set to COMPLETED, badge shows green "Completed"
    - Test on failure: status set to FAILED, badge shows red "Failed"
    - Test no automatic retry on failure (user must click Start Implementation again)
    - Test no auto-advance to next increment after completion
    - Test executingStep and executingIncrementId cleared on completion/failure
  - [x] 7.2 Implement handlePipelineCompletion
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Set increment status to COMPLETED
    - Clear executingStep (set to null)
    - Clear executingIncrementId (set to null)
    - Post completion message to chat
    - Store final artifacts
  - [x] 7.3 Implement handlePipelineFailure
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - Set increment status to FAILED
    - Store error in incrementArtifacts
    - Clear executingStep (set to null)
    - Clear executingIncrementId (set to null)
    - Post failure message to chat with error details
  - [x] 7.4 Enable re-execution after failure
    - **File:** `frontend/src/hooks/useIncrementExecution.ts`
    - FAILED status should allow re-execution via Start Implementation button
    - Reset artifacts for increment before re-execution
    - Clear previous error state
  - [x] 7.5 Prevent auto-advance after completion
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Do not automatically select next increment after completion
    - User must manually click on next increment
    - Keep activeIncrementId unchanged after completion
  - [x] 7.6 Ensure completion/failure tests pass
    - Run ONLY the 4-5 tests written in 7.1
    - Verify completion and failure flows work correctly

**Acceptance Criteria:**
- The 4-5 tests written in 7.1 pass
- Completion sets status to COMPLETED with green badge
- Failure sets status to FAILED with red badge and error stored
- No automatic retry - user must manually re-execute
- No auto-advance to next increment
- State properly cleared on completion/failure

---

### Integration Testing

#### Task Group 8: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 3-4 IncrementStatus type tests (Task 1.1)
    - Review the 5-6 IncrementCard badge tests (Task 2.1)
    - Review the 4-5 Start Implementation button tests (Task 3.1)
    - Review the 4-5 execution state tests (Task 4.1)
    - Review the 6-8 executeIncrement pipeline tests (Task 5.1)
    - Review the 4-5 progress message tests (Task 6.1)
    - Review the 4-5 completion/failure tests (Task 7.1)
    - Total existing tests: approximately 30-38 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - **File:** `frontend/src/__tests__/executeIncrementPipeline.integration.test.tsx` (NEW)
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on Execute Increment Pipeline feature
    - Prioritize user interaction flows
  - [x] 8.3 Write up to 10 additional strategic integration tests
    - Test end-to-end: click Start Implementation -> all 4 steps execute -> COMPLETED
    - Test end-to-end: step failure -> pipeline halts -> FAILED status -> error displayed
    - Test execution gating: button disabled when not READY_TO_EXECUTE
    - Test status transitions: READY_TO_EXECUTE -> EXECUTING -> COMPLETED
    - Test status transitions: READY_TO_EXECUTE -> EXECUTING -> FAILED
    - Test badge updates: pulsing blue during execution with step name
    - Test chat messages: all progress messages appear in Team Chat
    - Test re-execution: after FAILED, can click Start Implementation again
    - Test no concurrent execution: cannot start another increment while one is executing
    - Test manual selection: user must manually select next increment after completion
  - [x] 8.4 Run feature-specific tests only
    - Run tests from: `incrementStatus.type.test.ts`
    - Run tests from: `IncrementCard.allStatuses.test.tsx`
    - Run tests from: `StartImplementationButton.test.tsx`
    - Run tests from: `executionState.test.ts`
    - Run tests from: `executeIncrement.test.ts`
    - Run tests from: `pipelineProgressMessages.test.ts`
    - Run tests from: `pipelineCompletionFailure.test.ts`
    - Run tests from: `executeIncrementPipeline.integration.test.tsx`
    - Expected total: approximately 40-48 tests maximum
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 40-48 tests total)
- Critical user workflows for pipeline execution are covered
- No more than 10 additional integration tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Status Type Definition** - Foundation type for entire feature
2. **Task Group 4: Execution State Management** - State needed for pipeline (can run in parallel with 1)
3. **Task Group 2: IncrementCard Badge Updates** - Depends on Task Group 1 (uses IncrementStatus type)
4. **Task Group 3: Start Implementation Button** - Depends on Task Groups 1, 2
5. **Task Group 5: Pipeline Execution Logic** - Depends on Task Groups 1, 4
6. **Task Group 6: Progress Chat Messages** - Depends on Task Group 5
7. **Task Group 7: Completion and Failure Handling** - Depends on Task Groups 5, 6
8. **Task Group 8: Integration Testing** - Final validation of all components

**Parallelization opportunities:**
- Task Groups 1 and 4 can run in parallel (no dependencies between them)
- Task Group 2 waits for Task Group 1
- Task Group 3 waits for Task Groups 1, 2
- Task Group 5 waits for Task Groups 1, 4
- Task Groups 6, 7 wait for Task Group 5
- Task Group 8 waits for all other groups

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/incrementStatus.type.test.ts` | IncrementStatus type tests |
| `frontend/src/__tests__/IncrementCard.allStatuses.test.tsx` | All 6 status badge tests |
| `frontend/src/__tests__/StartImplementationButton.test.tsx` | Start Implementation button tests |
| `frontend/src/__tests__/executionState.test.ts` | Execution state management tests |
| `frontend/src/__tests__/executeIncrement.test.ts` | Pipeline execution tests |
| `frontend/src/__tests__/pipelineProgressMessages.test.ts` | Progress message tests |
| `frontend/src/__tests__/pipelineCompletionFailure.test.ts` | Completion/failure handling tests |
| `frontend/src/__tests__/executeIncrementPipeline.integration.test.tsx` | Integration tests |
| `frontend/src/hooks/useIncrementExecution.ts` | Pipeline execution controller hook |
| `frontend/src/components/ProductView/StartImplementationButton.tsx` | Start Implementation button component |
| `frontend/src/components/ProductView/StartImplementationButton.module.css` | Button styling |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Replace IncrementClarificationStatus with IncrementStatus; add execution state (executingStep, executingIncrementId, incrementArtifacts); integrate useIncrementExecution hook |
| `frontend/src/components/ProductView/IncrementCard.tsx` | Update status prop to IncrementStatus; add executingStep prop; extend getBadgeConfig for 6 statuses |
| `frontend/src/components/ProductView/IncrementCard.module.css` | Add CSS classes for all 6 badge states; add pulsing animation for EXECUTING |
| `frontend/src/components/ProductView/ImplementationPlanSection.tsx` | Add StartImplementationButton below increment list; pass execution state props |

---

## Key Implementation Notes

1. **IncrementStatus replaces IncrementClarificationStatus** - New type has 6 values instead of 2; backwards-compatible for existing 'In Clarification' and 'Ready' logic
2. **Sequential pipeline execution** - Steps must execute one at a time; failure at any step halts entire pipeline
3. **startOrchestration reuse** - Use existing orchestrationApi.startOrchestration() for each pipeline step with different task types
4. **executingStep drives badge text** - During EXECUTING status, badge displays step name (e.g., "Shaping Spec...") instead of generic "Executing"
5. **No automatic progression** - User must manually re-execute after FAILED; user must manually select next increment after COMPLETED
6. **Execution gating** - Button only enabled when implementationMode=true AND status=READY_TO_EXECUTE
7. **Progress messages in Team Chat** - All progress messages posted as system messages to existing Team Chat component
8. **incrementArtifacts persisted in memory** - Artifacts stored in frontend state only (not persisted to backend in v1)
9. **FAILED allows re-execution** - Unlike COMPLETED, FAILED status should allow clicking Start Implementation again

---

## Visual Design Reference

**IncrementCard Status Badge Colors:**
- NOT_STARTED: Gray background (#9E9E9E)
- IN_CLARIFICATION: Amber background (#FFA726)
- READY_TO_EXECUTE: Blue background (#42A5F5)
- EXECUTING: Pulsing blue background (#42A5F5 with animation)
- COMPLETED: Green background (#66BB6A)
- FAILED: Red background (#EF5350)

**Badge Text During Execution:**
- Step 1: "Shaping Spec..."
- Step 2: "Writing Spec..."
- Step 3: "Creating Tasks..."
- Step 4: "Implementing..."

**Start Implementation Button:**
- Default: "Start Implementation" (blue primary button)
- During execution: "Executing..." (disabled, grayed out)
- Disabled tooltip: "Answer all clarifying questions to start implementation"

**Team Chat Progress Messages:**
- Pipeline start: "Starting implementation for [increment title]..."
- Step progress: "Step 1/4: Shaping spec...", "Step 2/4: Writing spec...", etc.
- Completion: "Implementation completed for [increment title]"
- Failure: "Implementation failed at step [step name]: [error message]"

---

## Out of Scope

- Automatic retry on failure - user must manually re-execute
- Auto-advance to next increment after completion - user manually selects
- Parallel execution of multiple increments - one at a time only
- Pause/resume functionality for pipeline execution
- Undo/rollback of completed pipeline steps
- Detailed per-task progress within Implement Tasks step
- Persistent storage of incrementArtifacts to backend
- Real-time streaming of pipeline output to chat
- Cancel button to abort in-progress pipeline
- Pipeline step timeout handling
