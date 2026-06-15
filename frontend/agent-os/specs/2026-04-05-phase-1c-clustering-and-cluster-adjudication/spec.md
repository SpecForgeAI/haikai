# Specification: Phase 1c Clustering and Cluster Adjudication

## Goal
Implement Phase 1c evidence clustering so the system can take the 1a + 1b evidence graph, group atoms and relationships into meaningful typed clusters using deterministic multi-pass rules, resolve ambiguous clustering outcomes via bounded DecisionTasks, and produce a stable cluster graph for Phase 1d candidate generation.

## User Stories
- As a discovery run, I want to automatically group linked evidence atoms and relationships into coherent clusters so that the evidence graph is organized into meaningful pre-architecture bundles ready for candidate generation.
- As a discovery run encountering ambiguous clustering outcomes, I want to use bounded LLM-powered DecisionTasks to adjudicate merge, split, type, and noise decisions so that the final cluster graph is accurate without requiring full LLM dependency for clear-cut cases.

## Specific Requirements

**ClusteringRule interface and clusteringRuleRegistry**
- Define a `ClusteringRule` interface at `discovery-service/src/types/clusteringRule.ts` following the same shape as `LinkerRule`: `id`, `name`, `description`, and a `match()` method
- The `match()` method signature differs from LinkerRule: it accepts `atoms: EvidenceAtom[]`, `relationships: EvidenceRelationship[]`, and `existingClusters: CandidateCluster[]` (from prior passes), returning `CandidateCluster[]`
- Define a `CandidateCluster` interface (analogous to `CandidateRelationship`) as the internal, non-persisted intermediate shape: members, preliminary clusterType, confidence, formationReason, ruleId
- Create `clusteringRuleRegistry.ts` following the exact pattern of `linkerRuleRegistry.ts`: an in-memory Map, `initializeClusteringRuleRegistry()`, `getClusteringRuleRegistry()`, `registerClusteringRule()`
- Create `discovery-service/src/services/clusteringRules/index.ts` barrel with `registerAllClusteringRules()` following the `linkerRules/index.ts` pattern

**Initial set of deterministic clustering rules**
- Each rule lives in its own file under `discovery-service/src/services/clusteringRules/`, following the `containsByPathRule.ts` file pattern
- `directoryClusterRule`: groups atoms sharing a common directory path prefix into package/module-like clusters using `file_structure` atoms and `contains` relationships
- `importDensityClusterRule`: groups atoms with high mutual import/call density into service-like clusters using `imports`, `calls`, and `references` relationships
- `dataUsageClusterRule`: groups atoms that share SQL/table/data access patterns into data-domain clusters using `uses_data` relationships and `string_pattern` atoms
- `routePrefixClusterRule`: groups atoms sharing HTTP route prefixes into api-layer clusters using `string_pattern` atoms with route indicators
- `anchorHintClusterRule`: uses Phase 0 `repoApplicationMappings` from the discovery config as high-confidence seeding signals; maps file paths to named application clusters at high confidence (0.95)
- Each rule assigns a preliminary `clusterType` deterministically based on its signal domain

**Multi-pass clustering execution with merge/refinement**
- Clustering rules execute in ordered passes, not all-at-once; each pass receives the `CandidateCluster[]` output from all previous passes
- The pass order should be: anchor hints first (strongest signal), then directory structure, then import density, then data usage, then route prefix
- After all rules in a pass execute, run a merge/refinement step that detects and merges overlapping candidate clusters (clusters sharing a high percentage of members)
- Overlap threshold for automatic merge: two candidates sharing 70% or more of their atom members should be merged into one, keeping the higher confidence and combining formation reasons
- Candidates with fewer than 2 atom members after all passes should be flagged for noise review

**Expanded ClusterType union**
- Add `package_module` and `unknown` to the existing `ClusterType` union in `discovery-service/src/types/cluster.ts`
- The existing types (`service_boundary`, `data_domain`, `shared_library`, `api_layer`, `ui_module`) remain unchanged
- The `cluster_type` column in the database is TEXT, so no SQL migration is needed for new type values

**Cluster triage with structural ambiguity checks**
- Create `discovery-service/src/services/clusterTriageEngine.ts` following the `triageEngine.ts` pattern as a pure function with no I/O
- Use the same confidence thresholds (AUTO_ACCEPT_THRESHOLD = 0.8, AMBIGUOUS_THRESHOLD = 0.4) from a new `discovery-service/src/constants/clusterDefaults.ts` file
- Layer structural ambiguity checks on top of confidence bucketing: overlapping membership between two clusters (40-70% overlap) triggers merge review, clusters with bimodal signal distribution trigger split review, clusters where no single type exceeds 60% signal strength trigger type classification review, clusters dominated by generated/test/config file patterns trigger noise review
- The triage result should include: accepted clusters, ambiguous clusters, discarded clusters, and detected ambiguity groups (keyed by ambiguity type)

**Four new DecisionTask types for 1c**
- Extend `DecisionTaskType` union in `discovery-service/src/types/decisionTask.ts` to include: `cluster_merge_decision`, `cluster_type_classification`, `cluster_anchor_assignment`, `cluster_noise_decision`
- Define typed input interfaces for each: `ClusterMergeInput` (two cluster summaries with overlapping members), `ClusterTypeClassificationInput` (cluster summary with competing type signals), `ClusterAnchorAssignmentInput` (cluster summary with candidate anchor names from Phase 0), `ClusterNoiseDecisionInput` (cluster summary with noise indicator signals)
- Define typed output interfaces for each: `ClusterMergeOutput` (decision: merge/keep_separate, reasoning), `ClusterTypeClassificationOutput` (selectedType from ClusterType union, adjustedConfidence, reasoning), `ClusterAnchorAssignmentOutput` (selectedAnchor or null, adjustedConfidence, reasoning), `ClusterNoiseDecisionOutput` (decision: noise/keep, reasoning)
- Add all new input/output interfaces to the `DecisionTaskInput` and `DecisionTaskOutput` unions
- Include `phase: '1c'` in all 1c task inputData payloads for explicit phase discrimination

**Gateway prompt templates and interpolation for 1c tasks**
- Create four new prompt template files in `gateway/src/config/prompts/` following the `discovery.confirm-relationship.prompt.md` naming pattern: `discovery.cluster-merge-decision.prompt.md`, `discovery.cluster-type-classification.prompt.md`, `discovery.cluster-anchor-assignment.prompt.md`, `discovery.cluster-noise-decision.prompt.md`
- Each template should include interpolation variables for cluster name, cluster type, member count, member summaries (truncated atom paths/names), confidence, and formation reasons
- Extend `PROMPT_TEMPLATE_FILES` map in `discoveryDecisionTaskPrompts.ts` with all four new task type entries
- Extend `interpolateTemplate()` with four new branches for the 1c task types, extracting cluster-specific fields from inputData
- Extend `buildMessagesForTask()` and `buildUserMessage()` with appropriate user message text for each 1c task type
- Widen the `taskType` type parameter on `loadPromptTemplate`, `interpolateTemplate`, `buildMessagesForTask` from the current two-value union to include all six task types
- Widen the `DecisionTaskInput.taskType` union in the gateway route's local type to include the four new 1c values

**Cluster graph update after adjudication**
- Use delete-and-recreate semantics for merge/split outcomes rather than in-place updates
- Add a `deleteClustersByRunId(projectId, runId)` method to `DiscoveryClusterService`, `DiscoveryClusterController`, `DiscoveryClusterRepository`, and `archModelClient` (DELETE endpoint)
- The adjudication flow: after gateway resolves 1c DecisionTasks, process each result, apply merge/split/type/noise decisions to the in-memory cluster list, then delete all existing clusters for the run and bulk-save the final cluster set
- Merged clusters combine members from both source clusters, take the higher confidence, concatenate formation reasons, and record the merge DecisionTask ID in their `data.adjudicationHistory` array
- Noise-classified clusters are removed from the final set (not persisted)
- Type-reclassified clusters update their `clusterType` and record the reclassification in `data.adjudicationHistory`

**Cluster data payload structure**
- The `data` JSONB payload on each persisted cluster should contain: `formationReason` (string describing how/why), `ruleIds` (array of contributing rule IDs), `dominantLanguage` (most common language among member atoms), `directoryRoot` (common path prefix), `memberSummary` (object with atomCount and relationshipCount), `adjudicationHistory` (array of objects with taskId, taskType, decision, timestamp)
- This structure provides traceability from cluster back to the rules and decisions that formed it

**Real executeStep1c() implementation in runManager**
- Replace the current stub in `runManager.ts` (lines 461-467) with full orchestration logic following the `executeStep1b()` pattern
- Step sequence: (1) fetch all 1a atoms via `archModelClient.getEvidenceByRun`, (2) fetch all 1b relationships via `archModelClient.getRelationshipsByRun`, (3) fetch discovery config via `archModelClient.getDiscoveryConfig` for anchor hints, (4) initialize and run clustering rules in ordered passes with merge/refinement, (5) triage candidate clusters, (6) persist auto-accepted clusters via `archModelClient.bulkSaveClusters`, (7) create DecisionTasks for ambiguous clusters and persist via `archModelClient.bulkSaveDecisionTasks`, (8) resolve tasks via `gatewayClient.resolveDecisionTasks`, (9) process adjudication results and update in-memory cluster state, (10) delete-and-recreate final clusters, (11) update DecisionTask records with resolved status, (12) return summary metadata
- Summary metadata should include: `clusterCount`, `autoAcceptedCount`, `decisionTaskCount`, `decisionTaskResolvedCount`, `decisionTaskFailedCount`, `discardedCount`, `upstreamAtomCount`, `upstreamRelationshipCount`
- Import the new `clusteringRuleRegistry` and `clusterTriageEngine` alongside the existing imports

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**LinkerRule interface and linkerRuleRegistry (direct template for ClusteringRule)**
- `discovery-service/src/types/linkerRule.ts` defines the `LinkerRule` interface shape (`id`, `name`, `description`, `targetRelationshipType`, `match()`) and the `CandidateRelationship` internal type
- `discovery-service/src/services/linkerRuleRegistry.ts` provides the registry pattern: in-memory Map, `initialize`, `get`, `register` functions
- `discovery-service/src/services/linkerRules/index.ts` barrel with `registerAllLinkerRules()` called from initialization
- The `ClusteringRule` and `clusteringRuleRegistry` should replicate this pattern exactly, substituting the match signature and candidate type

**triageEngine.ts (direct template for clusterTriageEngine)**
- `discovery-service/src/services/triageEngine.ts` is a pure function that partitions candidates into accepted/ambiguous/discarded buckets using confidence thresholds, then detects competing groups within the ambiguous bucket
- The `clusterTriageEngine` should follow this same pure-function pattern, adding structural ambiguity checks (overlap detection, type uncertainty, noise indicators) as an additional step after confidence bucketing
- Thresholds imported from `discovery-service/src/constants/linkerDefaults.ts` provide the baseline; cluster-specific thresholds should live in a parallel `clusterDefaults.ts` file

**executeStep1b() in runManager.ts (direct template for executeStep1c)**
- Lines 167-409 in `runManager.ts` define the full orchestration flow: fetch upstream data, run rules, triage, persist accepted, create DecisionTasks, resolve via gateway, process results, persist confirmed, return summary
- The 1c step follows this exact sequencing with clustering-specific data types substituted in
- The existing 1c stub at lines 461-467 is the replacement target

**Gateway discoveryDecisionTaskPrompts.ts (extend for 1c task types)**
- `PROMPT_TEMPLATE_FILES` map, `loadPromptTemplate()`, `interpolateTemplate()`, `buildMessagesForTask()` all need widening to accept the four new 1c task type strings
- The `interpolateTemplate` branching pattern (if/else on taskType) should be extended with four new branches
- Prompt template files follow the naming convention `discovery.<task-type-kebab-case>.prompt.md`

**Architecture-model-service cluster JPA stack (persistence already exists)**
- `DiscoveryClusterEntity`, `DiscoveryClusterMemberEntity`, `DiscoveryClusterDto`, `DiscoveryClusterMemberDto`, `DiscoveryClusterRepository`, `DiscoveryClusterService`, `DiscoveryClusterController` are all fully implemented with bulkCreate, getByRunId, and countByRunId
- The `cluster_type` column is TEXT (not enum), so new ClusterType values require no SQL migration
- The only addition needed is a `deleteByRunId` capability for delete-and-recreate semantics after adjudication

## Out of Scope
- Phase 1d candidate generation (deferred to a later increment)
- Canonical architecture save-back from clusters
- Frontend visualization or UI display of clusters
- Advanced iterative clustering rounds beyond the multi-pass rule execution defined here
- AST enrichment or deep code parsing
- Language/version-specific analyzer packs
- Log-based or runtime-trace-based enrichment
- Inter-cluster relationship modeling (edges between clusters)
- Cluster hierarchy or nesting (parent-child cluster relationships)
- Cross-run cluster merging or diffing
- Pagination or streaming for large atom/relationship datasets (full in-memory load is acceptable for this increment)
