# Task Breakdown: Extension Pack Framework & LLM File-Level Analysis

## Overview
Total Tasks: 13 task groups, approximately 85 sub-tasks

This spec replaces the discovery pipeline's clustering (1c) and candidate generation (1d) steps with LLM-driven file-level analysis, introduces the Extension Pack framework (no-op for v1), persists intermediate LLM evidence, migrates the `classes` table FK from `application_point_id` to `service_id`, and removes all dead clustering/candidate-generation code.

## Task List

---

### Schema & Type Layer

#### Task Group 1: CandidateType and EvidenceAtomType Extensions
**Dependencies:** None

- [x] 1.0 Complete type/schema extensions for new candidate types and evidence atom type
  - [x] 1.1 Write 4 focused tests for type extensions
    - Test that `CandidateType` union accepts `'endpoint'`, `'class'`, `'method'`, `'physical_attribute'`
    - Test that `EvidenceAtomType` union accepts `'llm_file_analysis'`
    - Test that `LlmFileAnalysisData` interface conforms to expected shape (`filePath`, `entities`, `relationships`, `rawLlmResponse`, `analyzedAt`)
    - Test that `EvidenceAtomData` union includes `LlmFileAnalysisData`
  - [x] 1.2 Add new values to `CandidateType` union in `discovery-service/src/types/candidate.ts`
    - Add `'endpoint'`, `'class'`, `'method'`, `'physical_attribute'` to the union
    - Update JSDoc to describe each new type
  - [x] 1.3 Add `'llm_file_analysis'` to `EvidenceAtomType` union in `discovery-service/src/types/evidenceAtom.ts`
    - Add new `LlmFileAnalysisData` interface: `{ filePath: string, entities: Array<{ entityType: CandidateType, name: string, confidence: number, filePath: string, lineRange?: [number, number], parentEntityName?: string, metadata: Record<string, unknown> }>, relationships: Array<{ sourceEntityName: string, targetEntityName: string, relationshipType: string, detail?: string }>, rawLlmResponse: string, analyzedAt: string }`
    - Add `LlmFileAnalysisData` to `EvidenceAtomData` union
  - [x] 1.4 Update candidate.ts JSDoc comments to reflect that `sourceClusterIds` is repurposed for source file paths
    - Update `DiscoveryCandidate.sourceClusterIds` JSDoc to note it now holds source file paths (no DB migration, semantic change only)
  - [x] 1.5 Ensure type extension tests pass
    - Run ONLY the 4 tests written in 1.1

**Acceptance Criteria:**
- `CandidateType` union includes all 12 values (8 existing + 4 new)
- `EvidenceAtomType` union includes `'llm_file_analysis'`
- `LlmFileAnalysisData` interface is properly defined and added to `EvidenceAtomData` union
- `sourceClusterIds` JSDoc updated for file path usage

---

### Database & JPA Layer

#### Task Group 2: Classes Table Schema Migration (application_point_id -> service_id)
**Dependencies:** None

- [x] 2.0 Complete classes table FK migration from application_point_id to service_id
  - [x] 2.1 Write 4 focused tests for the migration and JPA changes
    - Test that `ClassEntity` has `serviceId` field and not `applicationPointId`
    - Test that `ClassDto` has `serviceId` field and not `applicationPointId`
    - Test that the Liquibase migration SQL is valid (DROP `application_point_id`, ADD `service_id`)
    - Test that `ClassEntity.serviceId` maps to a valid FK referencing `services(id)`
  - [x] 2.2 Create new Liquibase migration SQL file
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/077-class-service-id-migration.sql`
    - `ALTER TABLE classes DROP COLUMN IF EXISTS application_point_id`
    - `ALTER TABLE classes ADD COLUMN service_id VARCHAR(255) REFERENCES services(id)`
    - Add index on `service_id` for FK performance
  - [x] 2.3 Register migration in `db.changelog-master.yaml`
    - Add new changeset entry pointing to `sql/077-class-service-id-migration.sql`
  - [x] 2.4 Update `ClassEntity.java` at `architecture-model-service/.../model/entity/ClassEntity.java`
    - Replace `applicationPointId` field with `serviceId`
    - Update `@Column` annotation from `application_point_id` to `service_id`
  - [x] 2.5 Update `ClassDto.java` at `architecture-model-service/.../model/dto/entity/ClassDto.java`
    - Replace `applicationPointId` field with `serviceId`
  - [x] 2.6 Update any repository/service methods that reference `applicationPointId` on classes
    - Search `architecture-model-service/` for `applicationPointId` references in class-related code
    - Update queries, findBy methods, or service logic to use `serviceId`
  - [x] 2.7 Ensure JPA migration tests pass
    - Run ONLY the 4 tests written in 2.1

**Acceptance Criteria:**
- Migration SQL drops `application_point_id` and adds `service_id` with FK to `services(id)`
- `ClassEntity` and `ClassDto` use `serviceId` instead of `applicationPointId`
- Migration registered in changelog master
- All references to `applicationPointId` on classes are updated

#### Task Group 3: JPA Evidence Type Extension
**Dependencies:** None

- [x] 3.0 Add `llm_file_analysis` evidence type support to JPA layer
  - [x] 3.1 Write 2 focused tests for evidence type extension
    - Test that `DiscoveryEvidenceEntity` accepts `type = 'llm_file_analysis'`
    - Test that evidence with `llm_file_analysis` type can be persisted and queried by run ID and type
  - [x] 3.2 Update `DiscoveryEvidenceEntity.java` to include `llm_file_analysis` as a valid `type` enum value
    - If `type` is a Java enum, add `LLM_FILE_ANALYSIS` member
    - If `type` is a String column, ensure no enum constraint prevents the new value
  - [x] 3.3 Ensure evidence type tests pass
    - Run ONLY the 2 tests written in 3.1

**Acceptance Criteria:**
- `DiscoveryEvidenceEntity` supports `llm_file_analysis` type value
- Evidence records of this type can be persisted and retrieved

---

### Discovery Service -- Core Pipeline Layer

#### Task Group 4: Scan Plan Builder
**Dependencies:** Task Group 1

- [x] 4.0 Complete scan plan builder module
  - [x] 4.1 Write 6 focused tests for scan plan builder
    - Test that files with symbol atoms (class, interface, method, annotation) are included in scan plan
    - Test that files with only `file_structure` atoms (package.json, .gitignore, lock files) are excluded
    - Test that inbound import count from 1b relationships is computed and used for prioritization
    - Test that files are sorted by priority (symbol count + inbound import count descending)
    - Test that scan plan output shape matches `{ filePath, lineCount, symbolCount, inboundImportCount, atomSummary, relationshipContext }`
    - Test that the configurable file line limit is respected (files over limit are flagged for truncation)
  - [x] 4.2 Add `DISCOVERY_FILE_LINE_LIMIT` config to `discovery-service/src/config.ts`
    - Environment variable `DISCOVERY_FILE_LINE_LIMIT`, default `10000`
    - Export as `DISCOVERY_FILE_LINE_LIMIT: number`
  - [x] 4.3 Create `discovery-service/src/services/scanPlanBuilder.ts`
    - Input: 1a evidence atoms array, 1b relationships array
    - Filter atoms to group by filePath; include files that have at least one symbol atom (kind: class, interface, method, annotation, property, import, etc.)
    - Exclude files that have only `file_structure` atoms and no symbol atoms
    - Compute `inboundImportCount` per file from 1b relationships (count relationships where the file is the target of an `imports` relationship)
    - Build `atomSummary` string per file (e.g., "3 classes, 12 methods, 2 interfaces")
    - Build `relationshipContext` string per file (e.g., "imported by 5 files, exports used by 3 files")
    - Sort files by priority: `symbolCount + inboundImportCount` descending
    - Output: `ScanPlanEntry[]` where each entry is `{ filePath: string, lineCount: number, symbolCount: number, inboundImportCount: number, atomSummary: string, relationshipContext: string }`
  - [x] 4.4 Export `ScanPlanEntry` interface and `buildScanPlan()` function
  - [x] 4.5 Ensure scan plan builder tests pass
    - Run ONLY the 6 tests written in 4.1

**Acceptance Criteria:**
- Files with symbols are included; boilerplate files are excluded
- Import centrality from 1b relationships drives prioritization
- Output shape matches the defined `ScanPlanEntry` interface
- File line limit config is present and usable

#### Task Group 5: Extension Pack Framework (Interface, Registry, Types)
**Dependencies:** Task Group 1

- [x] 5.0 Complete Extension Pack framework definitions
  - [x] 5.1 Write 5 focused tests for Extension Pack framework
    - Test that `ExtensionPack` interface has required fields (`id`, `name`, `description`, `when`, `enrich`)
    - Test that `ExtensionPackPredicate` matches against `techHints` (language, technology, pathPatterns)
    - Test that `extensionPackRegistry.registerPack()` stores a pack and `getApplicablePacks()` retrieves it based on predicate match
    - Test that `runPacks()` with an empty registry returns the candidates unchanged (no-op behavior)
    - Test that `runPacks()` with a registered pack calls `enrich()` and merges results
  - [x] 5.2 Create `discovery-service/src/types/extensionPack.ts`
    - Define `ExtensionPackPredicate`: `{ language?: string, technology?: string, pathPatterns?: string[] }`
    - Define `ExtensionPackContext`: `{ candidates: DiscoveryCandidate[], atoms: EvidenceAtom[], relationships: EvidenceRelationship[], sourceFiles: Map<string, string>, techHints: Record<string, { language: string, technology: string }> }`
    - Define `ExtensionPackResult`: `{ candidates: DiscoveryCandidate[], atoms?: EvidenceAtom[], relationships?: EvidenceRelationship[] }`
    - Define `ExtensionPack` interface: `{ id: string, name: string, description: string, when: ExtensionPackPredicate, enrich(context: ExtensionPackContext): Promise<ExtensionPackResult> }`
  - [x] 5.3 Create `discovery-service/src/services/extensionPackRegistry.ts`
    - Private `packs: ExtensionPack[]` array
    - `registerPack(pack: ExtensionPack): void` -- adds to registry
    - `getApplicablePacks(techHints: Record<string, { language: string, technology: string }>): ExtensionPack[]` -- filters packs whose `when` predicate matches any techHint entry
    - `runPacks(context: ExtensionPackContext): Promise<ExtensionPackResult>` -- iterates applicable packs sequentially, merges results into a combined `ExtensionPackResult`
    - Predicate matching logic: pack matches if `when.language` matches any techHint `language`, OR `when.technology` matches any techHint `technology`, OR any `when.pathPatterns` glob matches a file in the context
  - [x] 5.4 Add `extensionPacks: string[]` field to discovery config type
    - Update the config payload interface/type used by discovery config (empty array `[]` for v1)
  - [x] 5.5 Ensure Extension Pack framework tests pass
    - Run ONLY the 5 tests written in 5.1

**Acceptance Criteria:**
- `ExtensionPack` interface is fully defined with `id`, `name`, `description`, `when`, `enrich`
- `ExtensionPackPredicate` evaluates against techHints
- Registry supports `registerPack()`, `getApplicablePacks()`, `runPacks()`
- Empty registry produces no-op behavior (candidates pass through unchanged)

---

### Gateway Layer

#### Task Group 6: File Analysis Gateway Endpoint and Prompt Template
**Dependencies:** None

- [x] 6.0 Complete gateway endpoint for LLM file-level analysis
  - [x] 6.1 Write 6 focused tests for the file analysis endpoint
    - Test that `POST /api/v1/discovery/analyze-files` returns 200 with valid request body
    - Test that the endpoint returns structured JSON with `results` array containing `filePath`, `status`, `entities`, `relationships`
    - Test that a file analysis failure returns `status: 'failed'` with an `error` string instead of crashing the batch
    - Test that the prompt template loads and interpolates `{{FILE_PATH}}`, `{{SOURCE_CODE}}`, `{{ATOM_SUMMARY}}`, `{{RELATIONSHIP_CONTEXT}}`, `{{CANDIDATE_TYPES}}`
    - Test that `parseLlmJsonResponse()` correctly extracts entities and relationships from LLM response
    - Test that an empty `files` array returns `{ results: [] }`
  - [x] 6.2 Create prompt template file `gateway/src/config/prompts/discovery.file-analysis.prompt.md`
    - System prompt instructing the LLM to analyze a source file and identify architectural entities
    - Placeholders: `{{FILE_PATH}}`, `{{SOURCE_CODE}}`, `{{ATOM_SUMMARY}}`, `{{RELATIONSHIP_CONTEXT}}`, `{{CANDIDATE_TYPES}}`
    - Expected output format: JSON with `entities` and `relationships` arrays
    - Entity schema in prompt: `{ entityType, name, confidence, filePath, lineRange, parentEntityName, metadata }`
    - Relationship schema in prompt: `{ sourceEntityName, targetEntityName, relationshipType, detail }`
  - [x] 6.3 Add `'file_analysis'` entry to `PROMPT_TEMPLATE_FILES` map in `gateway/src/routes/discoveryDecisionTaskPrompts.ts`
    - Entry: `'file_analysis': 'discovery.file-analysis.prompt.md'`
    - Create `interpolateFileAnalysis()` helper function for template variable substitution
    - Create `buildMessagesForFileAnalysis()` helper to construct the OpenAI message array
  - [x] 6.4 Create the route handler for `POST /api/v1/discovery/analyze-files`
    - New handler added to `gateway/src/routes/discoveryFileAnalysis.ts`
    - Request body validation: `{ projectId: string, runId: string, files: Array<{ filePath: string, sourceCode: string, atomSummary: string, relationshipContext: string }> }`
    - Sequential processing: iterate files, for each: load prompt template, interpolate variables, call `getLlmClient().sendChatRequest()` with `{ tools: [] }`, parse response with `parseLlmJsonResponse()`
    - Response: `{ results: Array<{ filePath: string, status: 'analyzed' | 'failed', entities: Array<...>, relationships: Array<...>, error: string | null }> }`
    - Per-file error handling: catch LLM/parsing errors, set `status: 'failed'`, continue to next file
  - [x] 6.5 Mount the new route on the discovery router in `gateway/src/server.ts`
    - `app.use('/api/v1/discovery', discoveryFileAnalysisRouter)`
  - [x] 6.6 Ensure gateway file analysis tests pass
    - Run ONLY the 6 tests written in 6.1

**Acceptance Criteria:**
- `POST /api/v1/discovery/analyze-files` endpoint is functional
- Prompt template loads, interpolates, and produces correct LLM messages
- Sequential per-file processing with individual error isolation
- Response shape matches the defined schema

---

### Discovery Service -- Integration Layer

#### Task Group 7: Gateway Client Extension for File Analysis
**Dependencies:** Task Group 6

- [x] 7.0 Complete gateway client extension for file analysis batching
  - [x] 7.1 Write 4 focused tests for gateway client file analysis method
    - Test that `analyzeFiles()` sends batches of 50 files to `/api/v1/discovery/analyze-files`
    - Test that results from multiple batches are concatenated into a single response
    - Test that an empty files array returns `{ results: [] }` without making HTTP calls
    - Test that HTTP errors are propagated with status codes preserved
  - [x] 7.2 Define `FileAnalysisRequest`, `FileAnalysisResult`, and `AnalyzeFilesResponse` interfaces in `discovery-service/src/services/gatewayClient.ts`
    - `FileAnalysisRequest`: `{ filePath: string, sourceCode: string, atomSummary: string, relationshipContext: string }`
    - `FileAnalysisResult`: `{ filePath: string, status: 'analyzed' | 'failed', entities: Array<...>, relationships: Array<...>, error: string | null }`
    - `AnalyzeFilesResponse`: `{ results: FileAnalysisResult[] }`
  - [x] 7.3 Add `analyzeFiles()` method to `GatewayClient` class
    - Same batching pattern as `resolveDecisionTasks()`: split into batches of `BATCH_SIZE` (50)
    - POST each batch to `/api/v1/discovery/analyze-files` with `{ projectId, runId, files: batch }`
    - Concatenate `results` arrays from all batch responses
    - 20-minute timeout per batch (already configured on the axios instance)
    - Logging: batch progress messages matching existing pattern
  - [x] 7.4 Ensure gateway client tests pass
    - Run ONLY the 4 tests written in 7.1

**Acceptance Criteria:**
- `analyzeFiles()` method follows the same batching pattern as `resolveDecisionTasks()`
- Batches of 50 files per HTTP call
- Results concatenated across batches
- Errors propagated correctly

#### Task Group 8: LLM File Analysis Orchestration Step
**Dependencies:** Task Groups 1, 4, 5, 7

- [x] 8.0 Complete LLM file analysis orchestration step (replaces 1c/1d)
  - [x] 8.1 Write 8 focused tests for LLM file analysis orchestration
    - Test that `buildScanPlan()` is called with 1a atoms and 1b relationships
    - Test that source files are read from the repo and truncated at `DISCOVERY_FILE_LINE_LIMIT` with a truncation note appended
    - Test that `gatewayClient.analyzeFiles()` is called with correctly shaped file analysis requests
    - Test that LLM-returned entities are converted to `DiscoveryCandidate` objects with correct `candidateType`, `name`, `confidence`, and `data`
    - Test that parent-child relationships from LLM output populate `parentCandidateId` on child candidates
    - Test that `sourceClusterIds` is populated with the source file path array
    - Test that LLM results are persisted as `llm_file_analysis` evidence atoms via `archModelClient.bulkSaveEvidence()`
    - Test that the Extension Pack registry hook is called after LLM analysis (no-op with empty registry)
  - [x] 8.2 Create `discovery-service/src/services/llmFileAnalysisStep.ts`
    - Main function: `executeLlmFileAnalysis(runId, projectId, atoms, relationships, discoveryConfig)`
    - Step 1: Call `buildScanPlan(atoms, relationships)` to get prioritized file list
    - Step 2: Read source file contents from the repo (reuse `repoAccess.ts` pattern), truncate files exceeding `DISCOVERY_FILE_LINE_LIMIT` with a note: `"\n\n[FILE TRUNCATED at ${DISCOVERY_FILE_LINE_LIMIT} lines]"`
    - Step 3: Build file analysis request payloads: `{ filePath, sourceCode, atomSummary, relationshipContext }` for each scan plan entry
    - Step 4: Call `gatewayClient.analyzeFiles(projectId, runId, fileRequests)` (automatic batching)
    - Step 5: Convert LLM results to `DiscoveryCandidate[]`:
      - Each entity becomes a candidate with `id: uuidv4()`, `runId`, `candidateType: entity.entityType`, `name: entity.name`, `confidence: entity.confidence`, `status: 'proposed'`, `sourceClusterIds: [entity.filePath]`, `data: entity.metadata`
      - Resolve `parentCandidateId` by matching `parentEntityName` to candidate names within the same file
    - Step 6: Persist LLM results as `llm_file_analysis` evidence atoms (one per file, batched via `BULK_SAVE_BATCH_SIZE`)
    - Step 7: Run Extension Pack hook via `extensionPackRegistry.runPacks()` with candidates, atoms, relationships, source files, and techHints from config
    - Return: `{ candidates: DiscoveryCandidate[], evidenceCount: number, filesAnalyzed: number, filesFailed: number }`
  - [x] 8.3 Export `executeLlmFileAnalysis()` function for use by `runManager.ts`
  - [x] 8.4 Ensure LLM file analysis orchestration tests pass
    - Run ONLY the 8 tests written in 8.1

**Acceptance Criteria:**
- Scan plan drives which files are sent to LLM
- File truncation at configurable limit with note appended
- LLM results converted to candidates with correct types and parent-child relationships
- `sourceClusterIds` populated with source file paths
- Evidence persisted as `llm_file_analysis` atoms
- Extension Pack hook called (no-op for v1)

#### Task Group 9: RunManager Pipeline Step Restructuring
**Dependencies:** Task Group 8

- [x] 9.0 Complete runManager restructuring to replace 1c/1d with LLM file analysis
  - [x] 9.1 Write 4 focused tests for runManager step changes
    - Test that `VALID_STEPS` contains `'1a'`, `'1b'`, `'1c-llm-analysis'` and no longer contains `'1c'` or `'1d'`
    - Test that `executeStep()` for the new step name routes to `executeLlmFileAnalysis()`
    - Test that the pipeline runs steps in order: 1a -> 1b -> new LLM analysis step
    - Test that candidates from LLM analysis are persisted via `archModelClient.bulkSaveCandidates()`
  - [x] 9.2 Update `VALID_STEPS` in `discovery-service/src/services/runManager.ts`
    - Replaced `['1a', '1b', '1c', '1d']` with `['1a', '1b', '1c-llm-analysis']`
    - Step name `1c-llm-analysis` clearly communicates "LLM file-level analysis"
  - [x] 9.3 Update `executeStep()` function in `runManager.ts`
    - Removed the 1c (clustering) branch and its logic
    - Removed the 1d (candidate generation) branch and its logic
    - Added new branch for `1c-llm-analysis` step that calls `executeStepLlmAnalysis()`
    - `executeStepLlmAnalysis()` fetches atoms and relationships, clones the repo, calls `executeLlmFileAnalysis()`, persists returned candidates via `archModelClient.bulkSaveCandidates()` in batches of `BULK_SAVE_BATCH_SIZE`, and cleans up the repo
  - [x] 9.4 Remove all dead imports from `runManager.ts`
    - Removed imports of: `getClusteringRuleRegistry`, `executeClusteringPasses`, `triageClusterCandidates`, `getCandidateGenerationRuleRegistry`, `executeCandidateGenerationPasses`, `triageCandidateProposals`, `CandidateProposal`
    - Removed imports of 1c/1d decision task types: `CandidateTypeClassificationInput/Output`, `CandidateParentAssignmentInput/Output`, `CandidateNameRefinementInput/Output`, `CandidateMergeDecisionInput/Output`, `CandidateRejectionReviewInput/Output`, `CandidateSummary`
    - Removed `CandidateTypeReviewEntry`, `ParentReviewEntry`, `NameReviewEntry`, `CandidateMergeReviewEntry`, `RejectionReviewEntry` imports from `candidateTriageEngine`
    - Removed `CANDIDATE_AUTO_ACCEPT_THRESHOLD`, `CANDIDATE_AMBIGUOUS_THRESHOLD` imports
    - Removed `EvidenceCluster`, `ClusterMember`, `CandidateCluster`, `AnchorHintMapping`, cluster triage imports
    - Removed `ClusterMergeInput/Output`, `ClusterTypeClassificationInput/Output`, `ClusterAnchorAssignmentInput/Output`, `ClusterNoiseDecisionInput/Output`, `ClusterSummary`
    - Removed `FileStructureData`, `SymbolData` (only used in removed 1c/1d helpers)
    - Removed `generateClusterId`, `generateCandidateId` (only used in removed 1c/1d steps)
    - Removed `CandidateType` import (no longer directly referenced after 1d removal)
    - Added import of `executeLlmFileAnalysis` from `llmFileAnalysisStep`
    - Added imports of `buildTempDir`, `gitCloneRepoAccess` from `repoAccess`
    - Added import of `DiscoveryConfigPayload` from `../types/projectContext`
    - Added import of `DiscoveryCandidate` from `../types/candidate`
  - [x] 9.5 Ensure runManager tests pass
    - Ran the 4 tests written in 9.1, all passed

**Acceptance Criteria:**
- `VALID_STEPS` reflects the new pipeline (no 1c/1d)
- `executeStep()` routes the new step to `executeLlmFileAnalysis()`
- All dead imports removed from runManager
- Pipeline orchestration runs 1a -> 1b -> LLM file analysis end-to-end

---

### Save-Back Layer

#### Task Group 10: CANDIDATE_TYPE_CONFIG Updates for New Types
**Dependencies:** Task Group 1, Task Group 2

- [x] 10.0 Complete save-back configuration for new candidate types
  - [x] 10.1 Write 6 focused tests for save-back of new candidate types
    - Test that `CANDIDATE_TYPE_CONFIG` has entries for `'class'`, `'method'`, `'endpoint'`, `'physical_attribute'`
    - Test that `class` config maps to `{ targetArrayKey: 'classes', idPrefix: 'cls-', parentFkField: 'service_id' }`
    - Test that `method` config maps to `{ targetArrayKey: 'methods', idPrefix: 'mth-', parentFkField: 'class_id' }`
    - Test that `endpoint` config maps to `{ targetArrayKey: 'endpoints', idPrefix: 'ep-', parentFkField: 'interface_id' }`
    - Test that `physical_attribute` config maps to `{ targetArrayKey: 'physical_data_attributes', idPrefix: 'pda-', parentFkField: 'physical_entity_id' }`
    - Test that `convertCandidateToEntity()` produces correct entity shape for each new type
  - [x] 10.2 Add 4 new entries to `CANDIDATE_TYPE_CONFIG` in `mcp-server/src/services/candidateSaveBackService.ts`
    - `class: { targetArrayKey: 'classes', idPrefix: 'cls-', parentFkField: 'service_id' }`
    - `method: { targetArrayKey: 'methods', idPrefix: 'mth-', parentFkField: 'class_id' }`
    - `endpoint: { targetArrayKey: 'endpoints', idPrefix: 'ep-', parentFkField: 'interface_id' }`
    - `physical_attribute: { targetArrayKey: 'physical_data_attributes', idPrefix: 'pda-', parentFkField: 'physical_entity_id' }`
  - [x] 10.3 Add `convertCandidateToEntity()` switch branches for each new type
    - `class`: populate `id`, `name`, `description`, `service_id` (from parent FK resolution)
    - `method`: populate `id`, `name`, `description`, `class_id` (from parent FK resolution)
    - `endpoint`: populate `id`, `name`, `description`, `interface_id` (from parent FK resolution), `http_method`, `path` from candidate metadata if available
    - `physical_attribute`: populate `id`, `name`, `description`, `physical_entity_id` (from parent FK resolution), `data_type` from candidate metadata if available
  - [x] 10.4 Ensure save-back tests pass
    - Run ONLY the 6 tests written in 10.1

**Acceptance Criteria:**
- `CANDIDATE_TYPE_CONFIG` has entries for all 12 candidate types (8 existing + 4 new)
- `convertCandidateToEntity()` handles all 4 new types
- Parent FK fields map to correct entity relationships

---

### Frontend Layer

#### Task Group 11: Classes Table UI (Service Dropdown Instead of Application Point)
**Dependencies:** Task Group 2

- [x] 11.0 Complete frontend changes for classes table service_id migration
  - [x] 11.1 Write 4 focused tests for frontend class/service changes
    - Test that `Class` interface in `model.ts` has `service_id` and not `application_point_id`
    - Test that the classes Grid column config shows a "Service" column
    - Test that the "Service" column renders a dropdown populated from the services list
    - Test that `applicationPointDerivation.ts` no longer references `application_point_id` on classes (or is removed if no other consumers)
  - [x] 11.2 Update `frontend/src/types/model.ts` Class interface (line ~413)
    - Replace `application_point_id: string` with `service_id: string`
  - [x] 11.3 Update `frontend/src/components/Grid/Grid.tsx` classes column configuration (line ~958)
    - Replace "Application Point" column with "Service" column
    - Column should display a dropdown of services (fetched from the services array in the model)
    - `field: 'service_id'` instead of `field: 'application_point_id'`
  - [x] 11.4 Update or remove `frontend/src/utils/applicationPointDerivation.ts`
    - Remove any logic that references `application_point_id` on the `Class` interface
    - If the utility is only used for class-related derivation, remove the file entirely
    - If it has other consumers, update only the class-related logic
  - [x] 11.5 Search for and update any other frontend references to `application_point_id` on classes
    - Check API call payloads, form components, detail views, and any other components that read or write `application_point_id` for classes
  - [x] 11.6 Ensure frontend class/service tests pass
    - Run ONLY the 4 tests written in 11.1

**Acceptance Criteria:**
- `Class` interface uses `service_id`
- Grid shows "Service" dropdown for classes
- No remaining frontend references to `application_point_id` on classes
- Application point derivation logic updated/removed for classes

---

### Dead Code Removal Layer

#### Task Group 12: Dead Code Removal (Clustering, Candidate Generation, Dead Decision Tasks)
**Dependencies:** Task Group 9 (runManager must be updated first so removed modules are no longer imported)

- [x] 12.0 Complete dead code removal
  - [x] 12.1 Write 2 focused tests to verify dead code is gone
    - Test that importing from removed module paths throws a module-not-found error (or that the files do not exist)
    - Test that `DecisionTaskTypeString` union in gateway does NOT include any 1c/1d types (only `confirm_relationship` and `resolve_competing_relationships` remain)
  - [x] 12.2 Remove discovery-service clustering modules
    - Remove `discovery-service/src/services/clusteringEngine.ts`
    - Remove `discovery-service/src/services/clusteringRuleRegistry.ts`
    - Remove `discovery-service/src/services/clusteringRules/` directory (all files: `anchorHintClusterRule.ts`, `dataUsageClusterRule.ts`, `directoryClusterRule.ts`, `importDensityClusterRule.ts`, `routePrefixClusterRule.ts`, `index.ts`)
    - Remove `discovery-service/src/services/clusterTriageEngine.ts`
  - [x] 12.3 Remove discovery-service candidate generation modules
    - Remove `discovery-service/src/services/candidateGenerationEngine.ts`
    - Remove `discovery-service/src/services/candidateGenerationRuleRegistry.ts`
    - Remove `discovery-service/src/services/candidateGenerationRules/` directory (all files: `anchorTypeRule.ts`, `dataEntityRule.ts`, `fallbackPackageRule.ts`, `interfaceRule.ts`, `serviceComponentRule.ts`, `index.ts`)
    - Remove `discovery-service/src/services/candidateTriageEngine.ts`
  - [x] 12.4 Remove or deprecate discovery-service type files
    - Remove `discovery-service/src/types/cluster.ts` (preserve `discovery_cluster` DB table for historical data)
    - Remove `discovery-service/src/types/clusteringRule.ts`
    - Remove `discovery-service/src/types/candidateGenerationRule.ts`
  - [x] 12.5 Remove dead decision task types from gateway
    - Update `DecisionTaskTypeString` union in `gateway/src/routes/discoveryDecisionTaskPrompts.ts` to remove: `cluster_merge_decision`, `cluster_type_classification`, `cluster_anchor_assignment`, `cluster_noise_decision`, `candidate_type_classification`, `candidate_parent_assignment`, `candidate_name_refinement`, `candidate_merge_decision`, `candidate_rejection_review`
    - Keep only: `confirm_relationship`, `resolve_competing_relationships`, `file_analysis`
  - [x] 12.6 Remove dead entries from `PROMPT_TEMPLATE_FILES` map
    - Remove the 9 dead entries from the map in `discoveryDecisionTaskPrompts.ts`
    - Keep entries for `confirm_relationship`, `resolve_competing_relationships`, and `file_analysis`
  - [x] 12.7 Delete 9 dead prompt template files from `gateway/src/config/prompts/`
    - Delete `discovery.cluster-merge-decision.prompt.md`
    - Delete `discovery.cluster-type-classification.prompt.md`
    - Delete `discovery.cluster-anchor-assignment.prompt.md`
    - Delete `discovery.cluster-noise-decision.prompt.md`
    - Delete `discovery.candidate-type-classification.prompt.md`
    - Delete `discovery.candidate-parent-assignment.prompt.md`
    - Delete `discovery.candidate-name-refinement.prompt.md`
    - Delete `discovery.candidate-merge-decision.prompt.md`
    - Delete `discovery.candidate-rejection-review.prompt.md`
  - [x] 12.8 Remove dead interpolation helpers and user message builders from `discoveryDecisionTaskPrompts.ts`
    - Remove all helper functions for 1c cluster types (interpolateCluster*, buildMessagesForCluster*)
    - Remove all helper functions for 1d candidate types (interpolateCandidate*, buildMessagesForCandidate*)
    - Keep 1b helpers: `interpolateConfirmRelationship`, `interpolateResolveCompetingRelationships`, and their message builders
  - [x] 12.9 Remove dead test files from `discovery-service/src/__tests__/`
    - Remove `clusteringEngine.test.ts`
    - Remove `clusteringRegistryAndDefaults.test.ts`
    - Remove `clusteringRules.test.ts`
    - Remove `clusteringTypes.test.ts`
    - Remove `clusterTriageEngine.test.ts`
    - Remove `candidateGenerationEngine.test.ts`
    - Remove `candidateGenerationRegistryAndDefaults.test.ts`
    - Remove `candidateGenerationRules.test.ts`
    - Remove `candidateGenerationTypes.test.ts`
    - Remove `candidateTriageEngine.test.ts`
    - Remove `phase1cOrchestration.test.ts`
    - Remove `phase1cGapOrchestration.test.ts`
    - Remove `phase1cGapTests.test.ts`
    - Remove `phase1dOrchestration.test.ts`
    - Remove `phase1dGapTests.test.ts`
  - [x] 12.10 Remove dead imports from any remaining files that reference removed modules
    - Search for imports of `clusteringEngine`, `clusteringRuleRegistry`, `clusterTriageEngine`, `candidateGenerationEngine`, `candidateGenerationRuleRegistry`, `candidateTriageEngine`, `cluster.ts`, `clusteringRule.ts`, `candidateGenerationRule.ts` across the codebase
    - Update or remove any remaining references
  - [x] 12.11 Ensure dead code removal verification tests pass
    - Run ONLY the 2 tests written in 12.1

**Acceptance Criteria:**
- All clustering engine/rules/registry/triage files are removed
- All candidate generation engine/rules/registry/triage files are removed
- Dead type files removed (cluster.ts, clusteringRule.ts, candidateGenerationRule.ts)
- 9 dead prompt template files deleted
- `DecisionTaskTypeString` contains only 1b types + `file_analysis`
- `PROMPT_TEMPLATE_FILES` map cleaned up
- 15 dead test files removed
- No remaining imports of removed modules

---

### Testing Layer

#### Task Group 13: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-12

- [x] 13.0 Review existing tests and fill critical gaps only
  - [x] 13.1 Review tests from Task Groups 1-12
    - Review the 4 tests from Task Group 1 (type extensions)
    - Review the 4 tests from Task Group 2 (DB migration)
    - Review the 2 tests from Task Group 3 (JPA evidence type)
    - Review the 6 tests from Task Group 4 (scan plan builder)
    - Review the 5 tests from Task Group 5 (Extension Pack framework)
    - Review the 6 tests from Task Group 6 (gateway file analysis endpoint)
    - Review the 4 tests from Task Group 7 (gateway client extension)
    - Review the 8 tests from Task Group 8 (LLM file analysis orchestration)
    - Review the 4 tests from Task Group 9 (runManager restructuring)
    - Review the 6 tests from Task Group 10 (save-back config)
    - Review the 4 tests from Task Group 11 (frontend classes/service)
    - Review the 2 tests from Task Group 12 (dead code removal verification)
    - Total existing tests: approximately 55 tests
  - [x] 13.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows: full pipeline run (1a -> 1b -> LLM file analysis) producing candidates
    - Identify integration gaps: scan plan -> gateway call -> candidate conversion -> evidence persistence
    - Identify save-back gaps: new candidate types flowing through the full save-back pipeline
    - Focus ONLY on gaps related to this spec's feature requirements
  - [x] 13.3 Write up to 10 additional strategic tests to fill critical gaps
    - End-to-end pipeline test: full runManager execution with mocked LLM producing candidates of new types
    - Integration test: scan plan builder output feeding into gateway client call
    - Integration test: LLM response parsing producing correct parent-child candidate relationships across files
    - Integration test: evidence persistence of `llm_file_analysis` atoms with correct payloads
    - Integration test: save-back of `class` candidate creates entity with `service_id` FK
    - Integration test: save-back of `endpoint` candidate creates entity with `interface_id` FK
    - Integration test: Extension Pack registry with no-op result does not mutate candidates
    - Regression test: 1b decision task resolution still works after dead code removal (confirm_relationship, resolve_competing_relationships)
    - Regression test: existing candidate types (application, service, etc.) still save-back correctly after CANDIDATE_TYPE_CONFIG additions
    - Frontend test: Grid renders classes table with "Service" column from model data
  - [x] 13.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from all task groups + gap-fill tests)
    - Expected total: approximately 65 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 65 tests total)
- Critical end-to-end pipeline workflow is covered
- Save-back for new candidate types is verified
- 1b regression confirmed working after dead code cleanup
- No more than 10 additional gap-fill tests written

---

## Execution Order

Recommended implementation sequence with rationale:

```
Phase 1 -- Foundation (no dependencies, can run in parallel):
  Task Group 1: CandidateType and EvidenceAtomType Extensions
  Task Group 2: Classes Table Schema Migration
  Task Group 3: JPA Evidence Type Extension
  Task Group 6: File Analysis Gateway Endpoint and Prompt Template

Phase 2 -- Core Services (depend on Phase 1):
  Task Group 4: Scan Plan Builder (depends on TG1)
  Task Group 5: Extension Pack Framework (depends on TG1)
  Task Group 7: Gateway Client Extension (depends on TG6)
  Task Group 10: CANDIDATE_TYPE_CONFIG Updates (depends on TG1, TG2)
  Task Group 11: Frontend Classes Table UI (depends on TG2)

Phase 3 -- Pipeline Integration (depends on Phase 2):
  Task Group 8: LLM File Analysis Orchestration (depends on TG1, TG4, TG5, TG7)
  Task Group 9: RunManager Pipeline Step Restructuring (depends on TG8)

Phase 4 -- Cleanup (depends on Phase 3):
  Task Group 12: Dead Code Removal (depends on TG9)

Phase 5 -- Verification (depends on all):
  Task Group 13: Test Review and Gap Analysis (depends on TG1-TG12)
```

### Dependency Graph

```
TG1 (Types) -----> TG4 (Scan Plan) --------\
       |---------> TG5 (Extension Pack) ----+--> TG8 (LLM Analysis) --> TG9 (RunManager) --> TG12 (Dead Code) --> TG13 (Tests)
       |---------> TG10 (Save-Back) --------/
       |
TG2 (DB Migration) --> TG10 (Save-Back)
       |-------------> TG11 (Frontend)
       |
TG3 (JPA Evidence) ---/
       |
TG6 (Gateway Endpoint) --> TG7 (Gateway Client) --> TG8 (LLM Analysis)
```
