/**
 * Runtime choice filter — hide-incompatible + "Other (advanced)" escape hatch +
 * answer-driven skip-moot + seed/filter reconciliation
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR4 + FR7).
 *
 * This is the RUNTIME application layer that sits on top of the deterministic
 * data (Task Group 2: `branchLists.ts` / `compatibilityMatrix.ts`) and the grey
 * LLM-judge (Task Group 3: `greyCompatibilityJudge.ts`). It:
 *
 *   1. HIDES choices incompatible with prior foundational answers (does not
 *      merely warn). Pipeline per question class:
 *        - `hard-dependent` => branch-list narrowing (`resolveBranchSubset`).
 *        - `grey`           => deterministic matrix then LLM-judge for the
 *          residue (`adjudicateGreyQuestion`), fail-open.
 *        - `independent`    => never filtered (full set).
 *   2. ALWAYS appends a stable `Other (advanced)` escape hatch so the architect
 *      is never trapped into the constrained set; selecting it accepts a
 *      free-text value outside the branch-list.
 *   3. SKIPS questions that have become moot given prior ANSWERS, extending the
 *      existing tier-gated `relevanceCondition` / `RelevanceContext` auto-skip to
 *      be answer-driven. The existing tier predicates keep working unchanged
 *      (additive) — `evaluateAnswerDrivenRelevance` first runs the entry's own
 *      tier predicate, then the answer-driven moot rule.
 *   4. RECONCILES a `cascades` seed against the filtered set: a seeded default
 *      that survives filtering is preserved; one filtered out falls back to the
 *      recommended/first-compatible choice (logged). `cascades` seeding itself is
 *      NOT removed or altered (FR7).
 *
 * Every hidden choice + every seed substitution + every moot-skip is logged via
 * the shared `logger`. No silent drops.
 *
 * No persistence here — this module computes the offered set + skip/seed
 * decisions; the orchestrator owns the captured-decision POST + `system-skip`
 * turn append (mirroring how `relevanceEvaluator.ts` returns a pure outcome the
 * orchestrator translates into I/O).
 */

import type {
  QuestionLibraryEntry,
  RelevanceContext,
} from '../../config/architect-conversation/questionLibrary';
import {
  resolveBranchSubset,
  hasBranchList,
} from '../../config/architect-conversation/branchLists';
import { hasCompatibilityRule } from '../../config/architect-conversation/compatibilityMatrix';
import {
  GreyCompatibilityJudgeDeps,
  adjudicateGreyQuestion,
  defaultGreyCompatibilityJudgeDeps,
} from './greyCompatibilityJudge';
import {
  evaluateRelevance,
  defaultNotApplicableReason,
} from './relevanceEvaluator';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// "Other (advanced)" escape hatch sentinel (FR4)
//
// Always appended to a FILTERED question's offered set so the architect can
// supply a free-text value outside the branch-list. A stable, well-known string
// the frontend recognises to render the free-text affordance and the parser
// accepts as the "off-list" marker.
// ---------------------------------------------------------------------------

export const OTHER_ADVANCED_CHOICE = 'Other (advanced)';

/** True iff a selected value is the escape-hatch sentinel. */
export function isOtherAdvanced(value: string): boolean {
  return value === OTHER_ADVANCED_CHOICE;
}

// ---------------------------------------------------------------------------
// Filtered-choice result
// ---------------------------------------------------------------------------

export interface FilteredChoices {
  /** The question code filtered. */
  questionCode: string;
  /**
   * The offered set: the compatible subset (or full set for independent /
   * unresolved) with the `Other (advanced)` sentinel appended when the question
   * was actually filtered. Independent questions are returned verbatim WITHOUT
   * the sentinel (nothing was hidden, so there is no constrained set to escape).
   */
  offered: string[];
  /** Choices removed from the original `choices` because they were incompatible. */
  hidden: string[];
  /** True iff any narrowing actually happened (=> the escape hatch was appended). */
  filtered: boolean;
  /** True iff the grey LLM-judge was invoked while computing this set. */
  llmInvoked: boolean;
}

// ---------------------------------------------------------------------------
// Choice filter (FR4 hide-incompatible + escape hatch)
// ---------------------------------------------------------------------------

export interface FilterChoicesArgs {
  /** The question being offered. */
  entry: Pick<
    QuestionLibraryEntry,
    'code' | 'choices' | 'dependencyClass' | 'foundationalInputs'
  >;
  /** Foundational answers gathered so far (decision code -> answer). */
  foundationalAnswers: Readonly<Record<string, string | readonly string[]>>;
}

/**
 * Compute the offered choice set for a question, hiding incompatible options and
 * appending the `Other (advanced)` escape hatch when the set was narrowed.
 *
 * - `independent` (or a question with no `choices`) => the full set verbatim,
 *   no sentinel (nothing hidden).
 * - `hard-dependent` => branch-list narrowing; if no branch-list / no recognised
 *   foundational answer resolves, the FULL set is offered (fail-open, no silent
 *   narrowing) and NO sentinel is appended.
 * - `grey` => deterministic matrix + LLM-judge for the residue (fail-open).
 *
 * Every hidden choice is logged (code + value). Async because the grey path may
 * consult the LLM-judge; the hard/independent paths never await an LLM.
 */
export async function filterChoices(
  args: FilterChoicesArgs,
  deps: GreyCompatibilityJudgeDeps = defaultGreyCompatibilityJudgeDeps,
): Promise<FilteredChoices> {
  const { entry, foundationalAnswers } = args;
  const all = entry.choices ? [...entry.choices] : [];

  // Independent questions (or questions with no choices) are never filtered.
  if (entry.dependencyClass === 'independent' || all.length === 0) {
    return {
      questionCode: entry.code,
      offered: all,
      hidden: [],
      filtered: false,
      llmInvoked: false,
    };
  }

  let kept: string[] = all;
  let hidden: string[] = [];
  let llmInvoked = false;

  if (entry.dependencyClass === 'hard-dependent') {
    // Deterministic branch-list narrowing.
    const subset = resolveBranchSubset(entry.code, foundationalAnswers);
    if (subset === undefined) {
      // No branch-list OR no recognised foundational answer => full set,
      // fail-open. Nothing hidden, no sentinel.
      return {
        questionCode: entry.code,
        offered: all,
        hidden: [],
        filtered: false,
        llmInvoked: false,
      };
    }
    const subsetSet = new Set(subset);
    kept = all.filter((c) => subsetSet.has(c));
    hidden = all.filter((c) => !subsetSet.has(c));
  } else {
    // grey — deterministic matrix + LLM-judge for the residue (fail-open).
    const verdict = await adjudicateGreyQuestion(
      {
        questionCode: entry.code,
        candidates: all,
        foundationalAnswers,
      },
      deps,
    );
    llmInvoked = verdict.llmInvoked;
    const keptSet = new Set(verdict.kept);
    kept = all.filter((c) => keptSet.has(c));
    hidden = all.filter((c) => !keptSet.has(c));
  }

  // Log every hidden choice (code + value). No silent drops.
  for (const h of hidden) {
    logger.debug('choice-filter: hid incompatible choice', {
      questionCode: entry.code,
      value: h,
      dependencyClass: entry.dependencyClass,
    });
  }

  const filtered = hidden.length > 0;
  // Always append the escape hatch to a FILTERED question so the architect is
  // never trapped (even when every curated choice was hidden, leaving the
  // sentinel as the only path to a free-text value).
  const offered = filtered ? [...kept, OTHER_ADVANCED_CHOICE] : kept;

  return {
    questionCode: entry.code,
    offered,
    hidden,
    filtered,
    llmInvoked,
  };
}

// ---------------------------------------------------------------------------
// Answer-driven moot-skip (FR4) — extends the tier-gated relevance auto-skip
//
// The existing `relevanceCondition` / `RelevanceContext` predicates gate whole
// groups on TIER flags. This layer ADDS answer-driven moot rules: a question can
// be skipped because PRIOR ANSWERS made it moot (e.g. `api.contractFormat` is
// moot when no API protocol was chosen, so there is no contract format to pick).
// The two are composed in `evaluateAnswerDrivenRelevance`: the tier predicate
// runs first (unchanged), then the answer-driven rule.
// ---------------------------------------------------------------------------

/**
 * An answer-driven moot rule. Returns `true` when the question is MOOT (should
 * be auto-skipped) given the prior answers, `false` otherwise. Pure function of
 * the answers map; never calls out.
 */
export type AnswerDrivenMootRule = (
  answers: Readonly<Record<string, string | readonly string[]>>,
) => boolean;

/**
 * True when a foundational input is "absent": not present, empty string, or an
 * empty array. Used to detect a moot downstream question whose foundational
 * brancher was never chosen.
 */
function foundationalAbsent(
  answers: Readonly<Record<string, string | readonly string[]>>,
  code: string,
): boolean {
  const v = answers[code];
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Answer-driven moot rules, keyed by question code. ADDITIVE to the tier
 * predicates — a code without a rule here is never answer-skipped.
 *
 * `api.contractFormat` (H, keys off `api.protocol`): moot when no protocol was
 * chosen — with no protocol there is no contract format to settle. (Under the
 * FR9 API like-for-like lock this question is locked from source anyway; that
 * is a separate, later treatment.)
 */
export const ANSWER_DRIVEN_MOOT_RULES: Readonly<
  Record<string, AnswerDrivenMootRule>
> = {
  'api.contractFormat': (answers) =>
    foundationalAbsent(answers, 'api.protocol'),
};

/** True iff this question has an answer-driven moot rule. */
export function hasAnswerDrivenMootRule(questionCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    ANSWER_DRIVEN_MOOT_RULES,
    questionCode,
  );
}

export type AnswerDrivenRelevanceOutcome =
  | { relevant: true }
  | { relevant: false; reason: string; cause: 'tier' | 'answer-moot' };

/**
 * Evaluate BOTH the existing tier-gated `relevanceCondition` and the new
 * answer-driven moot rule for an entry. The tier predicate is checked FIRST
 * (existing behaviour, unchanged): if the entry is tier-irrelevant it is skipped
 * with the existing reason string. Otherwise the answer-driven moot rule (if
 * any) is checked; a moot question is skipped with an answer-driven reason.
 *
 * Returns `{ relevant: true }` when the question should be asked. The reason
 * strings reuse `defaultNotApplicableReason` so the orchestrator records the
 * same `system-skip` / `not_applicable` capture shape for BOTH skip causes.
 */
export function evaluateAnswerDrivenRelevance(
  entry: Pick<QuestionLibraryEntry, 'code' | 'relevanceCondition'>,
  ctx: RelevanceContext,
  answers: Readonly<Record<string, string | readonly string[]>>,
): AnswerDrivenRelevanceOutcome {
  // 1. Existing tier-gated predicate — unchanged.
  const tier = evaluateRelevance(entry, ctx);
  if (!tier.relevant) {
    return { relevant: false, reason: tier.reason, cause: 'tier' };
  }

  // 2. Answer-driven moot rule (additive).
  const rule = ANSWER_DRIVEN_MOOT_RULES[entry.code];
  if (rule) {
    let moot: boolean;
    try {
      moot = rule(answers);
    } catch {
      // Fail-open: a misfiring moot rule must never silently drop a question.
      logger.warn('choice-filter: answer-driven moot rule threw; asking anyway', {
        questionCode: entry.code,
      });
      return { relevant: true };
    }
    if (moot) {
      const reason = defaultNotApplicableReason(entry.code);
      logger.debug('choice-filter: question moot given prior answers; auto-skipping', {
        questionCode: entry.code,
      });
      return { relevant: false, reason, cause: 'answer-moot' };
    }
  }

  return { relevant: true };
}

// ---------------------------------------------------------------------------
// Seed <-> filter reconciliation (FR7)
//
// `cascades` SEEDS a proposed downstream value; this layer FILTERS the allowable
// set. The two coexist (neither replaces the other). When a seeded value is a
// member of the filtered set it is preserved; when it was filtered out it falls
// back to the recommended/first-compatible choice (logged). `cascades` is never
// removed or altered here.
// ---------------------------------------------------------------------------

export interface SeedReconciliation {
  /** The value to actually seed after reconciliation. */
  value: string;
  /** True iff the original seed survived filtering (was a member of the set). */
  preserved: boolean;
  /** The original seed value before reconciliation. */
  originalSeed: string;
  /** True iff the original seed was filtered out and substituted. */
  substituted: boolean;
}

/**
 * Reconcile a `cascades`-seeded default against the filtered/offered set.
 *
 * - If `seedValue` is a member of `filteredChoices` => preserve it.
 * - Otherwise substitute the recommended/first-compatible choice. The
 *   recommended choice is `recommended` when supplied AND a member of the set;
 *   otherwise the FIRST member of the set (the curated branch-list is authored
 *   recommended-first). The `Other (advanced)` sentinel is never auto-selected.
 * - When the filtered set is empty (every curated choice hidden), the seed is
 *   left as-is (the architect resolves via the escape hatch) and flagged
 *   `substituted: false, preserved: false`.
 *
 * Every substitution is logged (code + original seed + substituted value).
 */
export function reconcileSeed(args: {
  questionCode: string;
  seedValue: string;
  /** The offered/compatible choices (may include the `Other (advanced)` sentinel). */
  filteredChoices: readonly string[];
  /** Optional curated recommended default for the framework/question. */
  recommended?: string;
}): SeedReconciliation {
  const { questionCode, seedValue, filteredChoices, recommended } = args;

  // Real (non-sentinel) members the seed could legitimately resolve to.
  const realChoices = filteredChoices.filter((c) => !isOtherAdvanced(c));

  if (realChoices.includes(seedValue)) {
    return {
      value: seedValue,
      preserved: true,
      originalSeed: seedValue,
      substituted: false,
    };
  }

  // Seed was filtered out. Pick the fallback.
  if (realChoices.length === 0) {
    // Nothing compatible to fall back to — leave the seed; the escape hatch
    // carries the architect to a free-text value.
    logger.warn(
      'choice-filter: cascades seed filtered out and no compatible fallback exists',
      { questionCode, originalSeed: seedValue },
    );
    return {
      value: seedValue,
      preserved: false,
      originalSeed: seedValue,
      substituted: false,
    };
  }

  const fallback =
    recommended && realChoices.includes(recommended)
      ? recommended
      : realChoices[0];

  logger.info('choice-filter: cascades seed filtered out; substituting fallback', {
    questionCode,
    originalSeed: seedValue,
    substituted: fallback,
  });

  return {
    value: fallback,
    preserved: false,
    originalSeed: seedValue,
    substituted: true,
  };
}

// ---------------------------------------------------------------------------
// Convenience predicate
// ---------------------------------------------------------------------------

/**
 * True iff a question is subject to runtime choice-filtering at all (it has a
 * branch-list OR a compatibility rule). Independent questions return false.
 */
export function isFilterableQuestion(questionCode: string): boolean {
  return hasBranchList(questionCode) || hasCompatibilityRule(questionCode);
}
