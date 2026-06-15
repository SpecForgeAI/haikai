# Specification: Two-Flag Workflow State Machine

## Goal

Introduce a two-flag workflow model on the Implement screen with `plannerReadyForSpec` (advisory signal from Planner LLM) and `implementationMode` (user-controlled phase switch), using these flags to drive UI behavior and transition warnings without blocking user progress.

## User Stories

- As a user, I want to see when the Planner considers the feature ready for implementation so I can make an informed decision about when to proceed
- As a user, I want to be warned about unanswered Product Owner questions before entering implementation mode so I can address them first or consciously proceed anyway

## Specific Requirements

**Add implementationMode to ImplementChatUiState**
- Add `implementationMode: boolean` field to the `ImplementChatUiState` interface in ProductUiStateContext.tsx
- Default value is `false` when creating new chat state
- Persisted via existing `setImplementChatState` mechanism alongside other chat state fields
- Update `createEmptyProjectTabState` factory to include the new field
- Update equality guard in `setImplementChatState` to include `implementationMode` check

**Ready Indicator Badge in FeatureHeader**
- Add optional `isReadyForSpec` prop to FeatureHeader component
- When `isReadyForSpec` is true, render a small green badge/chip next to the feature title
- Badge text: "Ready for Spec"
- Badge styling: green background (#4caf50), white text, small font (11px), rounded corners
- Badge should be visually subtle but noticeable

**ImplementConfirmationModal Component**
- Create new modal component at `frontend/src/components/ProductView/ImplementConfirmationModal.tsx`
- Warning style: amber/yellow header background (#fff3e0), warning icon
- Display message: "You have X unanswered questions from the Product Owner. Are you sure you want to proceed?"
- Count derived by filtering questions where `status === 'Open'`
- Two buttons: "Cancel" (secondary, neutral) and "Continue" (primary, neutral - not danger)
- Modal props: `isOpen`, `onClose`, `onConfirm`, `openQuestionCount`

**Implement Button State Changes**
- When `implementationMode` is false: Show "Implement" button, enabled based on existing `canImplement` logic
- When `implementationMode` is true: Show "In Implementation" button, always disabled, styled as muted/inactive
- Button text change reflects current state clearly

**handleImplementClick Flow**
- When user clicks Implement button and `implementationMode` is false:
  1. Count open PO questions (filter `questions.filter(q => q.status === 'Open').length`)
  2. If count > 0: Show ImplementConfirmationModal
  3. If count === 0: Set `implementationMode = true` immediately, proceed with existing handleImplement logic
- On modal "Continue": Set `implementationMode = true`, close modal, proceed with existing handleImplement logic
- On modal "Cancel": Close modal, no state change

**Derive Open Questions Count**
- Use the existing `deriveQuestions` function in FeatureDefinitionPanel to compute Question[] from openQuestions and answers
- Filter for `status === 'Open'` (questions without answers)
- Pass count to modal when opening

**plannerReadyForSpec Display Only**
- The `plannerReadyForSpec` boolean from PlannerResponse is advisory only
- Display via badge in FeatureHeader when true
- Does NOT block user from clicking Implement
- Does NOT affect canImplement logic

**Questions Table Visibility**
- QuestionsTable remains visible and functional in both modes (implementationMode true or false)
- Users can continue answering questions even after entering implementation mode
- No UI changes to questions table based on implementationMode

## Existing Code to Leverage

**ImplementChatUiState in ProductUiStateContext.tsx**
- Existing interface at line 52-71 stores per-work-item chat state
- Add implementationMode field following same pattern as hasBootstrapped, isExecuting
- setImplementChatState equality guard at line 371-379 should include implementationMode

**WorkItemDeleteConfirmModal.tsx**
- Modal structure pattern: overlay, modal container, header, content, footer with buttons
- CSS module pattern with warning, secondaryButton, dangerButton classes
- handleOverlayClick, handleKeyDown, handleCancel patterns to replicate
- Adapt warning styling from red/danger to amber/warning colors for new modal

**FeatureHeader.tsx**
- Simple component at 32-39 lines with title prop
- Add optional isReadyForSpec prop and conditional badge rendering
- Existing CSS module can be extended with badge styles

**PlannerResponse.plannerReadyForSpec**
- Already exists in chatApi.ts at line 355: `plannerReadyForSpec: boolean`
- Already stored in latestPlannerResponse state in ImplementationAssistantPanel
- Access via `latestPlannerResponse?.plannerReadyForSpec`

**deriveQuestions in FeatureDefinitionPanel.tsx**
- Function at lines 70-85 derives Question[] from OpenQuestion[] and answers map
- Computes status based on answer presence
- Reuse this logic or import to count open questions

## Out of Scope

- Backend changes to plannerReadyForSpec logic or timing
- Persisting implementationMode to backend/database
- Blocking Implement button based on plannerReadyForSpec value
- Auto-transitioning to implementation mode based on any conditions
- Changes to the actual orchestration/implementation execution logic
- Hiding or disabling QuestionsTable in implementation mode
- Role selection changes based on implementationMode
- Mobile-specific modal styling beyond basic responsive behavior
- Undo/revert functionality for implementationMode
- Animation or transition effects for mode changes
