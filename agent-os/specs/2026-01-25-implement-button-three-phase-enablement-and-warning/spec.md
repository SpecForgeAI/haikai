# Specification: Implement Button Three-Phase Enablement and Warning

## Goal
Replace the legacy transcript-based gating logic (`extractProposedDefinition`) with a modern 3-phase state model for the Implement button, driven by structured `latestPlannerResponse` state and explicit `questionStatuses` for unanswered question detection.

## User Stories
- As a product owner, I want the Implement button to be disabled until the planner has provided a meaningful feature definition, so that I do not accidentally trigger implementation before the feature is ready.
- As a product owner, I want to be warned before proceeding with implementation if I have unanswered questions, so that I can make an informed decision about whether to continue.

## Specific Requirements

**3-Phase State Model Definition**
- Phase 1 (No Planner Definition): Button is disabled (greyed out, not clickable); no planner/PO definition data is available
- Phase 2 (Planner Present + Unanswered Questions): Button is enabled; on click, show existing `ImplementConfirmationModal` warning before proceeding
- Phase 3 (Planner Present + All Answered): Button is enabled; on click, proceed directly to plan generation without modal
- Phase transitions are derived from `hasPlannerDefinition` and `hasUnansweredQuestions` computed values

**hasPlannerDefinition Derivation**
- Implement as a `useMemo` hook in `ImplementationAssistantPanel`
- Returns `true` when `latestPlannerResponse` is present AND contains meaningful data
- Meaningful data criteria: `featureUnderstanding` is non-empty AND at least one substantive field is populated
- Substantive fields: `scope.in` (non-empty array), `scope.out` (non-empty array), `acceptanceCriteria` (non-empty array), `assumptions` (non-empty array), or `openQuestions` (non-empty array)
- Returns `false` when `latestPlannerResponse` is null, undefined, or contains only empty/whitespace fields
- Replace the current `hasProposedDefinition` which uses legacy `extractProposedDefinition(messages)` call

**hasUnansweredQuestions Derivation**
- Implement as a `useMemo` hook (or inline in existing `openQuestionCount` memo) in `ImplementationAssistantPanel`
- Derives from `combinedQuestions` array (which merges PO and SA questions)
- A question is considered "unanswered" if `questionStatuses.get(questionId)` is `'Open'` or absent from the map
- Only questions with explicit `questionStatuses.get(id) === 'Answered'` count as answered
- Typed-but-not-submitted answers do NOT count as answered (preserves existing 2026-01-24 spec behavior)
- Returns `true` if any question has status `'Open'` (or missing from map); `false` if all are `'Answered'`

**Button Enablement Logic Changes**
- Preserve existing base prerequisites: `sessionId` present, not `isLoading`, not `isBootstrapping`, `workItemId` present, not `isImplementing`
- Replace `hasProposedDefinition` check (legacy) with `hasPlannerDefinition` check (new)
- Button enablement formula: `canImplement = !implementationMode && canImplementBase`
- `canImplementBase = !!sessionId && !isLoading && !isBootstrapping && !!workItemId && hasPlannerDefinition && !isImplementing`
- Do NOT disable button when unanswered questions exist (Phase 2 requires button to be enabled)

**Warning Modal Trigger Conditions**
- Modal shown when: button clicked AND `hasUnansweredQuestions === true`
- Modal bypassed when: button clicked AND `hasUnansweredQuestions === false`
- Reuse existing `ImplementConfirmationModal` component without UX changes
- Pass `openQuestionCount` (count of questions with status `'Open'`) to modal for message display

**Remove Legacy proposedDefinitionExtractor Usage**
- Remove import of `extractProposedDefinition` and `transformToShapeSpec` from `proposedDefinitionExtractor.ts`
- Remove `hasProposedDefinition` useMemo that depends on `extractProposedDefinition(messages)`
- Do NOT delete the `proposedDefinitionExtractor.ts` file (may be used elsewhere; removal is out of scope)

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**ImplementationAssistantPanel.tsx (lines 618-634)**
- Contains existing `hasProposedDefinition` useMemo (to be replaced) at line 618
- Contains existing `openQuestionCount` useMemo at line 626 that filters by answer presence
- `canImplementBase` formula at line 1877 uses `hasProposedDefinition` - update to use `hasPlannerDefinition`
- `handleImplementClick` at line 1554 already checks `openQuestionCount > 0` for modal display

**questionStatuses State (line 599)**
- Existing `Map<string, 'Open' | 'Answered'>` state that tracks explicit question status
- Status is only set to `'Answered'` after successful submit (per spec 2026-01-24)
- Used in `combinedQuestions` memo at line 642 to derive question status

**ImplementConfirmationModal.tsx**
- Existing modal component with `openQuestionCount` prop
- Displays warning message: "You have {count} unanswered questions from the Product Owner"
- `onConfirm` callback triggers `handleModalConfirm` which sets `implementationMode = true` and calls `generateImplementationPlan`

**PlannerResponse Interface (chatApi.ts lines 374-403)**
- `featureUnderstanding: string` - primary field for meaningful definition check
- `scope: { in: string[], out: string[] }` - substantive field for scope items
- `acceptanceCriteria: string[]` - substantive field
- `assumptions: string[]` - substantive field
- `openQuestions: OpenQuestion[]` - substantive field with `{id, question}` structure

**Existing Test Patterns (ImplementButton.workflow.test.tsx)**
- Tests button text logic based on `implementationMode` and `isImplementing` states
- Tests disabled state derivation from `implementationMode` and `canImplementBase`
- Tests `handleImplementClick` flow with `openQuestionCount` checks
- Uses isolated logic testing pattern (not full component render)

## Out of Scope
- Modifying the `ImplementConfirmationModal` UX, wording, or styling
- Changes to backend services or API contracts
- Changes to the persistence format or workspace rehydration logic
- Adding a tooltip to the disabled Implement button (Phase 1)
- Deleting `proposedDefinitionExtractor.ts` file (may have other usages)
- Changes to how `questionStatuses` state is updated (already handled by spec 2026-01-24)
- Changes to SA question handling or per-increment question filtering
- Changes to mobile tab layout or responsive behavior
- Changes to the `FeatureDefinitionPanel` component
- Changes to the `generateImplementationPlan` function behavior
