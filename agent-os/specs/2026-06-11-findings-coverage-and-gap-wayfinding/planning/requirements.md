# Spec Requirements: Deterministic Findings-Coverage Verification + Gap Wayfinding

> Status: AUTHORITATIVE / BUILD-READY. All eight clarifying recommendations from the
> shaping session were accepted by the user verbatim and are baked in below as settled.
> Do NOT re-ask. The raw idea in `planning/raw-idea.md` carries the full problem
> statement and solution direction (treat its content as settled too).

## Initial Description

See `planning/raw-idea.md` (comprehensive). Summary:

Two related trust gaps in the migration-plan pipeline:

1. **Findings coverage is LLM-claimed.** The generated migration book of work's
   `findingsAddressed` / `findingsNotAddressed` numbers come from the LLM's own
   assertion. There is no deterministic check that every ACCEPTED critical/high
   discovery finding is referenced by at least one book-of-work item
   (`discoveryFindingReferences`). The same trust gap was already eliminated for
   endpoints (template stamping, sibling spec
   `2026-06-11-two-phase-migration-plan-generation`) and capture inventory
   (model-seeded reconciliation, sibling spec
   `2026-06-11-model-seeded-capture-inventory`) — findings are the LAST LLM-claimed
   coverage surface.
2. **Gaps are raw codes with no path to resolution.** The Migration Delivery Plan
   wizard's readiness panel shows bare gap codes (`no_api_behaviour_baseline`,
   `high_severity_unreviewed_findings`, `discovery_harness_inventory_mismatch`, ...)
   with no explanation of what they mean, why they matter, or WHERE in the tool to
   fix them. Every gap should carry a human explanation + a deep link (or
   nearest-route link with explanatory action text) to the resolving surface.

Philosophy (settled in the raw idea): the coverage computation is PURE CODE — the
LLM keeps producing its `discoveryFindingReferences`; code grades them. Everything
is advisory-only: nothing new blocks generation or saving. The registry lives in ONE
place (no per-surface copy drift). Back-compat: old drafts without computed coverage
render unchanged (no false alarms).

## Pre-Shaping Research (verified in repo 2026-06-11)

Research performed in the prior spec-shaper session; recorded here for the
spec-writer.

### The complete gap vocabulary

`MigrationGapCodes` defines **11 gap codes**:

1. `no_api_behaviour_baseline`
2. `unresolved_discovery_decisions`
3. `missing_current_to_target_mappings`
4. `no_database_discovery_findings`
5. `high_severity_unreviewed_findings`
6. `missing_oas_for_in_scope_interface`
7. `insufficient_runtime_evidence`
8. `no_sample_data_hints`
9. `incomplete_capture_coverage`
10. `under_specified_endpoints`
11. `discovery_harness_inventory_mismatch`

Plus **2 context warnings**: `no_discovery_runs_selected`, `no_findings_in_run`.
The registry must cover all 13, plus the new per-finding "unaddressed finding"
entries.

Semantics: "accepted" finding = `review_status = 'approved'`; "high severity" =
severity in `{critical, high}`.

### CRITICAL BUG FOUND (this spec is also a bug fix)

The LLM-asserted `findingsAddressed` / `findingsNotAddressed` are BROKEN today:

- `assembleBookOfWork` (the per-stream generation mode) **drops them entirely** from
  the assembled generation summary.
- The legacy combined mode emits **id ARRAYS** where the frontend types expect
  **numbers**.
- `MigrationDeliveryPlanProgressSummary` consequently falls back to 0.

The deterministic replacement therefore fixes a live defect, not just a trust gap.
Per the no-broken-UI principle, the legacy LLM-asserted numbers must stop rendering
everywhere (Decision D8).

### AMS persistence constraints

- `generation_summary_json` is **IMMUTABLE post-create**: the PUT endpoint limits
  editable fields to `title` / `summary` / `status` / `book_of_work_json`.
- The items/append endpoint merges only `epic_id` + `items` + `expansion_state` —
  BUT `book_of_work_json.items[].discoveryFindingReferences` IS kept current by
  expansion appends.
- Consequence (drives Decision D6): persist the accepted-findings SNAPSHOT into
  `generationSummary` at CREATE time (composed pre-create, so no AMS write change),
  and compute addressed/unaddressed ON READ from the always-current
  `discoveryFindingReferences` — coverage self-updates as epic expansions append
  stories, with NO AMS schema or write changes.

### Findings data sources

- `highPriorityFindings` in the migration discovery context is **ALL-statuses**,
  prioritised, and capped at `maxFindings` (default 100) — NOT a reliable
  accepted-critical/high set. Never use it as the coverage source.
- A dedicated paged AMS read exists:
  `GET .../discovery/runs/{runId}/findings?severity=&status=&page=&size=` — this is
  the coverage source (Decision D5).

### Destination addressability audit

Routable today (real routes with params):

- `/discovery/runs/:runId?tab=findings` (run detail, Findings tab)
- `/api-behaviour` (+ `sessions/:id`, `baselines/:id`)
- `/architecture-design/target-state`

NOT routable today (local state / modals — no URL):

- The finding detail drawer (local state on the run detail page)
- The Architecture Room (local state)
- The capture wizard (TopBar modal)
- The Start Discovery Run modal
- Per-interface OAS upload
- No decision-tasks page exists at all

### Id availability for deep links

The migration discovery context DTO already carries the ids the deep links need:
`discoveryRunIds`, `baselineId`/`sessionId` per baseline, `findingId`+`runId` per
highlight, `taskId`+`runId` per decision task — and the wizard holds the full
context in state. No readiness-response enrichment is needed for v1 (Decision D4).

## Requirements Discussion

### Settled Decisions (all 8 recommendations accepted verbatim)

**D1: The wayfinding registry is a FRONTEND-ONLY module.**
One module exporting `{code → {title, explanation, buildDestination(ctx),
actionLabel}}` where `ctx` carries `projectId` / `architectureId` / `runIds` /
`baselineIds` etc. No server-supplied component. Consumed by the wizard's Inputs &
context readiness panel (explanation cards + "Go to ..." links replacing bare
codes), the plan review workspace's unaddressed-findings panel, and the draft
summary.

**D2: Deep-link scope — two cheap route-param additions + nearest-route links for
the rest.**
- ADD `?findingId=` query-param support to the discovery run detail page (opens the
  finding drawer) — used by the per-finding unaddressed-findings links.
- ADD `?room=open` query-param support (opens the Architecture Room).
- NEAREST-ROUTE links with explanatory action text for the surfaces that are modals
  / local state: capture wizard → `/api-behaviour`; Start Discovery Run modal →
  `/discovery`; OAS upload → `/metamodel/applications`. No new pages, no modal
  routing framework.

**D3: `unresolved_discovery_decisions` → approximate link.**
Links to `/discovery/runs/:runId` with action text "Resolve decision tasks via the
Architecture Room". Building a dedicated decision-tasks surface is OUT of scope.

**D4: NO readiness-response enrichment in v1.**
"Which run" is derived client-side from the context the wizard already holds. When
the capped `highPriorityFindings` list shows no flagged run, fall back to the first
selected run's findings tab. Server-side `gapContexts` is a noted future option if
the cap bites in practice.

**D5: Coverage finding source — a dedicated paged AMS read at generation time.**
`GET .../runs/{runId}/findings` with `status=approved` and severity `critical|high`
(two filter passes per run if the endpoint's filters are single-value), per selected
run. NEVER the capped context `highPriorityFindings` list.

**D6: Recompute mechanics — snapshot at create, compute on read (option B).**
Persist the accepted-findings SNAPSHOT (ids + titles + severity per finding) into
`generationSummary` at CREATE time (it is composed pre-create, so no AMS write
change needed). Compute addressed/unaddressed ON READ from
`book_of_work_json.items[].discoveryFindingReferences` — coverage self-updates as
epic expansions append stories. NO AMS schema or write changes.

**D7: Dashboard IN scope.**
`MigrationDeliverySummaryCards`' broken `findingsAddressed` numbers are replaced
with the same computed-on-read values — no knowingly-broken card left behind.

**D8: Back-compat — hide, don't approximate.**
Drafts without the snapshot hide the coverage section entirely (no false alarms, no
"not computed" noise). The legacy LLM-asserted numbers stop rendering everywhere.

### Additional settled points

- **Advisory-only:** nothing blocks generation or saving — readiness remains advice
  + the user deciding.
- **The unaddressed-findings panel** in the plan review workspace uses the
  registry's per-finding deep links (`/discovery/runs/:runId?tab=findings&findingId=...`).
- **Coverage computation is pure gateway/frontend code — no LLM.** The LLM keeps
  producing `discoveryFindingReferences`; code grades them.

### Existing Code to Reference

**Similar Features / Reuse Pointers Identified:**

- **Code→label map precedent:** `humanizeCandidateType` + `SECTION_LABELS` in
  `frontend/src/components/.../DiscoveryReviewRoom.tsx` — the established pattern
  for mapping internal codes to human labels; the wayfinding registry follows the
  same shape, extended with explanation + destination builder + action label.
- **Deterministic-grading model:** the sibling spec
  `agent-os/specs/2026-06-11-model-seeded-capture-inventory` (model-seeded
  capture-inventory reconciliation) — the "code grades, LLM produces" philosophy
  this spec applies to findings coverage.
- **Styling precedents for explanation cards:** the existing readiness gap chips in
  the Migration Delivery Plan wizard + the `secretsPrompt` banner pattern — extend
  these conventions rather than inventing a new card style.
- **API error parsing:** the `extractGatewayErrorMessage` pattern for any new API
  error handling introduced by the dedicated findings read.
- **Pipeline touch points (from raw idea, repo-verified):**
  `gateway/.../migrationBookOfWorkHandler.ts` (generationSummary composition —
  deterministic counts already recomputed at assembly; the snapshot lands here),
  `migrationBookOfWorkExpansionHandler.ts` (expansion appends keep
  `discoveryFindingReferences` current), `MigrationBookOfWorkItem.discoveryFindingReferences`,
  `MigrationDiscoveryContextService` / `MigrationGapCodes` in AMS (the gap
  vocabulary — read-only reference; no AMS changes), the
  `MigrationDeliveryPlanWizard` Inputs & context stage, the plan review workspace,
  draft summary/list surfaces, and `MigrationDeliveryPlanProgressSummary` /
  `MigrationDeliverySummaryCards` (the broken consumers being fixed).

### Follow-up Questions

None required — all open design areas from `raw-idea.md` (registry location,
deep-link context source, recompute mechanics, dashboard scope) were resolved by
the eight accepted recommendations above.

## Visual Assets

### Files Provided:

No visual assets provided (verified: `planning/visuals/` contains no image files).

### Visual Insights:

Follow the existing Migration Delivery Plan styling — the wizard readiness panel's
gap chips and the `secretsPrompt` banner are the visual precedents for the new
explanation cards; the review workspace and draft summary keep their existing
layout conventions with the coverage section added.

## Requirements Summary

### Functional Requirements

**Part 1 — Deterministic findings coverage (gateway + frontend, no LLM):**

1. At plan CREATE time, fetch the accepted critical/high findings for the selected
   discovery runs via the dedicated paged AMS read
   (`GET .../runs/{runId}/findings`, `status=approved`, severity `critical` and
   `high`; two filter passes per run if filters are single-value) and persist the
   SNAPSHOT (id + title + severity per finding) into `generationSummary` before the
   draft is created (D5, D6).
2. Compute `findingsAddressed` / `findingsNotAddressed` ON READ: snapshot vs the
   union of `book_of_work_json.items[].discoveryFindingReferences`. Coverage
   self-updates as expansions append stories — no recompute writes (D6).
3. REPLACE the LLM-asserted numbers everywhere they render: progress summary,
   review workspace, draft summary/list, and `MigrationDeliverySummaryCards`
   (D7, D8). This also fixes the live bug (per-stream assembly drops the fields;
   legacy mode emits arrays where numbers are expected; cards fall back to 0).
4. Review workspace gains an "Unaddressed findings" panel listing each unaddressed
   finding (title + severity) with a per-finding deep link
   (`/discovery/runs/:runId?tab=findings&findingId=...`).
5. Advisory-only: coverage never fails or blocks generation/saving.
6. Back-compat: drafts without the snapshot hide the coverage section entirely; the
   legacy LLM numbers stop rendering for them too (D8).

**Part 2 — Gap wayfinding registry (frontend-only):**

7. One frontend module: `{code → {title, explanation, buildDestination(ctx),
   actionLabel}}` covering all 11 `MigrationGapCodes`, the 2 context warnings, and
   the per-finding unaddressed entry (D1).
8. New route-param support: `?findingId=` on the discovery run detail page (opens
   the finding drawer) and `?room=open` (opens the Architecture Room) (D2).
9. Nearest-route destinations with explanatory action text where the true surface
   is a modal: capture wizard → `/api-behaviour`; Start Discovery Run modal →
   `/discovery`; OAS upload → `/metamodel/applications`;
   `unresolved_discovery_decisions` → `/discovery/runs/:runId` with "Resolve
   decision tasks via the Architecture Room" (D2, D3).
10. Wizard readiness panel renders explanation cards (what it means, why it matters,
    "Go to ..." action) instead of bare codes; the same registry feeds the review
    workspace panel and draft summary.
11. Deep-link context (run ids etc.) derived client-side from the context the
    wizard holds; fallback to the first selected run's findings tab when no flagged
    run is identifiable (D4).

### Reusability Opportunities

- `humanizeCandidateType` / `SECTION_LABELS` (DiscoveryReviewRoom.tsx) — the
  code→label map idiom for the registry.
- Readiness gap chips + `secretsPrompt` banner — explanation-card styling.
- `extractGatewayErrorMessage` — error parsing for the new findings fetch.
- The model-seeded capture-inventory spec's deterministic-grading approach — same
  philosophy, applied to findings.
- Existing `migrationBookOfWorkHandler.ts` deterministic-count recomputation at
  assembly — the snapshot persists alongside it in the same composition step.

### Scope Boundaries

**In Scope:**
- Accepted-findings snapshot at create (dedicated paged AMS read) + on-read
  addressed/unaddressed computation.
- Replacing the broken LLM-asserted coverage numbers on all surfaces, including
  `MigrationDeliverySummaryCards`.
- The unaddressed-findings panel with per-finding deep links.
- The frontend wayfinding registry covering all 13 codes + per-finding entries.
- `?findingId=` and `?room=open` route-param additions.
- Nearest-route links + action text for modal-bound destinations.

**Out of Scope:**
- Any AMS schema or write changes (generation_summary_json stays immutable
  post-create; no new endpoints).
- A decision-tasks page/surface (approximate link per D3).
- Routing frameworks for modals (capture wizard, Start Discovery Run, OAS upload
  remain modals; nearest-route links only).
- Server-side `gapContexts` readiness enrichment (noted future option if the
  100-finding cap bites).
- Any blocking behaviour — coverage and gaps remain advisory.
- Retroactive snapshot backfill for existing drafts (they hide the section).

### Technical Considerations

- **No LLM involvement** in coverage: pure gateway/frontend code; the LLM's
  `discoveryFindingReferences` are inputs being graded, never the grade.
- **AMS immutability:** the snapshot MUST be composed into `generationSummary`
  before the create call — PUT cannot add it later (editable fields are
  title/summary/status/book_of_work_json only).
- **Append behaviour:** items/append merges epic_id + items + expansion_state and
  keeps `discoveryFindingReferences` current — which is exactly why on-read
  computation self-updates without recompute hooks.
- **Never use the capped context list** (`highPriorityFindings`, all-statuses,
  default cap 100) as the coverage source — always the dedicated paged read with
  explicit status/severity filters.
- **Single-value filters:** if the AMS findings endpoint's severity filter is
  single-value, perform two passes per run (critical, high) and union.
- **Route params, not new routes:** `?findingId=` and `?room=open` are query-param
  additions to existing pages — keep them tolerant (unknown id → no drawer, no
  crash).
- **Registry context type:** `buildDestination(ctx)` receives
  projectId/architectureId/runIds/baselineIds etc.; destinations must degrade
  gracefully when an id is absent (fall back to the listing route).
