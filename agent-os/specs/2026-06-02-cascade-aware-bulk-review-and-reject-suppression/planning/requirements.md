# Spec Requirements: Cascade-aware Bulk Review + Reject Suppression (Spec 2)

## Initial Description

Spec 2 of the discovery-review-unification program (F → 0 → 1 → 2 → 3). Build
the DETERMINISTIC (no-LLM) cascade-aware bulk Approve/Reject/Defer/Save layer
over a candidate selection plus their linked findings, with a preview→confirm
step rendered from Spec 1's already-computed blast-radius, AND make "reject" mean
EXCLUDED from every downstream consumer (target-state building + book-of-work /
spec generation) — not merely hidden in the grid.

Specs F, 0, and 1 are BUILT + verified:
- **Spec F** normalized findings review actions to the Approve/Reject/Defer
  vocabulary (candidate-parity), unrestricted any→any transitions, with a
  `previous_review_status` audit.
- **Spec 0** delivered the universal identity-keyed cross-source candidate MERGE
  plus the conflict/provenance data model carried on candidate `data`.
- **Spec 1** delivered the DETERMINISTIC review-model + typed cascade/dependency
  graph + surface-only blast-radius + aggregations backbone, computed LIVE on
  read in `discovery-service`, exposed via `GET .../runs/:runId/review-model`,
  proxied by the gateway, with the grid's count memos re-pointed onto it. Spec 1
  is READ-ONLY — it computes, it never mutates.

The full program context is in `raw-idea.md`. The user's overriding directive:
**ALWAYS hold the oracle standard** — choose the complete/correct implementation
over the cheaper-but-partial one. Suppression must be REAL, COMPLETE wiring into
the downstream consumers, never a flag that is set but ignored.

## Requirements Discussion

The clarifying-question round is complete. The user accepted every recommendation
EXCEPT Q4 (atomicity), where the user OVERRODE the best-effort default in favour
of an all-or-nothing atomic endpoint for the oracle-grade story. The grounded
findings below were verified against the live codebase during the question round
and RE-CONFIRMED file-by-file while writing this document.

### First Round Questions

**Q1 — Cascade application semantics: hard-cascade vs curated?**
Spec 1 deliberately left the hard-cascade decision to Spec 2. Should rejecting a
parent HARD-cascade the reject to every dependent in its blast-radius, or should
the preview pre-select the blast-radius and let the user DESELECT before applying?
**Answer:** CURATED. The preview pre-selects the FULL blast-radius (from Spec 1),
the user can DESELECT any dependent, then applies. No silent hard-cascade.

**Q2 — Where/how is IR suppression enforced (the exact downstream points)?**
Reject must exclude a candidate's intermediate representation from every
downstream consumer. Is suppression a read-time filter keyed on `rejected`, a
marking on the IR, or exclusion at save-back? And which consumption points?
**Answer:** Read-time exclusion of `rejected` at the two AMS context builders.
Filter rejected findings out of `MigrationDiscoveryContextService.loadFindingsForRuns`
and `MigrationSpecContextResolver.loadFindings`; exclude rejected candidates from
the candidate-summary builder; and drop evidence whose ONLY linking findings are
rejected. Add a `review_status`-filtered finder (no schema change, no IR
mutation, keyed on the LIVE `review_status`). Exclude rejected from BOTH the LLM
payloads AND the summary counts — a rejected finding must not inflate "you have
40 findings". Save-back is already correct (it already excludes rejected) — leave it.

**Q3 — Suppress `deferred` downstream too, or only `rejected`?**
**Answer:** Suppress ONLY `rejected` from the downstream context; leave `deferred`
VISIBLE there. `deferred` is a legitimate known-unknown for migration planning;
the bright line is `rejected`. (Save-back continues to exclude BOTH `rejected`
and `deferred` from the commit — unchanged.)

**Q4 — Atomicity of a bulk apply: all-or-nothing vs best-effort? [USER OVERRODE]**
The recommended default was best-effort (mirroring today's gateway candidate
fan-out: per-row PATCH, `succeeded`/`failed` counts). **The user OVERRODE this**
in favour of the oracle-grade story.
**Answer:** ALL-OR-NOTHING via a NEW AMS-native `@Transactional` bulk endpoint
spanning candidates AND their linked findings in ONE transaction. If ANY entity
fails, the WHOLE batch rolls back. Modelled on the existing finding `bulkReview`
pattern but spanning both entity kinds. The gateway proxies it; the grid calls it
after preview→confirm. The best-effort per-row fan-out is REPLACED by this atomic
endpoint for the cascade-apply path.

**Q5 — What does bulk Save commit, and via which path?**
**Answer:** Reuse the existing `save-approved` path VERBATIM. The `mcp-server`
`saveDiscoveryCandidatesToModel(mode='manual')` commits `review_status==='approved'`
into the architecture model and transitions those rows to `committed`. Use the
SAME AppShell cache handling the run-detail page already does. Save commits the
WHOLE approved set for the run (one Save meaning). Just surface the Save action in
the grid's bulk toolbar and wire the same post-save cache refresh.

**Q6 — Reversibility / undo of a bulk reject (incl. un-suppressing the IR)?**
**Answer:** AUTOMATIC. Because suppression is a read-time filter on the LIVE
`review_status` (Q2), re-approving a rejected candidate/finding makes it reappear
downstream on the next context build — there is nothing to "unset". Assert with a
reject → absent → re-approve → present round-trip test.

**Q7 — How do linked findings participate in the cascade?**
**Answer:** Linked findings are cascade DEPENDENTS. When a candidate is rejected,
its linked findings (`target_type='discovery_candidate'`) are pulled into the
preview as dependents, PRE-SELECTED, and rejected with the candidate
(curated/deselectable per Q1) — belt-and-braces suppression (gone both because
the finding is rejected AND because its candidate is). Findings and candidates
share the Approve/Reject/Defer vocabulary uniformly.

**Q8 — Preview→confirm architecture: how is it shared with Spec 3?**
**Answer:** A shared deterministic "resolve bulk action set" PURE function: given
a selection + the Spec 1 review model, return the full touched set (candidates +
cascaded dependents + linked findings) with cascade provenance (which edge pulled
each in) + net counts from `blast_radius`/`aggregations`. The grid's confirm modal
is a THIN renderer over it; Spec 3's conversation calls the SAME helper headlessly.

**Q9 — Selection model: per-row grid checkboxes, or scope + modal curation?**
**Answer:** Curation lives within the confirm modal ONLY — no per-row grid
checkboxes. The grid keeps its `'all' | 'filtered'` scope (like FindingsTab). Add
a bulk toolbar + a `BulkCandidateActionConfirmModal` (sibling of
`BulkFindingActionConfirmModal`) that renders the blast-radius preview: net
counts, which items are pulled in by cascade, and via which edge (provenance),
with deselect.

### Existing Code to Reference

These paths were verified during research and are the concrete anchors the
spec-writer should reference. The spec-writer should re-open them as needed; the
research here records WHAT each one is and WHY it matters, not a re-paste of code.

**The two IR-leak sites (the concrete suppression targets):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/migration/MigrationDiscoveryContextService.java`
  — the book-of-work / migration-delivery-plan context builder.
  - `loadFindingsForRuns(runIds, projectId, architectureId)` (≈ lines 602-613)
    calls `discoveryFindingRepository.findByRunIdAndProjectIdAndArchitectureId(...)`
    per run with NO `review_status` filter. Its result `allFindings` flows into
    BOTH `buildFindingsSummary` (the COUNTS, ≈ lines 854-875) AND
    `highPriorityFindings` (the LLM payload, via `prioritiseAndCap` + `toFindingHighlight`).
  - Evidence highlights are linked off `prioritisedFindings` via
    `loadEvidenceLinksForFindings` → `buildEvidenceHighlights` (≈ lines 700-760):
    evidence is reached ONLY through its linking finding (evidence has no
    `review_status` of its own), so suppressing rejected findings here also
    naturally drops their evidence from the highlight set.
  - `buildCandidateSummary(runIds)` (≈ lines 891-903) reads
    `discoveryCandidateRepository.findByRunId(runId)` with NO `review_status`
    filter and counts by `c.getStatus()` (`proposed`/`committed`), NOT by
    `review_status` — so rejected candidates currently inflate the candidate
    summary.
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/migration/MigrationSpecContextResolver.java`
  — the per-story shape-spec context resolver (book-of-work spec generation).
  - `loadFindings(projectId, currentArchId, max)` (≈ lines 1008-1034) calls
    `discoveryFindingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNull(...)`
    with NO `review_status` filter; the result feeds EVERY block builder
    (`buildServiceBlock` / `buildApiBlock` / `buildSoapBlock` / `buildDataBlock` /
    `buildTestPackBlock`) via `boundedFindings(...)`.

**The finding repository (needs a new `review_status`-filtered finder):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/discovery/DiscoveryFindingRepository.java`
  — confirmed: there is NO `review_status`-aware list finder today (the `search`
  method has a `status` param but it is a paged search, not the bulk list the two
  builders call). The new finder(s) belong here — no schema change.

**Save-back (ALREADY correct — leave it, note it's correct):**
- `mcp-server/src/services/candidateSaveBackService.ts` — `REVIEW_EXCLUDED_STATUSES = ['rejected','deferred']`
  (auto mode); manual mode selects only `review_status === 'approved'`. Target-state
  building is fed from the architecture model, which save-back populates, so the
  target-state path is ALREADY safe. (Documented in the file header + the
  `SaveBackMode` doc comment.)

**The atomic-endpoint model (the pattern to mirror, spanning candidates+findings):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/discovery/DiscoveryFindingService.java`
  — `bulkReview(...)` (≈ lines 457-580): `@Transactional`, ids-OR-filter
  resolution (`resolveCandidates`), per-row `applyStatusChange` capturing
  `previous_review_status` + `reviewed_at`, same-disposition skip
  (`alreadyInTarget`), `saveAll` + single `flush`, returns `delta_by_from_status`.
  `ALLOWED_REVIEWER_STATUSES = {approved, rejected, deferred}`.
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/discovery/BulkReviewDiscoveryFindingsRequest.java`
  and `...BulkReviewDiscoveryFindingsResponse.java` — the request (`ids` | `filter`
  | `review_status` | `reviewer_notes`) and response (`updated_count`,
  `skipped_count`, `skipped_by_reason`, `delta_by_from_status`) shapes to model
  the candidate+finding variant on. snake_case wire (no `@CamelCaseWire`).
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateService.java`
  — the existing single-candidate `reviewCandidate` (any→any, `previous_review_status`
  audit, `committed` gating) the new endpoint's candidate arm must stay consistent with.

**Candidate review wire + the gateway fan-out being replaced:**
- `frontend/src/api/discoveryApi.ts` — `bulkReviewCandidates(...)` (≈ lines 698-723,
  best-effort `succeeded`/`failed` shape), `reviewCandidate`, `saveApprovedCandidates`,
  `getReviewModel` (≈ lines 643-657), plus the `ReviewModel` client types.
- `gateway/src/routes/discovery.ts` — the candidate bulk-review fan-out
  (`POST .../candidates/bulk-review`, ≈ lines 1388-1487): fetches all candidates,
  filters out `committed` (≈ lines 1438-1441), narrows by `candidate_ids`, then
  `Promise.allSettled` per-row PATCH (best-effort, NOT atomic). This is the route
  the new atomic endpoint's proxy replaces for the cascade-apply path. (Also the
  `review-model` proxy at ≈ line 635 and `save-approved` proxy at ≈ line 1655.)

**The grid + the run-detail page (Spec 2 augments these):**
- `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` — the grid.
  Already imports + fetches `getReviewModel` on mount (≈ line 496), holds
  `reviewModel` state (≈ line 485), builds a node-by-id map (≈ lines 514-518),
  reads `aggregations.{committed_count,actionable_count,live_conflict_count}`
  (≈ lines 660-683). `handleBulkReview(newStatus, scope: 'all' | 'filtered')`
  (≈ line 772) is the existing best-effort path; toolbar buttons at ≈ lines 945-996.
  Only `ConflictResolutionModal` (Spec 0) is wired today (≈ line 1331) — NO
  candidate bulk-confirm modal. `reviewModel.blast_radius` is fetched but not yet
  rendered (Spec 1 left that to Spec 2).
- `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` — the page.
  `handleSaveApprovedConfirmed` (≈ line 420) calls `saveApprovedCandidates`, then
  dispatches `{ type: 'LOAD_MODEL' }` for the same architecture (≈ line 495) OR
  `archCtx.invalidateArchitectureModelCache(runArchitectureId)` cross-arch
  (≈ line 508) — the EXACT cache block Save reuses (see `project_appshell_model_cache`).
- `frontend/src/components/Discovery/BulkFindingActionConfirmModal.tsx`
  (+ `.module.css`) — the sibling the new `BulkCandidateActionConfirmModal` is
  modelled on; `FindingsTab.tsx` is the scope-based (`'all' | 'filtered'`) bulk
  toolbar precedent.

**Spec 1's backbone (the READ-ONLY input the helper + preview consume):**
- `discovery-service/src/services/reviewModel/types.ts` — `ReviewModel`,
  `BlastRadiusEntry` (`dependents: BlastRadiusDependent[]` each with
  `via_edge_kind` + `via_predecessor_id`; `would_be_orphaned_parent_ids` advisory),
  `ReviewModelAggregations`, `ReviewFindingNode` (`candidate_link_ids` resolved
  from finding links where `target_type==='discovery_candidate'`), the `EdgeKind`
  taxonomy, and `POINTS_WRAPPER_TYPES` (the `*_points` exclusion).
- `discovery-service/src/services/reviewModel/buildReviewModel.ts` and
  `computeBlastRadiusAndAggregations.ts` — the live-compute backbone (no
  re-derivation needed by Spec 2; consume `blast_radius` + `aggregations` verbatim).

**Existing tests already authored against these write paths (to extend, not break):**
- `gateway/src/__tests__/discovery-findings-bulk-review-proxy.test.ts`,
  `frontend/src/components/Discovery/FindingsTab.bulk.test.tsx`,
  `architecture-model-service/src/test/java/com/example/architecturemodel/service/discovery/DiscoveryFindingBulkReviewTest.java`
  — the finding bulk-review proxy / UI / service tests; the candidate+finding
  atomic endpoint's tests should mirror them.

### Follow-up Questions

No follow-up questions were required — the question round resolved every open item
from `raw-idea.md`, and the codebase sweep confirmed the suppression target set is
complete (see Suppression-Completeness Sweep below). The only deviation from the
recommended defaults is Q4 (user override to all-or-nothing atomicity), which is
fully captured in Resolved Decision 4.

## Visual Assets

### Files Provided:
No visual assets provided. The mandatory `planning/visuals/` check returned no
image files (`planning/visuals/` exists but is empty). This is a deterministic
backend-plus-grid-augmentation spec; the UI surface is a sibling of the existing
`BulkFindingActionConfirmModal`, so no new mockups are expected or needed.

### Visual Insights:
None (no files).

## Requirements Summary

### Functional Requirements

**1. Cascade-aware bulk actions over a selected SET (candidates + linked findings).**
Bulk Approve / Reject / Defer using the shared Spec F vocabulary for BOTH
candidates and findings. The action is "cascade-aware" because it consumes Spec
1's `blast_radius`: acting on a parent surfaces its dependents (and a candidate's
linked findings) in the preview.

**2. Preview → confirm (no silent cascades).**
Before any mutation, a DETERMINISTIC preview built from Spec 1's `blast_radius` +
`aggregations` shows exactly which candidates/findings the action will touch,
which are pulled in by cascade and via which edge (provenance), and the net
counts. The user confirms — or DESELECTS dependents (curated, per Decision 1) —
then the batch applies.

**3. Atomic bulk apply (all-or-nothing).**
A new AMS-native `@Transactional` bulk endpoint applies the chosen review action
across the curated set — candidates AND their linked findings — in ONE
transaction. Any single-entity failure rolls back the whole batch. Per-entity
`previous_review_status` audit preserved; `committed` gating respected; any→any
transitions (Spec F). snake_case wire.

**4. Bulk Save commits the approved set.**
Surface a Save action in the grid's bulk toolbar that reuses the existing
`save-approved` path (`mode='manual'`, commits `review_status==='approved'` into
the architecture model, transitions to `committed`) with the SAME post-save
AppShell cache handling the run-detail page already does.

**5. Reject suppresses the IR from EVERY downstream consumer.**
A rejected candidate's intermediate representation (and a rejected finding, and
the evidence reachable only through rejected findings) is EXCLUDED from the
book-of-work / migration-delivery-plan context AND the shape-spec context — from
BOTH the LLM payloads AND the summary counts — via a read-time filter on the LIVE
`review_status`. `deferred` stays visible downstream; only `rejected` is the
bright line. Save-back already excludes both — unchanged.

**6. Reversibility is automatic.**
Re-approving a rejected candidate/finding makes it reappear downstream on the next
context build (read-time filter on live status — nothing to "unset").

### Reusability Opportunities

- **The atomic endpoint mirrors `DiscoveryFindingService.bulkReview`** (same
  `@Transactional` shape, ids/filter resolution, `previous_review_status` capture,
  `saveAll`+`flush`, `delta_by_from_status` response) but spans candidates +
  findings. Request/response DTOs model on `BulkReviewDiscoveryFindingsRequest/Response`.
- **The candidate arm stays consistent with `DiscoveryCandidateService.reviewCandidate`**
  (any→any, audit, `committed` gating).
- **The confirm modal is a sibling of `BulkFindingActionConfirmModal`**; the bulk
  toolbar follows the `FindingsTab` scope-based (`'all' | 'filtered'`) precedent.
- **The grid ALREADY fetches `getReviewModel`** and holds `reviewModel.blast_radius`
  + `aggregations` client-side — the preview is a render over data already present
  (no new fetch required for the preview).
- **Bulk Save reuses `saveApprovedCandidates` + the run-detail page's existing
  `LOAD_MODEL` / `invalidateArchitectureModelCache` block** verbatim.
- **The shared "resolve bulk action set" helper** is reused by BOTH the grid (now)
  and Spec 3's coordinator (later).

### Scope Boundaries

**In Scope:**
- A NEW AMS-native `@Transactional` bulk endpoint applying a review action
  (Approve/Reject/Defer) across a cascade set spanning discovery candidates AND
  their linked findings, all-or-nothing; gateway proxy for it; snake_case wire.
- A NEW `review_status`-filtered finding finder on `DiscoveryFindingRepository`
  (no schema change), used by the two AMS context builders.
- Read-time suppression of `rejected` in `MigrationDiscoveryContextService`
  (`loadFindingsForRuns` findings + their evidence + the candidate-summary
  builder) and `MigrationSpecContextResolver` (`loadFindings`), excluding rejected
  from BOTH the LLM payloads AND the summary counts.
- The grid bulk toolbar + `BulkCandidateActionConfirmModal` rendering the
  blast-radius preview (net counts, cascade-pulled items, edge provenance,
  deselect) over `reviewModel.blast_radius` + `aggregations`.
- The shared deterministic "resolve bulk action set" PURE helper (used by the
  grid now and Spec 3 later).
- Surfacing bulk Save in the toolbar wired to the existing `save-approved` path +
  the existing AppShell cache refresh.
- Regression / round-trip tests: rejected finding+candidate absent from BOTH
  contexts incl. counts; reject → absent → re-approve → present.

**Out of Scope (stated explicitly):**
- The conversational "Architect" review persona and ANY LLM use — that is Spec 3.
  (Specs 0-2 are fully deterministic.)
- The within-session bulk-resolve-by-pattern conflict UX — Spec 3.
- Cross-scan / cross-run preference memory.
- Per-row grid checkbox selection — Decision 9 keeps the grid's `'all' | 'filtered'`
  scope; curation happens inside the confirm modal.
- Changing the meta-model's backend-managed `*_points` rows (they are never user-
  acted; the review model already excludes `POINTS_WRAPPER_TYPES`).
- Any change to save-back's commit-exclusion semantics (it already excludes
  `rejected` + `deferred`) and any change to the target-state-building path
  (already safe via save-back).
- NO stubbing or deferral of any required functionality (oracle standard): the
  suppression must be real, complete wiring, and bulk Approve/Reject/Defer/Save +
  preview must work end-to-end without the LLM.

### Technical Considerations

- **Deterministic only (no LLM in Specs 0-2).** Deterministic code owns all
  counts / cascades / actions. Spec 3 adds a conversational persona on TOP of
  these exact bulk mechanisms.
- **Spec 2 owns the WRITES.** Spec 1's backbone is READ-ONLY. Spec 2 introduces:
  the atomic candidate+finding review endpoint, the save-back surface, and the
  read-time suppression filter. It reuses the SAME write mechanisms Spec 3's
  conversation will call.
- **AMS speaks snake_case at the wire by default** (`spring.jackson.property-naming-strategy: SNAKE_CASE`).
  The new bulk request/response DTOs need NO `@CamelCaseWire`; mirror the finding
  bulk-review DTOs.
- **Honour the architecture meta-model** (`gateway/src/config/prompts/shared/architecture-context-explainer.md`):
  logical↔physical are distinct layers with EXPLICIT non-1:1 mappings; classes /
  methods are first-class entity types; `*_points` polymorphic wrappers are
  backend auto-managed and never user-acted (already excluded from the review
  model).
- **`committed` gates re-action.** Candidate `status` (`proposed`/`committed`) is
  distinct from `review_status` (Spec F vocab). The atomic endpoint must respect
  `committed` gating (do not transition committed rows), mirroring today's gateway
  fan-out (which filters out `committed`).
- **Evidence has no `review_status` of its own.** Evidence is suppressed by
  dropping it when its ONLY linking findings are rejected — there is no evidence-
  level status to set.
- **Findings link to candidates via `target_type='discovery_candidate'`.** That is
  the join the cascade uses to pull a candidate's linked findings into the preview
  (and the join Spec 1 already uses for `ReviewFindingNode.candidate_link_ids`).
- **The book-of-work, migration-delivery-plan, shape-spec generation, AND architect
  conversation ALL source discovery context exclusively through the two AMS context
  endpoints** (`migration-discovery-context` and `migration-spec-context`). The
  gateway clients (`migrationDiscoveryContextClient.ts`, `migrationSpecContextClient.ts`)
  are thin proxies that do NO filtering of their own — so suppression MUST live in
  AMS, and fixing the two builders covers every LLM-facing downstream consumer.
- **No `git` operations, no service starts** are part of this spec's delivery; the
  user owns commits and runs services. (Per the standing project conventions.)

## Suppression-Completeness Sweep (oracle standard — highest-stakes requirement)

This is the exhaustive sweep for ANY downstream consumer that reads discovery
findings / evidence / candidates BY RUN and could leak rejected content. Each
candidate consumer was opened and classified.

**IN SCOPE for suppression (leaks today — these are the complete fix set):**

1. **`MigrationDiscoveryContextService`** (book-of-work / migration-delivery-plan
   context). `loadFindingsForRuns` → `findByRunIdAndProjectIdAndArchitectureId`
   reads findings BY RUN with NO `review_status` filter. The result feeds BOTH the
   LLM payload (`highPriorityFindings`) AND the counts (`buildFindingsSummary`),
   and the evidence highlights are linked off those findings. `buildCandidateSummary`
   → `findByRunId` reads candidates BY RUN with NO `review_status` filter. **LEAKS
   rejected findings, their evidence, AND rejected candidates (into both payloads
   and counts).**

2. **`MigrationSpecContextResolver`** (per-story shape-spec context).
   `loadFindings` → `findByProjectIdAndArchitectureIdAndRunIdNotNull` reads
   findings with NO `review_status` filter; feeds every block builder via
   `boundedFindings`. **LEAKS rejected findings (into the per-story LLM context).**

**REVIEWED and OUT OF SCOPE (do NOT leak rejected IR into migration planning):**

3. **`mcp-server/.../candidateSaveBackService.ts` (save-back).** ALREADY excludes
   `rejected` (and `deferred`) — auto mode via `REVIEW_EXCLUDED_STATUSES`, manual
   mode by taking only `approved`. The target-state-building path is fed from the
   architecture model that save-back populates, so it is ALREADY safe. Leave it;
   note it is correct.

4. **`DiscoverySummaryService` (dashboard discovery summary card).** Counts
   candidates by candidate `status` (`proposed`/`accepted`/`rejected`/`merged`)
   via `countByRunIdGroupByStatus` — this is the candidate `status` field, NOT
   `review_status`, and it is a per-run COUNT card on the dashboard, not an
   IR/LLM context build that feeds migration planning. `rejected` is a legitimate
   visible status bucket here. NOT a downstream IR leak — out of scope.

5. **Target-state seeding / promotion** (`TargetArchitectureSeedService`,
   `TargetArchitecturePromoteService`). Confirmed they do NOT import or read the
   discovery finding / candidate / evidence repositories — they operate on the
   architecture model (which is fed by save-back, already correct). Out of scope.

6. **Diagram generation / projection services** (`UserJourneyDiagramProjectionService`,
   `SequenceDiagramService`, `DiagramExportService`, `TemporaryDiagramService`,
   etc.). Read the architecture model, not discovery candidates/findings by run.
   Out of scope.

7. **Shape-spec generation + OAS spec services** (`MigrationStorySpecGenerationService`,
   `OasSpecService`). No raw discovery finding/candidate reads — their discovery
   context arrives via `MigrationSpecContextResolver` (covered by item 2). Out of
   scope (covered transitively).

8. **The candidate grid + findings tab read surfaces** (`gateway/src/routes/discovery.ts`
   list-candidates / review-model / findings; `discovery-service` review-model
   builder). These are the REVIEW UI's own reads — the grid is precisely where the
   user SEES and acts on rejected rows, so they intentionally show all statuses
   (the grid filters/badges them). NOT a downstream IR leak — out of scope.

9. **Architect conversation, Jira / spec-upload, migration book-of-work routes.**
   Their discovery context comes EXCLUSIVELY through the two AMS context endpoints
   (`migration-discovery-context` / `migration-spec-context`) via thin gateway
   proxies that do no filtering of their own. No raw `/findings`, `/candidates`, or
   `/evidence` reads exist in the gateway/mcp outside `discovery.ts` (the grid's
   read surface) and `archModelClient.ts` (the review-model fetch + save-back).
   Therefore items 1 + 2 cover every LLM-facing consumer.

**Conclusion:** The two AMS context builders (`MigrationDiscoveryContextService`
findings + evidence + candidate-summary, and `MigrationSpecContextResolver`
findings) are the COMPLETE set of downstream leak sites. Save-back is already
correct. No other consumer reads raw discovery IR/evidence/candidates by run in a
way that feeds migration planning. The fix is bounded and fully enumerated.

## Cross-Spec Framing

Per the program's set-delivery framing and the oracle standard, optimise for the
COMPLETE feature set across Specs 1-3 rather than per-spec shippability — but with
NO stubbing or deferral of required functionality. Concretely:

- Spec 2 AUGMENTS the existing power-user grid (the no-LLM view) and reuses the
  SAME write mechanisms Spec 3's conversation will call.
- Spec 1's backbone stays READ-ONLY; Spec 2 owns the writes (the new atomic
  endpoint + save-back surface + the suppression filter).
- The "resolve bulk action set" helper is built as a PURE, headless module so
  Spec 3's coordinator can call it directly — Spec 2 does not bake the grid into
  it.
- Approve / Reject / Defer are shared uniformly across candidates AND findings, so
  Spec 3 inherits one vocabulary and one mechanism.

## Resolved Decisions (user-confirmed 2026-06-02)

1. **Cascade application = CURATED.** The preview pre-selects the FULL
   blast-radius (from Spec 1); the user can DESELECT any dependent, then applies.
   No silent hard-cascade.

2. **IR suppression = read-time exclusion of `rejected` at the two AMS context
   builders.** Filter rejected findings out of `loadFindingsForRuns` /
   `loadFindings`; exclude rejected candidates from the candidate-summary builder;
   drop evidence whose ONLY linking findings are rejected. Add a
   `review_status`-filtered finder (no schema change, no IR mutation, keyed on the
   LIVE `review_status`). Exclude rejected from BOTH the LLM payloads AND the
   summary counts. Regression test: a rejected finding/candidate is absent from
   BOTH contexts including counts. Save-back is already correct — leave it.

3. **Suppress ONLY `rejected` from the downstream context; leave `deferred`
   VISIBLE there.** `deferred` is a legitimate known-unknown for migration
   planning; the bright line is `rejected`. Save-back continues to exclude both
   from the commit (unchanged).

4. **Atomicity = ALL-OR-NOTHING via a NEW AMS-native `@Transactional` bulk
   endpoint** (user OVERRODE the best-effort default for the oracle-grade story).
   The endpoint applies a bulk review action (Approve/Reject/Defer) across the
   cascade set — candidates AND their linked findings — in ONE transaction; if ANY
   entity fails, the WHOLE batch rolls back. Modelled on the existing finding
   `bulkReview` pattern but spanning candidates + findings (preserve each entity's
   `previous_review_status` audit; respect `committed` gating; any→any
   transitions). The gateway proxies it; the grid calls it after preview→confirm.
   The best-effort per-row fan-out is REPLACED by this atomic endpoint for the
   cascade-apply path. snake_case wire. Bulk **Save** is a SEPARATE operation
   (Decision 5), NOT part of this review-action endpoint.

5. **Bulk Save = reuse the existing `save-approved` path verbatim.** `mcp-server`
   `saveDiscoveryCandidatesToModel(mode='manual')` commits `review_status==='approved'`
   into the architecture model and transitions to `committed`, with the SAME
   AppShell cache handling the run-detail page already does (`LOAD_MODEL` same-arch,
   `invalidateArchitectureModelCache` cross-arch — see `project_appshell_model_cache`).
   Save commits the WHOLE approved set for the run (one Save meaning). Surface the
   Save action in the grid's bulk toolbar + wire the same post-save cache refresh.

6. **Reversibility = automatic.** Because suppression is a read-time filter on the
   LIVE `review_status` (Decision 2), re-approving a rejected candidate/finding
   makes it reappear downstream on the next context build — nothing to "unset".
   Assert with a reject → absent → re-approve → present round-trip test.

7. **Linked findings are cascade dependents.** When a candidate is rejected, its
   linked findings (`target_type='discovery_candidate'`) are pulled into the
   preview as dependents, PRE-SELECTED, and rejected with the candidate
   (curated/deselectable per Decision 1) — belt-and-braces suppression (gone both
   because the finding is rejected AND its candidate is). Findings + candidates
   share the Approve/Reject/Defer vocabulary uniformly.

8. **Preview→confirm architecture = a shared deterministic "resolve bulk action
   set" helper.** A PURE function: given a selection + the Spec 1 review model,
   return the full touched set (candidates + cascaded dependents + linked findings)
   with cascade provenance (which edge pulled each in) + net counts from
   `blast_radius`/`aggregations`. The grid's confirm modal is a THIN renderer over
   it; Spec 3's conversation calls the SAME helper headlessly.
   **Recommended home:** a pure, dependency-free TypeScript module that BOTH the
   frontend grid and the gateway/discovery coordinator can import. Because it is a
   pure function over the already-serialized snake_case `ReviewModel` wire shape
   (no React, no I/O), it can live either as a shared frontend util (e.g.
   `frontend/src/components/Discovery/resolveBulkActionSet.ts` next to the modal)
   OR — if Spec 3's coordinator runs server-side and cannot import frontend code —
   as a gateway/discovery module the grid also calls. The deciding factor is WHERE
   Spec 3's coordinator executes: if it is a gateway service, place the helper in a
   gateway location both can reach (a shared `gateway/src/services/...` module the
   frontend re-implements against the same wire types is the fallback when no
   common import boundary exists). The spec-writer should confirm Spec 3's
   coordinator runtime and pick the single home that avoids duplication; the
   load-bearing requirement is that it is ONE pure function consumed by both, not
   two divergent copies.

9. **Selection model = curation within the confirm modal ONLY.** No per-row grid
   checkboxes; the grid keeps its `'all' | 'filtered'` scope (like FindingsTab).
   Add a bulk toolbar + a `BulkCandidateActionConfirmModal` (sibling of
   `BulkFindingActionConfirmModal`) that renders the blast-radius preview: net
   counts, which items are pulled in by cascade and via which edge (provenance),
   with deselect.
