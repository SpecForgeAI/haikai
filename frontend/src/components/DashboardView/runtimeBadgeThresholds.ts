/**
 * runtimeBadgeThresholds.ts
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 1.2.
 *
 * Single source of truth for the compile-time thresholds used by Spec 7's
 * RuntimeBadge label rules and confidence-uplift cap rules. Pure constants
 * module: no runtime tuning surface, no React, no I/O.
 *
 * Threshold semantics (per spec):
 * - HIGH_USAGE_ENDPOINT_THRESHOLD / MEDIUM_USAGE_ENDPOINT_THRESHOLD /
 *   LOW_USAGE_ENDPOINT_THRESHOLD: stepwise observed-usage cut-offs for the
 *   per-endpoint runtime badge label and the adapter-endpoint uplift rule.
 * - ELEVATED_5XX_COUNT_THRESHOLD / ELEVATED_5XX_RATE_THRESHOLD: server-error
 *   thresholds that take precedence over usage labels and emit the warning
 *   "Elevated errors" badge. Either condition (count OR rate) triggers it.
 * - INTERFACE_HIGH_USAGE_THRESHOLD: the rollup-level "High usage" cut-off
 *   used by interface / logical-data-entity / interface-logical-entity
 *   rollups; also used by the +4 interface uplift rule.
 * - MAX_LOG_CORROBORATED_CONFIDENCE / MAX_LLM_LOG_ONLY_CONFIDENCE: caps
 *   applied by the displayConfidence helper when computing the displayed
 *   (non-persisted) confidence value. 99% for log-corroborated rows; 95%
 *   for LLM-only rows with logs but no code evidence.
 *
 * Note on units: the two MAX_* constants are expressed as decimal fractions
 * (0.99 / 0.95) because they cap a value in the persisted decimal range
 * (0..1) so that DiscoveryCandidateTable's existing
 * `Math.round(value * 100)` rendering remains unchanged.
 */

export const HIGH_USAGE_ENDPOINT_THRESHOLD = 1000;
export const MEDIUM_USAGE_ENDPOINT_THRESHOLD = 100;
export const LOW_USAGE_ENDPOINT_THRESHOLD = 1;

export const ELEVATED_5XX_COUNT_THRESHOLD = 10;
export const ELEVATED_5XX_RATE_THRESHOLD = 0.01;

export const INTERFACE_HIGH_USAGE_THRESHOLD = 1000;

export const MAX_LOG_CORROBORATED_CONFIDENCE = 0.99;
export const MAX_LLM_LOG_ONLY_CONFIDENCE = 0.95;
