# Specification: Phase 1d Candidate Generation

## Goal
Replace the backbone stub in `executeStep1d` with real candidate generation logic that synthesizes discovery candidates from Phase 1c clusters, mapping each cluster to one or more architecture meta-model element proposals via deterministic rules, candidate-specific triage, and LLM-assisted DecisionTask adjudication for ambiguous cases.

## User Stories
- As a discovery pipeline operator, I want Phase 1d to automatically synthesize typed, named, hierarchically-organized candidates from 1c clusters so that the evidence pipeline produces actionable meta-model element proposals.
- As an architect reviewing discovery results, I want candidates to have meaningful names, correct parent/child relationships, and accurate type classifications so I can trust the automated discovery output.

## Specific Requirements

**CandidateGenerationRule interface and registry**
- Define a `CandidateGenerationRule` interface in a new file `discovery-service/src/types/candidateGenerationRule.ts` following the `ClusteringRule` pattern: `id`, `name`, `description`, and a `generate()` method
- The `generate()` method receives finalized `EvidenceCluster[]`, upstream `EvidenceAtom[]`, `EvidenceRelationship[]`, existing `CandidateProposal[]` from prior passes, and the Phase 0 config payload (repoApplicationMappings, techHints)
- Create `candidateGenerationRuleRegistry.ts` following the `clusteringRuleRegistry.ts` pattern: `Map<string, CandidateGenerationRule>`, `initializeCandidateGenerationRuleRegistry()`, `registerCandidateGenerationRule()`, `getCandidateGenerationRuleRegistry()`
- Create a `discovery-service/src/services/candidateGenerationRules/` directory with an `index.ts` barrel that exports all rules and a `registerAllCandidateGenerationRules()` function
- Registration order defines pass order: anchor-type rule first (application candidates), then service/component rule, then data entity rule, then interface rule, then fallback/package rule

**CandidateProposal internal intermediate type**
- Define `CandidateProposal` in `candidateGenerationRule.ts` analogous to `CandidateCluster` and `CandidateRelationship` -- internal to discovery-service, never persisted directly
- Fields: `candidateType: CandidateType`, `name: string`, `confidence: number`, `sourceClusterIds: string[]`, `parentProposalRef?: string` (temporary in-memory reference for parent linking within a generation pass), `ruleId: string`, `generationReason: string`, `data: Record<string, unknown>`, `nameQuality: 'strong' | 'weak'` (signal for triage to decide if naming refinement is needed)
- Optional `typeSignals?: Array<{ type: CandidateType; signalStrength: number }>` for ambiguous type cases, paralleling the cluster `typeSignals` pattern

**Deterministic cluster-to-type mapping**
- `service_boundary` clusters -> `service` candidate (or `application` if anchored to a Phase 0 repoApplicationMapping name)
- `data_domain` clusters -> `data_entity` candidate (or `logical_entity` if cluster data indicates logical rather than physical data)
- `api_layer` clusters -> `interface` candidate
- `ui_module` clusters -> `app_component` candidate
- `shared_library` clusters -> `app_component` candidate
- `package_module` clusters -> `app_component` candidate (lowest confidence)
- `unknown` type clusters -> produce a `candidate_type_classification` DecisionTask; do not assign a type deterministically
- Phase 0 anchor names influence type: a `service_boundary` cluster whose name matches a `repoApplicationMappings` entry produces an `application` candidate instead of `service`; the anchor boosts confidence but does not override if other strong signals disagree

**One-to-many cluster-to-candidate expansion**
- A single cluster can produce 1-to-N candidates; for example, a `service_boundary` cluster containing API route evidence also produces an `interface` candidate alongside the `service` candidate
- Each resulting candidate carries the source cluster's ID in `sourceClusterIds` for traceability
- Expansion logic lives inside individual generation rules, not as a separate engine pass

**Parent/child relationship assignment**
- Extend `DiscoveryCandidate` interface in `candidate.ts` with an optional `parentCandidateId?: string` field
- Add a `parent_candidate_id UUID` column to the `discovery_candidate` table via a new Liquibase migration SQL file; add a nullable self-referencing FK and an index on `(run_id, parent_candidate_id)`
- Add the matching field to `DiscoveryCandidateEntity.java` and `DiscoveryCandidateDto.java`
- Deterministic parent assignment signals: (a) Phase 0 anchor -- a `service` candidate from a cluster anchored to an application name gets that application candidate as parent; (b) filesystem containment -- `contains` relationships from 1b between atoms in different clusters imply parent/child; (c) within-pass ordering -- generation rules that produce `application` candidates in earlier passes make those available as parents for later `service`/`app_component` candidates
- When a candidate has exactly one strong parent signal, assign `parentCandidateId` deterministically
- When a candidate has zero or multiple competing parent signals, create a `candidate_parent_assignment` DecisionTask

**Deterministic candidate naming with LLM fallback**
- First-priority name source: cluster `name` field (often set by anchor hint rule in 1c)
- Second-priority: directory or package name extracted from the dominant file path prefix of cluster member atoms
- Third-priority: prominent symbol name (most-referenced class/module name from member atoms)
- If the resulting name is generic (e.g., matches patterns like "unknown", "misc", "module-N", single characters, or is entirely numeric), mark `nameQuality: 'weak'` on the proposal
- Only weak-named proposals produce a `candidate_name_refinement` DecisionTask; strong names pass through without LLM involvement

**Candidate triage engine**
- Create `discovery-service/src/services/candidateTriageEngine.ts` as a pure function following the `clusterTriageEngine.ts` pattern
- Three confidence buckets: auto-accept (>= threshold), ambiguous (>= lower threshold and < upper), discard (< lower threshold)
- Create `discovery-service/src/constants/candidateDefaults.ts` with: `CANDIDATE_AUTO_ACCEPT_THRESHOLD` (0.75), `CANDIDATE_AMBIGUOUS_THRESHOLD` (0.35), `CANDIDATE_TYPE_DOMINANCE_THRESHOLD` (0.6), `CANDIDATE_WEAK_NAME_PATTERNS` (regex array)
- Candidate confidence is computed independently from cluster confidence using candidate-specific signals: type mapping certainty (single strong mapping = high, ambiguous = low), naming quality, parent assignment clarity, cluster member count
- Ambiguity groups detected by the triage engine: `type_review` (ambiguous type signals), `parent_review` (multiple competing parents), `name_review` (weak name quality), `merge_review` (overlapping sourceClusterIds between candidates), `rejection_review` (extremely low confidence candidates that might still be salvageable)

**Five 1d DecisionTask types**
- Extend `DecisionTaskType` union in `decisionTask.ts` with: `candidate_type_classification`, `candidate_parent_assignment`, `candidate_name_refinement`, `candidate_merge_decision`, `candidate_rejection_review`
- Define input/output interfaces for each new type following the established pattern (e.g., `CandidateTypeClassificationInput`/`Output`, `CandidateParentAssignmentInput`/`Output`, etc.)
- `candidate_type_classification`: input includes candidate summary + competing type signals; output is `selectedType: CandidateType`, `adjustedConfidence`, `reasoning`
- `candidate_parent_assignment`: input includes candidate summary + competing parent candidates; output is `selectedParentId: string | null`, `adjustedConfidence`, `reasoning`
- `candidate_name_refinement`: input includes candidate summary + current weak name + member file paths; output is `refinedName: string`, `reasoning`
- `candidate_merge_decision`: input includes two candidate summaries + overlapping cluster IDs; output is `decision: 'merge' | 'keep_separate'`, `reasoning`
- `candidate_rejection_review`: input includes candidate summary + rejection indicators; output is `decision: 'keep' | 'reject'`, `reasoning`
- Add all new input/output types to the `DecisionTaskInput`/`DecisionTaskOutput` unions and to the barrel export in `types/index.ts`

**Gateway prompt templates and interpolation for 1d tasks**
- Create 5 new `.prompt.md` files in `gateway/src/config/prompts/`: `discovery.candidate-type-classification.prompt.md`, `discovery.candidate-parent-assignment.prompt.md`, `discovery.candidate-name-refinement.prompt.md`, `discovery.candidate-merge-decision.prompt.md`, `discovery.candidate-rejection-review.prompt.md`
- Extend `DecisionTaskTypeString` union in `discoveryDecisionTaskPrompts.ts` with the 5 new type strings
- Add entries to the `PROMPT_TEMPLATE_FILES` map for each new type
- Add interpolation branches in `interpolateTemplate()` for each new type, with type-specific helpers (following the 1c pattern of per-type interpolation helper functions)
- Add user message branches in `buildUserMessage()` for each new type

**candidateGenerationEngine for ordered rule execution**
- Create `discovery-service/src/services/candidateGenerationEngine.ts` following the `clusteringEngine.ts` multi-pass pattern
- `executeCandidateGenerationPasses()` function: iterates rules in registry order, each pass receives clusters, atoms, relationships, existing proposals from prior passes, and config
- Between passes, detect and merge overlapping proposals (proposals from different rules that share >70% of the same sourceClusterIds) by combining into the higher-confidence proposal
- After all passes, flag proposals with weak names using the patterns from `candidateDefaults.ts`
- Pure function with no I/O -- receives all data as parameters, returns `CandidateProposal[]`

**Full executeStep1d orchestration**
- Replace the current stub with the full orchestration following the `executeStep1c` pattern: (1) fetch upstream clusters via `getClustersByRun`, (2) fetch atoms via `getEvidenceByRun`, (3) fetch relationships via `getRelationshipsByRun`, (4) fetch discovery config for Phase 0 mappings, (5) run candidate generation rules via `executeCandidateGenerationPasses`, (6) triage proposals via `triageCandidateProposals`, (7) convert auto-accepted proposals to `DiscoveryCandidate` and persist via `bulkSaveCandidates`, (8) create DecisionTasks for ambiguous proposals and persist, (9) resolve tasks via `gatewayClient.resolveDecisionTasks`, (10) apply adjudication results (type corrections, parent assignments, name refinements, merges, rejections), (11) delete-and-recreate final candidate set, (12) return summary metadata
- Batch persistence using the same `BULK_SAVE_BATCH_SIZE` pattern as 1c
- Delete-and-recreate semantics: add a `deleteCandidatesByRunId` method to `archModelClient` (paralleling `deleteClustersByRunId`), and add the corresponding DELETE endpoint to the architecture-model-service candidate controller

**Phase 1 completion signaling**
- `executeStep1d` returns summary metadata: `candidateCount`, `autoAcceptedCount`, `decisionTaskCount`, `decisionTaskResolvedCount`, `decisionTaskFailedCount`, `discardedCount`, `upstreamClusterCount`, `candidatesByType` (breakdown by CandidateType)
- The existing `startRun()` loop marks the overall run as `COMPLETED` after `executeStep1d` succeeds -- no additional signaling logic needed
- The step metadata in `stepsPayload['1d']` includes all returned summary fields, making Phase 1 completion clearly auditable

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**ClusteringRule / CandidateCluster pattern (`types/clusteringRule.ts`)**
- Defines the `ClusteringRule` interface with `id`, `name`, `description`, and `match()` method, plus the internal `CandidateCluster` intermediate type
- Directly replicate this pattern for `CandidateGenerationRule` with a `generate()` method and `CandidateProposal` internal type
- The `typeSignals` optional field on `CandidateCluster` should also appear on `CandidateProposal` for consistency

**clusteringRuleRegistry.ts and clusteringRules/ directory**
- Module-level `Map<string, ClusteringRule>` with `initialize`, `register`, `get` functions
- The `clusteringRules/index.ts` barrel provides `registerAllClusteringRules()` and exports individual rules
- Replicate both the registry module and the rules directory structure for candidate generation rules

**clusterTriageEngine.ts (pure-function triage with confidence buckets)**
- `triageClusterCandidates()` partitions candidates into accepted/ambiguous/discarded using threshold constants, then layers structural ambiguity checks (merge, type, noise, anchor review)
- Replicate this exact pattern for `triageCandidateProposals()` but with candidate-specific ambiguity groups (type, parent, name, merge, rejection review)

**executeStep1c in runManager.ts (lines 664-1128)**
- Full 12-step orchestration: fetch upstream data, run rules, triage, persist auto-accepted, create DecisionTasks, resolve via gateway, apply adjudication, delete-and-recreate, return summary metadata
- This is the primary template for `executeStep1d`; the structure is nearly identical with different entity types

**discoveryDecisionTaskPrompts.ts (gateway prompt template/interpolation system)**
- `DecisionTaskTypeString` union, `PROMPT_TEMPLATE_FILES` map, `loadPromptTemplate()`, `interpolateTemplate()` with per-type dispatch, `buildMessagesForTask()` with per-type user messages
- Extend all of these with 5 new 1d type entries; add per-type interpolation helper functions following the pattern of `interpolateClusterMergeDecision()` etc.

## Out of Scope
- Human review UI for candidates (all candidates created with `proposed` status only)
- Promotion/save-back of accepted candidates into canonical meta-model entities (Application, Service, etc.)
- Inter-candidate relationship modeling (e.g., "service A calls service B" -- separate future increment)
- Iterative feedback loops where candidate results feed back into earlier phases (1a/1b/1c re-analysis)
- Changes to the gateway `/resolve-decision-tasks` endpoint (already fully generic)
- Changes to the discovery-service `gatewayClient.resolveDecisionTasks()` method (already fully generic)
- Concrete generation rule implementations beyond the initial 5 (anchor-type, service/component, data entity, interface, fallback) -- additional rules are a future extension
- Confidence calibration tuning or user-configurable thresholds (constants are centralized but not exposed to users)
- Candidate deduplication across separate discovery runs
- Visualization or reporting of candidate generation metrics beyond the summary metadata returned by executeStep1d
