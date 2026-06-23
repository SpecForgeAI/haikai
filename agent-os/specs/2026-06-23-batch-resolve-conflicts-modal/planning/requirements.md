# Spec Requirements: Batch "Resolve Conflicts" Modal

## Overview / Problem

Resolving cross-source merge conflicts on the current-state discovery candidates table is currently a one-at-a-time chore. Each conflicted row shows a "N conflicts" badge; clicking it opens `ConflictResolutionModal` for that single candidate; the user picks a value per attribute and confirms. With many conflicted candidates this is a slog, and the user often does not know which source to trust.

A "conflict" arises during merge/dedup when the same candidate attribute carries different values from different sources. It is "live" (unresolved) iff `data._conflicts[attr]` is non-empty AND there is no matching `data._conflictResolutions[attr]`. The merge engine deliberately NEVER auto-resolves value conflicts by source precedence (`candidateMerge.ts`), which is exactly why the user must opt in to resolving them here.

## Goal

ONE top-of-table "Resolve Conflicts (N)" button that opens a single scrollable modal aggregating EVERY unresolved cross-source conflict across all candidates in the run. The user reviews and resolves them all in one place, with source-based "Resolve All" helpers, then confirms. The commit loops the existing single-conflict resolve endpoint once per (candidate, attribute).

This is PURE FRONTEND orchestration: no new backend endpoint, no schema change, no Liquibase migration. The existing per-row "N conflicts" badge and its single-candidate `ConflictResolutionModal` stay exactly as they are.

## User Flow

1. The candidate table shows a top-of-table "Resolve Conflicts (N)" button in the existing bulk-actions row. N = the live whole-run unresolved-conflict count. The button is enabled only when N > 0.
2. The user clicks it. A scrollable modal opens listing ONE ROW PER CONFLICT (per conflicted attribute on a candidate), grouped by entity/relationship type then sorted by name.
3. Optionally the user uses a "Resolve All" helper:
   - "Use most authoritative source" — pre-selects, in each row, the option from the highest-authority source present.
   - "Prefer a source…" — the user picks a source from a dropdown (listing only sources present among the current conflicts); pre-selects that source's value on every row where that source is present.
   Both helpers ONLY pre-select. The user can still review and change any individual row.
4. The user reviews/adjusts individual rows. Each row has a subtle "★ most authoritative" tag on its highest-ranked source option.
5. The user clicks Confirm. The frontend loops `PATCH .../resolve-conflict` once per selected (candidate, attribute), best-effort.
6. Result:
   - All success → an inline success summary shows briefly, then the modal auto-closes.
   - Partial failure → an inline banner pinned at the top of the modal reports the outcome (e.g. "47 resolved, 1 failed — retry the failures"). The modal STAYS OPEN. Failed rows remain selected and the Confirm button relabels to "Retry failed (N)" so the user re-fires just the failures.

## Functional Requirements

### Aggregation & Display
- Aggregate every UNRESOLVED conflict across all candidates in the run into a flat list, then group + sort: grouped by entity/relationship type, sorted by name within each group.
- One row per conflict = per conflicted attribute on a candidate.
- Each row shows: entity/relationship TYPE + candidate NAME + conflicting ATTRIBUTE + each competing option as a selectable control showing the option VALUE + its SOURCE label. One selection per attribute (mirrors the existing single-conflict modal row).
- NO per-option finding/evidence/vote count anywhere. The data model is `ConflictingValue = { value, source }` only; that count does not exist.
- A subtle "★ most authoritative" tag marks the highest-ranked source option in each row (NET-NEW UI; the existing single-conflict modal has none).
- Group-header labels use a human-friendly label map (e.g. "Logical Data Entity Relationships" not `logical_data_entity_relationships`).

### Resolve-All Helpers (both inside the modal, both pre-select only)
- "Use most authoritative source": for each conflict, pre-select the option from the highest-authority source present, using the fixed precedence ladder `SOURCE_TIER_RANK`: structural-framework-pack (best) > contract-pack > runtime-evidence > llm-gap-fill (worst).
- "Prefer a source…": the user picks a provenance from a dropdown listing ONLY sources present among the current conflicts; pre-select that source's value on every conflict where it is present.
- Tie-break rules (both helpers): ties within the same authority tier → select the FIRST option. Conflicts where the chosen/preferred source is absent remain UNSELECTED so the user sees what is left to do.

### Confirm / Commit
- Confirm commits the current selections by LOOPING the existing endpoint `PATCH .../runs/{runId}/candidates/{candidateId}/resolve-conflict` once per selected (candidate, attribute). The loop is intentional (mirrors the gateway's existing `resolveConflictsByPattern` fan-out).
- Best-effort, non-atomic. Produce a result summary of resolved vs failed counts.
- Batch resolutions stamp `resolved_by = "reviewer (batch)"` (distinct from the single-row "reviewer") into `_conflictResolutions`.
- On partial failure the modal stays open, failed rows stay selected, Confirm relabels to "Retry failed (N)", and Retry re-fires only the failures.
- On all success the success summary shows briefly, then the modal auto-closes.

## UI / UX Details (Resolved)

- Top button label: "Resolve Conflicts (N)" where N is the live whole-run unresolved-conflict count. Placed as the FIRST item in the existing bulk-actions row, before "Approve All". Neutral/secondary style. Enabled only when N > 0.
- Resolve-All action labels inside the modal: "Use most authoritative source" and "Prefer a source…".
- Prefer-source picker: a dropdown/select listing only the sources actually present among the current conflicts.
- Result summary: an inline banner pinned at the top of the modal. Modal stays open on partial failure.
- Type grouping: plain NON-collapsible section headers for v1 (the modal already scrolls).
- Empty / all-resolved state: copy "No unresolved conflicts." with only a Close button (mostly a race-condition guard, since the top button is count-gated).
- Group-header labels: human-friendly via a NET-NEW label map (see Net-New Artifacts below).
- "Most authoritative" marker: a subtle "★ most authoritative" tag on the highest-ranked source option in each row (NET-NEW UI).

## Net-New Artifacts

- **CandidateType → human label map**: NET-NEW, covering the ~20 members of the `CandidateType` union (discovery-service `src/types/candidate.ts`, ~line 77, which mixes entity AND relationship types). The map MUST cover every `CandidateType` value and provide a sensible fallback (title-case the raw token) for any unmapped/new type.
- **"★ most authoritative" tag**: NET-NEW row UI on the highest-ranked source option.

## Backend / Integration

- No new backend endpoint. No schema change. No Liquibase migration.
- Reuses the existing, UNCHANGED resolve path: AMS `DiscoveryCandidateService.resolveConflict` + `DiscoveryCandidateController` `PATCH .../resolve-conflict`; gateway passthrough.
- The non-atomic fan-out has a precedent: the gateway's existing `resolveConflictsByPattern` in `reviewDecisionOrchestrator.ts`. The best-effort-partial result-summary pattern follows the baseline-save-review batch behavior.

## Reuse Targets (grounded by investigation)

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`** — renders the candidate grid.
- `getUnresolvedConflicts(candidate)` helper (~line 340)
- `handleResolveConflicts` (~line 980) — already loops `resolveDiscoveryConflict` once per resolved attribute
- `unresolvedConflictCount` (~line 745) — source for the live whole-run N
- bulk-actions row `styles.bulkActions` (~line 1141) — where the top button belongs (first item, before "Approve All")
- per-row conflict badge (~line 1477) — STAYS as-is; opens the single modal via `conflictModalCandidateId` state
- single-candidate modal render (~line 1590) — STAYS as-is

**`frontend/src/components/Discovery/ConflictResolutionModal.tsx`** — single-conflict modal to mirror/extend.
- `ConflictOption { value, source }`, `ConflictEntry { attr, options }`, `ConflictSelections = Record<string, number | undefined>`; renders per-attribute option buttons (value + source).

**`frontend/src/api/discoveryApi.ts`** — API client.
- `resolveDiscoveryConflict(...)` (~line 1126) → `PATCH .../resolve-conflict`
- `ResolveDiscoveryConflictBody` (~line 1090) — `{ attr, chosen_value, chosen_source, resolved_by?, resolved_at? }`

**`discovery-service/src/.../candidateIdentity.ts`** — source authority ladder.
- `SOURCE_TIER_RANK` (~line 205) + `classifySourceTier` (~line 246)

**`discovery-service/src/types/candidate.ts`** — conflict data model.
- `ConflictingValue` (~line 261) = `{ value, source }`; persisted `data._conflicts` / `data._conflictResolutions`
- `CandidateType` union (~line 77) — drives the net-new label map

**`frontend/src/components/Discovery/BulkCandidateActionConfirmModal.tsx`** — UX precedent (list-with-context layout).

Conflict semantics: a conflict is "live" iff `_conflicts[attr]` is non-empty AND there is no `_conflictResolutions[attr]`. The merge engine (`candidateMerge.ts`) emits one `ConflictingValue` per distinct value, first-source-wins, and deliberately never auto-resolves value conflicts by precedence.

## Resolved Decisions (record of the 11)

1. Top button = "Resolve Conflicts (N)" (N = live whole-run `unresolvedConflictCount`, ~line 745); first item in `styles.bulkActions` (~line 1141), before "Approve All"; neutral/secondary style; enabled only when N > 0.
2. Resolve-All action labels: "Use most authoritative source" and "Prefer a source…".
3. Prefer-source picker = a dropdown/select listing ONLY sources present among the current conflicts.
4. Result summary = an inline banner pinned at the top of the modal; modal STAYS OPEN on partial failure.
5. On all-success: show the success summary briefly, then auto-close the modal.
6. Type grouping = plain NON-collapsible section headers for v1.
7. Empty / all-resolved state: copy "No unresolved conflicts." with only a Close button (race-condition guard).
8. Group-header labels = human-friendly via a NET-NEW label map covering every `CandidateType` (~line 77) member with a title-case fallback for unmapped/new types.
9. "Most authoritative" marker = a subtle "★ most authoritative" tag on the highest-ranked source option in each row (NET-NEW UI).
10. Retry on failure: failed rows stay selected; Confirm relabels to "Retry failed (N)" to re-fire only the failures.
11. Provenance label: batch resolutions stamp `resolved_by = "reviewer (batch)"` (distinct from single-row "reviewer") into `_conflictResolutions`.

## Non-Goals

- No change to the merge/dedup engine or the conflict data model.
- No per-option finding/vote/evidence count (that data does not exist — explicitly dropped).
- No new atomic bulk-resolve backend endpoint (the loop is intentional).
- No change to the conversational review room.
- No schema / Liquibase change.
- No permissions / multi-role handling.

## Visual Assets

No visual assets provided. The `planning/visuals/` folder is empty.
