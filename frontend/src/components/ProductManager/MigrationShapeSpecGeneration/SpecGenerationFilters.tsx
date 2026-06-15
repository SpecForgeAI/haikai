/**
 * SpecGenerationFilters
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 11 - Filter panel.
 *
 * Renders the five filter dimensions described in spec.md UI surface 4:
 *
 *   1. By actual status (generated / generated_with_warnings /
 *      insufficient_context / failed / skipped_blocked).
 *   2. By confidence (high / medium / low).
 *   3. By predicted readiness (Spec 1 prediction snapshot:
 *      ready_for_spec / needs_focused_context / needs_user_decision / blocked).
 *   4. By workstream.
 *   5. By parent epic / feature.
 *
 * Filter state is owned by the parent workspace shell
 * (`SpecGenerationWorkspace`); this component is intentionally controlled.
 * The workspace applies the filter values to the row list before passing
 * the filtered rows to `BatchResultsTable`.
 *
 * The workstream + parent-title dropdown options are derived from the rows
 * currently in scope (the union of values present in the rows array) so the
 * filter does not surface options that do not match anything.
 */

import React, { useMemo } from 'react';
import type {
  SpecGenerationRow,
  SpecGenerationStatus,
  SpecGenerationConfidence,
  SpecGenerationPredictedReadiness,
} from '../../../api/specGenerationApi';
import styles from './MigrationShapeSpecGeneration.module.css';

// ============================================================================
// Filter-state shape (re-exported for the workspace shell)
// ============================================================================

export interface SpecGenerationFilterState {
  status: SpecGenerationStatus | 'all';
  confidence: SpecGenerationConfidence | 'all';
  predictedReadiness: SpecGenerationPredictedReadiness | 'all';
  workstream: string | 'all';
  parent: string | 'all';
}

export const EMPTY_FILTER_STATE: SpecGenerationFilterState = {
  status: 'all',
  confidence: 'all',
  predictedReadiness: 'all',
  workstream: 'all',
  parent: 'all',
};

// ============================================================================
// Row filtering helper (exposed for the workspace shell)
// ============================================================================

/**
 * Apply the current filter state to a row list. A filter value of `'all'`
 * means "do not filter on this dimension".
 */
export function applySpecGenerationFilters(
  rows: ReadonlyArray<SpecGenerationRow>,
  filters: SpecGenerationFilterState,
): SpecGenerationRow[] {
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (
      filters.confidence !== 'all' &&
      (row.confidence ?? null) !== filters.confidence
    )
      return false;
    if (
      filters.predictedReadiness !== 'all' &&
      (row.predictedReadiness ?? null) !== filters.predictedReadiness
    )
      return false;
    if (
      filters.workstream !== 'all' &&
      (row.workstream ?? null) !== filters.workstream
    )
      return false;
    if (
      filters.parent !== 'all' &&
      (row.parentTitle ?? null) !== filters.parent
    )
      return false;
    return true;
  });
}

// ============================================================================
// Component
// ============================================================================

export interface SpecGenerationFiltersProps {
  /** Latest set of rows in scope - used to derive workstream/parent options. */
  rows: ReadonlyArray<SpecGenerationRow>;
  /** Controlled filter state. */
  value: SpecGenerationFilterState;
  /** Invoked when any filter is changed. */
  onChange: (next: SpecGenerationFilterState) => void;
}

export function SpecGenerationFilters({
  rows,
  value,
  onChange,
}: SpecGenerationFiltersProps) {
  // Derive workstream + parent options from the rows that are currently in
  // scope so the filter UI does not surface options that match nothing.
  const workstreamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.workstream) set.add(row.workstream);
    }
    return Array.from(set).sort();
  }, [rows]);

  const parentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.parentTitle) set.add(row.parentTitle);
    }
    return Array.from(set).sort();
  }, [rows]);

  function update<K extends keyof SpecGenerationFilterState>(
    key: K,
    next: SpecGenerationFilterState[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div
      className={styles.filterPanel}
      data-testid="msg-workspace-filter-panel"
      role="region"
      aria-label="Filter generated spec results"
    >
      <h3 className={styles.filterPanelTitle}>Filters</h3>

      <div className={styles.filterRow}>
        {/* Actual status */}
        <label className={styles.filterField}>
          <span className={styles.filterFieldLabel}>Actual status</span>
          <select
            className={styles.filterSelect}
            data-testid="msg-filter-status"
            value={value.status}
            onChange={(e) =>
              update(
                'status',
                e.target.value as SpecGenerationFilterState['status'],
              )
            }
          >
            <option value="all">All</option>
            <option value="generated">Generated</option>
            <option value="generated_with_warnings">
              Generated with warnings
            </option>
            <option value="insufficient_context">Insufficient context</option>
            <option value="failed">Failed</option>
            <option value="skipped_blocked">Skipped (blocked)</option>
          </select>
        </label>

        {/* Confidence */}
        <label className={styles.filterField}>
          <span className={styles.filterFieldLabel}>Confidence</span>
          <select
            className={styles.filterSelect}
            data-testid="msg-filter-confidence"
            value={value.confidence}
            onChange={(e) =>
              update(
                'confidence',
                e.target.value as SpecGenerationFilterState['confidence'],
              )
            }
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>

        {/* Predicted readiness */}
        <label className={styles.filterField}>
          <span className={styles.filterFieldLabel}>Predicted readiness</span>
          <select
            className={styles.filterSelect}
            data-testid="msg-filter-predicted-readiness"
            value={value.predictedReadiness}
            onChange={(e) =>
              update(
                'predictedReadiness',
                e.target
                  .value as SpecGenerationFilterState['predictedReadiness'],
              )
            }
          >
            <option value="all">All</option>
            <option value="ready_for_spec">Ready for spec</option>
            <option value="needs_focused_context">
              Needs focused context
            </option>
            <option value="needs_user_decision">Needs user decision</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>

        {/* Workstream */}
        <label className={styles.filterField}>
          <span className={styles.filterFieldLabel}>Workstream</span>
          <select
            className={styles.filterSelect}
            data-testid="msg-filter-workstream"
            value={value.workstream}
            onChange={(e) => update('workstream', e.target.value)}
          >
            <option value="all">All</option>
            {workstreamOptions.map((ws) => (
              <option key={ws} value={ws}>
                {ws}
              </option>
            ))}
          </select>
        </label>

        {/* Parent epic / feature */}
        <label className={styles.filterField}>
          <span className={styles.filterFieldLabel}>Parent epic / feature</span>
          <select
            className={styles.filterSelect}
            data-testid="msg-filter-parent"
            value={value.parent}
            onChange={(e) => update('parent', e.target.value)}
          >
            <option value="all">All</option>
            {parentOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {/* Reset */}
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary}`}
          data-testid="msg-filter-reset"
          onClick={() => onChange(EMPTY_FILTER_STATE)}
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}

export default SpecGenerationFilters;
