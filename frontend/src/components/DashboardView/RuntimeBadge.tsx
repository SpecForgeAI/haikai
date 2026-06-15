/**
 * RuntimeBadge Component
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 1.3.
 *
 * Pure presentational pill component used as a sibling of TierBadge in the
 * candidate table's Tier <td>. The component knows nothing about candidates
 * or runtime context -- callers (the candidate table) compute the label and
 * variant via `runtimeBadgeHelpers.getRuntimeBadgeFor` and pass the result
 * down as props.
 *
 * Visual contract:
 *  - Mirrors TierBadge's render shape: a small pill <span> with a
 *    variant-token CSS class.
 *  - Reuses the EXISTING `TierBadge.module.css` variant tokens
 *    (`success` / `warning` / `caution` / `danger` / `neutral`). NO new
 *    CSS module file is added by Spec 7 (per spec).
 *
 * Defensive guard:
 *  - When `label` is missing or whitespace, renders nothing. The candidate
 *    table never invokes the badge with an empty label (the helper returns
 *    null in that case), but the guard keeps the component side-effect-free
 *    against future callers.
 */

import React from 'react';
import styles from './TierBadge.module.css';

export type RuntimeBadgeVariant = 'success' | 'warning' | 'caution' | 'danger' | 'neutral';

export interface RuntimeBadgeProps {
  /** Visible label text (e.g. "Observed 1.8k", "High usage", "Elevated errors"). */
  label: string;
  /** Variant token mapped to one of the TierBadge palette classes. */
  variant: RuntimeBadgeVariant;
  /** Optional test id hook; defaults to `runtime-badge`. */
  'data-testid'?: string;
}

function variantClass(variant: RuntimeBadgeVariant): string {
  switch (variant) {
    case 'success':
      return styles.tierBadgeSuccess;
    case 'warning':
      return styles.tierBadgeWarning;
    case 'caution':
      return styles.tierBadgeCaution;
    case 'danger':
      return styles.tierBadgeDanger;
    case 'neutral':
    default:
      return styles.tierBadgeNeutral;
  }
}

export const RuntimeBadge: React.FC<RuntimeBadgeProps> = (props) => {
  const label = props.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    return null;
  }

  const className = `${styles.tierBadge} ${variantClass(props.variant)}`;
  const testId = props['data-testid'] ?? 'runtime-badge';

  return (
    <span className={className} data-testid={testId} data-variant={props.variant}>
      {label}
    </span>
  );
};
