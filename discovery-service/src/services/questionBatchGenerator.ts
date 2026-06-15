/**
 * Question Batch Generator (Increment 15)
 *
 * Generates grouped question batches from hypothesis objects for the
 * discovery-QA task prompt. Related hypotheses are batched together
 * (e.g., all low_confidence candidates from the same cluster, all
 * ambiguous_type items) with 2-4 questions per batch.
 *
 * Data flow position: hypothesis generation -> **question batching** -> Q&A -> refinement
 */

import { Hypothesis, HypothesisCategory, HypothesisVerdict } from '../types/hypothesis';

// =============================================================================
// Output Types
// =============================================================================

/**
 * A single question within a batch, presenting a hypothesis for user validation.
 */
export interface QuestionItem {
  /** The hypothesis ID this question is about. */
  hypothesisId: string;

  /** Human-readable description of the hypothesis. */
  description: string;

  /** Short summary of which evidence atoms/sources contributed to this hypothesis. */
  evidenceSummary: string;

  /** The available answer options for this question. */
  answerOptions: HypothesisVerdict[];
}

/**
 * A batch of related questions to present to the user in a single round.
 * Contains 2-4 questions grouped by category and/or subject relationship.
 */
export interface QuestionBatch {
  /** A label describing the grouping basis for this batch. */
  batchLabel: string;

  /** The questions in this batch (2-4 items). */
  questions: QuestionItem[];
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum number of questions per batch. */
const MIN_BATCH_SIZE = 2;

/** Maximum number of questions per batch. */
const MAX_BATCH_SIZE = 4;

/** Standard answer options for all hypothesis questions. */
const STANDARD_ANSWER_OPTIONS: HypothesisVerdict[] = [
  'confirmed',
  'denied',
  'partially_confirmed',
  'needs_more_info',
];

// =============================================================================
// Grouping Logic
// =============================================================================

/**
 * Builds a human-readable evidence summary for a hypothesis.
 */
function buildEvidenceSummary(hypothesis: Hypothesis): string {
  const refCount = hypothesis.evidenceRefs.length;
  const subject = hypothesis.subjectType === 'candidate' ? 'candidate' : 'cluster';
  return `Based on ${refCount} evidence reference${refCount !== 1 ? 's' : ''} linked to ${subject} ${hypothesis.subjectId}.`;
}

/**
 * Creates a grouping key for a hypothesis.
 * Hypotheses with the same key are candidates for batching together.
 *
 * Grouping strategy:
 * - Same category AND same subjectId (e.g., multiple issues with the same candidate)
 * - Same category AND same cluster context (for candidate hypotheses sharing a cluster)
 * - Fallback: same category
 */
function groupingKey(hypothesis: Hypothesis): string {
  // Primary grouping: category + subjectId (same entity, multiple issues)
  return `${hypothesis.category}::${hypothesis.subjectId}`;
}

/**
 * Secondary grouping key using only the category.
 * Used when primary groups are too small.
 */
function categoryKey(hypothesis: Hypothesis): string {
  return hypothesis.category;
}

/**
 * Human-readable label for a hypothesis category.
 */
function categoryLabel(category: HypothesisCategory): string {
  switch (category) {
    case 'low_confidence':
      return 'Low Confidence Items';
    case 'ambiguous_type':
      return 'Ambiguous Type Classification';
    case 'conflicting_evidence':
      return 'Conflicting Evidence';
    case 'missing_attribute':
      return 'Missing Attributes';
    case 'weak_cluster':
      return 'Weak Clusters';
    default:
      return 'Discovery Hypotheses';
  }
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Generates question batches from an array of hypotheses.
 *
 * Groups related hypotheses together (same cluster, same category) and
 * produces batches of 2-4 questions each. Only pending hypotheses are
 * included in question batches.
 *
 * @param hypotheses - All hypotheses for the discovery run
 * @returns Array of QuestionBatch objects ready for the discovery-QA task prompt
 */
export function generateQuestionBatches(hypotheses: Hypothesis[]): QuestionBatch[] {
  // Filter to only pending hypotheses (already-resolved ones are excluded)
  const pending = hypotheses.filter(h => h.status === 'pending');

  if (pending.length === 0) {
    return [];
  }

  // Step 1: Group hypotheses by primary key (category + subjectId)
  const primaryGroups = new Map<string, Hypothesis[]>();
  for (const hypothesis of pending) {
    const key = groupingKey(hypothesis);
    const group = primaryGroups.get(key) || [];
    group.push(hypothesis);
    primaryGroups.set(key, group);
  }

  // Step 2: Merge small primary groups into category-level groups
  const categoryGroups = new Map<string, Hypothesis[]>();
  for (const [, group] of primaryGroups) {
    const catKey = categoryKey(group[0]);
    const existing = categoryGroups.get(catKey) || [];
    existing.push(...group);
    categoryGroups.set(catKey, existing);
  }

  // Step 3: Split category groups into batches of 2-4
  const batches: QuestionBatch[] = [];

  for (const [catKey, group] of categoryGroups) {
    const category = group[0].category;
    const label = categoryLabel(category);

    // Split into chunks of MAX_BATCH_SIZE
    for (let i = 0; i < group.length; i += MAX_BATCH_SIZE) {
      const chunk = group.slice(i, i + MAX_BATCH_SIZE);

      const questions: QuestionItem[] = chunk.map(hypothesis => ({
        hypothesisId: hypothesis.id,
        description: hypothesis.description,
        evidenceSummary: buildEvidenceSummary(hypothesis),
        answerOptions: [...STANDARD_ANSWER_OPTIONS],
      }));

      batches.push({
        batchLabel: label,
        questions,
      });
    }
  }

  // Step 4: Merge undersized trailing batches
  // If the last batch has fewer than MIN_BATCH_SIZE items and there are
  // at least 2 batches, merge the last batch into the previous one
  // (only if the combined size stays within MAX_BATCH_SIZE)
  if (batches.length >= 2) {
    const last = batches[batches.length - 1];
    const secondLast = batches[batches.length - 2];

    if (
      last.questions.length < MIN_BATCH_SIZE &&
      secondLast.questions.length + last.questions.length <= MAX_BATCH_SIZE
    ) {
      secondLast.questions.push(...last.questions);
      secondLast.batchLabel = 'Discovery Hypotheses'; // Generic label for merged batch
      batches.pop();
    }
  }

  return batches;
}
