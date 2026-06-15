# Task Breakdown: Per-Service Scan Selection (Half A)

## Overview

Total Tasks: 4 task groups (38 sub-tasks)

Replace the Discovery Review Room's hardcoded "max 1 code scan + 1 database
scan" picker with one selection PER scanned SERVICE (0-or-1 run each), so a
UI + Service + Database review (2 code + 1 DB) becomes legitimate.

**Scope is frontend + gateway + discovery-service ROUTE parsing only.**

- **NO AMS change.** The full-model GET
  (`/api/model/projects/{projectId}/architectures/{architectureId}`) already
  carries `services` + `app_components`, and the AppShell `ArchitectureContext`
  already loads + caches that per (project, architecture). No new DTO, column,
  or endpoint.
- **NO `buildReviewModel` backbone change.** `buildReviewModel(runs[])`
  (`discovery-service/src/services/reviewModel/buildReviewModel.ts:372`) is
  ALREADY N-run-capable (it unions node-set, survivor index, edges, and
  findings across an ARRAY of runs). The ONLY discovery-service change is
  relaxing the `review-model`/counts ROUTE's two-run cap + same-kind rejection
  (`discovery-service/src/routes/runs.ts:700-706, 764-774`). This is encoded as
  an explicit guard in Task Group 3.

**"Tier" disambiguation (applies to every group, especially 1 and 4):** there
are TWO unrelated "tiers" in this code.
- **V3 discovery CONFIDENCE tier** = `'A'|'B'|'C'` on `DiscoveryRunDto.tier`
  (`discoveryApi.ts:140`) — the pack-confidence ladder. NOT this spec's tier; NOT
  used here.
- **Architectural TECHNOLOGY tier** = `'UI Tier'|'Service Tier'|'Persistence
  Tier'|'Other'` on `ApplicationComponentDto.tech_type` — THIS spec's tier.
  Always say "technology tier" / name the literal; name any new flag
  unambiguously (`hasUiTier`, NOT bare `tierA`-style).

## Task List

### Shared Wire Shape & Pure Helper (Foundational)

#### Task Group 1: `SelectedScanSet` N-run shape + `deriveServiceTier` helper
**Dependencies:** None

Everything downstream depends on the new wire type and the pure helper, so this
group lands first. It replaces the 2-run `SelectedScanPair` with the N-run
`SelectedScanSet` on BOTH the gateway type and the frontend mirror, KEEPING
`primaryRunId` as the thread key, and introduces the pure client-side
`deriveServiceTier` helper.

- [x] 1.0 Complete the shared wire shape + pure helper
  - [x] 1.1 Write 2-8 focused tests for `deriveServiceTier` + the new shape
    - Limit to 2-8 highly focused tests maximum (frontend Vitest, co-located
      with the new helper).
    - Cover ONLY the critical `deriveServiceTier` branches: resolves `'UI
      Tier'→'UI'`, `'Service Tier'→'Service'`, `'Persistence Tier'→'Persistence'`;
      and the THREE nullable-hop escape paths all return `'Unknown'` and never
      throw (NULL `app_component_id`, missing component id in the map,
      `tech_type='Other'`/unset).
    - Optionally one type-level/shape assertion that a `SelectedScanSet` round-
      trips `runs[]` + `primaryRunId`.
    - Skip exhaustive coverage of every literal combination and ordering.
  - [x] 1.2 Replace `SelectedScanPair` with `SelectedScanSet` (gateway type)
    - File: `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts:64-73`.
    - New shape: `SelectedScanSet { runs: Array<{ runId: string; scanKind:
      'code' | 'database'; serviceId: string | null }>; primaryRunId: string }`.
    - KEEP `primaryRunId` (first chosen run in a deterministic order) as the
      thread anchor; the SET rides alongside the way `secondRunId` does today.
    - Update `OpenTurn.scanPair` (`reviewTurnShape.ts:131-137`) to the new type.
    - Remove the `primaryScanKind !== secondScanKind` assumption from the doc
      comment (it no longer holds — 2-code+1-DB is now valid).
  - [x] 1.3 Mirror the new shape on the frontend wire type
    - File: `frontend/src/api/discoveryReviewApi.ts:78-83` — rename
      `SelectedScanPairWire` → `SelectedScanSetWire` with the identical fields.
    - Keep it byte-compatible with the gateway type (same field names/casing).
  - [x] 1.4 Add the pure `deriveServiceTier` helper (frontend)
    - New pure function (no I/O):
      `deriveServiceTier(service, appComponentsById) → 'UI' | 'Service' |
      'Persistence' | 'Unknown'`.
    - Traverse `ServiceDto.app_component_id`
      (`ServiceDto.java:29-30`, wire `app_component_id`) →
      `ApplicationComponentDto.tech_type` (`ApplicationComponentDto.java:30-31`),
      mapping `'UI Tier'|'Service Tier'|'Persistence Tier'` to
      `'UI'|'Service'|'Persistence'` and `'Other'`/unresolved to `'Unknown'`.
    - All three hops nullable — NULL `app_component_id`, missing component, or
      `tech_type='Other'`/unset all resolve to `'Unknown'`; NEVER throw, NEVER
      block.
    - Mirror the `TechType` literals from `frontend/src/types/model.ts:270`.
    - Place it where BOTH this spec's picker and Half B can import it unchanged
      (a small shared module under `frontend/src/`), since both halves derive
      client-side from the cached model. No runtime data handoff to Half B —
      code-sharing only.
    - Name any new flag unambiguously (technology tier, never `tierA`).
  - [x] 1.5 Ensure the shared-shape tests pass
    - Run ONLY the 2-8 tests written in 1.1 (Vitest, this helper's file).
    - Confirm net-zero NEW `tsc` errors introduced by the type rename in this
      group's files (the frontend has a large pre-existing `tsc` baseline —
      verify net-zero new, do NOT chase the baseline).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `SelectedScanSet`/`SelectedScanSetWire` exist on gateway + frontend with
  `runs[]` + `primaryRunId`; `SelectedScanPair`/`SelectedScanPairWire` are gone.
- `deriveServiceTier` is pure, returns `'Unknown'` on every nullable-hop miss,
  and never throws.
- No new `tsc` errors beyond the pre-existing baseline.

### Gateway Plumbing

#### Task Group 2: Thread the `SelectedScanSet` + widen the counts proxy
**Dependencies:** Task Group 1

Thread the new shape through the run-id-keyed conversation routes and widen the
review-model COUNTS proxy to carry the full additional-run-id set — while
keeping `primaryRunId` as the path anchor so the run-id-keyed routes stay
stable.

- [x] 2.0 Complete the gateway plumbing
  - [x] 2.1 Write 2-8 focused tests for the gateway routes/proxy
    - Limit to 2-8 highly focused tests maximum (Jest), extending
      `gateway/src/__tests__/discovery-review-conversation-routes.test.ts` and
      `gateway/src/__tests__/discovery-review-model-proxy.test.ts`.
    - Cover ONLY: (a) `parseScanPair` parses a 3-run `SelectedScanSet` (2 code +
      1 DB) and preserves `primaryRunId`; (b) the `review-model` proxy forwards
      the FULL additional-run-id set (>1 extra) to the discovery-service URL,
      not just a single `secondRunId`.
    - Skip exhaustive route-by-route coverage.
  - [x] 2.2 Widen `parseScanPair` to the N-run shape
    - File: `gateway/src/routes/discoveryReviewConversation.ts:225-243`.
    - Parse `body.scanPair` into the new `SelectedScanSet` (`runs[]` +
      `primaryRunId`) instead of the 4-field pair.
    - Keep `:runId` (= `primaryRunId`) as the supplied path anchor.
  - [x] 2.3 Thread the set through the conversation routes
    - Same file: `startReview` / `/answer` / `/capture` / `/confirm` /
      `loadReviewConversation` (the `ROUTE_BASE` handlers).
    - Each keeps `:runId` = `primaryRunId`; the additional run ids ride in the
      `scanPair`/`SelectedScanSet` payload (as `secondRunId` did before).
  - [x] 2.4 Widen `fetchReviewModel` to forward the full run-id set
    - File: `gateway/src/routes/discoveryReviewConversation.ts:182-202`.
    - Change the `secondRunId: string | null` param to carry the full
      additional-run-id set; emit one `secondRunId=...` query param per
      additional run (repeated-param form) alongside the `primaryRunId` path.
  - [x] 2.5 Widen the `review-model` proxy to forward the full set
    - File: `gateway/src/routes/discovery.ts:572-605`.
    - It already forwards a repeated `secondRunId` array verbatim — confirm/extend
      so an N-element additional-run-id set passes through unchanged (no >2 cap
      at the gateway; the discovery-service is the validator).
    - Keep `:runId` (= `primaryRunId`) as the path segment.
  - [x] 2.6 Ensure the gateway tests pass
    - Run ONLY the 2-8 tests written in 2.1 (the two `gateway/src/__tests__/`
      files touched).
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- `parseScanPair` + the conversation routes carry the N-run `SelectedScanSet`,
  with `primaryRunId` unchanged as the thread/path key.
- The `review-model` proxy + `fetchReviewModel` forward the FULL additional-run-id
  set (>1 extra) to the discovery-service.

### Discovery-Service Route Relaxation

#### Task Group 3: Relax the `review-model` route's 2-run cap (route only)
**Dependencies:** Task Group 2

Relax ONLY the `review-model`/counts route's param parsing + validation. The
pure builder `buildReviewModel(runInputs)` is UNCHANGED (it already unions N
runs).

- [x] 3.0 Complete the discovery-service route relaxation
  - [x] 3.1 Write 2-8 focused tests for the relaxed route
    - Limit to 2-8 highly focused tests maximum (Jest), extending
      `discovery-service/src/__tests__/reviewModelEndpoint.twoRun.test.ts` (the
      existing two-run harness) — add a 3-run case.
    - Cover ONLY: (a) a `2 code + 1 database` selection (3 run ids) is ACCEPTED
      and returns a unioned model (no 400); (b) a same-kind multi-run selection
      (e.g. 2 code) is ACCEPTED now (the old same-kind 400 is gone); (c) a still-
      invalid input is still rejected (a missing run → 404, or an arch mismatch →
      409) so the relaxation didn't drop the real guards.
    - Skip exhaustive permutation coverage.
  - [x] 3.2 Remove the explicit two-run cap guard
    - File: `discovery-service/src/routes/runs.ts:700-706`.
    - Delete the `rawSecond.length > 1 → 400` branch; accept the full repeated
      `secondRunId` array as the additional-run-id set.
    - Build `selectedRunIds = [runId, ...additionalRunIds]` (dedupe so a run id
      can't appear twice).
  - [x] 3.3 Remove the same-kind rejection guard
    - File: `discovery-service/src/routes/runs.ts:764-774`.
    - Delete the `kindsSeen.has(scanKind) → 400` branch and the `kindsSeen` set
      it depends on, so two code-kind runs in one selection is valid.
    - Update the route doc comment (`runs.ts:680-688`) which currently states
      ">2 runs, or two runs of the SAME kind" are rejected — it no longer holds.
  - [x] 3.4 Preserve the surviving validations
    - KEEP: the per-run `getDiscoveryRun` existence check (missing run → 404,
      `runs.ts:736-741`), the architecture-mismatch check (→ 409,
      `runs.ts:742-759`), and the `secondRunId === runId` self-reference guard
      (generalize it to "no additional run id equals the primary").
    - Confirm `buildReviewModel(runInputs)` (`runs.ts:781-794`) is called
      UNCHANGED with the now-N-element `runInputs`.
  - [x] 3.5 Ensure the route-relaxation tests pass
    - Run ONLY the 2-8 tests written in 3.1 (the `reviewModelEndpoint.twoRun`
      harness file).
    - Do NOT run the entire discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- A `2 code + 1 DB` selection (3 run ids) is accepted and returns a unioned
  review model.
- The two-run cap (`700-706`) and the same-kind rejection (`764-774`) are gone;
  the existence / arch-mismatch / self-reference guards remain.
- `buildReviewModel` is untouched.

### Frontend Per-Service Picker

#### Task Group 4: Per-service picker + service-name display + snapshot fix
**Dependencies:** Task Groups 1-3

Rework the Review Room opener: group runs by `service_id`, render ONE picker per
service (0-or-1 each; ≥1 overall to Begin), add an "Unassigned scans" bucket for
orphan runs, surface a human display name (fixing the camelCase/snake_case
snapshot mismatch), assemble the `SelectedScanSet`, and optionally label each
group with `deriveServiceTier`.

**GOTCHA (must address in this group):** any Vitest that renders
`DiscoveryReviewRoom`/`DiscoveryCandidateTable` MUST include `getReviewModel` in
the `discoveryApi` mock factory (the on-mount fetch), else the test throws "No
getReviewModel export…". Copy the mock pattern from the existing
`DiscoveryReviewRoom.test.tsx`/`DashboardView` tests.

- [x] 4.0 Complete the frontend per-service picker
  - [x] 4.1 Write 2-8 focused tests for the picker
    - Limit to 2-8 highly focused tests maximum (Vitest), extending
      `frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx`.
    - Include `getReviewModel` in the `discoveryApi` mock factory (the GOTCHA
      above) so the on-mount fetch resolves.
    - Cover ONLY: (a) runs grouped by `service_id` render ONE picker per
      service, each with a "None" option (0-or-1 per service); (b) orphan
      (NULL `service_id`) runs render under the "Unassigned scans" bucket;
      (c) Begin is disabled with nothing selected and enabled once ≥1 run is
      picked across groups; (d) the display name surfaces from `services[].name`
      and falls back to the snapshot `service_name` (regression for the snapshot
      fix).
    - Skip exhaustive per-state coverage.
  - [x] 4.2 Fix the `serviceIdentitySnapshot` camelCase/snake_case mismatch
    - The snapshot is WRITTEN camelCase (`serviceName`) at
      `discovery-service/src/routes/runs.ts:369-376` but TYPED snake_case
      (`service_name`) on `ServiceIdentitySnapshot` (`discoveryApi.ts:120-127`),
      so the fallback name never surfaces today.
    - Reconcile so the fallback name reads — align the discovery-service WRITE to
      the typed snake_case shape (`service_name`, `service_type`, etc.), or make
      the frontend READ tolerant of both. In scope ONLY for surfacing the
      display name.
  - [x] 4.3 Read `services` + `app_components` from the cached model
    - Source: the AppShell per-(project, architecture) model cache via
      `useArchitecture()` / `ArchitectureContext` (which already holds
      `services` + `app_components` from the full-model GET). NO new fetch, NO
      new AMS endpoint.
    - Build an `appComponentsById` map (for `deriveServiceTier`) and a
      `serviceById` lookup (for the display name) from the cached entities.
  - [x] 4.4 Group runs by service + build a display name
    - Replace the `discovery_kind` grouping `codeRuns`/`dbRuns`
      (`DiscoveryReviewRoom.tsx:202-209`) with a group-by-`service_id` over
      `runs` (`DiscoveryRunDto.service_id`).
    - Display-name precedence: model `services[].name` when `service_id`
      resolves → else the run's snapshot `service_name` (now readable post-4.2) →
      else `runLabel(run)` (`DiscoveryReviewRoom.tsx:86-90`).
    - Orphan runs (NULL `service_id`) collect into a synthetic "Unassigned
      scans" bucket.
  - [x] 4.5 Rework `ScanSelection` into a per-service picker
    - File: `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx:624-733`.
    - Replace the two `<fieldset>`s "Code scan"/"Database scan" (`656-712`) with
      ONE fieldset per service group (plus the "Unassigned scans" group), each a
      radio set of its runs + a "None" option (0-or-1 selected per group).
    - Drop the `codeRuns`/`dbRuns`/`selectedCodeRunId`/`selectedDbRunId` props in
      favour of the per-service selection state.
    - Update the help text (`640-645`) away from "Pick up to one code scan and
      up to one database scan" to describe per-service selection.
    - Seat the current run (`runId`) as the default selection within ITS service
      group.
    - Generalize the Begin disable condition (`726`,
      `!selectedCodeRunId && !selectedDbRunId`) to "no run selected across any
      group".
  - [x] 4.6 Replace the per-service selection state
    - Replace `selectedCodeRunId`/`selectedDbRunId` (`148-153`) with a
      per-service selection map (`serviceKey → selected runId | null`),
      seeding the current run's group.
  - [x] 4.7 Assemble the `SelectedScanSet` in `handleBegin`
    - File: `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx:244-301`.
    - Build `runs[]` from every selected pick `{ runId, scanKind, serviceId }`
      (`scanKind` via `normalizeScanKind(run.discovery_kind)`; `serviceId` =
      `run.service_id ?? null`).
    - Compute `primaryRunId` deterministically (e.g. the current `runId` when
      it's among the picks, else the first pick in a stable order) so the thread
      key is stable; post via `startReview({ … scanPair: SelectedScanSet })`.
  - [x] 4.8 Widen `getReviewModelCounts` + `refetchCounts` to the full set
    - `getReviewModelCounts` (`discoveryReviewApi.ts:492-522`): change the single
      optional `secondRunId` to carry the full additional-run-id set (emit one
      repeated `secondRunId=...` query param per additional run, `primaryRunId`
      stays in the path).
    - `refetchCounts` (`DiscoveryReviewRoom.tsx:223-239`): pass the full set from
      the `SelectedScanSet` instead of `pair.primaryRunId` + `pair.secondRunId`.
  - [x] 4.9 Re-derive the `open`-turn summary line from the run set
    - The `open`-turn renderer (`DiscoveryReviewRoom.tsx:772-779`) currently keys
      on `scanPair.secondRunId` ("code + database scans" vs "<kind> scan").
    - Re-derive the summary from `scanPair.runs[]` (e.g. count of scans / kinds)
      so it reads correctly for a 3-run selection.
  - [x] 4.10 Optionally label each service group with the technology tier
    - Use `deriveServiceTier(service, appComponentsById)` from Task Group 1 for
      an OPTIONAL technology-tier label on each service group (UI/Service/
      Persistence/Unknown).
    - Must NEVER block selection on an unresolved tier — "Unknown" is a valid,
      fully-selectable label.
    - Name any flag unambiguously (technology tier); do NOT confuse with
      `DiscoveryRunDto.tier` (the A/B/C confidence ladder).
  - [x] 4.11 Ensure the picker tests pass
    - Run ONLY the 2-8 tests written in 4.1 (`DiscoveryReviewRoom.test.tsx`).
    - Confirm net-zero NEW `tsc` errors from this group's changes (verify
      net-zero new against the large pre-existing baseline — do NOT chase the
      baseline).
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- One picker renders per scanned service (0-or-1 each), plus an "Unassigned
  scans" bucket for orphan runs; ≥1 run overall enables Begin.
- The human service name surfaces (model `services[].name` → snapshot
  `service_name` → `runLabel`), with the snapshot camelCase/snake_case mismatch
  fixed.
- `handleBegin` posts a `SelectedScanSet`; `getReviewModelCounts`/`refetchCounts`
  carry the full run-id set; the `open`-turn summary reads correctly for ≥3 runs.
- Optional technology-tier labels never block selection; "Unknown" is selectable.
- No new `tsc` errors beyond the pre-existing baseline.

## Execution Order

Recommended implementation sequence (dependency-ordered, foundational first):

1. **Shared Wire Shape & Pure Helper** (Task Group 1) — the `SelectedScanSet`
   type + `deriveServiceTier`; everything downstream depends on these.
2. **Gateway Plumbing** (Task Group 2) — thread the set through the conversation
   routes + widen the counts proxy, `primaryRunId` unchanged.
3. **Discovery-Service Route Relaxation** (Task Group 3) — relax ONLY the
   `review-model` route's 2-run cap + same-kind rejection; `buildReviewModel`
   untouched.
4. **Frontend Per-Service Picker** (Task Group 4) — the per-service picker,
   service-name display + snapshot fix, `SelectedScanSet` assembly, counts
   widening, and optional tier labels.

## Notes

- **No AMS change, no `buildReviewModel` change.** The only backend edits are the
  gateway plumbing (Group 2) and the discovery-service ROUTE parse/validation
  (Group 3). `buildReviewModel(runs[])` is already N-run-capable and is reused
  unchanged.
- **`primaryRunId` is the thread/path anchor throughout.** It MUST stay the
  `:runId` path segment on the run-id-keyed routes so they don't churn; the rest
  of the selection rides in the `SelectedScanSet` payload / repeated query
  params the way `secondRunId` did.
- **Tier overload:** V3 confidence tier (`'A'|'B'|'C'`, `DiscoveryRunDto.tier`)
  vs architectural technology tier (`'UI Tier'|...`, `tech_type`). Always name
  the technology tier explicitly; never a bare `tierA`-style flag.
- **Frontend `tsc` baseline:** the frontend has a large pre-existing `tsc` error
  baseline — verify net-zero NEW errors per group; do NOT attempt to clear the
  baseline.
- **Vitest `getReviewModel` GOTCHA (Group 4):** any test rendering
  `DiscoveryReviewRoom`/`DiscoveryCandidateTable` must add `getReviewModel` to
  the `discoveryApi` mock factory or the on-mount fetch throws "No getReviewModel
  export…".
- Feature tests only — each group runs ONLY its own newly-written tests; do NOT
  run whole suites.
- Half B (`2026-06-05-architect-tier-gating`) shares ONLY the pure
  `deriveServiceTier` helper (code-sharing, no runtime data handoff).
