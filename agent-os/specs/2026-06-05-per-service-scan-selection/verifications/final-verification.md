# Verification Report: Per-Service Scan Selection (Half A)

**Spec:** `2026-06-05-per-service-scan-selection`
**Date:** 2026-06-05
**Verifier:** implementation-verifier
**Status:** ⚠️ Passed with Issues

---

## Executive Summary

The spec is functionally implemented end-to-end and the feature tests all pass.
The N-run `SelectedScanSet` shape replaces the retired 2-run `SelectedScanPair`
field-for-field across the gateway and the frontend mirror; the gateway threads
the full run-id set with `primaryRunId` preserved as the path/thread anchor; the
discovery-service `review-model` route is relaxed (2-run cap and same-kind
rejection removed, existence/arch/self-reference guards kept) so a 2-code + 1-DB
selection is accepted into the UNCHANGED `buildReviewModel`; and the frontend
picker groups by service with an "Unassigned scans" bucket, the snapshot
camelCase/snake_case read reconciled. Scope adherence is clean: no AMS change, no
`buildReviewModel` backbone change, the snapshot WRITE untouched.

Two genuine issues, both test-hygiene rather than product defects: (1) the new
`deriveServiceTier.test.ts` adds 25 net `tsc`-only errors (all `Cannot find name
'describe'/'it'/'expect'` — the file omits the `import ... from 'vitest'` that
suppresses them; the tests run + pass), so the "net-zero new tsc" criterion is
NOT met and the implementer's reported "net -3" is inaccurate — it is net +25
(all test-global noise, zero in production files); and (2) the relaxation left
two now-obsolete assertions in the sibling `reviewModelEndpoint.test.ts` (the old
"reject two same-kind"/"reject >2 runs" cases) failing, because they assert the
exact behaviour this spec deliberately removed — they should have been updated or
deleted alongside Group 3.

---

## 1. Tasks Verification

**Status:** ✅ All Complete (all 4 groups + 38 sub-tasks marked `- [x]`; independently confirmed against code)

### Completed Tasks

- [x] **Task Group 1: `SelectedScanSet` N-run shape + `deriveServiceTier` helper**
  - [x] 1.1 Focused tests for `deriveServiceTier` + shape (9 tests in `deriveServiceTier.test.ts`, incl. a `SelectedScanSetWire` round-trip)
  - [x] 1.2 Gateway `SelectedScanSet` replaces `SelectedScanPair` (`reviewTurnShape.ts:77-92`); `OpenTurn.scanPair: SelectedScanSet` (`:159`); the `primaryScanKind !== secondScanKind` assumption removed from the doc
  - [x] 1.3 Frontend `SelectedScanSetWire` mirror, field-for-field (`discoveryReviewApi.ts:87-94`)
  - [x] 1.4 Pure `deriveServiceTier(service, appComponentsById)` (`deriveServiceTier.ts`): two-hop nullable walk, `tech_type` → `'UI'|'Service'|'Persistence'`, every miss → `'Unknown'`, never throws
  - [x] 1.5 Shared tests pass (verified — see §4)
- [x] **Task Group 2: Thread the set + widen the counts proxy**
  - [x] 2.1 Gateway route/proxy tests (3 new cases in `discovery-review-conversation-routes.test.ts`; the >1-extra forward case in `discovery-review-model-proxy.test.ts`)
  - [x] 2.2 `parseScanPair` returns `SelectedScanSet`, back-fills `primaryRunId` into `runs[]`, dedupes (`discoveryReviewConversation.ts:247-271`)
  - [x] 2.3 `startReview`/`/answer`/`/capture`/`/confirm`/`loadReviewConversation` keep `:runId = primaryRunId`; the set rides in the payload
  - [x] 2.4 `fetchReviewModel({ additionalRunIds })` emits one repeated `secondRunId=` per extra (`discoveryReviewConversation.ts:185-213`)
  - [x] 2.5 `review-model` proxy forwards the full repeated array verbatim, no cap (`discovery.ts`)
  - [x] 2.6 Gateway tests pass (verified — see §4)
- [x] **Task Group 3: Relax the `review-model` route's 2-run cap (route only)**
  - [x] 3.1 Route-relaxation tests (3-run accept, same-kind accept, surviving-guard rejects) in `reviewModelEndpoint.twoRun.test.ts`
  - [x] 3.2 Two-run cap (old `rawSecond.length > 1 → 400`) deleted; `selectedRunIds = [runId, ...additionalRunIds]` with dedup (`runs.ts:707-732`)
  - [x] 3.3 Same-kind rejection + `kindsSeen` deleted; doc comment updated (`runs.ts:680-688, 768-773`)
  - [x] 3.4 Existence (404, `:743-748`), arch-mismatch (409, `:752-766`), self-reference (400, `:718-726`) guards KEPT; `buildReviewModel(runInputs)` called unchanged (`:791`)
  - [x] 3.5 Route-relaxation tests pass (verified — see §4)
- [x] **Task Group 4: Per-service picker + service-name display + snapshot fix**
  - [x] 4.1 Picker tests (20 tests in `DiscoveryReviewRoom.test.tsx`, `getReviewModel` GOTCHA handled)
  - [x] 4.2 Snapshot mismatch reconciled FRONTEND-side: `ServiceIdentitySnapshot` type aligned to camelCase with snake_case kept optional; `readSnapshotServiceName` reads `serviceName ?? service_name` (`discoveryApi.ts:222-229`); discovery-service WRITE untouched
  - [x] 4.3 `serviceById` + `appComponentsById` built from the cached model via `useArchitecture()` (`DiscoveryReviewRoom.tsx:337-352`)
  - [x] 4.4 Group-by-`service_id`, display-name precedence `services[].name` → snapshot `service_name` → `runLabel`, "Unassigned scans" bucket (`:144-196`)
  - [x] 4.5 `ScanSelection` reworked to one fieldset per service group; help text updated
  - [x] 4.6 Per-service selection map replaces `selectedCodeRunId`/`selectedDbRunId`
  - [x] 4.7 `handleBegin` assembles `SelectedScanSetWire`; deterministic `primaryRunId` (current `runId` if among picks else first pick) (`:428-441`)
  - [x] 4.8 `getReviewModelCounts` widened to the full additional set; `refetchCounts` passes it (`discoveryReviewApi.ts:513-534`; `DiscoveryReviewRoom.tsx:404-415`)
  - [x] 4.9 `open`-turn summary re-derived from `scanPair.runs[]` (`:206`)
  - [x] 4.10 Optional technology-tier label via `deriveServiceTier`; "Unknown" selectable (`:183`, `TIER_LABEL`)
  - [x] 4.11 Picker tests pass (verified — see §4)

### Incomplete or Issues

None of the task checkboxes are incomplete. Two cross-cutting acceptance items
are NOT fully met (carried into §4 / §6):
- **"No new `tsc` errors beyond the pre-existing baseline" (Groups 1.5 + 4.11
  acceptance):** NOT met — the new `deriveServiceTier.test.ts` adds 25 net `tsc`
  errors (test-global names only; production files add 0). See §4.
- **Sibling test left red by the relaxation:** Group 3 removed the two-run cap +
  same-kind rejection but did not update the obsolete `(c1)`/`(c2)` assertions in
  `reviewModelEndpoint.test.ts`, which now fail (they assert the removed
  behaviour). See §4 / §6.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found

### Implementation Documentation

- ❌ **No implementation reports exist.** `agent-os/specs/2026-06-05-per-service-scan-selection/implementation/` is empty — there are no per-group `implementation/N-*.md` write-ups. Verification was therefore performed directly against the code + tests rather than against implementer reports.

### Verification Documentation

- This report: `agent-os/specs/2026-06-05-per-service-scan-selection/verifications/final-verification.md`.
- No area-verifier documents were present.

### Missing Documentation

- All four task-group implementation reports are missing. The code itself is well-commented with explicit spec references, which materially aided verification, but the standard `implementation/` artifacts were not produced.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items

None.

### Notes

`agent-os/product/roadmap.md` contains no item matching this spec. This is an
internal Discovery Review Room wire-shape + picker refinement (the per-service
scan picker / N-run selection), not a roadmap-level capability. A filtered scan
for "per-service / scan select / scan picker / multi-service / tier-gating /
review scope / 2 code / review room" returned no candidate roadmap lines. No
roadmap edit was warranted.

---

## 4. Test Suite Results

**Status:** ⚠️ Some Failures (all pre-existing or intended-inverse; none from this spec's own suites)

### Feature tests (this spec's own suites — the load-bearing evidence)

| Stack | Suite(s) | Result |
| --- | --- | --- |
| gateway | `selectedScanSet.test.ts` | 2/2 pass |
| gateway | `discovery-review-model-proxy.test.ts` (incl. the >1-extra forward, no-cap case) | 5/5 pass |
| gateway | `discovery-review-conversation-routes.test.ts` (incl. 3 new per-service plumbing cases) | 8/8 pass |
| gateway | rename-regression: `reviewEngine` + `reviewConfirmSkip` + `reviewDefectFixes` + `reviewFamilyBulkIntent` | 24/24 pass |
| discovery-service | `reviewModelEndpoint.twoRun.test.ts` (incl. 3-run accept, same-kind accept, surviving-guard rejects) | 7/7 pass |
| frontend | `deriveServiceTier.test.ts` | 9/9 pass |
| frontend | `DiscoveryReviewRoom.test.tsx` | 20/20 pass |

All of this spec's newly-written and rename-impacted suites pass.

### Full suite — per stack

**Gateway (Jest):**
- **Total:** 2093 — **Passing:** 2020 — **Failing:** 73 — **Errors:** 0
- **Failing suites:** 42 (all pre-existing, all in untouched areas — LLM client / Azure-OpenAI / bootstrap / dashboardSummary / chatV2 / hub-bootstrap / discovery-decision-tasks / xlsx / transcript / promptComposer / registryLoader). These match the documented pre-existing baseline (project memory lists `bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`); the remainder are LLM-key/network-dependent and dashboard timeouts. None is a suite this spec touched.

**Discovery-service (Jest):**
- **Total:** 1552 (2 skipped) — **Passing:** 1548 — **Failing:** 2 — **Errors:** 0
- **Failing suites (2):**
  - `reviewModelEndpoint.test.ts` — 2 failing cases: `(c1) rejects two same-kind runs with a clear error` and `(c2) rejects more than two run ids with a clear error`, both `Expected 400, Received 200`. **These are the INTENDED INVERSE of this spec.** They are the old Spec-1 assertions for the two-run cap + same-kind rejection that Group 3 deliberately removed. They are obsolete and should have been updated/deleted in Group 3 (the replacement positive assertions live in `reviewModelEndpoint.twoRun.test.ts`). This is a test-hygiene gap, not a behavioural regression.
  - `archModelClientNewLayers.test.ts` — **passes 10/10 in isolation**; fails only under full-suite concurrency (a pre-existing flaky/parallel-resource issue, in an area this spec did not touch). Not attributable to this spec.

**Frontend (Vitest):**
- **Total:** 10125 — **Passing:** 9486 — **Failing:** 639 — **Errors:** 0 (639 fails across 230 suites)
- This is a large pre-existing failing baseline. Every failing suite observed is in an area this spec did NOT touch (`UnifiedChat/*`, `__tests__/routing/*`, `DiagramsView/SequenceEditor/*`, `DashboardView/*`); `git status` confirms none of those paths were modified by this spec. This spec touched only 7 Discovery files (`discoveryApi.ts`, `discoveryReviewApi.ts`, `DiscoveryReviewRoom.{tsx,test.tsx,module.css}`, `deriveServiceTier.{ts,test.ts}`), and both of this spec's frontend suites pass (29 tests). No frontend regression is attributable to this spec.

### Typecheck

| Stack | `tsc --noEmit` | Result |
| --- | --- | --- |
| gateway | exit 0 | ✅ CLEAN |
| discovery-service | exit 0 | ✅ CLEAN |
| frontend | 543 errors (baseline 518 with this spec's files stashed) | ⚠️ **net +25** |

**Frontend baseline detail (isolated stash-compare):** stashing this spec's 7
frontend files dropped the count from 543 → 518, so this spec adds **+25 net**
errors. All 25 are in `deriveServiceTier.test.ts` and are exclusively
`TS2582/TS2304 Cannot find name 'describe'/'it'/'expect'` — the file omits
`import { describe, it, expect } from 'vitest'` (the same shape another
in-flight spec's `resolveBulkActionSet.test.ts` exhibits). **The four production
files add ZERO new errors** (`deriveServiceTier.ts` 0, `DiscoveryReviewRoom.tsx`
0, `discoveryReviewApi.ts` 0, `discoveryApi.ts` 0). The tests run + pass under
Vitest, so this is a `tsc`-config artifact, not a real type defect — but it
breaches the literal "net-zero new `tsc`" acceptance criterion, and the
implementer's reported "net -3" is inaccurate (the isolated measurement is net
+25). One-line fix: add the `vitest` import at the top of
`deriveServiceTier.test.ts`.

### Failed Tests

- `reviewModelEndpoint.test.ts › (c1) rejects two same-kind runs with a clear error` — obsolete (asserts removed behaviour); should be updated/deleted.
- `reviewModelEndpoint.test.ts › (c2) rejects more than two run ids with a clear error` — obsolete (asserts removed behaviour); should be updated/deleted.
- `archModelClientNewLayers.test.ts` — passes in isolation; full-suite-concurrency flake, unrelated to this spec.
- Gateway 73 + frontend 639 — all pre-existing baseline failures in untouched areas (see above).

### Notes

DO NOT (per instruction) any failing test was fixed. The 2 discovery-service
failures are the only ones with a causal link to this spec, and that link is the
intended retirement of the old cap — flagged as a cleanup gap, not a regression.

---

## 5. End-to-End N-Run Consistency (critical checks)

- ✅ **Frontend sends `SelectedScanSet`:** `handleBegin` builds `runs[]` (`{runId, scanKind, serviceId}`) + a deterministic `primaryRunId` and posts via `startReview({ ... scanPair })` (`DiscoveryReviewRoom.tsx:428-441`).
- ✅ **Gateway parses + forwards:** `parseScanPair` → `SelectedScanSet` (`discoveryReviewConversation.ts:247-271`); `additionalRunIdsOf` derives the extras; `fetchReviewModel` emits one repeated `secondRunId=` per extra alongside the `primaryRunId` path (`:185-213`); the `review-model` proxy forwards the repeated array verbatim with no cap (`discovery.ts`).
- ✅ **Discovery-service accepts N runs:** the route builds `selectedRunIds = [runId, ...additionalRunIds]` and calls `buildReviewModel(runInputs)` unchanged (`runs.ts:732, 791`).
- ✅ **`primaryRunId` is ALWAYS a member of `runs[]`:** gateway `parseScanPair` back-fills it if the body omits it (`:266-268`); frontend `handleBegin` only ever sets `primaryRunId` to a run that is among the picks (`:439`). Preserved as the `:runId` anchor across all three trees.
- ✅ **`SelectedScanPair` / `SelectedScanPairWire` retirement (grep):** `grep -rn "SelectedScanPair"` across `gateway/src`, `frontend/src`, `discovery-service/src` → **0 matches (exit 1)**; `SelectedScanPairWire` → **0 matches (exit 1)**. The only surviving `ScanPair` token is the function name `parseScanPair`, which now returns `SelectedScanSet` (the spec retired the TYPE, not the function name).

### Behavioral spot-checks

- ✅ **(a) 2 code + 1 DB across 3 services → 3-run set accepted end-to-end:** covered by `reviewModelEndpoint.twoRun.test.ts` case (a) (PASS) and the gateway 3-run `parseScanPair`/`/start` cases (PASS).
- ✅ **(b) Orphan (NULL `service_id`) run → "Unassigned scans":** `buildServiceGroups` keys NULL `service_id` to `UNASSIGNED_KEY`, labels it "Unassigned scans", sorts it last (`DiscoveryReviewRoom.tsx:151-168, 188-194`); covered by a picker test (PASS).
- ✅ **(c) Snapshot service name surfaces:** `readSnapshotServiceName` reads `serviceName ?? service_name` (`discoveryApi.ts:222-229`); display-name precedence uses it as the middle fallback; covered by a picker regression test (PASS).
- ✅ **(d) Begin disabled until ≥1 selected:** `hasSelection={selectedRuns.length > 0}` → `disabled={beginBusy || runsLoading || !hasSelection}` (`:657, :893`); covered by a picker test (PASS).
- ✅ **(e) `deriveServiceTier` returns 'Unknown' (never throws) on any nullable hop:** explicit early returns for missing service / missing `app_component_id` / missing component / `Other`-or-unset `tech_type` (`deriveServiceTier.ts:73-84`); covered by the helper's nullable-hop tests (PASS).

---

## 6. Scope Adherence

- ✅ **No AMS change.** No Java/DTO/column/endpoint edit for this spec. (`architecture-model-service` working-tree changes belong to the separate, pre-existing bulk-findings spec.)
- ✅ **No `buildReviewModel` backbone change.** `buildReviewModel(runInputs)` is invoked unchanged; only the route's param parse/validation was relaxed.
- ✅ **Snapshot WRITE untouched.** `git diff` of `discovery-service/src/routes/runs.ts` shows every hunk is inside the `review-model` GET route (lines ~677-774); the snapshot WRITE block (`:369-376`) still emits camelCase (`serviceName`, `serviceType`, ...). The reconciliation is entirely frontend-read-side (the TYPE + `readSnapshotServiceName`), exactly as the spec mandated.
- ✅ **This spec's changes are cleanly separable from earlier in-flight specs.** This spec's files: `gateway` `reviewTurnShape.ts` + `discoveryReviewConversation.ts` + `discovery.ts` (proxy hunk) + `selectedScanSet.test.ts` + the 2 route/conversation test files; `discovery-service` `runs.ts` (route hunk) + `reviewModelEndpoint.twoRun.test.ts`; `frontend` `discoveryApi.ts` + `discoveryReviewApi.ts` + `DiscoveryReviewRoom.{tsx,test.tsx,module.css}` + `deriveServiceTier.{ts,test.ts}`. The unrelated working-tree files (`StartCaptureSessionWizard*`, `resolveBulkActionSet*`, `ConversationMainPane.tsx`, `SummaryPanel.tsx`, the architect-conversation/agenda/cascade work, the AMS + bulk-findings files) are NOT this spec and were excluded from all attribution.

---

## 7. Genuine Gaps / Risks

1. **`deriveServiceTier.test.ts` adds 25 `tsc`-only errors (net +25 frontend).**
   All are `Cannot find name 'describe'/'it'/'expect'`. The criterion "net-zero
   new `tsc`" is breached, and the "net -3" claim is inaccurate. Risk: low
   (Vitest runs them fine; production code is clean). Fix: one import line.
2. **Two obsolete assertions left red in `reviewModelEndpoint.test.ts`.** The old
   `(c1)`/`(c2)` "reject same-kind"/"reject >2 runs" cases now fail because Group
   3 intentionally removed that behaviour. They should be updated/deleted (the
   positive replacements are already in `reviewModelEndpoint.twoRun.test.ts`).
   Risk: low behaviourally, but it leaves the discovery-service suite red and
   self-contradictory about the new contract.
3. **No implementation reports.** The `implementation/` folder is empty; the
   standard per-group write-ups were not produced.
4. **Frontend full-suite baseline is very large (639 fails).** Not caused by this
   spec (all in untouched areas), but it means the frontend suite cannot be used
   as a green/red regression gate without the per-file isolation done here.

---

## Top-Level Verdict

⚠️ **Passed with Issues.** The feature is correctly and completely implemented
end-to-end — N-run `SelectedScanSet` shape, gateway threading with `primaryRunId`
preserved, discovery-service route relaxation into the unchanged builder, and the
per-service picker with snapshot reconciliation — with all of this spec's own
feature tests passing and gateway + discovery-service typechecks clean. Scope is
tight (no AMS, no builder, snapshot WRITE untouched). The two issues are both
test-hygiene: 25 `tsc`-only test-global errors in the new helper test (so
"net-zero new tsc" is NOT met; the reported "net -3" is actually net +25, all in
the test file), and two now-obsolete `reviewModelEndpoint.test.ts` assertions
left failing because they test the behaviour this spec deliberately removed.
Neither blocks the feature; both are trivial cleanups. No production regression
is attributable to this spec.
