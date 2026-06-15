# Specification: Per-Service Scan Selection (Half A)

## Goal

Replace the Discovery Review Room's hardcoded "max 1 code scan + 1 database scan" picker with one selection PER scanned SERVICE (0-or-1 run each), so a UI + Service + Database review (2 code + 1 DB runs) becomes legitimate. This is a wire-shape + UI change only — the review-model builder is already N-run-capable.

## User Stories

- As an architect reviewing a multi-tier product, I want to pick one scan per service (e.g. "MyApp UI", "MyApp API", "MyApp Sybase Database") so that I can review two code scans and a database scan together, instead of being capped at one code scan.
- As an architect, I want each service group labelled with its human service name (and an "Unassigned scans" bucket for orphan runs) so that I can tell the scans apart without decoding short run-ids.

## Specific Requirements

**Per-service scan picker (replaces the two hardcoded fieldsets)**
- Group `runs` by `DiscoveryRunDto.service_id` (`discoveryApi.ts:151`); render ONE picker per distinct service, each offering its runs plus a "None" option (0-or-1 selected per service).
- Orphan runs (NULL `service_id`) group under a synthetic **"Unassigned scans"** bucket with the same 0-or-1 picker.
- Replaces the two `discovery_kind`-grouped fieldsets — `codeRuns`/`dbRuns` (`DiscoveryReviewRoom.tsx:202-209`) and the two `<fieldset>`s "Code scan"/"Database scan" (`DiscoveryReviewRoom.tsx:656-712`) inside `ScanSelection` (`624-733`).
- Update the help text (`640-645`) away from "Pick up to one code scan and up to one database scan".
- Seat the current run (`runId`) as the default selection within ITS service group.
- The Begin button stays disabled until ≥1 run is selected overall (generalize `disabled={... (!selectedCodeRunId && !selectedDbRunId)}` at `DiscoveryReviewRoom.tsx:726`).

**Cardinality: 0-or-1 per service, ≥1 overall**
- Each service group permits at most one selected run (a service may be skipped entirely).
- At least one run must be selected across all groups for Begin to be enabled.
- No upper bound on the number of services selected (the 1-code-XOR-1-DB cap is removed).

**Service display name with snapshot fallback**
- Display name precedence: model `services[].name` when `service_id` resolves; else the run's `serviceIdentitySnapshot.service_name`; else today's short run-id label `runLabel(run)` (`DiscoveryReviewRoom.tsx:86-90`).
- Read `services[]` from the AppShell's already-loaded per-(project, architecture) model cache (the full-model GET — no new fetch).
- **FIX the camelCase/snake_case mismatch:** the snapshot is WRITTEN camelCase (`serviceName`) at `discovery-service/src/routes/runs.ts:369-376` but TYPED snake_case (`service_name`) on `ServiceIdentitySnapshot` (`discoveryApi.ts:120-127`), so the name never surfaces today. Reconcile so the fallback name actually reads — align the write to the typed snake_case shape (or make the read tolerant of both), in scope for surfacing the display name.

**`SelectedScanSet` N-run selection shape (replaces `SelectedScanPair`)**
- Replace `SelectedScanPair` (`reviewTurnShape.ts:64-73`; `primaryRunId`/`primaryScanKind`/`secondRunId`/`secondScanKind`, which ASSUMES `primaryScanKind !== secondScanKind`) with `SelectedScanSet { runs: Array<{ runId: string; scanKind: 'code' | 'database'; serviceId: string | null }>; primaryRunId: string }`.
- **KEEP `primaryRunId`** as the thread anchor (the first chosen run in a deterministic order) so the run-id-keyed routes stay stable — `startReview` / `/answer` / `/capture` / `/confirm` / `loadReviewConversation` (`discoveryReviewConversation.ts`) keep `:runId` = `primaryRunId`.
- Mirror the new shape on the frontend `SelectedScanPairWire` → `SelectedScanSetWire` (`discoveryReviewApi.ts:78-83`) and on `OpenTurn.scanPair` (`reviewTurnShape.ts:131-137`).
- The `OpenTurn` renderer (`DiscoveryReviewRoom.tsx:772-779`) currently keys on `scanPair.secondRunId` ("code + database scans" vs "<kind> scan") — re-derive its summary line from the run set.

**Widen the review-model COUNTS API + gateway review routes to the full run-id set**
- `getReviewModelCounts(projectId, architectureId, primaryRunId, secondRunId?)` (`discoveryReviewApi.ts:492-522`) takes a single optional `secondRunId`; widen it to carry the full selected run-id set (preserving `primaryRunId` in the path).
- `refetchCounts` (`DiscoveryReviewRoom.tsx:223-239`) currently passes `pair.primaryRunId` + `pair.secondRunId`; pass the full set.
- Gateway proxy `GET .../runs/:runId/review-model` (`gateway/src/routes/discovery.ts:572-605`) and the conversation routes' `fetchReviewModel` (`discoveryReviewConversation.ts:182-202`, `parseScanPair` at `225-243`) forward an OPTIONAL single `secondRunId` today; widen both to forward the full additional-run-id set alongside `primaryRunId`.
- The discovery-service `review-model` route (`discovery-service/src/routes/runs.ts:689-795`) caps the selection at TWO runs (`700-706`) and rejects two same-kind runs (`764-774`); relax that query-param parsing (`697-725`) to accept the full set so a `2 code + 1 DB` selection is valid. The pure builder `buildReviewModel(runInputs)` (`781-794`) is UNCHANGED — only the route's parse/validation widens.

**Pure `deriveServiceTier` helper (shared with Half B)**
- Introduce `deriveServiceTier(service, appComponentsById) → 'UI' | 'Service' | 'Persistence' | 'Unknown'`, a pure function with no I/O.
- Traverse `ServiceDto.app_component_id` (`ServiceDto.java:29-30`) → `ApplicationComponentDto.tech_type` (`ApplicationComponentDto.java:30-31`), mapping `'UI Tier'|'Service Tier'|'Persistence Tier'` to `'UI'|'Service'|'Persistence'` and `'Other'`/unresolved to `'Unknown'`.
- Both hops are nullable: a NULL `app_component_id`, a missing component, or `tech_type='Other'`/unset all resolve to `'Unknown'` — NEVER throw, NEVER block.
- Used HERE only for OPTIONAL tier labels on the picker; reused unchanged by Half B (no runtime data handoff between the specs).
- `TechType` literals mirror `frontend/src/types/model.ts:270`.

**Disambiguate the "tier" overload (naming guard)**
- `DiscoveryRunDto.tier` (`discoveryApi.ts:140`) is the V3 CONFIDENCE ladder `'A'|'B'|'C'` — UNRELATED to technology tier and NOT used by this spec.
- The spec's "tier" is the architectural TECHNOLOGY tier from `tech_type`. In code, say "technology tier" / name the literal; name any new flag unambiguously (e.g. `hasUiTier`), never bare `tierA`-style.

## Visual Design

No visual assets provided (`planning/visuals/` is empty). This is a pure UI + wire-shape change; the picker re-skins the existing `ScanSelection` chrome (`DiscoveryReviewRoom.module.css`) — one group per service in place of the two `discovery_kind` fieldsets.

## Existing Code to Leverage

**`buildReviewModel(runs: readonly ScanRunInput[])` — already N-run-capable**
- `discovery-service/src/services/reviewModel/buildReviewModel.ts:372` already takes an ARRAY of runs and unions node-set, survivor index, edges, and findings across all of them; `scan_selection: runs.map(...)` at `438`; `computeCrossScanEdges(runs, ...)` at `426`.
- REUSE UNCHANGED — the deterministic review-model union needs no backbone edit; the constraint is entirely the wire shape + the route parse/validation cap.

**The AppShell per-(project, architecture) model cache (the bridge's data source)**
- The full-model GET `/api/model/projects/{projectId}/architectures/{architectureId}` → `ArchitectureModelDto` (`ModelController.loadModelForArchitecture:81`) ships `services` + `app_components` in `MetaModelEntitiesDto`, and the AppShell already loads + caches it.
- READ `services[].name` (display name) and the `service_id → app_component_id → tech_type` chain (tier label) from this cache — NO new AMS endpoint.

**`SelectedScanPair` plumbing + `getReviewModelCounts` (the wire to widen)**
- `reviewTurnShape.ts:64-73` (gateway type) + `discoveryReviewApi.ts:78-83` (frontend wire mirror) + `parseScanPair` (`discoveryReviewConversation.ts:225-243`) are the exact 2-run shape to replace with `SelectedScanSet`.
- `handleBegin` (`DiscoveryReviewRoom.tsx:244-301`) assembles the pair and derives `primaryRunId`/`secondRunId`; re-target it to assemble the run set while still computing a deterministic `primaryRunId`.

**Existing test harnesses to extend**
- `frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx` (Vitest) — the room picker tests.
- `gateway/src/__tests__/discovery-review-model-proxy.test.ts` + `discovery-review-conversation-routes.test.ts` (Jest) — the wire-shape / route plumbing tests.

## Out of Scope

- The tier-confirmation turn + Architect-conversation question gating — that is Half B (`2026-06-05-architect-tier-gating`, separate spec; shares only the pure `deriveServiceTier` helper, no runtime handoff).
- Any new discovery SCANNING logic or new pack/scanner work.
- The backbone review-model UNION (`buildReviewModel`) — already N-run-capable; reused unchanged.
- A new AMS list-components / list-services endpoint — the full-model GET already carries `services` + `app_components` and the AppShell already caches it.
- Any AMS change at all (no new DTO, column, or endpoint).
- The Review Room agenda redesign + the reject-cascade specs — already built and shipped.
- Any change to the conflict-resolution, confirm-gate, degrade-in-place, or counts-aggregation semantics beyond carrying the full run-id set.
