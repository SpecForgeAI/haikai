# Verification Report: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery save-back

**Spec:** `2026-06-20-skipped-candidate-visibility-bulk-fill`
**Date:** 2026-06-21
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

The feature is fully implemented end-to-end across all five stacks (mcp-server, AMS, gateway, frontend API, frontend UI). Every one of the 8 task groups is marked complete in `tasks.md` and was independently spot-checked against the actual code; every acceptance criterion and every cross-cutting invariant (a)-(g) holds. All 58 feature tests pass on a clean re-run (mcp-server 21, AMS 11, gateway 6, frontend 20). Type-checking is clean on every feature SOURCE file across all three TS stacks; the only TS errors found are the pre-existing, project-wide `Cannot find name 'global'` test-config artifact the task brief explicitly classified as pre-existing. The mojibake sweep is zero across all seven edited existing files.

**Overall verdict: PASS.** No code was modified during verification.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 8 task groups and every sub-task are marked `- [x]` in `tasks.md`, and each was corroborated against the actual implementation (no checkbox was taken on faith).

### Completed Tasks
- [x] Task Group 1: Reason arm + reused-subclass classification + business_logics qualifier + dry-run mode (`candidateSaveBackService.ts`)
  - [x] 1.1 Focused tests (`candidateSaveBackReasonArm.test.ts`)
  - [x] 1.2 `SaveBackReasonEntry` type + `reasons[]` on `SaveBackResult` (incl. early-return path)
  - [x] 1.3 Arm populated at every skip/reuse/create site; reused split intra-scan / pre-existing / already-saved
  - [x] 1.4 business_logics `<class>.<method>` on-collision qualifier before bare-name dedup
  - [x] 1.5 `commit=false` dry-run execution mode
  - [x] 1.6 Group tests run
- [x] Task Group 2: Linked Findings for Blocked + Quality-gap (`candidateSaveBackService.ts`)
  - [x] 2.1 Tests (`candidateSaveBackFindings.test.ts`)
  - [x] 2.2 Finding payloads via existing `saveBackFindings[]` -> `bulkCreateDiscoveryFindings`, `target_type='discovery_candidate'`, evidence_gap gapTypes
  - [x] 2.3 Emission gated behind `commit`
  - [x] 2.4 Group tests run
- [x] Task Group 3: AMS bulk-candidate-edit endpoint (`DiscoveryCandidateController.java`, `DiscoveryCandidateService.java`, new DTOs)
  - [x] 3.1-3.5 Tests, DTOs, controller endpoint, atomic service method, group tests
- [x] Task Group 4: Gateway bulk-edit proxy + save-approved `commit` passthrough (`routes/discovery.ts`)
  - [x] 4.1-4.4 Tests, route registration, `commit=false` threading, group tests
- [x] Task Group 5: Frontend API client wrappers + result types (`api/discoveryApi.ts`)
  - [x] 5.1-5.5 Tests, extended `SaveApprovedResult`, `updateCandidate`, `bulkCandidateEdit` + `previewSaveApprovedCandidates`, group tests
- [x] Task Group 6: Honest breakdown chip (`DiscoveryBreakdownChip.tsx` + `DiscoveryRunDetailPage.tsx`)
  - [x] 6.1-6.5 Tests, taxonomy tokens, intra-scan advisory, click-to-open wiring, group tests
- [x] Task Group 7: C1 group-by-missing-field remediation panel (`CandidateBulkFillPanel.tsx`, `candidateBulkFillSupport.ts`, page wiring)
  - [x] 7.1-7.8 Tests, panel, per-group widgets + override + skip, dry-run preview, Fix & Save + manual path, collision fallback group, page wiring, group tests
- [x] Task Group 8: Test review and gap analysis (feature-only)
  - [x] 8.1-8.4 Review, gap analysis, up to 10 strategic tests (headline thread H1/H2/H3), feature-test run

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** ⚠️ Minor (no per-group implementation reports on disk)

### Implementation Documentation
The `agent-os/specs/2026-06-20-skipped-candidate-visibility-bulk-fill/implementation/` folder exists but is EMPTY (no per-task-group implementation reports were written). This is a documentation-artifact gap only; it does NOT affect the implementation, which is fully present and tested in the codebase. Each task group's completion was instead verified directly against source + tests.

### Verification Documentation
- This report: `agent-os/specs/2026-06-20-skipped-candidate-visibility-bulk-fill/verifications/final-verification.md`

### Missing Documentation
- Per-group implementation reports (Severity: LOW — informational only; all work is evidenced in code + passing tests).

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

No `agent-os/product/roadmap.md` entry matches this spec's scope (the spec is a discovery save-back transparency + bulk-fill enhancement; it is tracked as a standalone spec, not a roadmap milestone item). No roadmap checkboxes required flipping.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (feature scope)

Per the spec's explicit guardrails (write only focused per-group tests; never run the whole suite), verification re-ran the FEATURE test surfaces named in the task brief across all five stacks. All pass.

### Test Summary (feature scope, independently re-run)
- **Total Tests:** 58
- **Passing:** 58
- **Failing:** 0
- **Errors:** 0

| Stack | Command | Result |
|-------|---------|--------|
| mcp-server | `npx jest candidateSaveBackReasonArm candidateSaveBackFindings candidateSaveBackHeadlineThread saveApprovedCandidatesRoute` | 4 suites, **21 passed** |
| AMS | `mvn -o -Dtest='DiscoveryCandidateBulkEdit*' test` | **11 passed** (4 controller + 7 service), BUILD SUCCESS |
| gateway | `npx jest discovery-bulk-edit-proxy` | **6 passed** |
| frontend | `npx vitest run discoveryApi.bulkEdit + DiscoveryBreakdownChip + CandidateBulkFillPanel` | 3 files, **20 passed** |

### Type-checking (`npx tsc --noEmit`)
- **mcp-server:** clean (no output; full compile passes).
- **gateway:** zero errors in feature files.
- **frontend:** zero errors in any feature SOURCE file (`discoveryApi.ts`, `DiscoveryBreakdownChip.tsx`, `CandidateBulkFillPanel.tsx`, `candidateBulkFillSupport.ts`, `DiscoveryRunDetailPage.tsx`). The new test file `discoveryApi.bulkEdit.test.ts` emits only `error TS2304: Cannot find name 'global'` — a PRE-EXISTING, project-wide pattern also present in the sibling pre-existing tests `discoveryApi.gapFill.test.ts` and `discoveryApi.test.ts`, and explicitly classified as pre-existing in the task brief. No NEW feature type errors.

### Mojibake sweep (`â€"` and variants)
Zero hits across all seven edited existing files: `candidateSaveBackService.ts`, `saveApprovedCandidatesRoute.ts`, AMS `DiscoveryCandidateController.java` + `DiscoveryCandidateService.java`, gateway `routes/discovery.ts`, `frontend/src/api/discoveryApi.ts`, `DiscoveryRunDetailPage.tsx`.

### Notes
The full application test suite was intentionally NOT run, per the spec's non-negotiable guardrail ("run ONLY this group's / this feature's tests; do NOT run the entire application test suite"). The feature scope is fully green.

---

## 5. Per-Group Acceptance Checks (spot-checked against actual code)

| Group | Acceptance | Result | Evidence |
|-------|-----------|--------|----------|
| 1 | Reason arm rides `SaveBackResult`, populated at every site; reused classified | ✅ | `reasons: SaveBackReasonEntry[]` (svc L279); created/reused pushes (L2833-2856); already-saved pre-loop (L2400-2402) |
| 1 | BLOCKED + quality-gap carry reason + missingField | ✅ | `recordBlocked` (L2572-2584); quality-gap detection (L3613-3668) |
| 1 | Two distinct-class methods survive qualified; same-class collapses | ✅ | qualifier block (L2483-2518); test H2 asserts both |
| 1 | `commit=false` persists nothing, returns projection | ✅ | `commit` flag (L2302); all 5 persistence calls gated |
| 1 | suppressed/possible/candidateActions retained | ✅ | interface L242-270 |
| 2 | Blocked + quality-gap emit findings linked `discovery_candidate` via bulkCreate path | ✅ | `buildCandidateGapFinding` (L1901-1931); fold (L3862-3888) |
| 2 | Best-effort + skipped under `commit=false`; no `skip_reason` column | ✅ | try/catch + `if (commit)` (L3890-3903); grep confirms no skip_reason |
| 3 | Atomic bulk-edit mirrors bulkReviewCascade; field + data patches | ✅ | `@PostMapping("/bulk-edit")` (ctrl L215); `@Transactional bulkEdit` (svc L606) |
| 3 | data JSONB patch round-trips; DTOs snake_case | ✅ | `data.putAll` overlay (svc L668); no `@CamelCaseWire` on DTOs |
| 4 | Bulk-edit route proxies to AMS; `commit` flows through save-approved | ✅ | proxy (gw L1560-1574); `commit` thread (gw L1739-1742) |
| 5 | `SaveApprovedResult` carries arm + dup arrays; 3 wrappers correct URLs | ✅ | interface (api L697-723); `previewSaveApprovedCandidates`/`updateCandidate`/`bulkCandidateEdit` |
| 6 | Chip renders taxonomy tokens; intra/pre/already distinguished; advisory | ✅ | `computeBreakdownCounts` (chip L118-172); advisory (L259-272) |
| 7 | Panel groups by field; bulk-set + override + skip; preview; Fix & Save + manual | ✅ | `groupAffectedCandidates`; preview (L196); Fix & Save (L241); Apply-only (L235) |
| 7 | business_logics collision fallback group present + bulk-resolvable | ✅ | `isCollisionFallbackEntry` + fallback group (support L138-188) |
| 8 | Headline blocked->surface->fill->preview->commit + BL two-survive covered | ✅ | H1/H2/H3 in `candidateSaveBackHeadlineThread.test.ts` |

---

## 6. Cross-Cutting Invariant Checks

**(a) Reason arm captures Blocked (with missingField) AND classifies reused; dup arrays retained.** ✅
`recordBlocked` stamps `reason:'blocked'` + `missingField` (svc L2572-2584). Reused split: intra-scan vs pre-existing via the `preExistingNamesByArray` snapshot (svc L2826-2838), already-saved pre-loop (svc L2400-2402). `suppressedDuplicates[]` / `possibleDuplicates[]` remain on the result (svc L242-248, folded L3928-3945).

**(b) business_logics: two same-named methods in DIFFERENT classes survive as TWO `<class>.<method>` rows; same-name+same-class collapses.** ✅
Qualifier (svc L2483-2518) only fires when `distinctClasses.size >= 2`; rewrites each to `<class>.<method>`; same-class pair qualifies identically and still collapses; no-class-context candidates left unqualified for the C1 fallback. Test H2 asserts `['OrderService.process','PaymentService.process']` survive (2 created) while the same-class `OrderService` dup collapses to an intra-scan reuse under the qualified name.

**(c) `commit=false` persists NOTHING; MCP route threads `commit` (defaults to commit when absent).** ✅
All persistence gated on `commit`: `putModel` phase 1 (svc L3716), phase 2 (L3760), `updateCandidate` candidate transition (L3786), `bulkCreateCandidateEntityMappings` (L3823), `bulkCreateDiscoveryFindings` (L3892). Route threads `commit !== false` (route L98); gateway computes `commit = !(rawCommit===false||'false')` (gw L1742). Test H3 asserts only the committing run persists.

**(d) Blocked + Quality-gap emit a linked `discovery_finding` (`target_type='discovery_candidate'`); NO `skip_reason` column.** ✅
`buildCandidateGapFinding` sets `links:[{ targetType:'discovery_candidate', ... }]` + evidence_gap gapType (svc L1908-1930). Findings test asserts `links[0].targetType === 'discovery_candidate'` for both classes. grep confirms NO `skip_reason`/`skipReason` in the AMS entity or any feature file.

**(e) AMS bulk-edit is atomic (one `@Transactional`, all-or-nothing) and applies `data` as a partial overlay.** ✅
Single `@Transactional bulkEdit` (svc L606); a null/unknown/cross-run id throws and rolls back the whole batch (L627-638). `data` overlay = defensive copy + `putAll(patch.data())` (L664-670), so omitted keys are preserved. Service test 1 asserts overlay-merge preservation; tests 4 + 5 assert the bad id is never saved.

**(f) Frontend: chip renders taxonomy from `result.reasons` with clickable tokens + intra-scan advisory; C1 panel groups by field with override + skip, server dry-run preview, Fix & Save (bulk-edit then real save), plain re-Save intact.** ✅
Chip folds `reasons` by class (chip L135-164), tokens are real `<button>`s for actionable classes (L230-243), advisory `role="note"` (L259-272). Panel groups via `groupAffectedCandidates`, per-group dropdown/typeahead/free-text, per-row override (L424) + skip (L410), server preview via `previewSaveApprovedCandidates` (L196-210), Fix & Save = `bulkCandidateEdit` then `saveApprovedCandidates` (L241-262). The page's "Save Remaining Approved / Save All Approved" button is untouched (page L720-724); the panel's "Apply edits" path keeps the manual re-Save flow.
Minor note (see Issues): only the two actionable classes (blocked / quality_gap) render as clickable buttons; the informational classes render as non-clickable badges.

**(g) Non-goals respected.** ✅
No C2 grid / C3 inline-row. No architecture-grid integration (the panel lives in the Candidates tab; reuses the Grid CELL `FreeTextTypeaheadSingleToken`, not the Grid container). No general merge/dedup overhaul beyond the business_logics qualifier. No save-back algorithm change beyond reason arm + dry-run + qualifier. `DiscoveryCandidateTable.tsx` is unchanged (git status clean) — no new per-row checkboxes. No `skip_reason` column.

---

## 7. Issues (severity-rated)

1. **LOW — Missing per-group implementation reports.** The `implementation/` folder is empty; no `N-<task>-implementation.md` files were written. Informational only — all work is evidenced in source + 58 passing tests. No action required for correctness.

2. **LOW — Spec wording vs. chip behaviour: only actionable classes are clickable.** The spec says "Each non-zero class renders as a clickable token; clicking opens the C1 panel." The implementation renders ALL non-zero classes as tokens but makes only the two REMEDIABLE classes (`blocked`, `quality_gap`) clickable buttons; informational classes (created / the three reuse sub-classes / suppressed / possible) render as non-clickable badges. This is a sound design choice (the C1 panel can only remediate blocked + quality-gap; opening it scoped to e.g. "created" would show an empty panel — and `groupAffectedCandidates` confirms only `ACTIONABLE_REASONS` produce groups). Functionally correct and the more honest UX; flagged only as a literal-wording deviation. No action required.

3. **LOW — C1 preview is a pre-edit baseline.** The panel's dry-run preview (`previewSaveApprovedCandidates`) reflects the run's CURRENT persisted state, not the staged-but-unapplied edits (documented inline in the component, L188-194). "Fix & Save" applies edits first then re-runs the real save, so the committed outcome is correct; the preview is an honest "what still blocks today" baseline rather than a "what-if-these-edits-applied" projection. Matches the as-built test expectations (H3 covers true preview/commit parity at the service layer). Acceptable for v1; no action required.

No HIGH or MEDIUM severity issues. No defects in feature behaviour.

---

## Conclusion

**PASS.** All 8 task groups are complete and verified against the actual code; all seven cross-cutting invariants hold; all 58 feature tests pass on an independent re-run; type-checking and the mojibake sweep are clean on all feature files. The three issues are LOW-severity (one documentation gap, two benign as-built-vs-literal-wording notes) and require no remediation for the feature to be correct and shippable.
