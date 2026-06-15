/**
 * TierBadge Component
 *
 * Spec 2026-04-20: V3 Tier UX -- Task Group 6 (frontend)
 *
 * Renders a small coloured pill indicating the tier or the emitter of a candidate.
 *
 * Two input modes:
 * - `tier` ("A" | "B" | "C"): used for a discovery run's tier display.
 *   - A -> green (success)
 *   - B -> yellow (warning)
 *   - C -> red (danger)
 *
 * - `addedBy` ("<framework>-adapter" | "llm-gap-fill" | "llm-ir-guided" | "llm-solo" | null):
 *   used for candidate-level provenance display.
 *   - *-adapter    -> green  (success)
 *   - llm-gap-fill -> yellow (warning)
 *   - llm-ir-guided-> orange (caution)
 *   - llm-solo     -> red    (danger)
 *   - null/unknown -> grey   (neutral)
 *
 * Colours reuse existing status palette tokens already defined in
 * `DiscoveryRunDetailView.module.css` (statusCompleted / statusRunning /
 * statusFailed / statusPending) so no new colour variables are introduced.
 * A single additional caution (orange) variant is introduced for the
 * ir-guided case -- this is the ONE new token allowed by the spec.
 */

import React from 'react';
import styles from './TierBadge.module.css';

export interface TierBadgeProps {
  /** Tier value for run-level display */
  tier?: 'A' | 'B' | 'C' | null;
  /** _addedBy tag for candidate-level display */
  addedBy?: string | null;
  /** Optional short label override (defaults based on input) */
  label?: string;
  /** Test id hook */
  'data-testid'?: string;
}

type Variant = 'success' | 'warning' | 'caution' | 'danger' | 'neutral';

function tierToVariant(tier: 'A' | 'B' | 'C' | null | undefined): Variant {
  switch (tier) {
    case 'A':
      return 'success';
    case 'B':
      return 'warning';
    case 'C':
      return 'danger';
    default:
      return 'neutral';
  }
}

function addedByToVariant(addedBy: string | null | undefined): Variant {
  if (!addedBy) return 'neutral';
  if (addedBy.endsWith('-adapter')) return 'success';
  if (addedBy === 'llm-gap-fill') return 'warning';
  if (addedBy === 'llm-ir-guided') return 'caution';
  if (addedBy === 'llm-solo') return 'danger';
  return 'neutral';
}

function variantClass(variant: Variant): string {
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

function defaultLabel(props: TierBadgeProps): string {
  if (props.label) return props.label;
  if (props.tier) return `Tier ${props.tier}`;
  const addedBy = props.addedBy;
  if (!addedBy) return '—';
  if (addedBy.endsWith('-adapter')) return 'adapter';
  if (addedBy === 'llm-gap-fill') return 'gap-fill';
  if (addedBy === 'llm-ir-guided') return 'ir-guided';
  if (addedBy === 'llm-solo') return 'llm-solo';
  return addedBy;
}

export const TierBadge: React.FC<TierBadgeProps> = (props) => {
  const variant = props.tier !== undefined && props.tier !== null
    ? tierToVariant(props.tier)
    : addedByToVariant(props.addedBy);

  const className = `${styles.tierBadge} ${variantClass(variant)}`;
  const testId = props['data-testid'] ?? 'tier-badge';

  return (
    <span className={className} data-testid={testId} data-variant={variant}>
      {defaultLabel(props)}
    </span>
  );
};
