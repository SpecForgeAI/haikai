# Specification: Extension Pack Framework & LLM File-Level Analysis

## Goal
Replace the discovery pipeline's clustering (1c) and candidate generation (1d) steps with LLM-driven file-level architectural analysis that produces typed candidates directly, introduce the Extension Pack framework with full interface/registry/predicate definitions (no-op for v1), persist intermediate LLM analysis results as evidence, and remove all dead clustering/candidate-generation code.

## User Stories
- As an architect using discovery on a legacy codebase, I want the pipeline to identify classes, endpoints, methods, and physical attributes directly from source files so that I get useful, typed candidates instead of vague boundary clusters.
- As a PDLC tool administrator, I want an Extension Pack framework with well-defined contracts so that future increments can add deterministic sharpening packs (Java/Spring Boot, React/TypeScript) without changing the core pipeline.
- As a migration planner, I want intermediate LLM file-analysis evidence persisted so that I can query per-file entity extraction results when building target-state architecture and implementation plans.

## Specific Requirements

**Pipeline step restructuring**
- Steps 1a (universal extraction) and 1b (relationship inference + LLM decision tasks) are KEPT as-is with no changes
- Step 1c (clustering) is REMOVED from the pipeline entirely
- Step 1d (candidate generation) is REPLACED by a new "LLM file-level analysis" step
- After LLM file analysis, the Extension Pack hook runs (no-op for v1 -- empty pack list)
- `VALID_STEPS` in `discovery-service/src/services/runManager.ts` (line 106) must be updated to reflect the new step names (e.g., replace '1c' and '1d' with a single new step identifier)
- The `executeStep()` function in runManager must route the new step to the LLM file analysis orchestration instead of clustering/candidate-generation

**Scan plan builder**
- New module in `discovery-service/src/services/` that builds a scan plan from 1a atoms AND 1b relationships
- Files with symbol atoms (kind: class, interface, method, annotation, etc.) are classified as "architecturally interesting" and included in the scan plan
- Files with only `file_structure` atoms and no symbols (package.json, .gitignore, lock files, config files) are excluded
- 1b relationship data enriches prioritization: files referenced by many `imports` relationships are ranked higher in the scan plan
- Configurable file line limit via environment variable `DISCOVERY_FILE_LINE_LIMIT` (default 10,000 lines) added to `discovery-service/src/config.ts`
- Files exceeding the configured limit are truncated with a note appended to the prompt telling the LLM the file was truncated
- Scan plan output: ordered array of `{ filePath, lineCount, symbolCount, inboundImportCount, atomSummary, relationshipContext }`

**LLM file-level analysis step**
- One file per LLM call for v1 (no multi-file grouping)
- Each call sends: (1) the file's full source code (or truncated per config), (2) a summary of 1a atoms extracted from that file, (3) 1b relationship context (import/export references involving that file)
- LLM returns structured JSON with two arrays: `entities` and `relationships`
- Entity schema: `{ entityType: CandidateType, name: string, confidence: number, filePath: string, lineRange?: [number, number], parentEntityName?: string, metadata: Record<string, unknown> }`
- Relationship schema: `{ sourceEntityName: string, targetEntityName: string, relationshipType: string, detail?: string }`
- Each LLM-identified entity is converted into a `DiscoveryCandidate` with the appropriate `CandidateType`
- Parent-child relationships between candidates are established from LLM-identified relationships (method -> class, endpoint -> interface, attribute -> entity) using `parentCandidateId`
- Batching reuses the existing gateway client pattern in `discovery-service/src/services/gatewayClient.ts`: batches of 50 file analysis requests per HTTP call to the gateway, 20-minute timeout per batch, sequential processing within the gateway

**New gateway endpoint for file analysis**
- New endpoint: `POST /api/v1/discovery/analyze-files`
- Mounted on the existing discovery router in `gateway/src/routes/discovery.ts`
- Request body: `{ projectId: string, runId: string, files: Array<{ filePath: string, sourceCode: string, atomSummary: string, relationshipContext: string }> }`
- Response body: `{ results: Array<{ filePath: string, status: 'analyzed' | 'failed', entities: Array<...>, relationships: Array<...>, error: string | null }> }`
- New prompt template file: `gateway/src/config/prompts/discovery.file-analysis.prompt.md` with placeholders for `{{FILE_PATH}}`, `{{SOURCE_CODE}}`, `{{ATOM_SUMMARY}}`, `{{RELATIONSHIP_CONTEXT}}`, `{{CANDIDATE_TYPES}}`
- Reuses existing `getLlmClient().sendChatRequest()` with `{ tools: [] }` and `parseLlmJsonResponse()` utility from `gateway/src/routes/discoveryDecisionTasks.ts`
- Files within a batch are processed sequentially (same pattern as decision task resolution)

**New CandidateType values**
- Add `endpoint`, `class`, `method`, `physical_attribute` to the `CandidateType` union in `discovery-service/src/types/candidate.ts`
- Add corresponding entries to `CANDIDATE_TYPE_CONFIG` in `mcp-server/src/services/candidateSaveBackService.ts`:
  - `class`: `{ targetArrayKey: 'classes', idPrefix: 'cls-', parentFkField: 'service_id' }`
  - `method`: `{ targetArrayKey: 'methods', idPrefix: 'mth-', parentFkField: 'class_id' }`
  - `endpoint`: `{ targetArrayKey: 'endpoints', idPrefix: 'ep-', parentFkField: 'interface_id' }`
  - `physical_attribute`: `{ targetArrayKey: 'physical_data_attributes', idPrefix: 'pda-', parentFkField: 'physical_entity_id' }`
- Add type-specific field population branches in `convertCandidateToEntity()` for each new type

**Parent FK mappings and classes table schema change**
- `class` -> `service_id` (FK to `services.id`): requires DB migration to drop `application_point_id` and add `service_id` on the `classes` table
- `method` -> `class_id` (already exists, no migration needed)
- `endpoint` -> `interface_id` (already exists, no migration needed)
- `physical_attribute` -> `physical_entity_id` (already exists, no migration needed)
- New Liquibase migration SQL file in `architecture-model-service/src/main/resources/db/changelog/sql/` to ALTER TABLE `classes`: DROP COLUMN `application_point_id`, ADD COLUMN `service_id` VARCHAR(255) REFERENCES `services(id)`
- Update `ClassEntity.java` at `architecture-model-service/.../model/entity/ClassEntity.java`: replace `applicationPointId` field with `serviceId`
- Update `ClassDto.java` at `architecture-model-service/.../model/dto/entity/ClassDto.java`: replace `applicationPointId` with `serviceId`
- Update frontend `model.ts` Class interface (line 413): replace `application_point_id` with `service_id`
- Update frontend `Grid.tsx` classes column config: show "Service" dropdown instead of "Application Point"
- Update or remove `frontend/src/utils/applicationPointDerivation.ts` logic referencing `application_point_id` on classes

**sourceClusterIds field repurposed**
- `DiscoveryCandidate.sourceClusterIds` field (DB column `source_cluster_ids` JSONB) is repurposed to hold source file paths instead of cluster IDs
- No database migration -- column name kept as-is to avoid schema changes
- Populated with an array of file paths that the LLM analyzed to produce each candidate (e.g., `["src/main/java/com/example/UserController.java"]`)
- Provides traceability from candidate back to source files for migration planning

**Extension Pack framework**
- New file `discovery-service/src/types/extensionPack.ts` defining the full `ExtensionPack` interface:
  - `id: string` -- unique pack identifier (e.g., `'java-spring-boot'`)
  - `name: string` -- display name
  - `description: string`
  - `when: ExtensionPackPredicate` -- applicability predicate
  - `enrich(context: ExtensionPackContext): Promise<ExtensionPackResult>` -- enrichment method
- `ExtensionPackPredicate`: `{ language?: string, technology?: string, pathPatterns?: string[] }` -- evaluated against `techHints` from discovery config
- `ExtensionPackContext`: carries candidates, atoms, relationships, source file contents, and techHints for the relevant paths
- `ExtensionPackResult`: `{ candidates: DiscoveryCandidate[], atoms?: EvidenceAtom[], relationships?: EvidenceRelationship[] }` -- enriched/sharpened output using the same evidence schema
- New file `discovery-service/src/services/extensionPackRegistry.ts` implementing the registry: `registerPack()`, `getApplicablePacks(techHints)`, `runPacks(context)`
- Discovery config (`config_payload` in `discovery_config` table) extended with `extensionPacks: string[]` field (array of pack IDs to activate, empty `[]` for v1)
- Extension packs hook into the pipeline AFTER LLM file analysis in `runManager.ts` -- the registry returns applicable packs, each runs sequentially, results merged into the candidate set
- For v1, the registry contains no registered packs, so the hook executes as a no-op and proceeds

**Intermediate evidence persistence**
- LLM file-analysis results stored as evidence in the `discovery_evidence` table using a new `EvidenceAtomType` value: `'llm_file_analysis'`
- Add `'llm_file_analysis'` to the `EvidenceAtomType` union in `discovery-service/src/types/evidenceAtom.ts`
- New data payload interface `LlmFileAnalysisData`: `{ filePath: string, entities: Array<...>, relationships: Array<...>, rawLlmResponse: string, analyzedAt: string }`
- Add `LlmFileAnalysisData` to the `EvidenceAtomData` union
- Each file analysis result persisted as one evidence atom per file via `archModelClient.bulkSaveEvidence()` in the same batching pattern as step 1a (batch size 500 from `BULK_SAVE_BATCH_SIZE`)
- Evidence queryable by run ID and type for downstream migration planning tools
- Add corresponding JPA support: new `type` enum value `llm_file_analysis` in `DiscoveryEvidenceEntity`

**Dead code removal**
- Remove `discovery-service/src/services/clusteringEngine.ts`
- Remove `discovery-service/src/services/clusteringRuleRegistry.ts`
- Remove `discovery-service/src/services/clusteringRules/` directory and all rule implementations
- Remove `discovery-service/src/services/clusterTriageEngine.ts`
- Remove `discovery-service/src/services/candidateGenerationEngine.ts`
- Remove `discovery-service/src/services/candidateGenerationRuleRegistry.ts`
- Remove `discovery-service/src/services/candidateGenerationRules/` directory and all rule implementations
- Remove `discovery-service/src/services/candidateTriageEngine.ts`
- Remove dead decision task types from gateway: `cluster_merge_decision`, `cluster_type_classification`, `cluster_anchor_assignment`, `cluster_noise_decision`, `candidate_type_classification`, `candidate_parent_assignment`, `candidate_name_refinement`, `candidate_merge_decision`, `candidate_rejection_review` from `DecisionTaskTypeString` union in `gateway/src/routes/discoveryDecisionTaskPrompts.ts`
- Remove corresponding entries from `PROMPT_TEMPLATE_FILES` map and delete the 9 dead prompt template markdown files from `gateway/src/config/prompts/`
- Remove dead interpolation helpers and user message builders from `discoveryDecisionTaskPrompts.ts` (all 1c/1d functions)
- Keep 1b types: `confirm_relationship`, `resolve_competing_relationships` and their prompt templates, interpolation helpers, and user message builders
- Remove all imports of dead modules from `runManager.ts` and clean up the 1c/1d branches in `executeStep()`
- Remove or deprecate `discovery-service/src/types/cluster.ts` (preserve `discovery_cluster` DB table schema for historical data)
- Remove `discovery-service/src/types/clusteringRule.ts` and `discovery-service/src/types/candidateGenerationRule.ts`
- Remove related test files in `discovery-service/src/__tests__/` for 1c and 1d orchestration

**Gateway client extension**
- Add new method `analyzeFiles()` to `GatewayClient` class in `discovery-service/src/services/gatewayClient.ts`
- Same batching pattern as `resolveDecisionTasks()`: split into batches of `BATCH_SIZE` (50), POST each batch to `/api/v1/discovery/analyze-files`, concatenate results
- Same 20-minute timeout per batch
- New response type `FileAnalysisResult` and `AnalyzeFilesResponse` interfaces alongside existing `DecisionTaskResolutionResult`

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**`discovery-service/src/services/gatewayClient.ts` -- HTTP batching pattern**
- `GatewayClient` class with `BATCH_SIZE = 50` and 20-minute timeout already implements the exact chunking, sequential dispatch, and result concatenation pattern needed
- Add a new `analyzeFiles()` method following the same structure as `resolveDecisionTasks()` but targeting the new `/api/v1/discovery/analyze-files` endpoint
- Reuse the singleton export pattern (`export const gatewayClient`)

**`gateway/src/routes/discoveryDecisionTasks.ts` -- LLM resolution endpoint pattern**
- Sequential task processing loop, `getLlmClient().sendChatRequest()` with `{ tools: [] }`, `parseLlmJsonResponse()` utility, per-task error handling with `'resolved'`/`'failed'` status
- The new `/analyze-files` endpoint should follow this identical structure: validate request, iterate files sequentially, call LLM, parse JSON, collect results
- `parseLlmJsonResponse()` handles markdown-fenced JSON stripping and should be reused directly

**`gateway/src/routes/discoveryDecisionTaskPrompts.ts` -- prompt template system**
- `loadPromptTemplate()`, `interpolateTemplate()`, `buildMessagesForTask()` pattern with `PROMPT_TEMPLATE_FILES` map and `{{PLACEHOLDER}}` substitution
- Add new entry `'file_analysis': 'discovery.file-analysis.prompt.md'` to the map
- Create a new `interpolateFileAnalysis()` helper for the file analysis template variables

**`mcp-server/src/services/candidateSaveBackService.ts` -- CANDIDATE_TYPE_CONFIG**
- Already has 8 entries mapping candidate types to `targetArrayKey`, `idPrefix`, and `parentFkField`
- `createEmptyModelShell()` already includes `endpoints`, `classes`, `methods`, `physical_data_attributes` arrays
- Add 4 new entries for `class`, `method`, `endpoint`, `physical_attribute` and corresponding `convertCandidateToEntity()` switch branches

**`discovery-service/src/services/phase1aAnalyzerPack.ts` -- analyzer pack pattern**
- Demonstrates the `AnalyzerPack` interface implementation with repo iteration, parallel sub-extraction, error handling with `failedRepos`, and `AnalyzerResult` return shape
- The new LLM file analysis step should follow a similar structure: iterate scan plan files, call gateway for LLM analysis, collect candidates, handle per-file failures, return metadata summary

## Out of Scope
- Changes to the frontend candidate review UI (new candidate types `endpoint`, `class`, `method`, `physical_attribute` appear automatically in the existing table)
- Changes to the candidate review/approval workflow (Approve/Reject/Defer actions work unchanged)
- Changes to step 1b linker rules or the `resolve-decision-tasks` gateway endpoint
- Multi-file grouping for LLM calls (send related files together in one call -- future increment)
- Actual Extension Pack implementations (Java/Spring Boot pack is Increment 2, React/TypeScript pack is Increment 3)
- Changes to the `discovery_cluster` database table schema (table preserved for historical data from prior runs)
- Changes to the hypothesis Q&A system (`hypothesisGenerationEngine.ts`, `hypothesisRefinementEngine.ts`, `questionBatchGenerator.ts`)
- Changes to log enrichment pipeline (`logExtractors/`, `logParsing/`, `logEnrichmentMetadata.ts`)
- Discovery summary/dashboard view redesign (update only if new candidate types cause rendering failures)
- Token budget optimization or streaming LLM responses
