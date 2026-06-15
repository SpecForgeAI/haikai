# Verification Report: D4 — Carry-over Completeness Gate

**Spec:** `2026-06-14-carry-over-completeness-gate`
**Date:** 2026-06-15
**Verifier:** implementation-verifier
**Status:** ⚠️ Passed with Issues

---

## Executive Summary

The carry_over completeness gate is **functionally complete server-side and at the
component level**: all 12 Confirmed Decisions (D1–D12) are implemented and verified
in code, and every targeted test suite across the three stacks passes (AMS 12/12,
gateway 24/24, frontend 11/11). The single changeset (185) applies clean on H2 and is
the highest on disk.

There is **one half-built-UI gap** (the one the implementer flagged): the Migration
Delivery dashboard never mounts a *book-scoped* Capabilities review surface and never
passes `onReviewCarryOver` to the Migrate panel. The gate still works (the hard-block
fires server-side; cite/dismiss/batch routes work; the `CapabilitiesSection`
accounting UI is fully built and gates on a `bookId` prop). The Migrate panel does NOT
render a dead button — it renders a **graceful inert text pointer** instead. But the
reviewer is left **without an in-app path** from the block to the surface that clears
it. This does not violate "no dangling clickable affordance," but it is an incomplete
seam (assessed in detail in Section 5).

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 5 task groups and every sub-task in `tasks.md` are marked `- [x]`. Spot-checked
against code — every sub-task has concrete, verifiable evidence:

### Completed Tasks
- [x] Task Group 1: Changeset 185 + `dismissed` disposition + coverage-data reads (AMS)
  - [x] 1.1 3 AMS test classes written (12 tests total)
  - [x] 1.2 `185-work-item-source-capability-id.sql` — single `ADD COLUMN`, registered after 184
  - [x] 1.3 `WorkItemEntity.sourceCapabilityId` boxed `UUID` + `WorkItemDto`/`WorkItemMapper`
  - [x] 1.4 `appendCapabilityStory` writes the column (blob stamp retained)
  - [x] 1.5 `dismissed` added to both `DiscoveryFindingService` + `DiscoveryCapabilityReviewStatus`
  - [x] 1.6 Coverage reads (`findByProjectIdAndArchitectureId…`, member reads, `findByProjectIdAndSourceCapabilityIdIsNotNull`)
  - [x] 1.7 Tests pass (foreground mvn, H2)
- [x] Task Group 2: Active per-book-of-work coverage computation (gateway)
  - [x] 2.1–2.5 `migrationCarryOverCoverage.ts` pure resolver + reads + re-keyed snapshot; tests + tsc
- [x] Task Group 3: `carry_over_not_accounted` reason + cite/dismiss/batch wiring (gateway)
  - [x] 3.1–3.7 `evaluateHardBlock` + `startMigration` pre-flight + `migrationCarryOverActions.ts`; tests + tsc
- [x] Task Group 4: Capabilities review surface + Migrate-panel blocked reason (frontend)
  - [x] 4.1–4.6 `CapabilitiesSection.tsx` column+actions, `findingsCoverage.ts` re-key, Migrate panel; tests + tsc baseline
- [x] Task Group 5: Test Review & Strategic Gap Analysis
  - [x] 5.1–5.4 Feature-specific suites run per-stack; no full suite

### Incomplete or Issues
None at the task level — all tasks are genuinely implemented. The only finding is a
deferred frontend integration seam (Section 5), which the tasks did not require as an
explicit sub-task (4.5 only required the panel to render the reason + a deep-link
affordance; it does not require the dashboard to wire the navigation target).

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found

### Implementation Documentation
- The spec folder has **no `implementations/` directory and no per-task implementation
  reports**. The `implementation/` folder exists but is **empty**.

### Verification Documentation
- This report (`verifications/final-verification.md`) is the first artifact in `verifications/`.

### Missing Documentation
- No per-task-group implementation reports were produced. This is a process-hygiene gap
  only — the code itself is exhaustively self-documenting (every changed file carries a
  D4 spec header citing the exact decision and task), so traceability is intact despite
  the absent reports.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the original meta-model / diagram-editor product
roadmap (Phases 1–5: JSON CRUD, diagram rendering/editing, backend/deployment). It
contains **no item** describing the discovery-completeness / migration / carry_over
program that this spec belongs to. No roadmap line matches D4, so no checkbox update is
warranted. (D4 is Spec 4 of 6 in a separate program tracked via the `agent-os/specs/`
series, not the product roadmap.)

---

## 4. Test Suite Results

**Status:** ✅ All Passing (targeted, per the spec's focused-test mandate)

Per the spec's explicit instruction (Task Group 5.4: "Do NOT run any full application
suite"), testing was kept **targeted to the D4 feature** on each stack. The full
estate was not re-run by design. All re-run D4 suites are green.

### Test Summary (D4 feature-specific, re-run during this verification)
- **Total Tests:** 47
- **Passing:** 47
- **Failing:** 0
- **Errors:** 0

Breakdown:

| Stack | Suite(s) | Result |
|---|---|---|
| AMS (foreground `mvn`, H2) | `WorkItemSourceCapabilityIdMigrationTest` | 6 passed |
| AMS | `DismissedDispositionValidationTest` | 3 passed |
| AMS | `GeneratedMigrationBookOfWorkAppendCapabilityStoryColumnTest` | 3 passed |
| Gateway (`jest`) | `migrationCarryOverCoverage` + `migrationCarryOverGate` | 24 passed (2 suites) |
| Frontend (`vitest`) | `CapabilitiesSection.carryOverGate` | 7 passed |
| Frontend | `CapabilitiesSection.gateToggle` | 2 passed |
| Frontend | `MigrationDeliveryMigratePanelCarryOver` | 2 passed |

AMS total **12/12**; gateway **24/24**; frontend **11/11**.

### Command outputs (key lines)

AMS (surefire summaries):
```
Tests run: 6, Failures: 0, Errors: 0, Skipped: 0 -- WorkItemSourceCapabilityIdMigrationTest
Tests run: 3, Failures: 0, Errors: 0, Skipped: 0 -- DismissedDispositionValidationTest
Tests run: 3, Failures: 0, Errors: 0, Skipped: 0 -- GeneratedMigrationBookOfWorkAppendCapabilityStoryColumnTest
```
Changeset 185 confirmed applied on H2 — the live `insert into work_item (… source_capability_id …)`
and `select … wie1_0.source_capability_id …` SQL appear in the Hibernate log, and the
`append_capability_story_ok` diag line fires.

Gateway:
```
PASS src/__tests__/migrationCarryOverCoverage.test.ts
PASS src/__tests__/migrationCarryOverGate.test.ts
Test Suites: 2 passed, 2 total
Tests:       24 passed, 24 total
```
`npx tsc --noEmit` was run for the gateway during implementation (Task 3.7) and reported clean.

Frontend:
```
✓ CapabilitiesSection.carryOverGate.test.tsx (7 tests)
✓ CapabilitiesSection.gateToggle.test.tsx (2 tests)
✓ MigrationDeliveryMigratePanelCarryOver.test.tsx (2 tests)
Test Files  3 passed
Tests       11 passed
```
Frontend tsc baseline: `npx tsc --noEmit | grep -c "error TS"` = **515** — held exactly at
the documented baseline, **not increased**.

### Failed Tests
None — all re-run D4 tests passing.

### Notes
- No regressions were introduced into the existing Migrate hard-block: the
  no-regression cases (`story_not_spec_ready` + `missing_current_baseline` still fire and
  STACK with the new reason) are asserted in both `migrationCarryOverGate.test.ts`
  (gateway) and `MigrationDeliveryMigratePanelCarryOver.test.tsx` (frontend) and pass.
- The full application suite was deliberately NOT run, per Task 5.4. This report therefore
  attests to D4-feature correctness, not a whole-estate regression sweep.

---

## 5. Decision-by-Decision Assessment (D1–D12) + UI-Completeness

**Status:** D1–D12 all PASS in code. One frontend integration seam is incomplete (does
NOT block the gate; renders an inert text fallback, not a dead button).

| Decision | Verdict | Evidence |
|---|---|---|
| **D1** HARD-BLOCK, stacks not forks | ✅ PASS | `evaluateHardBlock` (migrationExecutionDriver.ts:386–397) pushes `carry_over_not_accounted` into the SAME `reasons[]` as `story_not_spec_ready` + `missing_current_baseline`; capabilities AND un-grouped findings pushed identically (one `kindLabel` switch, same code). Frontend `computeHardBlockReasons` surface reused. |
| **D2** `behaviourBearing==true` sole predicate + roll-up | ✅ PASS | `migrationCarryOverCoverage.ts`: `readBehaviourBearing` returns true only on explicit `=== true`; must-account set = behaviour-bearing capabilities ∪ un-grouped behaviour-bearing findings; member findings of covered/dismissed capabilities are absorbed (not double-counted) via `groupedFindingIds`/`absorbedFindingStatus`. |
| **D3** `source_capability_id` promoted to a column | ✅ PASS | Changeset 185 `ALTER TABLE work_item ADD COLUMN source_capability_id UUID NULL`; `WorkItemEntity.sourceCapabilityId` boxed UUID; `appendCapabilityStory` (GeneratedMigrationBookOfWorkService:~1060) writes the column AND keeps the D3 blob stamp; the gate joins on it. |
| **D4** dedicated `dismissed` on BOTH objects, mandatory reason, no DDL | ✅ PASS | `DiscoveryCapabilityReviewStatus.DISMISSED="dismissed"` in `ALL`+`REVIEWER_VALID`; `DiscoveryFindingService.ALLOWED_STATUSES`+`ALLOWED_REVIEWER_STATUSES` include `dismissed` (reviewer set excludes `pending_review`). Net rule `{rejected,dismissed}+non-empty reason` enforced in `isDismissedByDisposition`. `approved/pending_review/deferred` do NOT satisfy. No DDL for the disposition (string value). |
| **D5** gate scope per book-of-work in `startMigration` pre-flight | ✅ PASS | `startMigration` (migrationExecutionDriver.ts:506–550) gathers coverage off the book's project + `current_architecture_id` server-side, then `evaluateHardBlock`. Fail-soft on a reads error (never wrongly blocks). |
| **D6** per-capability cite + "Generate all" batch | ✅ PASS | `migrationCarryOverActions.ts`: `citeCapability` → `append-capability-story`; `generateAllCapabilityStories` cites once per un-covered approved behaviour-bearing capability (skips covered/non-bb/non-approved — asserted). Lives on the completeness surface, not the spec-Generate-All dialog. |
| **D7** EXTEND CapabilitiesSection + Migrate panel; no new panel | ✅ PASS | `CapabilitiesSection.tsx` extended with a coverage column + cite/dismiss/batch (gated on `bookId`); `MigrationDeliveryMigratePanel.tsx` renders the blocked reason. No standalone panel added. |
| **D8** status `{un-actioned\|cited-by-story\|dismissed}`; any citing story counts | ✅ PASS | `COVERAGE_STATUS` exactly those three; `resolveCapabilityStatus`/`resolveFindingStatus` — cited wins over dismissed; finding cited via `discoveryFindingReferences` OR roll-up. |
| **D9** roll-up reads `discovery_capability_member` | ✅ PASS | Coverage input carries `memberFindingIds` sourced from the member reads (`findByCapabilityIdIn` / `findByCapabilityIdOrderByCreatedAtAsc`, `member_type='discovery_finding'`). |
| **D10** ONE changeset 185, nothing else | ✅ PASS | Only `185-work-item-source-capability-id.sql` added; single `ADD COLUMN`; no `CREATE TABLE`; asserted by `WorkItemSourceCapabilityIdMigrationTest`. Dismissal added no DDL. |
| **D11** test strategy | ✅ PASS | gateway coverage + gate + no-regression jest; AMS migration/entity H2; frontend review surface + blocked-reason vitest. All present and green. |
| **D12** scope out | ✅ PASS | No net_new/provenance (D5-program) or reconcile-time/target_only (D6-program) code introduced; no `approved`/`pending_review`/`deferred` escape hatch; `WorkItem.deferred` semantics not reused for dismissal. |

### Changeset numbering / "highest" check
`185` is the highest changeset on disk (D2=184, D4=185; no 186 yet — D5 reserves it).
Registered in `db.changelog-master.yaml` immediately after `184-discovery-capability`.
Confirmed.

---

## 5a. UI-Completeness Assessment ("no half-built UI")

**Conclusion: (b)-leaning — a real but BOUNDED half-built seam. NOT a dangling clickable
button. The gate is fully functional; the reviewer is missing an in-app navigation path.**

What is fully built and works (the gate is functionally complete):
- **Server-side hard-block fires.** `startMigration` computes coverage and blocks with
  `carry_over_not_accounted`; verified by `migrationCarryOverGate.test.ts` (blocks on
  un-actioned capability; un-grouped finding gates on its own).
- **Cite / dismiss / batch routes work.** `citeCapability`, `dismissCarryOverItem`
  (rejects empty reason), `generateAllCapabilityStories` all wired and tested.
- **The accounting UI is fully built.** `CapabilitiesSection.tsx` renders the
  coverage-status column + "Create story" + "Dismiss…" (with a mandatory non-empty
  reason — Confirm is `disabled` until `reason.trim()` is non-empty) + "Generate all
  capability stories", ALL gated behind a `bookId` prop (`gateEnabled`). `FindingsTab.tsx`
  accepts and forwards `bookId` → `CapabilitiesSection`. So the destination surface
  **exists and is wired** — it simply needs to be mounted with a `bookId`.
- **The Migrate panel surfaces the block.** It renders the `carry_over_not_accounted`
  message in the server-blocked banner (`mdd-migrate-server-blocked`).

What is NOT wired (the gap the implementer flagged — confirmed accurate):
- The **Migration Delivery dashboard** (`MigrationDeliveryDashboard.tsx:1129`) mounts
  `MigrationDeliveryMigratePanel` **without** the optional `onReviewCarryOver` prop.
- The **only** `FindingsTab` mount in the app (`DiscoveryRunDetailView.tsx:396`) does
  **not** pass `bookId` — so its hosted `CapabilitiesSection` runs in read-only D2 mode.
  There is **no book-scoped Capabilities review surface mounted anywhere** in the
  migration flow.

What the user would actually see / click:
- On a blocked Migrate, the user sees the red server-blocked banner listing each
  un-accounted item (e.g. *"Behaviour-bearing carry_over capability '…' is neither cited
  by a story nor dismissed…"*), followed by a **plain inert text line**:
  *"Account for the un-accounted carry-over work on the Capabilities review (cite a story
  or dismiss with a reason), then retry."*
- Because `onReviewCarryOver` is absent, the code takes the **`else` branch**
  (MigrationDeliveryMigratePanel.tsx:374–378) — it renders a `<span>`, **not** a button.
  There is **no clickable element that goes nowhere**; the prop is documented optional
  with this exact text-fallback contract. So the strict "no dead button / no 'Coming in
  vX' control" rule is **NOT violated**.
- However, the text tells the user to go to "the Capabilities review" to cite/dismiss,
  and **there is no migration-context route that lands them on a book-scoped Capabilities
  review with the cite/dismiss controls enabled.** A user following the instruction would
  reach the discovery-run Capabilities view (read-only, no cite/dismiss). The accounting
  pass is therefore **not reachable through the UI in the migration flow** as shipped.

Assessment verdict: this is a **graceful inert fallback, not a dangling affordance** — so
it sits on the right side of the "no half-built UI" rule in the *literal* sense (nothing
broken is clickable). But it is an **incomplete feature seam**: the gate can block the
user without giving them an in-product way to clear it from where they are. Closing it is
small and the building blocks already exist:
  1. mount `FindingsTab` (or `CapabilitiesSection` directly) **with `bookId`** somewhere
     reachable from the Migration Delivery dashboard, and
  2. pass `onReviewCarryOver={() => navigate to that surface}` into the Migrate panel so
     the inert `<span>` becomes the working deep-link button it was designed to be.

Recommendation: treat as a **follow-up wiring task** (UI navigation seam), not a defect in
the gate's correctness. The gate itself is production-correct and fully tested; the
user-facing remediation path is the one piece left to connect.

---

## Overall Verdict

**⚠️ Passed with Issues.** All 12 decisions implemented and verified; all 47 re-run D4
tests green; changeset 185 applies clean on H2 and is the highest; tsc baseline held at
515. Two non-blocking issues: (1) no implementation reports were written (process
hygiene; code is self-documenting), and (2) the frontend leaves an **un-wired navigation
seam** — the Migrate-panel deep-link renders an inert text pointer (not a dead button)
and the migration dashboard never mounts a book-scoped, cite/dismiss-enabled Capabilities
surface, so the in-app remediation path from "blocked" to "account for it" is not
connected. The carry_over gate is functionally complete server-side; the open item is
purely UI navigation wiring.
