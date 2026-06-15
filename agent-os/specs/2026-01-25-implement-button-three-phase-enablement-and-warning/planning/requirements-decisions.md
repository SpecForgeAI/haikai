# Requirements Decisions

## 1. "Planner definition present" criteria

Require a meaningful planner response, but not "all fields must be filled". Use `featureUnderstanding` as mandatory, and at least one additional substantive field present (any of: `scope.in`/`scope.out`, `acceptanceCriteria`, `assumptions`, `openQuestions`). This avoids enabling purely on a trivial/empty response while not over-constraining.

## 2. Open question "answered" status

Phase 2 warning should trigger if there exists any open question that is not definitively answered/submitted. Typed-but-not-submitted answers should NOT count as answered (still warn). Only submitted/confirmed answers (as represented by `questionStatuses == 'Answered'`, or equivalent persisted/acknowledged state) should clear the warning.

## 3. Phase 1 disabled state

No tooltip required for this iteration; greyed-out is sufficient. (If easy to add without UI churn, optional, but not necessary.)

## 4. Preserve existing prerequisites

Yes - keep the existing `canImplementBase` prerequisites (sessionId, not loading/bootstrapping, workItemId present, not implementing) as baseline guards, then apply the 3-phase planner/open-question logic on top.

## 5. Computation approach

Yes - implement `hasPlannerDefinition` as a `useMemo` derived from `latestPlannerResponse` (and any required dependent state), matching the existing pattern.

## 6. Explicit exclusions / edge cases

- Do not modify the warning modal UX/wording; reuse existing `ImplementConfirmationModal` behavior.
- Do not change backend/service contracts or persistence formats.
- Partially populated planner responses should follow the criteria in (1) above (avoid enabling on empty shells).
- Keep behavior stable during work item transitions/loading: if plannerResponse is absent/cleared while switching, fall back to Phase 1 (disabled) until the new plannerResponse arrives.

## Visual Assets

None provided.
