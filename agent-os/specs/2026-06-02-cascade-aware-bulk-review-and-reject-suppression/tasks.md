# Task Breakdown: Cascade-aware Bulk Review + Reject Suppression (Spec 2)

## Overview
Total Tasks: 6 task groups

Spec 2 of the discovery-review-unification program (F -> 0 -> 1 -> 2 -> 3): the
DETERMINISTIC (no-LLM) cascade-aware bulk Approve/Reject/Defer/Save layer on top
of Spec 1's READ-ONLY blast-radius backbone, plus REAL + COMPLETE read-time
suppression of `rejected` from every downstream migration-planning consumer.

### Overriding directive — ALWAYS hold the oracle standard

- **Suppression is the highest-stakes requirement.** It must be REAL, COMPLETE
  wiring — a rejected finding/candidate must be GENUINELY ABSENT from BOTH
  downstream context builders, from the LLM PAYLOADS *and* the SUMMARY COUNTS.
  No stubs, no "set but ignored" flag. Tests must prove absence in both contexts
  including counts, AND that `deferred` stays visible, AND a reject -> absent ->
  re-approve -> present reversibility round-trip.
- **The bulk apply is ATOMIC (all-or-nothing).** ONE `@Transactional` AMS
  endpoint spans candidates AND their linked findings; ANY single-entity failure
  rolls back the WHOLE batch. Preserve every entity's `previous_review_status`
  audit + `reviewed_at`; respect `committed` gating; any->any transitions.
- **NO AMS schema / Liquibase change is needed or permitted.** Suppression keys on
  the EXISTING `review_status` column via a new read-time finder. NEVER edit an
  applied Liquibase changeset (`feedback_liquibase_immutable_changesets`) — even a
  comment-only edit breaks startup with a checksum-validation error.
- **No git operations** (`feedback_no_git_operations`): stop at code + scoped
  verification; the user owns all commits/branches/pushes.
- **AMS speaks snake_case at the wire by default** (`spring.jackson.property-naming-strategy: SNAKE_CASE`).
  The new DTOs need NO `@CamelCaseWire`. Honour the meta-model: `*_points`
  polymorphic wrappers are backend-managed and NEVER user-acted (already excluded
  from the review model via `POINTS_WRAPPER_TYPES`).
- **Minor:** this spec barely touches `discovery-service`. If any
  `discovery-service/src/**` edit arises, FIRST confirm no active discovery run
  (`feedback_no_src_edits_during_run`) — tsx watch auto-reloads kill runs.

### Test command reference
- AMS = Maven, scoped: `mvn -Dtest=<ClassName> test` (run from the
  `architecture-model-service` module dir).
- Gateway = jest, scoped to the new test file.
- Frontend = `npx vitest run <files>` (run from the `frontend` dir).
- Each group runs ONLY its own newly-written tests, NOT the whole suite.

## Task List

### AMS Backend

#### Task Group 1: AMS atomic bulk review endpoint (candidates + linked findings)
**Dependencies:** None
**Stack:** architecture-model-service (Java / Maven)

Add a new `@Transactional` AMS-native endpoint that applies ONE review action
(`approved` / `rejected` / `deferred`) across a curated set spanning discovery
candidates AND discovery findings in a SINGLE transaction. ANY entity failure
rolls back ALL of it. Model the transaction/audit/delta mechanics on the existing
finding `DiscoveryFindingService.bulkReview` (lines 457-529 of
`.../service/discovery/DiscoveryFindingService.java`) +
`BulkReviewDiscoveryFindingsRequest`/`...Response`, but spanning BOTH entity kinds.

- [x] 1.0 Complete the AMS atomic bulk review endpoint
  - [x] 1.1 Write 2-8 focused JUnit tests (mirror `DiscoveryFindingBulkReviewTest`)
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/discovery/CascadeBulkReviewTest.java`
      (sibling of the existing `discovery/DiscoveryFindingBulkReviewTest.java`)
    - Cover ONLY the load-bearing behaviours; limit to 2-8 tests total:
      - Happy path: a curated set of candidates + linked findings all transition to
        the requested `review_status` in ONE transaction; per-kind `updated_count`
        and `delta_by_from_status` are exact.
      - **Atomic rollback (oracle-critical):** inject a partial failure (an
        out-of-scope / non-existent id in the set, which the scope check turns into
        a `ResourceNotFoundException`) and assert the WHOLE batch rolls back — NO
        candidate AND NO finding is mutated (re-read every row unchanged).
      - `committed` gating: a `committed` candidate in the id set is SKIPPED
        (counted, not failed, not transitioned); the rest still apply.
      - Audit + any->any: `previous_review_status` + `reviewed_at` set on every
        updated candidate AND finding; same-disposition rows counted
        `alreadyInTarget` (not rewritten); e.g. `rejected` -> `approved` and
        `approved` -> `deferred` both succeed (Spec F unrestricted transitions).
  - [x] 1.2 Create the request/response DTOs (snake_case wire, NO `@CamelCaseWire`)
    - `.../model/dto/discovery/BulkReviewCascadeRequest.java`: carries an explicit
      `candidate_ids` (List<UUID>) AND `finding_ids` (List<UUID>) set (the curated
      set resolved client-side from the preview), plus `review_status` and optional
      `reviewer_notes`. Model on `BulkReviewDiscoveryFindingsRequest`.
    - `.../model/dto/discovery/BulkReviewCascadeResponse.java`: returns PER-KIND
      sub-counts — a `candidates` block and a `findings` block, each with
      `updated_count` / `skipped_count` / `skipped_by_reason` (`already_in_target`
      + the retained-always-0 `transition_not_allowed`) + `delta_by_from_status`.
      Model on `BulkReviewDiscoveryFindingsResponse`.
    - Rely on the global SNAKE_CASE Jackson strategy; do NOT annotate (per CLAUDE.md
      AMS wire-format convention).
  - [x] 1.3 Add the `@Transactional` cascade-bulk service method
    - Home: a new method on `DiscoveryCandidateService` (e.g. `bulkReviewCascade`)
      OR a small dedicated service that injects both the candidate and finding
      repositories — choose the single boundary that keeps BOTH arms inside ONE
      `@Transactional`. The candidate arm MUST stay consistent with
      `reviewCandidate` (lines 395-424): `VALID_REVIEW_STATUSES = {approved,
      rejected, deferred}`, any->any, capture `previous_review_status` +
      `reviewed_at` + `reviewed_by` per row.
    - Finding arm: reuse the existing finding `applyStatusChange` semantics
      (preserve `previous_review_status` + `reviewed_at`); same-disposition rows
      counted `alreadyInTarget`.
    - Capture both per-kind `delta_by_from_status` accumulators PRE-mutation; use
      `saveAll` + a single `flush` per repository (mirror the finding pattern, do
      NOT per-row `saveAndFlush`).
    - **`committed` gating:** candidate `status` (`proposed`/`committed`) is DISTINCT
      from `review_status`. Do NOT transition a `committed` candidate row — count it
      skipped, not failed (mirror the gateway fan-out's
      `review_status !== 'committed'` skip and the grid's `committed` exclusion).
    - **Scope-verify EVERY supplied id** against `(project, architecture, run)`
      exactly as the finding `resolveCandidates` does (lines 535-554): an id that
      does not load or loads outside scope throws `ResourceNotFoundException`
      (cross-run id injection -> 404), which under the single transaction rolls the
      WHOLE batch back. Verify candidate ids AND finding ids this way.
  - [x] 1.4 Add the controller endpoint
    - `.../controller/DiscoveryCandidateController.java` (base path
      `.../discovery/runs/{runId}/candidates`): add a `@PostMapping` (e.g.
      `/bulk-review-cascade`) taking the `BulkReviewCascadeRequest` body and
      returning `BulkReviewCascadeResponse`. Mirror the finding controller's
      `@PostMapping("/bulk-review")` (lines 155-169): debug-log
      runId/reviewStatus/id-counts; let `ResourceNotFoundException` map to 404 and
      `IllegalArgumentException` to 400 per existing conventions.
  - [x] 1.5 Run ONLY the Group 1 tests
    - `mvn -Dtest=CascadeBulkReviewTest test` (from the `architecture-model-service`
      module dir). Do NOT run the full AMS suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass.
- The endpoint is genuinely ATOMIC: the rollback test proves NO candidate and NO
  finding mutates on any single-entity failure.
- `previous_review_status` + `reviewed_at` preserved on every updated row of BOTH
  kinds; same-disposition rows counted `alreadyInTarget`, not rewritten.
- `committed` candidates are skipped (counted), not transitioned or failed.
- snake_case wire on both DTOs; no `@CamelCaseWire`. No schema / Liquibase change.

#### Task Group 2: AMS read-time IR suppression of `rejected` (highest-stakes)
**Dependencies:** None (independent of Group 1; can proceed in parallel)
**Stack:** architecture-model-service (Java / Maven)

Make "reject" mean GENUINELY EXCLUDED from every downstream migration-planning
consumer. This is the oracle-critical group. Apply a read-time filter keyed on the
LIVE `review_status` column (NO schema change, NO IR mutation) at BOTH confirmed
leak sites, excluding `rejected` from BOTH the LLM payloads AND the summary counts.
Leave `deferred` VISIBLE. Do NOT touch save-back (already correct).

- [x] 2.0 Complete the read-time suppression of `rejected` at both context builders
  - [x] 2.1 Write 2-8 focused JUnit tests (the oracle-critical proof)
    - Files (sibling of the existing migration service tests under
      `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/`):
      e.g. `MigrationDiscoveryContextSuppressionTest.java` and
      `MigrationSpecContextSuppressionTest.java` (or one combined class). Limit to
      2-8 tests total across them:
      - `MigrationDiscoveryContextService`: a `rejected` finding is ABSENT from
        `highPriorityFindings` AND from `buildFindingsSummary` counts; a `rejected`
        candidate is ABSENT from `buildCandidateSummary` counts; a `deferred`
        finding AND a `deferred` candidate are STILL PRESENT in both.
      - Evidence: evidence whose ONLY linking findings are `rejected` is ABSENT from
        the evidence highlights; evidence ALSO linked by a non-rejected finding
        SURVIVES.
      - `MigrationSpecContextResolver.loadFindings`: a `rejected` finding is ABSENT
        from the per-story block context; a `deferred` finding is STILL PRESENT.
      - **Reversibility round-trip:** reject -> assert ABSENT from BOTH context
        builders -> re-approve -> assert PRESENT again on the next context build,
        with nothing else to "unset".
      - (Optional, if cheap) a focused repository unit test that the new
        `review_status`-filtered finder returns exactly the non-rejected slice.
  - [x] 2.2 Add the `review_status`-filtered finder(s) to `DiscoveryFindingRepository`
    - `.../repository/discovery/DiscoveryFindingRepository.java`: add a finder that
      excludes a given `review_status` (or returns only non-rejected) — a variant of
      `findByRunIdAndProjectIdAndArchitectureId` AND of
      `findByProjectIdAndArchitectureIdAndRunIdNotNull` (the two finders the leak
      sites call). Key on the LIVE `review_status` column. NO schema change, NO
      `@Modifying`, NO IR mutation — a plain read finder / derived query.
  - [x] 2.3 Suppress `rejected` in `MigrationDiscoveryContextService`
    - File: `.../service/migration/MigrationDiscoveryContextService.java`.
    - `loadFindingsForRuns` (lines 602-613): use the new finder so its result
      excludes `rejected`. Because `allFindings` feeds BOTH `buildFindingsSummary`
      (counts, lines 854-875) AND `highPriorityFindings`
      (`prioritiseAndCap` -> `toFindingHighlight`, lines 308/340-341), filtering at
      the load excludes `rejected` from BOTH the payload AND the counts in one move.
    - `buildCandidateSummary` (lines 891-903): exclude candidates whose
      `review_status === 'rejected'` from the candidate counts. NOTE: this method
      today tallies by candidate `status` (`proposed`/`committed`) — a DIFFERENT
      field; apply the suppression filter on `review_status` BEFORE the
      by-`status`/by-`type` tally. (No `review_status`-aware candidate finder exists
      — either add one to the candidate repository or filter the loaded list
      in-method; do NOT change the existing by-`status` tally semantics for
      non-rejected rows.)
    - Evidence highlights (`loadEvidenceLinksForFindings` ->
      `buildEvidenceHighlights`, lines 700-760): evidence has NO `review_status` of
      its own and is reached ONLY through its linking finding — because the rejected
      findings are now dropped upstream, their evidence is naturally dropped from the
      highlight set. ASSERT this (drop evidence whose ONLY linking findings are
      rejected); no separate evidence-level filter to add.
    - Leave `deferred` VISIBLE.
  - [x] 2.4 Suppress `rejected` in `MigrationSpecContextResolver`
    - File: `.../service/migration/MigrationSpecContextResolver.java`.
    - `loadFindings` (lines 1008-1034): use the new non-rejected finder so every
      per-story block builder (`buildServiceBlock` / `buildApiBlock` /
      `buildSoapBlock` / `buildDataBlock` / `buildTestPackBlock` via
      `boundedFindings`) never sees rejected IR. Leave `deferred` VISIBLE.
  - [x] 2.5 Confirm save-back is UNTOUCHED (note it is correct)
    - Do NOT modify `mcp-server/src/services/candidateSaveBackService.ts`
      (`REVIEW_EXCLUDED_STATUSES = ['rejected','deferred']`, manual mode = only
      `approved`) — it already feeds the target-state path safely. This is a
      no-edit confirmation step, recorded here so the suppression sweep stays
      complete and save-back is not accidentally double-filtered.
  - [x] 2.6 Run ONLY the Group 2 tests
    - `mvn -Dtest=MigrationDiscoveryContextSuppressionTest,MigrationSpecContextSuppressionTest test`
      (from the `architecture-model-service` module dir). Do NOT run the full suite.

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass.
- A `rejected` finding is GENUINELY ABSENT from BOTH the
  `MigrationDiscoveryContextService` payload+counts AND the
  `MigrationSpecContextResolver` per-story context — payloads AND counts.
- A `rejected` candidate is absent from the candidate-summary counts; evidence
  reachable ONLY through rejected findings is dropped.
- `deferred` findings AND candidates remain VISIBLE downstream.
- The reject -> absent -> re-approve -> present round-trip passes (automatic
  reversibility; nothing to "unset").
- No schema / Liquibase change; suppression keyed on the live `review_status`.
- Save-back unchanged.

### Gateway

#### Task Group 3: Gateway proxy for the atomic bulk endpoint
**Dependencies:** Task Group 1 (the AMS endpoint contract)
**Stack:** gateway (TypeScript / jest)

Add a thin gateway route proxying the new AMS atomic cascade-bulk endpoint,
following the EXISTING pure-proxy idiom in `gateway/src/routes/discovery.ts`
(forward status + body verbatim, snake_case body, `requestId` logging, 503 on
network error). NO business logic of its own — atomicity + gating live in AMS.

- [x] 3.0 Complete the gateway proxy route
  - [x] 3.1 Write 2-8 focused jest tests (mirror `discovery-findings-bulk-review-proxy.test.ts`)
    - File: `gateway/src/__tests__/discovery-cascade-bulk-review-proxy.test.ts`
      (sibling of the existing `discovery-findings-bulk-review-proxy.test.ts`).
    - Cover ONLY: the route forwards the snake_case body (`candidate_ids` +
      `finding_ids` + `review_status`) to the AMS cascade endpoint; passes the AMS
      status + body through verbatim (e.g. a 200 success body and a 404 from a
      cross-run id); returns 503 on an AMS network error; logs `requestId`. It adds
      NO business logic (atomicity/gating asserted at the AMS layer, not here).
  - [x] 3.2 Add the proxy route in `gateway/src/routes/discovery.ts`
    - Register a `POST` route proxying to the AMS cascade-bulk endpoint, mirroring
      the finding bulk-review proxy + the `review-model` proxy (line ~572) and
      `save-approved` proxy conventions: `requestId` logging, status passthrough,
      snake_case body forwarded unchanged, 503 on network failure. The existing
      best-effort candidate fan-out (`POST .../candidates/bulk-review`, lines
      ~1388-1487) is REPLACED for the cascade-apply path by this route; the
      `review-model` proxy and `save-approved` proxy are UNCHANGED.
  - [x] 3.3 Confirm the thin context clients need NO change (pass-through)
    - Confirm `migrationDiscoveryContextClient.ts` / `migrationSpecContextClient.ts`
      stay pass-through — suppression lives in AMS (Group 2); do NOT add any
      filtering in the gateway clients. No-edit confirmation step.
  - [x] 3.4 Run ONLY the Group 3 tests
    - jest, scoped to `discovery-cascade-bulk-review-proxy.test.ts`. Do NOT run the
      full gateway suite.

**Acceptance Criteria:**
- The 2-8 tests in 3.1 pass.
- The route is a pure proxy: status + snake_case body passthrough, `requestId`
  logged, 503 on network error, NO business logic.
- The context clients are confirmed untouched / pass-through.

#### Task Group 4: Shared `resolveBulkActionSet` pure helper (gateway home)
**Dependencies:** Spec 1 `ReviewModel` wire shape only (independent of Groups 1-3)
**Stack:** gateway (TypeScript / jest)

A PURE function (no React, no I/O, no LLM) over the snake_case `ReviewModel` wire
shape. CANONICAL home = the gateway, because Spec 3's coordinator runs SERVER-SIDE
in the gateway (`gateway/src/services/architectConversation/architectConversationCoordinator.ts`)
and must import it directly. The frontend MIRRORS the identical pure logic against
the SAME wire types (Group 5), guarded by the Group-4 contract test so there is ONE
logic, not two divergent copies.

- [x] 4.0 Complete the shared resolve-bulk-action-set helper
  - [x] 4.1 Write 2-8 focused jest tests + the wire-shape contract test
    - Unit test file: `gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts`.
      Cover ONLY: given a seed selection + a `ReviewModel`, the helper returns seed
      candidates + transitive dependents (from `blast_radius[].dependents`) + each
      touched candidate's linked findings (findings whose `candidate_link_ids`
      include a touched candidate); cascade provenance (`via_edge_kind` +
      `via_predecessor_id`) is correct per dependent; net counts match
      `blast_radius`/`aggregations`; cycle-safe (no infinite loop on a cyclic
      graph); a candidate with no dependents/findings returns just itself.
    - Contract test (mirror `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`):
      guard that the `ReviewModel` wire shape the helper consumes (the
      `blast_radius` / `dependents` / `findings.candidate_link_ids` /
      `aggregations` fields) matches the shape the frontend mirror will consume —
      so the two copies cannot silently diverge.
  - [x] 4.2 Implement the pure helper
    - File: `gateway/src/services/discovery/resolveBulkActionSet.ts`. Signature:
      given `{ seedCandidateIds, action }` + the `ReviewModel`, return the full
      touched set — `{ candidates, findings }` with per-item cascade provenance
      (`via_edge_kind` + `via_predecessor_id`, and `via_predecessor` for the seed
      vs cascaded distinction) + net counts derived from
      `blast_radius`/`aggregations`. PURE — no React, no I/O, no LLM. It is the ONLY
      place cascade-set resolution lives: the grid's confirm modal is a THIN
      renderer over its output; Spec 3's coordinator calls it headlessly with the
      same inputs.
    - Define / import the shared snake_case wire types it operates on (mirroring
      Spec 1's `discovery-service/.../reviewModel/types.ts`: `BlastRadiusEntry`,
      `BlastRadiusDependent`, `ReviewFindingNode.candidate_link_ids`,
      `ReviewModelAggregations`, `EdgeKind`, `POINTS_WRAPPER_TYPES`).
  - [x] 4.3 Run ONLY the Group 4 tests
    - jest, scoped to `resolveBulkActionSet.test.ts` + the contract test. Do NOT run
      the full gateway suite.

**Acceptance Criteria:**
- The 2-8 unit tests + the contract test in 4.1 pass.
- The helper is PURE and headless (callable by both the gateway coordinator and the
  frontend mirror).
- Cascade provenance + net counts are correct; cycle-safe; seed-only case returns
  just the seed.
- The contract test guards the single shared wire shape (no divergent copies).

### Frontend

#### Task Group 5: Grid bulk toolbar + `BulkCandidateActionConfirmModal` + bulk Save
**Dependencies:** Task Group 3 (proxy) + Task Group 4 (resolve helper + contract test)
**Stack:** frontend (React / TypeScript / Vitest)

Render the blast-radius preview and wire the atomic apply + bulk Save into the
candidate grid, using `reviewModel.blast_radius` + `aggregations` ALREADY fetched
on mount (no new fetch for the preview). Curation lives in the MODAL only — the grid
keeps its `'all' | 'filtered'` scope; NO per-row checkboxes.

- [x] 5.0 Complete the grid bulk toolbar, confirm modal, atomic apply, and Save
  - [x] 5.1 Write 2-8 focused Vitest tests
    - Files (siblings of the existing
      `frontend/src/components/Discovery/FindingsTab.bulk.test.tsx` /
      `DiscoveryCandidateTable` tests): e.g.
      `frontend/src/components/Discovery/BulkCandidateActionConfirmModal.test.tsx`
      and a `DiscoveryCandidateTable.bulkCascade.test.tsx`. Limit to 2-8 total:
      - `BulkCandidateActionConfirmModal` renders the preview: net counts, the items
        pulled in BY CASCADE with their edge provenance; toggling a deselect removes
        a dependent/finding from the curated set; confirm posts ONLY the curated ids.
      - On confirm, the grid calls the NEW atomic cascade endpoint (the new frontend
        API fn / gateway proxy) — NOT the per-row `bulkReviewCandidates` fan-out —
        and optimistically updates candidate state via `onCandidatesChange`, leaving
        `committed` rows untouched.
      - Bulk Save invokes the existing `save-approved` path and triggers the SAME
        post-save cache refresh — assert the cache dispatch fires (`LOAD_MODEL`
        same-arch / `invalidateArchitectureModelCache` cross-arch).
  - [x] 5.2 Mirror the resolve helper on the frontend (ONE logic, contract-guarded)
    - Add the frontend MIRROR of `resolveBulkActionSet` (identical pure logic against
      the SAME snake_case wire types), e.g.
      `frontend/src/components/Discovery/resolveBulkActionSet.ts`. The frontend does
      NOT import gateway source across the build boundary — parity is held by the
      Group-4 contract test, not a code import. Widen the frontend `ReviewModel`
      client types in `frontend/src/api/discoveryApi.ts` to include `blast_radius`
      + `findings` (today the client copy carries only `nodes` + `aggregations`,
      lines ~359-362) so the mirror has the fields it needs.
  - [x] 5.3 Build `BulkCandidateActionConfirmModal` (sibling of `BulkFindingActionConfirmModal`)
    - Files: `frontend/src/components/Discovery/BulkCandidateActionConfirmModal.tsx`
      + `.module.css` (sibling of `BulkFindingActionConfirmModal.tsx` +
      `.module.css`). A THIN renderer over the resolve-helper output: net counts,
      which items are pulled in BY CASCADE and via which edge (provenance), each
      dependent / linked-finding DESELECTABLE, optional reviewer-note textarea,
      in-flight spinner, escape/overlay dismiss. Match the sibling modal's
      header/content/footer structure.
  - [x] 5.4 Add the bulk toolbar + atomic-apply wiring in the grid
    - File: `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`.
      Add bulk-toolbar buttons next to the existing ones (lines ~945-996): the
      Reject / Defer / Approve actions open `BulkCandidateActionConfirmModal`
      PRE-SELECTING the FULL Spec 1 blast-radius for the seeded candidates. The
      preview renders over `reviewModel.blast_radius` + `aggregations` ALREADY
      fetched on mount (line ~496) — NO new fetch. Keep the grid's existing
      `'all' | 'filtered'` scope; NO per-row checkboxes (curation is in the modal).
    - On confirm, call the new atomic bulk endpoint via a new frontend candidate API
      fn (add to `frontend/src/api/discoveryApi.ts`, sibling of
      `bulkReviewCandidates`) with the curated `candidate_ids` + `finding_ids`,
      REPLACING the best-effort per-row `bulkReviewCandidates` fan-out for the
      cascade-apply path. On success, update optimistic candidate state via
      `onCandidatesChange` as `handleBulkReview` does (lines ~787-792), leaving
      `committed` rows untouched.
  - [x] 5.5 Wire bulk Save (reuse `save-approved` verbatim + the same cache refresh)
    - Surface a Save action in the grid's bulk toolbar reusing the EXISTING
      `save-approved` path verbatim (`saveApprovedCandidates` -> mcp-server
      `saveDiscoveryCandidatesToModel(mode='manual')`, commits
      `review_status === 'approved'` and transitions to `committed`). Wire the SAME
      post-save AppShell cache handling the run-detail page already does
      (`DiscoveryRunDetailPage.handleSaveApprovedConfirmed`, lines ~420-513):
      `LOAD_MODEL` same-arch, `archCtx.invalidateArchitectureModelCache(runArchitectureId)`
      cross-arch (per `project_appshell_model_cache`), plus the existing
      candidate/run/list refreshes. Save commits the WHOLE approved set for the run
      (one Save meaning) — it is NOT part of the review-action endpoint.
  - [x] 5.6 Run ONLY the Group 5 tests
    - `npx vitest run src/components/Discovery/BulkCandidateActionConfirmModal.test.tsx src/components/DashboardView/DiscoveryCandidateTable.bulkCascade.test.tsx`
      (from the `frontend` dir). Do NOT run the full frontend suite.

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass.
- The modal renders the cascade preview (net counts + cascade-pulled items + edge
  provenance) with working deselect; confirm posts ONLY the curated ids.
- Confirm calls the ATOMIC endpoint (not the per-row fan-out) and optimistically
  updates state, leaving `committed` rows untouched.
- Bulk Save reuses `save-approved` and fires the SAME AppShell cache refresh.
- The frontend mirror is the SAME logic as the gateway helper (contract-guarded);
  the grid keeps `'all' | 'filtered'` scope with NO per-row checkboxes.

### Verification

#### Task Group 6: Cross-stack verification
**Dependencies:** Task Groups 1-5
**Stack:** AMS (Maven) + gateway (jest) + frontend (Vitest)

Confirm the feature works end-to-end across the stack, with the oracle-critical
suppression + atomicity behaviours genuinely proven. This group runs the
feature-specific tests written in Groups 1-5 (no broad new test sweep); add a
SMALL number of strategic end-to-end tests ONLY to fill a critical gap.

- [x] 6.0 Cross-stack verification
  - [x] 6.1 Re-run the feature tests from Groups 1-5
    - AMS: `mvn -Dtest=CascadeBulkReviewTest,MigrationDiscoveryContextSuppressionTest,MigrationSpecContextSuppressionTest test`
    - Gateway: jest scoped to `discovery-cascade-bulk-review-proxy.test.ts` +
      `resolveBulkActionSet.test.ts` + the contract test.
    - Frontend: `npx vitest run` scoped to the Group 5 files.
  - [x] 6.2 Confirm the oracle-critical behaviours hold end-to-end
    - Atomic rollback: a partial-failure batch mutates NOTHING (Group 1).
    - Suppression in BOTH context builders incl. COUNTS, with `deferred` still
      present, and the reject -> absent -> re-approve -> present round-trip
      (Group 2).
    - Resolve-helper correctness: linked findings + cascade provenance + net counts
      (Group 4), with the frontend mirror contract-guarded (Group 5).
    - Bulk Save + the AppShell cache refresh; the modal preview render +
      curation/deselect (Group 5).
  - [x] 6.3 Add up to 10 strategic tests ONLY for a critical gap
    - Add a MAXIMUM of 10 new tests, and ONLY if 6.1/6.2 surface a genuine
      end-to-end gap (e.g. the curated-set round-trip from modal deselect -> atomic
      endpoint -> persisted state, or a suppression integration across both builders
      in one run). Focus on integration / end-to-end seams. Do NOT add exhaustive
      coverage, edge-case, performance, or accessibility tests unless
      business-critical.
  - [x] 6.4 Run the feature-specific tests only
    - Run ONLY the tests from 1.1, 2.1, 3.1, 4.1, 5.1, and any from 6.3 — across
      AMS / gateway / frontend. Do NOT run the entire application test suite.

**Acceptance Criteria:**
- All feature-specific tests pass across AMS, gateway, and frontend.
- The atomic-rollback, dual-context suppression (incl. counts), deferred-visible,
  and reversibility round-trip behaviours are demonstrably correct end-to-end.
- No more than 10 additional tests added, only to fill critical gaps.
- Verification stays focused on this spec's feature; the broader suite is not run.

## Execution Order

Recommended implementation sequence (Groups 1 and 2 are independent and may run in
parallel; 2 is the highest-stakes; 4 is independent of 1-3):

1. AMS atomic bulk endpoint (Task Group 1) — and, in parallel:
2. AMS read-time IR suppression (Task Group 2) — oracle-critical
3. Gateway proxy (Task Group 3) — needs Group 1's contract
4. Shared `resolveBulkActionSet` helper + contract test (Task Group 4) — independent
5. Grid bulk toolbar + confirm modal + bulk Save (Task Group 5) — needs Groups 3 + 4
6. Cross-stack verification (Task Group 6) — needs Groups 1-5
