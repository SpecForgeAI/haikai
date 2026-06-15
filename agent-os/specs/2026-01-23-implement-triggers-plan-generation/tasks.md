# Task Breakdown: Implement Triggers Plan Generation

## Overview

**Spec ID:** 2026-01-23-implement-triggers-plan-generation
**Total Tasks:** 32
**Estimated Effort:** Medium (Frontend TypeScript/React)

This implementation adds implementation plan generation when the user clicks "Implement". The flow sends `phase: 'implementation_planning'` to the gateway, displays the resulting plan with increments in the Feature Definition panel, and shows a summary message in Team Chat.

---

## Task List

### Frontend Type Updates

#### Task Group 1: Extend ImplementChatPhase Type
**Dependencies:** None

- [x] 1.0 Complete ImplementChatPhase type extension
  - [x] 1.1 Write 2-3 focused tests for ImplementChatPhase type
    - **File:** `frontend/src/__tests__/implementChatPhase-type.test.ts`
    - Test ImplementChatPhase includes 'implementation_planning' as valid value
    - Test buildContext can construct context with phase: 'implementation_planning'
    - Test TypeScript compilation succeeds with new phase value
  - [x] 1.2 Add 'implementation_planning' to ImplementChatPhase type
    - **File:** `frontend/src/api/chatApi.ts`
    - Update line 135: `export type ImplementChatPhase = 'bootstrap' | 'refine' | 'handoff';`
    - Change to: `export type ImplementChatPhase = 'bootstrap' | 'refine' | 'handoff' | 'implementation_planning';`
    - This aligns frontend type with gateway ImplementChatPhase (already has 'implementation_planning')
  - [x] 1.3 Ensure type tests pass
    - Run ONLY the 2-3 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 2-3 tests written in 1.1 pass
- ImplementChatPhase type includes 'implementation_planning'
- buildContext can create context with phase: 'implementation_planning'
- TypeScript compilation succeeds

---

### IncrementCard Component

#### Task Group 2: Create IncrementCard Component
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete IncrementCard component
  - [x] 2.1 Write 4-5 focused tests for IncrementCard component
    - **File:** `frontend/src/__tests__/IncrementCard.test.tsx`
    - Test IncrementCard renders increment id, title, shortDescription
    - Test IncrementCard renders "Not Started" status badge
    - Test active state shows blue left border (#2196F3) and light blue background (#E3F2FD)
    - Test non-active state shows standard styling
    - Test onClick callback fires when card is clicked
  - [x] 2.2 Create IncrementCard component file
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx` (NEW)
    - Props interface:
      - `increment: Increment` (from chatApi.ts)
      - `isActive: boolean`
      - `onClick: () => void`
    - Import Increment type from `../../api/chatApi`
  - [x] 2.3 Implement IncrementCard rendering
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Display increment.id (e.g., "INC-1")
    - Display increment.title
    - Display increment.shortDescription
    - Display status badge with text "Not Started"
  - [x] 2.4 Implement active/inactive styling
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Active: `borderLeft: '4px solid #2196F3'`, `backgroundColor: '#E3F2FD'`
    - Non-active: subtle border (e.g., `1px solid #e0e0e0`), white background
    - Add hover state with subtle shadow elevation for non-active cards
  - [x] 2.5 Create IncrementCard styles
    - **File:** `frontend/src/components/ProductView/IncrementCard.module.css` (NEW)
    - `.card` - base card styling with padding, margin, border-radius
    - `.cardActive` - active state with blue border and background
    - `.cardId` - small text for increment ID
    - `.cardTitle` - bold text for title
    - `.cardDescription` - normal text for shortDescription
    - `.statusBadge` - gray pill with "Not Started" text
  - [x] 2.6 Ensure IncrementCard tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify component renders correctly in all states

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- IncrementCard displays id, title, shortDescription, status badge
- Active state shows blue left border (4px #2196F3) and light blue background (#E3F2FD)
- Non-active state has standard styling with hover elevation
- onClick fires when card is clicked

---

### ImplementationPlanSection Component

#### Task Group 3: Create ImplementationPlanSection Component
**Dependencies:** Task Group 2

- [x] 3.0 Complete ImplementationPlanSection component
  - [x] 3.1 Write 4-5 focused tests for ImplementationPlanSection component
    - **File:** `frontend/src/__tests__/ImplementationPlanSection.test.tsx`
    - Test component returns null when implementationPlan is null
    - Test component renders plan title from implementationPlan.planTitle
    - Test component renders IncrementCard for each increment
    - Test correct increment receives isActive=true based on activeIncrementId
    - Test onIncrementSelect callback fires when IncrementCard is clicked
  - [x] 3.2 Create ImplementationPlanSection component file
    - **File:** `frontend/src/components/ProductView/ImplementationPlanSection.tsx` (NEW)
    - Props interface:
      - `implementationPlan: ImplementationPlan | null`
      - `activeIncrementId: string | null`
      - `onIncrementSelect: (incrementId: string) => void`
    - Import ImplementationPlan from `../../api/chatApi`
    - Import IncrementCard from `./IncrementCard`
  - [x] 3.3 Implement conditional rendering
    - **File:** `frontend/src/components/ProductView/ImplementationPlanSection.tsx`
    - Return null when implementationPlan is null
    - This handles visibility - component hidden when no plan exists
  - [x] 3.4 Implement section layout
    - **File:** `frontend/src/components/ProductView/ImplementationPlanSection.tsx`
    - Section title: "Implementation Plan"
    - Plan title as subtitle (implementationPlan.planTitle)
    - List of IncrementCard components for each increment
    - Pass isActive={increment.id === activeIncrementId} to each card
    - Pass onClick handler that calls onIncrementSelect(increment.id)
  - [x] 3.5 Create ImplementationPlanSection styles
    - **File:** `frontend/src/components/ProductView/ImplementationPlanSection.module.css` (NEW)
    - `.section` - container with vertical spacing matching FeatureSectionCard
    - `.sectionTitle` - "Implementation Plan" heading
    - `.planTitle` - subtitle with plan title
    - `.incrementList` - flex container for increment cards with gap
  - [x] 3.6 Ensure ImplementationPlanSection tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify component renders correctly in all states

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Component returns null when implementationPlan is null
- Section title "Implementation Plan" and plan title render
- IncrementCard renders for each increment
- Correct increment shows active styling based on activeIncrementId
- onIncrementSelect callback fires with correct increment ID

---

### Plan Generation Logic

#### Task Group 4: Add generateImplementationPlan Function and State
**Dependencies:** Task Group 1

- [x] 4.0 Complete plan generation logic
  - [x] 4.1 Write 5-6 focused tests for generateImplementationPlan function
    - **File:** `frontend/src/__tests__/generateImplementationPlan.test.tsx`
    - Test generateImplementationPlan calls postChatMessage with phase: 'implementation_planning'
    - Test button text changes to "Generating Plan..." when isImplementing is true
    - Test successful response stores implementationPlan in latestPlannerResponse
    - Test successful response auto-selects first increment (activeIncrementId = plan.increments[0].id)
    - Test failed response displays non-blocking error message in chat
    - Test error message format: "Failed to generate implementation plan: [error details]"
  - [x] 4.2 Add activeIncrementId state to ImplementationAssistantPanel
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [activeIncrementId, setActiveIncrementId] = useState<string | null>(null)`
    - Add to state hydration useEffect (line ~366)
    - Add to state reset logic (line ~377)
  - [x] 4.3 Replace proceedWithImplementation with generateImplementationPlan
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Rename existing proceedWithImplementation function to generateImplementationPlan
    - Or create new generateImplementationPlan async function
    - Remove or comment out the old orchestration API call logic
  - [x] 4.4 Implement generateImplementationPlan function body
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Set isImplementing to true at start
    - Build context with: `buildContext('normal_chat', 'implementation_planning')`
    - Call postChatMessage with empty message and context
    - On success: update latestPlannerResponse with response.plannerResponse
    - On success: set activeIncrementId to first increment ID (plan.increments[0].id)
    - On failure: append error message to chat (non-blocking)
    - Set isImplementing to false in finally block
  - [x] 4.5 Update button text logic
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Update implementButtonText (around line 1012):
      - When isImplementing: "Generating Plan..."
      - When implementationMode: "In Implementation"
      - Default: "Implement"
  - [x] 4.6 Update handleImplementClick to call generateImplementationPlan
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - In handleImplementClick (line ~890), replace proceedWithImplementation call with generateImplementationPlan
    - In handleModalConfirm (line ~919), replace proceedWithImplementation call with generateImplementationPlan
  - [x] 4.7 Ensure plan generation tests pass
    - Run ONLY the 5-6 tests written in 4.1
    - Verify function calls API with correct phase
    - Verify state updates correctly

**Acceptance Criteria:**
- The 5-6 tests written in 4.1 pass
- generateImplementationPlan sends phase: 'implementation_planning' to gateway
- Button text shows "Generating Plan..." during API call
- On success: latestPlannerResponse updated with plan
- On success: activeIncrementId set to first increment ID
- On failure: error message displayed in chat (non-blocking)

---

### FeatureDefinitionPanel Integration

#### Task Group 5: Update FeatureDefinitionPanel to Include Plan Section
**Dependencies:** Task Groups 3, 4

- [x] 5.0 Complete FeatureDefinitionPanel integration
  - [x] 5.1 Write 3-4 focused tests for FeatureDefinitionPanel plan integration
    - **File:** `frontend/src/__tests__/FeatureDefinitionPanel.plan.test.tsx`
    - Test ImplementationPlanSection not rendered when plannerResponse.implementationPlan is null
    - Test ImplementationPlanSection rendered when plannerResponse.implementationPlan exists
    - Test ImplementationPlanSection receives correct props (plan, activeIncrementId, callback)
    - Test ImplementationPlanSection appears after Assumptions section
  - [x] 5.2 Add plan-related props to FeatureDefinitionPanelProps
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add `activeIncrementId?: string | null` prop
    - Add `onIncrementSelect?: (incrementId: string) => void` prop
    - Both optional for backward compatibility
  - [x] 5.3 Import and render ImplementationPlanSection
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add import: `import { ImplementationPlanSection } from './ImplementationPlanSection';`
    - Add after Assumptions section (after line 204):
      ```tsx
      <ImplementationPlanSection
        implementationPlan={plannerResponse?.implementationPlan ?? null}
        activeIncrementId={activeIncrementId ?? null}
        onIncrementSelect={onIncrementSelect ?? (() => {})}
      />
      ```
  - [x] 5.4 Update ImplementationAssistantPanel to pass new props
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Pass activeIncrementId to FeatureDefinitionPanel
    - Create handleIncrementSelect callback: `(id: string) => setActiveIncrementId(id)`
    - Pass onIncrementSelect={handleIncrementSelect} to FeatureDefinitionPanel
  - [x] 5.5 Ensure FeatureDefinitionPanel plan tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify plan section renders in correct position

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- ImplementationPlanSection hidden when implementationPlan is null
- ImplementationPlanSection renders when implementationPlan exists
- Section appears after Assumptions in the Feature Definition panel
- Clicking increment updates activeIncrementId

---

### Chat Message Integration

#### Task Group 6: Add Plan Summary Message to Team Chat
**Dependencies:** Task Group 4

- [x] 6.0 Complete chat message integration
  - [x] 6.1 Write 3-4 focused tests for plan summary message
    - **File:** `frontend/src/__tests__/chatMessagePlanSummary.test.tsx`
    - Test successful plan generation appends summary message to chat
    - Test message format: "Implementation plan generated with N increment(s): [list of titles]"
    - Test message has role: 'assistant' for chat bubble display
    - Test message appears after plan generation success
  - [x] 6.2 Implement plan summary message in generateImplementationPlan
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - After successful plan generation and state update:
    - Extract increment titles from plan
    - Build message: `Implementation plan generated with ${plan.increments.length} increment(s): ${titles.join(', ')}`
    - Create ChatMessage with role: 'assistant'
    - Append to messages state
  - [x] 6.3 Ensure message appears after state updates
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Order of operations in success handler:
      1. setLatestPlannerResponse(response.plannerResponse)
      2. setActiveIncrementId(plan.increments[0].id)
      3. Append summary message to messages
    - This ensures UI consistency
  - [x] 6.4 Ensure chat message tests pass
    - Run ONLY the 3-4 tests written in 6.1
    - Verify message format and timing

**Acceptance Criteria:**
- The 3-4 tests written in 6.1 pass
- Summary message appended to chat on successful plan generation
- Message format: "Implementation plan generated with N increment(s): [list of titles]"
- Message displays in chat bubble format (role: 'assistant')

---

### Integration Testing

#### Task Group 7: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 2-3 ImplementChatPhase tests (Task 1.1)
    - Review the 4-5 IncrementCard tests (Task 2.1)
    - Review the 4-5 ImplementationPlanSection tests (Task 3.1)
    - Review the 5-6 generateImplementationPlan tests (Task 4.1)
    - Review the 3-4 FeatureDefinitionPanel plan tests (Task 5.1)
    - Review the 3-4 plan summary message tests (Task 6.1)
    - Total existing tests: approximately 21-27 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - **File:** `frontend/src/__tests__/planGenerationIntegration.test.tsx` (NEW)
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on Implement Triggers Plan Generation feature
    - Prioritize user interaction flows
  - [x] 7.3 Write up to 8 additional strategic integration tests
    - Test end-to-end: click Implement -> generateImplementationPlan -> plan displayed -> first increment active
    - Test end-to-end: click Implement with open questions -> modal -> confirm -> plan generation
    - Test clicking different IncrementCard updates activeIncrementId
    - Test plan replaces previous plan if Implement clicked again
    - Test error handling: API failure shows error in chat, UI not blocked
    - Test user can retry after error by clicking Implement again
    - Test plan summary message appears in Team Chat
    - Test button text transitions: "Implement" -> "Generating Plan..." -> "In Implementation"
  - [x] 7.4 Run feature-specific tests only
    - Run tests from: `implementChatPhase-type.test.ts`
    - Run tests from: `IncrementCard.test.tsx`
    - Run tests from: `ImplementationPlanSection.test.tsx`
    - Run tests from: `generateImplementationPlan.test.tsx`
    - Run tests from: `FeatureDefinitionPanel.plan.test.tsx`
    - Run tests from: `chatMessagePlanSummary.test.tsx`
    - Run tests from: `planGenerationIntegration.test.tsx`
    - Expected total: approximately 29-35 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 29-35 tests total)
- End-to-end user workflows validated
- Error handling verified (non-blocking)
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Frontend Type Updates** - Foundation type required by plan generation
2. **Task Group 2: IncrementCard Component** - Can run in parallel with Task Group 1 (independent)
3. **Task Group 3: ImplementationPlanSection Component** - Depends on Task Group 2 (uses IncrementCard)
4. **Task Group 4: Plan Generation Logic** - Depends on Task Group 1 (uses new phase)
5. **Task Group 5: FeatureDefinitionPanel Integration** - Depends on Task Groups 3, 4 (wiring components)
6. **Task Group 6: Chat Message Integration** - Depends on Task Group 4 (extends generation logic)
7. **Task Group 7: Integration Testing** - Final validation of all components

**Parallelization opportunities:**
- Task Groups 1 and 2 can run in parallel (no dependencies between them)
- Task Group 3 waits for Task Group 2
- Task Group 4 waits for Task Group 1
- Task Groups 5 and 6 can run in parallel after their dependencies
- Task Group 7 waits for all other groups

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/implementChatPhase-type.test.ts` | ImplementChatPhase type tests |
| `frontend/src/__tests__/IncrementCard.test.tsx` | IncrementCard component tests |
| `frontend/src/__tests__/ImplementationPlanSection.test.tsx` | ImplementationPlanSection tests |
| `frontend/src/__tests__/generateImplementationPlan.test.tsx` | Plan generation logic tests |
| `frontend/src/__tests__/FeatureDefinitionPanel.plan.test.tsx` | FeatureDefinitionPanel plan integration tests |
| `frontend/src/__tests__/chatMessagePlanSummary.test.tsx` | Chat summary message tests |
| `frontend/src/__tests__/planGenerationIntegration.test.tsx` | End-to-end integration tests |
| `frontend/src/components/ProductView/IncrementCard.tsx` | Increment display component |
| `frontend/src/components/ProductView/IncrementCard.module.css` | IncrementCard styles |
| `frontend/src/components/ProductView/ImplementationPlanSection.tsx` | Plan section container |
| `frontend/src/components/ProductView/ImplementationPlanSection.module.css` | Plan section styles |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/api/chatApi.ts` | Add 'implementation_planning' to ImplementChatPhase type |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Add props for activeIncrementId and onIncrementSelect; render ImplementationPlanSection |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add activeIncrementId state; replace proceedWithImplementation with generateImplementationPlan; update button text; add plan summary message |

---

## Key Implementation Notes

1. **Gateway Already Supports Phase** - The gateway already has 'implementation_planning' in its ImplementChatPhase type and uses IMPLEMENT_PLANNING_PROMPT_TEMPLATE
2. **Validation Expectation** - Gateway validatePlannerResponse expects implementationPlan with >= 1 increment when expectImplementationPlan is true
3. **Non-Blocking Errors** - Error handling must be non-blocking; display error in chat, allow retry
4. **Active Increment Auto-Selection** - First increment auto-selected on successful plan generation
5. **Plan Replacement** - Re-triggering Implement replaces previous plan (standard React state behavior)
6. **Button Text States** - Three states: "Implement" (default) -> "Generating Plan..." (during API) -> "In Implementation" (after success)
7. **IncrementCard Styling** - Active: #2196F3 blue border, #E3F2FD light blue background; follows Material Design color palette

---

## Visual Design Reference

**IncrementCard Active State:**
- Left border: 4px solid #2196F3 (Material Blue 500)
- Background: #E3F2FD (Material Blue 50)
- Status badge: Gray pill with "Not Started" text

**IncrementCard Non-Active State:**
- Border: 1px solid #e0e0e0
- Background: white (#ffffff)
- Hover: subtle box-shadow elevation

**ImplementationPlanSection:**
- Section title: "Implementation Plan" (bold, larger font)
- Subtitle: Plan title from implementationPlan.planTitle
- Vertical card list with consistent spacing (matching FeatureSectionCard margins)

---

## Out of Scope

- Increment status changes (all remain "NOT_STARTED" in this spec)
- Persisting activeIncrementId to context state or disk
- Executing individual increments
- Editing or modifying the generated implementation plan
- Drag-and-drop reordering of increments
- Collapsing/expanding increment details
- Progress tracking or completion percentages
- Integration with external project management tools
- Sending increment details to the Software Architect
- Starting actual code implementation from increments
