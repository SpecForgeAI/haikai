# Task Breakdown: D4 — Carry-over Completeness Gate

## Overview
Total Tasks: 5 task groups

This spec extends the already-built Spec-3 Migrate hard-block with a carry_over coverage dimension. It does NOT fork a parallel gate. The implementation spans three stacks in strict dependency order: AMS (the single changeset 185 + the `dismissed` disposition + coverage-data reads) -> gateway (coverage computation -> hard-block extension + cite/dismiss/batch wiring) -> frontend (review surface + blocked-reason rendering) -> a final strategic-gap test pass.

Key constraints carried into every group:
- ONE changeset only — `185-work-item-source-capability-id.sql` adds `work_item.source_capability_id` (UUID, nullable) and NOTHING else. Dismissal reuses the string-typed `reviewStatus` / `review_status` — NO DDL for it. D5 takes 186.
- `behaviourBearing == true` (read from `detail_json`) is the SOLE gating predicate; `false` NEVER gates.
- Accounted-for-by-disposition = `reviewStatus` / `review_status` in {`rejected`, `dismissed`} WITH a non-empty reason. `approved` / `pending_review` / `deferred` do NOT satisfy.
- Do NOT reuse `WorkItem.deferred` (changeset 182) semantics for dismissal.
- Each dev group writes 2-8 focused tests and runs ONLY those; the final group adds <= 10 strategic tests.

## Task List

### AMS Layer

#### Task Group 1: Changeset 185 + the `dismissed` disposition + coverage-data reads
**Dependencies:** None (extends D2 changeset 184, already built)

- [x] 1.0 Complete the AMS layer
  - [x] 1.1 Write 2-8 focused AMS tests (foreground `mvn`, H2)
    - Limit to 2-8 highly focused tests maximum
    - Test ONLY: (a) the `185` migration applies and `work_item.source_capability_id` exists + round-trips on `WorkItemEntity` (write then read back the UUID); (b) `appendCapabilityStory` now persists `source_capability_id` to the column (not just the blob); (c) the `dismissed` disposition validates on BOTH `DiscoveryFinding` and `discovery_capability`
    - Skip exhaustive disposition-matrix and query-permutation coverage
  - [x] 1.2 Create changeset `185-work-item-source-capability-id.sql`
    - Add column `work_item.source_capability_id` (UUID, nullable) and NOTHING else
    - Place under `architecture-model-service/src/main/resources/db/changelog/sql/`
    - Register `185-work-item-source-capability-id` in `db.changelog-master.yaml` AFTER the `184-discovery-capability` entry (line ~4007); D5 reserves 186
    - Do NOT edit any applied changeset (immutable-changeset rule)
  - [x] 1.3 Map the new column on `WorkItemEntity` (+ DTO/mapper if the coverage read needs it)
    - Add `sourceCapabilityId` as a BOXED `UUID` field (PATCH-safe; never a primitive)
    - Wire through `WorkItemMapper` / `WorkItemDto` only if the gateway coverage read consumes it via the existing DTO path
  - [x] 1.4 Update D3's `appendCapabilityStory` to ALSO write the column
    - `GeneratedMigrationBookOfWorkService.appendCapabilityStory` (`:954`) already stamps `source_capability_id` into `book_of_work_json`; ADD the entity-column write so the gate query becomes a structured join
    - Keep the blob stamp unchanged (D3 stays changeset-free on its own)
  - [x] 1.5 Extend the dismissal validation vocabulary on BOTH objects (NO DDL)
    - `DiscoveryFindingService`: add `dismissed` to `ALLOWED_STATUSES` / the reviewer-valid set (alongside the existing `validateReviewStatus` path); dismissal folds its reason into `reviewerNotes`
    - `DiscoveryCapabilityService` / `DiscoveryCapabilityReviewStatus`: add `dismissed` to `REVIEWER_VALID` and `ALL`; the capability reason folds into `detail_json.reviewerNotes` per the D2 pattern
    - Confirm `rejected` already validates and is retained (it auto-satisfies the gate)
  - [x] 1.6 Provide the coverage-data reads the gateway gate needs
    - Behaviour-bearing capabilities for a project + architecture WITH their `review_status` (+ `detail_json.reviewerNotes`) and their `discovery_capability_member` membership (polymorphic `member_type='discovery_finding'` / `member_id`)
    - Behaviour-bearing findings for a project + architecture WITH `reviewStatus` / `reviewerNotes` and `detailJson.behaviourBearing`
    - `work_item` coverage by `source_capability_id` (so a capability's covered-state is a join, not a blob parse)
    - Reuse `findByProjectAndArchitecture`-style reads; behaviour-bearing filtering may be done in the gateway if a query-level filter is not already available
  - [x] 1.7 Ensure AMS layer tests pass
    - Run ONLY the 2-8 tests written in 1.1, foreground `mvn` with H2 (e.g. `mvn -Dtest=<the new test classes> test`)
    - Verify the `185` migration runs clean against H2 and the dismissal validation accepts `dismissed` on both objects
    - Do NOT run the entire AMS suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass (foreground `mvn`, H2)
- Changeset `185` adds `work_item.source_capability_id` (UUID, nullable) and nothing else; registered after `184`; D5 left free for `186`
- `appendCapabilityStory` writes the column AND the blob; the UUID round-trips on the entity
- `dismissed` validates on BOTH `DiscoveryFinding` and `discovery_capability`; `rejected` still validates; no DDL was added for dismissal
- The coverage reads (capabilities + members, findings, work-items-by-`source_capability_id`) are available to the gateway

### Gateway Layer — Coverage Computation

#### Task Group 2: Active per-book-of-work coverage computation
**Dependencies:** Task Group 1

- [x] 2.0 Complete the coverage computation
  - [x] 2.1 Write 2-8 focused gateway jest tests (LLM-guard: mock `llmClient`; `architectureModelClientMock`)
    - Limit to 2-8 highly focused tests maximum
    - Test ONLY the pure status resolver across the canonical cases: `cited-by-story` (capability via `source_capability_id`), `un-actioned`, `dismissed` (disposition + non-empty reason), member-finding roll-up (covered/dismissed capability => its findings accounted-for, not double-counted), and `behaviourBearing == false` never appears in the must-account set
    - Skip exhaustive permutation coverage
  - [x] 2.2 Build the must-account-set + status computation module
    - Input: a book-of-work (project + `current_architecture_id`) across the discovery runs that fed the plan
    - Must-account set = {behaviour-bearing capabilities} UNION {behaviour-bearing findings NOT a member of any capability}, using the Group-1 reads
    - `behaviourBearing == true` is the sole inclusion predicate (read from `detail_json`); `false` is excluded entirely
  - [x] 2.3 Implement the per-item status resolver { un-actioned | cited-by-story | dismissed }
    - Capability `cited-by-story` iff a `work_item.source_capability_id == capability.id` exists (the new column)
    - Finding `cited-by-story` iff its id is in any book item's `discoveryFindingReferences` OR it rolls up under a covered/dismissed capability via `discovery_capability_member`
    - Either `dismissed` iff `reviewStatus` / `review_status` in {`rejected`, `dismissed`} WITH a non-empty reason; `approved` / `pending_review` / `deferred` do NOT satisfy
    - Roll-up: a member finding of a covered/dismissed capability is accounted-for and NOT double-counted; an un-grouped behaviour-bearing finding stands on its own
  - [x] 2.4 Make the passive coverage snapshot active and re-keyed
    - `migrationBookOfWorkHandler.ts` `buildFindingsCoverageSnapshot`: re-key from `severity` (critical/high) to `behaviourBearing`, add capabilities alongside findings, and make it enforcing rather than a passive create-time list (or expose a new active computation the gate consumes)
    - Keep the result shape consumable by both the gate (Group 3) and the frontend read-side (`findingsCoverage.ts`, Group 4)
  - [x] 2.5 Ensure coverage-computation tests pass
    - Run ONLY the 2-8 tests written in 2.1 (`jest <pattern>`), then `npx tsc --noEmit`
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `npx tsc --noEmit` is clean
- The module deterministically returns the correct status for covered / un-actioned / dismissed / rolled-up / `behaviourBearing=false`-excluded inputs
- The must-account set is exactly {behaviour-bearing capabilities} UNION {un-grouped behaviour-bearing findings}
- The snapshot is active, keyed on `behaviourBearing`, and includes capabilities

### Gateway Layer — Hard-block Extension + Actions

#### Task Group 3: `carry_over_not_accounted` reason + cite / dismiss / batch wiring
**Dependencies:** Task Group 2

- [x] 3.0 Complete the hard-block extension and action wiring
  - [x] 3.1 Write 2-8 focused gateway jest tests (LLM-guard + `architectureModelClientMock`)
    - Limit to 2-8 highly focused tests maximum
    - Test ONLY: (a) Migrate blocks with `carry_over_not_accounted` when a behaviour-bearing capability is un-actioned; (b) it unblocks after cite (`append-capability-story` -> `source_capability_id` -> covered); (c) it unblocks after dismiss (`reviewStatus = dismissed` + reason); (d) an un-grouped behaviour-bearing finding gates on its own; (e) NO-REGRESSION — `story_not_spec_ready` and `missing_current_baseline` still fire unchanged
    - Skip exhaustive scenario coverage
  - [x] 3.2 Add the `carry_over_not_accounted` reason to `evaluateHardBlock`
    - In `migrationExecutionDriver.ts`, push `{ code: 'carry_over_not_accounted', message, workItemId? }` for each un-accounted item, using Group-2's coverage computation
    - Surface capabilities AND un-grouped behaviour-bearing findings in the SAME `reasons[]` list, treated identically
    - Reuse `HardBlockResult` / `StartMigrationResult` `'blocked'` shapes and `buildOrderedDispatchSet` unchanged — do NOT fork the gate
  - [x] 3.3 Wire the check into the existing `startMigration` pre-flight
    - Server-side only (never trust the UI); blocks when any must-account item is neither cited nor dismissed
    - Ensure the new reason STACKS alongside the existing reasons (does not replace them)
  - [x] 3.4 Wire the cite action (single)
    - "Create story" (cite) invokes D3's `append-capability-story`, which now stamps both `source_capability_id` (column) and the blob -> the capability flips to `cited-by-story`
  - [x] 3.5 Wire the dismiss action
    - Dismiss = PATCH `reviewStatus` / `review_status = dismissed` + a MANDATORY non-empty reason (`reviewerNotes` for findings; `detail_json.reviewerNotes` for capabilities) on the targeted finding/capability
    - Reject empty-reason dismissals (the gate is not satisfied without a reason)
  - [x] 3.6 Wire the "Generate all capability stories" batch
    - Runs the cite once per un-covered approved behaviour-bearing capability; model it on the AMS `append-test-item` batch-create precedent
    - Lives on the completeness review surface path, NOT the spec-Generate-All dialog
  - [x] 3.7 Ensure hard-block + action tests pass
    - Run ONLY the 2-8 tests written in 3.1 (`jest <pattern>`), then `npx tsc --noEmit`
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; `npx tsc --noEmit` is clean
- Migrate hard-blocks on un-accounted behaviour-bearing capabilities AND un-grouped findings, surfaced in one `reasons[]` list
- Cite (single + batch) and dismiss (with mandatory reason) each clear the gate for their item
- NO-REGRESSION: `story_not_spec_ready` and `missing_current_baseline` still fire unchanged and stack with the new reason

### Frontend Layer

#### Task Group 4: Extend the Capabilities review surface + Migrate-panel blocked reason
**Dependencies:** Task Group 3

- [x] 4.0 Complete the frontend changes
  - [x] 4.1 Write 2-8 focused vitest tests (`renderWithProviders`)
    - Limit to 2-8 highly focused tests maximum
    - Test ONLY: (a) `CapabilitiesSection` renders the coverage-status column (un-actioned / cited-by-story / dismissed); (b) the cite and dismiss(reason) actions render and fire; (c) `MigrationDeliveryMigratePanel` renders the `carry_over_not_accounted` blocked reason via the `serverBlockReasons` list with a deep-link to the review surface
    - Skip exhaustive state/interaction coverage
  - [x] 4.2 Extend `CapabilitiesSection.tsx` with the coverage-status column
    - Add a per-capability status cell: un-actioned / cited-by-story / dismissed, sourced from the active coverage computation
    - This is the D2 read-only view (rendered by `FindingsTab.tsx`) — extend it; do NOT add a new standalone panel
  - [x] 4.3 Add per-capability cite + dismiss(reason) actions + the batch trigger
    - Per-capability "Create story" (cite) action
    - Per-capability dismiss action capturing a MANDATORY non-empty reason
    - A "Generate all capability stories" batch trigger on the same surface
  - [x] 4.4 Mirror the coverage re-key in `findingsCoverage.ts`
    - Re-key `computeFindingsCoverage` from `severity` to `behaviourBearing` so the read-side grading matches the gateway's active snapshot
  - [x] 4.5 Render the `carry_over_not_accounted` blocked reason in the Migrate panel
    - In `MigrationDeliveryMigratePanel.tsx`, reuse the `serverBlockReasons` / `blockReasons` list rendering to surface the new reason, with a deep-link to the completeness review surface
    - The panel surfaces THAT there is un-accounted work; the cite/dismiss pass happens on the Capabilities view
  - [x] 4.6 Ensure frontend tests pass + tsc baseline held
    - Run ONLY the 2-8 tests written in 4.1 (`vitest run <pattern>`)
    - Run the tsc check and confirm the baseline of 515 is NOT increased (do not regress the baseline)
    - Do NOT run the entire frontend suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `CapabilitiesSection` shows coverage status + working cite / dismiss(reason) / batch controls
- The Migrate panel renders the `carry_over_not_accounted` reason with a deep-link
- `findingsCoverage.ts` is re-keyed to `behaviourBearing`
- tsc baseline remains 515 (not increased); no new standalone panel was added

### Testing

#### Task Group 5: Test Review & Strategic Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review the tests from Task Groups 1-4
    - AMS (Task 1.1), gateway coverage (Task 2.1), gateway hard-block/actions (Task 3.1), frontend (Task 4.1)
    - Total existing focused tests: approximately 8-32
  - [x] 5.2 Analyze coverage gaps for THIS feature's end-to-end gate behaviour only
    - Focus ONLY on the D4 gate's critical paths; do NOT assess whole-application coverage
    - Candidate gaps to confirm covered end-to-end: block when a behaviour-bearing capability is un-actioned; unblock after cite (`append-capability-story` -> `source_capability_id` column -> covered); unblock after dismiss (`reviewStatus = dismissed` + reason); member-finding roll-up (covered capability => its findings covered, no double-count); an un-grouped behaviour-bearing finding gates on its own; `behaviourBearing == false` never gates; NO-REGRESSION (existing reasons still fire); the frontend coverage-status + blocked-reason render
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Add a MAXIMUM of 10 new tests to fill only the gaps identified in 5.2 (favour the cross-stack gate-toggle and roll-up integration paths)
    - Do NOT write comprehensive coverage; skip edge cases, performance, and accessibility unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY the D4-related tests (from 1.1, 2.1, 3.1, 4.1, and 5.3) on each stack: AMS targeted foreground `mvn` (H2), gateway targeted `jest` + `npx tsc --noEmit`, frontend targeted `vitest` + tsc baseline 515
    - Expected total: approximately 18-42 tests
    - Do NOT run any full application suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 tests total)
- The gate's critical cross-stack workflows are covered (block / cite-unblock / dismiss-unblock / roll-up / `behaviourBearing=false` / NO-REGRESSION / frontend render)
- No more than 10 additional tests were added
- Testing stayed focused exclusively on the D4 gate; no full suite was run; tsc baseline remained 515

## Execution Order

Recommended implementation sequence (strict dependency order):
1. AMS Layer — changeset 185 + `dismissed` disposition + coverage reads (Task Group 1)
2. Gateway Layer — active coverage computation (Task Group 2)
3. Gateway Layer — `carry_over_not_accounted` hard-block extension + cite/dismiss/batch wiring (Task Group 3)
4. Frontend Layer — Capabilities review surface + Migrate-panel blocked reason (Task Group 4)
5. Test Review & Strategic Gap Analysis (Task Group 5)


## Closing Wiring Note (post-Group-5)

Task Group 4 built both halves of the cite/dismiss loop but left them disconnected on the dashboard: `MigrationDeliveryMigratePanel` rendered an OPTIONAL `onReviewCarryOver` deep-link (inert text fallback) but the dashboard never passed it, and nothing mounted a book-scoped Capabilities surface from the Migrate flow — so a user hard-blocked by `carry_over_not_accounted` was told to "review the Capabilities to cite or dismiss" with no in-app route there. Closed in a focused follow-up pass (frontend-only):

- [x] Dashboard wiring — `MigrationDeliveryDashboard.tsx` now passes `onReviewCarryOver` to the Migrate panel (opening a book-scoped carry-over review) and `refreshToken` (bumped on close). The review surface is a modal overlay (matching the `MigrationDeliveryBulkResolveModal` pattern) hosting `CapabilitiesSection` mounted with the dashboard's `bookId` + `currentArchitectureId` (from the dashboard DTO) and NO `runId` — so it lists the architecture-wide capability set the book-scoped coverage spans, with the coverage-status column + Cite / Dismiss(reason) / Generate-all actions (already wired to the gateway carry-over routes).
- [x] `CapabilitiesSection.tsx` — `runId` made OPTIONAL; when a `bookId` is supplied without a `runId` (the book-of-work completeness review) it lists capabilities via `listCapabilitiesByProjectAndArchitecture` instead of `listCapabilitiesByRun`. The discovery-run review (FindingsTab, always run-scoped) is unchanged.
- [x] Refresh-loop closure — `MigrationDeliveryMigratePanel.tsx` re-checks the gate when `refreshToken` changes: it drops the stale server-side block (`serverBlockReasons`) and reloads the run, so the `carry_over_not_accounted` banner clears after the cite/dismiss pass and the user can retry Migrate (the gateway re-validates server-side). The blocked-reason deep-link is a real clickable `<button>` when `onReviewCarryOver` is supplied.
- [x] Tests (frontend vitest, api mocked, `renderWithProviders`): `MigrationDeliveryMigratePanelCarryOver.test.tsx` extended (clickable affordance fires `onReviewCarryOver`; `refreshToken` bump clears the stale block) and new `MigrationDeliveryDashboardCarryOver.test.tsx` (clicking the blocked deep-link opens the book-scoped review surface mounted with bookId + architecture; after a cite + close, the gate is re-checked and the stale block clears). 6 new/updated tests pass; existing CapabilitiesSection (18) + dashboard Migrate/shell/define + FindingsTab suites green; tsc baseline held at 515.

Loop now closes in-app: blocked → click "Review carry-over coverage" → book-scoped Capabilities surface → cite / dismiss → close → block clears → Migrate enabled.
