/**
 * Linker Default Constants
 *
 * Centralized confidence threshold constants for Phase 1b
 * candidate relationship triage. These thresholds control
 * the routing of candidate relationships into three buckets:
 *
 * - **Auto-accepted** (>= AUTO_ACCEPT_THRESHOLD): Persisted directly
 *   as EvidenceRelationship records without LLM review.
 * - **Ambiguous** (>= AMBIGUOUS_THRESHOLD and < AUTO_ACCEPT_THRESHOLD):
 *   Routed to DecisionTask engine for LLM resolution.
 * - **Auto-discarded** (< AMBIGUOUS_THRESHOLD): Dropped without
 *   LLM involvement or persistence.
 *
 * These are centralized constants, not user-facing configuration
 * in this increment. Easy to adjust from a single location.
 */

/**
 * Minimum confidence for automatic acceptance.
 * Candidates at or above this threshold are persisted directly
 * as EvidenceRelationship records without LLM review.
 */
export const AUTO_ACCEPT_THRESHOLD = 0.8;

/**
 * Minimum confidence for ambiguous classification.
 * Candidates at or above this threshold (but below AUTO_ACCEPT_THRESHOLD)
 * generate DecisionTasks for LLM resolution.
 * Candidates below this threshold are auto-discarded.
 */
export const AMBIGUOUS_THRESHOLD = 0.4;
