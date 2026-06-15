# Verification Report: Story-Level Scope Cross-Check for Citation Downgrade (Spec 4 Tightening)

**Spec:** `2026-05-26-story-level-scope-cross-check`
**Date:** 2026-05-25
**Verifier:** implementation-verifier
**Status:** Passed

---

## Executive Summary

The Story-Level Scope Cross-Check spec is fully implemented as written. All 8 of the spec's critical pitfalls are honoured, including the narrow `'architecture' | 'element'` enum, the alphabetically-sorted `missingDecisionCodes`, the element-level fail-open, the skip-inventory guard, and the fail-soft on null `targetArchitectureId`. The validator remains pure (no I/O imports) and the handler does all the enrichment work. All feature-scoped tests pass (16 validator + 22 handler suite tests, including 8 net-new validator scope-inference tests and 3 net-new handler enrichment tests) and `npx tsc --noEmit` is clean. Wider gateway suite shows only pre-existing failures (all matching the surfaces noted in `MEMORY.md`); no new regressions were introduced by this spec.

---

## 1. Tasks Verification

**Status:** All Complete

### Completed Tasks

- [x] Task Group 1: Validator Extensions (pure, no I/O)
  - [x] 1.1 ~8 focused tests for the scope-inference matrix (verified: 8 new tests under "story-level scope cross-check (Spec 2026-05-26)" describe block in `specGenerationResponseValidatorDecisionCitation.test.ts`)
  - [x] 1.2 Extend `CapturedDecisionRefForCitationCheck` with `scopeKind?: 'architecture' | 'element'`, `scopeRefId?: string | null`, `scopeElementName?: string | null` (verified at lines 534-556 of `specGenerationResponseValidator.ts`; enum is the narrow two-value form, NOT the wider raw-idea variant)
  - [x] 1.3 Extend `MissingDecisionCitationWarning` with `missingDecisionCodes: string[]` (verified at lines 482-493)
  - [x] 1.4 New `isDecisionInScopeForStory` helper with three-branch decision tree (verified at lines 617-635; exported as required)
  - [x] 1.5 Refined `computeMissingCitationWarning` filters to in-scope, early-returns on empty in-scope subset, builds alphabetically-sorted `missingDecisionCodes` (verified at lines 672-720)
  - [x] 1.6 Validator test file passes (verified: 16/16 tests green)

- [x] Task Group 2: Handler Enrichment (I/O + wire-up)
  - [x] 2.1 1 (actually 3 sub-)focused handler tests for the enrichment / fail-open / skip-inventory guard (verified at `migrationShapeSpecGenerationHandler.test.ts` lines 711, 803, 864)
  - [x] 2.2 `CapturedDecisionsForCitationFetcher` return-shape changed to `{decisions, targetArchitectureId}` (verified at lines 562-567)
  - [x] 2.3 `defaultFetchCapturedDecisionsForCitationCheck` updated to expose the resolved id with fail-soft preserved (verified at lines 642-665)
  - [x] 2.4 New optional `fetchElementInventoryForCitationCheck?` dep on `ShapeSpecGenerationDeps` (verified at lines 603-610)
  - [x] 2.5 `defaultFetchElementInventoryForCitationCheck` calls existing `getElementsInventory`, flattens `domains[].types[].instances[]` into `Map<id, name>`, fail-soft on Architecture Model Service error, returns empty Map when architectureId is null (verified at lines 680-716; plain-English "Architecture Model Service" log lines as required)
  - [x] 2.6 Inline enrichment with skip-inventory guard `decisions.some(d => d.scopeKind === 'element')`, fail-open path, and explicit DTO -> validator mapping (verified at lines 1747-1797 and call site at 2058-2061)
  - [x] 2.7 Handler test file passes (verified: 22/22 tests green, including 3 new tests)

- [x] Task Group 3: Combined Verification (no commit)
  - [x] 3.1 Feature-specific test suites pass (validator 16/16, handler 22/22)
  - [x] 3.2 `npx tsc --noEmit` clean (verified - no output, exit 0)
  - [x] 3.3 No out-of-scope files touched (no AMS changes, no Liquibase, no new client method, no frontend code from this spec)
  - [x] 3.4 Acceptance Verification bullets satisfied
  - [x] 3.5 Pre-existing test failures from `MEMORY.md` untouched

### Incomplete or Issues

None.

---

## 2. Documentation Verification

**Status:** Complete

### Implementation Documentation

The spec folder under `agent-os/specs/2026-05-26-story-level-scope-cross-check/` contains:
- `spec.md` (verification anchors)
- `planning/requirements.md` (11 accepted answers + investigation findings)
- `tasks.md` (3 task groups, all marked complete)
- `planning/raw-idea.md` (referenced from requirements.md)

No `implementations/` per-group reports were authored, but the spec's commit-boundary is "one commit, gateway-only, ~150-250 LOC" — for a Medium tightening of an existing validator, per-group implementation reports are not mandated. Code-level documentation inside the touched files is thorough (each new symbol carries a multi-paragraph JSDoc explaining the spec reference, the three-branch logic, and the backward-compat layers).

### Verification Documentation

- `agent-os/specs/2026-05-26-story-level-scope-cross-check/verifications/final-verification.md` (this report)

### Missing Documentation

None considered missing for a Medium single-commit tightening spec.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items

None.

### Notes

Grep of `agent-os/product/roadmap.md` for "scope cross-check", "citation downgrade", "story-level scope", and the spec slug returned no matches. This spec is a quality-of-signal tightening of an already-shipped Spec 4 validator extension and does not correspond to a discrete roadmap line item.

---

## 4. Test Suite Results

**Status:** Passed (feature-scoped); wider suite has only pre-existing failures matching `MEMORY.md`.

### Test Summary (gateway suite)

- **Total Tests:** 1991
- **Passing:** 1924
- **Failing:** 67
- **Errors:** 0 (failures only, no test-runner-level errors)
- **Test Suites:** 273 (233 passed, 40 failed)

### Feature-Scoped Test Results (the spec's anchor)

- `specGenerationResponseValidatorDecisionCitation`: 16/16 passing (8 existing + 8 net-new for the scope-inference matrix)
- `migrationShapeSpecGenerationHandler`: 22/22 passing (19 existing + 3 net-new for enrichment / fail-open / skip-inventory)
- `npx tsc --noEmit`: clean (exit 0)

### Failed Tests (all pre-existing per MEMORY.md and unrelated to this spec)

Test suites failing:
- `azure-openai-gaps.test.ts`
- `azureOpenaiClient.test.ts`
- `bootstrap-prompt.test.ts`
- `bootstrap-summary-fetching.test.ts`
- `chatV2-panel-context-and-filtering.test.ts`
- `chatV2-panel-integration.test.ts`
- `chatV2-panel-product-roadmap-gaps.test.ts`
- `chatV2-panel-product-roadmap.test.ts`
- `chatV2-xlsx-integration.test.ts`
- `chatV2-xlsx-intercept.test.ts`
- `context-injection-e2e.test.ts`
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary-increment3-gap.test.ts`
- `dashboardSummary-increment4-mock.test.ts`
- `dashboardSummary-ux-improvements.test.ts`
- `dashboardSummaryRealData.test.ts`
- `discovery-diagnostics-routes.test.ts`
- `discoveryDecisionTasks1c.test.ts`
- `discoveryDecisionTasks1cGaps.test.ts`
- `discoveryDecisionTasks1d.test.ts`
- `discoveryDecisionTasks1dGap.test.ts`
- `hub-bootstrap-2-endpoints.test.ts`
- `hub-bootstrap-3-dashboard.test.ts`
- `hub-bootstrap-4-dashboard.test.ts`
- `hub-bootstrap-4-endpoints.test.ts`
- `hub-bootstrap-4-task-definition.test.ts`
- `increment-11-summarisation-gaps.test.ts`
- `llmClient-integration.test.ts`
- `llmClient.test.ts`
- `phase0-completion-save-artifact.test.ts`
- `projectSignals.test.ts`
- `promptComposer.test.ts`
- `registryLoader.test.ts`
- `save-user-journeys-registration.test.ts`
- `task-registration-diagram.test.ts`
- `transcript-chat-integration.test.ts`
- `transcript-e2e.test.ts`
- `ux-designer-user-journey-prompt.test.ts`
- `ux-designer-user-journey-task-config.test.ts`
- `xlsxUserJourneyParser.gaps.test.ts`

All 40 failing suites belong to surfaces noted in `MEMORY.md` (dashboardSummary*, hub-bootstrap-*, chatV2-*, conversation-memory-edge-cases, bootstrap-summary-fetching) OR to known-pre-existing wider-gateway failures unrelated to validator/handler pipelines. None reference `specGenerationResponseValidator*` or `migrationShapeSpecGenerationHandler*`.

### Notes

The git working tree shows additional in-flight changes from a sibling spec (`2026-05-26-architect-conversation-enrichments`) touching `gateway/src/services/architectConversation/*`, `gateway/src/config/architect-conversation/questionLibrary.ts`, and `frontend/src/components/targetState/architectConversation/*`. These are NOT attributable to this spec; the four files this spec touches are exactly:

- `gateway/src/services/specGenerationResponseValidator.ts`
- `gateway/src/services/migrationShapeSpecGenerationHandler.ts`
- `gateway/src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts`
- `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts`

---

## 5. Critical-Pitfalls Audit

| # | Pitfall | Verified | Evidence |
|---|---------|----------|----------|
| 1 | `scopeKind` enum is narrow `'architecture' \| 'element'` ONLY (no `service`/`interface`) | yes | `specGenerationResponseValidator.ts:545` — `scopeKind?: 'architecture' \| 'element'` |
| 2 | `missingDecisionCodes` sorted alphabetically; test asserts multi-code sorted output | yes | `specGenerationResponseValidator.ts:699-702` (`.slice().sort()`); legacy-fallback test at line 359 asserts `['auth.provider', 'db.engine', 'service.framework']` order |
| 3 | Fail-open at element level: `scopeElementName=null` is in-scope | yes | `isDecisionInScopeForStory` branch 2 at lines 625-628; test "element-scope decision with scopeElementName=null -> fail-open in-scope" at line 396 |
| 4 | Skip-inventory guard: `decisions.some(d => d.scopeKind === 'element')` | yes | handler line 1754-1761 `hasElementScopeDecision` guard combined with `length > 0` and non-null targetArchitectureId; test "skip-inventory guard" at handler test line 864 |
| 5 | Fail-soft on null `targetArchitectureId`: inventory helper returns empty Map without Architecture Model Service call | yes | `defaultFetchElementInventoryForCitationCheck` lines 684-686 returns `new Map()` early when `!architectureId` |
| 6 | Case-insensitive raw substring (no word-boundary regex) | yes | lines 630-634 — lowercases both needle and haystack, uses `String.includes`; case-insensitive test at line 368 |
| 7 | Backward-compat: legacy callers without `scopeKind` preserve v1 binary behaviour | yes | branch 1 of `isDecisionInScopeForStory` at line 621-623; legacy-caller test at line 336 |
| 8 | Validator stays pure (no I/O) | yes | `specGenerationResponseValidator.ts` has NO `import` statements at all (file uses only its own types); no `axios`, no `fetch`, no `http` invocations anywhere in the file |

All eight pitfalls are honoured by the implementation.

---

## 6. Out-of-Scope Confirmations

- No AMS / `architecture-model-service/src` changes (`git status` shows no edits under that path; only `__pycache__/` is untracked but ignorable)
- No new Liquibase changesets
- No frontend changes from this spec (the in-tree frontend edits belong to a sibling architect-conversation-enrichments spec)
- No changes to `computeUnreferencedCitedDecisionWarning` (still resides at lines 736+ of the validator file as an independent extension)
- No new method added to `architectureModelClient.ts`; only the existing `getElementsInventory` is consumed
- `targetStateDecisionsContextResolver.test.ts` is untouched (confirmed by `git status` — no entry for this file); fixtures using `scopeKind: 'service'/'interface'` for the wider `TargetStateCapturedDecision` consumer type are correctly left alone
