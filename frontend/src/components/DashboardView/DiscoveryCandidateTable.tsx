/**
 * DiscoveryCandidateTable Component
 *
 * Spec 2026-04-05: Discovery Results Visibility -- Task Group 5 (Task 5.3)
 * Extended: Candidate Review and Approval Workflow (Increment 13) -- Task Group 5
 * Extended: Discovery Refinement UX Polish (Increment 16) -- Task Group 7
 * Extended: V3 Tier UX (Spec 2026-04-20) -- Task Group 6
 *   - Confidence slider filter (range 0-1, step 0.05, default 0.7).
 *     Candidates with null/undefined confidence are ALWAYS visible.
 *   - Tier badge per row, derived from candidate.data._addedBy.
 * Extended: Candidate Details Expansion UI (Spec 2026-05-10) -- Task Group 4
 *   - Per-row "Show Details" / "Close Details" toggle button at the front of
 *     the actions cell. Disabled (with `actionButtonDisabled` class and a
 *     tooltip) for candidate types not in the supported allowlist.
 *   - Single-row expansion guarantee: at most one expanded details row at a
 *     time. Expansion renders as a SECOND `<tr>` immediately after the
 *     candidate row, containing a single `<td colSpan={N}>` wrapping
 *     `CandidateDetailsPanel`. If a filter, sort, or paging change removes
 *     the expanded candidate from the rendered list, the expansion row
 *     disappears naturally with no extra clearing logic.
 * Extended: Log Evidence in Candidate Details UI (Spec 2026-05-11) -- Task Group 4
 *   - Single `useMemo` builds the precomputed `RuntimeEvidenceContext`
 *     once per candidate-list reference change via
 *     `buildRuntimeEvidenceContext(filteredCandidates)`. The context is
 *     threaded into `<CandidateDetailsPanel>` via the new optional
 *     `runtimeEvidenceContext` prop. Per-row render reads from the
 *     precomputed context — NEVER aggregates per row. Cross-candidate
 *     rollups for `interfaces` / `logical_data_entities` /
 *     `interface_logical_entities` are computed inside the context
 *     builder; per-`endpoints`-candidate evidence is read from the
 *     candidate's own `logEnrichment.runtime` block by the dispatcher.
 * Extended: Confidence, Tier, and Runtime Badges (Spec 7, 2026-05-11) -- Task Group 4
 *   - Confidence `<td>` now reads `getDisplayConfidence(candidate, ctx)`
 *     instead of the raw `candidate.confidence`. The cell renders the
 *     existing `Math.round(value * 100)%` text (or `"—"` for null) and,
 *     when `uplift > 0`, appends a small adjacent
 *     `<span data-testid="candidate-confidence-uplift"> +{N}</span>` that
 *     CSS sizes down. The persisted `candidate.confidence` is NEVER
 *     mutated -- the uplift is a display-only computation derived from
 *     the same Spec 6 `runtimeEvidenceContext` memo (no second pass).
 *
 * Hotfix (2026-05-11) -- Bugs 3/4/5 (combined):
 *   - Bug 5: the Tier `<td>` no longer renders a sibling `<RuntimeBadge>`.
 *     Instead, the existing `<TierBadge>` receives an explicit `label`
 *     prop that appends `" + logs"` when the candidate has associated
 *     log evidence (via `hasAssociatedLogEvidence`). The discrete labels
 *     are e.g. `adapter`, `adapter + logs`, `gap-fill`, `gap-fill + logs`,
 *     `ir-guided`, `ir-guided + logs`, `llm-solo`, `llm-solo + logs`,
 *     and `—` when `_addedBy` is missing. The label is computed by
 *     `getDisplayTierLabel(candidate, runtimeEvidenceContext)` and
 *     reused in both the row render AND the new Tier filter dropdown's
 *     unique-values memo so they STAY IN SYNC.
 *   - Bug 4: Tier column is now filterable. `ColumnFilters` gains a
 *     `tier` field; the Tier header cell renders a `<select>` populated
 *     with the discrete display labels. Filter logic mirrors the existing
 *     Type filter pattern (`(value || '<unknown>') !== columnFilters.tier`).
 *   - Bug 3: When `candidate.review_status === 'committed'`, the
 *     Approve / Reject / Defer buttons are disabled with the tooltip
 *     "Already saved to canonical model". Show Details remains enabled.
 *     The disable mechanism extends the existing per-status branch
 *     (e.g. `reviewStatus === 'approved'`). The parent also passes a
 *     `lastSaveTimestamp` prop -- a monotonic counter set after each
 *     successful save-approved -- which a `useEffect` watches to clear
 *     the review-status filter so newly-committed rows stay visible.
 *
 * Extended: Model-Aware Discovery (Spec 2026-05-30) -- Task Group 5
 *   - Per-row OPERATION badge + resolved target name, interleaved in the
 *     EXISTING Candidates stream (NO separate section). Rendered in the Name
 *     cell alongside the existing `DiscoveryMethodChip`, reusing the existing
 *     `TierBadge` pill for the colour treatment:
 *       - `enrich` -> "Enrich existing <target>" (warning/amber)
 *       - `link`   -> "Link <logical>↔<physical>" (caution/orange)
 *       - `create` -> "Create new" (neutral/grey, the default)
 *     The operation + resolved target NAME(s) are read DEFENSIVELY from the
 *     candidate `data` payload via `candidateOperationSupport` (mirrors the
 *     save-back reader key order). An absent `operation` is treated as
 *     `create`.
 *
 * Extended: Unique, Aggregate Discovery Candidates (Spec 0, 2026-06-02) -- Task Group 7
 *   - The cross-source MERGE engine records true value conflicts on candidate
 *     `data` (JSONB passthrough): `data._conflicts[attr]` = `{ value, source }[]`
 *     of competing PRESENT values, with `data._conflictResolutions[attr]`
 *     written once a reviewer resolves one. An UNRESOLVED conflict (a
 *     `_conflicts` entry with no matching `_conflictResolutions` entry) is a
 *     live conflict.
 *   - A per-row conflict badge renders alongside the Review Status cell when a
 *     candidate has any live conflict; clicking it opens the
 *     `ConflictResolutionModal` (sibling of `BulkFindingActionConfirmModal`)
 *     which shows each conflicted attribute's competing values side-by-side
 *     WITH their source and offers a single chooser. Confirming writes
 *     `_conflictResolutions[attr]` + the canonical attribute slot and clears
 *     that `_conflicts` entry -- entirely client-side, via `onCandidatesChange`
 *     (the same optimistic-state channel as review actions); no review API call
 *     fires on resolve.
 *   - Clean-approve is GATED: the per-row Approve button (and the bulk Approve
 *     buttons) are disabled with a tooltip while any candidate in scope has a
 *     live conflict, mirroring the committed-row disable pattern.
 *   - `getAddedBy` now tolerates `data._addedBy` as a `string[]` (the merge's
 *     contributing-source set) as well as the legacy single string -- the
 *     merged-candidate Tier badge would otherwise silently go neutral.
 *   - SINGLE-conflict resolution only; bulk-resolve-by-pattern UX is OUT
 *     (deferred to Spec 3).
 *
 * Extended: Deterministic Review Model + Cascade/Dependency Graph + Aggregation
 *   Backbone (Spec 1, 2026-06-02) -- Task Group 6 (grid re-point, single-run)
 *   - The grid's existing aggregation/count `useMemo`s are RE-POINTED onto the
 *     deterministic review-model backbone (discovery-service computes it live on
 *     read; the gateway proxies it; `getReviewModel` fetches it). On mount the
 *     grid fetches the SINGLE-run model for its one `runId` (the backbone API can
 *     span two runs, but the grid never passes a second). The re-pointed numbers:
 *       - `committedCount` / `actionableCount`  <- `aggregations.committed_count`
 *         / `actionable_count` (whole-run scalars).
 *       - `unresolvedConflictCount`             <- `aggregations.live_conflict_count`.
 *       - `filteredActionableCount` / `filteredUnresolvedConflictCount` are still
 *         derived from the currently-FILTERED row subset, but JOIN each displayed
 *         row to its backbone node by id and read the node's `committed` /
 *         `conflict_state.has_live_conflict` so filtered + unfiltered agree
 *         EXACTLY (the backbone's `has_live_conflict` is the SAME predicate as
 *         the grid's `getUnresolvedConflicts`).
 *     Display semantics are IDENTICAL to before: the count VALUES + the
 *     Approve/Reject disable + "Remaining" relabel + conflict-gate tooltip are
 *     byte-for-byte equivalent, because the backbone node fields are computed from
 *     the same source state (`status === 'committed'`; the live-conflict
 *     predicate). The backbone is a SECOND async fetch (alongside the candidate
 *     load); until it resolves -- and if it fails -- the grid FALLS BACK to the
 *     identical local derivation (`nodeIsCommitted` / `nodeHasLiveConflict`), so
 *     counts never flicker wrong.
 *   - The tier rollup (`uniqueTierLabels`) + `getDisplayTierLabel` /
 *     `getBaseTierLabel` / `getAddedBy` are deliberately NOT sourced from the
 *     backbone's `aggregations.source_tier_labels`: that field is the `SourceTier`
 *     PRECEDENCE vocabulary (`structural-framework-pack`, …), a DIFFERENT thing
 *     from the grid's DISPLAY labels (`adapter`, `adapter + logs`, …), which fold
 *     in a log-evidence ` + logs` suffix the backbone omits. Re-pointing the
 *     dropdown onto the backbone would CHANGE the displayed labels, violating the
 *     byte-for-byte-identical requirement. `getAddedBy` already reads the same
 *     `data._addedBy` provenance the backbone reads into `provenance.added_by`, so
 *     the tier display stays provenance-aligned while preserving the grid's
 *     display vocabulary.
 *
 * Extended: Cascade-aware Bulk Review + Reject Suppression (Spec 2, 2026-06-02)
 *   -- Task Group 5 (grid bulk toolbar + cascade confirm modal + bulk Save)
 *   - The bulk Approve / Reject (+ a new Defer) toolbar buttons now open the
 *     `BulkCandidateActionConfirmModal` PRE-SELECTING the FULL Spec 1 blast-radius
 *     for the seeded candidates (the current `'all' | 'filtered'` scope's
 *     actionable rows). The preview renders over `reviewModel.blast_radius` +
 *     `findings` + `aggregations` ALREADY fetched on mount -- NO new fetch. The
 *     seed set is resolved into the full touched set (seed + cascaded dependents +
 *     linked findings, with edge provenance) by the FRONTEND MIRROR of the gateway
 *     `resolveBulkActionSet` (contract-guarded parity, NOT a code import).
 *   - On confirm, the grid calls the ATOMIC cascade endpoint via `bulkReviewCascade`
 *     with the CURATED `candidate_ids` + `finding_ids` (REPLACING the best-effort
 *     per-row `bulkReviewCandidates` fan-out for the cascade-apply path) and
 *     optimistically updates candidate state via `onCandidatesChange`, leaving
 *     `committed` rows untouched (mirrors the old `handleBulkReview` optimistic
 *     pass). Curation lives in the modal ONLY -- the grid keeps its
 *     `'all' | 'filtered'` scope; NO per-row checkboxes.
 *   - A bulk Save action is surfaced in the toolbar (when the parent supplies
 *     `onBulkSave`) reusing the EXISTING `save-approved` path verbatim (the page's
 *     `handleSaveApprovedClick` -> `SaveBackConfirmModal` ->
 *     `handleSaveApprovedConfirmed`, which commits `review_status === 'approved'`
 *     and fires the SAME post-save AppShell cache refresh). Save commits the WHOLE
 *     approved set for the run -- it is SEPARATE from the review-action endpoint.
 *
 * Renders an HTML table of discovery candidates for a given run with:
 * - Count summary line above the table showing breakdown by status
 * - Filter bar with chips: All, Pending, Approved, Rejected, Deferred (with count badges)
 * - Filter-aware empty state messages when a filter yields zero results
 * - Columns: Name, Tier, Type, Confidence, Review Status, Synthesized At, Actions
 * - Inline Approve/Reject/Defer action buttons per row with optimistic updates
 * - Row tinting based on review_status (green=approved, red=rejected, grey=deferred)
 * - Visible loading indicator (spinner text) on rows being acted upon
 * - Parent-child indentation for candidates with parent_candidate_id
 *
 * Candidate state is managed by the parent (DiscoveryRunDetailView) and passed
 * via props to enable the "Save All Approved" button to check for approved candidates
 * and re-fetch after save.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  reviewCandidate,
  bulkReviewCascade,
  getReviewModel,
  resolveDiscoveryConflict,
} from '../../api/discoveryApi';
import type {
  DiscoveryCandidateDto,
  ReviewModel,
  ReviewModelNode,
} from '../../api/discoveryApi';
import { TierBadge } from './TierBadge';
import { DiscoveryMethodChip } from './DiscoveryMethodChip';
import { supportsDetails } from './candidateDetailsSupport';
import { CandidateDetailsPanel } from './CandidateDetailsPanel';
import { buildRuntimeEvidenceContext } from './runtimeEvidenceContextBuilder';
import { hasAssociatedLogEvidence } from './runtimeBadgeHelpers';
import { getDisplayConfidence } from './displayConfidence';
import {
  readCandidateOperation,
  getOperationBadgeLabel,
} from './candidateOperationSupport';
import type { RuntimeEvidenceContext } from './candidateEvidenceTypes';
import {
  ConflictResolutionModal,
  type ConflictEntry,
  type ConflictSelections,
} from '../Discovery/ConflictResolutionModal';
import {
  BulkCandidateActionConfirmModal,
  type BulkCandidateActionConfirmPayload,
} from '../Discovery/BulkCandidateActionConfirmModal';
import {
  resolveBulkActionSet,
  type BulkReviewAction,
  type ResolvedBulkActionSet,
} from '../Discovery/resolveBulkActionSet';
import {
  BatchResolveConflictsModal,
  type BatchRowSelections,
  type BatchResolveResult,
} from '../Discovery/BatchResolveConflictsModal';
import {
  batchResolveCommit,
  selectionsToCommitUnits,
} from '../Discovery/batchResolveCommit';
import type { ConflictRow } from '../Discovery/batchResolveConflictsSupport';
import styles from './DiscoveryRunDetailView.module.css';

export interface DiscoveryCandidateTableProps {
  projectId: string;
  /**
   * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7
   * The architecture this run is bound to. Threaded into every reviewCandidate
   * and bulkReviewCascade call so the URL embeds the correct architectureId.
   * Parents pass the run's stored architectureId (NOT useActiveArchitectureId())
   * because the run is bound to its picked architecture for life.
   */
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
  /**
   * Hotfix (Bug 3) -- a monotonic counter bumped by the parent after every
   * successful save-approved. When this value changes (excluding the initial
   * undefined -> first-render transition), the table clears its review-status
   * filter so newly-committed rows remain visible to the user. Optional so
   * legacy callers that don't drive save-approved don't need to thread it.
   */
  lastSaveTimestamp?: number;
  /**
   * Foundations receipts (2026-08-22): lowercase table name -> the scope a
   * stored foundation decision applied ('excluded' | 'volatile') + its
   * decision ref. Entity rows AND their attribute rows render the chip —
   * the "obvious at every following stage" contract. Rows still review and
   * save normally; save-back commits excluded entities as
   * `committed_excluded` (current-state documentation, out of the target).
   */
  scopeByEntityName?: Map<string, { scope: string; decisionRef: string | null }>;
  /**
   * Spec 2 (2026-06-02) Task Group 5.5 -- bulk Save. Optional click handler the
   * grid's toolbar Save button invokes. The parent (the run-detail page) wires
   * this to its EXISTING `save-approved` flow (the `SaveBackConfirmModal` ->
   * `handleSaveApprovedConfirmed` path, which commits `review_status==='approved'`
   * and fires the post-save AppShell cache refresh -- `LOAD_MODEL` same-arch /
   * `invalidateArchitectureModelCache` cross-arch). When omitted, the grid renders
   * NO Save button (back-compat for callers that surface Save elsewhere). Save is
   * SEPARATE from the cascade review-action endpoint.
   */
  onBulkSave?: () => void;
  /** True while the parent's save-approved call is in flight (disables Save + spinner text). */
  bulkSaveInFlight?: boolean;
  /** Dynamic Save button label from the parent (e.g. "Save All Approved" / "Save Remaining Approved"). */
  bulkSaveLabel?: string;
  /** True when there is at least one `review_status==='approved'` row to save (gates the Save button). */
  hasApprovedToSave?: boolean;
}

/** Column filter state for Excel-like header filters */
interface ColumnFilters {
  name: string;
  /** Hotfix Bug 4 -- discrete display-tier label (e.g. "adapter + logs"). */
  tier: string;
  type: string;
  reviewStatus: string;
}

/** Default confidence threshold for the slider (V3 Tier UX) */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Visible column count for the candidate table. Used by the expansion `<tr>`
 * for its single `<td colSpan={...}>`. Sourced from the header definition
 * (Name, Tier, Type, Confidence, Review Status, Synthesized At, Actions).
 * Kept as a named constant so adding/removing a column requires a single
 * point of update.
 */
const CANDIDATE_TABLE_COLUMN_COUNT = 7;

/**
 * Extract the `_addedBy` tag from a candidate's `data` blob.
 *
 * Spec 0 (2026-06-02) upgraded `data._addedBy` to a `string[]` (the merge's
 * SET of contributing source labels). This reader tolerates BOTH shapes:
 *   - `string[]`  -> the FIRST non-empty entry drives the badge colour/label
 *                    (the surviving candidate's highest-precedence source is
 *                    placed first by the merge; the badge shows one tier).
 *   - `string`    -> the legacy single-source form, returned as-is.
 * Returns null when absent / empty so the TierBadge renders neutral/grey.
 *
 * NOTE: returning the first array element (rather than `null` on an array)
 * is the fix for the spec-flagged regression where every merged candidate's
 * Tier badge would otherwise silently collapse to neutral.
 *
 * Spec 1 (2026-06-02) note: this reads the SAME `data._addedBy` provenance the
 * deterministic backbone reads into a node's `provenance.added_by`, so the tier
 * DISPLAY stays provenance-aligned with the backbone. The backbone's
 * `source_tier` is a precedence bucket (a different vocabulary) and is NOT used
 * for the display label -- see the file header.
 */
function getAddedBy(candidate: DiscoveryCandidateDto): string | null {
  const data = candidate.data as Record<string, unknown> | null | undefined;
  const tag = data?._addedBy;
  if (typeof tag === 'string') return tag;
  if (Array.isArray(tag)) {
    const first = tag.find((t) => typeof t === 'string' && t.length > 0);
    return typeof first === 'string' ? first : null;
  }
  return null;
}

/**
 * Spec 0 (2026-06-02) Task Group 7 -- one competing value for a conflicted
 * attribute, mirroring `data._conflicts[attr][]`.
 */
interface RawConflictOption {
  value: unknown;
  source: string;
}

/**
 * Read the candidate's UNRESOLVED conflicted attributes.
 *
 * A conflict is "live" when `data._conflicts[attr]` exists AND there is no
 * matching `data._conflictResolutions[attr]` (the reviewer hasn't picked a
 * value yet). Resolved attributes are filtered out so a settled candidate
 * shows no badge and is clean-approvable.
 *
 * Returns one `ConflictEntry` per live conflicted attribute (attr +
 * competing options); an empty array means no live conflicts. Defensive
 * against malformed shapes (non-object `_conflicts`, non-array option lists).
 *
 * Spec 1 (2026-06-02) note: the deterministic backbone's per-node
 * `conflict_state.has_live_conflict` is computed from this EXACT predicate, so
 * the backbone-sourced conflict counts and this local derivation agree. This
 * function remains the row-level source of truth (it also drives the per-row
 * badge + the modal entries, which Spec 1 leaves untouched) AND the fallback
 * when the backbone hasn't loaded / failed.
 */
function getUnresolvedConflicts(
  candidate: DiscoveryCandidateDto,
): ConflictEntry[] {
  const data = candidate.data as Record<string, unknown> | null | undefined;
  const rawConflicts = data?._conflicts;
  if (
    !rawConflicts ||
    typeof rawConflicts !== 'object' ||
    Array.isArray(rawConflicts)
  ) {
    return [];
  }
  const resolutions =
    data?._conflictResolutions &&
    typeof data._conflictResolutions === 'object' &&
    !Array.isArray(data._conflictResolutions)
      ? (data._conflictResolutions as Record<string, unknown>)
      : {};

  const entries: ConflictEntry[] = [];
  for (const [attr, optionsRaw] of Object.entries(
    rawConflicts as Record<string, unknown>,
  )) {
    // Already resolved -> not a live conflict.
    if (resolutions[attr] !== undefined) continue;
    if (!Array.isArray(optionsRaw)) continue;
    const options = (optionsRaw as RawConflictOption[])
      .filter(
        (o): o is RawConflictOption =>
          o !== null && typeof o === 'object' && 'value' in o,
      )
      .map((o) => ({
        value: o.value,
        source: typeof o.source === 'string' ? o.source : '(unknown source)',
      }));
    if (options.length === 0) continue;
    entries.push({ attr, options });
  }
  return entries;
}

/** True when the candidate has at least one live (unresolved) conflict. */
function hasUnresolvedConflicts(candidate: DiscoveryCandidateDto): boolean {
  return getUnresolvedConflicts(candidate).length > 0;
}

/**
 * Model-Aware Discovery (Spec 2026-05-30) -- map the candidate operation to a
 * `TierBadge` variant so the operation pill reuses the existing badge palette
 * (no new colour tokens):
 *   - enrich -> 'B' (warning / amber)   -- adds to ONE existing entity
 *   - link   -> 'C' (caution maps via tier? no) ; use addedBy caution token
 *   - create -> neutral (grey)          -- the default, brand-new entity
 *
 * Implemented by passing a synthetic `addedBy` token to `TierBadge`
 * (`addedByToVariant`): `'*-adapter'` -> success, `'llm-gap-fill'` -> warning,
 * `'llm-ir-guided'` -> caution, else neutral. We reuse those existing tokens
 * here purely for their colour mapping; the visible text is always the
 * explicit operation `label`.
 */
function operationToAddedByToken(
  operation: 'create' | 'enrich' | 'link'
): string | null {
  switch (operation) {
    case 'enrich':
      return 'llm-gap-fill'; // warning / amber
    case 'link':
      return 'llm-ir-guided'; // caution / orange
    case 'create':
    default:
      return null; // neutral / grey
  }
}

/**
 * Compute the base (no-logs) discrete tier label for a candidate from its
 * `_addedBy` tag. Mirrors `TierBadge`'s internal `defaultLabel` mapping so
 * the filter dropdown values match the badge's displayed text exactly.
 *
 * - `<framework>-adapter` -> `adapter`
 * - `llm-gap-fill`        -> `gap-fill`
 * - `llm-ir-guided`       -> `ir-guided`
 * - `llm-solo`            -> `llm-solo`
 * - null / unknown        -> `—`
 */
function getBaseTierLabel(addedBy: string | null): string {
  if (!addedBy) return '—';
  if (addedBy.endsWith('-adapter')) return 'adapter';
  if (addedBy === 'llm-gap-fill') return 'gap-fill';
  if (addedBy === 'llm-ir-guided') return 'ir-guided';
  if (addedBy === 'llm-solo') return 'llm-solo';
  return addedBy;
}

/**
 * Hotfix Bug 5 -- combined display-tier label.
 *
 * Returns the discrete text that appears on the TierBadge AND in the Tier
 * filter dropdown. When the candidate has associated runtime log evidence
 * (per Spec 6's `hasAssociatedLogEvidence`), a ` + logs` suffix is appended.
 *
 * Examples (on a typical PetClinic run):
 *   - `adapter`, `adapter + logs`
 *   - `gap-fill`, `gap-fill + logs`
 *   - `ir-guided`, `ir-guided + logs`
 *   - `llm-solo`, `llm-solo + logs`
 *   - `—` (missing `_addedBy`)
 *
 * Used by BOTH the row render and the Tier filter dropdown's unique-values memo so
 * the displayed label and the filter values stay in sync.
 *
 * Spec 1 (2026-06-02): intentionally NOT re-pointed onto the backbone's
 * `source_tier_labels` -- that is the precedence-bucket vocabulary, not this
 * display vocabulary (which folds in the ` + logs` suffix the backbone omits).
 * Re-pointing would change displayed labels; this derivation stays local.
 */
function getDisplayTierLabel(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): string {
  const base = getBaseTierLabel(getAddedBy(candidate));
  if (hasAssociatedLogEvidence(candidate, runtimeEvidenceContext)) {
    return `${base} + logs`;
  }
  return base;
}

/**
 * Format a display-confidence value for the Confidence `<td>`. Null/undefined
 * → em dash. Non-null → existing `Math.round(value * 100)%` rendering. The
 * `Math.round` call here matches the persisted-confidence contract used by
 * Spec 7's `getDisplayConfidence` (output is a decimal in 0..1; cap is
 * applied inside the helper).
 */
function formatDisplayConfidence(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * Returns the CSS class for a row based on the candidate's review_status.
 */
function getRowTintClass(reviewStatus: string): string {
  switch (reviewStatus) {
    case 'approved':
      return styles.rowApproved;
    case 'rejected':
      return styles.rowRejected;
    case 'deferred':
      return styles.rowDeferred;
    default:
      return '';
  }
}


/** The covering foundation scope for a candidate row (entity rows by name,
 *  attribute rows by their parent tableName), or null. */
function foundationScopeFor(
  candidate: { candidate_type?: string; name?: string | null; data?: Record<string, unknown> | null },
  scopeByEntityName?: Map<string, { scope: string; decisionRef: string | null }>,
): { scope: string; decisionRef: string | null } | null {
  if (!scopeByEntityName || scopeByEntityName.size === 0) return null;
  const type = candidate.candidate_type ?? '';
  let key: string | null = null;
  if (type === 'physical_data_entities') key = candidate.name ?? null;
  else if (type === 'physical_data_attributes') {
    key = (candidate.data?.tableName as string | undefined) ?? null;
  }
  if (!key) return null;
  return scopeByEntityName.get(key.toLowerCase()) ?? null;
}

function FoundationScopeChip({
  entry,
}: {
  entry: { scope: string; decisionRef: string | null } | null;
}) {
  if (!entry) return null;
  const isExcluded = entry.scope === 'excluded';
  return (
    <span
      data-testid="foundation-scope-chip"
      title={
        isExcluded
          ? 'Excluded from the migration by a foundation decision — commits as ' +
            'documentation only (committed_excluded); out of target + reconciliation.'
          : 'Volatile by a foundation decision — stays in the migration; S0 ' +
            'fingerprint divergence on this table is tolerated.'
      }
      style={{
        marginLeft: 6,
        padding: '1px 6px',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        background: isExcluded ? '#fdecea' : '#fff8e1',
        color: isExcluded ? '#c62828' : '#8a6d3b',
        border: `1px solid ${isExcluded ? '#f5c6c2' : '#faebcc'}`,
      }}
    >
      {entry.scope.toUpperCase()}
      {entry.decisionRef ? ` (${entry.decisionRef})` : ''}
    </span>
  );
}

export const DiscoveryCandidateTable: React.FC<DiscoveryCandidateTableProps> = ({
  projectId,
  scopeByEntityName,
  architectureId,
  runId,
  candidates,
  onCandidatesChange,
  lastSaveTimestamp,
  onBulkSave,
  bulkSaveInFlight,
  bulkSaveLabel,
  hasApprovedToSave,
}) => {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    name: '',
    tier: '',
    type: '',
    reviewStatus: '',
  });
  // V3 Tier UX: confidence slider (default 0.7). null always visible.
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(DEFAULT_CONFIDENCE_THRESHOLD);
  const [loadingCandidateId, setLoadingCandidateId] = useState<string | null>(null);
  // Spec 2026-05-10 Candidate Details Expansion UI -- Task Group 4:
  // Single-row expansion state. `null` means no row is expanded; otherwise
  // holds the id of the currently expanded candidate.
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);

  // Spec 0 (2026-06-02) Task Group 7: id of the candidate whose conflict
  // chooser modal is open (`null` == closed). Resolving a conflict is a purely
  // client-side mutation routed through `onCandidatesChange`.
  const [conflictModalCandidateId, setConflictModalCandidateId] = useState<
    string | null
  >(null);

  // Spec 3 (2026-06-23) Batch "Resolve Conflicts": run-wide conflict chooser.
  // Aggregates every live conflict across candidates into one modal; commit
  // loops the existing single-attribute resolve endpoint best-effort. `result`
  // drives the pinned banner + Retry relabel + all-success auto-close.
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [batchInFlight, setBatchInFlight] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<BatchResolveResult | null>(null);

  // Spec 2 (2026-06-02) Task Group 5.4: cascade-confirm modal state. When the
  // user clicks a bulk Approve/Reject/Defer button, we resolve the FULL
  // blast-radius touched set for the seeded candidates (over the already-fetched
  // review model) and open the modal pre-selecting it. `null` == closed.
  const [cascadeActionSet, setCascadeActionSet] =
    useState<ResolvedBulkActionSet | null>(null);
  // True while the atomic `bulkReviewCascade` call is in flight (drives the
  // modal spinner + disables dismiss/confirm).
  const [cascadeInFlight, setCascadeInFlight] = useState<boolean>(false);

  // Spec 1 (2026-06-02) Task Group 6: the deterministic review-model backbone
  // for THIS run, fetched live on read (single-run; the grid never passes a
  // second run id). `null` until it loads -- and it STAYS null if the fetch
  // fails -- in which case the count memos fall back to the identical local
  // derivation so the displayed values never flicker wrong. The backbone is
  // READ-ONLY: fetching it writes nothing back.
  //
  // Spec 2 (2026-06-02) Task Group 5: the SAME model (now widened with
  // `blast_radius` + `findings`) is the input to the cascade preview -- the grid
  // adds NO new fetch for the preview.
  const [reviewModel, setReviewModel] = useState<ReviewModel | null>(null);

  // Fetch the single-run review model whenever the run identity changes. The
  // candidate list is already loaded by the parent; this is a SECOND read-only
  // fetch that supplies the precomputed aggregation scalars + per-node conflict/
  // committed lens (Spec 1) AND the blast-radius + findings arms (Spec 2). A
  // stale-response guard prevents an earlier run's model from landing after a
  // faster later one. A fetch failure degrades gracefully to the local
  // derivation (the catch clears the model to null).
  useEffect(() => {
    let cancelled = false;
    setReviewModel(null);
    getReviewModel(projectId, architectureId, runId)
      .then((model) => {
        if (!cancelled) setReviewModel(model);
      })
      .catch(() => {
        if (!cancelled) setReviewModel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, runId]);

  // Per-node lookup keyed by AMS candidate id, joining a displayed grid row to
  // its backbone node. Used by the count derivations so the FILTERED counts read
  // the SAME committed / live-conflict predicate the whole-run aggregation
  // scalars were computed from (filtered + unfiltered therefore agree exactly).
  const backboneNodeById = useMemo(() => {
    const map = new Map<string, ReviewModelNode>();
    if (reviewModel) {
      for (const node of reviewModel.nodes) map.set(node.id, node);
    }
    return map;
  }, [reviewModel]);

  // Per-candidate "is committed?" — backbone node when present, else the local
  // predicate (byte-for-byte the legacy `review_status === 'committed'` check).
  // A backbone node's `committed` is `status === 'committed'`, which the grid's
  // committed rows always satisfy, so the two agree.
  const nodeIsCommitted = (candidate: DiscoveryCandidateDto): boolean => {
    const node = backboneNodeById.get(candidate.id);
    if (node) return node.committed;
    return candidate.review_status === 'committed';
  };

  // Per-candidate "has a live conflict?" — backbone node when present, else the
  // local `getUnresolvedConflicts` predicate. The backbone's `has_live_conflict`
  // is computed from the identical predicate, so the two agree on the same row.
  const nodeHasLiveConflict = (candidate: DiscoveryCandidateDto): boolean => {
    const node = backboneNodeById.get(candidate.id);
    if (node) return node.conflict_state.has_live_conflict;
    return hasUnresolvedConflicts(candidate);
  };

  // Toggle handler -- clicking the same id collapses; a different id replaces
  // (single-row expansion guarantee per spec).
  const handleToggleDetails = (id: string) =>
    setExpandedCandidateId((prev) => (prev === id ? null : id));

  // Hotfix Bug 3 (revised 2026-05-13): clear the column filters whenever
  // the parent signals a successful save-approved (via a bumped
  // `lastSaveTimestamp`) so any pre-save filter (name, type, tier,
  // review-status) that would hide a committed row is reset.
  //
  // The confidence-slider threshold is deliberately NOT reset here. The
  // previous AMS-side bug wiped persisted confidence to 0.0 on every
  // committed candidate (DiscoveryCandidateDto declared `confidence` as
  // primitive double, so a JSON body that omitted the field deserialized
  // to 0.0 and the `setConfidence(update.confidence())` call clobbered
  // the value). With that fixed, committed candidates keep their original
  // confidence, so the user's chosen threshold continues to behave
  // correctly without needing a server-state-driven reset.
  //
  // The initial mount run is a no-op because `lastSaveTimestamp` starts
  // as undefined.
  useEffect(() => {
    if (lastSaveTimestamp === undefined) return;
    setColumnFilters({ name: '', tier: '', type: '', reviewStatus: '' });
  }, [lastSaveTimestamp]);

  // Unique values for dropdown filters
  const uniqueTypes = useMemo(() => {
    const types = new Set(candidates.map((c) => c.candidate_type));
    return Array.from(types).sort();
  }, [candidates]);

  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(candidates.map((c) => c.review_status || 'pending_review'));
    return Array.from(statuses).sort();
  }, [candidates]);

  // Spec 2026-05-11 Log Evidence in Candidate Details UI -- Task Group 4.4:
  // Single `useMemo` over the full candidate list (NOT the filtered list,
  // so the Tier filter dropdown sees ALL discrete labels regardless of
  // current filter selections). The context bundles the per-candidate
  // slice plus three cross-candidate rollups -- all computed in one pass.
  // Threaded into `<CandidateDetailsPanel>` via the `runtimeEvidenceContext`
  // prop, and ALSO reused by `getDisplayTierLabel` and `getDisplayConfidence`.
  // Rebuilt only when the `candidates` reference changes, never per-row.
  const runtimeEvidenceContext = useMemo(
    () => buildRuntimeEvidenceContext(candidates),
    [candidates]
  );

  // Hotfix Bug 4/5: unique discrete tier labels for the Tier filter dropdown.
  // Computed from the full candidate list (not the filtered subset) so the
  // dropdown shows all possible values regardless of which filter is active.
  // Sort puts `—` last so it doesn't dominate the top of the list.
  //
  // Spec 1 (2026-06-02): this remains the grid's own DISPLAY-label derivation
  // (via `getDisplayTierLabel`), NOT the backbone's `source_tier_labels`
  // precedence vocabulary -- re-pointing it would change the displayed labels
  // (see the file header). It is provenance-aligned with the backbone because
  // `getAddedBy` reads the same `data._addedBy` the backbone reads.
  const uniqueTierLabels = useMemo(() => {
    const labels = new Set(candidates.map((c) => getDisplayTierLabel(c, runtimeEvidenceContext)));
    return Array.from(labels).sort((a, b) => {
      if (a === '—') return 1;
      if (b === '—') return -1;
      return a.localeCompare(b);
    });
  }, [candidates, runtimeEvidenceContext]);

  // Apply all filters including the V3 confidence slider. Null confidence
  // candidates are ALWAYS visible (unmarked = "unknown", not "below").
  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (columnFilters.name && !c.name.toLowerCase().includes(columnFilters.name.toLowerCase())) {
        return false;
      }
      if (columnFilters.type && c.candidate_type !== columnFilters.type) {
        return false;
      }
      // Hotfix Bug 4: tier filter on combined display label (e.g. "adapter + logs").
      if (
        columnFilters.tier &&
        getDisplayTierLabel(c, runtimeEvidenceContext) !== columnFilters.tier
      ) {
        return false;
      }
      if (columnFilters.reviewStatus && (c.review_status || 'pending_review') !== columnFilters.reviewStatus) {
        return false;
      }
      // V3 Tier UX confidence gate: preserve null/undefined; hide numeric < threshold.
      if (c.confidence !== null && c.confidence !== undefined && c.confidence < confidenceThreshold) {
        return false;
      }
      return true;
    });
  }, [candidates, columnFilters, confidenceThreshold, runtimeEvidenceContext]);

  const hasActiveFilters =
    columnFilters.name ||
    columnFilters.tier ||
    columnFilters.type ||
    columnFilters.reviewStatus ||
    confidenceThreshold !== DEFAULT_CONFIDENCE_THRESHOLD;

  // Bulk-action gating (Hotfix 2026-05-13; re-pointed onto the backbone in
  // Spec 1 Group 6):
  //   committedCount    -> rows already saved to the canonical model. Read from
  //                        the backbone's whole-run `aggregations.committed_count`
  //                        when loaded; falls back to the identical local count
  //                        (`review_status === 'committed'`) until/if it isn't.
  //                        These rows cannot be re-approved / re-rejected /
  //                        re-deferred.
  //   actionableCount   -> rows that are NOT committed yet. Read from the
  //                        backbone's `aggregations.actionable_count` (whole-run),
  //                        falling back to `candidates.length - committedCount`.
  //                        The bulk Approve/Reject buttons disable when this is 0
  //                        and relabel to "Approve Remaining" / "Reject
  //                        Remaining" when both counts are > 0.
  //   hasCommitted      -> at least one row is saved. Drives the "Remaining"
  //                        relabel branch above.
  const committedCount = useMemo(() => {
    if (reviewModel) return reviewModel.aggregations.committed_count;
    return candidates.filter((c) => c.review_status === 'committed').length;
  }, [reviewModel, candidates]);
  const actionableCount = useMemo(() => {
    if (reviewModel) return reviewModel.aggregations.actionable_count;
    return candidates.length - committedCount;
  }, [reviewModel, candidates, committedCount]);
  const hasCommitted = committedCount > 0;

  // Spec 0 (2026-06-02) Task Group 7.4: clean-approve gating. The bulk Approve
  // buttons are gated whenever ANY candidate in scope still has a live
  // (unresolved) conflict -- approving the run would commit a candidate whose
  // truth is still ambiguous. Mirrors the committed-row Approve disable.
  //   unresolvedConflictCount         -> across the whole run (gates "Approve All").
  //   filteredUnresolvedConflictCount -> across the filtered subset (gates
  //                                      "Approve Filtered").
  //
  // Spec 1 (2026-06-02) Group 6: the WHOLE-RUN count reads the backbone's
  // `aggregations.live_conflict_count` (whose live-conflict predicate is
  // identical to `getUnresolvedConflicts`), falling back to the local count.
  const unresolvedConflictCount = useMemo(() => {
    if (reviewModel) return reviewModel.aggregations.live_conflict_count;
    return candidates.filter((c) => hasUnresolvedConflicts(c)).length;
  }, [reviewModel, candidates]);

  // Count of currently filtered candidates that are NOT already committed --
  // drives the "Approve Filtered" / "Reject Filtered" button labels and
  // disabled state. The filtered bulk action skips committed rows on the
  // server too, so this count mirrors what the server will actually update.
  //
  // Spec 1 (2026-06-02) Group 6: the FILTERED counts stay derived from the
  // currently-FILTERED row subset (the backbone aggregations are whole-run), but
  // JOIN each row to its backbone node (`nodeIsCommitted`) so the predicate
  // matches the whole-run scalar exactly. Falls back to the local predicate when
  // the backbone hasn't loaded.
  const filteredActionableCount = useMemo(
    () => filteredCandidates.filter((c) => !nodeIsCommitted(c)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredCandidates, backboneNodeById]
  );

  const filteredUnresolvedConflictCount = useMemo(
    () => filteredCandidates.filter((c) => nodeHasLiveConflict(c)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredCandidates, backboneNodeById]
  );

  // Build a name lookup for parent references
  const nameById = new Map<string, string>();
  for (const c of candidates) {
    nameById.set(c.id, c.name);
  }

  // The candidate whose conflict modal is open (if any). Resolved live so the
  // modal always reflects the latest `_conflicts` after a prior resolution.
  const conflictModalCandidate = conflictModalCandidateId
    ? candidates.find((c) => c.id === conflictModalCandidateId) ?? null
    : null;
  const conflictModalEntries = conflictModalCandidate
    ? getUnresolvedConflicts(conflictModalCandidate)
    : [];

  // Spec 2 (2026-06-02) Task Group 5.3: display-name maps the cascade modal uses
  // to label candidates + findings by name/title instead of bare ids. Candidate
  // names come from the loaded list; finding titles from the review-model's
  // `findings` arm (the same payload the preview is resolved over).
  const candidateNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of candidates) map[c.id] = c.name;
    return map;
  }, [candidates]);

  const findingTitlesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of reviewModel?.findings ?? []) {
      if (f.title) map[f.id] = f.title;
    }
    return map;
  }, [reviewModel]);

  function updateFilter(key: keyof ColumnFilters, value: string) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearAllFilters() {
    setColumnFilters({ name: '', tier: '', type: '', reviewStatus: '' });
    setConfidenceThreshold(DEFAULT_CONFIDENCE_THRESHOLD);
  }

  /**
   * Handle a review action (approve, reject, defer) with optimistic update.
   */
  async function handleReviewAction(candidateId: string, newStatus: string) {
    const candidateIndex = candidates.findIndex((c) => c.id === candidateId);
    if (candidateIndex === -1) return;

    const previousCandidate = candidates[candidateIndex];

    // Optimistic update
    const optimisticCandidates = [...candidates];
    optimisticCandidates[candidateIndex] = {
      ...previousCandidate,
      review_status: newStatus,
    };
    onCandidatesChange(optimisticCandidates);

    setLoadingCandidateId(candidateId);
    try {
      const updated = await reviewCandidate(projectId, architectureId, runId, candidateId, newStatus);
      const serverCandidates = [...optimisticCandidates];
      serverCandidates[candidateIndex] = updated;
      onCandidatesChange(serverCandidates);
    } catch {
      const revertedCandidates = [...candidates];
      revertedCandidates[candidateIndex] = previousCandidate;
      onCandidatesChange(revertedCandidates);
    } finally {
      setLoadingCandidateId(null);
    }
  }

  /**
   * Spec 2 (2026-06-02) Task Group 5.4: open the cascade-confirm modal for a
   * bulk Approve / Reject / Defer.
   *
   * The SEED set is the current scope's ACTIONABLE (non-committed) candidate ids:
   *   - scope 'all'      -> every non-committed candidate in the run.
   *   - scope 'filtered' -> every non-committed candidate in the current filter.
   * That seed is expanded into the FULL Spec 1 blast-radius touched set (seed +
   * cascaded dependents + linked findings, with edge provenance) by the frontend
   * MIRROR of the gateway `resolveBulkActionSet`, rendered over the review model
   * ALREADY fetched on mount -- NO new fetch. The reviewer then deselects inside
   * the modal; Confirm applies the curated set atomically.
   *
   * When the review model hasn't loaded yet (or carries no blast_radius/findings),
   * the resolver simply returns the seed candidates with no cascade -- the modal
   * still opens with the explicit selection so the action is never blocked.
   */
  function handleOpenCascade(
    action: BulkReviewAction,
    scope: 'all' | 'filtered' = 'all',
  ) {
    const pool = scope === 'filtered' ? filteredCandidates : candidates;
    const seedCandidateIds = pool
      .filter((c) => !nodeIsCommitted(c))
      .map((c) => c.id);
    if (seedCandidateIds.length === 0) return;

    // Resolve over the already-fetched model; fall back to an empty model shape
    // (seed-only, no cascade) when it hasn't loaded so the action still opens.
    const model: ReviewModel =
      reviewModel ?? {
        nodes: seedCandidateIds.map((id) => ({
          id,
          review_status: 'pending_review',
          committed: false,
          conflict_state: { has_live_conflict: false },
        })),
        aggregations: {
          committed_count: 0,
          actionable_count: seedCandidateIds.length,
          live_conflict_count: 0,
        },
        blast_radius: seedCandidateIds.map((id) => ({
          candidate_id: id,
          dependents: [],
          would_be_orphaned_parent_ids: [],
        })),
        findings: [],
      };

    const actionSet = resolveBulkActionSet({ seedCandidateIds, action }, model);
    setCascadeActionSet(actionSet);
  }

  /**
   * Spec 2 (2026-06-02) Task Group 5.4: apply a curated cascade set atomically.
   *
   * Calls the ATOMIC `bulkReviewCascade` endpoint (NOT the per-row fan-out) with
   * the reviewer-curated `candidate_ids` + `finding_ids`. On success, optimistically
   * updates the grid's candidate state via `onCandidatesChange`, leaving `committed`
   * rows untouched (mirrors the old `handleBulkReview` optimistic pass). Findings
   * live outside the grid's state, so only the candidate arm is reflected here.
   */
  async function handleConfirmCascade(
    payload: BulkCandidateActionConfirmPayload,
  ) {
    if (!cascadeActionSet) return;
    const newStatus = cascadeActionSet.action;
    const curatedCandidateIds = new Set(payload.candidateIds);

    setCascadeInFlight(true);
    try {
      await bulkReviewCascade(projectId, architectureId, runId, {
        candidate_ids: payload.candidateIds,
        finding_ids: payload.findingIds,
        review_status: newStatus,
        ...(payload.reviewerNotes
          ? { reviewer_notes: payload.reviewerNotes }
          : {}),
      });

      // Optimistic candidate update: only the curated, non-committed rows move
      // to the new disposition; committed rows are NEVER re-dispositioned (the
      // server skips them too).
      const updated = candidates.map((c) => {
        if (c.review_status === 'committed') return c;
        if (!curatedCandidateIds.has(c.id)) return c;
        return { ...c, review_status: newStatus };
      });
      onCandidatesChange(updated);
      setCascadeActionSet(null);
    } catch (err) {
      // The atomic batch rolled back server-side -- leave grid state untouched
      // and keep the modal open so the reviewer can retry / cancel.
      // eslint-disable-next-line no-console
      console.error('Cascade bulk review failed:', err);
    } finally {
      setCascadeInFlight(false);
    }
  }

  /**
   * Spec 0 (2026-06-02) Task Group 7.3: apply the reviewer's conflict
   * resolutions for the open candidate. For each attribute the reviewer chose
   * (`selections[attr]` is a defined option index), this:
   *   - writes the chosen value to the canonical attribute slot (`data[attr]`),
   *   - stamps `data._conflictResolutions[attr]` with the chosen value, source,
   *     reviewer label, and timestamp,
   *   - removes that attribute from `data._conflicts`.
   * The optimistic mutation is routed through `onCandidatesChange` (the same
   * channel as review actions) for INSTANT feedback. Attributes the reviewer
   * left unchosen are untouched (their conflict stays live).
   *
   * Bug 3 fix (2026-06-03): the resolution is ALSO persisted DURABLY, server-side,
   * by calling the existing `resolveDiscoveryConflict` proxy (Spec 3's
   * `/resolve-conflict` PATCH) ONCE PER resolved attribute. Previously this handler
   * was client-side ONLY, so on Approve the grid re-read the candidate from the
   * server -- which still carried the unresolved `_conflicts[attr]` -- and the
   * conflict REAPPEARED. The optimistic update stays for instant feedback; the
   * server write makes it durable so the post-Approve re-read no longer loses it.
   * The persist is fire-and-forget (the optimistic state already reflects success);
   * a failed write is logged and leaves the optimistic state in place.
   *
   * Bug 2 fix (2026-06-03): the held optimistic review-model backbone snapshot is
   * updated in lockstep so the all-or-nothing clean-approve GATE recomputes
   * immediately. The bulk Approve / Approve-Filtered gate reads the SERVER-computed
   * backbone (`nodeHasLiveConflict` via `backboneNodeById`, plus the whole-run
   * `aggregations.live_conflict_count`), which is otherwise STALE after a
   * client-side resolve -- so resolving never cleared the gate. We clear the
   * resolved candidate's node live-conflict state (recomputed from the
   * resolution-aware `nextData`) and decrement the whole-run live-conflict count
   * when the candidate transitions from conflicted to clean, so "Approve Filtered"
   * enables the instant the last conflicted candidate in the filter is settled.
   */
  function handleResolveConflicts(
    candidateId: string,
    selections: ConflictSelections,
  ) {
    const candidateIndex = candidates.findIndex((c) => c.id === candidateId);
    if (candidateIndex === -1) {
      setConflictModalCandidateId(null);
      return;
    }
    const candidate = candidates[candidateIndex];
    const entries = getUnresolvedConflicts(candidate);
    const resolvedAt = new Date().toISOString();
    const resolvedBy = 'reviewer';

    // Deep-ish clone the conflict-bearing sub-objects so we never mutate the
    // existing candidate `data` in place (preserves optimistic-revert safety).
    const prevData = (candidate.data ?? {}) as Record<string, unknown>;
    const nextData: Record<string, unknown> = { ...prevData };
    const nextConflicts: Record<string, unknown> = {
      ...((prevData._conflicts as Record<string, unknown>) ?? {}),
    };
    const nextResolutions: Record<string, unknown> = {
      ...((prevData._conflictResolutions as Record<string, unknown>) ?? {}),
    };

    // The attributes actually resolved this pass (drives the durable per-attribute
    // server writes below). Each carries the chosen value + source the
    // `/resolve-conflict` endpoint persists.
    const resolved: { attr: string; chosenValue: unknown; chosenSource: string }[] = [];
    for (const entry of entries) {
      const choice = selections[entry.attr];
      if (choice === undefined) continue;
      const option = entry.options[choice];
      if (!option) continue;
      // Canonical slot <- chosen value.
      nextData[entry.attr] = option.value;
      // Stamp the resolution.
      nextResolutions[entry.attr] = {
        chosenValue: option.value,
        chosenSource: option.source,
        resolvedBy,
        resolvedAt,
      };
      // Clear the now-resolved conflict.
      delete nextConflicts[entry.attr];
      resolved.push({
        attr: entry.attr,
        chosenValue: option.value,
        chosenSource: option.source,
      });
    }

    // Always close the modal; only emit a state change when something resolved.
    setConflictModalCandidateId(null);
    if (resolved.length === 0) return;

    nextData._conflicts = nextConflicts;
    nextData._conflictResolutions = nextResolutions;

    const updatedCandidate = { ...candidate, data: nextData };
    const updated = [...candidates];
    updated[candidateIndex] = updatedCandidate;
    onCandidatesChange(updated);

    // Bug 2: keep the held backbone snapshot consistent so the clean-approve gate
    // (which reads the backbone, not the local `data`) recomputes right away. Only
    // when a backbone is loaded; the local-fallback path already derives the gate
    // from `data` and needs no patch.
    const stillLiveAfter = getUnresolvedConflicts(updatedCandidate).length > 0;
    setReviewModel((prev) => {
      if (!prev) return prev;
      const prevNode = prev.nodes.find((n) => n.id === candidateId);
      // If this candidate has no backbone node, or it was already clean, nothing
      // to patch -- return the same reference so React skips the re-render.
      const wasLive = prevNode?.conflict_state.has_live_conflict ?? false;
      if (!prevNode || wasLive === stillLiveAfter) return prev;
      const remainingAttrs = getUnresolvedConflicts(updatedCandidate).map(
        (e) => e.attr,
      );
      const nodes = prev.nodes.map((n) =>
        n.id === candidateId
          ? {
              ...n,
              conflict_state: {
                has_live_conflict: stillLiveAfter,
                live_conflict_attrs: remainingAttrs,
              },
            }
          : n,
      );
      // The candidate transitioned live -> clean (wasLive && !stillLiveAfter),
      // so decrement the whole-run live-conflict scalar the bulk-Approve gate
      // reads. Clamp at 0 defensively.
      const nextLiveCount = Math.max(
        0,
        prev.aggregations.live_conflict_count - (wasLive && !stillLiveAfter ? 1 : 0),
      );
      return {
        ...prev,
        nodes,
        aggregations: { ...prev.aggregations, live_conflict_count: nextLiveCount },
      };
    });

    // Bug 3: persist each resolved attribute DURABLY (single-attribute endpoint).
    // Fire-and-forget -- the optimistic state already reflects success; a failed
    // write is logged and leaves the optimistic state intact for the reviewer.
    for (const r of resolved) {
      resolveDiscoveryConflict(projectId, architectureId, runId, candidateId, {
        attr: r.attr,
        chosen_value: r.chosenValue,
        chosen_source: r.chosenSource,
        resolved_by: resolvedBy,
        resolved_at: resolvedAt,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Persisting conflict resolution failed:', err);
      });
    }
  }

  // Spec 3 (2026-06-23) Batch "Resolve Conflicts": aggregate EVERY live conflict
  // across all candidates in the run into the modal's row shape (one row per
  // conflicted attribute). Recomputes when the candidate list reference changes,
  // so resolved rows drop out after a commit feeds back via onCandidatesChange.
  const batchConflictRows = useMemo<ConflictRow[]>(() => {
    const rows: ConflictRow[] = [];
    for (const c of candidates) {
      for (const entry of getUnresolvedConflicts(c)) {
        rows.push({
          candidateId: c.id,
          candidateName: c.name,
          type: c.candidate_type,
          attr: entry.attr,
          options: entry.options,
        });
      }
    }
    return rows;
  }, [candidates]);

  // Spec 3 (2026-06-23): run the best-effort batch commit (TG3 helper loops the
  // existing single-attribute resolve endpoint, stamping `reviewer (batch)`),
  // then mirror handleResolveConflicts' optimistic candidate update + backbone-
  // snapshot patch for every resolved (candidate, attribute) so the resolved
  // rows clear and the approve-gate + the top-button N update immediately. The
  // modal stays open on partial failure (keeping only the failed rows selected)
  // and auto-closes on all-success (both handled inside the modal via `result`).
  async function handleBatchResolveConfirm(selections: BatchRowSelections) {
    const units = selectionsToCommitUnits(batchConflictRows, selections);
    if (units.length === 0) return;
    setBatchInFlight(true);
    try {
      const result = await batchResolveCommit(
        { projectId, architectureId, runId },
        units,
        candidates,
      );
      onCandidatesChange(result.candidates);

      // Patch the held backbone snapshot for every candidate that transitioned
      // live -> clean, mirroring handleResolveConflicts' Bug-2 patch so the
      // bulk-Approve gate + the whole-run live-conflict scalar recompute now.
      setReviewModel((prev) => {
        if (!prev) return prev;
        const updatedById = new Map(result.candidates.map((c) => [c.id, c]));
        let liveDelta = 0;
        let changed = false;
        const nodes = prev.nodes.map((n) => {
          const updatedCandidate = updatedById.get(n.id);
          if (!updatedCandidate) return n;
          const stillLive = getUnresolvedConflicts(updatedCandidate).length > 0;
          const wasLive = n.conflict_state.has_live_conflict;
          if (wasLive === stillLive) return n;
          changed = true;
          if (wasLive && !stillLive) liveDelta += 1;
          return {
            ...n,
            conflict_state: {
              has_live_conflict: stillLive,
              live_conflict_attrs: getUnresolvedConflicts(updatedCandidate).map(
                (e) => e.attr,
              ),
            },
          };
        });
        if (!changed) return prev;
        return {
          ...prev,
          nodes,
          aggregations: {
            ...prev.aggregations,
            live_conflict_count: Math.max(
              0,
              prev.aggregations.live_conflict_count - liveDelta,
            ),
          },
        };
      });

      setBatchResult({ resolved: result.resolved, failed: result.failed });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Batch conflict resolution failed:', err);
    } finally {
      setBatchInFlight(false);
    }
  }

  if (candidates.length === 0) {
    return <div className={styles.emptyMessage} data-testid="candidate-table-empty">No candidates found for this run.</div>;
  }

  return (
    <div>
      {/* V3 Tier UX: confidence slider bar */}
      <div className={styles.confidenceSliderBar} data-testid="confidence-slider-bar">
        <span className={styles.confidenceSliderLabel}>Min confidence:</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidenceThreshold}
          className={styles.confidenceSliderInput}
          onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
          aria-label="Minimum confidence threshold"
          data-testid="confidence-slider"
        />
        <span className={styles.confidenceSliderValue} data-testid="confidence-slider-value">
          {confidenceThreshold.toFixed(2)}
        </span>
        <span style={{ fontSize: 11, color: '#888' }}>
          (unmarked candidates always visible)
        </span>
      </div>

      {/* Count summary with filter status and bulk actions */}
      <div className={styles.countSummary} data-testid="candidate-count-summary">
        <span>
          {hasActiveFilters
            ? `Showing ${filteredCandidates.length} of ${candidates.length} candidates`
            : `${candidates.length} candidates`}
          {(() => {
            if (!scopeByEntityName || scopeByEntityName.size === 0) return null;
            const scopes = candidates
              .map((c) => foundationScopeFor(c, scopeByEntityName)?.scope)
              .filter(Boolean);
            const excluded = scopes.filter((s) => s === 'excluded').length;
            const volatileCount = scopes.filter((s) => s === 'volatile').length;
            if (excluded === 0 && volatileCount === 0) return null;
            return (
              <span
                data-testid="foundation-scope-count"
                style={{ marginLeft: 10, color: '#8a6d3b', fontWeight: 600 }}
              >
                {excluded > 0 &&
                  `${excluded} excluded by foundation decisions — commit as ` +
                    'documentation only (committed_excluded) on save'}
                {excluded > 0 && volatileCount > 0 && ' · '}
                {volatileCount > 0 && `${volatileCount} volatile (S0-tolerated)`}
              </span>
            );
          })()}
        </span>
        {hasActiveFilters && (
          <button className={styles.clearFiltersButton} onClick={clearAllFilters} data-testid="clear-filters">
            Clear filters
          </button>
        )}
        <span className={styles.bulkActions}>
          {/* Bulk-action wording reacts to the saved-row split:
              - all rows still actionable -> "Approve All" / "Reject All"
              - some rows already saved (review_status === 'committed') and
                some still actionable -> "Approve Remaining" / "Reject
                Remaining" (the cascade modal seeds only the actionable rows so
                the action never reverts saved state)
              - every row is committed -> button disabled (nothing left to act on)
              An empty candidate list never reaches this render path: the
              earlier `candidates.length === 0` guard returns the empty-state
              message before the table is rendered, so `actionableCount` of 0
              here always means "all committed".

              "Approve Filtered" / "Reject Filtered" (added 2026-05-22) act
              on the currently filtered set of candidates only. Disabled
              when no filter is active (the unfiltered case is already
              covered by the All/Remaining buttons) or when zero filtered
              rows are actionable.

              Spec 0 (2026-06-02) Task Group 7.4: the Approve buttons are
              ADDITIONALLY gated while any candidate in scope has a live
              (unresolved) conflict -- a clean approve must not commit an
              ambiguous candidate. Reject is intentionally NOT gated (rejecting
              an ambiguous candidate is always valid).

              Spec 2 (2026-06-02) Task Group 5.4: each bulk button now OPENS the
              cascade-confirm modal (pre-selecting the full Spec 1 blast-radius
              for the seeded scope) instead of firing the per-row fan-out. The
              labels / gating are unchanged; the apply is atomic on Confirm. */}
          {/* Spec 3 (2026-06-23) Batch "Resolve Conflicts": opens the run-wide
              conflict chooser. FIRST in the bulk row; neutral style (no
              approve/reject colour); enabled only when the run has >= 1 live
              (unresolved) conflict. N = the whole-run unresolvedConflictCount,
              the SAME scalar the Approve gate reads. */}
          <button
            className={`${styles.actionButton}${unresolvedConflictCount === 0 ? ` ${styles.actionButtonDisabled}` : ''}`}
            disabled={unresolvedConflictCount === 0}
            title={
              unresolvedConflictCount === 0
                ? 'No unresolved conflicts to resolve'
                : `Resolve ${unresolvedConflictCount} conflicted candidate(s) in one place`
            }
            onClick={() => {
              setBatchResult(null);
              setBatchModalOpen(true);
            }}
            data-testid="bulk-resolve-conflicts"
          >
            {`Resolve Conflicts (${unresolvedConflictCount})`}
          </button>
          <button
            className={`${styles.actionButton} ${styles.actionButtonApprove}${actionableCount === 0 || unresolvedConflictCount > 0 ? ` ${styles.actionButtonDisabled}` : ''}`}
            disabled={actionableCount === 0 || unresolvedConflictCount > 0}
            title={
              actionableCount === 0
                ? 'All candidates are already saved'
                : unresolvedConflictCount > 0
                  ? `Resolve ${unresolvedConflictCount} conflicted candidate(s) before approving`
                  : undefined
            }
            onClick={() => handleOpenCascade('approved')}
            data-testid="bulk-approve"
          >
            {hasCommitted && actionableCount > 0
              ? 'Approve Remaining'
              : 'Approve All'}
          </button>
          <button
            className={`${styles.actionButton} ${styles.actionButtonApprove}${!hasActiveFilters || filteredActionableCount === 0 || filteredUnresolvedConflictCount > 0 ? ` ${styles.actionButtonDisabled}` : ''}`}
            disabled={!hasActiveFilters || filteredActionableCount === 0 || filteredUnresolvedConflictCount > 0}
            title={
              !hasActiveFilters
                ? 'Apply a filter to enable this action'
                : filteredActionableCount === 0
                  ? 'No actionable candidates in the current filter'
                  : filteredUnresolvedConflictCount > 0
                    ? `Resolve ${filteredUnresolvedConflictCount} conflicted candidate(s) in the current filter before approving`
                    : undefined
            }
            onClick={() => handleOpenCascade('approved', 'filtered')}
            data-testid="bulk-approve-filtered"
          >
            {`Approve Filtered${hasActiveFilters && filteredActionableCount > 0 ? ` (${filteredActionableCount})` : ''}`}
          </button>
          <button
            className={`${styles.actionButton} ${styles.actionButtonReject}${actionableCount === 0 ? ` ${styles.actionButtonDisabled}` : ''}`}
            disabled={actionableCount === 0}
            title={actionableCount === 0 ? 'All candidates are already saved' : undefined}
            onClick={() => handleOpenCascade('rejected')}
            data-testid="bulk-reject"
          >
            {hasCommitted && actionableCount > 0
              ? 'Reject Remaining'
              : 'Reject All'}
          </button>
          <button
            className={`${styles.actionButton} ${styles.actionButtonReject}${!hasActiveFilters || filteredActionableCount === 0 ? ` ${styles.actionButtonDisabled}` : ''}`}
            disabled={!hasActiveFilters || filteredActionableCount === 0}
            title={
              !hasActiveFilters
                ? 'Apply a filter to enable this action'
                : filteredActionableCount === 0
                  ? 'No actionable candidates in the current filter'
                  : undefined
            }
            onClick={() => handleOpenCascade('rejected', 'filtered')}
            data-testid="bulk-reject-filtered"
          >
            {`Reject Filtered${hasActiveFilters && filteredActionableCount > 0 ? ` (${filteredActionableCount})` : ''}`}
          </button>
          {/* Spec 2 (2026-06-02) Task Group 5.4: bulk Defer, seeded from the
              full scope (mirrors Approve/Reject; no conflict gate -- deferring
              an ambiguous candidate is valid). Opens the cascade modal. */}
          <button
            className={`${styles.actionButton} ${styles.actionButtonDefer}${actionableCount === 0 ? ` ${styles.actionButtonDisabled}` : ''}`}
            disabled={actionableCount === 0}
            title={actionableCount === 0 ? 'All candidates are already saved' : undefined}
            onClick={() => handleOpenCascade('deferred')}
            data-testid="bulk-defer"
          >
            {hasCommitted && actionableCount > 0 ? 'Defer Remaining' : 'Defer All'}
          </button>
          {/* Spec 2 (2026-06-02) Task Group 5.5: bulk Save -- reuses the parent's
              existing save-approved flow (commit `approved` + the SAME post-save
              AppShell cache refresh). Rendered only when the parent supplies
              `onBulkSave`; disabled while a save is in flight or when there is
              nothing approved to save. */}
          {onBulkSave && (
            <button
              className={`${styles.actionButton} ${styles.actionButtonApprove}${bulkSaveInFlight || hasApprovedToSave === false ? ` ${styles.actionButtonDisabled}` : ''}`}
              disabled={!!bulkSaveInFlight || hasApprovedToSave === false}
              title={
                hasApprovedToSave === false
                  ? 'No approved candidates to save'
                  : undefined
              }
              onClick={() => onBulkSave()}
              data-testid="bulk-save"
            >
              {bulkSaveInFlight ? 'Saving...' : bulkSaveLabel ?? 'Save Approved'}
            </button>
          )}
        </span>
      </div>

      {/* Candidate Table with inline column filters */}
      <table className={styles.candidateTable} data-testid="candidate-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Tier</th>
            <th>Type</th>
            <th>Confidence</th>
            <th>Review Status</th>
            <th>Synthesized At</th>
            <th>Actions</th>
          </tr>
          <tr className={styles.filterRow} data-testid="filter-row">
            <th>
              <input
                type="text"
                className={styles.filterInput}
                placeholder="Filter..."
                value={columnFilters.name}
                onChange={(e) => updateFilter('name', e.target.value)}
                data-testid="filter-name"
              />
            </th>
            <th>
              {/* Hotfix Bug 4: Tier filter dropdown populated with the
                  discrete display labels (e.g. "adapter + logs"). The
                  options come from `uniqueTierLabels` which is derived
                  from the SAME `getDisplayTierLabel` helper used by the
                  row render, so the dropdown values and the visible
                  badge text stay in lockstep. */}
              <select
                className={styles.filterSelect}
                value={columnFilters.tier}
                onChange={(e) => updateFilter('tier', e.target.value)}
                data-testid="filter-tier"
              >
                <option value="">All</option>
                {uniqueTierLabels.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </th>
            <th>
              <select
                className={styles.filterSelect}
                value={columnFilters.type}
                onChange={(e) => updateFilter('type', e.target.value)}
                data-testid="filter-type"
              >
                <option value="">All</option>
                {uniqueTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </th>
            <th></th>
            <th>
              <select
                className={styles.filterSelect}
                value={columnFilters.reviewStatus}
                onChange={(e) => updateFilter('reviewStatus', e.target.value)}
                data-testid="filter-review-status"
              >
                <option value="">All</option>
                {uniqueStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredCandidates.length === 0 && (
            <tr>
              <td colSpan={CANDIDATE_TABLE_COLUMN_COUNT} className={styles.emptyMessage}>
                No candidates match the current filters
              </td>
            </tr>
          )}
          {filteredCandidates.map((candidate) => {
            const isChild = candidate.parent_candidate_id !== null;
            const parentName = isChild ? nameById.get(candidate.parent_candidate_id!) : undefined;
            const reviewStatus = candidate.review_status || 'pending_review';
            const isLoading = loadingCandidateId === candidate.id;
            const rowTint = getRowTintClass(reviewStatus);
            const childClass = isChild ? styles.childRow : '';
            const loadingClass = isLoading ? styles.rowLoading : '';
            const rowClassName = [childClass, rowTint, loadingClass].filter(Boolean).join(' ') || undefined;
            const addedBy = getAddedBy(candidate);
            // Spec 2026-05-10 Task Group 4: per-candidate expansion gates.
            // `canExpand` controls both the toggle button's disabled state
            // AND the conditional render of the expansion `<tr>`. Even if
            // `expandedCandidateId` somehow points at an unsupported type,
            // the AND guard below prevents the panel from rendering.
            const canExpand = supportsDetails(candidate.candidate_type);
            const isExpanded = expandedCandidateId === candidate.id;

            // Spec 7 (2026-05-11) Task Group 4.3:
            // Per-row display-confidence read against the precomputed memo.
            // O(1) Map lookup; no per-row aggregation.
            const displayConfidenceResult = getDisplayConfidence(candidate, runtimeEvidenceContext);

            // Hotfix Bug 5: discrete combined tier label for the badge.
            // Replaces the previous sibling-RuntimeBadge approach with a
            // single-pill display whose text encodes log-evidence presence.
            const tierLabel = getDisplayTierLabel(candidate, runtimeEvidenceContext);

            // Model-Aware Discovery (Spec 2026-05-30) Task Group 5: per-row
            // operation badge. `operation` defaults to `create` when absent;
            // the badge label resolves the target NAME(s) off `data`.
            const operation = readCandidateOperation(candidate);
            const operationLabel = getOperationBadgeLabel(candidate);

            // Hotfix Bug 3: candidates that have already been promoted to
            // the canonical model (review_status === 'committed') must have
            // their Approve / Reject / Defer buttons disabled with a tooltip.
            // Show Details remains enabled.
            const isCommitted = reviewStatus === 'committed';
            const committedTitle = 'Already saved to canonical model';

            // Spec 0 (2026-06-02) Task Group 7: live (unresolved) conflicts
            // raise a per-row badge AND gate the per-row Approve button.
            const conflictEntries = getUnresolvedConflicts(candidate);
            const hasConflict = conflictEntries.length > 0;
            const conflictTitle = `Resolve ${conflictEntries.length} attribute conflict(s) before approving`;

            return (
              <React.Fragment key={candidate.id}>
                <tr
                  className={rowClassName}
                  data-testid="candidate-row"
                >
                  <td>
                    {candidate.name}
                    <FoundationScopeChip
                      entry={foundationScopeFor(candidate, scopeByEntityName)}
                    />
                    {/*
                      Phase 2 Group 3 (spec 2026-05-17-soap-llm-extraction-
                      and-payload-enrichment-phase-2): "discovered-via"
                      chip sourced from `candidate.data.discovery_method`.
                      Absent / unknown values render nothing -- the chip is
                      purely additive to existing candidate-review rows.
                    */}
                    {' '}
                    <DiscoveryMethodChip
                      discoveryMethod={
                        (candidate.data as Record<string, unknown> | null | undefined)?.discovery_method
                      }
                      data-testid={`discovery-method-chip-${candidate.id}`}
                    />
                    {/*
                      Model-Aware Discovery (Spec 2026-05-30) Task Group 5.3:
                      per-row OPERATION badge + resolved target name,
                      interleaved in the EXISTING stream (NO separate section).
                      Reuses the `TierBadge` pill purely for its colour
                      treatment (operation -> synthetic addedBy token); the
                      visible text is always the explicit `operationLabel`
                      ("Enrich existing <target>" / "Link <logical>↔<physical>"
                      / "Create new"). Resolved target name(s) come from the
                      candidate `data` payload via `candidateOperationSupport`.
                    */}
                    {' '}
                    <TierBadge
                      addedBy={operationToAddedByToken(operation)}
                      label={operationLabel}
                      data-testid={`candidate-operation-badge-${candidate.id}`}
                    />
                    {isChild && (
                      <span className={styles.parentLabel} data-testid="parent-label">
                        (child of {parentName ?? candidate.parent_candidate_id})
                      </span>
                    )}
                  </td>
                  <td>
                    {/* Hotfix Bug 5: single TierBadge rendering the combined
                        discrete label. The previous Spec 7 sibling
                        `<RuntimeBadge>` is intentionally removed from the
                        table -- the same information is encoded by the
                        `" + logs"` suffix on the badge's label. The Show
                        Details "Log Scans" card still surfaces the full
                        runtime detail (with counts and severity). */}
                    <TierBadge
                      addedBy={addedBy}
                      label={tierLabel}
                      data-testid="candidate-tier-badge"
                    />
                  </td>
                  <td>{candidate.candidate_type}</td>
                  <td data-testid="candidate-confidence-cell">
                    {/* Spec 7 Task Group 4.3: read displayConfidence (with
                        runtime-derived uplift + cap applied) instead of the
                        persisted candidate.confidence. Persisted base
                        confidence is NEVER mutated; this is a display-only
                        derivation from the same Spec 6 memo. When the
                        applied uplift > 0 (after capping), append a small
                        adjacent `+N` indicator preserving the existing
                        rounding contract. */}
                    {formatDisplayConfidence(displayConfidenceResult.displayConfidence)}
                    {displayConfidenceResult.uplift > 0 && (
                      <span data-testid="candidate-confidence-uplift">
                        {' '}+{displayConfidenceResult.uplift}
                      </span>
                    )}
                  </td>
                  <td title={`Pipeline status: ${candidate.status}`}>
                    {reviewStatus}
                    {/* Spec 0 (2026-06-02) Task Group 7.2: per-row conflict
                        badge alongside the Review Status. Rendered ONLY when
                        the candidate has a live (unresolved) conflict.
                        Clicking it opens the side-by-side chooser modal.
                        Reuses the danger/red review palette so it reads as a
                        blocker, consistent with the Reject button. */}
                    {hasConflict && (
                      <button
                        type="button"
                        className={styles.conflictBadge}
                        onClick={() => setConflictModalCandidateId(candidate.id)}
                        title="Sources disagree -- click to resolve"
                        data-testid={`candidate-conflict-badge-${candidate.id}`}
                      >
                        {conflictEntries.length === 1
                          ? '1 conflict'
                          : `${conflictEntries.length} conflicts`}
                      </button>
                    )}
                  </td>
                  <td>{new Date(candidate.synthesized_at).toLocaleString()}</td>
                  <td>
                    {isLoading ? (
                      <span className={styles.rowSavingIndicator} data-testid="row-saving-indicator">
                        Saving...
                      </span>
                    ) : (
                      <>
                        {/* Show/Close Details toggle (Spec 2026-05-10 Task Group 4).
                            Always rendered first so the action order in the cell
                            is exactly: Show Details, Approve, Reject, Defer. */}
                        {canExpand ? (
                          <button
                            className={styles.actionButton}
                            onClick={() => handleToggleDetails(candidate.id)}
                            data-testid={`show-details-${candidate.id}`}
                          >
                            {isExpanded ? 'Close Details' : 'Show Details'}
                          </button>
                        ) : (
                          <button
                            className={`${styles.actionButton} ${styles.actionButtonDisabled}`}
                            disabled={true}
                            title="Details not available for this candidate type"
                            data-testid={`show-details-${candidate.id}`}
                          >
                            Show Details
                          </button>
                        )}
                        <button
                          className={`${styles.actionButton} ${styles.actionButtonApprove}${(reviewStatus === 'approved' || isCommitted || hasConflict) ? ` ${styles.actionButtonDisabled}` : ''}`}
                          disabled={reviewStatus === 'approved' || isLoading || isCommitted || hasConflict}
                          title={
                            isCommitted
                              ? committedTitle
                              : hasConflict
                                ? conflictTitle
                                : undefined
                          }
                          onClick={() => handleReviewAction(candidate.id, 'approved')}
                          data-testid="action-approve"
                        >
                          Approve
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.actionButtonReject}${(reviewStatus === 'rejected' || isCommitted) ? ` ${styles.actionButtonDisabled}` : ''}`}
                          disabled={reviewStatus === 'rejected' || isLoading || isCommitted}
                          title={isCommitted ? committedTitle : undefined}
                          onClick={() => handleReviewAction(candidate.id, 'rejected')}
                          data-testid="action-reject"
                        >
                          Reject
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.actionButtonDefer}${(reviewStatus === 'deferred' || isCommitted) ? ` ${styles.actionButtonDisabled}` : ''}`}
                          disabled={reviewStatus === 'deferred' || isLoading || isCommitted}
                          title={isCommitted ? committedTitle : undefined}
                          onClick={() => handleReviewAction(candidate.id, 'deferred')}
                          data-testid="action-defer"
                        >
                          Defer
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {/* Expansion row (Spec 2026-05-10 Task Group 4).
                    Rendered immediately after the candidate row inside the
                    same <tbody>. Double-guarded: only renders when this row
                    is the expanded one AND the candidate type is supported,
                    so an unsupported row can never produce an expansion
                    panel even if `expandedCandidateId` somehow points at it.
                    Row-tint classes (rowApproved/Rejected/Deferred) stay on
                    the candidate row above and are intentionally omitted
                    here so the expansion area is visually neutral.
                    Spec 2026-05-11 Task Group 4.4: precomputed
                    `runtimeEvidenceContext` is threaded into the panel so
                    the Log Scans column reads from a per-table-render
                    bundle rather than aggregating per-row. */}
                {isExpanded && canExpand && (
                  <tr key={`${candidate.id}-details`} data-testid={`candidate-details-row-${candidate.id}`}>
                    <td colSpan={CANDIDATE_TABLE_COLUMN_COUNT}>
                      <CandidateDetailsPanel
                        candidate={candidate}
                        runtimeEvidenceContext={runtimeEvidenceContext}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Spec 0 (2026-06-02) Task Group 7.3: per-attribute side-by-side conflict
          chooser. Opened from a row's conflict badge; resolving writes the
          chosen value to the canonical slot + stamps `_conflictResolutions`
          + clears the conflict, all via `onCandidatesChange`. */}
      <ConflictResolutionModal
        isOpen={conflictModalCandidate !== null && conflictModalEntries.length > 0}
        candidateName={conflictModalCandidate?.name ?? ''}
        conflicts={conflictModalEntries}
        onClose={() => setConflictModalCandidateId(null)}
        onResolve={(selections) => {
          if (conflictModalCandidate) {
            handleResolveConflicts(conflictModalCandidate.id, selections);
          }
        }}
      />

      {/* Spec 3 (2026-06-23) Batch "Resolve Conflicts": run-wide chooser that
          aggregates EVERY live conflict across candidates. Commit loops the same
          single-attribute resolve endpoint best-effort (reviewer (batch)
          provenance); resolved rows clear via onCandidatesChange + the backbone
          patch. Coexists with the per-row badge + single-candidate modal above. */}
      <BatchResolveConflictsModal
        isOpen={batchModalOpen}
        rows={batchConflictRows}
        inFlight={batchInFlight}
        result={batchResult}
        onClose={() => {
          setBatchModalOpen(false);
          setBatchResult(null);
        }}
        onConfirm={handleBatchResolveConfirm}
      />

      {/* Spec 2 (2026-06-02) Task Group 5.3/5.4: cascade-confirm modal. A THIN
          renderer over the resolved blast-radius touched set; the reviewer
          deselects dependents/findings, then Confirm fires the ATOMIC
          `bulkReviewCascade` with only the curated ids. */}
      {cascadeActionSet && (
        <BulkCandidateActionConfirmModal
          isOpen={cascadeActionSet !== null}
          actionSet={cascadeActionSet}
          candidateNamesById={candidateNamesById}
          findingTitlesById={findingTitlesById}
          inFlight={cascadeInFlight}
          onClose={() => {
            if (!cascadeInFlight) setCascadeActionSet(null);
          }}
          onConfirm={handleConfirmCascade}
        />
      )}
    </div>
  );
};
