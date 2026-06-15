/**
 * Architect Conversation — question sequencer.
 *
 * Spec: 2026-05-24-target-state-architect-conversation (the "Question ordering,
 * relevance, and close gate" section) + the question-driver completion that
 * wires it up.
 *
 * This is the piece the original conversation feature was missing: a pure
 * function that, given the codes already captured (answered / auto-skipped /
 * tech-stack pre-filled) and a relevance context, returns the NEXT question the
 * architect should be asked — or null when the walk is complete.
 *
 * Ordering rule (Q5): intra-group order is ENFORCED (A.1 before A.2 before A.3
 * via `orderInGroup`). The spec allows the architect to jump between groups
 * freely; for the auto-driver we present a deterministic linear walk
 * (group A..J, ascending `orderInGroup`), which never violates the intra-group
 * gate and gives a predictable "next question" without an LLM in the loop.
 *
 * Pure module: no I/O, no LLM, no orchestration.
 */

import {
  QUESTION_LIBRARY,
  type QuestionLibraryEntry,
  type RelevanceContext,
} from '../../config/architect-conversation/questionLibrary';

/** Canonical render/walk order of the ten groups. */
const GROUP_ORDER: Record<string, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
};

/**
 * The library sorted into the deterministic walk order: by group (A..J), then
 * by `orderInGroup` ascending. Computed once at module load (the library is a
 * frozen constant).
 */
const ORDERED_LIBRARY: readonly QuestionLibraryEntry[] = [...QUESTION_LIBRARY].sort(
  (a, b) => {
    const byGroup = (GROUP_ORDER[a.group] ?? 99) - (GROUP_ORDER[b.group] ?? 99);
    return byGroup !== 0 ? byGroup : a.orderInGroup - b.orderInGroup;
  },
);

export interface SelectNextQuestionArgs {
  /**
   * Decision codes that already have a captured-decision row — i.e. answered,
   * auto-skipped (`not_applicable`), or tech-stack pre-filled. These are removed
   * from the ask stream.
   */
  answeredCodes: ReadonlySet<string>;
  /**
   * Relevance context for the per-question auto-skip predicate (Q7).
   * Defaults to all three technology-tier flags `true` (fail-open) so no
   * question group is dropped unless the caller positively knows a tier is
   * absent. (Group 3 widens the callers to thread all three flags; this
   * default keeps the pure walk fail-open.)
   */
  relevanceContext?: RelevanceContext;
}

/**
 * Returns the next question entry to surface, honouring intra-group ordering,
 * skipping already-captured codes, and skipping codes whose relevance predicate
 * evaluates false. Returns null when no question remains (walk complete).
 */
export function selectNextQuestion(
  args: SelectNextQuestionArgs,
): QuestionLibraryEntry | null {
  const ctx: RelevanceContext =
    args.relevanceContext ?? {
      hasUiTier: true,
      hasServiceTier: true,
      hasPersistenceTier: true,
    };
  for (const entry of ORDERED_LIBRARY) {
    if (args.answeredCodes.has(entry.code)) {
      continue;
    }
    if (entry.relevanceCondition && !entry.relevanceCondition(ctx)) {
      continue;
    }
    return entry;
  }
  return null;
}

/**
 * Decision codes for questions whose capability the target may legitimately
 * OMIT entirely (e.g. "no metrics framework").
 *
 * NOTE (2026-06-05): the "Not applicable to this migration" opt-out is now
 * shown on EVERY question -- the frontend no longer gates the control on this
 * flag, so the architect always has a consistent N/A escape (even on
 * fundamentals). This `optional` flag is retained only as a semantic hint
 * (which questions are capability-omission questions) for potential downstream
 * use; it NO LONGER decides whether the opt-out button renders. Adjust
 * membership here only to change that semantic classification.
 */
export const OPTIONAL_DECISION_CODES: ReadonlySet<string> = new Set<string>([
  'service.healthcheck',
  'api.versioning',
  'api.rateLimiting',
  'db.readReplicaUsage',
  'validation.framework',
  'logging.framework',
  'metrics.framework',
  'tracing.framework',
  'secrets.management',
  'ui.stateManagement',
  'ui.designSystem',
  'interservice.asyncBus',
  'interservice.discoveryMechanism',
  'interservice.retryStrategy',
  'testing.e2e',
  'testing.contractTesting',
  'testing.mocking',
]);

/**
 * Wire-shape of a pending question handed to the frontend so it can render the
 * prompt chrome + the answer input for the code the architect should answer
 * next. The prompt is the FIXED library text (per Q17 — never LLM-paraphrased),
 * with `discoveryContextLead` prepended when present.
 */
export interface PendingQuestionDto {
  decisionCode: string;
  group: string;
  orderInGroup: number;
  promptText: string;
  staticContextLeadIn: string | null;
  expectedAnswerShape: QuestionLibraryEntry['expectedAnswerShape'];
  choices: string[] | null;
  defaultsWhenUnchanged: string;
  /** True when the target may opt out of this capability entirely ("Not needed"). */
  optional: boolean;
}

/** Projects a library entry into the pending-question wire DTO. */
export function toPendingQuestionDto(entry: QuestionLibraryEntry): PendingQuestionDto {
  return {
    decisionCode: entry.code,
    group: entry.group,
    orderInGroup: entry.orderInGroup,
    promptText: entry.discoveryContextLead
      ? `${entry.discoveryContextLead}\n\n${entry.prompt}`
      : entry.prompt,
    staticContextLeadIn: entry.staticContextLeadIn ?? null,
    expectedAnswerShape: entry.expectedAnswerShape,
    choices: entry.choices ? [...entry.choices] : null,
    defaultsWhenUnchanged: entry.defaultsWhenUnchanged,
    optional: OPTIONAL_DECISION_CODES.has(entry.code),
  };
}
