# Task Breakdown: Deterministic Findings-Coverage Verification + Gap Wayfinding

## Overview

Total Tasks: 5 task groups (27 sub-tasks)

Replace the LLM-asserted (and currently broken) `findingsAddressed` /
`findingsNotAddressed` numbers with deterministic, code-computed coverage:
the gateway snapshots accepted critical/high discovery findings into
`generationSummary` at plan CREATE time (dedicated paged AMS read, two
severity passes, fail-soft), and a single frontend module grades the
snapshot ON READ against `book_of_work_json.items[].discoveryFindingReferences`.
Every readiness gap code gains a human explanation plus a deep link (or
nearest-route link) via one frontend wayfinding registry, fed by two cheap
route-param additions (`?findingId=`, `?room=open`) on the discovery run
detail page. Five surfaces consume the shared compute: wizard readiness
cards, the review workspace's new unaddressed-findings panel, the progress
summary, the draft list, and the dashboard `MigrationDeliverySummaryCards`.

**Cross-cutting constraints (apply to every group):**

- **No AMS changes anywhere.** No schema, endpoint, or write changes;
  `generation_summary_json` stays immutable post-create — the snapshot is
  composed in the gateway BEFORE the Stage-5 `createDraft` call.
  `MigrationGapCodes` / readiness assessment are read-only references.
- **No LLM in the grade.** The LLM keeps producing
  `discoveryFindingReferences`; pure code grades them. Matching is
  deterministic: trimmed, case-insensitive id equality — no fuzzy/title
  matching anywhere.
- **Coverage source is the dedicated paged AMS findings read** with explicit
  `status=approved` + per-severity filters. NEVER the context's
  `highPriorityFindings` (all-statuses, capped at 100).
- **Advisory-only.** Coverage numbers and gap cards never gate Generate,
  Save Draft, Save to Backlog, or expansion; the snapshot fetch failing
  never fails or blocks generation (fail-soft: warn + omit).
- **Back-compat = hide, don't approximate (D8).** `computeFindingsCoverage`
  returns `null` for snapshot-less drafts and every consumer hides its
  coverage section entirely on `null` — no "not computed" badges, no
  fallback derivation from references alone, and the legacy
  `gen.findingsAddressed` values stop rendering for OLD drafts too.
- **One implementation each, no per-surface copies:**
  `frontend/src/utils/findingsCoverage.ts` is the ONLY coverage
  computation; `frontend/src/config/gapWayfindingRegistry.ts` is the ONLY
  code→explanation/destination map (per-finding links via its exported
  `buildUnaddressedFindingEntry`). Surfaces import; they never re-derive.
- **Registry never throws:** unknown codes get a generated fallback entry
  (humanized code, generic explanation, no link); run-scoped destinations
  use `flaggedRunId ?? runIds[0]` and degrade to `/discovery` with no run
  id. All routes are relative to
  `/projects/{projectId}/architectures/{architectureId}`.
- **Route params, not new routes:** `?findingId=` / `?room=open` are
  query-param additions to the existing run detail page; both tolerate
  garbage values and unknown/404 ids without throwing, crashing, or
  showing error banners.
- **Out of scope (do not build):** decision-tasks page; modal routing
  frameworks; server-side `gapContexts` enrichment; retroactive snapshot
  backfill; recompute-on-write hooks in the expansion handler; LLM prompt
  or `discoveryFindingReferences` contract changes; wizard-state
  preservation across "Go to ..." navigation.
- **Two test stacks:** gateway = Jest (`gateway/src/__tests__/`),
  frontend = Vitest. Each group runs ONLY its own newly-written tests;
  never whole suites.
- **Frontend `tsc` baseline:** verify net-zero NEW errors from this spec's
  changes; do NOT chase the pre-existing baseline.

## Task List

### Gateway — Accepted-Findings Snapshot at Create

#### Task Group 1: `fetchAcceptedFindings` seam + snapshot composition in both generation modes + legacy-key stripping
**Dependencies:** None

All changes in `gateway/src/services/migrationBookOfWorkHandler.ts`: a new
deps-seam findings fetcher (paged AMS walk, two severity passes per run),
the deterministic `findingsCoverage` snapshot merged into
`generationSummary` before the Stage-5 create in BOTH generation modes, and
the LLM-emitted legacy keys deleted at create. This defines the snapshot
wire shape every frontend group consumes.

- [x] 1.0 Complete the gateway snapshot layer
  - [x] 1.1 Write 2-8 focused tests for the snapshot composition
    - Limit to 2-8 highly focused tests maximum (Jest, following the
      existing `migrationBookOfWorkHandler` test conventions; the
      `fetchAcceptedFindings` seam injected in every test — no live AMS).
    - Cover ONLY: (a) per-stream mode — `assembleBookOfWork` output's
      `generationSummary` carries
      `findingsCoverage = { findings: [{ id, title, severity, runId }] }`
      sorted by `id`, deterministic and timestamp-free; (b) legacy combined
      mode — same snapshot merged AND any LLM-emitted `findingsAddressed`
      / `findingsNotAddressed` keys deleted before `createDraft`; (c) the
      default fetcher unions TWO severity passes (`severity=critical`,
      `severity=high`) per selected run with `status=approved`, de-duped by
      finding id, paging until a short page (assert URL/param shapes);
      (d) no discovery runs selected → `findingsCoverage` omitted entirely;
      (e) runs selected but zero approved critical/high findings →
      `findingsCoverage` persisted with an empty `findings` array;
      (f) fail-soft — the fetcher throwing logs a warning, appends to the
      existing `warnings` array, omits the snapshot, and generation still
      succeeds.
    - Skip exhaustive pagination-permutation and error-shape coverage.
  - [x] 1.2 Add the `fetchAcceptedFindings` dependency seam
    - Extend `MigrationBookOfWorkHandlerDeps` alongside `fetchContext` /
      `createDraft` with `fetchAcceptedFindings`, defaulting to a paged AMS
      walk per selected discovery run:
      `GET {amsBase}/api/model/projects/{projectId}/architectures/{currentArchitectureId}/discovery/runs/{runId}/findings?status=approved&severity=...&page=&size=`.
    - Copy the page-until-short-page walk + error wrapping from
      `gateway/src/services/dbMigrationPack/inputs.ts` (~lines 559–614).
    - The endpoint's `severity` filter is SINGLE-VALUE: two passes per run
      (`critical`, `high`), union by finding id. `status=approved` filters
      the reviewer disposition (`review_status`) — the "accepted"
      semantics.
  - [x] 1.3 Compose the snapshot into `generationSummary` in BOTH modes
    - Shape: `generationSummary.findingsCoverage = { findings: [{ id,
      title, severity, runId }] }`, sorted by `id`, no timestamps.
    - Per-stream mode: join the existing deterministic-counts composition
      in `assembleBookOfWork` (~line 476). Legacy combined mode (~line
      768): same merge PLUS delete any LLM-emitted `findingsAddressed` /
      `findingsNotAddressed` keys — new drafts never persist LLM-asserted
      coverage in any mode.
    - Both compositions land BEFORE the Stage-5 `createDraft` call
      (`AmsCreateRequestBody`, ~line 899) — `generation_summary_json` is
      immutable post-create.
    - No runs selected → omit `findingsCoverage`; runs selected with zero
      findings → empty `findings` array (an honest "nothing to cover").
  - [x] 1.4 Implement the fail-soft path
    - Fetch error → log a warning, append a generation warning to the
      existing `warnings` array, omit the snapshot; generation proceeds
      normally. Coverage must NEVER fail or block generation.
  - [x] 1.5 Ensure the gateway tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- Both generation modes persist the same deterministic, id-sorted snapshot
  shape; legacy mode strips the LLM-emitted keys at create.
- The default fetcher performs the two-pass paged walk per run; nothing
  reads `highPriorityFindings` for coverage.
- Fetch failure degrades to a warning + absent snapshot with generation
  succeeding; no-runs and zero-findings cases produce omitted vs
  empty-array snapshots respectively.

### Frontend — Shared Compute + Wayfinding Registry

#### Task Group 2: `findingsCoverage.ts`, `gapWayfindingRegistry.ts` (all 14 entries), API typing
**Dependencies:** Task Group 1 (snapshot wire shape)

The two single-source-of-truth modules every surface imports, plus the
typed snapshot in the API modules and the removal of the legacy typed
accessors.

- [x] 2.0 Complete the shared frontend modules
  - [x] 2.1 Write 2-8 focused tests for the compute module and registry
    - Limit to 2-8 highly focused tests maximum (Vitest, pure unit tests —
      no rendering).
    - Cover ONLY: (a) `computeFindingsCoverage` returns `null` when
      `generationSummary.findingsCoverage.findings` is not an array
      (legacy draft, fetch-failed draft, missing summary); (b) correct
      `{ total, addressedCount, notAddressedCount, unaddressed }` from the
      union of `items[].discoveryFindingReferences` across items, with
      trimmed case-insensitive id matching and tolerance of
      missing/non-array reference fields; (c) empty snapshot → totals 0
      and empty `unaddressed` (not `null`); (d) every one of the 13 gap /
      context-warning codes has a registry entry with title, explanation,
      action label, and the spec-table destination (spot-check the route
      strings for run-scoped and nearest-route entries); (e) unknown code
      → generated fallback (humanized snake_case title, generic
      explanation, `buildDestination` returns `null`) — never throws;
      (f) run-scoped destinations use `flaggedRunId ?? runIds[0]` and
      degrade to the `/discovery` listing route when no run id is
      available; (g) `buildUnaddressedFindingEntry` builds
      `/discovery/runs/{runId}?tab=findings&findingId={id}` with the
      finding's own title + severity.
    - Skip exhaustive copy-text assertions for all 14 entries.
  - [x] 2.2 Create `frontend/src/utils/findingsCoverage.ts`
    - `computeFindingsCoverage(generationSummary, items)` → `null` when
      the snapshot is absent/non-array; otherwise `{ total,
      addressedCount, notAddressedCount, unaddressed: [{ id, title,
      severity, runId }] }`.
    - Referenced set = union of `items[].discoveryFindingReferences`
      across the draft's `bookOfWork.items` (tolerate missing/non-array
      fields). Matching: trimmed, case-insensitive id equality only.
    - This is the SINGLE implementation — every surface in Group 4 imports
      it; no per-surface copies.
  - [x] 2.3 Create `frontend/src/config/gapWayfindingRegistry.ts`
    - Export `GAP_WAYFINDING: Record<string, GapWayfindingEntry>` with
      `GapWayfindingEntry = { title, explanation, actionLabel,
      buildDestination(ctx) }`; `ctx = { projectId, architectureId,
      runIds?, flaggedRunId?, baselineIds? }`. Follow the
      `SECTION_LABELS` / `humanizeCandidateType` idiom from
      `DiscoveryReviewRoom.tsx`; lives alongside `personaConfig.ts` /
      `taskConfig.ts`.
    - Populate ALL 14 entries with the spec's exact copy table: the 11
      `MigrationGapCodes` (`no_api_behaviour_baseline`,
      `unresolved_discovery_decisions`,
      `missing_current_to_target_mappings`,
      `no_database_discovery_findings`,
      `high_severity_unreviewed_findings`,
      `missing_oas_for_in_scope_interface`,
      `insufficient_runtime_evidence`, `no_sample_data_hints`,
      `incomplete_capture_coverage`, `under_specified_endpoints`,
      `discovery_harness_inventory_mismatch`), the 2 context warnings
      (`no_discovery_runs_selected`, `no_findings_in_run`), and the
      synthetic per-finding `unaddressed_finding` entry.
    - Destinations per the spec table — run-scoped:
      `/discovery/runs/{runId}?room=open` (decisions, D3 approximate),
      `?tab=findings` (unreviewed / no-findings-in-run),
      `/discovery/runs/{runId}` (under-specified endpoints);
      nearest-route: `/api-behaviour` (baseline, capture coverage,
      inventory mismatch), `/discovery` (DB discovery, runtime evidence,
      sample data, no-runs-selected), `/architecture-design/target-state`
      (mappings), `/metamodel/applications` (OAS upload). All relative to
      the architecture base; `buildDestination` returns `null` when no
      sensible route exists.
    - Generated fallback for unknown codes (humanized snake_case →
      sentence case, "Review this gap with your architect", no link).
    - Export `buildUnaddressedFindingEntry(finding, ctx)` so the review
      workspace and registry share one link construction.
  - [x] 2.4 Type the snapshot + remove the legacy typed accessors
    - Add the `findingsCoverage` snapshot type to
      `MigrationBookOfWorkGenerationSummary` in
      `frontend/src/api/migrationBookOfWorkApi.ts` /
      `migrationDeliveryPlanApi.ts`; remove the `findingsAddressed?` /
      `findingsNotAddressed?` typed accessors (any compile errors this
      surfaces are Group 4's broken reads — coordinate, don't re-add).
  - [x] 2.5 Ensure the shared-module tests pass
    - Run ONLY the 2-8 tests written in 2.1.
    - Confirm net-zero NEW `tsc` errors from this group's changes (the
      accessor removal may be completed in lockstep with Group 4's read
      replacements if needed to keep the baseline clean).
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- One coverage implementation, one registry — no copies anywhere else.
- All 13 codes resolve to entries with the spec's copy + destinations; the
  per-finding helper builds the drawer deep link; unknown codes fall back
  without throwing; missing run ids degrade to `/discovery`.
- `computeFindingsCoverage` returns `null` for snapshot-less drafts and
  exact counts otherwise.

### Frontend — Run Detail Route Params

#### Task Group 3: `?findingId=` (single-finding fetch → drawer) + `?room=open` on the discovery run detail page
**Dependencies:** None (consumed by Group 4's deep links)

Extend the established `TAB_QUERY_PARAM` / `parseTabParam` /
`useSearchParams` idiom in `DiscoveryRunDetailPage.tsx`; thread props
through `DiscoveryRunDetailView.tsx` to the existing drawer and room seams.
Query params on existing routes only — no new routes, no new drawer or
room plumbing.

- [x] 3.0 Complete the route-param additions
  - [x] 3.1 Write 2-6 focused tests for the params
    - Limit to 2-6 highly focused tests maximum (Vitest, alongside the
      existing run-detail page/view tests, API modules mocked).
    - Cover ONLY: (a) `?findingId=X` with no explicit `tab` param → the
      findings tab is active, the single-finding fetch
      (`GET .../findings/{findingId}`) fires, and `FindingDetailDrawer`
      opens with that finding, once, on mount; (b) unknown/404 finding id
      → no drawer, no crash, no error banner; (c) `?room=open` → the
      Discovery Review Room (Architecture Room) opens on load via the
      seeded `reviewRoomOpen` state; (d) garbage param values (e.g.
      `room=banana`, empty `findingId`) → page renders normally, nothing
      throws.
    - Skip exhaustive tab-combination coverage.
  - [x] 3.2 Read `findingId` / `room` in `DiscoveryRunDetailPage.tsx`
    - Same `useSearchParams` pattern as `TAB_QUERY_PARAM` /
      `parseTabParam`; `findingId` present with no explicit `tab` →
      treat the active tab as `findings`.
    - Pass `initialFindingId` and `initialReviewRoomOpen` down to
      `DiscoveryRunDetailView`.
  - [x] 3.3 Thread `initialFindingId` to `FindingsTab` and open the drawer
    - `FindingsTab` fetches the single finding via the existing
      `GET .../findings/{findingId}` (so paging/filters cannot hide it)
      and sets `selectedFinding` to open the existing
      `FindingDetailDrawer`, once, on mount. Unknown/404 → silently no-op.
    - Use the `extractGatewayErrorMessage` idiom for the fetch's error
      handling (swallowed for the 404/no-drawer case).
  - [x] 3.4 Seed `reviewRoomOpen` from `initialReviewRoomOpen`
    - `DiscoveryRunDetailView` gains the prop seeding the existing
      `reviewRoomOpen` state (~line 274); `room=open` is the only
      recognized value.
  - [x] 3.5 Ensure the route-param tests pass
    - Run ONLY the 2-6 tests written in 3.1.
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-6 tests written in 3.1 pass.
- `?findingId=` opens the existing drawer via a single-finding fetch;
  `?room=open` opens the existing room; both default-tab semantics hold.
- Garbage values and unknown ids never throw, crash, or show error
  banners; pages without the params behave exactly as today.

### Frontend — Surfaces

#### Task Group 4: Wizard readiness cards, review-workspace unaddressed panel, progress summary + draft list computed values, dashboard cards
**Dependencies:** Task Groups 2, 3

All five consumer surfaces wired to the Group-2 modules. Styling extends
the wizard's existing `readinessCard` / `warningBanner` / chip module-CSS
conventions and the `secretsPrompt` banner pattern — no new design system,
no visual assets exist.

- [x] 4.0 Complete the surface changes
  - [x] 4.1 Write 2-8 focused tests for the surfaces
    - Limit to 2-8 highly focused tests maximum (Vitest, API modules
      mocked, alongside each surface's existing tests).
    - Cover ONLY: (a) wizard gap codes render explanation cards (registry
      title + explanation + "Go to ..." `Link` with the expected href;
      action label as plain text when `buildDestination` is `null`) and
      `contextWarnings` get the same card treatment; (b) review workspace
      — unaddressed rows render title + severity badge + per-finding
      drawer deep link, the positive "All N ... addressed" state when
      `notAddressedCount === 0` with a non-empty snapshot, the "No
      accepted critical/high findings to cover" empty-snapshot state, and
      the panel + summary coverage entirely hidden for a legacy
      (snapshot-less) draft; (c) progress summary — computed
      addressed/unaddressed values render from `computeFindingsCoverage`
      and BOTH lines disappear for a snapshot-less draft (no more
      always-0); (d) draft list rows show computed counts for
      snapshot-bearing drafts and nothing for legacy rows; (e) dashboard
      cards — the Evidence coverage card gains "Findings addressed: A /
      T" from the fetched draft, omits the line without a snapshot, and a
      draft fetch failure degrades to the current reference-count-only
      card without blocking the dashboard.
    - Skip exhaustive styling and state-permutation coverage.
  - [x] 4.2 Replace the wizard's bare gap chips with explanation cards
    - In `MigrationDeliveryPlanWizard.tsx`, replace the
      `Gaps: {gaps.join(', ')}` row (~lines 676–684) with one card per
      gap code: registry title, explanation, and a "Go to ..." `Link`
      when `buildDestination(ctx)` returns a route (plain action text on
      `null`). `contextWarnings` render the same cards in the readiness
      card area.
    - `ctx` from wizard state: projectId/architectureId from the route,
      selected run ids from the wizard's run selection, `flaggedRunId`
      derived client-side (e.g. the run id on relevant
      `highPriorityFindings` highlights), falling back to the first
      selected run (D4).
    - Navigation away is a plain link (re-fetch on return is acceptable);
      cards stay advisory — no gating of Generate.
  - [x] 4.3 Build the "Unaddressed findings" panel + computed summary in
        `MigrationBookOfWorkReviewWorkspace.tsx`
    - Panel lists each `unaddressed` snapshot finding: title + severity
      badge + a deep link built by `buildUnaddressedFindingEntry`
      (`.../discovery/runs/{runId}?tab=findings&findingId={id}`).
    - `notAddressedCount === 0` + non-empty snapshot → "All N accepted
      critical/high findings are addressed by this plan"; empty snapshot
      → "No accepted critical/high findings to cover"; `null` coverage →
      panel hidden entirely.
    - The workspace's summary area shows the same computed values; the
      panel re-derives from current draft state so it updates after an
      epic expansion refreshes the draft (no recompute hooks).
  - [x] 4.4 Fix `MigrationDeliveryPlanProgressSummary.tsx` + draft list
    - Delete the broken `safeNumber(gen?.findingsAddressed, 0)` reads
      (~lines 360–361, 490–493); render "Findings addressed /
      unaddressed" from `computeFindingsCoverage`, reusing the existing
      count-badge layout, and HIDE both lines on `null`.
    - `MigrationBookOfWorkDraftListView.tsx`: rows show the computed
      counts from each full draft's `book_of_work_json`; snapshot-less
      rows show nothing.
  - [x] 4.5 Fix the dashboard `MigrationDeliverySummaryCards`
    - The dashboard route (`migration-books-of-work/:bookId/delivery`)
      fetches the draft via the existing
      `getMigrationBookOfWork(projectId, bookId)` and passes computed
      coverage into the cards; use the `extractGatewayErrorMessage` idiom
      for the fetch.
    - The Evidence coverage card breakdown gains "Findings addressed:
      A / T" alongside the existing
      `discoveryFindingReferenceCount` line; the line is omitted without
      a snapshot. Draft fetch failure degrades to the current card
      (reference counts only) and never blocks the dashboard load.
  - [x] 4.6 Ensure the surface tests pass
    - Run ONLY the 2-8 tests written in 4.1.
    - Confirm net-zero NEW `tsc` errors from this spec's changes
      (including the Group-2 legacy-accessor removal now that all reads
      are replaced).
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; no new `tsc` errors beyond the
  baseline.
- No surface anywhere still reads `gen.findingsAddressed` /
  `findingsNotAddressed`; legacy drafts hide every coverage element (no
  zeros, no badges, no approximations).
- Wizard gaps and context warnings render explained, linked cards;
  run-scoped links carry the derived run id or degrade to `/discovery`.
- The unaddressed panel deep-links each finding to its drawer and shows
  the correct positive/empty/hidden states; the dashboard card shows the
  same computed values and degrades gracefully on fetch failure.

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the tests from each group: gateway snapshot composition
      (1.1), shared compute + registry (2.1), route params (3.1),
      surfaces (4.1).
    - Total existing tests: approximately 8-30 across Jest and Vitest.
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Priority end-to-end candidates (mocked-service level):
      (a) generate → snapshot → expand → coverage-improves — a draft
      created with a 3-finding snapshot and partial references shows
      `notAddressedCount` N; an epic-expansion-style items append adding
      a `discoveryFindingReferences` match re-derives to N-1 on read
      with NO write to `generation_summary_json`; (b) gap-card →
      deep-link flow — a wizard gap card's href navigates to the run
      detail page where `?findingId=` opens the drawer / `?room=open`
      opens the room (registry-built URL consumed by the Group-3 param
      handling, end to end); (c) trust-chain agreement — the gateway
      snapshot shape produced in both generation modes parses cleanly
      through the frontend `computeFindingsCoverage` types (shared
      fixture); (d) the fail-soft chain — a fetch-failed draft (warning
      present, snapshot absent) renders every surface with coverage
      hidden and the generation warning visible.
    - Focus ONLY on gaps related to this spec's requirements; do NOT
      assess whole-application coverage.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Fill the identified critical gaps only — integration points and
      end-to-end workflows over unit gaps.
    - Skip edge cases, performance tests, and accessibility tests unless
      business-critical.
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (those from 1.1, 2.1, 3.1, 4.1,
      and 5.3) — expected total approximately 18-40 tests.
    - Do NOT run the entire gateway or frontend suite.
    - Verify the critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass across gateway (Jest) and frontend
  (Vitest).
- The generate → snapshot → expand → coverage-improves and gap-card →
  deep-link workflows are covered end-to-end at the mocked-service level.
- No more than 10 additional tests added.
- Testing stays scoped to this spec's feature.

## Execution Order

Recommended implementation sequence (dependency-ordered):

1. **Gateway Snapshot** (Task Group 1) — the `fetchAcceptedFindings` seam,
   two-pass paged walk, snapshot composition in both modes, legacy-key
   stripping; defines the snapshot wire shape everything downstream
   consumes.
2. **Shared Frontend Modules** (Task Group 2) — `findingsCoverage.ts`,
   the 14-entry `gapWayfindingRegistry.ts`, API typing + legacy-accessor
   removal.
3. **Route Params** (Task Group 3) — `?findingId=` and `?room=open` on
   the run detail page (independent of Groups 1-2; must land before
   Group 4's deep links are meaningful).
4. **Surfaces** (Task Group 4) — wizard cards, review-workspace panel,
   progress summary + draft list, dashboard cards.
5. **Test Review & Gap Analysis** (Task Group 5).

## Notes

- **One snapshot shape, defined once in Group 1:** `findingsCoverage =
  { findings: [{ id, title, severity, runId }] }`, id-sorted,
  timestamp-free — Group 2's types mirror it verbatim and Group 4 never
  reshapes it.
- **The two shared modules are load-bearing:** any surface found
  re-implementing id matching or link construction during build is a
  defect — route it through `findingsCoverage.ts` /
  `gapWayfindingRegistry.ts`.
- **The legacy-accessor removal (2.4) and the broken-read replacement
  (4.4) are one atomic change from `tsc`'s point of view** — sequence them
  so the baseline stays clean (acceptable to land the type removal in the
  same change-set as the last read replacement).
- **Severity filter is single-value (verified in
  `DiscoveryFindingController.list`)** — never collapse the two passes
  into one `severity=critical,high` call.
- **`tsx` watch caution (repo rule):** do not edit
  `discovery-service/src/**` while a discovery run is active (this spec
  should not need to touch it at all).
