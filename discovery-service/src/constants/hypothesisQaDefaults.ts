/**
 * Hypothesis Q&A Default Constants (Increment 15)
 *
 * Configurable defaults for hypothesis-driven Q&A confidence refinement.
 * Controls confidence adjustments applied when users confirm, partially
 * confirm, or deny hypotheses during the discovery Q&A validation loop.
 *
 * These constants parallel the log enrichment defaults from Increment 14.
 * The maximum confidence cap is reused from `logEnrichmentDefaults.ts`
 * to maintain a single source of truth.
 */

import { LOG_MAX_CONFIDENCE_CAP } from './logEnrichmentDefaults';

/**
 * Additive confidence boost applied when a user fully confirms a hypothesis.
 * Slightly higher than LOG_CORROBORATION_CONFIDENCE_BOOST (0.10) because
 * human confirmation is a stronger signal than automated log corroboration.
 */
export const QA_CONFIRMATION_CONFIDENCE_BOOST = 0.12;

/**
 * Additive confidence boost applied when a user partially confirms a hypothesis.
 * Smaller than full confirmation to reflect the uncertainty in the response.
 */
export const QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST = 0.05;

/**
 * Confidence penalty applied when a user denies a hypothesis.
 * Subtracted from the candidate's current confidence score.
 * The result is floored at 0.0 to prevent negative confidence values.
 */
export const QA_DENIAL_CONFIDENCE_PENALTY = 0.20;

// Re-export LOG_MAX_CONFIDENCE_CAP so consumers of Q&A defaults can
// import the cap from a single location without a separate import.
export { LOG_MAX_CONFIDENCE_CAP };
