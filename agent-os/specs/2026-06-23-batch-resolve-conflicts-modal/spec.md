# Specification: Batch "Resolve Conflicts" Modal

## Goal
Add ONE top-of-table "Resolve Conflicts (N)" button that opens a single scrollable modal aggregating every unresolved cross-source conflict across all candidates in a discovery run, with source-based "Resolve All" helpers, committing by looping the existing single-conflict resolve endpoint. This is pure-frontend orchestration: no new backend endpoint, no schema change, no Liquibase migration.

## User Stories
- As a reviewer, I want to see and resolve every unresolved cross-source conflict in a run from one modal so that I do not have to open the single-candidate chooser one row at a time.
- As a reviewer who does not know which source to trust, I want one-click "Resolve All" helpers that pre-select by source authority so that I can settle most conflicts quickly and then adjust only the exceptions.
- As a reviewer, I want a partial-failure commit to keep the modal open with only the failed rows still selected so that I can retry just the failures without losing my work.

## Specific Requirements

**Top-of-table "Resolve Conflicts (N)" button**
- Render as the FIRST item in the existing bulk-actions row (`styles.bulkActions`, `DiscoveryCandidateTable.tsx` ~line 1141), before "Approve All".
- Label "Resolve Conflicts (N)"; N = the live whole-run unresolved-conflict count from `unresolvedConflictCount` (~line 745).
- Neutral/secondary style; enabled only when N > 0.
- Opens the new batch modal. Does not affect the per-row "N conflicts" badge or the single-candidate `ConflictResolutionModal`, which stay exactly as-is.

**Conflict aggregation**
- Aggregate every UNRESOLVED conflict across all candidates in the run into a flat list using the existing `getUnresolvedConflicts(candidate)` helper (~line 340) per candidate.
- A conflict is "live" iff `data._conflicts[attr]` is non-empty AND there is no matching `data._conflictResolutions[attr]` (the existing predicate; do not change it).
- One row per conflict = per conflicted attribute on a candidate.
- The competing options data model is `ConflictingValue = { value, source }` ONLY (`candidate.ts` ~line 261); carry no other per-option fields.

**Grouping and sorting**
- Group rows by entity/relationship type, then sort by candidate name within each group.
- Render plain NON-collapsible section headers per type group (the modal scrolls).
- Group-header labels come from the net-new `CandidateType` -> human label map (title-case fallback for unmapped/new tokens).

**Per-conflict row layout**
- Show: entity/relationship TYPE, candidate NAME, conflicting ATTRIBUTE, and each competing option as a selectable control showing option VALUE + SOURCE label.
- Mirror the single-conflict modal's per-attribute chooser shape: one selection per attribute (`ConflictSelections = Record<string, number | undefined>` semantics).
- Render the option value via the existing readable-value approach (strings pass through; objects/arrays JSON-stringified).
- Apply a subtle "★ most authoritative" tag (net-new UI) on the highest-ranked source option in the row.
- NO per-option finding/evidence/vote count anywhere.

**"★ most authoritative" determination**
- Rank each option's source via the discovery-service authority ladder `SOURCE_TIER_RANK` (`candidateIdentity.ts` ~line 205) plus `classifySourceTier` (~line 246): structural-framework-pack > contract-pack > runtime-evidence > llm-gap-fill.
- Mark the single highest-ranked option per row; on a tie within the same tier, mark the FIRST option.

**Resolve-All helper: "Use most authoritative source"**
- For each conflict, PRE-SELECT the option from the highest-authority source present, using `SOURCE_TIER_RANK`.
- Ties within the same tier -> select the FIRST option.
- This helper only pre-selects; the user can still review and change any row.

**Resolve-All helper: "Prefer a source…"**
- A dropdown/select listing ONLY the source labels actually present among the current conflicts.
- On choosing a source, PRE-SELECT that source's value on every conflict where that source is present.
- Conflicts where the preferred source is ABSENT remain UNSELECTED (so the user sees what is left to do).
- Pre-select only; the user can still adjust any row.

**Confirm / commit (best-effort loop)**
- Confirm LOOPS the existing endpoint once per selected (candidate, attribute): `resolveDiscoveryConflict(...)` -> `PATCH .../runs/{runId}/candidates/{candidateId}/resolve-conflict` (`discoveryApi.ts` ~line 1126).
- Each call sends `ResolveDiscoveryConflictBody` (~line 1090) `{ attr, chosen_value, chosen_source, resolved_by, resolved_at }` with `resolved_by = "reviewer (batch)"` (distinct from the single-row "reviewer").
- Best-effort and non-atomic (mirrors the gateway's existing `resolveConflictsByPattern` fan-out). Produce a resolved-vs-failed result summary.
- Follow `handleResolveConflicts` (~line 980) for the per-attribute server write + local candidate-state update (canonical slot set, `_conflictResolutions` stamped, `_conflicts[attr]` cleared) so resolved rows do not reappear on re-read.

**Result handling and retry**
- Show an inline result banner pinned at the TOP of the modal (e.g. "47 resolved, 1 failed — retry the failures").
- On ALL success: show the success summary briefly, then auto-close the modal.
- On PARTIAL failure: modal STAYS OPEN; failed rows remain selected; Confirm relabels to "Retry failed (N)" and re-fires ONLY the failures.
- Empty / all-resolved state: copy "No unresolved conflicts." with only a Close button (race-condition guard, since the top button is count-gated).

## Visual Design
No visual assets provided (`planning/visuals/` is empty). The visual baseline is the existing single-candidate `frontend/src/components/Discovery/ConflictResolutionModal.tsx` (overlay + header/content/footer layout, per-attribute option buttons showing value + source, escape/overlay dismiss, `isOpen` guard) and the list-with-context layout of `frontend/src/components/Discovery/BulkCandidateActionConfirmModal.tsx` (grouped, deselectable list rows with provenance under a shared modal shell). The new batch modal should read as a scrollable, type-grouped superset of the single-conflict chooser.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`**
- `getUnresolvedConflicts(candidate)` (~line 340) — per-candidate live-conflict derivation; call across all candidates to build the flat list.
- `unresolvedConflictCount` (~line 745) — source for the live whole-run N in the button label and gating.
- `handleResolveConflicts` (~line 980) — pattern for the per-attribute server write + local state update; the batch path replicates this in a loop with `resolved_by = "reviewer (batch)"`.
- `styles.bulkActions` (~line 1141) — host for the new button (first item, before "Approve All"); per-row badge (~line 1477) and single-modal render (~line 1590) stay unchanged.

**`frontend/src/components/Discovery/ConflictResolutionModal.tsx`**
- `ConflictOption { value, source }`, `ConflictEntry { attr, options }`, `ConflictSelections = Record<string, number | undefined>`, the `renderValue` helper, and the per-attribute option-button rendering (value + source) — mirror/extend for the batch rows.

**`frontend/src/api/discoveryApi.ts`**
- `resolveDiscoveryConflict(...)` (~line 1126) and `ResolveDiscoveryConflictBody` (~line 1090) — the exact endpoint and body the commit loop reuses unchanged.

**`discovery-service/src/services/candidateIdentity.ts` and `src/types/candidate.ts`**
- `SOURCE_TIER_RANK` (~line 205) + `classifySourceTier` (~line 246) — drive the "★ most authoritative" marker and the "Use most authoritative source" helper.
- `ConflictingValue` (~line 261) = `{ value, source }` and the `CandidateType` union (~line 77) — the conflict option shape and the source for the net-new label map.

**`frontend/src/components/Discovery/BulkCandidateActionConfirmModal.tsx`**
- UX precedent for a grouped list-with-context modal under the shared modal shell (header/content/footer, escape + overlay dismiss).

## Out of Scope
- Any change to the merge/dedup engine or the conflict data model (`candidateMerge.ts`, `_conflicts` / `_conflictResolutions` shapes).
- A new atomic bulk-resolve backend endpoint — the per-(candidate, attribute) loop over the existing endpoint is intentional.
- Any schema change or Liquibase migration.
- Per-option finding / vote / evidence counts (that data does not exist).
- Any change to the existing per-row "N conflicts" badge or the single-candidate `ConflictResolutionModal`.
- Any change to the conversational discovery-review room.
- Permissions / multi-role handling.
- Collapsible type-group headers (plain non-collapsible headers for v1).
