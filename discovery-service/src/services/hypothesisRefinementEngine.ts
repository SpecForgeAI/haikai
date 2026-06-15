/**
 * Hypothesis Refinement Engine (Increment 15)
 *
 * Applies non-destructive confidence refinements to discovery run candidates
 * and clusters based on user answers to hypotheses. All modifications target
 * only discovery run entities -- canonical model entities are never modified.
 *
 * Data flow position: Q&A answers -> answer capture -> **refinement** -> updated candidates/clusters
 *
 * Verdict-to-refinement mapping:
 * - `confirmed`: Additive boost using QA_CONFIRMATION_CONFIDENCE_BOOST, capped at LOG_MAX_CONFIDENCE_CAP
 * - `denied`: Subtract QA_DENIAL_CONFIDENCE_PENALTY (floor at 0.0), set candidate status to `pending_review`
 * - `partially_confirmed`: Apply QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST, annotate data with notes
 * - `needs_more_info`: No confidence change, hypothesis stays open
 */

import { HypothesisAnswer, Hypothesis } from '../types/hypothesis';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceCluster } from '../types/cluster';
import {
  QA_CONFIRMATION_CONFIDENCE_BOOST,
  QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST,
  QA_DENIAL_CONFIDENCE_PENALTY,
  LOG_MAX_CONFIDENCE_CAP,
} from '../constants/hypothesisQaDefaults';

// =============================================================================
// Types
// =============================================================================

/**
 * Subset of archModelClient methods used by the refinement engine.
 */
export interface RefinementArchClient {
  updateCandidate: (
    projectId: string,
    runId: string,
    candidateId: string,
    update: Partial<DiscoveryCandidate>
  ) => Promise<DiscoveryCandidate>;
  getDiscoveryRun: (projectId: string, runId: string) => Promise<{ steps_payload: object } | null>;
  updateDiscoveryRun: (
    projectId: string,
    runId: string,
    payload: { steps_payload?: object }
  ) => Promise<unknown>;
}

/**
 * A single refinement operation record for traceability.
 */
export interface RefinementOperation {
  hypothesisId: string;
  subjectType: 'candidate' | 'cluster';
  subjectId: string;
  verdict: string;
  previousConfidence: number;
  newConfidence: number;
  confidenceChange: number;
  statusChange?: string;
  notes?: string;
}

/**
 * Summary of all refinement operations applied for a run.
 */
export interface RefinementSummary {
  refinementsApplied: number;
  confidenceChanges: RefinementOperation[];
  skipped: number;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Applies confidence refinements based on hypothesis answers.
 *
 * For each answer, finds the corresponding hypothesis and its subject
 * (candidate or cluster), then applies the appropriate confidence
 * adjustment based on the verdict.
 *
 * All refinement operations are recorded for traceability and persisted
 * in steps_payload.hypothesisQa.refinements.
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @param answers - The user's answers to hypotheses
 * @param hypotheses - The hypotheses for this run
 * @param candidates - All candidates for the run (modified in place)
 * @param clusters - All clusters for the run (used for cluster subject lookup)
 * @param archModelClient - The archModelClient instance for persistence
 * @returns RefinementSummary describing all operations applied
 */
export async function applyRefinements(
  projectId: string,
  runId: string,
  answers: HypothesisAnswer[],
  hypotheses: Hypothesis[],
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  archModelClient: RefinementArchClient
): Promise<RefinementSummary> {
  // Build lookup maps
  const hypothesisMap = new Map<string, Hypothesis>();
  for (const h of hypotheses) {
    hypothesisMap.set(h.id, h);
  }

  const candidateMap = new Map<string, DiscoveryCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.id, c);
  }

  const clusterMap = new Map<string, EvidenceCluster>();
  for (const cl of clusters) {
    clusterMap.set(cl.id, cl);
  }

  const operations: RefinementOperation[] = [];
  let skipped = 0;

  for (const answer of answers) {
    const hypothesis = hypothesisMap.get(answer.hypothesisId);
    if (!hypothesis) {
      skipped++;
      continue;
    }

    // Handle needs_more_info: no confidence change
    if (answer.verdict === 'needs_more_info') {
      operations.push({
        hypothesisId: answer.hypothesisId,
        subjectType: hypothesis.subjectType,
        subjectId: hypothesis.subjectId,
        verdict: answer.verdict,
        previousConfidence: 0,
        newConfidence: 0,
        confidenceChange: 0,
        notes: 'No confidence change -- needs more information',
      });
      continue;
    }

    // Process candidate-targeted hypotheses
    if (hypothesis.subjectType === 'candidate') {
      const candidate = candidateMap.get(hypothesis.subjectId);
      if (!candidate) {
        skipped++;
        continue;
      }

      const previousConfidence = candidate.confidence;
      let newConfidence = previousConfidence;
      let statusChange: string | undefined;
      let notes: string | undefined;

      switch (answer.verdict) {
        case 'confirmed': {
          newConfidence = Math.min(
            previousConfidence + QA_CONFIRMATION_CONFIDENCE_BOOST,
            LOG_MAX_CONFIDENCE_CAP
          );
          break;
        }
        case 'denied': {
          newConfidence = Math.max(
            previousConfidence - QA_DENIAL_CONFIDENCE_PENALTY,
            0.0
          );
          statusChange = 'pending_review';
          break;
        }
        case 'partially_confirmed': {
          newConfidence = Math.min(
            previousConfidence + QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST,
            LOG_MAX_CONFIDENCE_CAP
          );
          notes = answer.freeTextNotes || 'Partially confirmed by user';
          break;
        }
      }

      // Build the update payload
      const update: Partial<DiscoveryCandidate> = {
        confidence: newConfidence,
      };

      if (statusChange) {
        update.status = statusChange as DiscoveryCandidate['status'];
      }

      if (answer.verdict === 'partially_confirmed') {
        // Annotate candidate data with partial confirmation notes
        update.data = {
          ...candidate.data,
          qaPartialConfirmation: notes,
          qaHypothesisId: answer.hypothesisId,
        };
      }

      // Update candidate via archModelClient
      await archModelClient.updateCandidate(projectId, runId, candidate.id, update);

      // Update local candidate reference
      candidate.confidence = newConfidence;
      if (statusChange) {
        candidate.status = statusChange as DiscoveryCandidate['status'];
      }
      if (update.data) {
        candidate.data = update.data;
      }

      operations.push({
        hypothesisId: answer.hypothesisId,
        subjectType: 'candidate',
        subjectId: candidate.id,
        verdict: answer.verdict,
        previousConfidence,
        newConfidence,
        confidenceChange: newConfidence - previousConfidence,
        statusChange,
        notes,
      });
    } else if (hypothesis.subjectType === 'cluster') {
      // For cluster-targeted hypotheses, record the operation
      // but cluster confidence updates are informational
      // (clusters don't have the same updateCandidate API)
      const cluster = clusterMap.get(hypothesis.subjectId);
      const previousConfidence = cluster ? cluster.confidence : 0;

      operations.push({
        hypothesisId: answer.hypothesisId,
        subjectType: 'cluster',
        subjectId: hypothesis.subjectId,
        verdict: answer.verdict,
        previousConfidence,
        newConfidence: previousConfidence, // Cluster updates are recorded but not persisted via candidate API
        confidenceChange: 0,
        notes: `Cluster verdict recorded: ${answer.verdict}`,
      });
    }
  }

  // Persist refinement operations in steps_payload
  const run = await archModelClient.getDiscoveryRun(projectId, runId);
  if (run) {
    const currentPayload = (run.steps_payload || {}) as Record<string, unknown>;
    const hypothesisQa = (currentPayload.hypothesisQa as Record<string, unknown>) || {};

    const updatedPayload = {
      ...currentPayload,
      hypothesisQa: {
        ...hypothesisQa,
        refinements: operations,
        refinedAt: new Date().toISOString(),
      },
    };

    await archModelClient.updateDiscoveryRun(projectId, runId, {
      steps_payload: updatedPayload,
    });
  }

  return {
    refinementsApplied: operations.length,
    confidenceChanges: operations,
    skipped,
  };
}
