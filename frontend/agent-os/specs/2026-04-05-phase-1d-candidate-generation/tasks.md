# Task Breakdown: Phase 1d Candidate Generation

## Overview
Total Tasks: 71
Increment: 10 of 16 (Legacy / Current-State Discovery)

This feature replaces the Phase 1d backbone stub in `executeStep1d` with real candidate generation logic that synthesizes discovery candidates from Phase 1c clusters, mapping each cluster to one or more architecture meta-model element proposals via deterministic generation rules, candidate-specific triage, and LLM-assisted DecisionTask adjudication for ambiguous cases (type classification, parent assignment, name refinement, merge decisions, rejection review).

Three services are involved:
- **discovery-service** (Express/TypeScript): CandidateGenerationRule interface/registry, 5 deterministic generation rules, candidate triage engine, multi-pass generation engine, candidate defaults, Phase 1d orchestration in runManager
- **architecture-model-service** (Java/Spring Boot): Liquibase migration for `parent_candidate_id` column, JPA entity/DTO updates, `deleteByRunId` for candidates, DELETE endpoint
- **gateway** (Express/TypeScript): 5 new prompt templates, extended prompt interpolation and resolution route for 1d DecisionTask types

## Task List

### Discovery-Service Type Definitions

#### Task Group 1: CandidateGenerationRule, CandidateProposal, and 1d DecisionTask Types
**Dependencies:** None

- [x] 1.0 Complete discovery-service type definitions for Phase 1d
  - [x] 1.1 Write 6 focused tests for 1d type definitions and interfaces
    - Test that `CandidateProposal` has required fields: `candidateType` (CandidateType), `name` (string), `confidence` (number 0.0-1.0), `sourceClusterIds` (string[]), `ruleId` (string), `generationReason` (string), `data` (Record<string, unknown>), `nameQuality` ('strong' | 'weak')
    - Test that `CandidateProposal` has optional fields: `parentProposalRef` (string), `typeSignals` (Array<{ type: CandidateType; signalStrength: number }>)
    - Test that `CandidateGenerationRule` interface has `id`, `name`, `description`, and `generate()` method returning `CandidateProposal[]`
    - Test that `CandidateGenerationRule.generate()` accepts `clusters: EvidenceCluster[]`, `atoms: EvidenceAtom[]`, `relationships: EvidenceRelationship[]`, `existingProposals: CandidateProposal[]`, and `config: Record<string, unknown>`
    - Test that the five new DecisionTask type discriminators (`candidate_type_classification`, `candidate_parent_assignment`, `candidate_name_refinement`, `candidate_merge_decision`, `candidate_rejection_review`) are valid `DecisionTaskType` values
    - Test that the five new input/output interface pairs are structurally correct with required fields (e.g., `CandidateTypeClassificationInput` has `candidateSummary`, `competingTypeSignals`, `phase: '1d'`; `CandidateTypeClassificationOutput` has `selectedType`, `adjustedConfidence`, `reasoning`)
  - [x] 1.2 Create `CandidateGenerationRule` interface and `CandidateProposal` interface in `discovery-service/src/types/candidateGenerationRule.ts`
    - `CandidateProposal`: `candidateType` (CandidateType), `name` (string), `confidence` (number 0.0-1.0), `sourceClusterIds` (string[]), `parentProposalRef?` (string -- temporary in-memory reference for parent linking within a generation pass), `ruleId` (string), `generationReason` (string), `data` (Record<string, unknown>), `nameQuality` ('strong' | 'weak'), `typeSignals?` (Array<{ type: CandidateType; signalStrength: number }>)
    - `CandidateGenerationRule`: `id` (string), `name` (string), `description` (string), `generate(clusters: EvidenceCluster[], atoms: EvidenceAtom[], relationships: EvidenceRelationship[], existingProposals: CandidateProposal[], config: Record<string, unknown>): CandidateProposal[]`
    - Import `EvidenceAtom` from `./evidenceAtom`, `EvidenceRelationship` from `./relationship`, `EvidenceCluster` from `./cluster`, `CandidateType` from `./candidate`
    - Follow the `clusteringRule.ts` documentation pattern exactly: header comment with data flow position, JSDoc on every field and interface
  - [x] 1.3 Extend `DiscoveryCandidate` interface in `discovery-service/src/types/candidate.ts`
    - Add `parentCandidateId?: string` optional field
    - Add JSDoc documenting the self-referencing parent relationship
  - [x] 1.4 Extend DecisionTask types in `discovery-service/src/types/decisionTask.ts`
    - Update module header comment to include Phase 1d
    - Extend `DecisionTaskType` union with: `'candidate_type_classification'`, `'candidate_parent_assignment'`, `'candidate_name_refinement'`, `'candidate_merge_decision'`, `'candidate_rejection_review'`
    - Create `CandidateSummary` interface: `candidateType` (CandidateType), `name` (string), `confidence` (number), `sourceClusterIds` (string[]), `generationReason` (string), `memberFilePaths?` (string[])
    - Create `CandidateTypeClassificationInput`: `candidateSummary` (CandidateSummary), `competingTypeSignals` (Array<{ type: CandidateType; signalStrength: number }>), `phase` ('1d')
    - Create `CandidateTypeClassificationOutput`: `selectedType` (CandidateType), `adjustedConfidence` (number), `reasoning` (string)
    - Create `CandidateParentAssignmentInput`: `candidateSummary` (CandidateSummary), `competingParents` (Array<{ parentId: string; parentName: string; parentType: CandidateType; signal: string }>), `phase` ('1d')
    - Create `CandidateParentAssignmentOutput`: `selectedParentId` (string | null), `adjustedConfidence` (number), `reasoning` (string)
    - Create `CandidateNameRefinementInput`: `candidateSummary` (CandidateSummary), `currentName` (string), `memberFilePaths` (string[]), `phase` ('1d')
    - Create `CandidateNameRefinementOutput`: `refinedName` (string), `reasoning` (string)
    - Create `CandidateMergeDecisionInput`: `candidateA` (CandidateSummary), `candidateB` (CandidateSummary), `overlappingClusterIds` (string[]), `phase` ('1d')
    - Create `CandidateMergeDecisionOutput`: `decision` ('merge' | 'keep_separate'), `reasoning` (string)
    - Create `CandidateRejectionReviewInput`: `candidateSummary` (CandidateSummary), `rejectionIndicators` (string[]), `phase` ('1d')
    - Create `CandidateRejectionReviewOutput`: `decision` ('keep' | 'reject'), `reasoning` (string)
    - Add all five input interfaces to `DecisionTaskInput` union
    - Add all five output interfaces to `DecisionTaskOutput` union
  - [x] 1.5 Update barrel export in `discovery-service/src/types/index.ts`
    - Export all types from `./candidateGenerationRule`: `CandidateGenerationRule`, `CandidateProposal`
    - Export the new types from `./decisionTask`: `CandidateSummary`, `CandidateTypeClassificationInput`, `CandidateTypeClassificationOutput`, `CandidateParentAssignmentInput`, `CandidateParentAssignmentOutput`, `CandidateNameRefinementInput`, `CandidateNameRefinementOutput`, `CandidateMergeDecisionInput`, `CandidateMergeDecisionOutput`, `CandidateRejectionReviewInput`, `CandidateRejectionReviewOutput`
    - Export `parentCandidateId` is already covered by the existing `DiscoveryCandidate` re-export
  - [x] 1.6 Ensure type definition tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify TypeScript compilation succeeds with no type errors

**Acceptance Criteria:**
- The 6 tests written in 1.1 pass
- All new types are correctly exported from the barrel export
- `CandidateProposal` is a standalone internal type (not persisted directly)
- `CandidateGenerationRule.generate()` signature accepts clusters, atoms, relationships, existing proposals, and config
- Five new DecisionTask types with typed input/output interfaces compile without errors
- `DiscoveryCandidate` interface includes optional `parentCandidateId` field
- TypeScript compiler reports no errors

---

### Discovery-Service Generation Rules and Triage Engine

#### Task Group 2: Candidate Defaults and Generation Rule Registry
**Dependencies:** Task Group 1

- [x] 2.0 Complete candidate defaults and registry
  - [x] 2.1 Write 3 focused tests for thresholds and registry
    - Test that `CANDIDATE_AUTO_ACCEPT_THRESHOLD` (0.75), `CANDIDATE_AMBIGUOUS_THRESHOLD` (0.35), and `CANDIDATE_TYPE_DOMINANCE_THRESHOLD` (0.6) are exported with correct defaults from `candidateDefaults.ts`
    - Test that `initializeCandidateGenerationRuleRegistry()` populates the registry with the expected number of rules (5)
    - Test that `registerCandidateGenerationRule()` adds a new rule and `getCandidateGenerationRuleRegistry()` returns it
  - [x] 2.2 Create `discovery-service/src/constants/candidateDefaults.ts`
    - Export `CANDIDATE_AUTO_ACCEPT_THRESHOLD = 0.75`
    - Export `CANDIDATE_AMBIGUOUS_THRESHOLD = 0.35`
    - Export `CANDIDATE_TYPE_DOMINANCE_THRESHOLD = 0.6` (minimum signal strength for type classification certainty)
    - Export `CANDIDATE_OVERLAP_MERGE_THRESHOLD = 0.7` (70% sourceClusterIds overlap for automatic merge)
    - Export `CANDIDATE_WEAK_NAME_PATTERNS: RegExp[]` -- array of patterns matching generic names: `/^unknown$/i`, `/^misc$/i`, `/^module-?\d*$/i`, `/^[a-z]$/i`, `/^\d+$/`, `/^untitled$/i`, `/^unnamed$/i`, `/^default$/i`
    - Follow the `clusterDefaults.ts` documentation pattern (JSDoc on every constant)
  - [x] 2.3 Create candidate generation rule registry in `discovery-service/src/services/candidateGenerationRuleRegistry.ts`
    - Follow the `clusteringRuleRegistry.ts` pattern exactly: in-memory `Map<string, CandidateGenerationRule>`
    - Export `initializeCandidateGenerationRuleRegistry()`, `getCandidateGenerationRuleRegistry()`, `registerCandidateGenerationRule()`
    - `initializeCandidateGenerationRuleRegistry()` creates a fresh Map, calls `registerAllCandidateGenerationRules()`, logs registry size
  - [x] 2.4 Create `discovery-service/src/services/candidateGenerationRules/index.ts` barrel export
    - Export all 5 rule instances
    - Export `registerAllCandidateGenerationRules()` function that registers all 5 rules
    - Registration order defines pass order: anchorTypeRule first, then serviceComponentRule, then dataEntityRule, then interfaceRule, then fallbackPackageRule
    - Follow the `clusteringRules/index.ts` pattern exactly
  - [x] 2.5 Ensure thresholds and registry tests pass
    - Run ONLY the 3 tests written in 2.1

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- Constants are centrally defined in `candidateDefaults.ts`, not scattered as magic numbers
- Registry follows the established `clusteringRuleRegistry.ts` pattern
- `registerAllCandidateGenerationRules()` is callable from `initializeCandidateGenerationRuleRegistry()`

#### Task Group 3: Five Deterministic Candidate Generation Rules
**Dependencies:** Task Group 2

- [x] 3.0 Complete all five candidate generation rules
  - [x] 3.1 Write 8 focused tests for the five generation rules
    - `anchorTypeRule`: test that a `service_boundary` cluster whose name matches a `repoApplicationMappings` entry produces an `application` candidate with confidence >= 0.9 and `nameQuality: 'strong'`; test that a `service_boundary` cluster without anchor match produces a `service` candidate instead
    - `serviceComponentRule`: test that `service_boundary` clusters (not anchored to an application) produce `service` candidates with confidence 0.6-0.85; test that `ui_module` and `shared_library` clusters produce `app_component` candidates
    - `dataEntityRule`: test that `data_domain` clusters produce `data_entity` candidates; test that a `data_domain` cluster with logical-data indicators in its data payload produces a `logical_entity` candidate instead
    - `interfaceRule`: test that `api_layer` clusters produce `interface` candidates with confidence 0.6-0.8; test that a `service_boundary` cluster containing API route evidence also produces an `interface` candidate alongside the service candidate (one-to-many expansion)
    - Note: `fallbackPackageRule` tests are covered by one test (a `package_module` cluster produces an `app_component` candidate with lowest confidence) -- total 8 tests across the 5 rules
  - [x] 3.2 Implement `anchorTypeRule` in `discovery-service/src/services/candidateGenerationRules/anchorTypeRule.ts`
    - Rule `id: 'anchor-type'`, runs in first pass
    - Reads `repoApplicationMappings` from the config parameter
    - For each `service_boundary` cluster whose name matches a `repoApplicationMappings` entry, produce an `application` candidate with `confidence: 0.95`, `nameQuality: 'strong'`, `generationReason: 'Phase 0 anchor match: <name>'`
    - For `unknown` type clusters, produce NO candidates -- these will be handled by DecisionTask from the triage engine
    - Candidate name comes from the anchor mapping name
    - Set `parentProposalRef` to undefined (application candidates are top-level)
  - [x] 3.3 Implement `serviceComponentRule` in `discovery-service/src/services/candidateGenerationRules/serviceComponentRule.ts`
    - Rule `id: 'service-component'`, runs in second pass
    - `service_boundary` clusters NOT already covered by an anchor-type application candidate produce `service` candidates with confidence 0.6-0.85 (scaled by cluster confidence and member count)
    - `ui_module` clusters produce `app_component` candidates with confidence 0.5-0.75
    - `shared_library` clusters produce `app_component` candidates with confidence 0.5-0.7
    - Check `existingProposals` to avoid producing a service candidate for a cluster already covered by an application candidate from the anchor-type rule
    - Set `parentProposalRef` to the matching application candidate's `sourceClusterIds` anchor if a parent application exists from a prior pass
  - [x] 3.4 Implement `dataEntityRule` in `discovery-service/src/services/candidateGenerationRules/dataEntityRule.ts`
    - Rule `id: 'data-entity'`, runs in third pass
    - `data_domain` clusters produce `data_entity` candidates by default
    - If cluster data payload contains logical-data indicators (e.g., `isLogical: true` or `dataKind: 'logical'`), produce a `logical_entity` candidate instead
    - Confidence 0.55-0.8 based on cluster confidence and data signal strength
    - Name derived from cluster name; mark `nameQuality: 'weak'` if cluster name is generic
  - [x] 3.5 Implement `interfaceRule` in `discovery-service/src/services/candidateGenerationRules/interfaceRule.ts`
    - Rule `id: 'interface'`, runs in fourth pass
    - `api_layer` clusters produce `interface` candidates with confidence 0.6-0.8
    - One-to-many expansion: also check `service_boundary` clusters for API route evidence (atoms with `patternName` matching route patterns); if found, produce an additional `interface` candidate alongside the existing service candidate
    - Set `parentProposalRef` to the parent service/application candidate if detectable from `existingProposals`
    - Name from cluster name or dominant route prefix; mark `nameQuality: 'weak'` if generic
  - [x] 3.6 Implement `fallbackPackageRule` in `discovery-service/src/services/candidateGenerationRules/fallbackPackageRule.ts`
    - Rule `id: 'fallback-package'`, runs in fifth (last) pass
    - `package_module` clusters produce `app_component` candidates with lowest confidence (0.35-0.55)
    - Only produces candidates for clusters NOT already covered by `existingProposals` (check `sourceClusterIds` overlap)
    - `nameQuality: 'weak'` for all fallback candidates
    - `generationReason: 'Fallback package assignment for unclaimed cluster'`
  - [x] 3.7 Register all five rules in `candidateGenerationRules/index.ts` via `registerAllCandidateGenerationRules()`
    - Registration order defines pass order: anchorTypeRule first, then serviceComponentRule, dataEntityRule, interfaceRule, fallbackPackageRule
  - [x] 3.8 Ensure generation rule tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify each rule operates as a self-contained, testable unit

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Each rule is in its own file under `discovery-service/src/services/candidateGenerationRules/`
- Each rule implements the `CandidateGenerationRule` interface
- Confidence scores fall within the specified ranges per rule
- Rules are correctly registered in the registry in the specified pass order
- `anchorTypeRule` uses Phase 0 anchor hints for high-confidence application candidate seeding
- One-to-many cluster-to-candidate expansion works in the `interfaceRule`
- `fallbackPackageRule` only claims uncovered clusters

#### Task Group 4: Multi-Pass Candidate Generation Engine
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete multi-pass candidate generation engine
  - [x] 4.1 Write 5 focused tests for multi-pass execution and merge/refinement
    - Test that rules execute in ordered passes: anchor-type first, then service/component, then data entity, then interface, then fallback -- each pass receives `existingProposals` from all prior passes
    - Test that two proposals sharing >= 70% of the same `sourceClusterIds` are automatically merged into one, keeping the higher confidence and combining generation reasons
    - Test that proposals sharing < 70% of `sourceClusterIds` are kept as separate proposals
    - Test that proposals with names matching `CANDIDATE_WEAK_NAME_PATTERNS` are flagged with `nameQuality: 'weak'` after all passes
    - Test that the full pipeline (all 5 rules -> merge -> weak-name flagging) produces the correct final proposal list
  - [x] 4.2 Create `discovery-service/src/services/candidateGenerationEngine.ts`
    - Export `executeCandidateGenerationPasses(clusters, atoms, relationships, ruleRegistry, config): CandidateProposal[]`
    - Iterate over registered rules in order; for each rule, call `rule.generate(clusters, atoms, relationships, existingProposals, config)` and collect results
    - Between passes, run `mergeOverlappingProposals(allProposals)` to detect and merge overlaps (>= `CANDIDATE_OVERLAP_MERGE_THRESHOLD` sourceClusterIds overlap)
    - `mergeOverlappingProposals()`: for each pair of proposals, compute sourceClusterIds overlap percentage; if >= threshold, merge them (keep higher confidence, combine generation reasons and ruleIds, union sourceClusterIds)
    - After all passes, flag proposals with names matching `CANDIDATE_WEAK_NAME_PATTERNS` by setting `nameQuality: 'weak'`
    - Pure function with no I/O -- receives all data as parameters, returns `CandidateProposal[]`
    - Follow the `clusteringEngine.ts` pattern for structure and documentation
  - [x] 4.3 Ensure multi-pass execution tests pass
    - Run ONLY the 5 tests written in 4.1

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- Rules execute in the specified pass order
- Merge/refinement correctly handles 70% sourceClusterIds overlap threshold
- Weak-name flagging identifies proposals with generic names
- The engine is a pure function with no I/O dependencies

#### Task Group 5: Candidate Triage Engine
**Dependencies:** Task Groups 1, 2, 4

- [x] 5.0 Complete candidate triage engine
  - [x] 5.1 Write 6 focused tests for the candidate triage engine
    - Test high-confidence proposals (>= 0.75) are placed in the `accepted` bucket
    - Test mid-confidence proposals (0.35-0.74) are placed in the `ambiguous` bucket
    - Test low-confidence proposals (< 0.35) are placed in the `discarded` bucket
    - Test structural ambiguity: a proposal with `typeSignals` where no single signal exceeds `CANDIDATE_TYPE_DOMINANCE_THRESHOLD` triggers a `type_review` ambiguity group
    - Test structural ambiguity: a proposal with `nameQuality: 'weak'` triggers a `name_review` ambiguity group
    - Test structural ambiguity: two proposals with 35-70% `sourceClusterIds` overlap trigger a `merge_review` ambiguity group; extremely low-confidence proposals (< 0.2 but above discard with rescue signals) trigger a `rejection_review` ambiguity group
  - [x] 5.2 Implement candidate triage in `discovery-service/src/services/candidateTriageEngine.ts`
    - Follow the `clusterTriageEngine.ts` pattern: pure function with no I/O
    - Export `triageCandidateProposals(proposals: CandidateProposal[]): CandidateTriageResult`
    - `CandidateTriageResult` interface: `accepted` (CandidateProposal[]), `ambiguous` (CandidateProposal[]), `discarded` (CandidateProposal[]), `ambiguityGroups` (keyed by ambiguity type: `type_review`, `parent_review`, `name_review`, `merge_review`, `rejection_review`)
    - Define review entry interfaces: `TypeReviewEntry`, `ParentReviewEntry`, `NameReviewEntry`, `MergeReviewEntry`, `RejectionReviewEntry`
    - Step 1: Partition by confidence thresholds (import from `candidateDefaults.ts`)
    - Step 2: Layer structural ambiguity checks on the ambiguous bucket:
      - **Type review**: proposals with `typeSignals` where no single signal exceeds `CANDIDATE_TYPE_DOMINANCE_THRESHOLD`
      - **Parent review**: proposals with zero or multiple competing parent signals (detected via `parentProposalRef` absence combined with contextual signals from sourceClusterIds)
      - **Name review**: proposals with `nameQuality: 'weak'`
      - **Merge review**: pairs of proposals with 35-70% `sourceClusterIds` overlap (significant enough to warrant decision but not auto-merged)
      - **Rejection review**: proposals in the discarded bucket that still have non-trivial member counts or partial strong signals (salvageable candidates)
    - Each ambiguity group maps to a specific DecisionTask type
  - [x] 5.3 Ensure candidate triage engine tests pass
    - Run ONLY the 6 tests written in 5.1

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Triage function is a pure, standalone unit with no I/O dependencies
- Three confidence buckets are correctly populated based on candidate-specific threshold constants
- Structural ambiguity checks detect type uncertainty, parent ambiguity, weak names, merge overlaps, and rejection candidates
- Each ambiguity group maps to a specific 1d DecisionTask type

---

### Architecture-Model-Service: parentCandidateId Migration and Candidate Delete-by-RunId

#### Task Group 6: Liquibase Migration, JPA Entity/DTO Update, and deleteByRunId
**Dependencies:** None (can be developed in parallel with Task Groups 1-5)

- [x] 6.0 Complete architecture-model-service changes for Phase 1d
  - [x] 6.1 Write 4 focused tests for the migration, entity update, and delete capability (JUnit 5)
    - Test `DiscoveryCandidateEntity` can be persisted and retrieved with a non-null `parentCandidateId` pointing to another candidate's ID
    - Test `DiscoveryCandidateEntity` can be persisted with `parentCandidateId` null (backward compatible)
    - Test `DiscoveryCandidateService.deleteByRunId` removes all candidates for a given run and returns the deleted count
    - Test `DiscoveryCandidateController` DELETE endpoint returns 200 with count of deleted candidates; deleting for a non-existent runId returns 0 without error
  - [x] 6.2 Create Liquibase migration SQL file `architecture-model-service/src/main/resources/db/changelog/sql/072-candidate-parent-candidate-id.sql`
    - Add column: `ALTER TABLE discovery_candidate ADD COLUMN IF NOT EXISTS parent_candidate_id UUID`
    - Add nullable self-referencing FK: `ALTER TABLE discovery_candidate ADD CONSTRAINT fk_discovery_candidate_parent FOREIGN KEY (parent_candidate_id) REFERENCES discovery_candidate(id) ON DELETE SET NULL`
    - Add composite index: `CREATE INDEX IF NOT EXISTS idx_discovery_candidate_run_parent ON discovery_candidate (run_id, parent_candidate_id)`
    - Follow exact SQL commenting pattern from `070-discovery-candidate.sql`
  - [x] 6.3 Register the migration in `db.changelog-master.yaml`
    - Add new changeset entry `072-candidate-parent-candidate-id` after the last existing entry
    - Use `preConditions` with `columnExists` negative guard (consistent with existing patterns)
  - [x] 6.4 Add `parentCandidateId` field to `DiscoveryCandidateEntity.java`
    - Add `@Column(name = "parent_candidate_id")` UUID field, nullable
    - No `@ManyToOne` -- keep as plain UUID to match the lightweight FK pattern used elsewhere
  - [x] 6.5 Add `parentCandidateId` field to `DiscoveryCandidateDto.java`
    - Add `@JsonProperty("parent_candidate_id") UUID parentCandidateId` to the record fields
    - Update the service's `toDto()` method and `bulkCreate` builder to include the new field
  - [x] 6.6 Add `deleteByRunId` method to `DiscoveryCandidateRepository`
    - Add `void deleteByRunId(UUID runId)` derived query method
    - Spring Data JPA derives the DELETE query automatically from the method name
  - [x] 6.7 Add `deleteByRunId` method to `DiscoveryCandidateService`
    - `@Transactional` method: `deleteByRunId(UUID runId): long`
    - Count candidates before delete (for return value), then call `candidateRepository.deleteByRunId(runId)`, return count
    - Follow exact pattern from `DiscoveryClusterService.deleteByRunId`
  - [x] 6.8 Add DELETE endpoint to `DiscoveryCandidateController`
    - `DELETE /api/model/projects/{projectId}/discovery/runs/{runId}/candidates`
    - Calls `discoveryCandidateService.deleteByRunId(runId)`
    - Returns `Map.of("deleted", count)`
    - Follow exact pattern from `DiscoveryClusterController` DELETE endpoint
  - [x] 6.9 Ensure JPA tests pass
    - Run ONLY the 4 tests written in 6.1

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- Migration adds `parent_candidate_id` column with self-referencing FK and composite index
- Entity and DTO correctly round-trip the new `parentCandidateId` field
- DELETE endpoint cascade-deletes candidates for a run (or returns 0 for non-existent run)
- Backward compatible: existing candidates with null `parentCandidateId` continue to work

---

### Discovery-Service Client Method: deleteCandidatesByRunId

#### Task Group 7: archModelClient Candidate Delete Method
**Dependencies:** Task Groups 1, 6

- [x] 7.0 Complete archModelClient extension for candidate delete
  - [x] 7.1 Write 2 focused tests for the new client method
    - Test `deleteCandidatesByRunId` sends DELETE to the correct URL `/api/model/projects/{projectId}/discovery/runs/{runId}/candidates`
    - Test `deleteCandidatesByRunId` returns the count from the response body
  - [x] 7.2 Add `deleteCandidatesByRunId` method to `discovery-service/src/services/archModelClient.ts`
    - `async deleteCandidatesByRunId(projectId: string, runId: string): Promise<number>`
    - Sends DELETE to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}/candidates`
    - Extracts `deleted` count from response body
    - Follow existing `deleteClustersByRunId` method pattern exactly (error handling, URL encoding)
  - [x] 7.3 Ensure client method tests pass
    - Run ONLY the 2 tests written in 7.1

**Acceptance Criteria:**
- The 2 tests written in 7.1 pass
- Method follows the identical pattern of `deleteClustersByRunId`
- URL construction uses `encodeURIComponent` for path parameters

---

### Gateway: 1d DecisionTask Prompt Templates and Resolution Extensions

#### Task Group 8: LLM Prompt Templates for 1d Tasks
**Dependencies:** None (can be developed in parallel with all other groups)

- [x] 8.0 Complete LLM prompt templates for 1d DecisionTask types
  - [x] 8.1 Create `gateway/src/config/prompts/discovery.candidate-type-classification.prompt.md`
    - System context: "You are analyzing a discovery candidate to determine its most appropriate architecture meta-model element type."
    - Input sections for: candidate summary (candidateType, name, confidence, sourceClusterIds, generationReason, memberFilePaths), competing type signals (type, signalStrength)
    - Expected JSON output format: `{ "selectedType": "<CandidateType>", "adjustedConfidence": <0.0-1.0>, "reasoning": "<brief explanation>" }`
    - List valid CandidateType values in the prompt instructions
    - Explicit instruction to return ONLY valid JSON
  - [x] 8.2 Create `gateway/src/config/prompts/discovery.candidate-parent-assignment.prompt.md`
    - System context: "You are analyzing a discovery candidate to determine which parent candidate it should be assigned to in the architecture hierarchy."
    - Input sections for: candidate summary, competing parents (parentId, parentName, parentType, signal description)
    - Expected JSON output format: `{ "selectedParentId": "<string>"|null, "adjustedConfidence": <0.0-1.0>, "reasoning": "<brief explanation>" }`
  - [x] 8.3 Create `gateway/src/config/prompts/discovery.candidate-name-refinement.prompt.md`
    - System context: "You are refining the name of a discovery candidate whose auto-generated name is weak or ambiguous."
    - Input sections for: candidate summary, current weak name, member file paths
    - Expected JSON output format: `{ "refinedName": "<improved name>", "reasoning": "<brief explanation>" }`
  - [x] 8.4 Create `gateway/src/config/prompts/discovery.candidate-merge-decision.prompt.md`
    - System context: "You are analyzing two discovery candidates to decide whether they should be merged into one or kept separate."
    - Input sections for: candidate A summary, candidate B summary, overlapping cluster IDs
    - Expected JSON output format: `{ "decision": "merge"|"keep_separate", "reasoning": "<brief explanation>" }`
  - [x] 8.5 Create `gateway/src/config/prompts/discovery.candidate-rejection-review.prompt.md`
    - System context: "You are analyzing a low-confidence discovery candidate to decide whether it should be kept or rejected from the discovery results."
    - Input sections for: candidate summary, rejection indicators list
    - Expected JSON output format: `{ "decision": "keep"|"reject", "reasoning": "<brief explanation>" }`

**Acceptance Criteria:**
- Prompts are stored as `.prompt.md` files following the existing naming convention (`discovery.<task-type-kebab-case>.prompt.md`)
- Prompts specify the exact JSON response schema the LLM must produce
- Prompts include clear instructions about returning valid JSON only
- Each prompt includes relevant interpolation variables matching the 1d input interfaces

#### Task Group 9: Gateway Prompt Interpolation and Route Extensions for 1d
**Dependencies:** Task Groups 1, 8

- [x] 9.0 Complete gateway prompt infrastructure extensions for 1d
  - [x] 9.1 Write 5 focused tests for the 1d gateway extensions (Jest)
    - Test that `loadPromptTemplate` accepts the five new 1d task type strings and loads the correct `.prompt.md` files
    - Test that `interpolateTemplate` for `candidate_type_classification` correctly substitutes candidate summary and competing type signal variables
    - Test that `interpolateTemplate` for `candidate_parent_assignment` correctly substitutes candidate summary and competing parent variables
    - Test that `buildMessagesForTask` for 1d task types produces the correct system + user message array
    - Test that the resolution endpoint processes a `candidate_name_refinement` task and returns resolved result with `refinedName` in outputData
  - [x] 9.2 Extend `DecisionTaskTypeString` union in `gateway/src/routes/discoveryDecisionTaskPrompts.ts`
    - Add: `'candidate_type_classification'`, `'candidate_parent_assignment'`, `'candidate_name_refinement'`, `'candidate_merge_decision'`, `'candidate_rejection_review'`
    - Update the JSDoc comment to include Phase 1d types
  - [x] 9.3 Extend `PROMPT_TEMPLATE_FILES` map with 5 new entries
    - `'candidate_type_classification': 'discovery.candidate-type-classification.prompt.md'`
    - `'candidate_parent_assignment': 'discovery.candidate-parent-assignment.prompt.md'`
    - `'candidate_name_refinement': 'discovery.candidate-name-refinement.prompt.md'`
    - `'candidate_merge_decision': 'discovery.candidate-merge-decision.prompt.md'`
    - `'candidate_rejection_review': 'discovery.candidate-rejection-review.prompt.md'`
  - [x] 9.4 Extend `interpolateTemplate()` with five new branches for 1d task types
    - `candidate_type_classification`: extract `candidateSummary`, `competingTypeSignals` from inputData; interpolate `{{CANDIDATE_TYPE}}`, `{{CANDIDATE_NAME}}`, `{{CANDIDATE_CONFIDENCE}}`, `{{CANDIDATE_SOURCE_CLUSTERS}}`, `{{CANDIDATE_GENERATION_REASON}}`, `{{CANDIDATE_MEMBER_PATHS}}`, `{{COMPETING_TYPE_SIGNALS}}`
    - `candidate_parent_assignment`: extract `candidateSummary`, `competingParents`; interpolate candidate summary fields + `{{COMPETING_PARENTS}}`
    - `candidate_name_refinement`: extract `candidateSummary`, `currentName`, `memberFilePaths`; interpolate candidate summary fields + `{{CURRENT_NAME}}`, `{{MEMBER_FILE_PATHS}}`
    - `candidate_merge_decision`: extract `candidateA`, `candidateB`, `overlappingClusterIds`; interpolate `{{CANDIDATE_A_*}}`, `{{CANDIDATE_B_*}}`, `{{OVERLAPPING_CLUSTER_IDS}}`
    - `candidate_rejection_review`: extract `candidateSummary`, `rejectionIndicators`; interpolate candidate summary fields + `{{REJECTION_INDICATORS}}`
    - Create per-type interpolation helper functions following the 1c pattern (e.g., `interpolateCandidateTypeClassification()`, `interpolateCandidateParentAssignment()`, etc.)
    - Create `interpolateCandidateSummaryFields()` shared helper for common candidate summary field substitution (analogous to `interpolateClusterSummaryFields()`)
  - [x] 9.5 Extend `buildUserMessage()` with 1d user message text
    - `candidate_type_classification`: "Please evaluate the discovery candidate described above and select the most appropriate architecture meta-model element type from the competing signals. Return your decision as valid JSON."
    - `candidate_parent_assignment`: "Please evaluate the discovery candidate described above and determine which parent candidate it should be assigned to, or none. Return your decision as valid JSON."
    - `candidate_name_refinement`: "Please suggest a refined, descriptive name for the discovery candidate described above. Return your decision as valid JSON."
    - `candidate_merge_decision`: "Please evaluate whether the two discovery candidates described above should be merged or kept separate. Return your decision as valid JSON."
    - `candidate_rejection_review`: "Please evaluate whether the low-confidence discovery candidate described above should be kept or rejected. Return your decision as valid JSON."
  - [x] 9.6 Ensure gateway 1d extension tests pass
    - Run ONLY the 5 tests written in 9.1

**Acceptance Criteria:**
- The 5 tests written in 9.1 pass
- All five new task types are supported in `PROMPT_TEMPLATE_FILES`, `loadPromptTemplate`, `interpolateTemplate`, `buildMessagesForTask`
- `DecisionTaskTypeString` union includes all 11 task type strings (2 from 1b + 4 from 1c + 5 from 1d)
- The resolution endpoint correctly processes 1d task types without changes to the core resolution loop (only prompt/interpolation changes needed)
- Per-type interpolation helpers follow the established 1c pattern

---

### Discovery-Service: Phase 1d Orchestration

#### Task Group 10: Replace executeStep1d Stub with Real Orchestration
**Dependencies:** Task Groups 1, 2, 3, 4, 5, 7

- [x] 10.0 Complete Phase 1d orchestration logic
  - [x] 10.1 Write 7 focused tests for the executeStep1d orchestration
    - Test full happy path: mock upstream clusters, atoms, and relationships returned; mock rules producing candidate proposals across all confidence bands; verify auto-accepted proposals are converted and persisted as `DiscoveryCandidate` records; DecisionTasks are created and resolved; summary metadata is correct
    - Test that high-confidence proposals bypass DecisionTask creation and are persisted directly via `bulkSaveCandidates`
    - Test that low-confidence proposals (below `CANDIDATE_AMBIGUOUS_THRESHOLD`) are discarded -- not persisted and not turned into DecisionTasks
    - Test that type ambiguity (competing type signals, no dominant signal) produces a `candidate_type_classification` DecisionTask with correct `CandidateTypeClassificationInput`
    - Test that a resolved parent assignment decision (selectedParentId returned) causes the candidate's `parentCandidateId` to be set correctly in the final persisted set
    - Test that weak-named proposals produce `candidate_name_refinement` DecisionTasks and resolved names are applied to final candidates
    - Test the delete-and-recreate flow: after adjudication, `deleteCandidatesByRunId` is called before `bulkSaveCandidates` with the final candidate set
  - [x] 10.2 Replace `executeStep1d` stub in `discovery-service/src/services/runManager.ts`
    - Keep the same function signature: `(projectId: string, runId: string) => Promise<Record<string, unknown>>`
    - Step 1: Fetch 1c clusters via `archModelClient.getClustersByRun(projectId, runId)`
    - Step 2: Fetch 1a atoms via `archModelClient.getEvidenceByRun(projectId, runId)`
    - Step 3: Fetch 1b relationships via `archModelClient.getRelationshipsByRun(projectId, runId)`
    - Step 4: Fetch discovery config via `archModelClient.getDiscoveryConfig(projectId)` for `repoApplicationMappings` and `techHints`
    - Step 5: Run candidate generation rules via `executeCandidateGenerationPasses(clusters, atoms, relationships, getCandidateGenerationRuleRegistry(), config)`
    - Step 6: Triage proposals via `triageCandidateProposals(proposals)`
    - Step 7: Convert auto-accepted proposals to `DiscoveryCandidate` objects (generate UUIDs, set runId, populate `data` payload with generationReason, ruleIds, nameQuality, adjudicationHistory as empty array, set `parentCandidateId` from deterministic signals), persist via `archModelClient.bulkSaveCandidates()` in batches using `BULK_SAVE_BATCH_SIZE`
    - Step 8: Create DecisionTasks for ambiguous proposals based on ambiguity group type; populate typed `inputData` with `phase: '1d'`; persist via `archModelClient.bulkSaveDecisionTasks()`
    - Step 9: Resolve tasks via `gatewayClient.resolveDecisionTasks(projectId, runId, pendingTasks)`
    - Step 10: Process adjudication results -- apply type corrections (update `candidateType`), parent assignments (set `parentCandidateId`), name refinements (update `name`), merge decisions (combine proposals), rejection decisions (remove from final set); record task references in `adjudicationHistory` within `data` payload
    - Step 11: Delete-and-recreate: call `archModelClient.deleteCandidatesByRunId(projectId, runId)`, then `archModelClient.bulkSaveCandidates(projectId, runId, finalCandidates)` in batches
    - Step 12: Update each DecisionTask record via `archModelClient.updateDecisionTask()` with resolved status, outputData, resolvedAt
    - Step 13: Return summary metadata
  - [x] 10.3 Implement the candidate data payload builder
    - Create a helper function `buildCandidateDataPayload(proposal: CandidateProposal, clusters: EvidenceCluster[], atoms: EvidenceAtom[]): Record<string, unknown>`
    - Populate: `generationReason` (string), `ruleIds` (string[]), `nameQuality` (string), `dominantLanguage` (most common language among member atoms from source clusters), `directoryRoot` (common path prefix of source cluster member atoms), `memberSummary` ({ atomCount, clusterCount }), `adjudicationHistory` (initially empty array)
  - [x] 10.4 Implement the proposal-to-DiscoveryCandidate converter
    - Create a helper function `proposalToCandidate(proposal: CandidateProposal, runId: string, parentCandidateId?: string): DiscoveryCandidate`
    - Generate UUID for `id`
    - Map `candidateType`, `name`, `confidence`, `sourceClusterIds` directly
    - Set `status: 'proposed'`
    - Set `parentCandidateId` from parameter (may be undefined)
    - Set `synthesizedAt` to current ISO string
    - Set `data` via `buildCandidateDataPayload()`
  - [x] 10.5 Implement summary metadata return
    - `candidateCount`: total candidates persisted after adjudication
    - `autoAcceptedCount`: candidates persisted without LLM review
    - `decisionTaskCount`: total DecisionTasks created
    - `decisionTaskResolvedCount`: tasks successfully resolved by LLM
    - `decisionTaskFailedCount`: tasks that failed LLM resolution
    - `discardedCount`: proposals auto-discarded below `CANDIDATE_AMBIGUOUS_THRESHOLD`
    - `upstreamClusterCount`: total 1c clusters fetched
    - `candidatesByType`: breakdown object with count per CandidateType (e.g., `{ application: 2, service: 5, interface: 3, ... }`)
  - [x] 10.6 Add imports for new dependencies in runManager.ts
    - Import `getCandidateGenerationRuleRegistry` from `./candidateGenerationRuleRegistry`
    - Import `executeCandidateGenerationPasses` from `./candidateGenerationEngine`
    - Import `triageCandidateProposals` from `./candidateTriageEngine`
    - Import `CandidateProposal`, `CandidateTypeClassificationInput`, `CandidateTypeClassificationOutput`, `CandidateParentAssignmentInput`, `CandidateParentAssignmentOutput`, `CandidateNameRefinementInput`, `CandidateNameRefinementOutput`, `CandidateMergeDecisionInput`, `CandidateMergeDecisionOutput`, `CandidateRejectionReviewInput`, `CandidateRejectionReviewOutput`, `CandidateSummary` from types
    - Import candidate defaults from `../constants/candidateDefaults`
  - [x] 10.7 Initialize candidate generation rule registry at discovery-service startup
    - Call `initializeCandidateGenerationRuleRegistry()` in the service's startup/initialization path (alongside `initializeClusteringRuleRegistry()` and `initializeLinkerRuleRegistry()` and `initializeAnalyzerRegistry()`)
    - Verify this is called before any run can execute
  - [x] 10.8 Ensure orchestration tests pass
    - Run ONLY the 7 tests written in 10.1

**Acceptance Criteria:**
- The 7 tests written in 10.1 pass
- `executeStep1d` function signature remains compatible with the existing step sequencing in `startRun`
- Summary metadata includes all 8 required fields plus `candidatesByType` breakdown
- Candidate `data` payload contains generationReason, ruleIds, nameQuality, dominantLanguage, directoryRoot, memberSummary, adjudicationHistory
- Delete-and-recreate semantics are used after adjudication (call `deleteCandidatesByRunId` before final `bulkSaveCandidates`)
- `parentCandidateId` is correctly assigned from deterministic signals and from resolved DecisionTask adjudication
- Name refinements from resolved DecisionTasks are applied to final candidates
- Type corrections from resolved DecisionTasks update `candidateType` on final candidates
- Merged candidates combine sourceClusterIds and take higher confidence
- Rejected candidates are excluded from final persistence
- Candidate generation rule registry is initialized before runs can execute

---

### Testing: Review and Gap Analysis

#### Task Group 11: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-10

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests from Task Groups 1-10
    - Review the 6 type definition tests (Task 1.1)
    - Review the 3 threshold/registry tests (Task 2.1)
    - Review the 8 generation rule tests (Task 3.1)
    - Review the 5 multi-pass execution tests (Task 4.1)
    - Review the 6 candidate triage engine tests (Task 5.1)
    - Review the 4 JPA migration/entity/delete tests (Task 6.1)
    - Review the 2 client method tests (Task 7.1)
    - Review the 5 gateway extension tests (Task 9.1)
    - Review the 7 orchestration tests (Task 10.1)
    - Total existing tests: approximately 46 tests
  - [x] 11.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus on integration points: generation engine -> triage -> DecisionTask creation -> gateway resolution -> adjudication -> delete-and-recreate
    - Assess whether parent assignment, name refinement, and type correction adjudication paths have adequate coverage
    - Do NOT assess entire application test coverage
  - [x] 11.3 Write up to 10 additional strategic tests maximum
    - Possible gap areas (implement only if gaps exist after review):
      - End-to-end orchestration test with all 5 rules producing proposals across all 3 confidence tiers
      - Candidate triage engine edge case: empty proposal list returns empty buckets and no ambiguity groups
      - Multi-pass merge: three proposals with pairwise sourceClusterIds overlaps are iteratively merged correctly
      - One-to-many expansion: a `service_boundary` cluster producing both a service and an interface candidate retains correct traceability
      - Gateway interpolation: all five 1d prompt templates produce valid interpolated output with no unresolved `{{...}}` placeholders
      - archModelClient `deleteCandidatesByRunId`: verify `encodeURIComponent` on path params with special characters
      - `executeStep1d` with zero clusters returns zero-count summary without errors
      - Deterministic naming: candidate with cluster name 'payment-service' gets `nameQuality: 'strong'`; candidate with cluster name 'module-3' gets `nameQuality: 'weak'`
      - Parent assignment via Phase 0 anchor: a service candidate from a cluster anchored to an application name gets `parentCandidateId` set to the application candidate's ID
      - DecisionTask adjudication: rejection review returning `decision: 'reject'` removes the candidate from the final persisted set
  - [x] 11.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 9.1, 10.1, and 11.3)
    - Expected total: approximately 46-56 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 46-56 tests total)
- Critical end-to-end orchestration flow is covered
- Parent assignment, name refinement, type correction, merge, and rejection adjudication paths are verified
- No more than 10 additional tests added to fill gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

```
Phase A: Foundation (parallel tracks)
  Track 1: Task Group 1 (Types) -> Task Group 2 (Registry/Defaults) -> Task Group 3 (Rules)
  Track 2: Task Group 6 (JPA Migration + Entity/DTO Update + Delete -- independent Java work)
  Track 3: Task Group 8 (Prompt Templates -- independent file creation)

Phase B: Engine and Integration Layer (after Phase A)
  Task Group 4 (Multi-Pass Generation Engine -- needs types + rules from TG1-3)
  Task Group 5 (Candidate Triage Engine -- needs types + defaults from TG1-2)
  Task Group 7 (archModelClient delete method -- needs TG1 types + TG6 JPA endpoint)
  Task Group 9 (Gateway Prompt Extensions -- needs TG1 types + TG8 prompts)

Phase C: Orchestration (after Phase B)
  Task Group 10 (Phase 1d Orchestration -- depends on all Phase A and B groups)

Phase D: Testing (after Phase C)
  Task Group 11 (Test Review & Gap Analysis)
```

**Critical path**: Task Group 1 -> Task Group 2 -> Task Group 3 -> Task Group 4 -> Task Group 10 (discovery-service TypeScript work is largely sequential)

**Parallelizable**:
- Task Group 6 (Java/Spring Boot JPA migration + delete) can proceed independently of all TypeScript work
- Task Group 8 (prompt template files) can proceed independently of all code work
- Task Groups 4 and 5 can be developed in parallel once TG1-3 are complete
- Task Group 7 can proceed once TG1 and TG6 are complete
- Task Group 9 can proceed once TG1 and TG8 are complete

## File Inventory

### New Files (17 files)

**discovery-service (11 new files):**
- `discovery-service/src/types/candidateGenerationRule.ts`
- `discovery-service/src/constants/candidateDefaults.ts`
- `discovery-service/src/services/candidateGenerationRuleRegistry.ts`
- `discovery-service/src/services/candidateGenerationRules/index.ts`
- `discovery-service/src/services/candidateGenerationRules/anchorTypeRule.ts`
- `discovery-service/src/services/candidateGenerationRules/serviceComponentRule.ts`
- `discovery-service/src/services/candidateGenerationRules/dataEntityRule.ts`
- `discovery-service/src/services/candidateGenerationRules/interfaceRule.ts`
- `discovery-service/src/services/candidateGenerationRules/fallbackPackageRule.ts`
- `discovery-service/src/services/candidateGenerationEngine.ts`
- `discovery-service/src/services/candidateTriageEngine.ts`

**gateway (5 new files):**
- `gateway/src/config/prompts/discovery.candidate-type-classification.prompt.md`
- `gateway/src/config/prompts/discovery.candidate-parent-assignment.prompt.md`
- `gateway/src/config/prompts/discovery.candidate-name-refinement.prompt.md`
- `gateway/src/config/prompts/discovery.candidate-merge-decision.prompt.md`
- `gateway/src/config/prompts/discovery.candidate-rejection-review.prompt.md`

**architecture-model-service (1 new file):**
- `architecture-model-service/src/main/resources/db/changelog/sql/072-candidate-parent-candidate-id.sql`

### Modified Files (12 files)

**discovery-service (5 modified files):**
- `discovery-service/src/types/candidate.ts` -- add optional `parentCandidateId` field to `DiscoveryCandidate`
- `discovery-service/src/types/decisionTask.ts` -- add 5 new task types with typed input/output interfaces, `CandidateSummary` interface
- `discovery-service/src/types/index.ts` -- add exports for `candidateGenerationRule` types and new `decisionTask` types
- `discovery-service/src/services/archModelClient.ts` -- add `deleteCandidatesByRunId` method
- `discovery-service/src/services/runManager.ts` -- replace `executeStep1d` stub with real orchestration logic; add `initializeCandidateGenerationRuleRegistry()` call at startup

**architecture-model-service (6 modified files):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryCandidateEntity.java` -- add `parentCandidateId` UUID field
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryCandidateDto.java` -- add `parentCandidateId` record field
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateService.java` -- add `deleteByRunId` method, update `toDto()` and `bulkCreate` for new field
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryCandidateRepository.java` -- add `deleteByRunId` derived query method
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryCandidateController.java` -- add DELETE endpoint
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` -- add `072-candidate-parent-candidate-id` changeset entry

**gateway (1 modified file):**
- `gateway/src/routes/discoveryDecisionTaskPrompts.ts` -- extend `DecisionTaskTypeString` with 5 new values, extend `PROMPT_TEMPLATE_FILES`, add 5 interpolation branches with per-type helper functions, add 5 user message builders
