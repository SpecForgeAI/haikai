/**
 * Deterministic condition-colour thresholds for the stakeholder progress
 * report (2026-08-16). Pure functions — no I/O — so every boundary is unit
 * testable.
 *
 * Two scales, both evaluated TOP-DOWN with the agreed `>=` boundary
 * convention (exactly 5% -> light orange, exactly 95% -> light green, etc.):
 *
 *  - UNDESIRED counts (failed to load, mismatches, not-migrated, failed
 *    reconciliation …): the desired number is ZERO, so there is deliberately
 *    no light-green tier — any nonzero value is at least yellow.
 *  - FULLY-RECONCILED counts: the inverse ladder, medium green only at 100%.
 *
 * The Matching? cells are binary: medium green on true, medium red on false.
 */

export type ConditionTier =
  | 'medium-green'
  | 'light-green'
  | 'yellow'
  | 'light-orange'
  | 'medium-orange'
  | 'medium-red';

/**
 * Tier for a cell whose DESIRED value is zero. `total` is the current-state
 * denominator (tables / endpoints / views / procs). When the denominator is
 * unknown or zero the percentage is incomputable: zero stays medium green,
 * any nonzero count is medium red (an undesired count we cannot even scale).
 */
export function undesiredTier(value: number, total: number | null): ConditionTier {
  if (value === 0) return 'medium-green';
  if (total === null || total <= 0) return 'medium-red';
  const pct = (value / total) * 100;
  if (pct < 5) return 'yellow';
  if (pct < 15) return 'light-orange';
  if (pct < 30) return 'medium-orange';
  return 'medium-red';
}

/**
 * Tier for the Fully-reconciled cell. 100% is medium green; a zero/unknown
 * denominator is vacuously complete (nothing needed reconciling).
 */
export function reconciledTier(value: number, total: number | null): ConditionTier {
  if (total === null || total <= 0) return 'medium-green';
  const pct = (value / total) * 100;
  if (pct >= 100) return 'medium-green';
  if (pct >= 95) return 'light-green';
  if (pct >= 85) return 'yellow';
  if (pct >= 75) return 'light-orange';
  if (pct >= 50) return 'medium-orange';
  return 'medium-red';
}

/** Matching? cell: medium green on true, medium red on false. */
export function matchingTier(matching: boolean): ConditionTier {
  return matching ? 'medium-green' : 'medium-red';
}

/** `2 (1.7%)` — the inline percentage shown beside each bucket number. */
export function formatCountWithPct(value: number, total: number | null): string {
  if (total === null || total <= 0) return String(value);
  const pct = (value / total) * 100;
  const rounded = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  return `${value.toLocaleString()} (${rounded}%)`;
}
