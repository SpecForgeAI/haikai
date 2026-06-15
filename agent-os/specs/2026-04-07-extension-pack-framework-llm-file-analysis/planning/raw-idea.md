# Initialization

## Spec Name
extension-pack-framework-llm-file-analysis

## Summary
Replace the current discovery pipeline's clustering (1c) and candidate generation (1d) steps with LLM-driven file-level architectural analysis that produces typed candidates directly. Introduce the Extension Pack framework with a registry, applicability predicates, and no-op default (packs: [] means the step executes as a no-op and moves on). Persist intermediate LLM analysis results as evidence for downstream migration/target-state use. Refactor the gateway LLM endpoint for file-level analysis. Remove dead clustering/candidate-generation code.

## Context

### Product context
This tool is a full Product Delivery Lifecycle (PDLC) tool supporting greenfield, brownfield, and legacy migration projects. Discovery is not just for documenting current state architecture -- it produces the evidence base that drives target state architecture design and implementation planning. Intermediate evidence (file-level LLM analysis, relationships, entity metadata) has long-term value for migration decision-making.

### What exists today
- **Discovery pipeline (1a-1d)** runs in `discovery-service/` (Express/TypeScript on port 8091)
- **Step 1a** extracts evidence atoms using ctags (symbols: classes, methods, properties, imports), file structure metadata, and string pattern matching. Produces ~28k atoms for a typical scan. This step is KEPT as-is -- it provides the structural map that guides LLM analysis.
- **Step 1b** infers relationships between atoms using deterministic linker rules, then sends ambiguous cases to the gateway for LLM resolution via decision tasks. The linker rules and LLM resolution are KEPT but the gateway endpoint should be refactored.
- **Step 1c** (clustering) groups atoms/relationships into coarse boundary clusters. Currently produces ~14 high-level clusters. This step is REPLACED -- clustering for boundary detection adds no value for producing typed candidates.
- **Step 1d** (candidate generation) synthesizes clusters into candidates of types: application, service, app_component only. Currently produces ~9 mostly useless candidates. This step is REPLACED by LLM-driven file-level analysis that produces typed candidates directly.
- **Gateway** (`gateway/` on port 8081) has `/api/v1/discovery/resolve-decision-tasks` endpoint for LLM calls. Uses `sendChatRequest` on the LLM client (OpenAI or Azure OpenAI).
- **Discovery config** already has `techHints` (language + technology per path) and `repoApplicationMappings` (path -> applicationName) and `appComponents` (component definitions). These should drive extension pack selection.
- **Candidate types** already defined: application, app_component, service, interface, logical_entity, physical_entity, business_process, data_entity. The CandidateType union in `discovery-service/src/types/candidate.ts` supports all of these.
- **AnalyzerPack interface** exists in `discovery-service/src/types/analyzerPack.ts` with AnalyzerResult that can carry evidenceAtoms, relationships, clusters, and candidates.
- **Candidate review UI** exists in frontend showing candidates with Approve/Reject/Defer actions.

### What the current pipeline produces (and why it fails)
A scan of a React frontend + Java/Spring Boot backend produced:
- 1a: 28,039 atoms (26,036 symbols, 663 file structures, 1,340 string patterns) -- good raw data
- 1b: 63,162 relationships, 886 LLM decision tasks (885 resolved) -- plumbing works
- 1c: 14 clusters -- too coarse, only boundary detection
- 1d: 9 candidates (1 application, 1 service, 7 app_components) -- almost all wrong/useless

The user expected: Interfaces, Endpoints, Classes, Methods, Physical Entities, Physical Attributes -- all physically obvious entities that the raw atoms contain data about but the pipeline discards during clustering.

### Architecture philosophy
- **Universal pipeline uses LLM for heavy lifting**: Send source files to the LLM and ask it to identify architectural entities across ANY language. This is where broad coverage comes from.
- **Extension packs add deterministic precision**: For known stacks (Java/Spring Boot, React/TypeScript), packs sharpen LLM output with exact annotation metadata, precise HTTP paths, column types, etc.
- **Packs never replace the universal pipeline**: They enrich and sharpen. A codebase with no extension pack still gets useful results from LLM analysis alone.
- **All output uses the same evidence schema**: Whether evidence comes from ctags, LLM analysis, or extension packs, it lands in the same atoms/relationships/candidates schema.

## Existing State
- `discovery-service/src/services/runManager.ts` -- orchestrates steps 1a-1d
- `discovery-service/src/services/clusteringEngine.ts` -- step 1c (TO BE REMOVED)
- `discovery-service/src/services/clusteringRuleRegistry.ts` -- step 1c rules (TO BE REMOVED)
- `discovery-service/src/services/clusteringRules/` -- step 1c rule implementations (TO BE REMOVED)
- `discovery-service/src/services/candidateGenerationEngine.ts` -- step 1d (TO BE REMOVED)
- `discovery-service/src/services/candidateGenerationRuleRegistry.ts` -- step 1d rules (TO BE REMOVED)
- `discovery-service/src/services/candidateGenerationRules/` -- step 1d rule implementations (TO BE REMOVED)
- `discovery-service/src/services/clusterTriageEngine.ts` -- step 1c triage (TO BE REMOVED)
- `discovery-service/src/services/candidateTriageEngine.ts` -- step 1d triage (TO BE REMOVED)
- `discovery-service/src/services/gatewayClient.ts` -- HTTP client for gateway LLM calls (batching in groups of 50)
- `discovery-service/src/services/phase1aAnalyzerPack.ts` -- step 1a extraction (KEPT)
- `discovery-service/src/types/analyzerPack.ts` -- AnalyzerPack interface (TO BE EXTENDED)
- `discovery-service/src/types/candidate.ts` -- CandidateType union (already has all needed types)
- `discovery-service/src/types/cluster.ts` -- cluster types (TO BE REMOVED or deprecated)
- `gateway/src/routes/discoveryDecisionTasks.ts` -- LLM resolution endpoint (TO BE REFACTORED)
- `gateway/src/routes/discoveryDecisionTaskPrompts.ts` -- prompt templates for decision tasks
- `mcp-server/src/services/candidateSaveBackService.ts` -- save-back service (CANDIDATE_TYPE_CONFIG already has all entity types)

## What This Spec Must Deliver

### 1. New LLM file-level analysis pipeline step
- Replaces steps 1c and 1d
- Uses the 1a atom map to build a "scan plan" -- identify architecturally interesting files (files containing classes, controllers, entities, route handlers) vs. boilerplate (config, package.json, .gitignore, lock files)
- Sends each interesting file (or small groups of related files) to the LLM with a structured prompt asking it to identify architectural entities: classes, interfaces, endpoints, physical entities, physical attributes, methods, DTOs, and their relationships
- LLM returns structured JSON with typed entity proposals
- Each LLM-identified entity becomes a DiscoveryCandidate with the appropriate CandidateType
- Parent-child relationships between candidates are established (method -> class, endpoint -> interface, attribute -> entity)
- Batching and parallelisation reuse the existing gateway client pattern (batches of 50, 20-min timeout)

### 2. Extension Pack framework
- Extension Pack registry: configuration-driven, packs registered by name with applicability predicates (language, technology, path patterns)
- Discovery config extended with `extensionPacks` field (array of pack configurations with `when` predicates)
- For v1, the configured pack list is empty -- the extension point exists but executes as a no-op
- Extension packs hook into the pipeline AFTER LLM analysis to sharpen/enrich results
- Packs write into the same evidence schema (atoms, relationships, candidates)
- Auto-selection based on techHints: if techHints say "Java/Spring Boot" for a path, the java-spring-boot pack is auto-applicable (when packs exist in future increments)

### 3. Intermediate evidence persistence
- LLM file-level analysis results persisted as evidence (not just final candidates)
- Each file analysis stored with: file path, identified entities, relationships, raw LLM response
- This evidence is queryable for future target-state architecture and migration planning use
- Uses existing discovery_evidence table with a new evidence type (e.g., 'llm_file_analysis' or similar)

### 4. Refactored gateway endpoint
- Refactor or create a new gateway endpoint for file-level analysis calls (distinct from decision task resolution)
- Prompt template for file-level architectural entity extraction
- Structured JSON response schema for entity extraction results
- Reuse existing LLM client infrastructure (sendChatRequest with { tools: [] })

### 5. Dead code removal
- Remove clustering engine, clustering rules, clustering rule registry, cluster triage engine
- Remove candidate generation engine, candidate generation rules, candidate generation rule registry, candidate triage engine
- Update runManager to skip 1c/1d clustering/candidate steps
- Preserve the candidate output schema so the existing candidate review UI still works
- Preserve the discovery_cluster table schema (data already exists from prior runs) but the pipeline no longer writes to it

### 6. New candidate types for LLM extraction
- The CandidateType union already includes: application, app_component, service, interface, logical_entity, physical_entity, business_process, data_entity
- New types needed: `endpoint`, `class`, `method`, `physical_attribute`
- Add these to the CandidateType union in discovery-service
- Add corresponding entries to CANDIDATE_TYPE_CONFIG in candidateSaveBackService.ts
- Add corresponding JPA entity/table support in architecture-model-service if not already present (classes, methods, endpoints, physical_data_attributes already exist in the meta-model)

## Key Design Decisions
- 1a atom extraction STAYS as the structural map / scan plan driver
- 1b relationship inference STAYS (linker rules + LLM decision tasks)
- 1c clustering is REMOVED from the pipeline
- 1d candidate generation is REPLACED by LLM file-level analysis
- Extension pack registry exists from day one with empty pack list
- All output flows into existing candidate schema for review UI compatibility
- Intermediate LLM analysis persisted as evidence for migration use
