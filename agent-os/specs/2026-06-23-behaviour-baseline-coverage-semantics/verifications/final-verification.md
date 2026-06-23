# Verification Report: Semantics-aware API Behaviour Baseline coverage

**Spec:** `2026-06-23-behaviour-baseline-coverage-semantics`
**Date:** 2026-06-23
**Verifier:** implementation-verifier
**Status:** PASSED

---

## Executive Summary

The spec is fully implemented across all three services and conforms to all 8 settled
decisions. The headline data-loss fix is in place: `selectCanonicalCapture` is now
body- and config-aware and only returns `null` (the reject-all branch) when there is no
usable oracle at all, so a legacy API's non-REST responses (200-for-missing,
500-for-bad-input, 200-for-no-auth) now reach the baseline instead of being reject-hidden.
All scoped, spec-mandated test runs pass: amvs **23 suites / 126 tests**, amvs
`tsc --noEmit` **0 errors**; AMS capture-session suite **17 tests / 0 failures** plus a
clean `mvn compile`; frontend **21 scoped vitest tests**, **0 new tsc errors** (total held
at the pre-existing 538 baseline), and **0 eslint errors** (the 4 warnings are all
pre-existing on untouched exports). No mojibake in any touched file; the big files were
edited surgically, not rewritten.

Per the spec's CRITICAL BUILD CONSTRAINTS, verification was performed per-service with
scoped runs (the frontend whole-repo build is pre-existingly red); a single whole-repo
suite is explicitly NOT the gate for this multi-service spec. Final real-world validation
remains the user re-running capture on a separate machine (live run data was never
inspected, as the spec requires).

---

## 1. Tasks Verification

**Status:** All Complete

### Completed Tasks
- [x] Task Group 1: `responseSemantics.ts` — pure classifier + default vocabulary
  - [x] 1.1–1.5 (tests, editable default vocabularies, per-API config + resolver + sentinel, `classifyObservedBehaviour`, scoped run)
- [x] Task Group 2: Canonical-selection precedence + stop the data loss
  - [x] 2.1–2.5 (tests, body into selector, precedence c→b→a, reject-all-on-no-match replaced, scoped run)
- [x] Task Group 3: Scorer rewire + observations + 5xx anomaly + `auth` bucket
  - [x] 3.1–3.5 (tests, `auth` bucket, semantics-aware scorer, non-scoring observations channel, scoped run)
- [x] Task Group 4: Config-persistence investigation (Decision 8) + plumbing
  - [x] 4.1–4.4 (tests, persistence-seam decision, config threaded into orchestrator, both-ends verification)
- [x] Task Group 5: Capture-wizard config step + observations panel + system-hidden reveal
  - [x] 5.1–5.6 (tests, config step, wizard wiring + persist, observations view, reviewer reveal, isolated verification)
- [x] Task Group 6: Test review & gap analysis
  - [x] 6.1–6.4 (review, gap analysis, strategic tests, scoped run)

All six task groups were already marked `- [x]` in `tasks.md`. Each was independently
re-verified against the code (signatures, branch behaviour, field plumbing, UI surfaces)
and the scoped test runs below; no checkbox required correction.

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** Issues Found (non-blocking)

### Implementation Documentation
- The `implementation/` subfolder exists but is EMPTY — no per-task-group implementation
  reports were written.

### Verification Documentation
- This report: `verifications/final-verification.md` (the `verifications/` folder did not
  exist prior to this run and was created).

### Missing Documentation
- No per-task implementation reports under
  `agent-os/specs/2026-06-23-behaviour-baseline-coverage-semantics/implementation/`.
  This does not affect the correctness of the implementation (verified directly against
  source + scoped tests) but is noted as a documentation gap. Decision 8's persistence
  decision (additive AMS field) is, however, recorded inline — in the tasks.md TG4 notes,
  the changeset 196 header, the master-changelog comment block, and the entity/DTO Javadoc.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` covers only the architecture meta-model / diagram-editor
product (Phases 1–5: JSON CRUD, diagram rendering/editing, backend/multi-user). It
contains no item describing API Behaviour Baseline capture, coverage semantics, or
migration validation — that workstream is tracked via specs, not this roadmap. No item
matches this spec, so no checkbox was changed.

---

## 4. Test Suite Results

**Status:** All Passing (scoped, per the spec's mandated per-service method)

### Test Summary (per service)

**amvs (`api-migration-validation-service`, Jest)** — `npx jest "(responseSemantics|captureSessionCanonical|oracleCoverageScoring|captureSession)"`
- **Test Suites:** 23 passed, 23 total
- **Tests:** 126 passed, 126 total
- **Failing / Errors:** 0
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**

**AMS (`architecture-model-service`, Maven)** — `mvn -q -Dtest='*ApiBehaviourCaptureSession*' test`
- `mvn -q -DskipTests compile` → success (no output / no errors)
- Per-class surefire results (total **17** tests, 0 failures, 0 errors, 0 skipped):
  - `ApiBehaviourCaptureSessionGlobalControllerTest` — 2
  - `ApiBehaviourCaptureSessionBehaviourSemanticsConfigTest` (NEW) — 2
  - `ApiBehaviourCaptureSessionCoverageSummaryTest` — 3
  - `ApiBehaviourCaptureSessionDataTypeDefaultsTest` — 2
  - `ApiBehaviourCaptureSessionGlobalListTest` — 3
  - `ApiBehaviourCaptureSessionKindAndPairingServiceTest` — 4
  - `ApiBehaviourCaptureSessionMultiPatchTest` — 1

**frontend (React/TS, Vitest)** — scoped `npx vitest run` on new + edited test files
- **Test Files:** 5 passed, 5 total
- **Tests:** 21 passed, 21 total
  - `CoverageSummaryPanel.observations.test.tsx` — 3
  - `BehaviourSemanticsConfigStep.test.tsx` — 5
  - `StartCaptureSessionWizard.discoveryContext.test.tsx` — 5
  - `StartCaptureSessionWizard.dataTypeFormats.test.tsx` — 5
  - `CaptureReviewPanel.systemHidden.test.tsx` — 3
- `npx eslint <feature files> --max-warnings 0` → **0 errors**, 4 warnings (all pre-existing — see Notes)
- `npx tsc --noEmit 2>&1 | grep -E "<feature files>"` → **nothing** (0 new tsc errors on feature files)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **538** (held exactly at the pre-existing baseline; did not rise)

**Combined feature totals:** 164 tests passing (126 amvs + 17 AMS + 21 frontend), 0 failures, 0 errors.

### Failed Tests
None — all scoped feature suites pass.

### Notes
- The whole-application test suite was intentionally NOT run as a single gate. The spec's
  CRITICAL BUILD CONSTRAINTS state the frontend whole-repo `tsc`/lint is pre-existingly RED
  (~538 errors in unrelated files) and that amvs/AMS are verified via scoped runs. The
  per-service scoped runs above are the prescribed verification.
- The 4 frontend eslint WARNINGS (0 errors) are all pre-existing on untouched exports and
  acceptable per the task definition:
  - `StartCaptureSessionWizard.tsx:707` `react-hooks/exhaustive-deps` (`step3` dep) —
    `git log -L` traces this region to the merge "Initial commit" (cf907db, 2026-06-15),
    pre-dating this spec.
  - `CoverageSummaryPanel.tsx:203/241/258` `react-refresh/only-export-components`
    (`parseCoverageSummary` / `isThinEndpoint` / `formatScorePct`) — `git log -L` traces
    these helper exports to b7632a2 (2026-06-18), pre-dating this spec. The rule fires on
    the file's long-standing mixed component+helper export shape, not on any export added
    here.
- No NEW eslint errors or warnings were introduced by the spec's edits.

---

## 5. Per-Service Integrity & Spec Conformance Evidence

### amvs integrity (anti-clobber)
- `captureSessionOrchestrator.ts` is **1768 lines** (consistent with the expected ~1700+);
  not truncated/rewritten. Exports intact: `selectCanonicalCapture` (601),
  `scoreEndpointCoverage` (772), `assembleCoverageSummary` (852),
  `orchestrateCaptureSession` (1273).
- NEW module `src/services/responseSemantics.ts` exists (16,126 bytes) and is **pure**:
  zero `import`/`require` of `captureSessionOrchestrator` (the only mentions are header
  comments asserting the one-way dependency). The orchestrator imports it
  (`from './responseSemantics'`, lines 29–32), never the reverse.
- `ScenarioExpectedStatus` now includes `'auth'`: `'success' | 'not_found' | 'client_error' | 'auth'` (552).
- `selectCanonicalCapture(captures, expectedStatus, config?)` takes a body
  (`{ captureId; status; body? }`, 602) **and** config (604); precedence (b) intent-match
  then (a) last usable oracle, returning `null` ONLY when no usable oracle exists (625–633).
- Data-loss fix: the no-match reject branch (`else` at 1602) fires only when `canonical`
  is falsy (no usable oracle); the canonical-chosen path (1593) still reject-hides only the
  NON-canonical fumbles via `safeRejectNonCanonicalCapture` + `NON_CANONICAL_REVIEWER_NOTE`
  (579) — fumble-dedup preserved.
- One-line config threading reads `session.behaviourSemanticsConfigJson` (1320–1321) and
  feeds `semanticsConfig` into both `selectCanonicalCapture` (1575) and
  `scoreEndpointCoverage` (1675).
- Mojibake check on both amvs files: clean.

### AMS additive field (Decision 8 = option ii, recorded)
- NEW Liquibase changeset `196-capture-behaviour-semantics-config.sql` exists; adds nullable
  `behaviour_semantics_config_json jsonb NULL`, forward-only, NULL = built-in defaults —
  mirrors 195's structure and rationale.
- Registered in `db.changelog-master.yaml` immediately after 195 (195 @ 4471, 196 @ 4516)
  with the `not columnExists` precondition idiom (MARK_RAN / HALT), mirroring 189/194/195.
- Sibling field `behaviourSemanticsConfigJson` added next to `dataTypeDefaultsJson` in:
  entity (`@Type(JsonType)` + `@Column(... jsonb)`, 322–324), DTO (121), Update request
  (106), mapper (`ApiBehaviourMapper.java:83`), service (null-guarded PATCH, 302–304).
- Snake_case wire, **NO `@CamelCaseWire`** annotation (the `@CamelCaseWire` text in the
  files is Javadoc explicitly documenting the snake_case decision, not an annotation).
- `mvn -q -DskipTests compile` succeeds. Mojibake check on all AMS files: clean.

### frontend (isolated)
- NEW `behaviourSemanticsConfig.ts` (mirror) has **zero** `import`/`require` lines — a pure
  standalone constants/types module; no amvs import (references to `responseSemantics.ts`
  are doc-comments noting it is a verbatim mirror).
- NEW `BehaviourSemanticsConfigStep.tsx` (+ co-located test) present; wired into
  `StartCaptureSessionWizard.tsx` (import @66, rendered @2220) and persisted via
  `updateCaptureSession(... { behaviour_semantics_config_json: ... })` then `setStep(7)`
  (909–913).
- `CoverageSummaryPanel.tsx`: reframed metric "Behaviour observed/captured: ..." (321) plus
  a separate NON-SCORING "Observations / REST-convention deviations" list
  (`observations: string[]`, 107; rendered @402); display-only.
- `CaptureReviewPanel.tsx`: `isAutoRejectedFumble` (315) + `visibleCaptures` filter (481)
  intact; NEW collapsed "Show N system-hidden captures" reveal (`showHiddenCaptures` =
  `useState(false)`, 378; toggle @1381) over a `hiddenCaptures` complement (491) with a
  re-accept affordance.
- `apiBehaviourClient.ts`: `behaviour_semantics_config_json?` on the relevant DTO request
  types (197, 223, 254).
- `SaveAsBaselineModal.tsx`: `accepted === true` filter UNCHANGED (`acceptedCaptures` memo,
  ~157); `canSubmit` (364) ignores the coverage score — no new gate.
- Mojibake check on all edited frontend files: clean.

### Spec conformance — 8 settled decisions
1. Semantics-aware selection precedence + data-loss fix — CONFIRMED (selector 601–633;
   reject branches 1593/1602).
2. Body-aware coverage + per-API config — CONFIRMED (`classifyObservedBehaviour` consumed
   by selector & scorer; config resolver + sentinel in `responseSemantics.ts`).
3. 5xx crash safe-default — CONFIRMED (`allNullOrServerError` seam 739–745; unrecognized
   5xx stays NOT achieved with crash anomaly surfaced).
4. `auth` bucket — CONFIRMED (`classifyExpectedFromName` routes `auth` @1024 before
   `client_error`; "no auth enforced" emitted as observation @791–798; `runAuthNegativeProbes`
   untouched).
5. Reframed % + non-scoring observations — CONFIRMED (observations deduped @866–872, never
   in `overall_score`/`dimensions_achieved`; frontend reframed display + list).
6. Reviewer show-hidden + re-accept — CONFIRMED (CaptureReviewPanel reveal, collapsed by
   default).
7. Forward-only — CONFIRMED (NULL = built-in defaults, no backfill; changeset 196 adds a
   nullable column with no data migration).
8. Config persisted via the additive field — CONFIRMED (changeset 196 + entity/DTO/mapper/
   service + wizard PATCH via `behaviour_semantics_config_json`).
- Coverage stays DISPLAY-ONLY (no new gate) — CONFIRMED (`SaveAsBaselineModal.canSubmit`
  ignores score; CoverageSummaryPanel display-only).
- Fumble-dedup preserved — CONFIRMED (canonical-chosen path still reject-hides non-canonical
  captures).

---

## Caveats

- **Pre-existing frontend baseline:** the frontend whole-repo `tsc` is red at ~538 errors
  in unrelated files (lint debt). This is a known pre-existing condition; this spec adds
  0 new tsc errors and 0 new eslint problems. Verified strictly in isolation per the spec.
- **Real-world validation pending:** final validation is the user RE-RUNNING capture on a
  separate machine. Per the spec, live run data was NOT inspected as a verification step;
  correctness here is established via deterministic unit/integration fixtures only.
- **Missing implementation reports:** the `implementation/` folder is empty (documentation
  gap only). The Decision-8 persistence rationale is nonetheless recorded inline (tasks.md
  TG4 notes, changeset 196 header, master-changelog comment, entity/DTO Javadoc).
