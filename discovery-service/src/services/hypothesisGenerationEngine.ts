/**
 * Hypothesis Generation Engine (Increment 15)
 *
 * A standalone, deterministic engine that analyzes discovery run data
 * (candidates, clusters, atoms, relationships) and generates hypotheses
 * describing uncertain, ambiguous, or incomplete results.
 *
 * Data flow position: Phase 1d candidates -> **hypothesis generation** -> Q&A -> refinement
 *
 * The engine:
 * 1. Iterates over a set of deterministic rule functions
 * 2. Each rule receives the full dataset (candidates, clusters, atoms, relationships)
 * 3. Each rule returns zero or more Hypothesis objects
 * 4. Aggregates all hypothesis results and assigns UUIDs
 *
 * No LLM calls -- strictly deterministic rule evaluation.
 */

import { v4 as uuidv4 } from 'uuid';
import { Hypothesis, HypothesisCategory } from '../types/hypothesis';
import { DiscoveryCandidate } from '../types/candidate';
import { EvidenceCluster } from '../types/cluster';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import {
  CANDIDATE_AUTO_ACCEPT_THRESHOLD,
  CANDIDATE_AMBIGUOUS_THRESHOLD,
} from '../constants/candidateDefaults';

// =============================================================================
// Rule Function Type
// =============================================================================

/**
 * A hypothesis rule function receives the full discovery run dataset
 * and returns zero or more hypotheses describing detected uncertainties.
 */
type HypothesisRule = (
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
) => Hypothesis[];

// =============================================================================
// Individual Hypothesis Rules
// =============================================================================

/**
 * Flags candidates with confidence below the auto-accept threshold.
 *
 * Candidates with low confidence may represent uncertain or ambiguous
 * discovery results that benefit from human validation.
 */
export function checkLowConfidenceCandidates(
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence < CANDIDATE_AUTO_ACCEPT_THRESHOLD) {
      // Gather evidence refs from the candidate's source clusters
      const evidenceRefs = collectCandidateEvidenceRefs(candidate, clusters);

      hypotheses.push({
        id: uuidv4(),
        runId,
        category: 'low_confidence',
        subjectType: 'candidate',
        subjectId: candidate.id,
        description:
          `Candidate "${candidate.name}" (${candidate.candidateType}) has confidence ` +
          `${candidate.confidence.toFixed(2)}, below the auto-accept threshold of ` +
          `${CANDIDATE_AUTO_ACCEPT_THRESHOLD}. Please confirm whether this element exists.`,
        evidenceRefs,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return hypotheses;
}

/**
 * Flags clusters with clusterType === 'unknown'.
 *
 * Clusters with unknown type could not be classified deterministically
 * and may benefit from human input to assign the correct type.
 */
export function checkAmbiguousClusterTypes(
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];

  for (const cluster of clusters) {
    if (cluster.clusterType === 'unknown') {
      // Evidence refs include the cluster itself and its atom members
      const evidenceRefs = [cluster.id];
      for (const member of cluster.members) {
        evidenceRefs.push(member.memberId);
      }

      hypotheses.push({
        id: uuidv4(),
        runId,
        category: 'ambiguous_type',
        subjectType: 'cluster',
        subjectId: cluster.id,
        description:
          `Cluster "${cluster.name || '(unnamed)'}" has type "unknown" -- ` +
          `the system could not determine its category. ` +
          `Does this cluster represent a service boundary, data domain, API layer, or something else?`,
        evidenceRefs,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return hypotheses;
}

/**
 * Flags candidates whose source clusters contain atoms from different
 * sources (code vs log) with conflicting implications.
 *
 * Conflicting evidence occurs when code-sourced atoms suggest one thing
 * (e.g., a name or type) and log-sourced atoms suggest something different.
 */
export function checkConflictingEvidence(
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];

  // Build lookup maps for efficient access
  const clusterMap = new Map<string, EvidenceCluster>();
  for (const cluster of clusters) {
    clusterMap.set(cluster.id, cluster);
  }

  const atomMap = new Map<string, EvidenceAtom>();
  for (const atom of atoms) {
    atomMap.set(atom.id, atom);
  }

  for (const candidate of candidates) {
    const codeAtomIds: string[] = [];
    const logAtomIds: string[] = [];

    // Traverse source clusters to find atoms from different sources
    for (const clusterId of candidate.sourceClusterIds) {
      const cluster = clusterMap.get(clusterId);
      if (!cluster) continue;

      for (const member of cluster.members) {
        if (member.memberType === 'atom') {
          const atom = atomMap.get(member.memberId);
          if (!atom) continue;

          const source = atom.source || 'code'; // default to code for legacy atoms
          if (source === 'code') {
            codeAtomIds.push(atom.id);
          } else if (source === 'log') {
            logAtomIds.push(atom.id);
          }
        }
      }
    }

    // Conflict exists when we have both code and log atoms
    if (codeAtomIds.length > 0 && logAtomIds.length > 0) {
      const evidenceRefs = [...codeAtomIds, ...logAtomIds];

      hypotheses.push({
        id: uuidv4(),
        runId,
        category: 'conflicting_evidence',
        subjectType: 'candidate',
        subjectId: candidate.id,
        description:
          `Candidate "${candidate.name}" (${candidate.candidateType}) has evidence from both ` +
          `code analysis (${codeAtomIds.length} atoms) and log analysis (${logAtomIds.length} atoms) ` +
          `that may disagree. Please review whether these sources are consistent.`,
        evidenceRefs,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return hypotheses;
}

/**
 * Flags candidates with empty or missing critical fields in their data payload.
 *
 * A candidate with an empty name, no description, or missing key attributes
 * may need human input to fill in the gaps.
 */
export function checkMissingAttributes(
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];

  for (const candidate of candidates) {
    const missingFields: string[] = [];

    // Check for empty or missing name
    if (!candidate.name || candidate.name.trim() === '') {
      missingFields.push('name');
    }

    // Check for missing or empty description in the data payload
    if (
      !candidate.data.description ||
      (typeof candidate.data.description === 'string' &&
        candidate.data.description.trim() === '')
    ) {
      missingFields.push('description');
    }

    // Check for missing source cluster references
    if (!candidate.sourceClusterIds || candidate.sourceClusterIds.length === 0) {
      missingFields.push('sourceClusterIds');
    }

    if (missingFields.length > 0) {
      const evidenceRefs = collectCandidateEvidenceRefs(candidate, clusters);

      hypotheses.push({
        id: uuidv4(),
        runId,
        category: 'missing_attribute',
        subjectType: 'candidate',
        subjectId: candidate.id,
        description:
          `Candidate "${candidate.name || '(unnamed)'}" (${candidate.candidateType}) is ` +
          `missing critical attributes: ${missingFields.join(', ')}. ` +
          `Can you provide the missing information?`,
        evidenceRefs,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return hypotheses;
}

/**
 * Flags clusters with confidence below the CANDIDATE_AMBIGUOUS_THRESHOLD.
 *
 * Weak clusters may represent noise or incomplete groupings that benefit
 * from human review.
 */
export function checkWeakClusters(
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];

  for (const cluster of clusters) {
    if (cluster.confidence < CANDIDATE_AMBIGUOUS_THRESHOLD) {
      // Evidence refs include the cluster and its members
      const evidenceRefs = [cluster.id];
      for (const member of cluster.members) {
        evidenceRefs.push(member.memberId);
      }

      hypotheses.push({
        id: uuidv4(),
        runId,
        category: 'weak_cluster',
        subjectType: 'cluster',
        subjectId: cluster.id,
        description:
          `Cluster "${cluster.name || '(unnamed)'}" (${cluster.clusterType}) has confidence ` +
          `${cluster.confidence.toFixed(2)}, below the ambiguous threshold of ` +
          `${CANDIDATE_AMBIGUOUS_THRESHOLD}. Is this grouping meaningful or should it be discarded?`,
        evidenceRefs,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return hypotheses;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Collects evidence reference IDs for a candidate by traversing its source
 * clusters and gathering member atom/relationship IDs.
 */
function collectCandidateEvidenceRefs(
  candidate: DiscoveryCandidate,
  clusters: EvidenceCluster[]
): string[] {
  const clusterMap = new Map<string, EvidenceCluster>();
  for (const cluster of clusters) {
    clusterMap.set(cluster.id, cluster);
  }

  const evidenceRefs: string[] = [];
  for (const clusterId of candidate.sourceClusterIds) {
    evidenceRefs.push(clusterId);
    const cluster = clusterMap.get(clusterId);
    if (cluster) {
      for (const member of cluster.members) {
        evidenceRefs.push(member.memberId);
      }
    }
  }

  return evidenceRefs;
}

// =============================================================================
// Registry of all hypothesis rules
// =============================================================================

/**
 * Ordered list of all hypothesis rules.
 * Each rule is a deterministic function that checks for a specific category
 * of uncertainty in the discovery run data.
 */
const HYPOTHESIS_RULES: HypothesisRule[] = [
  checkLowConfidenceCandidates,
  checkAmbiguousClusterTypes,
  checkConflictingEvidence,
  checkMissingAttributes,
  checkWeakClusters,
];

// =============================================================================
// Main Engine Function
// =============================================================================

/**
 * Generates hypotheses by running all deterministic rule functions against
 * the provided discovery run data.
 *
 * @param runId - The discovery run UUID
 * @param candidates - All candidates for the run
 * @param clusters - All clusters for the run
 * @param atoms - All evidence atoms for the run
 * @param relationships - All evidence relationships for the run
 * @returns Array of Hypothesis objects describing detected uncertainties
 */
export function generateHypotheses(
  runId: string,
  candidates: DiscoveryCandidate[],
  clusters: EvidenceCluster[],
  atoms: EvidenceAtom[],
  relationships: EvidenceRelationship[]
): Hypothesis[] {
  const allHypotheses: Hypothesis[] = [];

  for (const rule of HYPOTHESIS_RULES) {
    const ruleHypotheses = rule(runId, candidates, clusters, atoms, relationships);
    allHypotheses.push(...ruleHypotheses);
  }

  return allHypotheses;
}

/**
 * Persists generated hypotheses into the discovery run's steps_payload
 * under the `hypothesisQa` key.
 *
 * Follows the existing pattern used by step results in runManager.ts:
 * reads the current steps_payload, merges the hypotheses, and writes it back.
 *
 * @param projectId - The project UUID
 * @param runId - The discovery run UUID
 * @param hypotheses - The generated hypotheses to persist
 * @param archModelClient - The archModelClient instance for persistence
 */
export async function persistHypotheses(
  projectId: string,
  runId: string,
  hypotheses: Hypothesis[],
  archModelClient: {
    getDiscoveryRun: (projectId: string, runId: string) => Promise<{ steps_payload: object } | null>;
    updateDiscoveryRun: (
      projectId: string,
      runId: string,
      payload: { steps_payload?: object }
    ) => Promise<unknown>;
  }
): Promise<void> {
  // Read current steps_payload
  const run = await archModelClient.getDiscoveryRun(projectId, runId);
  if (!run) {
    throw new Error(`Discovery run ${runId} not found for project ${projectId}`);
  }

  const currentPayload = (run.steps_payload || {}) as Record<string, unknown>;

  // Merge hypotheses into steps_payload under hypothesisQa key
  const updatedPayload = {
    ...currentPayload,
    hypothesisQa: {
      ...((currentPayload.hypothesisQa as Record<string, unknown>) || {}),
      hypotheses,
      generatedAt: new Date().toISOString(),
      hypothesisCount: hypotheses.length,
    },
  };

  // Write back to the discovery run
  await archModelClient.updateDiscoveryRun(projectId, runId, {
    steps_payload: updatedPayload,
  });
}
