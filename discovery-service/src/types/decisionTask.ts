/**
 * Decision Task Types (Phase 1b + 1c + 1d)
 *
 * Defines the DecisionTask interface and related types for LLM-assisted
 * ambiguity resolution during Phase 1b relationship inference,
 * Phase 1c evidence clustering, and Phase 1d candidate generation.
 *
 * Data flow position:
 *   1b: linker rules -> triage -> **DecisionTasks** -> LLM resolution -> relationships
 *   1c: clustering rules -> triage -> **DecisionTasks** -> LLM resolution -> clusters
 *   1d: generation rules -> triage -> **DecisionTasks** -> LLM resolution -> candidates
 *
 * When deterministic rules produce ambiguous or low-confidence candidates,
 * a DecisionTask is created. The DecisionTask engine uses LLM calls
 * (via the gateway) to resolve ambiguity -- confirming relationships,
 * choosing between competing candidates, merging clusters, classifying
 * types, assigning anchors, discarding noise, refining candidate names,
 * assigning candidate parents, deciding candidate merges, and reviewing
 * candidate rejections.
 */

import { EvidenceAtom } from './evidenceAtom';
import { RelationshipType } from './relationship';
import { ClusterType } from './cluster';
import { CandidateType } from './candidate';

/**
 * The types of decision tasks.
 *
 * Phase 1b:
 * - `confirm_relationship`: Ask LLM to confirm or reject a single candidate relationship
 * - `resolve_competing_relationships`: Ask LLM to choose among competing target candidates
 *
 * Phase 1c:
 * - `cluster_merge_decision`: Ask LLM whether two overlapping clusters should be merged
 * - `cluster_type_classification`: Ask LLM to classify the architectural type of a cluster
 * - `cluster_anchor_assignment`: Ask LLM to assign a Phase 0 anchor to a cluster
 * - `cluster_noise_decision`: Ask LLM whether a cluster is noise or meaningful code
 *
 * Phase 1d:
 * - `candidate_type_classification`: Ask LLM to classify the type of an ambiguous candidate
 * - `candidate_parent_assignment`: Ask LLM to assign a parent candidate to a child candidate
 * - `candidate_name_refinement`: Ask LLM to refine a weak or generic candidate name
 * - `candidate_merge_decision`: Ask LLM whether two overlapping candidates should be merged
 * - `candidate_rejection_review`: Ask LLM to review a low-confidence candidate for rejection
 */
export type DecisionTaskType =
  | 'confirm_relationship'
  | 'resolve_competing_relationships'
  | 'cluster_merge_decision'
  | 'cluster_type_classification'
  | 'cluster_anchor_assignment'
  | 'cluster_noise_decision'
  | 'candidate_type_classification'
  | 'candidate_parent_assignment'
  | 'candidate_name_refinement'
  | 'candidate_merge_decision'
  | 'candidate_rejection_review';

/**
 * The lifecycle status of a decision task.
 *
 * - `pending`: Task awaits LLM resolution
 * - `resolved`: Task has been resolved by LLM
 * - `failed`: LLM resolution failed (error recorded)
 */
export type DecisionTaskStatus =
  | 'pending'
  | 'resolved'
  | 'failed';

// =============================================================================
// Phase 1b Input/Output Interfaces
// =============================================================================

/**
 * Input data for a `confirm_relationship` decision task.
 *
 * Includes full source/target atom data (not just IDs) so the LLM
 * has enough context for resolution without additional DB queries.
 */
export interface ConfirmRelationshipInput {
  /** Full source evidence atom data */
  sourceAtom: EvidenceAtom;

  /** Full target evidence atom data */
  targetAtom: EvidenceAtom;

  /** The proposed relationship type */
  proposedRelationshipType: RelationshipType;

  /** The confidence score from the linker rule */
  confidence: number;

  /** ID of the linker rule that produced the candidate */
  ruleId: string;
}

/**
 * A competing target candidate within a `resolve_competing_relationships` task.
 */
export interface CompetingTarget {
  /** Full target evidence atom data */
  targetAtom: EvidenceAtom;

  /** The proposed relationship type */
  relationshipType: RelationshipType;

  /** The confidence score from the linker rule */
  confidence: number;

  /** ID of the linker rule that produced the candidate */
  ruleId: string;
}

/**
 * Input data for a `resolve_competing_relationships` decision task.
 *
 * Includes the source atom and an array of competing target candidates,
 * each with their atom data, relationship type, confidence, and rule ID.
 */
export interface ResolveCompetingInput {
  /** Full source evidence atom data */
  sourceAtom: EvidenceAtom;

  /** Array of competing target candidates */
  competitors: CompetingTarget[];
}

/**
 * Output data from a `confirm_relationship` decision task resolution.
 *
 * The LLM either confirms or rejects the proposed relationship,
 * optionally adjusting the confidence score, with reasoning.
 */
export interface ConfirmRelationshipOutput {
  /** The LLM's decision: confirm or reject the relationship */
  decision: 'confirm' | 'reject';

  /** Adjusted confidence score (0.0 to 1.0) from LLM assessment */
  adjustedConfidence: number;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Output data from a `resolve_competing_relationships` decision task resolution.
 *
 * The LLM selects the best competing target (by index) or null if none
 * are appropriate, with adjusted confidence and reasoning.
 */
export interface ResolveCompetingOutput {
  /** Index of the selected competitor (0-based), or null if none selected */
  selectedIndex: number | null;

  /** Adjusted confidence score (0.0 to 1.0) for the selected relationship */
  adjustedConfidence: number;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

// =============================================================================
// Phase 1c Input Interfaces
// =============================================================================

/**
 * Summary shape for cluster data included in decision task inputs.
 */
export interface ClusterSummary {
  /** Cluster name (if assigned) */
  name: string;

  /** The preliminary cluster type */
  clusterType: ClusterType;

  /** Confidence score */
  confidence: number;

  /** Number of members in the cluster */
  memberCount: number;

  /** Summary of member paths (truncated atom file paths) */
  memberSummary?: string;

  /** Member file paths for context */
  memberPaths?: string[];

  /** Human-readable formation reason */
  formationReason?: string;
}

/**
 * Input data for a `cluster_merge_decision` decision task.
 *
 * Provides summaries of two overlapping clusters and the list of
 * shared member IDs so the LLM can decide whether to merge or keep separate.
 */
export interface ClusterMergeInput {
  /** Summary of the first cluster */
  clusterA: ClusterSummary;

  /** Summary of the second cluster */
  clusterB: ClusterSummary;

  /** Array of member IDs shared between the two clusters */
  overlapMembers: string[];

  /** Phase identifier for explicit phase discrimination */
  phase: '1c';
}

/**
 * Input data for a `cluster_type_classification` decision task.
 *
 * Provides a cluster summary and competing type signals so the LLM
 * can select the most appropriate architectural type.
 */
export interface ClusterTypeClassificationInput {
  /** Summary of the cluster to classify */
  clusterSummary: ClusterSummary;

  /** Array of competing type signals with their strengths */
  competingTypeSignals: Array<{ type: ClusterType; signalStrength: number }>;

  /** Phase identifier for explicit phase discrimination */
  phase: '1c';
}

/**
 * Input data for a `cluster_anchor_assignment` decision task.
 *
 * Provides a cluster summary and candidate Phase 0 anchors so the LLM
 * can determine the best anchor assignment.
 */
export interface ClusterAnchorAssignmentInput {
  /** Summary of the cluster to assign an anchor to */
  clusterSummary: ClusterSummary;

  /** Array of candidate anchors from Phase 0 repoApplicationMappings */
  candidateAnchors: Array<{ anchorName: string; mappingPath: string }>;

  /** Phase identifier for explicit phase discrimination */
  phase: '1c';
}

/**
 * Input data for a `cluster_noise_decision` decision task.
 *
 * Provides a cluster summary and noise indicator signals so the LLM
 * can determine whether the cluster is meaningful or noise.
 */
export interface ClusterNoiseDecisionInput {
  /** Summary of the cluster to evaluate */
  clusterSummary: ClusterSummary;

  /** Array of strings describing noise signals detected */
  noiseIndicators: string[];

  /** Phase identifier for explicit phase discrimination */
  phase: '1c';
}

// =============================================================================
// Phase 1c Output Interfaces
// =============================================================================

/**
 * Output data from a `cluster_merge_decision` decision task resolution.
 *
 * The LLM decides whether two overlapping clusters should be merged
 * into one or kept as separate clusters.
 */
export interface ClusterMergeOutput {
  /** The LLM's decision: merge the clusters or keep them separate */
  decision: 'merge' | 'keep_separate';

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Output data from a `cluster_type_classification` decision task resolution.
 *
 * The LLM selects the most appropriate architectural type for the cluster,
 * adjusts the confidence score, and provides reasoning.
 */
export interface ClusterTypeClassificationOutput {
  /** The selected cluster type from the ClusterType union */
  selectedType: ClusterType;

  /** Adjusted confidence score (0.0 to 1.0) */
  adjustedConfidence: number;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Output data from a `cluster_anchor_assignment` decision task resolution.
 *
 * The LLM selects the best Phase 0 anchor for the cluster, or null
 * if no anchor is appropriate.
 */
export interface ClusterAnchorAssignmentOutput {
  /** The selected anchor name, or null if no anchor matches */
  selectedAnchor: string | null;

  /** Adjusted confidence score (0.0 to 1.0) */
  adjustedConfidence: number;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Output data from a `cluster_noise_decision` decision task resolution.
 *
 * The LLM decides whether the cluster represents noise (test scaffolding,
 * generated code, configuration boilerplate) or meaningful code structure.
 */
export interface ClusterNoiseDecisionOutput {
  /** The LLM's decision: classify as noise or keep as meaningful */
  decision: 'noise' | 'keep';

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

// =============================================================================
// Phase 1d Input/Output Interfaces
// =============================================================================

/**
 * Summary shape for candidate data included in Phase 1d decision task inputs.
 */
export interface CandidateSummary {
  /** The proposed candidate type */
  candidateType: CandidateType;

  /** The proposed candidate name */
  name: string;

  /** Confidence score */
  confidence: number;

  /** IDs of the source clusters that contributed to this candidate */
  sourceClusterIds: string[];

  /** Human-readable explanation of why this candidate was generated */
  generationReason: string;

  /** File paths of cluster members for context */
  memberFilePaths?: string[];
}

/**
 * Input data for a `candidate_type_classification` decision task.
 *
 * Provides a candidate summary and competing type signals so the LLM
 * can select the most appropriate meta-model element type.
 */
export interface CandidateTypeClassificationInput {
  /** Summary of the candidate to classify */
  candidateSummary: CandidateSummary;

  /** Array of competing type signals with their strengths */
  competingTypeSignals: Array<{ type: CandidateType; signalStrength: number }>;

  /** Phase identifier for explicit phase discrimination */
  phase: '1d';
}

/**
 * Output data from a `candidate_type_classification` decision task resolution.
 *
 * The LLM selects the most appropriate candidate type, adjusts the
 * confidence score, and provides reasoning.
 */
export interface CandidateTypeClassificationOutput {
  /** The selected candidate type from the CandidateType union */
  selectedType: CandidateType;

  /** Adjusted confidence score (0.0 to 1.0) */
  adjustedConfidence: number;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Input data for a `candidate_parent_assignment` decision task.
 *
 * Provides a candidate summary and competing parent candidates so the LLM
 * can determine the best parent-child assignment.
 */
export interface CandidateParentAssignmentInput {
  /** Summary of the candidate to assign a parent to */
  candidateSummary: CandidateSummary;

  /** Array of competing parent candidates */
  competingParents: Array<{
    parentId: string;
    parentName: string;
    parentType: CandidateType;
    signal: string;
  }>;

  /** Phase identifier for explicit phase discrimination */
  phase: '1d';
}

/**
 * Output data from a `candidate_parent_assignment` decision task resolution.
 *
 * The LLM selects the best parent candidate (by ID) or null if no parent
 * is appropriate, with adjusted confidence and reasoning.
 */
export interface CandidateParentAssignmentOutput {
  /** The selected parent candidate ID, or null if no parent matches */
  selectedParentId: string | null;

  /** Adjusted confidence score (0.0 to 1.0) */
  adjustedConfidence: number;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Input data for a `candidate_name_refinement` decision task.
 *
 * Provides a candidate summary, the current (weak) name, and member file
 * paths so the LLM can propose a more descriptive name.
 */
export interface CandidateNameRefinementInput {
  /** Summary of the candidate to refine */
  candidateSummary: CandidateSummary;

  /** The current (weak or generic) name */
  currentName: string;

  /** File paths of cluster members for context */
  memberFilePaths: string[];

  /** Phase identifier for explicit phase discrimination */
  phase: '1d';
}

/**
 * Output data from a `candidate_name_refinement` decision task resolution.
 *
 * The LLM proposes a more descriptive name with reasoning.
 */
export interface CandidateNameRefinementOutput {
  /** The refined candidate name */
  refinedName: string;

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Input data for a `candidate_merge_decision` decision task.
 *
 * Provides summaries of two overlapping candidates and the list of
 * shared cluster IDs so the LLM can decide whether to merge or keep separate.
 */
export interface CandidateMergeDecisionInput {
  /** Summary of the first candidate */
  candidateA: CandidateSummary;

  /** Summary of the second candidate */
  candidateB: CandidateSummary;

  /** Array of cluster IDs shared between the two candidates */
  overlappingClusterIds: string[];

  /** Phase identifier for explicit phase discrimination */
  phase: '1d';
}

/**
 * Output data from a `candidate_merge_decision` decision task resolution.
 *
 * The LLM decides whether two overlapping candidates should be merged
 * into one or kept as separate candidates.
 */
export interface CandidateMergeDecisionOutput {
  /** The LLM's decision: merge the candidates or keep them separate */
  decision: 'merge' | 'keep_separate';

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

/**
 * Input data for a `candidate_rejection_review` decision task.
 *
 * Provides a candidate summary and rejection indicator signals so the LLM
 * can determine whether the candidate should be kept or rejected.
 */
export interface CandidateRejectionReviewInput {
  /** Summary of the candidate to review */
  candidateSummary: CandidateSummary;

  /** Array of strings describing rejection signals detected */
  rejectionIndicators: string[];

  /** Phase identifier for explicit phase discrimination */
  phase: '1d';
}

/**
 * Output data from a `candidate_rejection_review` decision task resolution.
 *
 * The LLM decides whether the candidate should be kept or rejected.
 */
export interface CandidateRejectionReviewOutput {
  /** The LLM's decision: keep the candidate or reject it */
  decision: 'keep' | 'reject';

  /** Brief explanation of the LLM's reasoning */
  reasoning: string;
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * Union of all decision task input types.
 */
export type DecisionTaskInput =
  | ConfirmRelationshipInput
  | ResolveCompetingInput
  | ClusterMergeInput
  | ClusterTypeClassificationInput
  | ClusterAnchorAssignmentInput
  | ClusterNoiseDecisionInput
  | CandidateTypeClassificationInput
  | CandidateParentAssignmentInput
  | CandidateNameRefinementInput
  | CandidateMergeDecisionInput
  | CandidateRejectionReviewInput;

/**
 * Union of all decision task output types.
 */
export type DecisionTaskOutput =
  | ConfirmRelationshipOutput
  | ResolveCompetingOutput
  | ClusterMergeOutput
  | ClusterTypeClassificationOutput
  | ClusterAnchorAssignmentOutput
  | ClusterNoiseDecisionOutput
  | CandidateTypeClassificationOutput
  | CandidateParentAssignmentOutput
  | CandidateNameRefinementOutput
  | CandidateMergeDecisionOutput
  | CandidateRejectionReviewOutput;

/**
 * Core decision task interface.
 *
 * Each decision task represents an ambiguous candidate (relationship, cluster,
 * or discovery candidate) that requires LLM resolution. Mirrors the
 * `discovery_decision_task` database table structure.
 *
 * Persisted to the `discovery_decision_task` table via the architecture-model-service.
 */
export interface DecisionTask {
  /** Unique task identifier (UUID) */
  id: string;

  /** ID of the discovery run this task belongs to */
  runId: string;

  /** The type of decision task */
  taskType: DecisionTaskType;

  /** The lifecycle status of the task */
  status: DecisionTaskStatus;

  /** Input data for LLM resolution (type depends on taskType) */
  inputData: DecisionTaskInput;

  /** Output data from LLM resolution (null until resolved) */
  outputData: DecisionTaskOutput | null;

  /** ISO 8601 timestamp when the task was created */
  createdAt: string;

  /** ISO 8601 timestamp when the task was resolved (null until resolved) */
  resolvedAt: string | null;
}
