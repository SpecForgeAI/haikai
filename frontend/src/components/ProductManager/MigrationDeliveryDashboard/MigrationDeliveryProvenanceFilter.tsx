/**
 * MigrationDeliveryProvenanceFilter
 *
 * Spec: 2026-06-14 Net-new backlog items + provenance (D5) -- Task Group 4
 * (D6: provenance filter).
 *
 * A small single-select segmented control sibling to the
 * `MigrationDeliveryGradeFilter`. It chooses which provenance the hierarchy
 * tree shows:
 *
 *   - `all`        -- every story (default; no filtering applied).
 *   - `net_new`    -- only stories whose `provenance` is `net_new` (additive
 *                     work deliberately outside the like-for-like envelope).
 *   - `carry_over` -- only stories whose `provenance` is `carry_over` (the
 *                     default like-for-like marker; a null/absent wire value
 *                     is treated as `carry_over`, matching the AMS column
 *                     default).
 *
 * Mirrors the grade filter's controlled-component shape (parent owns state,
 * `onChange` owns persistence). The tree itself stays provenance-blind; the
 * dashboard intersects the chosen provenance set into the tree's
 * `filterStoryWorkItemIds` prop (the same mechanism the grade filter uses).
 */

import React from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types + helpers
// ============================================================================

/** The three mutually-exclusive provenance filter selections. */
export type ProvenanceFilterValue = 'all' | 'net_new' | 'carry_over';

export const ALL_PROVENANCE_FILTER_VALUES: ReadonlyArray<ProvenanceFilterValue> =
  ['all', 'net_new', 'carry_over'] as const;

/** The default selection: `all` (equivalent to no filter applied). */
export function defaultProvenanceFilterValue(): ProvenanceFilterValue {
  return 'all';
}

/**
 * Normalise a raw wire `provenance` to the canonical pair. Anything that is
 * not the literal `net_new` is treated as `carry_over` -- a null/absent value
 * is the AMS column default (`carry_over`), so legacy + discovered rows fall
 * on the carry_over side without a backfill.
 */
export function normaliseProvenance(
  value: string | null | undefined,
): 'net_new' | 'carry_over' {
  return value === 'net_new' ? 'net_new' : 'carry_over';
}

/**
 * Returns true when a story whose `provenance` is `value` is included by the
 * `selected` filter. `all` includes everything; otherwise the normalised
 * provenance must equal the selection.
 */
export function isProvenanceAllowedByFilter(
  value: string | null | undefined,
  selected: ProvenanceFilterValue,
): boolean {
  if (selected === 'all') return true;
  return normaliseProvenance(value) === selected;
}

// ============================================================================
// Component
// ============================================================================

export interface MigrationDeliveryProvenanceFilterProps {
  /** Controlled selection. */
  value: ProvenanceFilterValue;
  /** Invoked when a chip is selected. */
  onChange: (next: ProvenanceFilterValue) => void;
  /** Optional override of the chip group's test id. */
  testId?: string;
}

const CHIP_LABEL: Record<ProvenanceFilterValue, string> = {
  all: 'All',
  net_new: 'net_new',
  carry_over: 'carry_over',
};

export const MigrationDeliveryProvenanceFilter: React.FC<
  MigrationDeliveryProvenanceFilterProps
> = ({ value, onChange, testId = 'mdd-provenance-filter' }) => {
  return (
    <div
      className={styles.filterPanel}
      data-testid={testId}
      role="group"
      aria-label="Filter by provenance"
    >
      <span className={styles.filterFieldLabel}>Provenance</span>
      {ALL_PROVENANCE_FILTER_VALUES.map((chip) => {
        const selected = value === chip;
        return (
          <button
            key={chip}
            type="button"
            className={`${styles.badge} ${
              chip === 'net_new'
                ? styles.badgeNetNew
                : chip === 'carry_over'
                  ? styles.badgeCarryOver
                  : ''
            }`}
            data-testid={`${testId}-chip-${chip}`}
            data-selected={selected ? 'true' : 'false'}
            aria-pressed={selected}
            onClick={() => onChange(chip)}
            style={{
              opacity: selected ? 1 : 0.35,
              cursor: 'pointer',
            }}
          >
            {CHIP_LABEL[chip]}
          </button>
        );
      })}
    </div>
  );
};

export default MigrationDeliveryProvenanceFilter;
