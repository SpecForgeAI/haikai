/**
 * Relevance Evaluator + Auto-Skip Helper — Target State Architect-Persona Conversation
 * (Spec 3, Commit 3)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Per Q7 each library entry may carry a `relevanceCondition` predicate. When
 * the predicate returns false the conversation must silently capture a
 * "not_applicable" decision row AND append a `system-skip` transcript turn —
 * never surface the question to the user. Group E (Frontend) carries the only
 * v1 predicate (target has no UI screens).
 *
 * This module is pure logic — it returns a discriminated outcome the
 * orchestrator translates into the actual POST + turn append. The orchestrator
 * owns the I/O so re-evaluation hooks (which fire on each captured-decision
 * write that might unlock or lock a gate) don't smuggle writes into the
 * evaluator.
 *
 * IMPORTANT: No I/O, no HTTP, no LLM. Pure evaluation.
 */

import type {
  QuestionLibraryEntry,
  RelevanceContext,
} from '../../config/architect-conversation/questionLibrary';

// ---------------------------------------------------------------------------
// Outcome shape
// ---------------------------------------------------------------------------

export type RelevanceOutcome =
  | { relevant: true }
  | { relevant: false; reason: string };

// ---------------------------------------------------------------------------
// Default reason strings (kept centralised so tests can assert them)
// ---------------------------------------------------------------------------

/**
 * Reason recorded on the `system-skip` turn when an entry's
 * `relevanceCondition` predicate returns false. The orchestrator copies this
 * string into the turn's `relevanceReason` slot and into the captured-decision
 * row's `answer_summary` field.
 *
 * Format: `auto-skipped: <decisionCode> — relevance predicate returned false`.
 * The decision code is appended at call time.
 */
export function defaultNotApplicableReason(decisionCode: string): string {
  return `auto-skipped: ${decisionCode} — relevance predicate returned false`;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the entry's `relevanceCondition` (per Q7). When the predicate
 * is absent the entry is always relevant. When the predicate is present and
 * returns false, the outcome carries the reason string the orchestrator will
 * record on the auto-skip captured-decision row + `system-skip` turn.
 *
 * Predicates that throw are treated as "relevant" — fail-open is safer than
 * silently skipping a load-bearing question because a predicate misfired. The
 * orchestrator logs the throw but proceeds to ask the question normally.
 */
export function evaluateRelevance(
  entry: Pick<QuestionLibraryEntry, 'code' | 'relevanceCondition'>,
  ctx: RelevanceContext,
): RelevanceOutcome {
  if (!entry.relevanceCondition) {
    return { relevant: true };
  }
  let result: boolean;
  try {
    result = entry.relevanceCondition(ctx);
  } catch {
    // Fail-open per the module doc-comment.
    return { relevant: true };
  }
  if (result === true) {
    return { relevant: true };
  }
  return {
    relevant: false,
    reason: defaultNotApplicableReason(entry.code),
  };
}

/**
 * The literal `answerValue` written on auto-skip captured-decision rows.
 * Exported so tests + the orchestrator agree on a single constant.
 */
export const NOT_APPLICABLE_ANSWER_VALUE = 'not_applicable';
