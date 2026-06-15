# Specification: Execute Increment Pipeline

## Goal

Enable users to execute an implementation pipeline for increments, progressing through Shape Spec, Write Spec, Create Tasks, and Implement Tasks steps, with status tracking, progress indicators, and manual control over execution flow.

## User Stories

- As a developer, I want to start implementation for a ready increment so that the system generates specs and tasks automatically.
- As a developer, I want to see the current execution step in the UI so that I know what the system is doing.

## Specific Requirements

**Extended Increment Status Model**
- Replace existing `IncrementClarificationStatus` type with new `IncrementStatus` type
- Status values: `NOT_STARTED`, `IN_CLARIFICATION`, `READY_TO_EXECUTE`, `EXECUTING`, `COMPLETED`, `FAILED`
- `NOT_STARTED`: Default initial state, no SA handoff initiated
- `IN_CLARIFICATION`: SA is actively asking/awaiting clarification questions
- `READY_TO_EXECUTE`: All SA questions answered, increment can be executed
- `EXECUTING`: Pipeline is currently running for this increment
- `COMPLETED`: Pipeline finished successfully
- `FAILED`: Pipeline encountered an error

**Status Derivation Rules**
- `NOT_STARTED`: No SA questions exist for this incrementId
- `IN_CLARIFICATION`: SA questions exist with status='Open' for this incrementId
- `READY_TO_EXECUTE`: SA questions exist, all are status='Answered' for this incrementId
- `EXECUTING`: Set when pipeline starts, cleared on completion/failure
- `COMPLETED`: Set when pipeline finishes successfully
- `FAILED`: Set when pipeline encounters an error

**Execution Gating Conditions**
- implementationMode must be true (user has clicked Implement and confirmed)
- An implementationPlan must exist in latestPlannerResponse
- The selected increment must have status READY_TO_EXECUTE
- The increment must not already be EXECUTING, COMPLETED, or FAILED
- Display disabled button tooltip: "Answer all clarifying questions to start implementation"

**Pipeline Step Sequence**
- Step 1: Shape Spec - refines the proposedFinalSubFeatureDefinition
- Step 2: Write Spec - generates the spec.md document
- Step 3: Create Tasks - breaks spec into implementation tasks
- Step 4: Implement Tasks - executes each task via orchestration
- Each step receives: workItemId, incrementId, proposedFinalSubFeatureDefinition, architecture context
- Steps execute sequentially; failure at any step halts the pipeline

**Pipeline Execution Controller**
- Create new `IncrementExecutionController` object/hook to manage execution state
- Tracks executingIncrementId and currentExecutingStep
- Calls orchestration API (startOrchestration) for each pipeline step
- Captures step outputs: shapeSpecArtifact, writeSpecArtifact, tasksSummary, implementationResult
- On step failure: stores error in incrementArtifacts, sets status to FAILED, halts pipeline
- On pipeline completion: sets status to COMPLETED

**Start Implementation Button**
- Position: Below the Implementation Plan section in FeatureDefinitionPanel
- Enabled only when: implementationMode=true AND activeIncrement.status=READY_TO_EXECUTE
- Button text: "Start Implementation" (default), "Executing..." (during execution)
- On click: calls controller.startPipeline(incrementId) and sets status to EXECUTING

**Progress Display in IncrementCard**
- Badge shows all 6 status values with distinct colors: gray (NOT_STARTED), amber (IN_CLARIFICATION), blue (READY_TO_EXECUTE), pulsing blue (EXECUTING), green (COMPLETED), red (FAILED)
- During EXECUTING: badge shows current step name (e.g., "Shaping Spec...", "Writing Spec...")
- Step indicator text replaces status text in badge during execution

**Progress Messages in Team Chat**
- Post a message when pipeline starts: "Starting implementation for [increment title]..."
- Post a message for each step start: "Step 1/4: Shaping spec..."
- Post a message on completion: "Implementation completed for [increment title]"
- Post a message on failure: "Implementation failed at step [step name]: [error message]"

**Completion and Failure Handling**
- On completion: Post success message, set status to COMPLETED, badge shows green "Completed"
- On failure: Post error message with step name and error details, set status to FAILED, badge shows red "Failed"
- No automatic retry - user must manually re-execute by clicking Start Implementation again
- User manually selects next increment after completion (no auto-advance to next increment)

**State Management Updates**
- Extend incrementStatuses Map to use IncrementStatus instead of IncrementClarificationStatus
- Add executingStep state: string | null to track current pipeline step
- Add incrementArtifacts state: Map<string, IncrementArtifacts> for captured outputs
- IncrementArtifacts type includes: shapeSpecArtifact, writeSpecArtifact, tasksSummary, implementationResult, error

## Existing Code to Leverage

**IncrementCard Component (`frontend/src/components/ProductView/IncrementCard.tsx`)**
- Already has clarificationStatus prop with badge rendering logic
- Extend getBadgeConfig() to handle all 6 status values with appropriate colors
- Add executingStep prop for showing step name during EXECUTING state

**orchestrationApi (`frontend/src/api/orchestrationApi.ts`)**
- startOrchestration() function already implements Orchestrations API calls
- Use same pattern for pipeline step execution
- StartOrchestrationRequest/Response types can be extended for step-specific payloads

**ProductUiStateContext (`frontend/src/contexts/ProductUiStateContext.tsx`)**
- ImplementChatUiState already has implementationMode field
- Add incrementStatuses, executingStep, incrementArtifacts to persisted state
- ExecutionResult type can be reused for step results

**ImplementationAssistantPanel (`frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`)**
- incrementStatuses Map already tracks per-increment status
- saQuestions state and incrementId linking already implemented
- Add IncrementExecutionController logic as custom hook or inline

**ImplementationPlanSection (`frontend/src/components/ProductView/ImplementationPlanSection.tsx`)**
- Renders IncrementCard list with activeIncrementId tracking
- Add clarificationStatus or status prop passthrough to IncrementCard
- Add Start Implementation button below increment list

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
