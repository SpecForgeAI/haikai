/**
 * Candidate Default Constants
 *
 * Centralized confidence threshold and candidate generation constants for
 * Phase 1d candidate proposal triage and multi-pass generation. These
 * thresholds control the routing of candidate proposals into three buckets:
 *
 * - **Auto-accepted** (>= CANDIDATE_AUTO_ACCEPT_THRESHOLD): Persisted
 *   directly as DiscoveryCandidate records without LLM review.
 * - **Ambiguous** (>= CANDIDATE_AMBIGUOUS_THRESHOLD and
 *   < CANDIDATE_AUTO_ACCEPT_THRESHOLD): Routed to DecisionTask engine
 *   for LLM resolution.
 * - **Auto-discarded** (< CANDIDATE_AMBIGUOUS_THRESHOLD): Dropped without
 *   LLM involvement or persistence.
 *
 * Additional constants control type classification certainty, merge behavior,
 * and weak name detection.
 *
 * These are centralized constants, not user-facing configuration
 * in this increment. Easy to adjust from a single location.
 */

/**
 * Minimum confidence for automatic acceptance.
 * Candidate proposals at or above this threshold are persisted directly
 * as DiscoveryCandidate records without LLM review.
 */
export const CANDIDATE_AUTO_ACCEPT_THRESHOLD = 0.75;

/**
 * Minimum confidence for ambiguous classification.
 * Candidate proposals at or above this threshold (but below
 * CANDIDATE_AUTO_ACCEPT_THRESHOLD) generate DecisionTasks for LLM resolution.
 * Proposals below this threshold are auto-discarded.
 */
export const CANDIDATE_AMBIGUOUS_THRESHOLD = 0.35;

/**
 * Minimum signal strength for type classification certainty.
 * If no single type signal exceeds this threshold, the candidate
 * triggers a type classification review via DecisionTask.
 */
export const CANDIDATE_TYPE_DOMINANCE_THRESHOLD = 0.6;

/**
 * Overlap threshold for automatic candidate merging.
 * Two candidate proposals sharing this percentage or more of their
 * sourceClusterIds are automatically merged into one during the
 * merge/refinement step.
 * Value: 0.7 (70% overlap).
 */
export const CANDIDATE_OVERLAP_MERGE_THRESHOLD = 0.7;

/**
 * Array of regex patterns matching generic or weak candidate names.
 * Proposals with names matching any of these patterns are flagged
 * with `nameQuality: 'weak'` after all generation passes, triggering
 * a name refinement DecisionTask during triage.
 */
export const CANDIDATE_WEAK_NAME_PATTERNS: RegExp[] = [
  /^unknown$/i,
  /^misc$/i,
  /^module-?\d*$/i,
  /^[a-z]$/i,
  /^\d+$/,
  /^untitled$/i,
  /^unnamed$/i,
  /^default$/i,
];
