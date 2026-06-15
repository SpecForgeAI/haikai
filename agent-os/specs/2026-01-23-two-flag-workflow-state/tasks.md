# Task Breakdown: Two-Flag Workflow State Machine

## Overview

**Spec ID:** 2026-01-23-two-flag-workflow-state
**Total Tasks:** 25
**Estimated Effort:** Medium (Frontend TypeScript/React)

This implementation introduces a two-flag workflow model on the Implement screen with `plannerReadyForSpec` (advisory display) and `implementationMode` (user-controlled phase switch). The flags drive UI behavior and transition warnings without blocking user progress.

---

## Task List

### State Management Layer

#### Task Group 1: Add implementationMode to ImplementChatUiState
**Dependencies:** None

- [x] 1.0 Complete state management updates
  - [x] 1.1 Write 3-4 focused tests for implementationMode state
    - **File:** `frontend/src/__tests__/implementationMode-state.test.ts`
    - Test ImplementChatUiState interface includes `implementationMode: boolean` field
    - Test createEmptyProjectTabState factory includes `implementationMode: false` default
    - Test setImplementChatState equality guard includes implementationMode check
    - Test implementationMode persists correctly via setImplementChatState
  - [x] 1.2 Add implementationMode field to ImplementChatUiState interface
    - **File:** `frontend/src/contexts/ProductUiStateContext.tsx`
    - Add `implementationMode?: boolean` to ImplementChatUiState interface (line 52-71)
    - Follow pattern of existing fields like `hasBootstrapped`, `isExecuting`
    - Optional field for backward compatibility with existing stored state
  - [x] 1.3 Update createEmptyProjectTabState factory
    - **File:** `frontend/src/contexts/ProductUiStateContext.tsx`
    - Add `implementationMode: false` default value in factory function
    - Ensure new chat state initializes with implementationMode = false
  - [x] 1.4 Update setImplementChatState equality guard
    - **File:** `frontend/src/contexts/ProductUiStateContext.tsx`
    - Add `implementationMode` to equality check at lines 371-379
    - Add: `const implementationModeMatches = existingChatState.implementationMode === chatState.implementationMode;`
    - Include in guard condition alongside sessionIdMatches, messagesLengthMatches, inputDraftMatches
  - [x] 1.5 Ensure state management tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- ImplementChatUiState interface includes implementationMode field
- Default value is false for new chat state
- Equality guard prevents unnecessary re-renders when implementationMode unchanged
- TypeScript compilation succeeds

---

### FeatureHeader Badge Layer

#### Task Group 2: Ready for Spec Badge in FeatureHeader
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete FeatureHeader badge implementation
  - [x] 2.1 Write 3-4 focused tests for FeatureHeader badge
    - **File:** `frontend/src/__tests__/FeatureHeader.badge.test.tsx`
    - Test badge not rendered when isReadyForSpec is undefined
    - Test badge not rendered when isReadyForSpec is false
    - Test badge rendered with text "Ready for Spec" when isReadyForSpec is true
    - Test badge has correct styling (green background, white text)
  - [x] 2.2 Add isReadyForSpec prop to FeatureHeader
    - **File:** `frontend/src/components/ProductView/FeatureHeader.tsx`
    - Add optional prop: `isReadyForSpec?: boolean` to FeatureHeaderProps interface
    - Destructure prop in component function signature
  - [x] 2.3 Implement conditional badge rendering
    - **File:** `frontend/src/components/ProductView/FeatureHeader.tsx`
    - Add conditional render after featureTitle span:
      ```tsx
      {isReadyForSpec && (
        <span className={styles.readyBadge} data-testid="ready-for-spec-badge">
          Ready for Spec
        </span>
      )}
      ```
  - [x] 2.4 Add badge styles to FeatureHeader CSS module
    - **File:** `frontend/src/components/ProductView/FeatureHeader.module.css`
    - Add `.readyBadge` class with:
      - `background-color: #4caf50` (green)
      - `color: white`
      - `font-size: 11px`
      - `padding: 2px 8px`
      - `border-radius: 10px`
      - `margin-left: 12px`
      - `font-weight: 500`
  - [x] 2.5 Ensure FeatureHeader badge tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify badge renders correctly in all states

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- Badge only appears when isReadyForSpec is true
- Badge styling matches spec (green #4caf50, white text, 11px, rounded)
- Badge is visually subtle but noticeable next to feature title

---

### ImplementConfirmationModal Component Layer

#### Task Group 3: Create ImplementConfirmationModal Component
**Dependencies:** None (can run in parallel with Task Groups 1 and 2)

- [x] 3.0 Complete ImplementConfirmationModal component
  - [x] 3.1 Write 4-5 focused tests for ImplementConfirmationModal
    - **File:** `frontend/src/__tests__/ImplementConfirmationModal.test.tsx`
    - Test modal not rendered when isOpen is false
    - Test modal displays correct count message (e.g., "You have 3 unanswered questions...")
    - Test Cancel button calls onClose callback
    - Test Continue button calls onConfirm callback and then onClose
    - Test modal has warning styling (amber header background)
  - [x] 3.2 Create ImplementConfirmationModal component
    - **File:** `frontend/src/components/ProductView/ImplementConfirmationModal.tsx` (NEW)
    - Props interface:
      - `isOpen: boolean`
      - `onClose: () => void`
      - `onConfirm: () => void`
      - `openQuestionCount: number`
    - Follow modal structure pattern from WorkItemDeleteConfirmModal:
      - Overlay with handleOverlayClick
      - Modal container with header, content, footer
      - handleKeyDown for Escape key
    - Return null when isOpen is false
  - [x] 3.3 Implement modal header with warning style
    - **File:** `frontend/src/components/ProductView/ImplementConfirmationModal.tsx`
    - Header title: "Proceed to Implementation?"
    - Warning icon in header (exclamation mark)
    - Close button (X) in header corner
  - [x] 3.4 Implement modal content
    - **File:** `frontend/src/components/ProductView/ImplementConfirmationModal.tsx`
    - Warning message: `You have ${openQuestionCount} unanswered question${openQuestionCount !== 1 ? 's' : ''} from the Product Owner. Are you sure you want to proceed?`
    - Render count dynamically from openQuestionCount prop
  - [x] 3.5 Implement modal footer with buttons
    - **File:** `frontend/src/components/ProductView/ImplementConfirmationModal.tsx`
    - Cancel button: secondary style (neutral), calls onClose
    - Continue button: primary style (neutral, not danger), calls onConfirm then onClose
    - Button labels: "Cancel" and "Continue"
  - [x] 3.6 Create ImplementConfirmationModal styles
    - **File:** `frontend/src/components/ProductView/ImplementConfirmationModal.module.css` (NEW)
    - Adapt from WorkItemDeleteConfirmModal.module.css
    - Change header background from `#fff3e0` (orange) to amber/yellow warning: `#fff8e1`
    - Change title color to `#f57f17` (amber)
    - Warning box: amber background `#fff8e1`, border `#ffe082`
    - Warning text color: `#e65100`
    - Primary button: blue (`#1976d2`) not red, for "Continue"
    - Secondary button: neutral gray for "Cancel"
  - [x] 3.7 Ensure ImplementConfirmationModal tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify modal renders and functions correctly

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Modal displays warning message with correct question count
- Cancel closes modal without action
- Continue triggers onConfirm and closes modal
- Styling uses amber/warning colors, not danger/red

---

### Implement Button Logic Layer

#### Task Group 4: Implement Button State and handleImplementClick Flow
**Dependencies:** Task Groups 1, 3

- [x] 4.0 Complete Implement button logic updates
  - [x] 4.1 Write 5-6 focused tests for Implement button behavior
    - **File:** `frontend/src/__tests__/ImplementButton.workflow.test.tsx`
    - Test button shows "Implement" text when implementationMode is false
    - Test button shows "In Implementation" text when implementationMode is true
    - Test button enabled when implementationMode is false and canImplement conditions met
    - Test button always disabled when implementationMode is true
    - Test clicking Implement shows modal when open questions > 0
    - Test clicking Implement proceeds directly when open questions === 0
  - [x] 4.2 Add implementationMode state to ImplementationAssistantPanel
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [implementationMode, setImplementationMode] = useState(false)`
    - Hydrate from context state: check storedState.implementationMode on mount
    - Include in persistChatState useEffect dependencies
  - [x] 4.3 Add modal state for ImplementConfirmationModal
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)`
    - Import ImplementConfirmationModal component
  - [x] 4.4 Implement deriveOpenQuestionsCount helper
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Use existing deriveQuestions function pattern from FeatureDefinitionPanel
    - Filter questions where `status === 'Open'`
    - Return count: `questions.filter(q => q.status === 'Open').length`
    - Compute from latestPlannerResponse.openQuestions and answers state
  - [x] 4.5 Update handleImplementClick flow
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Rename or wrap existing handleImplement as proceedWithImplementation
    - New handleImplementClick logic:
      1. Guard: if implementationMode is true, return early
      2. Count open questions using deriveOpenQuestionsCount
      3. If count > 0: `setIsConfirmModalOpen(true)`
      4. If count === 0: `setImplementationMode(true)` then call proceedWithImplementation
  - [x] 4.6 Implement modal callbacks
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - handleModalCancel: `setIsConfirmModalOpen(false)`
    - handleModalConfirm: `setImplementationMode(true)`, `setIsConfirmModalOpen(false)`, call proceedWithImplementation
  - [x] 4.7 Update Implement button rendering
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Button text: `implementationMode ? 'In Implementation' : 'Implement'`
    - Button disabled: `implementationMode || !canImplement`
    - Add muted styling class when implementationMode is true
    - Wire onClick to handleImplementClick (not handleImplement directly)
  - [x] 4.8 Add ImplementConfirmationModal to render
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Render modal at bottom of component (before closing div):
      ```tsx
      <ImplementConfirmationModal
        isOpen={isConfirmModalOpen}
        onClose={handleModalCancel}
        onConfirm={handleModalConfirm}
        openQuestionCount={openQuestionCount}
      />
      ```
  - [x] 4.9 Ensure Implement button tests pass
    - Run ONLY the 5-6 tests written in 4.1
    - Verify button state and flow work correctly

**Acceptance Criteria:**
- The 5-6 tests written in 4.1 pass
- Button shows "Implement" when implementationMode is false
- Button shows "In Implementation" and is disabled when implementationMode is true
- Modal appears when clicking Implement with open questions > 0
- Direct transition to implementation when open questions === 0
- Modal Continue sets implementationMode true and proceeds

---

### FeatureHeader Integration Layer

#### Task Group 5: Wire plannerReadyForSpec to FeatureHeader
**Dependencies:** Task Groups 2, 4

- [x] 5.0 Complete FeatureHeader integration
  - [x] 5.1 Write 2-3 focused tests for plannerReadyForSpec display
    - **File:** `frontend/src/__tests__/FeatureHeader.integration.test.tsx`
    - Test FeatureHeader receives isReadyForSpec from latestPlannerResponse.plannerReadyForSpec
    - Test badge appears when plannerReadyForSpec is true
    - Test badge hidden when plannerReadyForSpec is false or undefined
  - [x] 5.2 Pass isReadyForSpec to FeatureDefinitionPanel
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Extract: `const isReadyForSpec = latestPlannerResponse?.plannerReadyForSpec ?? false`
    - Pass to FeatureDefinitionPanel: `isReadyForSpec={isReadyForSpec}`
  - [x] 5.3 Update FeatureDefinitionPanel props and pass to FeatureHeader
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add `isReadyForSpec?: boolean` to FeatureDefinitionPanelProps
    - Pass to FeatureHeader: `<FeatureHeader title={featureTitle} isReadyForSpec={isReadyForSpec} />`
  - [x] 5.4 Ensure FeatureHeader integration tests pass
    - Run ONLY the 2-3 tests written in 5.1
    - Verify badge displays based on plannerReadyForSpec value

**Acceptance Criteria:**
- The 2-3 tests written in 5.1 pass
- Badge displays when plannerReadyForSpec is true
- Badge hidden when plannerReadyForSpec is false or undefined
- No blocking of user actions based on plannerReadyForSpec

---

### Integration Testing

#### Task Group 6: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-4 state management tests (Task 1.1)
    - Review the 3-4 FeatureHeader badge tests (Task 2.1)
    - Review the 4-5 ImplementConfirmationModal tests (Task 3.1)
    - Review the 5-6 Implement button tests (Task 4.1)
    - Review the 2-3 FeatureHeader integration tests (Task 5.1)
    - Total existing tests: approximately 17-22 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - **File:** `frontend/src/__tests__/two-flag-workflow-integration.test.tsx` (NEW)
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on Two-Flag Workflow feature
    - Prioritize user interaction flows
  - [x] 6.3 Write up to 8 additional strategic integration tests
    - Test end-to-end: open questions present -> click Implement -> modal -> Continue -> implementationMode true
    - Test end-to-end: no open questions -> click Implement -> implementationMode true immediately
    - Test implementationMode persists across tab switches (context state)
    - Test QuestionsTable remains functional when implementationMode is true
    - Test plannerReadyForSpec badge updates when new plannerResponse received
    - Test plannerReadyForSpec does NOT affect canImplement logic
    - Test button styling changes when implementationMode true (muted/inactive)
    - Test modal displays correct count when multiple questions open
  - [x] 6.4 Run feature-specific tests only
    - Run tests from: `implementationMode-state.test.ts`
    - Run tests from: `FeatureHeader.badge.test.tsx`
    - Run tests from: `ImplementConfirmationModal.test.tsx`
    - Run tests from: `ImplementButton.workflow.test.tsx`
    - Run tests from: `FeatureHeader.integration.test.tsx`
    - Run tests from: `two-flag-workflow-integration.test.tsx`
    - Expected total: approximately 25-30 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25-30 tests total)
- End-to-end user workflows validated
- State persistence across tab switches verified
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: State Management** - Foundation state field required by button logic
2. **Task Group 2: FeatureHeader Badge** - Can run in parallel with Task Group 1 (independent)
3. **Task Group 3: ImplementConfirmationModal** - Can run in parallel with Task Groups 1-2 (independent component)
4. **Task Group 4: Implement Button Logic** - Depends on Task Groups 1, 3 (uses state and modal)
5. **Task Group 5: FeatureHeader Integration** - Depends on Task Groups 2, 4 (wiring badge to panel)
6. **Task Group 6: Integration Testing** - Final validation of all components

**Parallelization opportunities:**
- Task Groups 1, 2, and 3 can all run in parallel (no dependencies between them)
- Task Group 4 waits for Task Groups 1 and 3
- Task Group 5 waits for Task Groups 2 and 4

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/implementationMode-state.test.ts` | State management tests |
| `frontend/src/__tests__/FeatureHeader.badge.test.tsx` | FeatureHeader badge tests |
| `frontend/src/__tests__/ImplementConfirmationModal.test.tsx` | Modal component tests |
| `frontend/src/__tests__/ImplementButton.workflow.test.tsx` | Button workflow tests |
| `frontend/src/__tests__/FeatureHeader.integration.test.tsx` | Badge integration tests |
| `frontend/src/__tests__/two-flag-workflow.integration.test.tsx` | End-to-end integration tests |
| `frontend/src/components/ProductView/ImplementConfirmationModal.tsx` | Warning modal component |
| `frontend/src/components/ProductView/ImplementConfirmationModal.module.css` | Modal styles |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/contexts/ProductUiStateContext.tsx` | Add implementationMode to ImplementChatUiState, update factory, update equality guard |
| `frontend/src/components/ProductView/FeatureHeader.tsx` | Add isReadyForSpec prop, render badge conditionally |
| `frontend/src/components/ProductView/FeatureHeader.module.css` | Add .readyBadge styles |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Add isReadyForSpec prop, pass to FeatureHeader |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add implementationMode state, modal state, handleImplementClick flow, button rendering updates |

---

## Key Implementation Notes

1. **implementationMode Persistence** - Stored in ProductUiStateContext alongside other chat state, persisted across tab switches but NOT to backend/database
2. **plannerReadyForSpec is Advisory Only** - Display via badge, does NOT block Implement button or affect canImplement logic
3. **Modal Styling** - Use amber/warning colors (#fff8e1, #f57f17), NOT red/danger colors; Continue button is primary (blue) not danger
4. **Questions Count Derivation** - Reuse deriveQuestions pattern from FeatureDefinitionPanel, filter for `status === 'Open'`
5. **Button State Coupling** - implementationMode true always disables button and changes text, regardless of other conditions
6. **QuestionsTable Unchanged** - Table remains visible and functional in both modes; no UI changes based on implementationMode
7. **No Auto-Transition** - implementationMode is user-controlled only, never auto-set based on conditions

---

## Risk Mitigation

1. **Backward Compatibility** - implementationMode field is optional (`?`) to handle existing stored state without the field
2. **State Hydration Order** - Hydrate implementationMode from context on mount, default to false if undefined
3. **Modal Focus Management** - Ensure modal traps focus and handles Escape key correctly
4. **Button Click Guard** - handleImplementClick guards against clicks when implementationMode is already true
5. **Test Isolation** - All tests focus on this feature only, no full test suite runs during development

---

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
