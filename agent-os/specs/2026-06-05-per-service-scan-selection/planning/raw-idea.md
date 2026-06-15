# Per-Service Scan Selection (Half A — split from the former combined Spec ⑤)

This is **Half A** of the now-SPLIT "multi-service review scope + tier-gating" idea. Per the user's decision (2026-06-05): TWO specs. Half A = per-service scan selection (THIS spec, built FIRST); Half B = architect tier-gating (separate spec `architect-tier-gating`, shaped later). They share ONE pure `deriveServiceTier` helper — NO data handoff between them.

## What Half A does (original triage point 7)
Replace the Discovery Review Room's hardcoded "max 1 code scan + 1 database scan" picker with a PER-SERVICE picker: one selection per scanned service (e.g. "MyApp UI", "MyApp API", "MyApp Sybase Database"); if a service was scanned twice, the user picks which run for that service. A UI+SVC+DB selection (2 code + 1 DB) becomes legitimate. The review-model builder is already N-run capable, so this is a wire-shape + UI change, NOT a backbone rewrite.

## Confirmed decisions (user, 2026-06-05 — LOCKED)
- **Cardinality (Q2):** 0-or-1 run per service (a service can be skipped); ≥1 run selected overall to begin.
- **Display name (Q3):** label each service group with the model's `services[].name`; fall back to the run's `serviceIdentitySnapshot` for orphan (NULL `service_id`) runs, grouped under an "Unassigned scans" bucket. FIX the camelCase/snake_case `serviceIdentitySnapshot` mismatch (written `serviceName`, typed `service_name` on the frontend) — IN SCOPE.
- **Selection shape (Q4):** replace the 2-run `SelectedScanPair` (`primaryRunId`/`primaryScanKind`/`secondRunId`/`secondScanKind`) with an N-run `SelectedScanSet`, KEEPING a `primaryRunId` thread anchor so existing run-id-keyed routes stay stable; widen the review-model counts API to carry the full run-id set.

## The run→service→tier bridge (for the shared helper + picker labels)
Two-hop nullable traversal: `run.service_id` → `ServiceDto.app_component_id` (`ServiceDto.java:29`) → `ApplicationComponentDto.tech_type` (`ApplicationComponentDto.java:30`; UI/Service/Persistence/Other). All available in the model fetch the AppShell already loads + caches (`ModelController.loadModelForArchitecture`) — no new endpoint. A pure `deriveServiceTier(run, model)` helper is introduced HERE (reused by Half B). NOTE: `DiscoveryRunDto.tier` is the V3 CONFIDENCE ladder (A/B/C), UNRELATED to technology tier — disambiguate carefully.

## Code grounding (verify against current source)
- `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` — `selectedCodeRunId`/`selectedDbRunId` state + the two radio fieldsets + help text "Pick up to one code scan and up to one database scan" (the 1-code-1-db constraint to replace).
- `frontend/src/api/discoveryApi.ts` — `DiscoveryRunDto.service_id` / `discovery_kind` / `serviceIdentitySnapshot`.
- `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts` — `SelectedScanPair` (→ `SelectedScanSet`) + where the review conversation is opened with the scan set.
- `discovery-service/src/services/reviewModel/buildReviewModel.ts` — already N-run capable (confirm; no backbone change).
- Model fetch / services + app_components: `ModelController.loadModelForArchitecture`, `ServiceDto.java`, `ApplicationComponentDto.java`.

## Scope
- **Frontend:** the per-service scan picker in `DiscoveryReviewRoom` (group runs by service, one pick per service, "Unassigned scans" for orphans, service-name labels + the snapshot camelCase/snake_case fix).
- **Gateway:** `SelectedScanPair` → `SelectedScanSet` (keep `primaryRunId`); counts / review-model wire widened to N runs.
- **Shared:** a pure `deriveServiceTier(run, model)` helper (used for picker labels here; reused by Half B).
- **OUT of scope:** the tier-confirmation turn + question gating (Half B); any new discovery scanning; the agenda redesign + reject-cascade specs (already done).

The full combined investigation (both halves) lives at `agent-os/specs/2026-06-05-multi-service-review-scope-and-tier-gating/planning/requirements.md` for reference.
