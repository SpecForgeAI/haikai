/**
 * DiscoveryMethodChip Component
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2),
 * Task Group 3 (W-10 -- `discovery_method` trace metadata).
 *
 * Renders a small "discovered-via" pill next to an endpoint / interface
 * candidate's display name in the candidate-review grid so the reviewer
 * can calibrate how much scrutiny to apply. The chip reads
 * `candidate.data.discovery_method` (which rides inside the same
 * `protocol_metadata_json` JSONB blob the Phase 1 SOAP fields use) and
 * maps the two known string tokens to visible labels and palette
 * variants:
 *
 *   - `'framework_scanner'` -> "Framework scan"   (neutral grey)
 *   - `'llm_extraction'`    -> "LLM (Phase 2)"   (caution/amber accent)
 *
 * Absent / unknown values render nothing -- the chip is purely additive
 * to existing candidate-review rows and never asserts a fallback claim
 * about where a candidate came from.
 *
 * Visual contract: mirrors `TierBadge` / `RuntimeBadge` render shape
 * (the existing candidate-review chip pattern) -- a small pill `<span>`
 * with a variant-token CSS class reused from `TierBadge.module.css`.
 * No new CSS module is added; the chip ships entirely on the existing
 * palette so the candidate-review grid keeps a single chip language.
 *
 * Pure presentational component. No API calls, no context, no state.
 */

import React from 'react';
import styles from './TierBadge.module.css';

/**
 * Known trace-metadata values written by the discovery pipeline / AMVS
 * LLM extractor onto every endpoint and interface candidate. Anything
 * else (including absent / undefined / null) collapses to "render
 * nothing".
 */
export type DiscoveryMethod = 'framework_scanner' | 'llm_extraction';

export interface DiscoveryMethodChipProps {
  /**
   * Raw value of `candidate.data.discovery_method`. Accepts unknown so
   * callers can splat the candidate's `data` blob without first
   * narrowing the type. Anything outside the two known string tokens
   * causes the chip to render nothing.
   */
  discoveryMethod?: unknown;
  /** Optional test id hook; defaults to `discovery-method-chip`. */
  'data-testid'?: string;
}

/**
 * Resolve the visible label for a known trace-metadata value, or `null`
 * when the value is not one of the two known tokens. Callers use the
 * `null` return as the "render nothing" signal.
 */
function labelFor(value: unknown): { text: string; className: string } | null {
  if (value === 'framework_scanner') {
    // Neutral chip -- the deterministic Phase 1 scanner is the default
    // emission path; reviewers do not need a visual nudge for it.
    return { text: 'Framework scan', className: styles.tierBadgeNeutral };
  }
  if (value === 'llm_extraction') {
    // Caution (amber) -- LLM-extracted candidates warrant a closer
    // look. Mirrors `TierBadge`'s `llm-ir-guided` variant so the
    // candidate-review chip language stays consistent across the grid.
    return { text: 'LLM (Phase 2)', className: styles.tierBadgeCaution };
  }
  return null;
}

export const DiscoveryMethodChip: React.FC<DiscoveryMethodChipProps> = (props) => {
  const resolved = labelFor(props.discoveryMethod);
  if (!resolved) return null;

  const className = `${styles.tierBadge} ${resolved.className}`;
  const testId = props['data-testid'] ?? 'discovery-method-chip';

  return (
    <span
      className={className}
      data-testid={testId}
      data-discovery-method={
        props.discoveryMethod === 'framework_scanner'
          ? 'framework_scanner'
          : 'llm_extraction'
      }
    >
      {resolved.text}
    </span>
  );
};
