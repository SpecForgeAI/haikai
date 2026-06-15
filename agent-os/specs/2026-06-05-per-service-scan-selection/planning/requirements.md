# Spec Requirements: Per-Service Scan Selection (Half A)

## Status

SPLIT 2026-06-05 from the combined "multi-service review scope + tier-gating"
idea (former Spec ⑤). Per the user's decision: **TWO specs.** THIS is **Half A —
per-service scan selection (BUILD FIRST).** Half B (tier-gating the target-state
Architect conversation) is a SEPARATE spec (`2026-06-05-architect-tier-gating`),
to be shaped later. They share ONE pure `deriveServiceTier` helper — NO runtime
data handoff. The full combined investigation (both halves) is retained at
`agent-os/specs/2026-06-05-multi-service-review-scope-and-tier-gating/planning/requirements.md`.

## Description (original triage point 7)

The Discovery Review Room scan picker currently allows MAX 1 code scan + 1
database scan (hardcoded). That is wrong — a UI + a Service + a DB scan = 2 code
+ 1 DB is legitimate. Replace the single "Code scan" + single "Database scan"
pickers with ONE picker PER scanned SERVICE (e.g. "MyApp UI", "MyApp API", "MyApp
Sybase Database"); if a service was scanned twice, the user picks which run for
THAT service.

## Confirmed Decisions (user, 2026-06-05 — LOCKED)

1. **TWO specs** (this is Half A; tier-gating is Half B, separate). A shared pure
   `deriveServiceTier(service, appComponentsById) → 'UI'|'Service'|'Persistence'|'Unknown'`
   helper is introduced HERE and reused by Half B (no data handoff between them).
2. **Cardinality:** 0-or-1 run per service (a service may be skipped); require
   **≥1 run selected overall** to Begin (mirrors today's
   `disabled={!selectedCodeRunId && !selectedDbRunId}` at `DiscoveryReviewRoom.tsx:726`).
3. **Display name:** group runs by `service_id`; display name = `services[].name`
   from the loaded meta-model when resolvable, else the run's
   `serviceIdentitySnapshot.serviceName`, else today's short run-id label
   (`runLabel`). Orphan runs (NULL `service_id`) group under a synthetic
   **"Unassigned scans"** bucket. **FIX the camelCase/snake_case
   `serviceIdentitySnapshot` mismatch** (written camelCase `serviceName` at
   `discovery-service/src/routes/runs.ts:369-376`; typed snake_case
   `service_name` on the frontend `ServiceIdentitySnapshot`,
   `discoveryApi.ts:120-127`) — IN SCOPE for surfacing the display name.
4. **Selection shape:** replace the 2-run `SelectedScanPair`
   (`primaryRunId`/`primaryScanKind`/`secondRunId`/`secondScanKind`, which ASSUMES
   `primaryScanKind !== secondScanKind`) with an N-run
   `SelectedScanSet { runs: Array<{ runId: string; scanKind: 'code'|'database';
   serviceId: string | null }>; primaryRunId: string }` — **KEEP `primaryRunId`**
   (the first chosen run in a deterministic order) as the thread anchor so the
   existing run-id-keyed routes (`startReview`/`/answer`/`/capture`/`/confirm`/
   `loadReviewConversation`) stay stable; the SET rides alongside the way
   `secondRunId` does today. Widen the review-model COUNTS API to carry the full
   run-id set.

## Lead Finding — the run → service → tier bridge (resolved, file:line)

The tier chain is a **two-hop meta-model traversal**, both hops nullable
(needed here for the shared helper + optional picker tier labels):

1. **run → service.** `DiscoveryRunDto.service_id` (`discoveryApi.ts:151`; AMS
   column `DiscoveryRunEntity.java:105` `@Column(name="service_id")`). Nullable
   since Liquibase 126 (ON DELETE SET NULL → "orphan runs"). The FK resolves to a
   **`service` entity**, NOT directly to an application_component.
2. **service → app_component.** `ServiceDto.appComponentId`
   (`ServiceDto.java:29-30`, `@JsonProperty("app_component_id")`). Nullable.
3. **app_component → tier.** `ApplicationComponentDto.techType`
   (`ApplicationComponentDto.java:30-31`, `@JsonProperty("tech_type")`). Values
   `'UI Tier' | 'Service Tier' | 'Persistence Tier' | 'Other'` (frontend mirror
   `TechType`, `frontend/src/types/model.ts:270`); defaults to `'Other'` when unset.

All three hops' data ships in the single full-model GET
`/api/model/projects/{projectId}/architectures/{architectureId}` →
`ArchitectureModelDto` (`ModelController.loadModelForArchitecture:81`;
`MetaModelEntitiesDto` carries `app_components` + `services`), which the AppShell
ALREADY loads + caches per (project, architecture). **No new backend endpoint is
needed.** `discovery_kind` (`'code'|'database'|'combined'`) is a LOSSY fallback
(database→Persistence is reliable; `code` cannot distinguish UI from Service), so
the authoritative tier source is `tech_type`; `discovery_kind` is the fallback
for orphan/unresolved runs.

## "Tier" is a DANGEROUSLY overloaded word here — disambiguate everywhere

- **V3 discovery CONFIDENCE tier** = `'A'|'B'|'C'` on `DiscoveryRunDto.tier`
  (`discoveryApi.ts:140`), the pack-confidence ladder. **NOT** what this spec means.
- **Architectural TECHNOLOGY tier** = `'UI Tier'|'Service Tier'|'Persistence
  Tier'|'Other'` on `ApplicationComponentDto.tech_type`. **THIS** is the spec's tier.

Always say "technology tier" / name the literal; name any new flag
unambiguously (`hasUiTier` etc., never bare `tierA`-style).

## Half A — grounded (current state + what must change)

**Current state (verified):**
- `DiscoveryReviewRoom.tsx` holds `selectedCodeRunId` + `selectedDbRunId`, each
  strictly 0-or-1 (lines 148-153). Two radio `<fieldset>`s — "Code scan" and
  "Database scan" — each with a "None" option (lines 656-712). Help text "Pick up
  to one code scan and up to one database scan" (640-645).
- The selected pair is assembled in `handleBegin` (244-301) into a
  `SelectedScanPairWire` and posted via `startReview({ … scanPair })`. The PRIMARY
  run keys the thread; the optional SECOND run (the OTHER kind) is in-session only.
- Runs are grouped purely by `discovery_kind` into `codeRuns`/`dbRuns`
  (202-209). There is NO grouping by service today.
- `runLabel(run)` (86-90) = `"<8-char id>… · <status>"` — no human service name
  (the room comment at line 86 notes "no name field exists on the DTO").

**The shape that must change (verified):**
`SelectedScanPair` (`gateway/.../reviewTurnShape.ts:64-73`) is hardcoded to TWO
runs and ASSUMES `primaryScanKind !== secondScanKind` (one code XOR one DB) —
the exact 1-code-1-DB constraint Half A removes. Consumed by: `handleBegin` +
`refetchCounts` (which passes `primaryRunId` + `secondRunId` to
`getReviewModelCounts`); the Review Room `open`-turn renderer (772-779: "code +
database scans" vs "<kind> scan"); and the 2-run count API
`getReviewModelCounts(projectId, architectureId, primaryRunId, secondRunId)`.

**The backbone ALREADY supports N runs (verified — important):**
`buildReviewModel(runs: readonly ScanRunInput[])`
(`discovery-service/.../buildReviewModel.ts:372`) takes an ARRAY of runs and
unions them (node-set, survivor index, relationship edges, findings) across ALL
of them; `scan_selection: runs.map(...)` (438); `computeCrossScanEdges` takes the
same array. So the deterministic review-model union is already N-run-capable; the
constraint is ENTIRELY in (a) the `SelectedScanPair` 2-run wire shape and (b) the
review-model COUNTS API + the gateway `startReview`/`/answer`/`/capture`/`/confirm`
plumbing that passes `primaryRunId` (+ optional `secondRunId`). **Half A is
primarily a wire-shape + UI change, not a backbone rewrite.**

## Existing Code to Reference

- `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` — the scan-selection
  opener (`ScanSelection`, 624-733), `handleBegin` (244-301), `runLabel` (86-90),
  the counts refetch (223-239).
- `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` — renders the
  Review Room (passes `runId`/`runDiscoveryKind`).
- `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts` —
  `SelectedScanPair` (64-73) + `OpenTurn` (131-137).
- `gateway/src/routes/discoveryReviewConversation.ts` — `startReview` / `/answer`
  / `/capture` / `/confirm` routes (the run-id-keyed plumbing).
- `discovery-service/src/services/reviewModel/buildReviewModel.ts` — the
  ALREADY-N-run union (`buildReviewModel(runs[])`, line 372).
- `frontend/src/api/discoveryApi.ts` — `DiscoveryRunDto` (129-180),
  `ServiceIdentitySnapshot` (120-127, the snake_case-vs-camelCase mismatch).
- `discovery-service/src/routes/runs.ts:323-376` — the camelCase
  `serviceIdentitySnapshot` write.
- **The bridge / shared:** `ModelController.loadModelForArchitecture`
  (`ModelController.java:81`) → `ArchitectureModelDto` → `MetaModelEntitiesDto`
  (`app_components` + `services`); `ServiceDto.app_component_id`
  (`ServiceDto.java:29-30`), `ApplicationComponentDto.tech_type`
  (`ApplicationComponentDto.java:30-31`); `frontend/src/types/model.ts` —
  `TechType` (260-281), `ApplicationComponent` (301-318). The AppShell
  per-(project,architecture) model cache is the already-loaded source the helper
  reads from.

## Requirements Summary

### Functional Requirements
- Group discovery runs by `service_id`; render ONE scan picker per scanned
  service (0-or-1 run each), with a human service display name (model
  `services[].name`, else the snapshot's `serviceName`, with the
  camelCase/snake_case reconciliation), and an "Unassigned scans" bucket for
  orphan (NULL `service_id`) runs.
- Replace the 2-run `SelectedScanPair` with an N-run `SelectedScanSet` (retaining
  a `primaryRunId` thread key); ≥1 run required overall, 0-or-1 per service.
- Widen the review-model COUNTS API + the gateway review routes to carry the full
  selected run-id set (preserving `primaryRunId`).
- Introduce the pure `deriveServiceTier(service, appComponentsById)` helper (used
  here for optional tier labels on the picker; reused by Half B).

### Reusability Opportunities
- The pure `deriveServiceTier` helper is the single genuine code-sharing point
  with Half B.
- The review-model union (`buildReviewModel(runs[])`) is already N-run-capable —
  reuse unchanged; only the wire shape + counts API + UI change.
- The model is already loaded + cached client-side (AppShell) — no new backend
  fetch endpoint needed.

### Scope Boundaries
**In scope:** per-service scan picker; N-run `SelectedScanSet` wire shape; counts
API + gateway review-route widening to N runs; the service-name display +
`serviceIdentitySnapshot` camelCase/snake_case reconciliation; the pure
`deriveServiceTier` helper.

**Out of scope:** the tier-confirmation turn + question gating (Half B); any new
discovery SCANNING logic; the backbone review-model union (already N-run); a new
AMS list-components endpoint (the full-model GET suffices); the agenda redesign +
reject-cascade specs (already done).

### Technical Considerations
- "tier" overload: V3 confidence tier (A/B/C) vs technology tier — disambiguate.
- The tier chain is two NULLABLE hops; orphan runs (NULL `service_id`) and
  services with NULL `app_component_id` / `tech_type='Other'` need graceful
  "Unknown" handling — never block on an unresolved tier.
- `serviceIdentitySnapshot` is written camelCase but typed snake_case on the
  frontend — a real mismatch this spec reconciles for the display name.
- `primaryRunId` MUST be retained as the thread key to avoid churning the
  run-id-keyed review routes.

## Visual Assets
None provided (`planning/visuals/` empty — pure UI + wire-shape change; none required).
