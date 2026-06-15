# Spec Requirements: Phase 1d Candidate Generation

## Initial Description

Build the real Phase 1d candidate generation logic to replace the current backbone stub in `executeStep1d` (runManager.ts). This step synthesizes discovery candidates from Phase 1c clusters, mapping each cluster to one or more meta-model element proposals (applications, services, components, interfaces, data entities, etc.).

The candidate generation step should:
- Read finalized 1c clusters and upstream evidence (atoms, relationships)
- Apply deterministic generation rules to produce candidate proposals from clusters
- Handle parent/child relationship assignment between candidates
- Use the existing DiscoveryCandidate interface and persistence infrastructure
- Create DecisionTasks for ambiguous cases (following the 1b/1c pattern)
- Persist final candidates via the existing bulkSaveCandidates API
- Signal Phase 1 completion on the discovery run

Key areas to design:
- Candidate generation rule structure (similar to ClusteringRule / LinkerRule?)
- CandidateType usage from the existing union
- How parent/relationship assignment works (deterministic signals, existing candidate references)
- How the existing candidate persistence (already in architecture-model-service) maps to what's needed
- DecisionTask type expansion approach
- Gateway prompt templates for 1d tasks
- Candidate naming strategy (deterministic vs LLM-generated)
- Filtering/rejection criteria
- How Phase 1 completion is signaled on the run
- Confidence model for candidates

## Requirements Discussion

### First Round Questions

**Q1:** Generation Rule Architecture: Should 1d follow the same rule-interface pattern as 1b (LinkerRule) and 1c (ClusteringRule)? I'm assuming we define a `CandidateGenerationRule` interface with `id`, `name`, `description`, and a `generate()` method that receives finalized clusters + upstream atoms/relationships and returns `CandidateProposal[]` (an internal, non-persisted intermediate type, similar to how `CandidateRelationship` is internal to 1b and `CandidateCluster` is internal to 1c). These rules would be registered in a `candidateGenerationRuleRegistry` and executed in ordered passes. Is that correct, or should candidate generation be a single monolithic engine rather than a pluggable rule system?

**Answer:** Yes -- follow the same extensible rule/registry pattern rather than a monolithic engine.

**Q2:** Cluster-to-CandidateType Mapping Strategy: How deterministic should the initial type assignment be? Looking at the existing types, `ClusterType` has values like `service_boundary`, `data_domain`, `shared_library`, `api_layer`, `ui_module`, `package_module`. The existing `CandidateType` union has `application`, `app_component`, `service`, `logical_entity`, `physical_entity`, `interface`, `business_process`, `data_entity`. I'm assuming a mostly-deterministic mapping where, for example, `service_boundary` clusters typically produce `service` candidates, `data_domain` clusters produce `logical_entity` or `data_entity` candidates, and `api_layer` clusters produce `interface` candidates. For ambiguous cases (e.g., is a `service_boundary` cluster a `service` or an `app_component`?), we'd create DecisionTasks. Should the mapping also consider the cluster's anchor assignment from 1c (a cluster anchored to a known application name from Phase 0 config might produce an `application` candidate rather than a `service`)?

**Answer:** Make initial type mapping mostly deterministic, with DecisionTasks only for ambiguous cases; Phase 0 anchors should influence but not override blindly.

**Q3:** Parent/Child Relationship Assignment: What signals drive hierarchical candidate relationships? I'm assuming that candidates need parent references -- for example, a `service` candidate might be a child of an `application` candidate. The signals for this would likely include: (a) Phase 0 `repoApplicationMappings` anchor assignments from 1c, (b) filesystem containment from 1b `contains` relationships, (c) cluster membership overlap. Should parent assignment be deterministic where signals are strong (e.g., a service cluster anchored to an application name) and produce DecisionTasks where ambiguous (e.g., a service cluster that overlaps with two application boundaries)? Also, should the `DiscoveryCandidate` interface be extended with a `parentCandidateId` field, or should parent/child be tracked in the `data` JSONB payload?

**Answer:** Yes -- assign parents deterministically where signals are strong, and use DecisionTasks when ambiguous; keep parent assignment as an explicit first-class part of the candidate model.

**Q4:** DecisionTask Types for 1d: What new task types are needed? Based on the 1b/1c pattern, I'm assuming we need to expand the `DecisionTaskType` union with new 1d-specific types. My initial proposal: `candidate_type_classification` (when cluster-to-type mapping is ambiguous), `candidate_name_refinement` (when the deterministic name needs LLM polish), `candidate_parent_assignment` (when a candidate could belong to multiple parent candidates), `candidate_merge_decision` (when two clusters produce overlapping candidate proposals). Is that the right set, or should we keep it simpler for the first increment?

**Answer:** Keep it focused for this increment: type classification, parent assignment, naming, and rejection/merge only where clearly needed.

**Q5:** Candidate Naming Strategy: Deterministic first, with optional LLM refinement? I'm assuming candidate names are initially derived deterministically from: (a) the cluster's name (which may already be an anchor name from 1c), (b) directory/package names from member atoms, (c) prominent symbol names. This deterministic name would be the default, and a `candidate_name_refinement` DecisionTask would only be created if the deterministic name is low-quality (e.g., generic like "unknown service_boundary cluster"). Is that correct, or should ALL candidate names go through LLM refinement?

**Answer:** Use deterministic naming first, with LLM refinement only for weak or ambiguous names.

**Q6:** Triage/Confidence Model: Should 1d reuse the same threshold constants and bucket approach from 1c? The existing `clusterDefaults.ts` defines `AUTO_ACCEPT_THRESHOLD` (0.8), `AMBIGUOUS_THRESHOLD` (0.4), and other thresholds. I'm assuming 1d follows the same three-bucket triage pattern (auto-accept / ambiguous / discard) with its own dedicated `candidateDefaults.ts` constants, potentially with different threshold values since candidate confidence semantics differ from cluster confidence. The triage engine would be a new `candidateTriageEngine.ts` following the `clusterTriageEngine.ts` pattern. Is that correct, or should 1d candidates inherit confidence directly from their source clusters without a separate triage step?

**Answer:** Use the same general bucketed triage pattern, but with candidate-specific thresholds/signals rather than blindly inheriting cluster confidence.

**Q7:** One-to-Many Cluster-to-Candidate Expansion: Can a single cluster produce multiple candidates? For example, a `service_boundary` cluster might contain evidence of both a service AND its API interface. I'm assuming a single cluster can produce 1-to-N candidates (e.g., a service candidate + an interface candidate), and the `sourceClusterIds` field on `DiscoveryCandidate` handles traceability back. Is that correct?

**Answer:** Yes -- allow one cluster to produce multiple candidates where that is the cleanest interpretation.

**Q8:** Phase 1 Completion Signal: How should the run be marked complete after 1d? Looking at `startRun()`, when 1d is the final step, the run status is already set to `COMPLETED`. I'm assuming `executeStep1d` just needs to return rich summary metadata (candidateCount, autoAcceptedCount, decisionTaskCount, etc.) following the same pattern as `executeStep1c`, and the existing `startRun` loop handles the status transition. Is there anything else needed?

**Answer:** Standard completion/status metadata is sufficient, as long as Phase 1 completion clearly reflects that 1d finished and candidates are persisted for later use.

**Q9:** Is anything explicitly out of scope for this increment? I'm assuming the following are OUT of scope: (a) human review UI for candidates, (b) promotion of accepted candidates into actual meta-model entities, (c) relationship candidates between candidates (e.g., "service A calls service B"), and (d) iterative re-analysis where candidate feedback feeds back into earlier phases.

**Answer:** Yes -- keep human review UI, canonical save-back, inter-candidate relationship modeling, and iterative feedback loops out of scope for this increment.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Phase 1c Clustering Orchestration - Path: `discovery-service/src/services/runManager.ts` (`executeStep1c` function, lines 664-1128) -- the primary orchestration template for how 1d should be structured (fetch upstream data, run rules, triage, persist auto-accepted, create DecisionTasks, resolve via gateway, apply adjudication, persist final set, return summary metadata)
- Feature: Clustering Rule Interface Pattern - Path: `discovery-service/src/types/clusteringRule.ts` -- defines `ClusteringRule` interface and `CandidateCluster` (internal intermediate type), the pattern for `CandidateGenerationRule` and `CandidateProposal`
- Feature: Linker Rule Interface Pattern - Path: `discovery-service/src/types/linkerRule.ts` -- defines `LinkerRule` interface and `CandidateRelationship` (internal intermediate type), another reference for the rule pattern
- Feature: Cluster Triage Engine - Path: `discovery-service/src/services/clusterTriageEngine.ts` -- pure-function triage with confidence buckets and structural ambiguity detection, template for `candidateTriageEngine.ts`
- Feature: Multi-Pass Clustering Engine - Path: `discovery-service/src/services/clusteringEngine.ts` -- ordered rule execution with merge/refinement between passes, template for candidate generation engine
- Feature: Clustering Rule Registry - Path: `discovery-service/src/services/clusteringRuleRegistry.ts` -- rule registration pattern, template for `candidateGenerationRuleRegistry`
- Feature: Clustering Rules - Paths: `discovery-service/src/services/clusteringRules/anchorHintClusterRule.ts`, `directoryClusterRule.ts`, `importDensityClusterRule.ts`, `routePrefixClusterRule.ts`, `dataUsageClusterRule.ts` -- concrete rule implementations showing how rules pattern-match evidence and produce candidates
- Feature: Cluster Default Constants - Path: `discovery-service/src/constants/clusterDefaults.ts` -- threshold constants pattern (`AUTO_ACCEPT_THRESHOLD`, `AMBIGUOUS_THRESHOLD`, etc.), template for `candidateDefaults.ts`
- Feature: Gateway Decision Task Prompts - Path: `gateway/src/routes/discoveryDecisionTaskPrompts.ts` -- `DecisionTaskTypeString` union, `PROMPT_TEMPLATE_FILES` map, `interpolateTemplate()` dispatch, and type-specific interpolation helpers, to be extended with 1d task types
- Feature: Gateway Decision Task Resolution Route - Path: `gateway/src/routes/discoveryDecisionTasks.ts` -- the `/resolve-decision-tasks` endpoint (no changes needed, already generic)
- Feature: Gateway Prompt Templates - Path: `gateway/src/config/prompts/` -- existing `.prompt.md` files for 1b and 1c task types, new 1d prompts to be added here
- Feature: Discovery Service Gateway Client - Path: `discovery-service/src/services/gatewayClient.ts` -- `resolveDecisionTasks()` method (already generic, no changes needed)
- Feature: Architecture Model Client Candidate Methods - Path: `discovery-service/src/services/archModelClient.ts` -- `bulkSaveCandidates`, `getCandidatesByRun`, `updateCandidate`, `getCandidateCount` (already built, ready to use)
- Feature: Candidate JPA Entity - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryCandidateEntity.java` -- existing JPA entity with `id`, `runId`, `candidateType`, `name`, `confidence`, `status`, `sourceClusterIds` (JSONB array), `data` (JSONB), `synthesizedAt`
- Feature: Candidate DTO - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryCandidateDto.java` -- existing REST DTO matching the entity
- Feature: DecisionTask Type Definitions - Path: `discovery-service/src/types/decisionTask.ts` -- existing `DecisionTaskType` union (1b + 1c types) and input/output interfaces to be extended with 1d types
- Feature: Discovery Config Entity - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryConfigEntity.java` -- Phase 0 config with `repoApplicationMappings` and `techHints` in JSONB `configPayload`
- Feature: Candidate TypeScript Types - Path: `discovery-service/src/types/candidate.ts` -- existing `CandidateType` union, `CandidateStatus` union, `DiscoveryCandidate` interface

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

- **Candidate Generation Rule System**: Implement a `CandidateGenerationRule` interface following the same extensible rule/registry pattern as `ClusteringRule` (1c) and `LinkerRule` (1b). Each rule has `id`, `name`, `description`, and a `generate()` method. Rules are registered in a `candidateGenerationRuleRegistry` and executed in ordered passes.
- **Internal CandidateProposal Type**: Define a `CandidateProposal` interface (internal to discovery-service, never persisted directly) analogous to `CandidateCluster` and `CandidateRelationship`. Converted to `DiscoveryCandidate` after triage and adjudication.
- **Deterministic Cluster-to-Type Mapping**: Map `ClusterType` to `CandidateType` deterministically where possible (e.g., `service_boundary` -> `service`, `data_domain` -> `logical_entity`/`data_entity`, `api_layer` -> `interface`). Phase 0 anchor assignments from 1c influence type decisions (e.g., anchored cluster may produce `application` candidate) but do not override blindly. Ambiguous type mappings produce `candidate_type_classification` DecisionTasks.
- **One-to-Many Cluster Expansion**: A single cluster can produce 1-to-N candidates where evidence supports it (e.g., a service boundary cluster producing both a `service` candidate and an `interface` candidate). Traceability maintained via `sourceClusterIds`.
- **Parent/Child Assignment**: Parent candidate assignment is a first-class, explicit part of the candidate model (extend `DiscoveryCandidate` with `parentCandidateId`). Deterministic assignment where signals are strong (anchor mappings, filesystem containment, cluster overlap). Ambiguous cases produce `candidate_parent_assignment` DecisionTasks.
- **Deterministic Naming with LLM Fallback**: Candidate names derived deterministically from cluster name, anchor name, directory/package names, or prominent symbol names. `candidate_name_refinement` DecisionTasks created only for weak or ambiguous names (e.g., generic auto-generated names).
- **Candidate-Specific Triage Engine**: Implement `candidateTriageEngine.ts` following the `clusterTriageEngine.ts` pattern with three confidence buckets (auto-accept / ambiguous / discard). Use candidate-specific thresholds in `candidateDefaults.ts` rather than blindly inheriting cluster confidence.
- **1d DecisionTask Types**: Expand `DecisionTaskType` union with focused 1d types: `candidate_type_classification`, `candidate_parent_assignment`, `candidate_name_refinement`, `candidate_merge_decision`. Only create tasks where clearly needed.
- **Gateway Prompt Templates**: Create new `.prompt.md` template files in `gateway/src/config/prompts/` for each 1d DecisionTask type. Extend `DecisionTaskTypeString`, `PROMPT_TEMPLATE_FILES`, and `interpolateTemplate()` in `discoveryDecisionTaskPrompts.ts`.
- **DecisionTask Resolution and Adjudication**: Follow the 1c pattern: persist pending tasks, resolve via gateway LLM, process adjudication results (apply type corrections, parent assignments, name refinements, merge decisions, noise removals), persist final candidate set.
- **Candidate Persistence**: Use existing `bulkSaveCandidates`, `getCandidatesByRun`, `updateCandidate`, `getCandidateCount` methods on `archModelClient`. No new backend persistence code needed (JPA stack already exists).
- **Phase 1 Completion**: `executeStep1d` returns rich summary metadata (candidateCount, autoAcceptedCount, decisionTaskCount, decisionTaskResolvedCount, decisionTaskFailedCount, discardedCount, upstreamClusterCount). The existing `startRun()` loop marks the run as `COMPLETED` after 1d succeeds.

### Reusability Opportunities

- **Rule Interface Pattern**: Reuse the exact structural pattern from `ClusteringRule` / `CandidateCluster` for `CandidateGenerationRule` / `CandidateProposal`
- **Rule Registry Pattern**: Reuse the `clusteringRuleRegistry` pattern for a `candidateGenerationRuleRegistry`
- **Triage Engine Pattern**: Reuse the `clusterTriageEngine.ts` structural pattern (pure function, confidence buckets, ambiguity group detection) for `candidateTriageEngine.ts`
- **Constants Pattern**: Reuse the `clusterDefaults.ts` pattern for `candidateDefaults.ts`
- **Orchestration Pattern**: Reuse the `executeStep1c` orchestration flow (fetch upstream -> run rules -> triage -> persist auto-accepted -> create tasks -> resolve -> adjudicate -> persist final -> return metadata)
- **Gateway Prompt Extensibility**: The existing `discoveryDecisionTaskPrompts.ts` is already structured for extension -- add new entries to `DecisionTaskTypeString`, `PROMPT_TEMPLATE_FILES`, and interpolation dispatch
- **Gateway Resolution Route**: The `/resolve-decision-tasks` endpoint is fully generic and requires no changes
- **Gateway Client**: `gatewayClient.resolveDecisionTasks()` is already generic and requires no changes
- **Backend Persistence**: The full JPA stack for candidates is already built (entity, DTO, repository, service, controller) and the archModelClient methods are ready to use
- **Concrete Clustering Rules**: The existing clustering rules (anchor hint, directory, import density, route prefix, data usage) provide patterns for how generation rules should pattern-match evidence and produce proposals

### Scope Boundaries

**In Scope:**
- `CandidateGenerationRule` interface and registry
- `CandidateProposal` internal intermediate type
- Concrete generation rules with deterministic cluster-to-type mapping
- `candidateGenerationEngine.ts` for ordered rule execution
- `candidateTriageEngine.ts` with candidate-specific confidence buckets
- `candidateDefaults.ts` threshold constants
- Parent/child assignment logic (deterministic + DecisionTask fallback)
- Extension of `DiscoveryCandidate` interface with `parentCandidateId`
- Deterministic candidate naming with LLM refinement for weak names
- Four new DecisionTask types: `candidate_type_classification`, `candidate_parent_assignment`, `candidate_name_refinement`, `candidate_merge_decision`
- Four new gateway prompt template files for 1d task types
- Extension of `DecisionTaskTypeString` and interpolation logic in gateway
- New input/output type interfaces for 1d DecisionTasks in `decisionTask.ts`
- Full `executeStep1d` implementation replacing the backbone stub
- Rich summary metadata returned from `executeStep1d`
- Unit tests for all new pure functions (generation rules, triage engine, generation engine)
- Integration-level tests for the `executeStep1d` orchestration

**Out of Scope:**
- Human review UI for candidates (candidates created as `proposed` status only)
- Promotion/save-back of accepted candidates into canonical meta-model entities
- Inter-candidate relationship modeling (e.g., "service A calls service B")
- Iterative feedback loops where candidate results feed back into earlier phases (1a/1b/1c)
- Changes to the architecture-model-service JPA stack (already built and sufficient)
- Changes to the gateway `/resolve-decision-tasks` endpoint (already generic)
- Changes to the discovery-service `gatewayClient` (already generic)

### Technical Considerations

- **Existing Infrastructure**: The candidate persistence stack (JPA entity, DTO, repository, service, controller, archModelClient methods) is fully built and tested. No backend changes needed.
- **Interface Extension**: The `DiscoveryCandidate` interface in `discovery-service/src/types/candidate.ts` needs a `parentCandidateId?: string` field added. The corresponding `DiscoveryCandidateEntity.java` and `DiscoveryCandidateDto.java` in architecture-model-service need a matching `parent_candidate_id` column/field added (Liquibase migration required).
- **DecisionTask Type Union Growth**: The `DecisionTaskType` union in `discovery-service/src/types/decisionTask.ts` and `DecisionTaskTypeString` in `gateway/src/routes/discoveryDecisionTaskPrompts.ts` must be kept in sync when adding 1d types.
- **Type Barrel Export**: New types must be re-exported from `discovery-service/src/types/index.ts`.
- **Confidence Semantics**: Candidate confidence is computed independently from source cluster confidence, using candidate-specific signals (type mapping certainty, naming quality, parent assignment strength). Threshold values in `candidateDefaults.ts` may differ from `clusterDefaults.ts`.
- **Ordered Pass Execution**: Generation rules execute in registry insertion order, with each pass seeing candidates from prior passes (enabling hierarchical generation where application candidates are created before service/component children).
- **Phase 0 Config Access**: `executeStep1d` needs to fetch discovery config (same pattern as `executeStep1c`) to access `repoApplicationMappings` and `techHints` for anchor-informed type mapping and naming.
- **Upstream Data Dependencies**: `executeStep1d` needs to fetch finalized 1c clusters (`getClustersByRun`), 1a atoms (`getEvidenceByRun`), and 1b relationships (`getRelationshipsByRun`) for full evidence context during generation.
