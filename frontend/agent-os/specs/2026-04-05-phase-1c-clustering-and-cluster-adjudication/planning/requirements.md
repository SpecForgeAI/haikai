# Spec Requirements: Phase 1c Clustering and Cluster Adjudication

## Initial Description

This is increment **9 of 16** for the new **legacy / current-state discovery** capability.

Previous increments established:
- discovery capability skeleton,
- Phase 0 framing and persistence,
- discovery run orchestration,
- Phase 1a universal evidence extraction,
- Phase 1 evidence schema backbone (1a-1d),
- Phase 1b evidence linking and initial DecisionTask engine.

This increment introduces **Phase 1c**:
- grouping linked evidence into coherent clusters,
- and using bounded DecisionTasks to resolve ambiguous clustering outcomes.

**Goal:** Implement Phase 1c -- evidence clustering, so the system can:
- take the 1a + 1b evidence graph,
- group evidence into meaningful technical bundles,
- classify those bundles at a pre-architecture level,
- and prepare them for later candidate generation in 1d.

At the end of this increment:
- the system can produce evidence clusters (1c),
- and selectively use LLM adjudication for ambiguous merge/split/type decisions.

**In scope:**
1. Deterministic clustering over the evidence graph using signals such as shared directory/package structure, naming similarity, shared references/relationship density, shared route prefixes, shared SQL/table usage, shared UI labels/titles, Phase 0 anchor hints
2. Cluster creation with members, type/classification, confidence, and formation reason/provenance
3. Initial cluster types: service-like, interface-like, ui-screen-like, physical-data-like, package/module-like, shared-library/noise/unknown
4. Cluster ambiguity detection (merge, split, type unclear, noise, anchor uncertainty)
5. DecisionTask expansion for 1c: cluster_merge_decision, cluster_type_classification, cluster_anchor_assignment, cluster_noise_decision
6. Cluster graph update after deterministic and task-based adjudication
7. Phase completion and progression (1c runs after 1b, completes when stable, progresses to 1d)

**Out of scope:**
- Phase 1d candidate generation
- canonical architecture save-back
- frontend visualization of clusters
- advanced iterative clustering rounds
- AST enrichment
- language/version-specific analyzer packs
- log-based enrichment

**Design constraints:**
- Clusters are discovery-side groupings, not canonical architecture entities
- Deterministic-first clustering; LLM only resolves ambiguity
- All LLM use must go through explicit DecisionTasks over bounded bundles
- Traceability: each cluster must preserve source evidence references, formation reason/provenance, confidence, adjudication history
- Stable handoff into 1d

## Requirements Discussion

### First Round Questions

**Q1:** Clustering Rule Architecture: Follow Linker Rule Pattern or a Different Extensibility Model?

The existing Phase 1b linker rules follow a clean extensible pattern: a `LinkerRule` interface with `id`, `name`, `description`, and a `match(atoms)` method, registered in a `linkerRuleRegistry`. I assumed the Phase 1c clustering rules should follow an analogous pattern -- a `ClusteringRule` interface with a `match(atoms, relationships)` method that returns candidate clusters, registered in a `clusteringRuleRegistry`. The key difference is that clustering rules need both atoms AND relationships as input (unlike linker rules which only take atoms). Is that the right approach, or would you prefer a different extensibility model?

**Answer:** Yes -- follow the same general extensible rule/registry pattern as 1b rather than a monolithic engine.

**Q2:** Clustering Algorithm: Single-Pass Rule-Based with Merge/Refine, or Multi-Pass?

I assumed the clustering could follow a single deterministic pass where each registered clustering rule independently proposes clusters, then a merge/refinement step combines overlapping proposals. Alternatively, should this be multi-pass where rules run sequentially, each seeing the output of the previous rule? The raw idea mentions "clustering passes" (plural).

**Answer:** Use multiple clustering passes with merge/refinement, not a single all-or-nothing pass.

**Q3:** Cluster Type Classification: Deterministic Signals vs Separate Classification Pass?

The existing `ClusterType` union has: `service_boundary`, `data_domain`, `shared_library`, `api_layer`, `ui_module`. The raw idea lists additional types. I assumed each clustering rule deterministically assigns a preliminary cluster type based on its own signals, and a separate `cluster_type_classification` DecisionTask is only created when the signals are ambiguous.

**Answer:** Assign preliminary type deterministically during clustering where possible, and use DecisionTasks only for ambiguous cases.

**Q4:** Cluster Members: Atoms Only, or Atoms + Relationships?

The existing `ClusterMember` type and `discovery_cluster_member` table support both `atom` and `relationship` member types. I assumed all clustering rules should produce clusters with both atom members AND the relationship members that connect those atoms.

**Answer:** Allow clusters to reference both atoms and relationships where useful; do not over-restrict this now.

**Q5:** DecisionTask Type Expansion: Extend the Existing Union or Use a Phase Discriminator?

The existing `DecisionTaskType` union is `'confirm_relationship' | 'resolve_competing_relationships'`. The raw idea lists four new 1c task types. I assumed these should be added directly to the existing `DecisionTaskType` union, and the gateway's prompt template machinery should be extended to handle the new task types.

**Answer:** Extend the existing DecisionTask model and keep phase explicit in the task data rather than inventing a separate parallel mechanism.

**Q6:** Cluster Ambiguity Detection and Triage: Confidence-Based Like 1b, or Different Criteria?

Phase 1b uses confidence thresholds (AUTO_ACCEPT_THRESHOLD = 0.8, AMBIGUOUS_THRESHOLD = 0.4) to triage candidates. I assumed Phase 1c should use a similar confidence-based triage approach with additional structural checks layered on top for cluster-specific ambiguity (overlapping membership, split indicators, type uncertainty).

**Answer:** Use the same general confidence-based triage approach, with clustering-specific ambiguity checks layered on top.

**Q7:** Merge/Split Operations: How Should Cluster Graph Updates Work After Adjudication?

When a merge/split decision resolves, the system needs to update the cluster graph. The existing cluster API only supports bulkCreate, getByRunId, and count (no update/delete). I asked whether we need a new updateCluster endpoint or can use delete-and-recreate semantics.

**Answer:** Handle cluster evolution in the simplest clean way for now; do not introduce heavy update semantics unless they are clearly needed.

**Q8:** Phase 0 Anchor Hints Integration: What Shape Are They and How Do They Influence Clustering?

The discovery config (`DiscoveryConfigEntity`) stores `repoApplicationMappings` (mapping repos/paths to application names) and `techHints`. I assumed the anchor hints are these `repoApplicationMappings` and they should act as strong clustering signals.

**Answer:** Yes -- repo/application mappings and similar Phase 0 framing hints are the main anchors here, and they should act as strong guidance signals.

**Q9:** Batch Size and Performance: Should We Process Atoms/Relationships in Bounded Batches?

The existing 1b step loads ALL 1a atoms into memory. For 1c, we additionally need all 1b relationships. I assumed loading the full atom + relationship graph into memory is acceptable for this increment.

**Answer:** Yes -- loading the full atom + relationship graph in memory is acceptable for this increment.

**Q10:** Is there anything specific you want to exclude from this increment that the raw idea might imply?

**Answer:** Yes -- exclude inter-cluster relationship modeling, hierarchy/nesting, cross-run cluster merging, and visualization/export in this increment.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Linker Rules (extensible rule pattern) - Path: `discovery-service/src/services/linkerRules/` and `discovery-service/src/services/linkerRuleRegistry.ts`
  - `LinkerRule` interface at `discovery-service/src/types/linkerRule.ts` defines the `id`, `name`, `description`, `targetRelationshipType`, and `match()` contract
  - Concrete rules: `containsByPathRule.ts`, `importsByPatternRule.ts`, `extendsByPatternRule.ts`, `referencesBySymbolRule.ts`
  - Registration barrel: `discovery-service/src/services/linkerRules/index.ts` with `registerAllLinkerRules()`
  - The new `ClusteringRule` interface and `clusteringRuleRegistry` should follow this identical extensibility pattern

- Feature: Triage Engine (confidence-based triage) - Path: `discovery-service/src/services/triageEngine.ts`
  - Pure function `triageCandidates()` partitions candidates into accepted/ambiguous/discarded buckets
  - Uses `AUTO_ACCEPT_THRESHOLD` (0.8) and `AMBIGUOUS_THRESHOLD` (0.4) from `discovery-service/src/constants/linkerDefaults.ts`
  - Detects competing groups within the ambiguous bucket
  - The new cluster triage should follow this pattern with additional structural checks

- Feature: RunManager Step Orchestration - Path: `discovery-service/src/services/runManager.ts`
  - `executeStep1b()` is the primary pattern to follow for `executeStep1c()`
  - Current 1c stub at lines 461-467 queries upstream relationship count; this will be replaced with real clustering logic
  - Pattern: fetch upstream data -> run rules -> triage -> persist accepted -> create DecisionTasks -> resolve via gateway -> process results -> persist -> return summary

- Feature: Gateway DecisionTask Resolution - Path: `gateway/src/routes/discoveryDecisionTasks.ts` and `gateway/src/routes/discoveryDecisionTaskPrompts.ts`
  - `PROMPT_TEMPLATE_FILES` map from task type to prompt template filename
  - `loadPromptTemplate()`, `interpolateTemplate()`, `buildMessagesForTask()` functions
  - Prompt templates in `gateway/src/config/prompts/` (e.g., `discovery.confirm-relationship.prompt.md`)
  - New 1c task types need new entries in `PROMPT_TEMPLATE_FILES`, new interpolation branches, and new `.prompt.md` files

- Feature: DecisionTask Types - Path: `discovery-service/src/types/decisionTask.ts`
  - `DecisionTaskType` union, `DecisionTaskInput`/`DecisionTaskOutput` unions
  - Type-specific input/output interfaces (`ConfirmRelationshipInput`, `ConfirmRelationshipOutput`, etc.)
  - New 1c task types need new input/output interfaces added to these unions

- Feature: Cluster Evidence Types - Path: `discovery-service/src/types/cluster.ts`
  - Existing `ClusterType` union: `service_boundary`, `data_domain`, `shared_library`, `api_layer`, `ui_module`
  - `EvidenceCluster` interface with `id`, `runId`, `clusterType`, `name`, `confidence`, `members`, `data`, `formedAt`
  - `ClusterMember` interface with `memberType` (`atom` | `relationship`) and `memberId`
  - The ClusterType union needs expansion (e.g., `package_module`, `unknown`/`noise`)

- Feature: Cluster JPA Stack (persistence already exists) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/`
  - Entity: `model/entity/DiscoveryClusterEntity.java` - JPA entity with `@OneToMany` cascade to members
  - Member Entity: `model/entity/DiscoveryClusterMemberEntity.java` - polymorphic reference to atom or relationship
  - DTO: `model/dto/DiscoveryClusterDto.java` - record with nested member DTOs
  - Service: `service/DiscoveryClusterService.java` - bulkCreate, getByRunId, countByRunId (NO update/delete yet)
  - Controller: `controller/DiscoveryClusterController.java` - POST (bulk insert), GET (list + count)
  - Repository: `repository/entity/DiscoveryClusterRepository.java`
  - SQL: `resources/db/changelog/sql/068-discovery-cluster.sql` and `069-discovery-cluster-member.sql`
  - Note: No update or delete endpoints exist; if merge/split requires it, new endpoints will be needed

- Feature: archModelClient (discovery-service HTTP client) - Path: `discovery-service/src/services/archModelClient.ts`
  - Already has cluster methods: `bulkSaveClusters()`, `getClustersByRun()`, `getClusterCount()`
  - Already has DecisionTask methods: `bulkSaveDecisionTasks()`, `getDecisionTasksByRun()`, `updateDecisionTask()`
  - May need new methods for cluster update/delete if merge/split operations require it

- Feature: GatewayClient - Path: `discovery-service/src/services/gatewayClient.ts`
  - `resolveDecisionTasks()` sends batch of pending tasks to gateway
  - Response shape: `{ results: Array<{ taskId, status, outputData, error }> }`
  - Same client can be reused for 1c tasks since the gateway endpoint is task-type-agnostic

- Feature: Discovery Config (Phase 0 anchors) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryConfigEntity.java`
  - `configPayload` JSONB contains: repos, repoApplicationMappings, techHints, exclusions, notes
  - `repoApplicationMappings` map repos/paths to application names -- these are the anchor hints for 1c
  - Config can be fetched via `archModelClient.getDiscoveryConfig(projectId)`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

- **Deterministic clustering over the 1a + 1b evidence graph:** Load all atoms and relationships for a run, then execute multiple clustering passes using registered clustering rules, each pass seeing the output of the previous pass, with merge/refinement between passes
- **Extensible clustering rule architecture:** A `ClusteringRule` interface and `clusteringRuleRegistry` following the same pattern as `LinkerRule` / `linkerRuleRegistry`. Each rule accepts atoms + relationships (and optionally existing clusters from prior passes) and returns candidate clusters
- **Multiple clustering passes with merge/refinement:** Rules run in ordered passes, not all-at-once. Each pass can see clusters formed by prior passes. A merge/refinement step between passes handles overlapping proposals
- **Cluster formation with full traceability:** Each cluster includes: member references (atoms and relationships), preliminary cluster type, confidence score, formation reason/provenance in the `data` payload, and adjudication history
- **Preliminary cluster type assignment:** Clustering rules deterministically assign a type where signals are clear (e.g., SQL-heavy cluster -> `data_domain`, route-heavy cluster -> `api_layer`). Ambiguous cases generate `cluster_type_classification` DecisionTasks
- **Expanded ClusterType union:** Add types to cover the full initial set: the existing `service_boundary`, `data_domain`, `shared_library`, `api_layer`, `ui_module`, plus new types like `package_module` and `unknown`/`noise`
- **Cluster ambiguity detection:** Confidence-based triage (same general thresholds as 1b) plus structural ambiguity checks: overlapping membership between clusters, clusters that may need splitting, uncertain type classification, potential noise/generated code, uncertain anchor assignment
- **DecisionTask expansion for 1c:** Four new task types added to the existing `DecisionTaskType` union: `cluster_merge_decision`, `cluster_type_classification`, `cluster_anchor_assignment`, `cluster_noise_decision`. Each with typed input/output interfaces, phase explicitly indicated in task data
- **Gateway prompt templates for 1c tasks:** New `.prompt.md` files for each 1c task type, with interpolation variables for cluster data, member summaries, and evidence context. Extend `PROMPT_TEMPLATE_FILES` map, `interpolateTemplate()`, and `buildMessagesForTask()` in the gateway
- **Cluster graph update after adjudication:** Simplest clean approach -- likely delete-and-recreate for merge/split rather than heavy in-place update semantics. May require adding delete and/or update capabilities to the cluster service and archModelClient if bulkCreate alone is insufficient
- **Phase 0 anchor hints as strong clustering signals:** Read `repoApplicationMappings` and `techHints` from the discovery config at the start of 1c. Use these as high-confidence initial clustering seeds (e.g., "files under /services/payment/ map to Payment Service")
- **Full atom + relationship graph loaded in memory:** Acceptable for this increment; no need for pagination/streaming/batching of the input data
- **Phase 1c step execution and progression:** Replace the current `executeStep1c` stub in `runManager.ts` with real logic. Pattern: fetch upstream data -> run clustering passes -> triage -> persist accepted clusters -> create DecisionTasks -> resolve via gateway -> apply adjudication results -> persist final clusters -> return summary metadata. Phase completes when clustering passes have run and high-priority ambiguities are resolved

### Reusability Opportunities

- **LinkerRule/linkerRuleRegistry pattern** -> direct template for ClusteringRule/clusteringRuleRegistry
- **triageCandidates() function** -> template for cluster triage function (with structural checks added)
- **executeStep1b() in runManager.ts** -> direct template for executeStep1c() orchestration flow
- **Gateway discoveryDecisionTasks.ts + discoveryDecisionTaskPrompts.ts** -> extend for 1c task types
- **Existing DecisionTask type system** -> extend unions with 1c-specific input/output interfaces
- **archModelClient cluster methods** -> already exist (bulkSaveClusters, getClustersByRun, getClusterCount)
- **gatewayClient.resolveDecisionTasks()** -> reuse directly since the gateway endpoint is task-type-agnostic
- **DiscoveryClusterEntity/Service/Controller JPA stack** -> already exists; may need update/delete additions
- **Confidence threshold constants** -> may reuse or define clustering-specific thresholds in a similar constants file

### Scope Boundaries

**In Scope:**
- ClusteringRule interface and clusteringRuleRegistry (extensible rule pattern)
- Initial set of deterministic clustering rules (directory-based, import-density, data-usage, route-prefix, UI-label, anchor-hint)
- Multi-pass clustering execution with merge/refinement
- Cluster creation with members, type, confidence, provenance
- ClusterType union expansion
- Confidence-based cluster triage with structural ambiguity checks
- Four new DecisionTask types for 1c (cluster_merge_decision, cluster_type_classification, cluster_anchor_assignment, cluster_noise_decision)
- New typed input/output interfaces for each 1c DecisionTask type
- Four new gateway prompt templates for 1c tasks
- Gateway prompt template loader/interpolation extensions
- Cluster graph update after adjudication (simplest clean approach)
- Phase 0 anchor hint integration via discovery config
- Real executeStep1c() implementation replacing the current stub
- Phase 1c completion and progression to 1d
- Cluster service extensions if needed for update/delete operations

**Out of Scope:**
- Phase 1d candidate generation
- Canonical architecture save-back
- Frontend visualization of clusters
- Advanced iterative clustering rounds
- AST enrichment
- Language/version-specific analyzer packs
- Log-based enrichment
- Inter-cluster relationship modeling
- Cluster hierarchy/nesting
- Cross-run cluster merging
- Cluster visualization/export capability
- Pagination/streaming for large datasets (deferred to future performance increment)

### Technical Considerations

- **Integration points:** discovery-service (clustering logic) -> architecture-model-service (cluster persistence) -> gateway (LLM resolution for DecisionTasks)
- **Existing system constraints:** The DiscoveryClusterService currently only supports bulkCreate, getByRunId, and countByRunId -- no update or delete. Merge/split operations may require adding these capabilities
- **Technology stack:** TypeScript/Node.js for discovery-service and gateway; Java/Spring Boot for architecture-model-service; PostgreSQL with JSONB for flexible data payloads
- **Similar code patterns to follow:** LinkerRule -> ClusteringRule; triageCandidates() -> clusterTriageCandidates(); executeStep1b() -> executeStep1c(); PROMPT_TEMPLATE_FILES extension for new task types
- **Database schema:** Existing `discovery_cluster` and `discovery_cluster_member` tables are sufficient; the `cluster_type` column is TEXT (not enum), so new types require no migration. The `discovery_decision_task` table's `task_type` is also TEXT, so new task types require no migration
- **The `data` JSONB payload on clusters** should carry formation reason, provenance, dominant language, directory root, member summary counts, and adjudication history
- **DecisionTask input data** for 1c tasks should include bounded cluster/evidence bundles (cluster data + relevant member atoms/relationships) to keep LLM context focused
