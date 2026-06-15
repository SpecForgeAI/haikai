/**
 * QualityGradeChip
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 6.
 *
 * Renders the per-story grade chip on the hierarchy tree (and reused inside
 * the drawer composite-score row).
 *
 * Visual rules per spec.md "Frontend grade chip on hierarchy node":
 *   - Colour ramp parallels the existing confidence-pill ramp:
 *     A green, B teal/light-green, C amber, D orange, F red,
 *     null/N/A muted "--".
 *   - Hover tooltip surfaces numeric `qualityScore` AND a brief per-dimension
 *     breakdown when `qualityDimensions` is provided.
 *   - Disagreement badge: small superscript "!" rendered when:
 *       (LLM confidence = 'high' AND grade in {C, D, F}) OR
 *       (LLM confidence = 'low'  AND grade in {A, B})
 *     Tooltip names the direction.
 *
 * Helper `qualityGradeBadgeClass(...)` clones the `confidenceBadgeClass(...)`
 * pattern already established in `MigrationDeliveryHierarchyTree.tsx`. It is
 * exported so other surfaces (drawer composite-score row, future status
 * panels) can reuse the same colour-class mapping without duplicating the
 * switch.
 */

import React from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types + helpers
// ============================================================================

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type LlmConfidence = 'high' | 'medium' | 'low';

export interface QualityDimensionEntry {
  name: string;
  score: number;
  reason: string;
}

/**
 * Maps a grade letter (or null) to a CSS class on the existing dashboard
 * module.css. Mirrors `confidenceBadgeClass(...)` in
 * `MigrationDeliveryHierarchyTree.tsx`.
 */
export function qualityGradeBadgeClass(grade: QualityGrade | null): string {
  switch (grade) {
    case 'A':
      return styles.badgeQualityA;
    case 'B':
      return styles.badgeQualityB;
    case 'C':
      return styles.badgeQualityC;
    case 'D':
      return styles.badgeQualityD;
    case 'F':
      return styles.badgeQualityF;
    default:
      return styles.badgeQualityNa;
  }
}

/**
 * Pure helper -- returns the disagreement direction string if a disagreement
 * exists between the LLM confidence and the deterministic grade. The two
 * directions per spec.md are:
 *   - 'high-confidence-low-grade' when confidence='high' AND grade in {C, D, F}
 *   - 'low-confidence-high-grade' when confidence='low'  AND grade in {A, B}
 *
 * Returns null when no disagreement is present (covers all other combinations
 * including medium confidence and null inputs).
 */
export function deriveDisagreementDirection(
  grade: QualityGrade | null,
  confidence: LlmConfidence | null,
): 'high-confidence-low-grade' | 'low-confidence-high-grade' | null {
  if (!grade || !confidence) return null;
  if (confidence === 'high' && (grade === 'C' || grade === 'D' || grade === 'F')) {
    return 'high-confidence-low-grade';
  }
  if (confidence === 'low' && (grade === 'A' || grade === 'B')) {
    return 'low-confidence-high-grade';
  }
  return null;
}

function disagreementTooltipText(
  grade: QualityGrade,
  direction: 'high-confidence-low-grade' | 'low-confidence-high-grade',
): string {
  if (direction === 'high-confidence-low-grade') {
    return `LLM reports high confidence but rules grade is ${grade}`;
  }
  return `LLM reports low confidence but rules grade is ${grade}`;
}

// ============================================================================
// Component
// ============================================================================

export interface QualityGradeChipProps {
  /**
   * Letter grade or null. Null renders the muted "--" N/A chip (used for
   * stories with no spec row OR insufficient_context/failed rows that
   * intentionally store nulls per spec.md).
   */
  qualityGrade: QualityGrade | null;
  /** Composite numeric score [0..100] or null. Surfaced in the tooltip. */
  qualityScore?: number | null;
  /**
   * Optional per-dimension breakdown surfaced in the tooltip. When supplied,
   * each dimension renders one tooltip line (`name: score`).
   */
  qualityDimensions?: QualityDimensionEntry[] | null;
  /**
   * Spec-generation confidence; drives the disagreement badge per spec.md.
   * Null means "no confidence signal" -- no disagreement badge ever appears.
   */
  llmConfidence?: LlmConfidence | null;
  /** Compact variant used in dense tree rows. */
  compact?: boolean;
  /** Optional test id override. */
  testId?: string;
}

export const QualityGradeChip: React.FC<QualityGradeChipProps> = ({
  qualityGrade,
  qualityScore = null,
  qualityDimensions = null,
  llmConfidence = null,
  compact = false,
  testId = 'mdd-quality-grade-chip',
}) => {
  // Display label inside the chip body.
  const label = qualityGrade ?? '--';
  const tooltipBase =
    qualityGrade != null && qualityScore != null
      ? `${qualityGrade} (${qualityScore}/100)`
      : qualityGrade != null
        ? `${qualityGrade}`
        : 'No quality score';

  const tooltipDimensions =
    qualityDimensions && qualityDimensions.length > 0
      ? qualityDimensions
          .map((d) => `${d.name}: ${d.score}`)
          .join(' | ')
      : '';

  const tooltip = tooltipDimensions
    ? `${tooltipBase} -- ${tooltipDimensions}`
    : tooltipBase;

  const disagreement = deriveDisagreementDirection(qualityGrade, llmConfidence);

  // Build class list.
  const classes = [
    styles.badge,
    qualityGradeBadgeClass(qualityGrade),
    compact ? styles.badgeQualityCompact : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={styles.badgeQualityWrapper}
      data-testid={`${testId}-wrapper`}
    >
      <span
        className={classes}
        data-testid={testId}
        data-grade={qualityGrade ?? 'na'}
        title={tooltip}
      >
        {label}
      </span>
      {disagreement && qualityGrade && (
        <span
          className={styles.badgeQualityDisagreementDot}
          data-testid={`${testId}-disagreement`}
          data-direction={disagreement}
          title={disagreementTooltipText(qualityGrade, disagreement)}
          aria-label={disagreementTooltipText(qualityGrade, disagreement)}
        >
          !
        </span>
      )}
    </span>
  );
};

export default QualityGradeChip;
