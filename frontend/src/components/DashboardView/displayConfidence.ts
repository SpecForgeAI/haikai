/**
 * displayConfidence.ts
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 2.2.
 *
 * Pure derivation module (no React, no CSS, no API imports). Computes a
 * display-only confidence value from the persisted `candidate.confidence`
 * (decimal 0..1, may be null) plus a runtime-evidence uplift derived from
 * the precomputed Spec 6 `RuntimeEvidenceContext`.
 *
 * Critical contract:
 *  - Persisted `candidate.confidence` is NEVER mutated; this module is
 *    pure-derivation only. The returned `baseConfidence` is the same value
 *    as the input `candidate.confidence` (no rounding, no clipping).
 *  - `baseConfidence` and `displayConfidence` retain the persisted decimal
 *    range (0..1) so the existing `Math.round(value * 100)` rendering in
 *    `DiscoveryCandidateTable.tsx` remains unchanged.
 *  - Internally the uplift is computed in percentage-points (0..100); the
 *    cap and the final addition are then expressed in the decimal range
 *    so the public output keeps a single unit.
 *  - The output `uplift` field is the EXACT percentage-point delta that
 *    was applied to `baseConfidence` AFTER capping (so callers can render
 *    `+N` correctly when the cap clipped a larger raw uplift).
 *
 * Per-type uplift rules (percentage-points; spec 7 §"Confidence-uplift rules"):
 *  - endpoints, adapter source (`_addedBy` ends with `-adapter`):
 *      observedUsageCount >= 1000 -> +5
 *      else >= 100               -> +4
 *      else >= 1                 -> +3
 *      else                      -> 0
 *  - endpoints, LLM source (`_addedBy` starts with `llm-`):
 *      observedUsageCount >= 1   -> +5
 *      else                      -> 0
 *  - interfaces (highest applicable wins):
 *      coverage >= 0.75 AND totalObservedCalls >= 1000 -> +4
 *      else coverage >= 0.5                            -> +3
 *      else observedEndpointCount >= 1                 -> +2
 *      else                                            -> 0
 *  - logical_data_entities:
 *      totalObservedCalls > 0    -> +1
 *      else                      -> 0
 *  - interface_logical_entities:
 *      requestBodyUsageCount + responseBodyUsageCount > 0 -> +2
 *      else unknownRoleUsageCount > 0                     -> +1
 *      else                                               -> 0
 *
 * Cap rule:
 *  - cap = MAX_LLM_LOG_ONLY_CONFIDENCE (0.95) when `_addedBy` starts with
 *    `llm-` AND no code evidence exists; otherwise cap =
 *    MAX_LOG_CORROBORATED_CONFIDENCE (0.99).
 *  - displayConfidence = min(baseConfidence + uplift/100, cap).
 *
 * Defensive guards (already-zero inputs from Spec 5):
 *  - `noUsageObserved` -> uplift contribution is 0.
 *  - 4xx/5xx-only or pure-404 -> `observedUsageCount` is already 0 per
 *    Spec 5's exclusion rule, so uplift is naturally 0.
 *
 * Label / reason fields (consumed by Group 3 builders):
 *  - When uplift > 0:
 *      baseLabel  = "Base confidence"
 *      baseReason = "Deterministic code adapter evidence." for adapter,
 *                   "Initial LLM-derived confidence."     for llm-*,
 *                   ""                                    otherwise.
 *      upliftLabel  = "Confidence increased"
 *      upliftReason = endpoints   ->
 *                       "Runtime logs observed N successful/redirect calls
 *                        matching this candidate." (N thousand-separated)
 *                     interfaces / logical_data_entities /
 *                     interface_logical_entities ->
 *                       "Related endpoint runtime usage observed."
 *  - When uplift === 0: ALL four label/reason fields are empty strings.
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import type {
  LogEnrichmentRuntimeBlock,
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
} from './candidateEvidenceTypes';
import {
  INTERFACE_HIGH_USAGE_THRESHOLD,
  MAX_LLM_LOG_ONLY_CONFIDENCE,
  MAX_LOG_CORROBORATED_CONFIDENCE,
} from './runtimeBadgeThresholds';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DisplayConfidenceResult {
  baseConfidence: number | null;
  displayConfidence: number | null;
  /**
   * Percentage-point delta actually applied AFTER capping. So if the raw
   * uplift was +5 but the cap clipped it to +2, this field reads `2`.
   * Always an integer >= 0.
   */
  uplift: number;
  baseLabel: string;
  baseReason: string;
  upliftLabel: string;
  upliftReason: string;
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
// Provenance discriminators (mirror runtimeBadgeHelpers / TierBadge logic)
// ---------------------------------------------------------------------------

function getAddedBy(candidate: DiscoveryCandidateDto): string {
  const raw = candidate.data?.['_addedBy'];
  return typeof raw === 'string' ? raw : '';
}

function isAdapterSource(addedBy: string): boolean {
  return addedBy.endsWith('-adapter');
}

function isLlmSource(addedBy: string): boolean {
  return addedBy.startsWith('llm-');
}

// ---------------------------------------------------------------------------
// Block narrowing (mirror of runtimeBadgeHelpers.readMatchedFromBlock)
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
// Number formatting (matches Spec 6's "1,842" thousand-separator convention)
// ---------------------------------------------------------------------------

const THOUSAND_SEPARATOR_FORMATTER = new Intl.NumberFormat(undefined);

function formatThousandSeparated(n: number): string {
  return THOUSAND_SEPARATOR_FORMATTER.format(n);
}

// ---------------------------------------------------------------------------
// Per-type uplift computation (returns integer pp + the matched evidence
// reference (if any) for endpoints, used to format the uplift reason)
// ---------------------------------------------------------------------------

interface UpliftDecision {
  uplift: number;
  /** Endpoint-only: the matched evidence whose `observedUsageCount` drove
   *  the uplift. Used by the upliftReason formatter. Undefined for the
   *  three indirection types. */
  matched?: MatchedRuntimeEvidence;
}

function computeEndpointUplift(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext,
  addedBy: string
): UpliftDecision {
  const slice = runtimeEvidenceContext.byCandidateId.get(candidate.id);
  const matched = readMatchedFromBlock(slice?.runtime);
  if (!matched) {
    // Either no entry at all OR a noUsageObserved block. Per spec, neither
    // can produce an uplift.
    return { uplift: 0 };
  }

  const usage = matched.observedUsageCount;
  // Spec 5's exclusion rules guarantee that 4xx/5xx-only and pure-404 traffic
  // already produce observedUsageCount === 0; we still defend explicitly.
  if (usage <= 0) {
    return { uplift: 0 };
  }

  if (isAdapterSource(addedBy)) {
    if (usage >= 1000) return { uplift: 5, matched };
    if (usage >= 100) return { uplift: 4, matched };
    if (usage >= 1) return { uplift: 3, matched };
    return { uplift: 0 };
  }

  if (isLlmSource(addedBy)) {
    if (usage >= 1) return { uplift: 5, matched };
    return { uplift: 0 };
  }

  // Unknown provenance (should not happen given the discriminators above);
  // be conservative.
  return { uplift: 0 };
}

function computeInterfaceUplift(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): UpliftDecision {
  const rollup = runtimeEvidenceContext.interfaceRollupByCandidateId.get(candidate.id);
  if (!rollup) return { uplift: 0 };

  const total = rollup.totalEndpointCount;
  const observedEndpoints = rollup.observedEndpointCount;
  // Coverage requires a non-zero denominator. When totalEndpointCount === 0
  // we cannot compute coverage and fall through to the observedEndpointCount
  // branch (which itself requires >= 1 to fire).
  const coverage = total > 0 ? observedEndpoints / total : 0;

  if (coverage >= 0.75 && rollup.totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD) {
    return { uplift: 4 };
  }
  if (coverage >= 0.5) {
    return { uplift: 3 };
  }
  if (observedEndpoints >= 1) {
    return { uplift: 2 };
  }
  return { uplift: 0 };
}

function computeLogicalDataEntityUplift(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): UpliftDecision {
  const rollup = runtimeEvidenceContext.logicalDataEntityRollupByCandidateId.get(
    candidate.id
  );
  if (!rollup) return { uplift: 0 };
  if (rollup.totalObservedCalls > 0) {
    return { uplift: 1 };
  }
  return { uplift: 0 };
}

function computeInterfaceLogicalEntityUplift(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): UpliftDecision {
  const rollup =
    runtimeEvidenceContext.interfaceLogicalEntityRollupByCandidateId.get(candidate.id);
  if (!rollup) return { uplift: 0 };

  if (rollup.requestBodyUsageCount + rollup.responseBodyUsageCount > 0) {
    return { uplift: 2 };
  }
  if (rollup.unknownRoleUsageCount > 0) {
    return { uplift: 1 };
  }
  return { uplift: 0 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the display-only confidence record for a single candidate.
 *
 * Pure function: does not read or write any persisted state. The returned
 * `baseConfidence` is the same numeric reference as `candidate.confidence`
 * (or `null` when the persisted value is null).
 */
export function getDisplayConfidence(
  candidate: DiscoveryCandidateDto,
  runtimeEvidenceContext: RuntimeEvidenceContext
): DisplayConfidenceResult {
  const baseConfidence = candidate.confidence ?? null;

  // Null-handling: persisted null short-circuits everything.
  if (baseConfidence === null) {
    return {
      baseConfidence: null,
      displayConfidence: null,
      uplift: 0,
      baseLabel: '',
      baseReason: '',
      upliftLabel: '',
      upliftReason: '',
    };
  }

  // Unsupported-type handling: displayConfidence === baseConfidence with no
  // uplift and no labels.
  if (!isSupportedType(candidate.candidate_type)) {
    return {
      baseConfidence,
      displayConfidence: baseConfidence,
      uplift: 0,
      baseLabel: '',
      baseReason: '',
      upliftLabel: '',
      upliftReason: '',
    };
  }

  const addedBy = getAddedBy(candidate);

  // ---- Compute the per-type raw uplift (percentage points) -------------
  let decision: UpliftDecision;
  switch (candidate.candidate_type) {
    case 'endpoints':
      decision = computeEndpointUplift(candidate, runtimeEvidenceContext, addedBy);
      break;
    case 'interfaces':
      decision = computeInterfaceUplift(candidate, runtimeEvidenceContext);
      break;
    case 'logical_data_entities':
      decision = computeLogicalDataEntityUplift(candidate, runtimeEvidenceContext);
      break;
    case 'interface_logical_entities':
      decision = computeInterfaceLogicalEntityUplift(candidate, runtimeEvidenceContext);
      break;
    /* istanbul ignore next -- guarded by isSupportedType above */
    default:
      decision = { uplift: 0 };
      break;
  }

  // ---- Apply cap --------------------------------------------------------
  // For endpoints, the LLM-only cap (0.95) applies when the candidate is
  // LLM-sourced. For the three indirection-driven types, the candidate
  // cannot be "LLM-only with logs but no code evidence" in a meaningful
  // way (their evidence derives from related endpoints' code/runtime), so
  // the standard log-corroborated cap (0.99) applies. This mirrors the
  // intent of the spec's cap rule: only the candidate's own provenance
  // chooses the cap, and only LLM endpoints have the 0.95 ceiling.
  const cap =
    candidate.candidate_type === 'endpoints' && isLlmSource(addedBy)
      ? MAX_LLM_LOG_ONLY_CONFIDENCE
      : MAX_LOG_CORROBORATED_CONFIDENCE;

  const rawDisplay = baseConfidence + decision.uplift / 100;
  const displayConfidence = Math.min(rawDisplay, cap);

  // The "applied" uplift in percentage-points is the actual delta after
  // capping. Round to integer pp for clean rendering (`+5`, `+2`, etc.).
  // Use Math.round to avoid floating-point drift (e.g. 0.97 + 0.05 = 1.0199...).
  const appliedUpliftPp = Math.max(0, Math.round((displayConfidence - baseConfidence) * 100));

  // ---- Populate label / reason fields ---------------------------------
  if (appliedUpliftPp <= 0) {
    return {
      baseConfidence,
      displayConfidence,
      uplift: 0,
      baseLabel: '',
      baseReason: '',
      upliftLabel: '',
      upliftReason: '',
    };
  }

  const baseLabel = 'Base confidence';
  let baseReason = '';
  if (isAdapterSource(addedBy)) {
    baseReason = 'Deterministic code adapter evidence.';
  } else if (isLlmSource(addedBy)) {
    baseReason = 'Initial LLM-derived confidence.';
  }

  const upliftLabel = 'Confidence increased';
  let upliftReason = '';
  if (candidate.candidate_type === 'endpoints' && decision.matched) {
    const formatted = formatThousandSeparated(decision.matched.observedUsageCount);
    upliftReason = `Runtime logs observed ${formatted} successful/redirect calls matching this candidate.`;
  } else {
    upliftReason = 'Related endpoint runtime usage observed.';
  }

  return {
    baseConfidence,
    displayConfidence,
    uplift: appliedUpliftPp,
    baseLabel,
    baseReason,
    upliftLabel,
    upliftReason,
  };
}
