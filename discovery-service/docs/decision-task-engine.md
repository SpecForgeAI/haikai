# Decision Task Engine

Internal developer documentation for the DecisionTask system: how tasks are
created, dispatched for LLM resolution, and how results are applied back into
the discovery pipeline.

## Overview

When deterministic rules (linker rules, clustering rules, candidate generation
rules) produce ambiguous or low-confidence results, a `DecisionTask` is
created. The DecisionTask engine uses LLM calls -- dispatched via the
gateway -- to resolve the ambiguity. Results are applied back to confirm,
reject, reclassify, merge, or refine the contested items.

**Type definition**: `discovery-service/src/types/decisionTask.ts`

## DecisionTask Interface

```typescript
interface DecisionTask {
  id: string;                        // UUID
  runId: string;                     // Discovery run UUID
  taskType: DecisionTaskType;        // Discriminator for task kind
  status: DecisionTaskStatus;        // 'pending' | 'resolved' | 'failed'
  inputData: DecisionTaskInput;      // Task-type-specific input for LLM
  outputData: DecisionTaskOutput | null;  // Result from LLM (null until resolved)
  createdAt: string;                 // ISO 8601
  resolvedAt: string | null;         // ISO 8601 (null until resolved)
}
```

Persisted to the `discovery_decision_task` table via the
architecture-model-service.

## What Triggers Task Creation

DecisionTasks are created during the triage phase of each pipeline step.
Triage engines partition proposals into three confidence-based buckets.
Items in the **ambiguous** bucket -- and sometimes the **discarded** bucket
(for salvageable candidates) -- generate DecisionTasks.

### Phase 1b Triggers (Relationship Inference)

**Triage engine**: `triageCandidates` in `discovery-service/src/services/triageEngine.ts`

**Thresholds** (from `discovery-service/src/constants/linkerDefaults.ts`):
- `AUTO_ACCEPT_THRESHOLD` = **0.8** -- relationships at or above are accepted directly
- `AMBIGUOUS_THRESHOLD` = **0.4** -- relationships at or above (but below 0.8) are ambiguous

**Task types created**:

| Task Type | Trigger | Input Interface |
|---|---|---|
| `confirm_relationship` | Single ambiguous relationship (no competitors) | `ConfirmRelationshipInput` |
| `resolve_competing_relationships` | 2+ ambiguous relationships sharing the same `sourceAtomId` and `relationshipType` | `ResolveCompetingInput` |

**Competing group detection**: Ambiguous candidates are grouped by the key
`sourceAtomId::relationshipType`. Groups with 2+ members become
`resolve_competing_relationships` tasks; single-member groups become
individual `confirm_relationship` tasks.

### Phase 1c Triggers (Evidence Clustering)

**Triage engine**: `triageClusterCandidates` in `discovery-service/src/services/clusterTriageEngine.ts`

**Task types created**:

| Task Type | Trigger | Input Interface |
|---|---|---|
| `cluster_merge_decision` | Two clusters with significant member overlap | `ClusterMergeInput` |
| `cluster_type_classification` | Cluster with no dominant type signal (no signal exceeds `TYPE_DOMINANCE_THRESHOLD`) | `ClusterTypeClassificationInput` |
| `cluster_anchor_assignment` | Cluster needing Phase 0 anchor mapping | `ClusterAnchorAssignmentInput` |
| `cluster_noise_decision` | Cluster flagged as potential noise (few members, low signal) | `ClusterNoiseDecisionInput` |

### Phase 1d Triggers (Candidate Generation)

**Triage engine**: `triageCandidateProposals` in `discovery-service/src/services/candidateTriageEngine.ts`

**Thresholds** (from `discovery-service/src/constants/candidateDefaults.ts`):
- `CANDIDATE_AUTO_ACCEPT_THRESHOLD` = **0.75** -- proposals at or above are accepted directly
- `CANDIDATE_AMBIGUOUS_THRESHOLD` = **0.35** -- proposals at or above (but below 0.75) are ambiguous

**Task types created**:

| Task Type | Trigger | Input Interface |
|---|---|---|
| `candidate_type_classification` | Ambiguous proposal with `typeSignals` where no signal exceeds `CANDIDATE_TYPE_DOMINANCE_THRESHOLD` (0.6) | `CandidateTypeClassificationInput` |
| `candidate_parent_assignment` | Non-top-level ambiguous proposal without a `parentProposalRef` and with multiple source clusters | `CandidateParentAssignmentInput` |
| `candidate_name_refinement` | Ambiguous proposal with `nameQuality: 'weak'` | `CandidateNameRefinementInput` |
| `candidate_merge_decision` | Two ambiguous proposals with 35-70% `sourceClusterIds` overlap | `CandidateMergeDecisionInput` |
| `candidate_rejection_review` | Discarded proposal with non-trivial member counts (>= 3 source clusters), partial strong type signals, or high member count (>= 20) | `CandidateRejectionReviewInput` |

## Task Dispatch to the Gateway

DecisionTasks are dispatched to the gateway for LLM resolution via the
`gatewayClient` service (`discovery-service/src/services/gatewayClient.ts`).

### GatewayClient

The `gatewayClient` is a singleton `GatewayClient` instance that wraps an
Axios HTTP client configured with:
- Base URL: `GATEWAY_BASE_URL` (from `discovery-service/src/config.ts`)
- Timeout: 120 seconds
- Content-Type: `application/json`

### Resolution Endpoint

```
POST /api/v1/discovery/resolve-decision-tasks
```

**Request body**:
```json
{
  "projectId": "<uuid>",
  "runId": "<uuid>",
  "tasks": [ /* DecisionTask[] */ ]
}
```

**Response**:
```typescript
interface ResolveDecisionTasksResponse {
  results: DecisionTaskResolutionResult[];
}

interface DecisionTaskResolutionResult {
  taskId: string;
  status: 'resolved' | 'failed';
  outputData: DecisionTaskOutput | null;
  error: string | null;
}
```

The gateway processes each task sequentially, constructing structured prompts
based on the task type, calling the LLM, and returning resolution results.
Tasks with `status: 'resolved'` carry their output in `outputData`; tasks
with `status: 'failed'` carry an error message.

## How Results Are Applied Back

After receiving resolution results from the gateway, the pipeline applies
them to the contested items. The application logic lives in the step
execution functions within `runManager.ts`.

### Phase 1b Result Application

| Task Type | Output Interface | Application |
|---|---|---|
| `confirm_relationship` | `ConfirmRelationshipOutput` | If `decision: 'confirm'`: create `EvidenceRelationship` with `adjustedConfidence` and persist. If `decision: 'reject'`: discard. |
| `resolve_competing_relationships` | `ResolveCompetingOutput` | If `selectedIndex` is not null: create `EvidenceRelationship` for the selected competitor with `adjustedConfidence`. Others discarded. If `selectedIndex` is null: all competitors discarded. |

### Phase 1c Result Application

| Task Type | Output Interface | Application |
|---|---|---|
| `cluster_merge_decision` | `ClusterMergeOutput` | If `decision: 'merge'`: merge the two clusters into one. If `decision: 'keep_separate'`: keep both clusters. |
| `cluster_type_classification` | `ClusterTypeClassificationOutput` | Set `clusterType` to `selectedType` and `confidence` to `adjustedConfidence`. |
| `cluster_anchor_assignment` | `ClusterAnchorAssignmentOutput` | If `selectedAnchor` is not null: assign anchor to cluster. |
| `cluster_noise_decision` | `ClusterNoiseDecisionOutput` | If `decision: 'noise'`: remove cluster from final set. If `decision: 'keep'`: retain cluster. |

### Phase 1d Result Application

| Task Type | Output Interface | Application |
|---|---|---|
| `candidate_type_classification` | `CandidateTypeClassificationOutput` | Set `candidateType` to `selectedType` and `confidence` to `adjustedConfidence`. |
| `candidate_parent_assignment` | `CandidateParentAssignmentOutput` | If `selectedParentId` is not null: set `parentCandidateId`. |
| `candidate_name_refinement` | `CandidateNameRefinementOutput` | Set candidate `name` to `refinedName`. |
| `candidate_merge_decision` | `CandidateMergeDecisionOutput` | If `decision: 'merge'`: merge the two candidates. If `decision: 'keep_separate'`: keep both. |
| `candidate_rejection_review` | `CandidateRejectionReviewOutput` | If `decision: 'keep'`: rescue the candidate back into the accepted set. If `decision: 'reject'`: confirm rejection. |

## Triage Thresholds Summary

### Phase 1b Relationship Triage

| Bucket | Confidence Range | Action |
|---|---|---|
| Auto-accepted | >= 0.8 | Persist directly as `EvidenceRelationship` |
| Ambiguous | >= 0.4 and < 0.8 | Create DecisionTask(s) for LLM resolution |
| Discarded | < 0.4 | Dropped without persistence |

### Phase 1d Candidate Triage

| Bucket | Confidence Range | Action |
|---|---|---|
| Auto-accepted | >= 0.75 | Persist directly as `DiscoveryCandidate` |
| Ambiguous | >= 0.35 and < 0.75 | Create DecisionTask(s) for LLM resolution |
| Discarded | < 0.35 | Dropped (salvageable ones may generate `candidate_rejection_review`) |

## Log Corroboration Confidence Boost

Both the Phase 1b and Phase 1d triage engines apply a log corroboration
confidence boost (added in Increment 14) after the initial bucketing:

- **Constants** (from `discovery-service/src/constants/logEnrichmentDefaults.ts`):
  - `LOG_CORROBORATION_CONFIDENCE_BOOST` = **0.10**
  - `LOG_MAX_CONFIDENCE_CAP` = **0.98**

- **Phase 1b**: If a relationship's `sourceAtomId` or `targetAtomId`
  references an atom with `source: 'log'`, the relationship's confidence is
  boosted by 0.10 (capped at 0.98).

- **Phase 1d**: If a proposal's source clusters contain at least one atom
  member with `source: 'log'`, the proposal's confidence is boosted by 0.10
  (capped at 0.98).

This boost is additive and applied after the initial triage bucketing. It
can cause items to shift between buckets on subsequent evaluation passes.

## Key Source Files

| File | Responsibility |
|---|---|
| `discovery-service/src/types/decisionTask.ts` | All DecisionTask type definitions (11 task types, input/output interfaces) |
| `discovery-service/src/services/triageEngine.ts` | Phase 1b relationship triage (confidence buckets, competing group detection, log boost) |
| `discovery-service/src/services/clusterTriageEngine.ts` | Phase 1c cluster triage |
| `discovery-service/src/services/candidateTriageEngine.ts` | Phase 1d candidate triage (confidence buckets, structural ambiguity detection, log boost) |
| `discovery-service/src/services/gatewayClient.ts` | HTTP client for DecisionTask dispatch to gateway |
| `discovery-service/src/constants/linkerDefaults.ts` | Phase 1b threshold constants |
| `discovery-service/src/constants/candidateDefaults.ts` | Phase 1d threshold constants |
| `discovery-service/src/constants/logEnrichmentDefaults.ts` | Log corroboration boost constants |
| `discovery-service/src/services/runManager.ts` | Result application logic (in `executeStep1b`, `executeStep1c`, `executeStep1d`) |
