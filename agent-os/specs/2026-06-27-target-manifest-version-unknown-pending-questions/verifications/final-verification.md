# Verification Report: Version-unknown manifest entries become pending questions (Spec B, design A)

**Spec:** `2026-06-27-target-manifest-version-unknown-pending-questions`
**Date:** 2026-06-27
**Verifier:** implementation-verifier
**Status:** ⚠️ Passed with Issues

---

## Executive Summary

The spec is fully implemented across the gateway and frontend exactly as designed:
version-unknown versioned manifest coordinates no longer write captured-decision
rows, they persist as a new `pending-version-confirmations` thread turn, are surfaced
FIRST in the next-question walk with the framework pre-chosen, and stay excluded from
answered/prompt-ready/close-gate. All seven confirmed requirements pass on a
code-read basis, and every test the spec added or modified passes (gateway 53/53 in
the touched suites; frontend 36/36 across the new + regression component suites).
One pre-existing end-to-end test (`manifestComprehensiveEndToEnd.test.ts`) was NOT
reconciled with the new (intended) behaviour and now fails — a stale-test gap, not a
logic regression. Two unrelated `migrationBookOfWork*` suites fail identically on the
clean baseline (confirmed by stash) and are not attributable to this spec.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All four task groups and their sub-tasks were already marked `- [x]` in `tasks.md`
and were spot-checked against the implementation; all are genuinely complete.

### Completed Tasks
- [x] Task Group 1: Pending turn kind + thread persistence
  - [x] 1.1 Focused tests for the new turn kind + persistence (`pendingVersionConfirmations.test.ts`, 4 tests)
  - [x] 1.2 Closed union extended in `turnShape.ts` (`ConversationTurnKind`, `ConversationTurn`, `assertExhaustiveTurnKind`)
  - [x] 1.3 Write/replace via existing `appendTurn` (no signature change) in `pendingVersionConfirmations.ts`
  - [x] 1.4 Data-model tests pass in isolation
- [x] Task Group 2: Stop the version-unknown write, emit pending
  - [x] 2.1 Focused tests for the diverted write path (`manifestAutoAnswererPendingVersion.test.ts`, 7 tests)
  - [x] 2.2 Diverted version-unknown branch in `runManifestAutoAnswer`
  - [x] 2.3 Recompute + persist the pending set on every upload
  - [x] 2.4 Re-upload precedence honoured (5a/5b/5c) via `existingConcreteVersionCodes` + `manifestPrecedence`
  - [x] 2.5 Write-path tests pass in isolation
- [x] Task Group 3: Surface pending FIRST; keep excluded from answered/prompt-ready/close-gate
  - [x] 3.1 Focused tests (`architectConversationPendingVersionFirst.test.ts`, 5 tests)
  - [x] 3.2 Read latest pending turn in next-question route; return pending FIRST, framework pre-chosen
  - [x] 3.3 Group A..J walk stays row-driven (`selectNextQuestion` untouched; injection ahead of it)
  - [x] 3.4 Confirm clears pending; reconcile against captured rows (latest-wins)
  - [x] 3.5 Pending excluded from `answeredCodes` / prompt-ready / close-gate
  - [x] 3.6 Walk tests pass in isolation
- [x] Task Group 4: Read-only pending affordance + informational pending count
  - [x] 4.1 Focused UI tests (`ManifestUploadPanel.pendingVersion.test.tsx` 3, `ConversationMainPane.prechosenFramework.test.tsx` 2)
  - [x] 4.2 Version-unknown rows read-only in `ManifestUploadPanel` (`Pending version confirmation — confirm in the conversation`); inline edit only for concrete rows
  - [x] 4.3 Informational `Pending version confirmation (N)` list, separate from Decisions Captured
  - [x] 4.4 Pending-first question renders via existing `VersionedAnswerControl` with framework pre-selected
  - [x] 4.5 Frontend tests + scoped typecheck pass in isolation

### Incomplete or Issues
None — all task checkboxes are correctly marked and substantiated by code.

---

## 2. Requirement-by-Requirement Verification

**Status:** ⚠️ All 7 requirements implemented; one stale end-to-end test surfaces the behaviour change (see §4).

| # | Requirement | Result | Evidence |
|---|-------------|--------|----------|
| 1 | version-unknown does NOT write a captured row; concrete + single-choice unchanged | ✅ PASS | `manifestAutoAnswerer.ts:464` diverts `answerKind !== 'single-choice' && version === VERSION_UNKNOWN`, collects into `pendingEntries`, never increments `rowsWritten`; concrete/single-choice fall through to the unchanged `postCapturedDecision` path (`:502-505`). |
| 2 | Pending persisted as `pending-version-confirmations` turn (recompute/replace, latest-wins read) | ✅ PASS | `pendingVersionConfirmations.ts` `writePendingVersionConfirmations` appends the FULL set via existing `appendTurn` (signature untouched); `readLatestPendingVersionConfirmations` walks turns in reverse for latest-wins. Persisted unconditionally at run end (`manifestAutoAnswerer.ts:540`), empty set clears. |
| 3 | Re-upload precedence (a) pending→concrete clears; (b) concrete not retracted by later unknown; (c) manual wins | ✅ PASS | (a) concrete re-upload writes via normal path + recomputed pending omits it; (b)/(c) `existingConcreteVersionCodes` guard at `:469` skips no-write/no-pending; orchestrator feeds the set via `codesWithConcreteCapturedVersion` (`manifestUploadOrchestrator.ts:257`) layered on `dedupeCandidatesByPrecedence` + manual-wins. Covered by tests (4)/(5)/(7). |
| 4 | Next-question returns pending FIRST with `prechosenFramework`; drops once captured | ✅ PASS | `architectConversation.ts:616-635` reads latest pending, filters `!answeredCodes.has(...)`, returns `toPendingQuestionDto(entry, framework)` ahead of `selectNextQuestion`; `questionSequencer.ts:157` adds the `prechosenFramework` DTO field. |
| 5 | Pending excluded from `answeredCodes`, prompt-ready, close-gate | ✅ PASS | `answeredCodes` built solely from captured-row presence (`:581`); pending never added; prompt-ready/close-gate stay row-driven. Verified by `architectConversationPendingVersionFirst` test (4). |
| 6 | `ManifestUploadPanel` read-only pending row + informational `Pending version confirmation (N)` list | ✅ PASS | `ManifestUploadPanel.tsx`: Edit button gated `!editing && !isUnknown` (`:748`); read-only note `:774-781`; informational section `:465-495` keyed off `response.autoAnswer.pendingVersionConfirmations`, separate from Decisions Captured. |
| 7 | Conversation pending question renders framework pre-selected via `prechosenFramework` → `VersionedAnswerControl` | ✅ PASS | `ConversationMainPane.tsx:430` threads `prechosenFramework`; `VersionedAnswerControl.tsx:115,129,148-154` seeds the framework, locks the chips (`disabled ... || prechosenFramework != null` `:286`) and reveals only the version editor. |

---

## 3. Documentation Verification

**Status:** ⚠️ No implementation reports present

### Implementation Documentation
The spec's `implementation/` folder is EMPTY — no per-task-group implementation
reports were written. This does not affect the correctness of the delivered code
(verified directly), but the report artefacts called for by the workflow are absent.

### Verification Documentation
- This report: `verifications/final-verification.md`

### Missing Documentation
- `implementation/1-*.md` … `implementation/4-*.md` (per task-group implementation reports) — not present.

---

## 4. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is a high-level product roadmap (101 lines). No item
matches this fine-grained gateway/frontend behaviour spec. The only "version"-related
entry (#36 "Model Versioning") is unrelated. No checkbox change was warranted.

---

## 5. Test Suite Results

### Gateway — spec-touched suites (run in isolation)
**Status:** ✅ All Passing

- `pendingVersionConfirmations.test.ts` — 4 passed
- `manifestAutoAnswererPendingVersion.test.ts` — 7 passed
- `manifestAutoAnswerer.test.ts` — passed (incl. updated (l)/(m)/(n) for inferred-diversion)
- `manifestPrecedence.test.ts` — 10 passed
- `architectConversationPendingVersionFirst.test.ts` — 5 passed
- `openPhaseTurnShape.test.ts` — 6 passed (incl. exhaustiveness + "21 total incl. pending-version-confirmations")
- (questionSequencer suite) — passed

Touched-suite total: **7 suites, 53 tests, all passing.**
Gateway `tsc --noEmit`: **clean (exit 0)** — exhaustiveness compiles, no broken union consumer.

### Gateway — full suite (regression scan)
**Status:** ⚠️ Some Failures (8 pre-existing + 1 spec-introduced stale test)

- **Total Tests:** 2895
- **Passing:** 2886
- **Failing:** 9 (across 3 suites)

#### Failed Tests
1. `manifestComprehensiveEndToEnd.test.ts` — 1 failure — **spec-introduced, stale test (not a logic regression).**
   - `a comprehensive pom surfaces deterministic + inferred + LLM + Tier-2 in ONE response ...`
   - Expects `writtenCodes` to contain `db.engine` and `service.runtime`; received them ABSENT.
   - Root cause: `db.engine` and `service.runtime` are INFERRED family-only candidates carrying the `version-unknown` sentinel. Per the spec's diversion rule they are now (intentionally) routed to the pending set instead of being written — the updated unit test `manifestAutoAnswerer.test.ts` explicitly asserts this new behaviour (`db.engine` undefined in POST calls, present in `pendingVersionConfirmations`). The broader end-to-end test was NOT reconciled and still asserts the old write behaviour.
2. `migrationBookOfWorkFindingsCoverage.test.ts` — 7 failures — **pre-existing baseline, unrelated.**
3. `migrationBookOfWorkExpansion.test.ts` — 1 failure — **pre-existing baseline, unrelated.**

#### Baseline confirmation
Stashing the tracked gateway changes and re-running the two `migrationBookOfWork*`
suites reproduced **8/8 failures** on the clean tree, confirming they are pre-existing
and not caused by this spec. Those suites also import none of the touched modules.

### Frontend — spec suites + regression (run in isolation)
**Status:** ✅ All Passing (whole-repo build deliberately NOT used as a gate — pre-existing RED baseline)

- `ManifestUploadPanel.pendingVersion.test.tsx` — 3 passed
- `ConversationMainPane.prechosenFramework.test.tsx` — 2 passed
- `ManifestUploadPanel.test.tsx` — 8 passed
- `VersionedAnswerControl.test.tsx` — 9 passed
- `ConversationMainPane.answerControls.test.tsx` — 7 passed
- `ConversationMainPane.contextLeadIn.test.tsx` — 2 passed
- `ConversationMainPane.resolvedTurns.test.tsx` — 3 passed
- `ConversationMainPane.autoScroll.test.tsx` — 2 passed

Frontend total: **8 suites, 36 tests, all passing.**

#### Frontend scoped typecheck
Whole-repo `tsc` is pre-existingly RED (552 errors — the known main baseline). Filtered
to the spec's touched SOURCE files, there are **zero** new tsc errors. The only tsc errors
matching the touched-area glob fall in two files NOT modified by this spec
(`ConversationMainPane.answerControls.test.tsx`, `ManifestUploadPanel.servicePicker.test.tsx`),
which pass partial props against an unchanged `ConversationMainPaneProps` interface — i.e.
part of the pre-existing red baseline, not regressions. `prechosenFramework` was added as an
OPTIONAL field on `PendingQuestion`/`VersionedAnswerControlProps`, so no caller is broken.

---

## 6. Exhaustiveness Check

**Status:** ✅ Pass

- `turnShape.ts`: `pending-version-confirmations` added to all three places —
  `ConversationTurnKind` (`:90`), the `ConversationTurn` union (`:562`), and is covered
  by `assertExhaustiveTurnKind` (unchanged `(k: never)` signature `:571`).
- The closed union is now 21 kinds; `openPhaseTurnShape.test.ts` asserts the count and
  that an exhaustive switch compiles + the guard throws off-union.
- Gateway `tsc --noEmit` is clean, proving no `switch`/consumer of the union lost
  exhaustiveness.

---

## 7. Mojibake Check

**Status:** ✅ Pass

Scanned all 17 touched gateway + frontend source/test files:
- No U+FFFD replacement characters.
- No `Ã` / `â€` byte-sequence mojibake.
- Em-dashes intact (`ManifestUploadPanel.tsx` uses `&mdash;` in the read-only JSX note and
  literal `—` in comments; 15 occurrences verified). Arrows/quotes intact.

---

## 8. Gaps / Follow-ups

1. **Reconcile the stale end-to-end test (action required).** `manifestComprehensiveEndToEnd.test.ts`
   (~lines 209-226) still asserts `db.engine` and `service.runtime` appear in `writtenCodes`.
   The implementation intentionally diverts these inferred family-only version-unknown
   candidates to the pending set (as the updated unit test confirms). Update the end-to-end
   test to assert these two codes are in `pendingVersionConfirmations` (and to assert the
   Tier-2 free-fact / other lanes unchanged). No production-code change is needed for this item
   if the diversion of inferred family-only candidates is the desired product behaviour.
2. **Design confirmation worth a sanity check:** the diversion rule treats ALL versioned
   (non-single-choice) version-unknown candidates as pending regardless of provenance, so
   INFERRED family-only inferences (`db.engine` = engine family from a driver, `service.runtime`
   from the cascade seed) now become "confirm the version" pending questions. This matches the
   literal spec text ("each candidate whose version === VERSION_UNKNOWN ... SKIP"), and the
   implementer codified it in the unit tests, but it is a behaviour the comprehensive test had
   previously locked in differently. If asking the user to confirm a version for an inferred
   engine/runtime is undesirable, the diversion predicate would need to exclude inferred
   provenance — flagging for product confirmation.
3. **Missing implementation reports.** No `implementation/*.md` task-group reports were produced.
4. **Pre-existing failures (not this spec):** 8 `migrationBookOfWork*` failures and the
   552-error whole-repo frontend tsc baseline remain red on main — out of scope here.
5. **Test artefact:** running the gateway pending-persistence tests created an untracked
   `gateway/threads/target-state-conversation/` directory (thread.json fixtures). Confirm it is
   git-ignored / cleaned so it does not get committed.
