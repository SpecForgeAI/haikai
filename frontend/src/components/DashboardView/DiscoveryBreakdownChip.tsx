/**
 * DiscoveryBreakdownChip
 *
 * Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 6.
 *
 * Replaces the single opaque "X created, Y skipped, Z committed" save-back
 * string with an HONEST breakdown by reason CLASS. Each non-zero class renders
 * as a CLICKABLE token; clicking opens the C1 remediation panel (Task Group 7)
 * scoped to that class.
 *
 * The taxonomy is derived from the {@link SaveApprovedResult} the run-detail
 * page already holds after a save (or a dry-run preview):
 *   - `reasons[]` (the per-candidate REASON ARM) is split by its `reason`
 *     CLASS, and the `reused` class is further split by `reusedSubclass`
 *     (`intra-scan` / `pre-existing` / `already-saved`) -- these THREE MUST stay
 *     distinguished, never collapsed into one "skipped".
 *   - `suppressedDuplicates[]` (exact-name auto-suppressed) and
 *     `possibleDuplicates[]` (normalized-only, reviewable) come from their own
 *     arrays on the result (they already reach the browser).
 *
 * The chip ALSO keeps the legacy `entitiesCreated / entitiesSkipped /
 * candidatesCommitted (+ belowGateCount)` sentence available (rendered as a
 * sr-friendly summary line carrying the SAME `data-testid="save-approved-success"`
 * the pre-existing outcome-line tests assert on) so the chip is a strict superset
 * of the prior behaviour.
 *
 * Accessibility: the breakdown is a labelled group of tokens; each clickable
 * token is a real <button> with an aria-label naming the class + count, and the
 * intra-scan advisory is a `role="note"`.
 */

import React, { useMemo } from 'react';
import type { SaveApprovedResult } from '../../api/discoveryApi';
import styles from './DiscoveryRunDetailView.module.css';

// ============================================================================
// Reason-class taxonomy
// ============================================================================

/**
 * The breakdown classes the chip surfaces (and the C1 panel can be scoped to).
 * `intra-scan` / `pre-existing` / `already-saved` are the three distinguished
 * sub-classes of `reused`; `suppressed` / `possible` come from the dup arrays;
 * `blocked` / `quality_gap` are the actionable (remediable) classes.
 */
export type DiscoveryBreakdownClass =
  | 'created'
  | 'intra-scan'
  | 'pre-existing'
  | 'already-saved'
  | 'suppressed'
  | 'possible'
  | 'blocked'
  | 'quality_gap';

/** Human label for each breakdown class (the token text). */
const CLASS_LABEL: Record<DiscoveryBreakdownClass, string> = {
  created: 'Created',
  'intra-scan': 'Intra-scan duplicate',
  'pre-existing': 'Pre-existing',
  'already-saved': 'Already saved',
  suppressed: 'Suppressed duplicate',
  possible: 'Possible duplicate',
  blocked: 'Blocked',
  quality_gap: 'Quality gap',
};

/**
 * Render order for the tokens (mirrors the spec's enumeration: Created ->
 * the three reuse sub-classes -> the two dup arrays -> the two actionable
 * classes).
 */
const CLASS_ORDER: DiscoveryBreakdownClass[] = [
  'created',
  'intra-scan',
  'pre-existing',
  'already-saved',
  'suppressed',
  'possible',
  'blocked',
  'quality_gap',
];

/**
 * The two ACTIONABLE classes the C1 remediation panel can fix in bulk. (The
 * `business_logics` name-collision fallback group the panel also offers is a
 * facet of these, surfaced from the arm rather than a top-level token.)
 */
const ACTIONABLE_CLASSES: ReadonlySet<DiscoveryBreakdownClass> = new Set<DiscoveryBreakdownClass>([
  'blocked',
  'quality_gap',
]);

export interface DiscoveryBreakdownCounts {
  created: number;
  'intra-scan': number;
  'pre-existing': number;
  'already-saved': number;
  suppressed: number;
  possible: number;
  blocked: number;
  quality_gap: number;
}

/**
 * Pure: fold a {@link SaveApprovedResult} into the per-class breakdown counts.
 * Exported so the page (and tests) can reuse the exact same derivation.
 *
 * - `reasons[]` -> split by `reason`; `reused` -> split by `reusedSubclass`
 *   (an unknown / missing subclass is bucketed under `pre-existing` as the
 *   conservative "already existed" default so it is never dropped).
 * - `suppressedDuplicates[]` -> `suppressed`; `possibleDuplicates[]` ->
 *   `possible` (the arrays are the source of truth for those two; if the arm
 *   ALSO carries `suppressed` / `possible` entries we take the max so a count
 *   is never double-added nor lost).
 */
export function computeBreakdownCounts(
  result: SaveApprovedResult,
): DiscoveryBreakdownCounts {
  const counts: DiscoveryBreakdownCounts = {
    created: 0,
    'intra-scan': 0,
    'pre-existing': 0,
    'already-saved': 0,
    suppressed: 0,
    possible: 0,
    blocked: 0,
    quality_gap: 0,
  };

  let armSuppressed = 0;
  let armPossible = 0;

  for (const entry of result.reasons ?? []) {
    switch (entry.reason) {
      case 'created':
        counts.created += 1;
        break;
      case 'reused': {
        const sub = entry.reusedSubclass;
        if (sub === 'intra-scan') counts['intra-scan'] += 1;
        else if (sub === 'already-saved') counts['already-saved'] += 1;
        else counts['pre-existing'] += 1; // pre-existing OR unknown subclass
        break;
      }
      case 'suppressed':
        armSuppressed += 1;
        break;
      case 'possible':
        armPossible += 1;
        break;
      case 'blocked':
        counts.blocked += 1;
        break;
      case 'quality_gap':
        counts.quality_gap += 1;
        break;
      default:
        // Unknown / future class -- ignore for the typed breakdown (the wide
        // union keeps it parseable; it simply doesn't get a token).
        break;
    }
  }

  // The dup ARRAYS are the canonical source for these two classes. Take the
  // max of (array length, arm count) so neither path double-adds nor drops.
  counts.suppressed = Math.max(armSuppressed, result.suppressedDuplicates?.length ?? 0);
  counts.possible = Math.max(armPossible, result.possibleDuplicates?.length ?? 0);

  return counts;
}

// ============================================================================
// Component
// ============================================================================

export interface DiscoveryBreakdownChipProps {
  /** The save-back outcome (or dry-run preview) to break down. */
  result: SaveApprovedResult;
  /**
   * Opens the C1 remediation panel scoped to the clicked class. Only the
   * ACTIONABLE classes (blocked / quality_gap) actually open the panel; the
   * informational classes render as non-clickable badges.
   */
  onOpenClass?: (cls: DiscoveryBreakdownClass) => void;
}

/**
 * Build the legacy summary sentence (kept for back-compat + the screen-reader
 * line). Mirrors the string the page rendered before the chip existed.
 */
function legacySummary(result: SaveApprovedResult): string {
  const belowGateCount = result.belowGateCount ?? 0;
  const belowGateSuffix =
    belowGateCount > 0 ? `, ${belowGateCount} below auto-accept (reviewable)` : '';
  return `Saved: ${result.entitiesCreated} created, ${result.entitiesSkipped} skipped, ${result.candidatesCommitted} committed${belowGateSuffix}`;
}

export const DiscoveryBreakdownChip: React.FC<DiscoveryBreakdownChipProps> = ({
  result,
  onOpenClass,
}) => {
  const counts = useMemo(() => computeBreakdownCounts(result), [result]);
  const intraScanCount = counts['intra-scan'];

  return (
    <div
      className={styles.saveApprovedSuccess}
      data-testid="save-approved-success"
    >
      {/* Legacy summary sentence -- preserves the prior outcome-line text so
          existing assertions (created / skipped / committed / below-gate) and
          screen readers still get the headline counts. */}
      <span data-testid="save-back-summary-line">{legacySummary(result)}</span>

      {/* Honest per-class breakdown -- clickable tokens for the actionable
          classes, badges for the informational ones. */}
      <div
        className={styles.breakdownTokenRow}
        role="group"
        aria-label="Save-back outcome by reason class"
        data-testid="save-back-breakdown"
      >
        {CLASS_ORDER.map((cls) => {
          const count = counts[cls];
          if (count <= 0) return null;
          const label = CLASS_LABEL[cls];
          const actionable = ACTIONABLE_CLASSES.has(cls) && Boolean(onOpenClass);
          if (actionable) {
            return (
              <button
                key={cls}
                type="button"
                className={styles.breakdownTokenButton}
                onClick={() => onOpenClass?.(cls)}
                aria-label={`${label}: ${count}. Open remediation panel.`}
                data-testid={`save-back-breakdown-token-${cls}`}
                data-breakdown-class={cls}
              >
                {label} <span className={styles.breakdownTokenCount}>{count}</span>
              </button>
            );
          }
          return (
            <span
              key={cls}
              className={styles.breakdownTokenBadge}
              data-testid={`save-back-breakdown-token-${cls}`}
              data-breakdown-class={cls}
            >
              {label} <span className={styles.breakdownTokenCount}>{count}</span>
            </span>
          );
        })}
      </div>

      {/* Intra-scan-duplicate ADVISORY (Q8). Advisory only -- not acted on. */}
      {intraScanCount > 0 && (
        <div
          className={styles.breakdownAdvisory}
          role="note"
          data-testid="save-back-intra-scan-advisory"
        >
          {intraScanCount} intra-scan duplicate{intraScanCount === 1 ? '' : 's'} -- these
          are a second candidate in this same save matching an entity an earlier
          candidate just created (counted as both skipped and committed). Mostly
          benign; possible upstream dedup gap -- qualifying{' '}
          <code>business_logics</code> names is the targeted remediation for the
          largest share.
        </div>
      )}
    </div>
  );
};

export default DiscoveryBreakdownChip;
