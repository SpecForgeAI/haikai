# Task Breakdown: Normalize Findings Review Actions (Spec F)

## Overview
Total Tasks: 6 task groups

This is a cross-stack vocabulary/field rename: discovery FINDINGS adopt the
candidate disposition model (`pending_review` / `approved` / `rejected` /
`deferred`) plus a `previous_review_status` audit trail, replacing the legacy
five-value `status` (`new` / `accepted` / `ignored` / `needs_review` /
`resolved`). It spans the Architecture Model Service (Java/Spring Boot/Maven),
the frontend (React/TS/Vitest), and a single-spot discovery-service emit (TS),
reconciled with the uncommitted in-flight `2026-05-28-bulk-findings-actions`
work. The candidate side is the parity REFERENCE only and is NOT modified.

**Hard constraints carried from the spec / repo memory:**
- NEVER edit the applied `135-discovery-findings.sql` changeset — all DDL/DML
  lives in a NEW changeset (`feedback_liquibase_immutable_changesets.md`).
- The gateway findings proxy is a verbatim pass-through — NO route-logic change;
  only test-fixture string updates.
- mcp-server is OUT of scope (it never reads finding status).
- CAUTION (discovery-service): edit `discovery-service/src/**` ONLY when no
  discovery run is active — `tsx watch` auto-reloads kill in-flight runs
  (`feedback_no_src_edits_during_run.md`).
- Build/test commands: AMS = `mvn -DskipTests=false test` in
  `architecture-model-service`; frontend = `npx vitest run <files>`;
  gateway / discovery-service = jest on the touched suites.

## Task List

### Database Layer

#### Task Group 1: Liquibase Changeset — Rename Column + Migrate Values
**Dependencies:** None

This is foundational — the column rename and value migration must land first so
the entity/DTO/service edits in Group 2 map onto a `review_status` column.

- [x] 1.0 Complete the findings review-status database migration
  - [x] 1.1 Author the new changeset SQL file
    - Create `architecture-model-service/src/main/resources/db/changelog/sql/170-discovery-findings-review-status.sql`
      (170 is the next free numeric prefix; highest existing is `169-discovery-run-degraded.sql`).
    - `ALTER TABLE discovery_findings RENAME COLUMN status TO review_status;`
      (keep `TEXT NOT NULL`).
    - `ALTER TABLE discovery_findings ALTER COLUMN review_status SET DEFAULT 'pending_review';`
      (was `'new'`).
    - Add `ALTER TABLE discovery_findings ADD COLUMN IF NOT EXISTS previous_review_status TEXT;`
      (nullable, no default).
    - Rename / recreate the single status index: drop `idx_discovery_finding_status`
      and recreate as `idx_discovery_finding_review_status ON discovery_findings (review_status)`
      (keep exactly ONE index — do not add a second).
    - NO CHECK constraint (preserve `135`'s free-text + pack-extensibility design).
    - Reuse the COLUMN COMMENT idiom + `previous_review_status` comment wording
      from `074-candidate-review-fields.sql:41-44`; refresh the `review_status`
      comment to the new vocabulary `{pending_review (default on emit), approved,
      rejected, deferred}`.
  - [x] 1.2 Add the value-migration DML in the same changeset (after the rename)
    - `UPDATE discovery_findings SET review_status = 'approved'  WHERE review_status = 'accepted';`
    - `UPDATE discovery_findings SET review_status = 'rejected'  WHERE review_status = 'ignored';`
    - `UPDATE discovery_findings SET review_status = 'deferred'  WHERE review_status = 'needs_review';`
    - `UPDATE discovery_findings SET review_status = 'pending_review' WHERE review_status = 'new';`
    - `UPDATE discovery_findings SET review_status = 'approved'  WHERE review_status = 'resolved';`
    - Mirror the explicit-`UPDATE`-for-existing-rows idiom of
      `074-candidate-review-fields.sql:29-34`. End state: the column carries only
      `{pending_review, approved, rejected, deferred}`.
  - [x] 1.3 Register the changeset in `db.changelog-master.yaml`
    - Append a `changeSet` block (id `170-discovery-findings-review-status`,
      `author: architecture-tool`) in the same `sqlFile` style as the `135`/`160`
      entries: `relativeToChangelogFile: false`, `splitStatements: true`,
      `stripComments: true`.
    - Precondition: `onFail: MARK_RAN` / `onError: HALT` with
      `columnExists: { tableName: discovery_findings, columnName: status }`
      (i.e. run only while the OLD `status` column still exists), matching the
      guard idiom used across the file.
  - [x] 1.4 Verify the migration applies cleanly
    - Run `mvn -DskipTests=false test` in `architecture-model-service` (the test
      bootstrap runs Liquibase against the test datasource) OR start AMS once
      (user-driven) and confirm the changeset applies with no checksum/precondition
      error and the column is renamed.
    - Confirm via a quick query (test or psql) that no legacy value remains in
      `review_status`.

**Acceptance Criteria:**
- New changeset `170-...` exists; `135-discovery-findings.sql` is byte-for-byte unchanged.
- Liquibase applies the changeset with no error; exactly one status index remains, now on `review_status`.
- `discovery_findings.review_status` defaults to `pending_review`; `previous_review_status` exists as nullable TEXT.
- All five legacy values are migrated; no `new`/`accepted`/`ignored`/`needs_review`/`resolved` rows remain.

### Backend (Architecture Model Service — Java)

#### Task Group 2: AMS Service, Entity, DTOs, Controller
**Dependencies:** Task Group 1

Single coordinated Java pass over the findings surface, INCLUDING the in-flight
bulk DTOs + bulk loop (the largest single surface). Uses
`DiscoveryCandidateService` / `DiscoveryCandidateEntity` as the parity reference
(reference only — not modified).

- [x] 2.0 Complete the AMS findings vocabulary, transitions, audit trail, and bulk reconciliation
  - [x] 2.1 Write/adapt 2-8 focused AMS tests for the new behaviour
    - Extend the in-flight `DiscoveryFindingBulkReviewTest.java` and/or the
      single-row review test with a small focused set covering ONLY:
      (a) a reviewer transition to `approved`/`rejected`/`deferred` succeeds and
      stamps `previous_review_status` with the prior value;
      (b) an any→any move that the OLD transition graph would have blocked (e.g.
      a previously-`approved` finding → `deferred`) now succeeds;
      (c) bulk review actions every non-same-status row and reports
      `skipped_by_reason.transition_not_allowed == 0` with `already_in_target`
      counting same-`review_status` rows;
      (d) `delta_by_from_status` is keyed by the new vocabulary.
    - Limit to 2-8 tests; do NOT exhaustively re-cover every action/edge case.
  - [x] 2.2 Update `DiscoveryFindingService.java` constants + persist default
    - `ALLOWED_STATUSES` → `{pending_review, approved, rejected, deferred}`
      (was `{new, accepted, ignored, needs_review, resolved}`, lines ~126-127).
    - `ALLOWED_REVIEWER_STATUSES` → `{approved, rejected, deferred}`
      (was 4 values incl. `resolved`/`needs_review`, lines ~136-137) — mirrors
      `DiscoveryCandidateService.VALID_REVIEW_STATUSES` (`DiscoveryCandidateService.java:60`).
    - `persistFindingEntity` default (line ~330) → `pending_review` (was `new`);
      keep the `ALLOWED_STATUSES` membership check.
  - [x] 2.3 Remove the transition graph and add the audit-trail capture
    - DELETE the `ALLOWED_TRANSITIONS` map (lines ~171-177).
    - In `applyStatusChange(...)` (lines ~913-942): DELETE the
      `InvalidFindingStatusTransitionException` throw (lines ~929-932) and the
      `else if (!"new".equals(...))` branch (line ~936); BEFORE overwriting,
      capture the current value into `previousReviewStatus` on every real
      transition and keep the `reviewedAt` stamp — mirror
      `DiscoveryCandidateService.reviewCandidate` lines 413-420.
    - Remove/rewrite the `isTransitionAllowed` / `ALLOWED_TRANSITIONS` test
      helpers (lines ~1116-1124).
  - [x] 2.4 Update `DiscoveryFindingEntity.java`
    - Rename field `status` → `reviewStatus` with `@Column(name = "review_status")`,
      `@Builder.Default` value `"pending_review"` (was `"new"`, lines ~119-121).
    - Rename the `@Index` on line ~58 to track `review_status`
      (`idx_discovery_finding_review_status`).
    - Add `previousReviewStatus` field (`@Column(name = "previous_review_status")`,
      nullable) — pattern from `DiscoveryCandidateEntity.java:159-161, 192-193`.
  - [x] 2.5 Update `DiscoveryFindingDto.java` + `DiscoveryFindingMapper`
    - Rename the `status` record component → `reviewStatus`; add a
      `previousReviewStatus` component (both serialize snake_case via the global
      `SNAKE_CASE` strategy — NO `@CamelCaseWire`).
    - Update the backward-compat delegating constructor (lines ~69-111) for the
      renamed/added components.
    - Update `DiscoveryFindingMapper` to map both new fields entity↔DTO.
  - [x] 2.6 Update the single-row request DTOs
    - `ReviewDiscoveryFindingRequest` / `UpdateDiscoveryFindingRequest`: rename
      the `status` field + Javadoc references to `review_status`; refresh the
      documented value list to `approved/rejected/deferred` (review) /
      the full disposition set (update).
  - [x] 2.7 Reconcile the in-flight bulk DTOs
    - `BulkReviewDiscoveryFindingsRequest`: rename `status` → `reviewStatus` and
      the nested `Filter.status` → `reviewStatus` (lines ~28-29, 40); refresh the
      Javadoc value list to `approved/rejected/deferred`.
    - `BulkReviewDiscoveryFindingsResponse`: refresh the `deltaByFromStatus`
      documented key vocabulary to `{pending_review, approved, rejected, deferred}`
      (Javadoc lines ~11-13); RETAIN the field name `deltaByFromStatus`
      (→ wire `delta_by_from_status`).
  - [x] 2.8 Reconcile the `bulkReview(...)` loop (lines ~460-537)
    - Read `request.reviewStatus()`; validate against the new
      `ALLOWED_REVIEWER_STATUSES`.
    - REMOVE the `ALLOWED_TRANSITIONS.getOrDefault(...).contains(...)` pre-check
      and the `transitionNotAllowed` skip path (lines ~506-512) — every
      non-same-status row is now actioned.
    - KEEP `SkippedByReason.transitionNotAllowed` as a field (response shape stays
      stable for the frontend) but it is now ALWAYS `0`; `alreadyInTarget` still
      counts same-`review_status` rows.
    - Re-key the `delta_by_from_status` accumulator to the new stored values
      (in lockstep with the rename).
  - [x] 2.9 Update `DiscoveryFindingController.java` Javadoc
    - `bulkReview` Javadoc value list + example body (lines ~117-146): change
      `"status": "accepted"` → `"review_status": "approved"` and refresh the
      documented vocabulary.
  - [x] 2.10 Run ONLY the AMS findings tests
    - Run `mvn -DskipTests=false test -Dtest=DiscoveryFindingBulkReviewTest,<single-row review test class>`
      in `architecture-model-service` (or the equivalent narrowed `-Dtest` selector
      for the findings suites touched in 2.1).
    - Verify the 2-8 tests from 2.1 pass; do NOT run the full module suite here.

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass.
- `ALLOWED_REVIEWER_STATUSES == {approved, rejected, deferred}`; `ALLOWED_TRANSITIONS` is gone; any→any transitions succeed.
- `previous_review_status` is captured on every transition (single-row, PATCH, and bulk paths via `applyStatusChange`).
- Bulk `skipped_by_reason.transition_not_allowed` is always `0`; `already_in_target` still counts same-status rows; `delta_by_from_status` uses the new vocabulary.
- Entity + DTO expose `review_status` / `previous_review_status` at the snake_case wire.

### Frontend (React / TypeScript)

#### Task Group 3: Findings API Types + Tab/Drawer/Modal Surface
**Dependencies:** Task Group 2

Human review surface becomes exactly Approve / Reject / Defer; the `Mark Resolved`
and `Needs Review`/`Mark Needs Review` buttons and the `resolved` pill are removed.

- [x] 3.0 Complete the frontend vocabulary normalization
  - [x] 3.1 Write/adapt 2-8 focused frontend tests
    - Extend `FindingsTab.bulk.test.tsx` (and/or `FindingsTab.test.tsx`) with a
      focused set covering ONLY:
      (a) the bulk toolbar renders Approve / Reject / Defer (no `Mark Resolved`);
      (b) a drawer review click calls `reviewFinding` with `approved`/`rejected`/`deferred`
      (assert on `data-testid="finding-action-approve|reject|defer"`);
      (c) summary pills render `Pending Review / Approved / Rejected / Deferred`
      (no `Resolved` pill) and `applyBulkDelta` deltas them off `delta_by_from_status`;
      (d) the status filter offers the four new `<option>` values.
    - Limit to 2-8 tests; skip exhaustive state/interaction coverage.
  - [x] 3.2 Update `findingsApi.ts` types
    - `DiscoveryFindingStatus` union (lines ~107-112) →
      `'pending_review' | 'approved' | 'rejected' | 'deferred'`.
    - Rename `status` → `review_status` on `DiscoveryFindingDto` (line ~169) and
      add `previous_review_status: string | null`.
    - Rename `status` → `review_status` on
      `CreateDiscoveryFindingRequest` / `UpdateDiscoveryFindingRequest` /
      `ReviewDiscoveryFindingRequest` / `ListFindingsFilters` /
      `BulkReviewFindingsRequest` and the nested filter.
    - `buildQueryString` (lines ~361-373): map `review_status` to the AMS query
      param. Update the `BulkReviewFindingsResponse.delta_by_from_status` Javadoc
      key vocabulary (lines ~306-319). Keep `skipped_by_reason` shape (incl.
      `transition_not_allowed`).
  - [x] 3.3 Update `FindingDetailDrawer.tsx` (lines ~456-492)
    - Replace the four action buttons (`Accept`/`Ignore`/`Mark Needs Review`/
      `Mark Resolved`) with THREE — `Approve` / `Reject` / `Defer` — calling
      `reviewFinding` with `approved` / `rejected` / `deferred`.
    - DELETE the `Mark Needs Review` button (lines ~475-483) and the
      `Mark Resolved` button (lines ~484-492); update `data-testid`s to
      `finding-action-approve|reject|defer`.
    - Re-key `statusBadgeClass` (lines ~53-66) on the new values.
  - [x] 3.4 Update `FindingsTab.tsx` toolbar + labels + badges
    - `BULK_TARGET_STATUSES` (lines ~354-359) → `['approved','rejected','deferred']`
      (drop `resolved`).
    - `STATUS_BUTTON_LABEL` / `STATUS_DISPLAY_LABEL` (lines ~361-375) re-key to
      Approve/Reject/Defer + Approved/Rejected/Deferred.
    - `statusBadgeClass` (lines ~82-95) re-key on the new values.
  - [x] 3.5 Update `FindingsTab.tsx` summary pills + filter + delta paths
    - `computeSummary` (lines ~114-144), pill render (lines ~838-867),
      `applyBulkDelta` (lines ~663-716), `onFindingUpdated` (lines ~615-640):
      replace `needsReview/accepted/ignored/resolved` with
      `pendingReview/approved/rejected/deferred`; DROP the `resolved` pill added
      by the 2026-05-28 work. KEEP "Total" and "Critical + High".
    - Status filter `<option>`s (lines ~882-888) → `pending_review/approved/rejected/deferred`.
  - [x] 3.6 Update `BulkFindingActionConfirmModal.tsx`
    - `statusDisplayLabel` (lines ~32-45) re-map to Approved / Rejected / Deferred.
  - [x] 3.7 Update `FindingsTab.module.css`
    - Re-key / add the status badge CSS classes to the new disposition values;
      remove the now-unused `resolved` badge class. Do NOT restyle the tab layout
      beyond the rename + removed pill/buttons.
  - [x] 3.8 Run ONLY the touched frontend test files
    - `npx vitest run frontend/src/components/Discovery/FindingsTab.bulk.test.tsx frontend/src/components/Discovery/FindingsTab.test.tsx frontend/src/api/findingsApi.test.ts`
      (add `FindingDetailDrawer`/modal test files if they exist).
    - Verify the 2-8 tests from 3.1 pass; do NOT run the entire frontend suite here.

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass.
- Drawer + bulk toolbar surface EXACTLY Approve / Reject / Defer; `Mark Resolved` and `Needs Review` buttons are gone.
- `DiscoveryFindingStatus` and all request/filter types use `review_status` with the four-value vocabulary; `previous_review_status` is on the DTO.
- Summary pills show Pending Review / Approved / Rejected / Deferred (+ Total, Critical + High); no `resolved` pill; filter options match.

### discovery-service (TypeScript — emit path)

#### Task Group 4: FindingEmitter Emit Alignment
**Dependencies:** Task Group 2 (wire field rename must match AMS)

Single-spot defensive + emit-field update. No scanner emits a disposition today,
so this is the only emit-path touch.

- [x] 4.0 Align the discovery-service emit path
  - [x] 4.1 CAUTION GATE — confirm no discovery run is active
    - Per `feedback_no_src_edits_during_run.md`, `tsx watch` reloads on any
      `discovery-service/src/**` edit and will kill an in-flight run. Verify no
      run is active before editing 4.2/4.3.
  - [x] 4.2 Update `FindingEmitter.ts` vocabulary + emit
    - `FindingStatus` type + `VALID_STATUSES` set (lines ~66-78) →
      `{pending_review, approved, rejected, deferred}`; update the doc comment
      at lines ~14-16 and the warning string at lines ~464-465.
    - In `prepare(...)`: change the emit default from `status:'new'` to either
      `review_status:'pending_review'` OR omit the field entirely and let AMS
      apply its `pending_review` default (PREFERRED — least coupling). Touch
      lines ~441 (the `status` normalize), ~496-502 (the payload object), and the
      `VALID_STATUSES` guard at ~462.
    - Update `DiscoveryFindingCreatePayload` in `archModelClient.ts` to the
      renamed wire field (`review_status` / `previousReviewStatus` as applicable).
  - [x] 4.3 Write/adapt 2-8 focused discovery-service tests
    - Extend `discovery-service/src/__tests__/archModelClientFindings.test.ts`:
      update the `from_status: 'resolved'` fixture (line ~281) and any
      status-string fixtures to the new vocabulary; add ONE focused test that the
      emit payload carries `review_status: 'pending_review'` (or omits the field,
      per 4.2). Limit to 2-8 tests.
  - [x] 4.4 Run ONLY the touched discovery-service suite
    - `npx jest archModelClientFindings` (or the equivalent path-scoped jest
      invocation) from `discovery-service`.
    - Verify the touched tests pass; do NOT run the entire discovery-service suite here.

**Acceptance Criteria:**
- The touched discovery-service tests pass.
- `FindingEmitter` `VALID_STATUSES`/`FindingStatus` carry the new four-value vocabulary; the emit no longer sends `status:'new'` (sends `review_status:'pending_review'` or omits the field).
- `archModelClient.ts` `DiscoveryFindingCreatePayload` uses the renamed wire field; no edit was made while a run was active.

### Gateway (test fixtures only)

#### Task Group 5: Gateway Findings Proxy Test Fixtures
**Dependencies:** Task Group 2 (new wire vocabulary)

NO route-logic change — `proxyFindingsToAms` is a verbatim body+query
pass-through and never inspects finding status. Only test fixtures asserting old
status strings change.

- [x] 5.0 Update the gateway findings-proxy test fixtures
  - [x] 5.1 Update `discovery-findings-bulk-review-proxy.test.ts`
    - Change request/response fixtures asserting `status:'accepted'` (and the
      other legacy values) to `review_status` + the new vocabulary; update
      `delta_by_from_status` key assertions to the new vocabulary; keep
      `skipped_by_reason` (incl. `transition_not_allowed`) assertions intact.
  - [x] 5.2 Update any other gateway findings tests asserting old status strings
    - Check `discovery-findings-proxy.test.ts` (and any discovery read-route test
      with finding-status fixtures) for legacy `status`/value strings and update
      to `review_status` + the new vocabulary. Do NOT touch route logic in
      `gateway/src/routes/discovery.ts`.
  - [x] 5.3 Run ONLY the touched gateway suites
    - `npx jest discovery-findings-bulk-review-proxy discovery-findings-proxy`
      from `gateway`.
    - Verify they pass; do NOT run the entire gateway suite here.

**Acceptance Criteria:**
- `gateway/src/routes/discovery.ts` has ZERO logic changes (verify via `git diff` that only `__tests__` files changed for the gateway).
- The touched gateway proxy tests pass against the new `review_status` vocabulary.

### Cross-Stack Verification

#### Task Group 6: Cross-Stack Verification + Fixture/Snapshot Drift
**Dependencies:** Task Groups 1-5

- [x] 6.0 Reconcile remaining fixture drift and verify the four touched stacks
  - [x] 6.1 Sweep for residual legacy status strings in test/fixture files only
    - Grep the findings-adjacent test files for stragglers asserting
      `new`/`accepted`/`ignored`/`needs_review`/`resolved` as a finding
      `status`: frontend `FindingsTab.crossStack.test.tsx`,
      `FindingsTab.dataLayerFidelity2.test.tsx` (if present), `findingsApi.test.ts`;
      discovery-service `archModelClientFindings.test.ts`; gateway findings tests.
    - Update each to `review_status` + the new vocabulary. Do NOT broaden to
      candidate/unrelated suites (candidate `review_status` is unaffected).
    - SWEEP RESULT: all-repo grep (`needs_review`, `\bignored\b`, `\bresolved\b`,
      `'new'`/`"new"`, bulk bodies keyed `status`) found every residual hit to be
      either a DIFFERENT domain (candidate `review_status`; api-behaviour-scenario
      / diff-findings / architecture-element-mapping `status`; decision-task
      `status`; migration-context `countsByStatus`/`dismissed`; Java `new` token;
      English word "resolved"), or a deliberate retirement assertion/comment
      (`.doesNotContain("new","accepted","ignored","needs_review","resolved")`,
      `queryByTestId('findings-bulk-action-resolved').not.toBeInTheDocument()`,
      retirement Javadoc). ONE genuine stale findings fixture fixed:
      `gateway/src/__tests__/migrationDiscoveryContext.test.ts` (`countsByStatus`
      `{needs_review,accepted,dismissed}` → `{pending_review,approved,rejected,
      deferred}` and `highPriorityFindings[0].status 'needs_review'` →
      `'pending_review'`, to match the post-Spec-F AMS `review_status` contract).
  - [x] 6.2 Run the AMS findings tests (narrowed)
    - `mvn -q -Dtest='DiscoveryFinding*,DiscoveryFindingsReviewStatusChangesetTest,MigrationDiscoveryContextServiceTest,MigrationSpecContextResolverTest' test`
      in `architecture-model-service`. GREEN: 81 tests, 0 failures, 0 errors
      across the 14 selected classes (today's Surefire reports). The 5 stale
      failures visible in `target/surefire-reports/` are 2-day-old reports from
      prior full-module runs (`ApiContractSmokeTest`,
      `ArchitectureElementInventoryService*`), NOT selected by this `-Dtest`
      filter and NOT findings-domain.
  - [x] 6.3 Run the frontend findings tests
    - `npx vitest run` on `FindingsTab.bulk.test.tsx`, `FindingsTab.test.tsx`,
      `FindingsTab.crossStack.test.tsx`, `findingsApi.test.ts` (20 tests) PLUS
      `FindingsTab.dataLayerFidelity2.test.tsx` + `findingTypeLabels*.test.tsx`
      (47 tests). GREEN: 67 tests across 7 suites.
  - [x] 6.4 Run the discovery-service + gateway findings suites
    - discovery-service: `npx jest findingEmitter archModelClientFindings` —
      GREEN (2 suites, 16 tests; emit confirmed to OMIT `review_status` and let
      AMS default).
    - gateway: `npx jest discovery-findings migrationDiscoveryContext` — GREEN
      (6 suites, 18 tests, incl. the updated `migrationDiscoveryContext.test.ts`).
  - [x] 6.5 Confirm scope containment
    - `git diff --stat` shows NO change under `mcp-server/` (clean), NO non-test
      change under `gateway/` (only `discovery-findings-*` + `migrationDiscoveryContext`
      `__tests__` files), and `135-discovery-findings.sql` is byte-unchanged
      (zero git diff). `gateway/src/routes/discovery.ts` has zero diff.
    - No NEW test was added beyond the focused per-group sets + the single 6.1
      drift fix (gateway `migrationDiscoveryContext.test.ts` fixture values only).

**Acceptance Criteria:**
- All four stacks' findings-specific suites are green (AMS `DiscoveryFinding*`, frontend findings tests, discovery-service `archModelClientFindings`, gateway findings proxy tests).
- No residual legacy finding-status string remains in the findings-adjacent test/fixture files.
- Scope is contained: `135-...sql` unchanged, no mcp-server change, no gateway route-logic change.

## Execution Order

Recommended implementation sequence:
1. Database Layer — new Liquibase changeset + value migration (Task Group 1)
2. Backend AMS — service/entity/DTO/controller + in-flight bulk reconciliation (Task Group 2)
3. Frontend — API types + tab/drawer/modal/CSS (Task Group 3)
4. discovery-service — FindingEmitter emit alignment, run-gate respected (Task Group 4)
5. Gateway — test-fixture-only updates (Task Group 5)
6. Cross-stack verification + fixture/snapshot drift (Task Group 6)
