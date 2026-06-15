/**
 * Cluster Default Constants
 *
 * Centralized confidence threshold and clustering constants for Phase 1c
 * candidate cluster triage and multi-pass clustering. These thresholds
 * control the routing of candidate clusters into three buckets:
 *
 * - **Auto-accepted** (>= AUTO_ACCEPT_THRESHOLD): Persisted directly
 *   as EvidenceCluster records without LLM review.
 * - **Ambiguous** (>= AMBIGUOUS_THRESHOLD and < AUTO_ACCEPT_THRESHOLD):
 *   Routed to DecisionTask engine for LLM resolution.
 * - **Auto-discarded** (< AMBIGUOUS_THRESHOLD): Dropped without
 *   LLM involvement or persistence.
 *
 * Additional constants control merge behavior and structural checks.
 *
 * These are centralized constants, not user-facing configuration
 * in this increment. Easy to adjust from a single location.
 */

/**
 * Minimum confidence for automatic acceptance.
 * Candidate clusters at or above this threshold are persisted directly
 * as EvidenceCluster records without LLM review.
 */
export const AUTO_ACCEPT_THRESHOLD = 0.8;

/**
 * Minimum confidence for ambiguous classification.
 * Candidate clusters at or above this threshold (but below AUTO_ACCEPT_THRESHOLD)
 * generate DecisionTasks for LLM resolution.
 * Candidates below this threshold are auto-discarded.
 */
export const AMBIGUOUS_THRESHOLD = 0.4;

/**
 * Overlap threshold for automatic cluster merging.
 * Two candidate clusters sharing this percentage or more of their atom
 * members are automatically merged into one during the merge/refinement step.
 * Value: 0.7 (70% overlap).
 */
export const OVERLAP_MERGE_THRESHOLD = 0.7;

/**
 * Minimum number of atom members for a cluster to not be flagged as noise.
 * Clusters with fewer than this many atom members after all passes
 * are flagged for noise review.
 */
export const NOISE_MIN_MEMBERS = 2;

/**
 * Minimum signal strength for type classification certainty.
 * If no single type signal exceeds this threshold, the cluster
 * triggers a type classification review.
 */
export const TYPE_DOMINANCE_THRESHOLD = 0.6;
