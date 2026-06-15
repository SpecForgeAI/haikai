# Specification: Cascade-aware Bulk Review + Reject Suppression (Spec 2)

## Goal
Add the DETERMINISTIC (no-LLM) cascade-aware bulk Approve/Reject/Defer/Save layer on top of Spec 1's read-only blast-radius backbone, and make "reject" mean EXCLUDED from every downstream migration-planning consumer (real, complete wiring — never an ignored flag), applied atomically (all-or-nothing) across candidates AND their linked findings.

## User Stories
- As a migration architect reviewing a discovery run in the candidate grid, I want to bulk Approve/Reject/Defer a selection and SEE a preview of every dependent (and linked finding) the action will pull in — and DESELECT any I want to keep — before one atomic apply, so I never silently cascade or half-apply a batch.
- As a migration architect, I want rejecting a candidate or finding to remove its intermediate representation from the book-of-work / migration-delivery-plan context AND the per-story shape-spec context — from both the LLM payloads and the summary counts — so "rejected" is genuinely excluded everywhere and never inflates "you have 40 findings".
- As a migration architect, I want to re-approve a previously rejected item and have it reappear downstream automatically, with no extra "un-suppress" step, so reversibility is trivially correct.

## Specific Requirements

**Atomic AMS-native bulk review endpoint (candidates + linked findings, all-or-nothing)**
- New `@Transactional` AMS endpoint applying ONE review action (`approved`/`rejected`/`deferred`) across a curated set spanning discovery candidates AND discovery findings in a SINGLE transaction; ANY entity failure rolls back the WHOLE batch.
- Model on the existing finding `DiscoveryFindingService.bulkReview` (≈ lines 457-529): ids resolution, same-disposition skip (`alreadyInTarget`), `saveAll` + single `flush`, `delta_by_from_status` accumulator captured pre-mutation; but the new service spans BOTH entity kinds (candidate arm + finding arm) inside one boundary.
- New request/response DTOs modelled on `BulkReviewDiscoveryFindingsRequest`/`...Response`: the request carries explicit candidate-id and finding-id sets (the curated set resolved client-side from the preview) plus `review_status` (+ optional `reviewer_notes`); the response returns per-kind `updated_count`/`skipped_count`/`skipped_by_reason` + `delta_by_from_status`. snake_case wire, NO `@CamelCaseWire` (global SNAKE_CASE default).
- Candidate arm stays consistent with `DiscoveryCandidateService.reviewCandidate`: any→any transitions (Spec F vocab `VALID_REVIEW_STATUSES = {approved, rejected, deferred}`), capture `previous_review_status` + `reviewed_at` + `reviewed_by` per row.
- Finding arm reuses the existing finding `applyStatusChange` semantics (preserve `previous_review_status` + `reviewed_at`).
- Respect `committed` gating: candidate `status` (`proposed`/`committed`) is DISTINCT from `review_status`; do not transition a committed row (mirror the gateway fan-out's `review_status !== 'committed'` skip and the grid's `committed` exclusion). A committed row in the id set is counted skipped, not failed.
- Scope-verify every supplied id against `(project, architecture, run)` exactly as the finding `resolveCandidates` does (cross-run id injection → 404, which under one transaction rolls the batch back).

**Read-time IR suppression of `rejected` at the two AMS context builders**
- Add a `review_status`-filtered finder to `DiscoveryFindingRepository` (NO schema change; keyed on the LIVE `review_status` column; no IR mutation) — e.g. a variant of `findByRunIdAndProjectIdAndArchitectureId` and of `findByProjectIdAndArchitectureIdAndRunIdNotNull` that excludes a given status (or returns only non-rejected); reuse it at both leak sites.
- `MigrationDiscoveryContextService`: filter `rejected` out of `loadFindingsForRuns` (≈ lines 602-613) so its result excludes rejected from BOTH `buildFindingsSummary` counts (≈ lines 854-875) AND the `highPriorityFindings` LLM payload (`prioritiseAndCap` → `toFindingHighlight`).
- `MigrationDiscoveryContextService.buildCandidateSummary` (≈ lines 891-903): exclude candidates whose `review_status === 'rejected'` from the candidate counts (note: today it counts by candidate `status`, a DIFFERENT field — the suppression filter is on `review_status`, applied before the by-`status`/by-`type` tally).
- Evidence highlights: evidence has NO `review_status` of its own and is reached only through its linking finding (`loadEvidenceLinksForFindings` → `buildEvidenceHighlights`, ≈ lines 700-760) — because the rejected findings are dropped upstream, their evidence is naturally dropped from the highlight set; assert this is so (drop evidence whose ONLY linking findings are rejected).
- `MigrationSpecContextResolver.loadFindings` (≈ lines 1008-1034): exclude `rejected` so every per-story block builder (`buildServiceBlock`/`buildApiBlock`/`buildSoapBlock`/`buildDataBlock`/`buildTestPackBlock` via `boundedFindings`) never sees rejected IR.
- Suppress ONLY `rejected`; leave `deferred` VISIBLE downstream (legitimate known-unknown for planning). Save-back (`mcp-server` `candidateSaveBackService.ts`, `REVIEW_EXCLUDED_STATUSES = ['rejected','deferred']`) is ALREADY correct and already feeds the target-state path safely — leave it unchanged; note it is correct.

**Shared pure "resolve bulk action set" helper**
- A PURE function (no React, no I/O, no LLM) over the snake_case `ReviewModel` wire shape: given a selection (seed candidate ids + the chosen action) and the Spec 1 review model, return the full touched set — seed candidates + cascaded dependents (from `blast_radius[].dependents`) + each candidate's linked findings (findings whose `candidate_link_ids` include a touched candidate, i.e. the `target_type='discovery_candidate'` join Spec 1 resolved) — with per-item cascade provenance (`via_edge_kind` + `via_predecessor_id`) and net counts derived from `blast_radius`/`aggregations`.
- HOME = the gateway. Spec 3's coordinator runs SERVER-SIDE in the gateway (`gateway/src/services/architectConversation/architectConversationCoordinator.ts` — Spec 3 reuses the target-state Architect Conversation chassis, which is gateway-hosted), so the canonical helper must live where that coordinator can import it directly (e.g. `gateway/src/services/discovery/resolveBulkActionSet.ts`).
- The frontend does NOT import gateway source across the build boundary (the `frontend/src/api/*` clients share WIRE shapes with the gateway, guarded by contract tests like `scopeRefType.contractWithGateway.test.ts`, not code imports). The grid already holds the full `reviewModel` client-side, so it resolves the set with the identical pure logic against the SAME `ReviewModel` wire types; guard parity with a shared wire-shape contract test so there is ONE logic, not two divergent copies. (The load-bearing requirement per Decision 8 is a single pure function consumed by both; the gateway is the home Spec 3 imports, the frontend mirrors it under contract-test guard.)
- The function is the ONLY place cascade-set resolution lives: the grid's confirm modal is a THIN renderer over its output; Spec 3's coordinator calls it headlessly with the same inputs.

**Grid bulk toolbar + `BulkCandidateActionConfirmModal` (curated selection)**
- New `BulkCandidateActionConfirmModal` (sibling of `frontend/src/components/Discovery/BulkFindingActionConfirmModal.tsx` + `.module.css`) rendering the blast-radius preview from the resolve-helper output: net counts, which items are pulled in BY CASCADE and via which edge (provenance), each dependent/linked-finding DESELECTABLE, optional reviewer-note textarea, in-flight spinner, escape/overlay dismiss.
- Curation lives in the modal ONLY (Decision 9): NO per-row grid checkboxes; the grid keeps its existing `'all' | 'filtered'` scope (like `FindingsTab`). The toolbar action seeds the modal from scope; the user deselects inside the modal; confirm applies the curated set.
- Add bulk-toolbar wiring in `DiscoveryCandidateTable.tsx` next to the existing buttons (≈ lines 945-996): the Reject/Defer (and Approve) actions open the modal pre-selecting the FULL Spec 1 blast-radius for the seeded candidates; the preview is a render over `reviewModel.blast_radius` + `aggregations` ALREADY fetched on mount (≈ line 496) — NO new fetch for the preview.
- On confirm, call the new atomic bulk endpoint (via the new frontend candidate API fn + gateway proxy) with the curated candidate-id + finding-id sets, REPLACING the best-effort per-row `bulkReviewCandidates` fan-out for the cascade-apply path; on success, update the optimistic candidate state (`onCandidatesChange`) as the existing `handleBulkReview` does (≈ lines 787-792), leaving committed rows untouched.

**Bulk Save (separate operation, reuse `save-approved` verbatim)**
- Surface a Save action in the grid's bulk toolbar that reuses the EXISTING `save-approved` path verbatim: `mcp-server` `saveDiscoveryCandidatesToModel(mode='manual')` commits `review_status === 'approved'` into the architecture model and transitions those rows to `committed`. Save commits the WHOLE approved set for the run (one Save meaning) — it is NOT part of the review-action endpoint.
- Wire the SAME post-save AppShell cache handling the run-detail page already does (`DiscoveryRunDetailPage.handleSaveApprovedConfirmed`, ≈ lines 420-513): `LOAD_MODEL` same-arch, `archCtx.invalidateArchitectureModelCache(runArchitectureId)` cross-arch (per `project_appshell_model_cache`), plus the existing candidate/run/list refreshes.

**Gateway proxy for the atomic endpoint**
- Add a thin gateway route proxying the new AMS atomic bulk endpoint (mirror the finding bulk-review proxy idiom + the existing `discovery.ts` proxy conventions; preserve `requestId` logging + status passthrough + snake_case body). It does NO business logic of its own (the atomicity + gating live in AMS).
- The existing best-effort candidate fan-out (`POST .../candidates/bulk-review`, ≈ lines 1388-1492) is REPLACED for the cascade-apply path by this atomic route; the `review-model` proxy (≈ line 635) and `save-approved` proxy (≈ line 1655) are unchanged. The context clients `migrationDiscoveryContextClient.ts` / `migrationSpecContextClient.ts` stay pass-through (suppression lives in AMS — do not add filtering here).

**Reversibility (automatic, read-time)**
- No "un-suppress" step exists: suppression is a read-time filter on the LIVE `review_status`, so re-approving a rejected candidate/finding makes its IR reappear in BOTH context builders on the next context build. Assert with a reject → absent → re-approve → present round-trip.

## Existing Code to Leverage

**`DiscoveryFindingService.bulkReview` + `BulkReviewDiscoveryFindingsRequest`/`Response` (`architecture-model-service`)**
- The exact `@Transactional` atomic pattern to mirror: ids resolution + scope-verify, same-disposition `alreadyInTarget` skip, pre-mutation `delta_by_from_status` accumulator, `saveAll` + single `flush`, snake_case DTOs with no `@CamelCaseWire`.
- The new endpoint generalizes this to span candidates + findings in one transaction; the new DTOs are direct analogues with per-kind sub-counts.

**`DiscoveryCandidateService.reviewCandidate` + `DiscoveryCandidateEntity` (`architecture-model-service`)**
- The candidate review semantics the atomic endpoint's candidate arm must match: `VALID_REVIEW_STATUSES = {approved, rejected, deferred}`, any→any, capture `previous_review_status`/`reviewed_at`/`reviewed_by`.
- The entity carries BOTH `status` (`proposed`/`committed`) and `review_status` (Spec F vocab) — the suppression filter and committed-gating key on the correct, distinct field.

**`MigrationDiscoveryContextService` + `MigrationSpecContextResolver` + `DiscoveryFindingRepository` (`architecture-model-service`)**
- The two confirmed leak sites and the repository that needs the new `review_status`-filtered finder; the fix is bounded to these (the suppression-completeness sweep in `planning/requirements.md` enumerates every other consumer as already-safe or not-a-leak).

**`BulkFindingActionConfirmModal.tsx` + `FindingsTab.tsx` (`frontend`)**
- The sibling modal the new `BulkCandidateActionConfirmModal` is modelled on (header/content/footer, escape/overlay, reviewer-notes textarea, in-flight spinner) and the `'all' | 'filtered'` scope-based bulk-toolbar precedent.

**`DiscoveryCandidateTable.tsx` + `DiscoveryRunDetailPage.tsx` (`frontend`)**
- The grid already fetches `getReviewModel` on mount and holds `reviewModel.blast_radius` + `aggregations` — the preview renders over data already present (no new fetch). `handleBulkReview` (≈ line 772) is the optimistic-update channel to reuse; the run-detail page's `LOAD_MODEL`/`invalidateArchitectureModelCache` block is the post-save cache refresh to reuse verbatim for bulk Save.

## Out of Scope
- The conversational "Architect" review persona and ANY LLM use (Spec 3); Specs 0-2 are fully deterministic.
- The within-session bulk-resolve-by-pattern conflict UX (Spec 3).
- Cross-scan / cross-run preference memory.
- Per-row grid checkbox selection — the grid keeps its `'all' | 'filtered'` scope; curation happens inside the confirm modal.
- Any change to the meta-model's backend-managed `*_points` polymorphic wrappers (never user-acted; the review model already excludes `POINTS_WRAPPER_TYPES`).
- Any AMS schema / Liquibase change (the new finder needs none; never edit an applied changeset).
- Any change to save-back's commit-exclusion semantics (already excludes `rejected` + `deferred`) or to the target-state-building path (already safe via save-back).
- Suppressing `deferred` downstream (it stays visible; only `rejected` is the bright line).
- Edits to `discovery-service/src/**` beyond consuming Spec 1's read-only model (and never during an active discovery run).
- NO stubbing or deferral of required functionality (oracle standard): suppression must be real complete wiring, the apply must be atomic, and bulk Approve/Reject/Defer/Save + preview must work end-to-end without the LLM.

## Test Plan

**Atomic bulk endpoint (`architecture-model-service`, mirror `DiscoveryFindingBulkReviewTest`)**
- Happy path: a curated set of candidates + linked findings all transition to the requested `review_status` in one transaction; per-kind `updated_count`/`delta_by_from_status` are exact.
- Atomic rollback: inject a partial failure (e.g. one out-of-scope / non-existent id, or a forced persistence error) and assert the WHOLE batch rolls back — NO candidate and NO finding is mutated (re-read all rows unchanged).
- `committed` gating: a committed candidate in the id set is skipped (counted, not failed, not transitioned); the rest still apply.
- Audit preserved: `previous_review_status` + `reviewed_at` set correctly on every updated candidate AND finding; same-disposition rows counted `alreadyInTarget`, not rewritten.
- any→any: e.g. `rejected` → `approved` and `approved` → `deferred` both succeed (Spec F unrestricted transitions).

**Suppression — both context builders, payloads AND counts (`architecture-model-service`)**
- `MigrationDiscoveryContextService`: a rejected finding is absent from `highPriorityFindings` AND from `buildFindingsSummary` counts; a rejected candidate is absent from `buildCandidateSummary` counts; a `deferred` finding/candidate is STILL present in both.
- Evidence: evidence whose only linking findings are rejected is absent from the evidence highlights; evidence also linked by a non-rejected finding survives.
- `MigrationSpecContextResolver.loadFindings`: a rejected finding is absent from the per-story block context; a `deferred` finding is still present.
- The new `review_status`-filtered finder returns the expected non-rejected slice (unit test on the repository).

**Reversibility round-trip (`architecture-model-service`)**
- reject → assert absent from BOTH context builders → re-approve → assert present again on the next context build, with nothing else to "unset".

**Resolve-helper correctness (gateway unit test + frontend parity)**
- Given a seed selection + a `ReviewModel`, the helper returns seed candidates + transitive dependents + each touched candidate's linked findings; cascade provenance (`via_edge_kind` + `via_predecessor_id`) is correct per dependent; net counts match `blast_radius`/`aggregations`; cycle-safe (no infinite loop on a cyclic graph); a candidate with no dependents/findings returns just itself.
- Wire-shape contract test guarding the gateway helper and the frontend resolution against the SAME `ReviewModel` types (no divergent copies).

**Grid + modal + Save (`frontend`, Vitest)**
- `BulkCandidateActionConfirmModal` renders the preview: net counts, cascade-pulled items with edge provenance, deselect toggles a dependent/finding out of the curated set; confirm posts only the curated ids.
- Confirm calls the new atomic endpoint (not the per-row fan-out) and optimistically updates candidate state, leaving committed rows untouched.
- Bulk Save invokes the existing `save-approved` path and triggers the SAME post-save cache refresh (`LOAD_MODEL` same-arch / `invalidateArchitectureModelCache` cross-arch) — assert the cache dispatch fires.

**Gateway proxy (`gateway`, Jest, mirror `discovery-findings-bulk-review-proxy.test.ts`)**
- The atomic bulk route forwards the snake_case body to AMS, passes status/body through, and logs `requestId`; it adds no business logic (atomicity/gating asserted at the AMS layer).
