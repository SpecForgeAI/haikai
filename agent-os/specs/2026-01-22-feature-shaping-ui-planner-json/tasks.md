# Task Breakdown: Feature Shaping UI Consumes Planner JSON

## Overview

**Spec ID:** 2026-01-22-feature-shaping-ui-planner-json
**Total Tasks:** 28
**Estimated Effort:** Medium (frontend-only, React/TypeScript)

This implementation updates the Implementation Assistant Panel to render a Feature Definition area driven by the Planner's structured JSON output (`PlannerResponse`), presenting a single merged, human-readable feature definition while keeping conversational chat separate.

---

## Task List

### Type Definitions Layer

#### Task Group 1: Add PlannerResponse Type to Frontend
**Dependencies:** None

- [x] 1.0 Complete frontend type definitions
  - [x] 1.1 Write 3-4 focused tests for type definitions
    - **File:** `frontend/src/__tests__/planner-response-types.test.ts`
    - Test PlannerResponse interface shape validation
    - Test ChatResponse includes optional plannerResponse field
    - Test ImplementationPlan interface shape validation
    - Test type guards work correctly for PlannerResponse validation
  - [x] 1.2 Add PlannerResponse interface to chatApi.ts
    - **File:** `frontend/src/api/chatApi.ts`
    - Add `PlannerResponse` interface with all fields:
      - `schemaVersion: "1.1"`
      - `message: string`
      - `featureUnderstanding: string`
      - `scope: { in: string[]; out: string[] }`
      - `assumptions: string[]`
      - `acceptanceCriteria: string[]`
      - `openQuestions: string[]`
      - `plannerReadyForSpec: boolean`
      - `implementationPlan: ImplementationPlan | null`
  - [x] 1.3 Add ImplementationPlan and Increment interfaces
    - **File:** `frontend/src/api/chatApi.ts`
    - Add `ImplementationPlan` interface:
      - `planTitle: string`
      - `increments: Increment[]`
    - Add `Increment` interface:
      - `id: string`
      - `title: string`
      - `shortDescription: string`
      - `status: "NOT_STARTED"`
      - `proposedFinalSubFeatureDefinition: string`
  - [x] 1.4 Update ChatResponse interface
    - **File:** `frontend/src/api/chatApi.ts`
    - Add `plannerResponse?: PlannerResponse` field to ChatResponse
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- All new interfaces are properly typed
- TypeScript compilation succeeds with new types
- ChatResponse includes optional plannerResponse field

---

### New Components Layer

#### Task Group 2: Create FeatureSectionCard Component
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete FeatureSectionCard component
  - [x] 2.1 Write 4-5 focused tests for FeatureSectionCard
    - **File:** `frontend/src/__tests__/FeatureSectionCard.test.tsx`
    - Test component renders title and children correctly
    - Test component shows empty state when `isEmpty=true`
    - Test component displays custom `emptyMessage` when provided
    - Test component renders with correct styling classes
    - Test component handles missing/undefined children gracefully
  - [x] 2.2 Create FeatureSectionCard component
    - **File:** `frontend/src/components/ProductView/FeatureSectionCard.tsx` (NEW)
    - Props interface:
      - `title: string`
      - `children: React.ReactNode`
      - `isEmpty?: boolean`
      - `emptyMessage?: string`
    - Render card container with title header
    - Show empty state placeholder when `isEmpty=true`
    - Render children when content is present
  - [x] 2.3 Create FeatureSectionCard styles
    - **File:** `frontend/src/components/ProductView/FeatureSectionCard.module.css` (NEW)
    - Card styling:
      - Background: White
      - Border: 1px solid #E0E0E0
      - Border-radius: 8px
      - Margin-bottom: 16px
      - Padding: 16px
    - Section header styling:
      - Font: Semi-bold, 14px
      - Color: #333
      - Margin-bottom: 12px
      - Border-bottom: 1px solid #F0F0F0
    - Empty state styling (italic, muted color)
  - [x] 2.4 Ensure FeatureSectionCard tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify component renders correctly in all states

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- Component renders title and children correctly
- Empty state displays when isEmpty=true
- Styling matches spec requirements

---

#### Task Group 3: Create FeatureHeader Component
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete FeatureHeader component
  - [x] 3.1 Write 2-3 focused tests for FeatureHeader
    - **File:** `frontend/src/__tests__/FeatureHeader.test.tsx`
    - Test component renders feature title correctly
    - Test component displays "Feature:" label
    - Test component handles empty/undefined title gracefully
  - [x] 3.2 Create FeatureHeader component
    - **File:** `frontend/src/components/ProductView/FeatureHeader.tsx` (NEW)
    - Props interface:
      - `title: string`
    - Render dark banner with "Feature:" label and title
  - [x] 3.3 Create FeatureHeader styles
    - **File:** `frontend/src/components/ProductView/FeatureHeader.module.css` (NEW)
    - Header styling:
      - Background: Dark gray (#2D2D2D)
      - Text: White
      - Padding: 12px 16px
      - Font: Bold, 16px
    - Label styling (semi-bold, slightly muted)
    - Title styling (bold, full white)
  - [x] 3.4 Ensure FeatureHeader tests pass
    - Run ONLY the 2-3 tests written in 3.1
    - Verify component renders correctly

**Acceptance Criteria:**
- The 2-3 tests written in 3.1 pass
- Component displays dark banner with feature title
- Styling matches spec requirements

---

#### Task Group 4: Create FeatureDefinitionPanel Component
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete FeatureDefinitionPanel component
  - [x] 4.1 Write 5-6 focused tests for FeatureDefinitionPanel
    - **File:** `frontend/src/__tests__/FeatureDefinitionPanel.test.tsx`
    - Test component renders FeatureHeader with work item title
    - Test component renders Description section with workItemDescription
    - Test component renders Product Owner Understanding from plannerResponse.featureUnderstanding
    - Test component renders Scope sections (in/out) as bullet lists
    - Test component renders Acceptance Criteria as numbered list
    - Test component handles missing/null plannerResponse gracefully (shows empty states)
  - [x] 4.2 Create FeatureDefinitionPanel component
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` (NEW)
    - Props interface:
      - `workItemTitle: string`
      - `workItemDescription: string`
      - `plannerResponse: PlannerResponse | null`
    - Import and use FeatureHeader, FeatureSectionCard components
    - Render sections in order:
      1. FeatureHeader (with workItemTitle)
      2. Description (workItemDescription - always visible)
      3. Product Owner Understanding (featureUnderstanding - with empty state)
      4. Scope (scope.in - hidden if empty)
      5. Out of Scope (scope.out - hidden if empty)
      6. Acceptance Criteria (always visible - with empty state)
      7. Assumptions (hidden if empty)
  - [x] 4.3 Create FeatureDefinitionPanel styles
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css` (NEW)
    - Panel container styling (scrollable, padding)
    - Bullet list styling (.bulletList)
    - Numbered list styling (.numberedList)
    - Section content styling (.description, .understanding)
  - [x] 4.4 Ensure FeatureDefinitionPanel tests pass
    - Run ONLY the 5-6 tests written in 4.1
    - Verify all sections render correctly

**Acceptance Criteria:**
- The 5-6 tests written in 4.1 pass
- All sections render from plannerResponse data
- Description always shows workItemDescription (immutable)
- Empty states display correctly for missing data
- Hidden sections for empty arrays work correctly

---

### Modified Components Layer

#### Task Group 5: Update ChatBubble with Persona Labels
**Dependencies:** None (can run in parallel with Task Groups 1-4)

- [x] 5.0 Complete ChatBubble persona label update
  - [x] 5.1 Write 3-4 focused tests for ChatBubble persona labels
    - **File:** `frontend/src/__tests__/ChatBubble.persona.test.tsx`
    - Test ChatBubble displays "You" label for user role
    - Test ChatBubble displays "Product Owner" label for assistant role in refine phase
    - Test ChatBubble applies correct color accent based on role
    - Test persona label is visually positioned correctly
  - [x] 5.2 Update ChatBubble component to accept persona props
    - **File:** `frontend/src/components/chat/ChatBubble.tsx`
    - Add optional prop: `persona?: string`
    - Add optional prop: `personaColor?: 'green' | 'blue' | 'purple'`
    - Default persona based on role if not provided:
      - `user` -> "You"
      - `assistant` -> "Product Owner"
    - Render persona label above or beside message content
  - [x] 5.3 Update ChatBubble styles for persona labels
    - **File:** `frontend/src/components/chat/ChatBubble.module.css`
    - Add persona label styling:
      - Font: Semi-bold, 12px
      - Margin-bottom: 4px
    - Add color accent classes:
      - `.personaGreen` (green accent for user)
      - `.personaBlue` (blue accent for Product Owner)
      - `.personaPurple` (purple accent for future Software Architect)
  - [x] 5.4 Ensure ChatBubble tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify persona labels display correctly

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- User messages show "You" with green accent
- Assistant messages show "Product Owner" with blue accent
- Persona labels are visually distinct

---

#### Task Group 6: Update ImplementationAssistantPanel Layout and State
**Dependencies:** Task Groups 1, 4, 5

- [x] 6.0 Complete ImplementationAssistantPanel restructuring
  - [x] 6.1 Write 5-6 focused tests for panel layout and state
    - **File:** `frontend/src/__tests__/ImplementationAssistantPanel.split-layout.test.tsx`
    - Test split layout renders Feature Definition panel (60%) and Team Chat panel (40%)
    - Test latestPlannerResponse state updates when valid plannerResponse received
    - Test latestPlannerResponse preserves previous value when invalid response received
    - Test chat bubbles display only message field from plannerResponse
    - Test responsive behavior switches to stacked layout on tablet viewport
    - Test responsive behavior switches to tabs on mobile viewport
  - [x] 6.2 Add latestPlannerResponse state to ImplementationAssistantPanel
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state: `const [latestPlannerResponse, setLatestPlannerResponse] = useState<PlannerResponse | null>(null)`
    - Import PlannerResponse type from chatApi
  - [x] 6.3 Update handleChatResponse to extract plannerResponse
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - When receiving ChatResponse:
      - Extract `message` field for chat bubble content: `response.plannerResponse?.message ?? response.assistant.message`
      - If `response.plannerResponse` is valid, call `setLatestPlannerResponse(response.plannerResponse)`
      - If invalid, keep previous `latestPlannerResponse` (fallback behavior)
  - [x] 6.4 Implement split panel layout structure
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Restructure main content area into two panels:
      - Left panel (60%): `<FeatureDefinitionPanel />`
      - Right panel (40%): Team Chat area (existing ChatMessageList)
    - Pass props to FeatureDefinitionPanel:
      - `workItemTitle` from work item context
      - `workItemDescription` from work item context
      - `plannerResponse={latestPlannerResponse}`
    - Add Team Chat header above ChatMessageList
  - [x] 6.5 Update ImplementationAssistantPanel styles for split layout
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css`
    - Add split panel container using CSS flexbox or grid
    - Left panel: `flex: 0 0 60%` or `width: 60%`
    - Right panel: `flex: 0 0 40%` or `width: 40%`
    - Add panel divider styling
    - Add Team Chat header styling
  - [x] 6.6 Implement responsive behavior
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css`
    - Desktop (>1200px): Side-by-side panels (60/40 split)
    - Tablet (768-1200px): Stacked layout (Feature on top, Chat below)
    - Mobile (<768px): Add tab switching mechanism in TSX
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add state for active tab on mobile: `const [activeTab, setActiveTab] = useState<'feature' | 'chat'>('feature')`
    - Add tab buttons for mobile view
    - Conditionally render panels based on activeTab and viewport
  - [x] 6.7 Ensure split layout tests pass
    - Run ONLY the 5-6 tests written in 6.1
    - Verify layout renders correctly on all viewports

**Acceptance Criteria:**
- The 5-6 tests written in 6.1 pass
- Split panel layout displays correctly (60/40)
- latestPlannerResponse state tracks valid responses
- Chat bubbles show only message content
- Responsive behavior works on tablet and mobile

---

### Integration Testing

#### Task Group 7: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 3-4 type definition tests (Task 1.1)
    - Review the 4-5 FeatureSectionCard tests (Task 2.1)
    - Review the 2-3 FeatureHeader tests (Task 3.1)
    - Review the 5-6 FeatureDefinitionPanel tests (Task 4.1)
    - Review the 3-4 ChatBubble persona tests (Task 5.1)
    - Review the 5-6 split layout tests (Task 6.1)
    - Total existing tests: approximately 22-28 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - **File:** `frontend/src/__tests__/feature-shaping-ui-integration.test.tsx` (NEW)
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on Feature Shaping UI feature
    - Prioritize user interaction flows and state management
  - [x] 7.3 Write up to 8 additional strategic integration tests
    - Test end-to-end flow: user sends message -> plannerResponse received -> Feature Definition updates
    - Test chat message only displays `message` field, not structured content
    - Test Feature Definition preserves previous response on invalid response
    - Test responsive layout transitions correctly between breakpoints
    - Test empty state displays correctly when no plannerResponse exists
    - Test multiple consecutive plannerResponses update Feature Definition correctly
    - Test work item description remains unchanged regardless of plannerResponse
    - Test persona labels display correctly in Team Chat
  - [x] 7.4 Run feature-specific tests only
    - Run tests from: `planner-response-types.test.ts`
    - Run tests from: `FeatureSectionCard.test.tsx`
    - Run tests from: `FeatureHeader.test.tsx`
    - Run tests from: `FeatureDefinitionPanel.test.tsx`
    - Run tests from: `ChatBubble.persona.test.tsx`
    - Run tests from: `ImplementationAssistantPanel.split-layout.test.tsx`
    - Run tests from: `feature-shaping-ui-integration.test.tsx`
    - Expected total: approximately 30-36 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 30-36 tests total)
- End-to-end user workflows validated
- State management behavior tested
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Groups 1, 2, 3, 5 (Parallel)** - These have no dependencies and can be implemented simultaneously:
   - Type Definitions (Task Group 1)
   - FeatureSectionCard (Task Group 2)
   - FeatureHeader (Task Group 3)
   - ChatBubble persona labels (Task Group 5)

2. **Task Group 4: FeatureDefinitionPanel** - Depends on Task Groups 1, 2, 3
   - Composes FeatureHeader and FeatureSectionCard
   - Consumes PlannerResponse type

3. **Task Group 6: ImplementationAssistantPanel** - Depends on Task Groups 1, 4, 5
   - Integrates FeatureDefinitionPanel
   - Implements split layout and state management
   - Uses updated ChatBubble with persona labels

4. **Task Group 7: Integration Testing** - Final validation of all components

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/ProductView/FeatureSectionCard.tsx` | Reusable card wrapper for feature sections |
| `frontend/src/components/ProductView/FeatureSectionCard.module.css` | Styles for FeatureSectionCard |
| `frontend/src/components/ProductView/FeatureHeader.tsx` | Dark banner with feature title |
| `frontend/src/components/ProductView/FeatureHeader.module.css` | Styles for FeatureHeader |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Container for all feature sections |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css` | Styles for FeatureDefinitionPanel |
| `frontend/src/__tests__/planner-response-types.test.ts` | Type definition tests |
| `frontend/src/__tests__/FeatureSectionCard.test.tsx` | FeatureSectionCard unit tests |
| `frontend/src/__tests__/FeatureHeader.test.tsx` | FeatureHeader unit tests |
| `frontend/src/__tests__/FeatureDefinitionPanel.test.tsx` | FeatureDefinitionPanel unit tests |
| `frontend/src/__tests__/ChatBubble.persona.test.tsx` | ChatBubble persona label tests |
| `frontend/src/__tests__/ImplementationAssistantPanel.split-layout.test.tsx` | Split layout tests |
| `frontend/src/__tests__/feature-shaping-ui-integration.test.tsx` | Integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/api/chatApi.ts` | Add PlannerResponse, ImplementationPlan, Increment interfaces; update ChatResponse |
| `frontend/src/components/chat/ChatBubble.tsx` | Add persona label support with color accents |
| `frontend/src/components/chat/ChatBubble.module.css` | Add persona label and color accent styles |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add split layout, latestPlannerResponse state, integrate new panels |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` | Add split panel layout styles, responsive breakpoints |

---

## Key Implementation Notes

1. **Use existing ArchitectureContext pattern** - Follow established state management patterns
2. **PlannerResponse fallback behavior** - Never clear Feature Definition on invalid response
3. **Chat message extraction** - Always prefer `plannerResponse.message` over `assistant.message`
4. **Responsive design** - Use CSS media queries for tablet, JavaScript state for mobile tabs
5. **Component composition** - FeatureDefinitionPanel composes FeatureHeader and multiple FeatureSectionCards
6. **Empty states** - Each section handles its own empty state independently

---

## Risk Mitigation

1. **Type Safety** - Ensure PlannerResponse type matches gateway contract exactly
2. **Backward Compatibility** - Handle cases where plannerResponse is missing (older responses)
3. **Responsive Testing** - Test on actual devices or use browser dev tools for viewport simulation
4. **State Persistence** - Ensure latestPlannerResponse survives component re-renders

---

## Out of Scope

- Questions table and answer workflow (separate spec)
- Implementation planning UI (`implementationPlan` display)
- Software Architect / implementation mode behavior
- Persistence schema changes
- `openQuestions` display
- `plannerReadyForSpec` indicator UI
