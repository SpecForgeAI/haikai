/**
 * Hypothesis Answer Processor (Increment 15)
 *
 * Captures user answers to hypotheses, creates `human_qa` evidence atoms
 * from those answers, persists them via archModelClient, and stores the
 * answers in the discovery run's steps_payload.
 *
 * Data flow position: Q&A answers -> **answer capture** -> evidence atoms -> refinement
 */

import { v4 as uuidv4 } from 'uuid';
import { HypothesisAnswer, Hypothesis } from '../types/hypothesis';
import { EvidenceAtom, QaOrigin } from '../types/evidenceAtom';

// =============================================================================
// ArchModelClient interface (for dependency injection and testability)
// =============================================================================

/**
 * Subset of archModelClient methods used by the answer processor.
 */
export interface AnswerProcessorArchClient {
  bulkSaveEvidence: (projectId: string, runId: string, atoms: EvidenceAtom[]) => Promise<void>;
  getDiscoveryRun: (projectId: string, runId: string) => Promise<{ steps_payload: object } | null>;
  updateDiscoveryRun: (
    projectId: string,
    runId: string,
    payload: { steps_payload?: object }
  ) => Promise<unknown>;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Processes user answers to hypotheses by:
 * 1. Creating `human_qa` evidence atoms for each answer
 * 2. Persisting atoms via archModelClient.bulkSaveEvidence
 * 3. Storing answers in steps_payload.hypothesisQa.answers
 * 4. Updating hypothesis statuses from `pending` to the answer's verdict
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @param answers - The user's answers to hypotheses
 * @param hypotheses - The current hypotheses (mutated in place to update status)
 * @param archModelClient - The archModelClient instance for persistence
 * @returns Array of created EvidenceAtom objects
 */
export async function processAnswers(
  projectId: string,
  runId: string,
  answers: HypothesisAnswer[],
  hypotheses: Hypothesis[],
  archModelClient: AnswerProcessorArchClient
): Promise<EvidenceAtom[]> {
  // Build a hypothesis lookup map for efficient access
  const hypothesisMap = new Map<string, Hypothesis>();
  for (const hypothesis of hypotheses) {
    hypothesisMap.set(hypothesis.id, hypothesis);
  }

  // Step 1: Create human_qa evidence atoms for each answer
  const createdAtoms: EvidenceAtom[] = [];

  for (const answer of answers) {
    const hypothesis = hypothesisMap.get(answer.hypothesisId);
    if (!hypothesis) {
      continue; // Skip answers for unknown hypotheses
    }

    // Derive repoUrl from the hypothesis -- use a default if not determinable
    // The hypothesis references candidates/clusters which trace back to repo URLs
    // For simplicity, we use the runId context
    const repoUrl = `discovery-run://${runId}/${hypothesis.subjectType}/${hypothesis.subjectId}`;

    const qaOrigin: QaOrigin = {
      hypothesisId: answer.hypothesisId,
      verdict: answer.verdict,
      freeTextNotes: answer.freeTextNotes,
      answeredAt: answer.answeredAt,
    };

    const atom: EvidenceAtom = {
      id: uuidv4(),
      runId,
      repoUrl,
      filePath: `hypothesis/${hypothesis.category}/${hypothesis.subjectId}`,
      type: 'string_pattern',
      data: {
        patternName: `qa_${answer.verdict}`,
        matchedText: answer.freeTextNotes || `Verdict: ${answer.verdict}`,
        line: 0,
        contextSnippet: hypothesis.description,
      },
      extractedAt: new Date().toISOString(),
      source: 'human_qa',
      qaOrigin,
    };

    createdAtoms.push(atom);

    // Step 2: Update hypothesis status from pending to the answer's verdict
    hypothesis.status = answer.verdict;
  }

  // Step 3: Persist atoms via bulkSaveEvidence
  if (createdAtoms.length > 0) {
    await archModelClient.bulkSaveEvidence(projectId, runId, createdAtoms);
  }

  // Step 4: Store answers in steps_payload.hypothesisQa.answers
  const run = await archModelClient.getDiscoveryRun(projectId, runId);
  if (run) {
    const currentPayload = (run.steps_payload || {}) as Record<string, unknown>;
    const hypothesisQa = (currentPayload.hypothesisQa as Record<string, unknown>) || {};

    // Append to existing answers (support multiple rounds)
    const existingAnswers = (hypothesisQa.answers as HypothesisAnswer[]) || [];
    const allAnswers = [...existingAnswers, ...answers];

    const updatedPayload = {
      ...currentPayload,
      hypothesisQa: {
        ...hypothesisQa,
        answers: allAnswers,
        // Also update hypotheses with new statuses
        hypotheses,
      },
    };

    await archModelClient.updateDiscoveryRun(projectId, runId, {
      steps_payload: updatedPayload,
    });
  }

  return createdAtoms;
}
