/**
 * runtimeBadgeHelpers.ts
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 1.4.
 *
 * Pure helper module (no React, no CSS, no API imports). Reads the
 * precomputed Spec 6 `RuntimeEvidenceContext` and a single
 * `DiscoveryCandidateDto` and decides:
 *  - Whether the candidate has any associated log evidence at all
 *    (`hasAssociatedLogEvidence`).
 *  - What the row-level RuntimeBadge label and variant should be -- or
 *    `null` when no badge should render (`getRuntimeBadgeFor`).
 *  - A short informational evidence-source label for tests / future
 *    callers (`getEvidenceSourceLabel`).
 *
 * Spec 7 type gate: only the four candidate types Spec 6 supports
 * (`endpoints`, `interfaces`, `logical_data_entities`,
 * `interface_logical_entities`) can produce a badge. Unsupported types
 * ALWAYS return `null` from `getRuntimeBadgeFor`, regardless of context
 * contents.
 *
 * Endpoint label rules (precedence: errors > high usage > observed > null):
 *   - `status5xxCount >= ELEVATED_5XX_COUNT_THRESHOLD` OR
 *     `status5xxCount / totalLogRequests >= ELEVATED_5XX_RATE_THRESHOLD`
 *     -> "Elevated errors", warning.
 *   - else `observedUsageCount >= HIGH_USAGE_ENDPOINT_THRESHOLD`
 *     -> "High usage", success.
 *   - else `observedUsageCount > 0`
 *     -> "Observed {compact}", success.
 *   - else (or `noUsageObserved`, or no entry) -> null.
 *
 * Interface / logical_data_entities / interface_logical_entities rules:
 *   - observed-count >= INTERFACE_HIGH_USAGE_THRESHOLD -> "High usage", success.
 *   - else observed-count > 0 -> "Observed {compact}", success.
 *   - else -> null.
 *
 * Compact-numeric formatting via Intl.NumberFormat:
 *   1842 -> "1.8k", 12430 -> "12k", 1234567 -> "1.2M".
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import type {
  InterfaceLogicalEntityRuntimeRollup,
  InterfaceRuntimeRollup,
  LogicalDataEntityRuntimeRollup,
  LogEnrichmentRuntimeBlock,
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
} from './candidateEvidenceTypes';
import {
  ELEVATED_5XX_COUNT_THRESHOLD,
  ELEVATED_5XX_RATE_THRESHOLD,
  HIGH_USAGE_ENDPOINT_THRESHOLD,
  INTERFACE_HIGH_USAGE_THRESHOLD,
} from './runtimeBadgeThresholds';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RuntimeBadgeVariant = 'success' | 'warning' | 'caution' | 'danger' | 'neutral';

export interface RuntimeBadgeDescriptor {
  label: string;
  variant: RuntimeBadgeVariant;
}

// ---------------------------------------------------------------------------
// Type-gate (Spec 6 allowlist)
// ---------------------------------------------------------------------------

const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  'endpoints',
  'interfaces',
  'logical_data_entities',
  'interface_logical_entities',
]);

function isSupportedType(candidateType: string): boolean {
  return SUPPORTED_TYPES.has(candidateType);
}

// ---------------------------------------------------------------------------
// Compact numeric formatting
// ---------------------------------------------------------------------------

const COMPACT_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompact(n: number): string {
  return COMPACT_FORMATTER.format(n);
}

// ---------------------------------------------------------------------------
// Block narrowing (mirror of runtimeEvidenceContextBuilder.readMatched
// without re-importing internal helpers; kept local + minimal)
// ---------------------------------------------------------------------------

function readMatchedFromBlock(
  block: LogEnrichmentRuntimeBlock | undefined
): MatchedRuntimeEvidence | undefined {
  if (!block) return undefined;
  if ('matched' in block) {
    return block.matched;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * True iff the candidate type is supported AND the precomputed runtime
 * context contains a non-zero entry in the relevant map. "Non-zero" means:
 *   - endpoints: matched evidence exists with `observedUsageCount > 0`.
 *     A `noUsageObserved` block does NOT count as associated evidence
 *     for badge / uplift purposes.
 *   - interfaces: rollup entry exists with `totalObservedCalls > 0`.
 *   - logical_data_entities: rollup entry exists with `totalObservedCalls > 0`.
 *   - interface_logical_entities: rollup entry exists with
 *     `totalObservedContractUsage > 0`.
 *
 * Unsupported candidate types always return `false` regardless of context.
 */
export function hasAssociatedLogEvidence(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): boolean {
  if (!isSupportedType(candidate.candidate_type)) {
    return false;
  }

  if (candidate.candidate_type === 'endpoints') {
    const slice = runtimeEvidenceContext.byCandidateId.get(candidate.id);
    const matched = readMatchedFromBlock(slice?.runtime);
    return !!matched && matched.observedUsageCount > 0;
  }

  if (candidate.candidate_type === 'interfaces') {
    const rollup = runtimeEvidenceContext.interfaceRollupByCandidateId.get(candidate.id);
    return !!rollup && rollup.totalObservedCalls > 0;
  }

  if (candidate.candidate_type === 'logical_data_entities') {
    const rollup = runtimeEvidenceContext.logicalDataEntityRollupByCandidateId.get(
      candidate.id
    );
    return !!rollup && rollup.totalObservedCalls > 0;
  }

  if (candidate.candidate_type === 'interface_logical_entities') {
    const rollup =
      runtimeEvidenceContext.interfaceLogicalEntityRollupByCandidateId.get(candidate.id);
    return !!rollup && rollup.totalObservedContractUsage > 0;
  }

  return false;
}

/**
 * Compute the row-level RuntimeBadge descriptor (label + variant) for a
 * single candidate, or return `null` when no badge should render.
 *
 * Returns `null` when:
 *  - the candidate type is unsupported (Spec 6 allowlist), OR
 *  - the candidate has no matching context entry, OR
 *  - the context entry is `noUsageObserved` / has zero observed counts.
 *
 * The endpoint precedence rule applies: 5xx-elevated returns the warning
 * "Elevated errors" badge even when `observedUsageCount` is high.
 */
export function getRuntimeBadgeFor(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): RuntimeBadgeDescriptor | null {
  if (!isSupportedType(candidate.candidate_type)) {
    return null;
  }

  if (candidate.candidate_type === 'endpoints') {
    return endpointBadge(candidate, runtimeEvidenceContext);
  }

  if (candidate.candidate_type === 'interfaces') {
    const rollup = runtimeEvidenceContext.interfaceRollupByCandidateId.get(candidate.id);
    return rollupBadge(rollup?.totalObservedCalls);
  }

  if (candidate.candidate_type === 'logical_data_entities') {
    const rollup = runtimeEvidenceContext.logicalDataEntityRollupByCandidateId.get(
      candidate.id
    );
    return rollupBadge(rollup?.totalObservedCalls);
  }

  if (candidate.candidate_type === 'interface_logical_entities') {
    const rollup =
      runtimeEvidenceContext.interfaceLogicalEntityRollupByCandidateId.get(candidate.id);
    return rollupBadge(rollup?.totalObservedContractUsage);
  }

  return null;
}

/**
 * Short informational label describing the evidence source. Useful for
 * tests and future callers; the visual surface is the RuntimeBadge sibling
 * (per resolved decision 2 in shaping notes). The wording deliberately
 * stays short and neutral.
 *
 * Returns the empty string when there is no associated log evidence (so
 * callers can branch on truthiness without an explicit `null` guard).
 */
export function getEvidenceSourceLabel(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): string {
  if (!hasAssociatedLogEvidence(candidate, runtimeEvidenceContext)) {
    return '';
  }

  if (candidate.candidate_type === 'endpoints') {
    return 'Web access logs';
  }

  // The three indirection-driven types derive their evidence from related
  // endpoints, so the source label reflects that derivation.
  return 'Related endpoint logs';
}

// ---------------------------------------------------------------------------
// Per-type internal helpers
// ---------------------------------------------------------------------------

function endpointBadge(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): RuntimeBadgeDescriptor | null {
  const slice = runtimeEvidenceContext.byCandidateId.get(candidate.id);
  const matched = readMatchedFromBlock(slice?.runtime);
  if (!matched) {
    // Either no entry at all OR a noUsageObserved block. Neither emits a
    // badge per spec.
    return null;
  }

  // Errors-precedence rule. Either count >= threshold OR rate >= threshold
  // triggers "Elevated errors". Rate is computed only when totalLogRequests
  // > 0 to avoid divide-by-zero (a zero-denominator means rate is
  // effectively undefined and only the count branch can fire).
  const elevatedByCount = matched.status5xxCount >= ELEVATED_5XX_COUNT_THRESHOLD;
  const elevatedByRate =
    matched.totalLogRequests > 0 &&
    matched.status5xxCount / matched.totalLogRequests >= ELEVATED_5XX_RATE_THRESHOLD;
  if (elevatedByCount || elevatedByRate) {
    return { label: 'Elevated errors', variant: 'warning' };
  }

  if (matched.observedUsageCount >= HIGH_USAGE_ENDPOINT_THRESHOLD) {
    return { label: 'High usage', variant: 'success' };
  }

  if (matched.observedUsageCount > 0) {
    return {
      label: `Observed ${formatCompact(matched.observedUsageCount)}`,
      variant: 'success',
    };
  }

  return null;
}

/**
 * Shared rollup-badge rule for the three indirection-driven types. The
 * caller passes the rollup's "observed count" field
 * (`totalObservedCalls` for interfaces / logical_data_entities;
 * `totalObservedContractUsage` for interface_logical_entities). Missing
 * rollup entries (`undefined`) and zero counts both yield `null`.
 */
function rollupBadge(count: number | undefined): RuntimeBadgeDescriptor | null {
  if (count === undefined || count <= 0) {
    return null;
  }

  if (count >= INTERFACE_HIGH_USAGE_THRESHOLD) {
    return { label: 'High usage', variant: 'success' };
  }

  return { label: `Observed ${formatCompact(count)}`, variant: 'success' };
}

// Re-export the rollup types so test files that import from this module
// don't need a second import path. Keeps the test surface tight.
export type {
  InterfaceLogicalEntityRuntimeRollup,
  InterfaceRuntimeRollup,
  LogicalDataEntityRuntimeRollup,
};
