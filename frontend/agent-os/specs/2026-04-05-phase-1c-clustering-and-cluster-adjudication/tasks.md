# Task Breakdown: Phase 1c Clustering and Cluster Adjudication

## Overview
Total Tasks: 62
Increment: 9 of 16 (Legacy / Current-State Discovery)

This feature replaces the Phase 1c backbone stub with real evidence clustering: deterministic multi-pass clustering rules that group 1a atoms and 1b relationships into candidate clusters, a confidence-based triage engine with structural ambiguity checks, and a DecisionTask adjudication flow that routes ambiguous clustering outcomes through the gateway's LLM for resolution.

Three services are involved:
- **discovery-service** (Express/TypeScript): ClusteringRule interface/registry, 5 deterministic clustering rules, cluster triage engine, multi-pass execution with merge/refinement, Phase 1c orchestration in runManager
- **architecture-model-service** (Java/Spring Boot): `deleteByRunId` addition to the existing cluster JPA stack (no new migration needed)
- **gateway** (Express/TypeScript): 4 new prompt templates, extended prompt interpolation and resolution route for 1c DecisionTask types

## Task List

### Discovery-Service Type Definitions

#### Task Group 1: ClusteringRule, CandidateCluster, and 1c DecisionTask Types
**Dependencies:** None

- [x] 1.0 Complete discovery-service type definitions for Phase 1c
  - [x] 1.1 Write 5 focused tests for 1c type definitions and interfaces
    - Test that `CandidateCluster` has required fields: `members` (ClusterMember[]), `clusterType` (ClusterType), `confidence` (number 0.0-1.0), `formationReason` (string), `ruleId` (string)
    - Test that `ClusteringRule` interface has `id`, `name`, `description`, and `match()` method returning `CandidateCluster[]`
    - Test that `ClusteringRule.match()` accepts `atoms: EvidenceAtom[]`, `relationships: EvidenceRelationship[]`, and `existingClusters: CandidateCluster[]`
    - Test that the four new DecisionTask type discriminators (`cluster_merge_decision`, `cluster_type_classification`, `cluster_anchor_assignment`, `cluster_noise_decision`) are valid `DecisionTaskType` values
    - Test that the four new input interfaces (`ClusterMergeInput`, `ClusterTypeClassificationInput`, `ClusterAnchorAssignmentInput`, `ClusterNoiseDecisionInput`) and output interfaces (`ClusterMergeOutput`, `ClusterTypeClassificationOutput`, `ClusterAnchorAssignmentOutput`, `ClusterNoiseDecisionOutput`) are structurally correct with required fields
  - [x] 1.2 Create `ClusteringRule` interface and `CandidateCluster` interface in `discovery-service/src/types/clusteringRule.ts`
    - `CandidateCluster`: `members` (ClusterMember[]), `clusterType` (ClusterType), `confidence` (number 0.0-1.0), `formationReason` (string), `ruleId` (string), `name` (optional string)
    - `ClusteringRule`: `id` (string), `name` (string), `description` (string), `match(atoms: EvidenceAtom[], relationships: EvidenceRelationship[], existingClusters: CandidateCluster[]): CandidateCluster[]`
    - Import `EvidenceAtom` from `./evidenceAtom`, `EvidenceRelationship` from `./relationship`, `ClusterType`, `ClusterMember` from `./cluster`
    - Follow the `linkerRule.ts` documentation pattern exactly: header comment with data flow position, JSDoc on every field and interface
  - [x] 1.3 Expand `ClusterType` union in `discovery-service/src/types/cluster.ts`
    - Add `'package_module'` and `'unknown'` to the existing union
    - Update the JSDoc comment to include the two new types
    - Existing types (`service_boundary`, `data_domain`, `shared_library`, `api_layer`, `ui_module`) remain unchanged
  - [x] 1.4 Extend DecisionTask types in `discovery-service/src/types/decisionTask.ts`
    - Extend `DecisionTaskType` union with: `'cluster_merge_decision'`, `'cluster_type_classification'`, `'cluster_anchor_assignment'`, `'cluster_noise_decision'`
    - Create `ClusterMergeInput`: `clusterA` (cluster summary object with name, clusterType, confidence, memberCount, memberSummary), `clusterB` (same shape), `overlapMembers` (array of overlapping member IDs), `phase` ('1c')
    - Create `ClusterTypeClassificationInput`: `clusterSummary` (name, clusterType, confidence, memberCount, memberPaths, formationReason), `competingTypeSignals` (array of { type: ClusterType, signalStrength: number }), `phase` ('1c')
    - Create `ClusterAnchorAssignmentInput`: `clusterSummary` (name, clusterType, confidence, memberCount, memberPaths, formationReason), `candidateAnchors` (array of { anchorName: string, mappingPath: string }), `phase` ('1c')
    - Create `ClusterNoiseDecisionInput`: `clusterSummary` (name, clusterType, confidence, memberCount, memberPaths, formationReason), `noiseIndicators` (array of strings describing noise signals), `phase` ('1c')
    - Create `ClusterMergeOutput`: `decision` ('merge' | 'keep_separate'), `reasoning` (string)
    - Create `ClusterTypeClassificationOutput`: `selectedType` (ClusterType), `adjustedConfidence` (number), `reasoning` (string)
    - Create `ClusterAnchorAssignmentOutput`: `selectedAnchor` (string | null), `adjustedConfidence` (number), `reasoning` (string)
    - Create `ClusterNoiseDecisionOutput`: `decision` ('noise' | 'keep'), `reasoning` (string)
    - Add all four input interfaces to `DecisionTaskInput` union
    - Add all four output interfaces to `DecisionTaskOutput` union
  - [x] 1.5 Update barrel export in `discovery-service/src/types/index.ts`
    - Export all types from `./clusteringRule`: `ClusteringRule`, `CandidateCluster`
    - Export the new types from `./decisionTask`: `ClusterMergeInput`, `ClusterMergeOutput`, `ClusterTypeClassificationInput`, `ClusterTypeClassificationOutput`, `ClusterAnchorAssignmentInput`, `ClusterAnchorAssignmentOutput`, `ClusterNoiseDecisionInput`, `ClusterNoiseDecisionOutput`
    - Export `'package_module'` and `'unknown'` are already covered by the existing `ClusterType` re-export
  - [x] 1.6 Ensure type definition tests pass
    - Run ONLY the 5 tests written in 1.1
    - Verify TypeScript compilation succeeds with no type errors

**Acceptance Criteria:**
- The 5 tests written in 1.1 pass
- All new types are correctly exported from the barrel export
- `CandidateCluster` is a standalone internal type (not persisted directly)
- `ClusteringRule.match()` signature accepts atoms, relationships, and existing clusters
- Four new DecisionTask types with typed input/output interfaces compile without errors
- TypeScript compiler reports no errors

---

### Discovery-Service Clustering Rules and Triage Engine

#### Task Group 2: Cluster Defaults and Clustering Rule Registry
**Dependencies:** Task Group 1

- [x] 2.0 Complete cluster defaults and registry
  - [x] 2.1 Write 3 focused tests for thresholds and registry
    - Test that `AUTO_ACCEPT_THRESHOLD` (0.8), `AMBIGUOUS_THRESHOLD` (0.4), and `OVERLAP_MERGE_THRESHOLD` (0.7) are exported with correct defaults from `clusterDefaults.ts`
    - Test that `initializeClusteringRuleRegistry()` populates the registry with the expected number of rules (5)
    - Test that `registerClusteringRule()` adds a new rule and `getClusteringRuleRegistry()` returns it
  - [x] 2.2 Create `discovery-service/src/constants/clusterDefaults.ts`
    - Export `AUTO_ACCEPT_THRESHOLD = 0.8`
    - Export `AMBIGUOUS_THRESHOLD = 0.4`
    - Export `OVERLAP_MERGE_THRESHOLD = 0.7` (70% member overlap for automatic merge)
    - Export `NOISE_MIN_MEMBERS = 2` (minimum atom members; fewer triggers noise review)
    - Export `TYPE_DOMINANCE_THRESHOLD = 0.6` (minimum signal strength for type classification certainty)
    - Follow the `linkerDefaults.ts` pattern (documented constants with JSDoc)
  - [x] 2.3 Create clustering rule registry in `discovery-service/src/services/clusteringRuleRegistry.ts`
    - Follow the `linkerRuleRegistry.ts` pattern exactly: in-memory `Map<string, ClusteringRule>`
    - Export `initializeClusteringRuleRegistry()`, `getClusteringRuleRegistry()`, `registerClusteringRule()`
    - `initializeClusteringRuleRegistry()` creates a fresh Map, calls `registerAllClusteringRules()`, logs registry size
  - [x] 2.4 Create `discovery-service/src/services/clusteringRules/index.ts` barrel export
    - Export all 5 rule instances
    - Export `registerAllClusteringRules()` function that registers all 5 rules
    - Follow the `linkerRules/index.ts` pattern exactly
  - [x] 2.5 Ensure thresholds and registry tests pass
    - Run ONLY the 3 tests written in 2.1

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- Constants are centrally defined in `clusterDefaults.ts`, not scattered as magic numbers
- Registry follows the established `linkerRuleRegistry.ts` pattern
- `registerAllClusteringRules()` is callable from `initializeClusteringRuleRegistry()`

#### Task Group 3: Five Deterministic Clustering Rules
**Dependencies:** Task Group 2

- [x] 3.0 Complete all five clustering rules
  - [x] 3.1 Write 8 focused tests for the five clustering rules
    - `anchorHintClusterRule`: test that atoms matching a `repoApplicationMappings` path are grouped into a named cluster with confidence 0.95 and correct clusterType; test that atoms not matching any mapping are not included
    - `directoryClusterRule`: test that `file_structure` atoms sharing a common directory prefix are grouped into a `package_module` cluster; test that atoms in unrelated directories produce separate clusters
    - `importDensityClusterRule`: test that atoms with high mutual `imports`/`calls`/`references` relationship density are grouped into a `service_boundary` cluster; test that atoms with no inter-relationships produce no cluster
    - `dataUsageClusterRule`: test that atoms connected by `uses_data` relationships or `string_pattern` atoms with SQL/table indicators are grouped into a `data_domain` cluster; test that non-data atoms are not included
    - Note: `routePrefixClusterRule` tests are covered by one positive test (atoms sharing route prefix grouped into `api_layer` cluster) -- total 8 tests across the 5 rules
  - [x] 3.2 Implement `anchorHintClusterRule` in `discovery-service/src/services/clusteringRules/anchorHintClusterRule.ts`
    - Reads `repoApplicationMappings` from the match input context (passed through atoms' data or via a config accessor)
    - Note: The rule needs access to discovery config anchor hints. These will be passed as a configuration context. For the rule interface, anchor hints can be threaded through the `existingClusters` parameter convention or via a module-level configuration setter called before rule execution. Use a module-level config setter (e.g., `setAnchorHints(mappings)`) since adding a parameter would diverge from the ClusteringRule interface.
    - For each mapping entry (path -> application name), filter atoms whose `relativePath` starts with the mapping path
    - Produce clusters with the application name as `name`, `confidence: 0.95`, `clusterType` as `service_boundary` (default for anchor-mapped clusters)
    - Set `ruleId` to `'anchor-hint'`, `formationReason` to `'Phase 0 repoApplicationMapping: <path> -> <name>'`
  - [x] 3.3 Implement `directoryClusterRule` in `discovery-service/src/services/clusteringRules/directoryClusterRule.ts`
    - Filter atoms by `type === 'file_structure'`
    - Use `contains` relationships to identify directory groupings
    - Group atoms sharing a common directory prefix (at least 2 levels deep) into `package_module` clusters
    - Confidence based on directory depth and atom count: deeper shared prefixes with more atoms get higher confidence (0.5-0.85 range)
    - Atoms already in `existingClusters` (from prior passes, e.g., anchor hints) can be included but contribute lower confidence weight
    - Set `ruleId` to `'directory-cluster'`
  - [x] 3.4 Implement `importDensityClusterRule` in `discovery-service/src/services/clusteringRules/importDensityClusterRule.ts`
    - Filter relationships by type: `imports`, `calls`, `references`
    - Build an adjacency map of atom-to-atom relationships
    - Identify densely connected subgraphs (atoms with 3+ mutual connections)
    - Produce `service_boundary` clusters with confidence proportional to connection density (0.5-0.85 range)
    - Set `ruleId` to `'import-density-cluster'`
  - [x] 3.5 Implement `dataUsageClusterRule` in `discovery-service/src/services/clusteringRules/dataUsageClusterRule.ts`
    - Filter relationships by type: `uses_data`
    - Filter atoms: `string_pattern` atoms with SQL/table-related `patternName` values
    - Group atoms that share data access patterns (e.g., multiple atoms referencing the same table)
    - Produce `data_domain` clusters with confidence 0.6-0.85 based on shared data references
    - Set `ruleId` to `'data-usage-cluster'`
  - [x] 3.6 Implement `routePrefixClusterRule` in `discovery-service/src/services/clusteringRules/routePrefixClusterRule.ts`
    - Filter atoms: `string_pattern` atoms with route-related `patternName` values (e.g., `'route_definition'`, `'http_endpoint'`)
    - Group atoms sharing HTTP route prefixes (e.g., `/api/users/*`, `/api/orders/*`)
    - Produce `api_layer` clusters with confidence 0.6-0.8 based on route prefix specificity
    - Set `ruleId` to `'route-prefix-cluster'`
  - [x] 3.7 Register all five rules in `clusteringRules/index.ts` via `registerAllClusteringRules()`
    - Registration order defines pass order: anchorHintClusterRule first, then directoryClusterRule, importDensityClusterRule, dataUsageClusterRule, routePrefixClusterRule
  - [x] 3.8 Ensure clustering rule tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify each rule operates as a self-contained, testable unit

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Each rule is in its own file under `discovery-service/src/services/clusteringRules/`
- Each rule implements the `ClusteringRule` interface
- Confidence scores fall within the specified ranges per rule
- Rules are correctly registered in the registry in the specified pass order
- `anchorHintClusterRule` uses Phase 0 anchor hints as high-confidence seeding signals

#### Task Group 4: Multi-Pass Clustering Execution and Merge/Refinement
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete multi-pass clustering execution engine
  - [x] 4.1 Write 5 focused tests for multi-pass execution and merge/refinement
    - Test that rules execute in ordered passes: anchor hints first, then directory, then import density, then data usage, then route prefix -- each pass receives `existingClusters` from all prior passes
    - Test that two candidate clusters sharing >= 70% of atom members are automatically merged into one, keeping the higher confidence and combining formation reasons
    - Test that candidate clusters sharing < 70% of atom members are kept as separate clusters
    - Test that candidates with fewer than 2 atom members after all passes are flagged with a `noiseFlag: true` property
    - Test that the full pipeline (all 5 rules -> merge -> noise flag) produces the correct final candidate cluster list
  - [x] 4.2 Create `discovery-service/src/services/clusteringEngine.ts`
    - Export `executeClusteringPasses(atoms, relationships, ruleRegistry, anchorHints?): CandidateCluster[]`
    - Iterate over registered rules in order; for each rule, call `rule.match(atoms, relationships, existingClusters)` and collect results
    - After each pass, run `mergeOverlappingClusters(allCandidates)` to detect and merge overlaps
    - `mergeOverlappingClusters()`: for each pair of clusters, compute atom member overlap percentage; if >= `OVERLAP_MERGE_THRESHOLD`, merge them (keep higher confidence, combine formation reasons and ruleIds, union member sets)
    - After all passes, flag clusters with fewer than `NOISE_MIN_MEMBERS` atom members as noise candidates (add `noiseFlag: true` marker)
    - Before running rules, call `setAnchorHints()` on the `anchorHintClusterRule` module if anchor hints are provided
  - [x] 4.3 Ensure multi-pass execution tests pass
    - Run ONLY the 5 tests written in 4.1

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- Rules execute in the specified pass order
- Merge/refinement correctly handles 70% overlap threshold
- Noise flagging identifies under-populated clusters
- The engine is a pure function with no I/O dependencies (aside from configuration seeding)

#### Task Group 5: Cluster Triage Engine
**Dependencies:** Task Groups 1, 2, 4

- [x] 5.0 Complete cluster triage engine
  - [x] 5.1 Write 6 focused tests for the cluster triage engine
    - Test high-confidence candidates (>= 0.8) are placed in the `accepted` bucket
    - Test mid-confidence candidates (0.4-0.79) are placed in the `ambiguous` bucket
    - Test low-confidence candidates (< 0.4) are placed in the `discarded` bucket
    - Test structural ambiguity: two clusters with 40-70% overlap trigger a `cluster_merge_decision` ambiguity group
    - Test structural ambiguity: a cluster where no single type signal exceeds 60% triggers a `cluster_type_classification` ambiguity group
    - Test structural ambiguity: a noise-flagged cluster (< 2 atom members or dominated by generated/test patterns) triggers a `cluster_noise_decision` ambiguity group
  - [x] 5.2 Implement cluster triage in `discovery-service/src/services/clusterTriageEngine.ts`
    - Follow the `triageEngine.ts` pattern: pure function with no I/O
    - Export `triageClusterCandidates(candidates: CandidateCluster[], anchorNames?: string[]): ClusterTriageResult`
    - `ClusterTriageResult` interface: `accepted` (CandidateCluster[]), `ambiguous` (CandidateCluster[]), `discarded` (CandidateCluster[]), `ambiguityGroups` (keyed by ambiguity type: `merge_review`, `split_review`, `type_review`, `noise_review`, `anchor_review`)
    - Step 1: Partition by confidence thresholds (import from `clusterDefaults.ts`)
    - Step 2: Layer structural ambiguity checks on the ambiguous bucket:
      - **Merge review**: detect pairs with 40-70% atom member overlap
      - **Type review**: detect clusters where no single type signal exceeds `TYPE_DOMINANCE_THRESHOLD`
      - **Noise review**: detect clusters with `noiseFlag: true` or dominated by test/config/generated file patterns
      - **Anchor review**: detect clusters that match anchor hint names but have low confidence (candidate for `cluster_anchor_assignment`)
    - Each ambiguity group maps to a specific DecisionTask type
  - [x] 5.3 Ensure cluster triage engine tests pass
    - Run ONLY the 6 tests written in 5.1

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Triage function is a pure, standalone unit with no I/O dependencies
- Three confidence buckets are correctly populated based on threshold constants
- Structural ambiguity checks detect merge overlaps, type uncertainty, noise, and anchor candidates
- Each ambiguity group maps to a specific 1c DecisionTask type

---

### Architecture-Model-Service: Cluster Delete-by-RunId

#### Task Group 6: deleteByRunId for Cluster JPA Stack
**Dependencies:** None (can be developed in parallel with Task Groups 1-5)

- [x] 6.0 Complete cluster deleteByRunId capability
  - [x] 6.1 Write 3 focused tests for the delete capability (JUnit 5)
    - Test `DiscoveryClusterService.deleteByRunId` removes all clusters (and cascade-deletes members) for a given run
    - Test `DiscoveryClusterController` DELETE endpoint returns 200 with count of deleted clusters
    - Test that deleting clusters for a non-existent runId returns 0 without error
  - [x] 6.2 Add `deleteByRunId` method to `DiscoveryClusterRepository`
    - Add `void deleteByRunId(UUID runId)` derived query method
    - Spring Data JPA derives the DELETE query automatically from the method name
    - Cascade delete of members is handled by `CascadeType.ALL` + `orphanRemoval = true` on the entity's `@OneToMany`
  - [x] 6.3 Add `deleteByRunId` method to `DiscoveryClusterService`
    - `@Transactional` method: `deleteByRunId(UUID runId): long`
    - Count clusters before delete (for return value), then call `clusterRepository.deleteByRunId(runId)`, return count
  - [x] 6.4 Add DELETE endpoint to `DiscoveryClusterController`
    - `DELETE /api/model/projects/{projectId}/discovery/runs/{runId}/clusters`
    - Calls `discoveryClusterService.deleteByRunId(runId)`
    - Returns `Map.of("deleted", count)`
  - [x] 6.5 Ensure JPA delete tests pass
    - Run ONLY the 3 tests written in 6.1

**Acceptance Criteria:**
- The 3 tests written in 6.1 pass
- DELETE endpoint cascade-deletes cluster members along with clusters
- No new SQL migration needed (cluster_type is TEXT, no schema changes)
- Follows existing `@ConditionalOnProperty` and annotation patterns

---

### Discovery-Service Client Method: deleteClustersByRunId

#### Task Group 7: archModelClient Cluster Delete Method
**Dependencies:** Task Groups 1, 6

- [x] 7.0 Complete archModelClient extension for cluster delete
  - [x] 7.1 Write 2 focused tests for the new client method
    - Test `deleteClustersByRunId` sends DELETE to the correct URL `/api/model/projects/{projectId}/discovery/runs/{runId}/clusters`
    - Test `deleteClustersByRunId` returns the count from the response body
  - [x] 7.2 Add `deleteClustersByRunId` method to `discovery-service/src/services/archModelClient.ts`
    - `async deleteClustersByRunId(projectId: string, runId: string): Promise<number>`
    - Sends DELETE to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}/clusters`
    - Extracts `deleted` count from response body
    - Follow existing client method patterns (error handling, URL encoding)
  - [x] 7.3 Ensure client method tests pass
    - Run ONLY the 2 tests written in 7.1

**Acceptance Criteria:**
- The 2 tests written in 7.1 pass
- Method follows the identical pattern of existing archModelClient methods
- URL construction uses `encodeURIComponent` for path parameters

---

### Gateway: 1c DecisionTask Prompt Templates and Resolution Extensions

#### Task Group 8: LLM Prompt Templates for 1c Tasks
**Dependencies:** None (can be developed in parallel with all other groups)

- [x] 8.0 Complete LLM prompt templates for 1c DecisionTask types
  - [x] 8.1 Create `gateway/src/config/prompts/discovery.cluster-merge-decision.prompt.md`
    - System context: "You are analyzing evidence clusters to decide whether two overlapping clusters should be merged into one or kept separate."
    - Input sections for: Cluster A summary (name, type, confidence, member count, member paths), Cluster B summary (same), overlapping members list
    - Expected JSON output format: `{ "decision": "merge"|"keep_separate", "reasoning": "<brief explanation>" }`
    - Explicit instruction to return ONLY valid JSON
  - [x] 8.2 Create `gateway/src/config/prompts/discovery.cluster-type-classification.prompt.md`
    - System context: "You are analyzing an evidence cluster to determine its most appropriate architectural type."
    - Input sections for: cluster summary (name, type, confidence, member count, member paths, formation reason), competing type signals (type, signal strength)
    - Expected JSON output format: `{ "selectedType": "<ClusterType>", "adjustedConfidence": <0.0-1.0>, "reasoning": "<brief explanation>" }`
    - List valid ClusterType values in the prompt instructions
  - [x] 8.3 Create `gateway/src/config/prompts/discovery.cluster-anchor-assignment.prompt.md`
    - System context: "You are analyzing an evidence cluster to determine which Phase 0 anchor (known application name) it best corresponds to, if any."
    - Input sections for: cluster summary, candidate anchors (anchor name, mapping path)
    - Expected JSON output format: `{ "selectedAnchor": "<name>"|null, "adjustedConfidence": <0.0-1.0>, "reasoning": "<brief explanation>" }`
  - [x] 8.4 Create `gateway/src/config/prompts/discovery.cluster-noise-decision.prompt.md`
    - System context: "You are analyzing an evidence cluster to determine whether it represents meaningful code structure or noise (test scaffolding, generated code, configuration boilerplate)."
    - Input sections for: cluster summary, noise indicators list
    - Expected JSON output format: `{ "decision": "noise"|"keep", "reasoning": "<brief explanation>" }`

**Acceptance Criteria:**
- Prompts are stored as `.prompt.md` files following the existing naming convention (`discovery.<task-type-kebab-case>.prompt.md`)
- Prompts specify the exact JSON response schema the LLM must produce
- Prompts include clear instructions about returning valid JSON only
- Each prompt includes relevant interpolation variables matching the 1c input interfaces

#### Task Group 9: Gateway Prompt Interpolation and Route Extensions for 1c
**Dependencies:** Task Groups 1, 8

- [x] 9.0 Complete gateway prompt infrastructure extensions for 1c
  - [x] 9.1 Write 5 focused tests for the 1c gateway extensions (Jest)
    - Test that `loadPromptTemplate` accepts the four new 1c task type strings and loads the correct `.prompt.md` files
    - Test that `interpolateTemplate` for `cluster_merge_decision` correctly substitutes cluster A and cluster B summary variables
    - Test that `interpolateTemplate` for `cluster_type_classification` correctly substitutes cluster summary and competing type signal variables
    - Test that `buildMessagesForTask` for 1c task types produces the correct system + user message array
    - Test that the resolution endpoint processes a `cluster_merge_decision` task and returns resolved result with `decision` in outputData
  - [x] 9.2 Extend `PROMPT_TEMPLATE_FILES` map in `gateway/src/routes/discoveryDecisionTaskPrompts.ts`
    - Add entries: `'cluster_merge_decision': 'discovery.cluster-merge-decision.prompt.md'`, `'cluster_type_classification': 'discovery.cluster-type-classification.prompt.md'`, `'cluster_anchor_assignment': 'discovery.cluster-anchor-assignment.prompt.md'`, `'cluster_noise_decision': 'discovery.cluster-noise-decision.prompt.md'`
  - [x] 9.3 Widen the `taskType` type parameter on `loadPromptTemplate`, `interpolateTemplate`, `buildMessagesForTask`
    - Change from `'confirm_relationship' | 'resolve_competing_relationships'` to include all six values: `'confirm_relationship' | 'resolve_competing_relationships' | 'cluster_merge_decision' | 'cluster_type_classification' | 'cluster_anchor_assignment' | 'cluster_noise_decision'`
    - Consider defining this as a named type alias (e.g., `DecisionTaskTypeString`) for maintainability
  - [x] 9.4 Extend `interpolateTemplate()` with four new branches for 1c task types
    - `cluster_merge_decision`: extract `clusterA`, `clusterB`, `overlapMembers` from inputData; interpolate `{{CLUSTER_A_NAME}}`, `{{CLUSTER_A_TYPE}}`, `{{CLUSTER_A_CONFIDENCE}}`, `{{CLUSTER_A_MEMBER_COUNT}}`, `{{CLUSTER_A_MEMBERS}}`, `{{CLUSTER_B_NAME}}`, `{{CLUSTER_B_TYPE}}`, `{{CLUSTER_B_CONFIDENCE}}`, `{{CLUSTER_B_MEMBER_COUNT}}`, `{{CLUSTER_B_MEMBERS}}`, `{{OVERLAP_MEMBERS}}`
    - `cluster_type_classification`: extract `clusterSummary`, `competingTypeSignals`; interpolate `{{CLUSTER_NAME}}`, `{{CLUSTER_TYPE}}`, `{{CLUSTER_CONFIDENCE}}`, `{{CLUSTER_MEMBER_COUNT}}`, `{{CLUSTER_MEMBERS}}`, `{{CLUSTER_FORMATION_REASON}}`, `{{COMPETING_TYPE_SIGNALS}}`
    - `cluster_anchor_assignment`: extract `clusterSummary`, `candidateAnchors`; interpolate `{{CLUSTER_NAME}}`, `{{CLUSTER_TYPE}}`, `{{CLUSTER_CONFIDENCE}}`, `{{CLUSTER_MEMBER_COUNT}}`, `{{CLUSTER_MEMBERS}}`, `{{CLUSTER_FORMATION_REASON}}`, `{{CANDIDATE_ANCHORS}}`
    - `cluster_noise_decision`: extract `clusterSummary`, `noiseIndicators`; interpolate `{{CLUSTER_NAME}}`, `{{CLUSTER_TYPE}}`, `{{CLUSTER_CONFIDENCE}}`, `{{CLUSTER_MEMBER_COUNT}}`, `{{CLUSTER_MEMBERS}}`, `{{CLUSTER_FORMATION_REASON}}`, `{{NOISE_INDICATORS}}`
  - [x] 9.5 Extend `buildMessagesForTask()` and the internal `buildUserMessage()` with 1c user message text
    - `cluster_merge_decision`: "Please evaluate whether the two overlapping clusters described above should be merged or kept separate. Return your decision as valid JSON."
    - `cluster_type_classification`: "Please evaluate the cluster described above and select the most appropriate architectural type from the competing signals. Return your decision as valid JSON."
    - `cluster_anchor_assignment`: "Please evaluate the cluster described above and determine which Phase 0 anchor it best corresponds to, or none. Return your decision as valid JSON."
    - `cluster_noise_decision`: "Please evaluate whether the cluster described above represents meaningful code structure or noise. Return your decision as valid JSON."
  - [x] 9.6 Widen the `DecisionTaskInput.taskType` union in `gateway/src/routes/discoveryDecisionTasks.ts`
    - Change the local `DecisionTaskInput` interface's `taskType` field from `'confirm_relationship' | 'resolve_competing_relationships'` to include the four new 1c values
  - [x] 9.7 Ensure gateway 1c extension tests pass
    - Run ONLY the 5 tests written in 9.1

**Acceptance Criteria:**
- The 5 tests written in 9.1 pass
- All four new task types are supported in `PROMPT_TEMPLATE_FILES`, `loadPromptTemplate`, `interpolateTemplate`, `buildMessagesForTask`
- Type parameters are widened to accept all six DecisionTask type strings
- The resolution endpoint correctly processes 1c task types without changes to the core resolution loop (only prompt/interpolation changes needed)

---

### Discovery-Service: Phase 1c Orchestration

#### Task Group 10: Replace executeStep1c Stub with Real Orchestration
**Dependencies:** Task Groups 1, 2, 3, 4, 5, 7

- [x] 10.0 Complete Phase 1c orchestration logic
  - [x] 10.1 Write 7 focused tests for the executeStep1c orchestration
    - Test full happy path: mock atoms and relationships returned, mock rules producing candidate clusters across all confidence bands, verify auto-accepted clusters are persisted, DecisionTasks are created and resolved, summary metadata is correct
    - Test that high-confidence candidate clusters bypass DecisionTask creation and are persisted directly via `bulkSaveClusters`
    - Test that low-confidence candidate clusters (below AMBIGUOUS_THRESHOLD) are discarded -- not persisted and not turned into DecisionTasks
    - Test that merge ambiguity (40-70% overlap) produces a `cluster_merge_decision` DecisionTask with correct `ClusterMergeInput`
    - Test that a resolved merge decision (decision: 'merge') causes the two source clusters to be combined into one in the final persisted set
    - Test that noise-classified clusters (noise DecisionTask returns decision: 'noise') are removed from the final persisted set
    - Test the delete-and-recreate flow: after adjudication, `deleteClustersByRunId` is called before `bulkSaveClusters` with the final cluster set
  - [x] 10.2 Replace `executeStep1c` stub in `discovery-service/src/services/runManager.ts`
    - Keep the same function signature: `(projectId: string, runId: string) => Promise<Record<string, unknown>>`
    - Step 1: Fetch 1a atoms via `archModelClient.getEvidenceByRun(projectId, runId)`
    - Step 2: Fetch 1b relationships via `archModelClient.getRelationshipsByRun(projectId, runId)`
    - Step 3: Fetch discovery config via `archModelClient.getDiscoveryConfig(projectId)` for anchor hints; extract `repoApplicationMappings` from `config_payload`
    - Step 4: Initialize and run clustering rules via `executeClusteringPasses(atoms, relationships, getClusteringRuleRegistry(), anchorHints)`
    - Step 5: Triage candidate clusters via `triageClusterCandidates(candidateClusters, anchorNames)`
    - Step 6: Convert accepted candidates to `EvidenceCluster` objects (generate UUIDs, set runId, populate `data` payload with formationReason, ruleIds, dominantLanguage, directoryRoot, memberSummary, adjudicationHistory as empty array), persist via `archModelClient.bulkSaveClusters()` in batches
    - Step 7: Create DecisionTasks for ambiguous clusters based on ambiguity group type; populate typed `inputData` with `phase: '1c'`; persist via `archModelClient.bulkSaveDecisionTasks()`
    - Step 8: Resolve tasks via `gatewayClient.resolveDecisionTasks(projectId, runId, pendingTasks)`
    - Step 9: Process adjudication results -- apply merge/split/type/noise decisions to in-memory cluster list: merged clusters combine members, take higher confidence, concatenate formation reasons, record merge taskId in `adjudicationHistory`; noise clusters removed; type-reclassified clusters update `clusterType` and record in `adjudicationHistory`
    - Step 10: Delete-and-recreate: call `archModelClient.deleteClustersByRunId(projectId, runId)`, then `archModelClient.bulkSaveClusters(projectId, runId, finalClusters)` in batches
    - Step 11: Update each DecisionTask record via `archModelClient.updateDecisionTask()` with resolved status, outputData, resolvedAt
    - Step 12: Return summary metadata
  - [x] 10.3 Implement the cluster data payload builder
    - Create a helper function `buildClusterDataPayload(candidate: CandidateCluster, atoms: EvidenceAtom[]): Record<string, unknown>`
    - Populate: `formationReason` (string), `ruleIds` (string[]), `dominantLanguage` (most common language among member atoms), `directoryRoot` (common path prefix of member atoms), `memberSummary` ({ atomCount, relationshipCount }), `adjudicationHistory` (initially empty array)
  - [x] 10.4 Implement summary metadata return
    - `clusterCount`: total clusters persisted after adjudication
    - `autoAcceptedCount`: clusters persisted without LLM review
    - `decisionTaskCount`: total DecisionTasks created
    - `decisionTaskResolvedCount`: tasks successfully resolved by LLM
    - `decisionTaskFailedCount`: tasks that failed LLM resolution
    - `discardedCount`: candidates auto-discarded below AMBIGUOUS_THRESHOLD
    - `upstreamAtomCount`: total 1a atoms fetched
    - `upstreamRelationshipCount`: total 1b relationships fetched
  - [x] 10.5 Add imports for new dependencies in runManager.ts
    - Import `getClusteringRuleRegistry` from `./clusteringRuleRegistry`
    - Import `executeClusteringPasses` from `./clusteringEngine`
    - Import `triageClusterCandidates` from `./clusterTriageEngine`
    - Import `CandidateCluster`, `ClusterMergeInput`, `ClusterMergeOutput`, `ClusterTypeClassificationInput`, `ClusterTypeClassificationOutput`, `ClusterAnchorAssignmentInput`, `ClusterAnchorAssignmentOutput`, `ClusterNoiseDecisionInput`, `ClusterNoiseDecisionOutput` from types
    - Import cluster defaults from `../constants/clusterDefaults`
  - [x] 10.6 Initialize clustering rule registry at discovery-service startup
    - Call `initializeClusteringRuleRegistry()` in the service's startup/initialization path (alongside `initializeLinkerRuleRegistry()` and `initializeAnalyzerRegistry()`)
    - Verify this is called before any run can execute
  - [x] 10.7 Ensure orchestration tests pass
    - Run ONLY the 7 tests written in 10.1

**Acceptance Criteria:**
- The 7 tests written in 10.1 pass
- `executeStep1c` function signature remains compatible with the existing step sequencing in `startRun`
- Summary metadata includes all 8 required fields
- Cluster `data` payload contains formationReason, ruleIds, dominantLanguage, directoryRoot, memberSummary, adjudicationHistory
- Delete-and-recreate semantics are used after adjudication
- Merged clusters combine members, take higher confidence, concatenate formation reasons, and record merge taskId in adjudicationHistory
- Noise-classified clusters are excluded from final persistence
- Clustering rule registry is initialized before runs can execute

---

### Testing: Review and Gap Analysis

#### Task Group 11: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-10

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests from Task Groups 1-10
    - Review the 5 type definition tests (Task 1.1)
    - Review the 3 threshold/registry tests (Task 2.1)
    - Review the 8 clustering rule tests (Task 3.1)
    - Review the 5 multi-pass execution tests (Task 4.1)
    - Review the 6 cluster triage engine tests (Task 5.1)
    - Review the 3 JPA delete tests (Task 6.1)
    - Review the 2 client method tests (Task 7.1)
    - Review the 5 gateway extension tests (Task 9.1)
    - Review the 7 orchestration tests (Task 10.1)
    - Total existing tests: approximately 44 tests
  - [x] 11.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus on integration points: clustering engine -> triage -> DecisionTask creation -> gateway resolution -> adjudication -> delete-and-recreate
    - Assess whether the merge/refinement logic has adequate edge-case coverage
    - Do NOT assess entire application test coverage
  - [x] 11.3 Write up to 10 additional strategic tests maximum
    - Possible gap areas (implement only if gaps exist after review):
      - End-to-end orchestration test with all 5 rules producing clusters across all 3 confidence tiers
      - Cluster triage engine edge case: empty candidate list returns empty buckets and no ambiguity groups
      - Multi-pass merge: three clusters with pairwise overlaps are iteratively merged correctly
      - Merge/refinement: merged cluster retains the correct combined member set with no duplicates
      - Gateway interpolation: all four 1c prompt templates produce valid interpolated output with no unresolved `{{...}}` placeholders
      - archModelClient deleteClustersByRunId: verify encodeURIComponent on path params with special characters
      - executeStep1c with zero atoms and zero relationships returns zero-count summary without errors
      - Noise flagging: cluster with only 1 atom member is flagged, cluster with 3 atom members is not
      - Anchor hint rule: overlapping anchor mappings (e.g., `/services/` and `/services/payment/`) are resolved to the more specific mapping
      - DecisionTask adjudication: type reclassification updates clusterType and records in adjudicationHistory
  - [x] 11.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 9.1, 10.1, and 11.3)
    - Expected total: approximately 44-54 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 44-54 tests total)
- Critical end-to-end orchestration flow is covered
- No more than 10 additional tests added to fill gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

```
Phase A: Foundation (parallel tracks)
  Track 1: Task Group 1 (Types) -> Task Group 2 (Registry/Defaults) -> Task Group 3 (Rules)
  Track 2: Task Group 6 (JPA Delete -- independent Java work)
  Track 3: Task Group 8 (Prompt Templates -- independent file creation)

Phase B: Engine and Integration Layer (after Phase A)
  Task Group 4 (Multi-Pass Clustering Engine -- needs types + rules from TG1-3)
  Task Group 5 (Cluster Triage Engine -- needs types + defaults from TG1-2)
  Task Group 7 (archModelClient delete method -- needs TG1 types + TG6 JPA endpoint)
  Task Group 9 (Gateway Prompt Extensions -- needs TG1 types + TG8 prompts)

Phase C: Orchestration (after Phase B)
  Task Group 10 (Phase 1c Orchestration -- depends on all Phase A and B groups)

Phase D: Testing (after Phase C)
  Task Group 11 (Test Review & Gap Analysis)
```

**Critical path**: Task Group 1 -> Task Group 2 -> Task Group 3 -> Task Group 4 -> Task Group 10 (discovery-service TypeScript work is largely sequential)

**Parallelizable**:
- Task Group 6 (Java/Spring Boot JPA delete) can proceed independently of all TypeScript work
- Task Group 8 (prompt template files) can proceed independently of all code work
- Task Groups 4 and 5 can be developed in parallel once TG1-3 are complete
- Task Group 7 can proceed once TG1 and TG6 are complete
- Task Group 9 can proceed once TG1 and TG8 are complete

## File Inventory

### New Files (14 files)

**discovery-service (9 new files):**
- `discovery-service/src/types/clusteringRule.ts`
- `discovery-service/src/constants/clusterDefaults.ts`
- `discovery-service/src/services/clusteringRuleRegistry.ts`
- `discovery-service/src/services/clusteringRules/index.ts`
- `discovery-service/src/services/clusteringRules/anchorHintClusterRule.ts`
- `discovery-service/src/services/clusteringRules/directoryClusterRule.ts`
- `discovery-service/src/services/clusteringRules/importDensityClusterRule.ts`
- `discovery-service/src/services/clusteringRules/dataUsageClusterRule.ts`
- `discovery-service/src/services/clusteringRules/routePrefixClusterRule.ts`
- `discovery-service/src/services/clusteringEngine.ts`
- `discovery-service/src/services/clusterTriageEngine.ts`
- `discovery-service/src/__tests__/clusteringTypes.test.ts`
- `discovery-service/src/__tests__/clusteringRulesAndTriage.test.ts`
- `discovery-service/src/__tests__/phase1cOrchestration.test.ts`

**gateway (4 new files):**
- `gateway/src/config/prompts/discovery.cluster-merge-decision.prompt.md`
- `gateway/src/config/prompts/discovery.cluster-type-classification.prompt.md`
- `gateway/src/config/prompts/discovery.cluster-anchor-assignment.prompt.md`
- `gateway/src/config/prompts/discovery.cluster-noise-decision.prompt.md`

### Modified Files (9 files)

**discovery-service (5 modified files):**
- `discovery-service/src/types/cluster.ts` -- add `package_module` and `unknown` to ClusterType union
- `discovery-service/src/types/decisionTask.ts` -- add 4 new task types with typed input/output interfaces
- `discovery-service/src/types/index.ts` -- add exports for clusteringRule types and new decisionTask types
- `discovery-service/src/services/archModelClient.ts` -- add `deleteClustersByRunId` method
- `discovery-service/src/services/runManager.ts` -- replace executeStep1c stub with real orchestration logic

**architecture-model-service (3 modified files):**
- `architecture-model-service/.../repository/entity/DiscoveryClusterRepository.java` -- add `deleteByRunId` method
- `architecture-model-service/.../service/DiscoveryClusterService.java` -- add `deleteByRunId` method
- `architecture-model-service/.../controller/DiscoveryClusterController.java` -- add DELETE endpoint

**gateway (2 modified files):**
- `gateway/src/routes/discoveryDecisionTaskPrompts.ts` -- extend PROMPT_TEMPLATE_FILES, widen type parameters, add 4 interpolation branches and user message builders
- `gateway/src/routes/discoveryDecisionTasks.ts` -- widen local DecisionTaskInput.taskType union
