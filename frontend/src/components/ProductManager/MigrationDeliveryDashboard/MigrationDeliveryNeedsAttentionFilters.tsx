/**
 * MigrationDeliveryNeedsAttentionFilters
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 10 -- Needs-attention panel + filters + Addition A buttons.
 *
 * Renders the two filter dimensions that scope the needs-attention panel:
 *
 *   1. Workstream selector (populated from the dashboard's
 *      `workstreamSummaries[]` so the dropdown only ever surfaces
 *      workstreams that actually exist in the current book).
 *   2. Needs-attention type multi-select (failed / insufficient_context /
 *      blocked / not_saved_to_backlog / generated_with_warnings).
 *
 * Filter state is owned by the parent panel (`MigrationDeliveryNeedsAttentionPanel`);
 * this component is intentionally controlled. The panel applies the filter
 * values to the `needsAttention[]` list and forwards filtered ids to the
 * Addition A bulk-regenerate buttons.
 *
 * Precedent: `MigrationShapeSpecGeneration/SpecGenerationFilters.tsx`.
 */

import React from 'react';
import type {
  MigrationDeliveryNeedsAttentionItemDto,
  MigrationDeliveryWorkstreamSummaryDto,
} from '../../../api/migrationDeliveryDashboardApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Filter state shape (re-exported for the parent panel)
// ============================================================================

/**
 * The five `type` values the AMS service emits on
 * `needsAttention[].type`. Pinned here so the filter dropdown stays in
 * lock-step with the AMS contract; if AMS adds a new type the dropdown will
 * surface it as a generic option via the union with `string`.
 */
export type NeedsAttentionType =
  | 'failed'
  | 'insufficient_context'
  | 'blocked'
  | 'not_saved_to_backlog'
  | 'generated_with_warnings'
  | 'stale';

export interface NeedsAttentionFilterState {
  /** Workstream key (matches `MigrationDeliveryNeedsAttentionItemDto.workstream`). */
  workstream: string | 'all';
  /** Needs-attention type filter; `all` means all five types. */
  type: NeedsAttentionType | 'all';
}

export const EMPTY_NEEDS_ATTENTION_FILTER_STATE: NeedsAttentionFilterState = {
  workstream: 'all',
  type: 'all',
};

// ============================================================================
// Row filtering helper (exposed for the parent panel + bulk-regen ids)
// ============================================================================

/**
 * Apply the current filter state to a needs-attention row list. A filter
 * value of `'all'` means "do not filter on this dimension".
 *
 * Used by:
 *   - The parent panel to compute visible rows.
 *   - The Addition A bulk-regenerate buttons to compute the
 *     `targetWorkItemIds` whitelist (matching spec.md Q-4: hierarchy tree
 *     expansion is IGNORED; only these panel filters scope the action).
 */
export function applyNeedsAttentionFilters(
  rows: ReadonlyArray<MigrationDeliveryNeedsAttentionItemDto>,
  filters: NeedsAttentionFilterState,
): MigrationDeliveryNeedsAttentionItemDto[] {
  return rows.filter((row) => {
    if (
      filters.workstream !== 'all' &&
      (row.workstream ?? null) !== filters.workstream
    ) {
      return false;
    }
    if (filters.type !== 'all' && row.type !== filters.type) {
      return false;
    }
    return true;
  });
}

// ============================================================================
// Component
// ============================================================================

export interface MigrationDeliveryNeedsAttentionFiltersProps {
  /** Workstream options derived from the dashboard. */
  workstreamSummaries: ReadonlyArray<MigrationDeliveryWorkstreamSummaryDto>;
  /** Controlled filter state. */
  value: NeedsAttentionFilterState;
  /** Invoked when any filter is changed. */
  onChange: (next: NeedsAttentionFilterState) => void;
}

export const MigrationDeliveryNeedsAttentionFilters: React.FC<
  MigrationDeliveryNeedsAttentionFiltersProps
> = ({ workstreamSummaries, value, onChange }) => {
  function update<K extends keyof NeedsAttentionFilterState>(
    key: K,
    next: NeedsAttentionFilterState[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div
      className={styles.filterPanel}
      data-testid="mdd-needs-attention-filters"
      role="region"
      aria-label="Filter needs-attention rows"
    >
      <label className={styles.filterField}>
        <span className={styles.filterFieldLabel}>Workstream</span>
        <select
          className={styles.filterSelect}
          data-testid="mdd-needs-attention-filter-workstream"
          value={value.workstream}
          onChange={(e) => update('workstream', e.target.value)}
        >
          <option value="all">All workstreams</option>
          {workstreamSummaries.map((ws) => (
            <option key={ws.workstream} value={ws.workstream}>
              {ws.workstream}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.filterField}>
        <span className={styles.filterFieldLabel}>Type</span>
        <select
          className={styles.filterSelect}
          data-testid="mdd-needs-attention-filter-type"
          value={value.type}
          onChange={(e) =>
            update('type', e.target.value as NeedsAttentionFilterState['type'])
          }
        >
          <option value="all">All types</option>
          <option value="failed">Failed</option>
          <option value="insufficient_context">Insufficient context</option>
          <option value="blocked">Blocked</option>
          <option value="not_saved_to_backlog">Not saved to backlog</option>
          <option value="generated_with_warnings">
            Generated with warnings
          </option>
          <option value="stale">Stale (target arch changed)</option>
        </select>
      </label>

      <button
        type="button"
        className={styles.filterResetButton}
        data-testid="mdd-needs-attention-filter-reset"
        onClick={() => onChange(EMPTY_NEEDS_ATTENTION_FILTER_STATE)}
      >
        Reset
      </button>
    </div>
  );
};

export default MigrationDeliveryNeedsAttentionFilters;
