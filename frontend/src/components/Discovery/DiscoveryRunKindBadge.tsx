/**
 * DiscoveryRunKindBadge
 *
 * Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Group 5
 *
 * Small inline badge rendered alongside each run in the Discovery run list
 * to surface the run's source kind: `code` (existing), `database` (new), or
 * `combined` (future). Keeps the visual treatment subtle so existing
 * code-run rows do not visually shift -- the badge for `code` runs is a
 * neutral pill identical in size to the new `database` pill.
 *
 * Rendering rule:
 *   - When `kind` is undefined / null / empty -> render nothing (the legacy
 *     pre-Group-1 fixtures omit the field; we do not want a "code" badge to
 *     appear in their place because the field was not provided).
 *   - When `kind === 'code'` -> render a neutral grey pill labelled "CODE".
 *   - When `kind === 'database'` -> render a blue-accent pill labelled "DB".
 *   - When `kind === 'combined'` -> render a teal-accent pill labelled
 *     "MIXED".
 *   - For any other (unknown) string -> render the uppercased string as a
 *     neutral pill (defensive forwards compat).
 *
 * The component is presentational; the parent decides whether to render it.
 */

import React from 'react';
import styles from './DiscoveryRunKindBadge.module.css';

export interface DiscoveryRunKindBadgeProps {
  /**
   * The run's `discovery_kind` field from the AMS DTO. Tolerant of
   * undefined / null so callers can pass it directly without a guard.
   */
  kind?: string | null;
  /** Optional override for the testid (defaults to `run-list-kind-badge`). */
  testId?: string;
}

interface KindStyle {
  label: string;
  className: string;
}

function styleFor(kind: string): KindStyle {
  switch (kind) {
    case 'code':
      return { label: 'CODE', className: styles.kindCode };
    case 'database':
      return { label: 'DB', className: styles.kindDatabase };
    case 'combined':
      return { label: 'MIXED', className: styles.kindCombined };
    default:
      // Defensive: unknown kinds render as the uppercased raw string in
      // the neutral style. This keeps the UI legible if the backend ever
      // adds a kind ahead of the frontend.
      return { label: kind.toUpperCase(), className: styles.kindUnknown };
  }
}

export const DiscoveryRunKindBadge: React.FC<DiscoveryRunKindBadgeProps> = ({
  kind,
  testId = 'run-list-kind-badge',
}) => {
  if (!kind || typeof kind !== 'string' || kind.trim() === '') return null;
  const { label, className } = styleFor(kind);
  return (
    <span
      className={`${styles.badge} ${className}`}
      data-testid={testId}
      data-kind={kind}
    >
      {label}
    </span>
  );
};

export default DiscoveryRunKindBadge;
