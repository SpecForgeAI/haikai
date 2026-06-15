/**
 * MigrationDeliveryGradeFilter
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 8.2.
 *
 * Multi-select chip group (A / B / C / D / F / N/A) wired into the dashboard
 * filter strip. The hierarchy tree is pruned to story nodes whose
 * `qualityGrade` is in the selected set. The N/A chip filters in stories
 * whose `qualityGrade` is null (no spec row OR `insufficient_context` /
 * `failed` rows persist nulls per spec.md).
 *
 * Default state is all-selected (equivalent to no filter applied).
 *
 * Mirrors the `MigrationDeliveryNeedsAttentionFilters` pattern (controlled
 * component, `onChange` callback owns persistence, parent owns state).
 */

import React from 'react';
import { qualityGradeBadgeClass, type QualityGrade } from './QualityGradeChip';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types
// ============================================================================

/**
 * The six values the chip group exposes. `na` represents "no grade" -- a
 * story whose `qualityGrade` is null. Kept distinct from the letter grades
 * because the filter must treat it as a first-class selectable option.
 */
export type GradeFilterValue = QualityGrade | 'na';

export const ALL_GRADE_FILTER_VALUES: ReadonlyArray<GradeFilterValue> = [
  'A',
  'B',
  'C',
  'D',
  'F',
  'na',
] as const;

/**
 * Build the default filter state: every grade selected, so the filter is
 * equivalent to no filter applied (hierarchy renders unchanged).
 */
export function defaultGradeFilterState(): Set<GradeFilterValue> {
  return new Set<GradeFilterValue>(ALL_GRADE_FILTER_VALUES);
}

// ============================================================================
// Pure helper -- decide whether a node's qualityGrade is included in the set
// ============================================================================

/**
 * Returns true when the story's `qualityGrade` is in the selected set.
 * Null grades match the 'na' option; values outside {A,B,C,D,F} are treated
 * as null (matches the `coerceGrade` policy in the hierarchy tree).
 */
export function isGradeAllowedByFilter(
  qualityGrade: string | null | undefined,
  selected: ReadonlySet<GradeFilterValue>,
): boolean {
  if (
    qualityGrade === 'A' ||
    qualityGrade === 'B' ||
    qualityGrade === 'C' ||
    qualityGrade === 'D' ||
    qualityGrade === 'F'
  ) {
    return selected.has(qualityGrade);
  }
  return selected.has('na');
}

// ============================================================================
// Component
// ============================================================================

export interface MigrationDeliveryGradeFilterProps {
  /** Controlled selection set. */
  value: ReadonlySet<GradeFilterValue>;
  /** Invoked when any chip is toggled. */
  onChange: (next: Set<GradeFilterValue>) => void;
  /** Optional override of the chip group's test id. */
  testId?: string;
}

const CHIP_LABEL: Record<GradeFilterValue, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  F: 'F',
  na: 'N/A',
};

export const MigrationDeliveryGradeFilter: React.FC<
  MigrationDeliveryGradeFilterProps
> = ({ value, onChange, testId = 'mdd-grade-filter' }) => {
  const toggle = (chip: GradeFilterValue) => {
    const next = new Set(value);
    if (next.has(chip)) {
      next.delete(chip);
    } else {
      next.add(chip);
    }
    onChange(next);
  };

  return (
    <div
      className={styles.filterPanel}
      data-testid={testId}
      role="group"
      aria-label="Filter by quality grade"
    >
      <span className={styles.filterFieldLabel}>Quality grade</span>
      {ALL_GRADE_FILTER_VALUES.map((chip) => {
        const selected = value.has(chip);
        // 'na' maps to the muted N/A class; letter chips map to their ramp.
        const gradeForClass: QualityGrade | null = chip === 'na' ? null : chip;
        return (
          <button
            key={chip}
            type="button"
            className={`${styles.badge} ${qualityGradeBadgeClass(gradeForClass)}`}
            data-testid={`${testId}-chip-${chip}`}
            data-selected={selected ? 'true' : 'false'}
            aria-pressed={selected}
            onClick={() => toggle(chip)}
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

export default MigrationDeliveryGradeFilter;
