# Spec Requirements: Extension Pack Framework & LLM File Analysis

## Initial Description
Replace the current discovery pipeline's clustering (1c) and candidate generation (1d) steps with LLM-driven file-level architectural analysis that produces typed candidates directly. Introduce the Extension Pack framework with a registry, applicability predicates, and no-op default (packs: [] means the step executes as a no-op and moves on). Persist intermediate LLM analysis results as evidence for downstream migration/target-state use. Refactor the gateway LLM endpoint for file-level analysis. Remove dead clustering/candidate-generation code.

## Requirements Discussion

### First Round Questions

**Q1:** The existing `DiscoveryCandidate` interface has a required `sourceClusterIds: string[]` field, and the JPA entity `DiscoveryCandidateEntity` has a JSONB `sourceClusterIds` column. Since clusters are being removed from the pipeline, I assume candidates produced by LLM file analysis will set `sourceClusterIds` to an empty array `[]` rather than altering the database schema. Is that correct, or should we repurpose this field (e.g., to hold source file paths or atom IDs instead)?
**Answer:** Repurpose the field to hold source file paths instead of cluster IDs. Keep the DB column name as-is (`source_cluster_ids` in Postgres / `sourceClusterIds` in JPA) to avoid a database migration. Populate with the file paths that the LLM analyzed to produce the candidate. This preserves traceability (which files produced this candidate) which is valuable for migration planning. Conceptually, the field now means "source references" even though the column name retains its original naming.

**Q2:** The scan plan needs to classify files as "architecturally interesting" vs. "boilerplate." I'm assuming the scan plan builder will use 1a atom data to make this determination -- specifically, files that have symbol atoms (classes, interfaces, methods, annotations) are interesting, while files with only file_structure atoms and no symbols (e.g., package.json, .gitignore, yarn.lock, config files) are boilerplate. Should the classification also consider 1b relationships (e.g., a file referenced by many imports is more interesting), or is the 1a atom presence sufficient for v1?
**Answer:** Use BOTH 1a atom presence AND 1b relationships. Files with symbol atoms are the baseline for inclusion, but 1b relationship data enriches the classification -- files referenced by many imports are more architecturally central and should be prioritized. This produces richer scan plans with better prioritization of architecturally significant files.

**Q3:** For LLM file-level analysis, the initialization says "each interesting file (or small groups of related files)" is sent to the LLM. I'm assuming this means one LLM call per file for v1 (simplest batching model), where each call receives the file's source code plus its 1a atom summary as context. Should we also send related files in the same call (e.g., a Java class and its interface, or a controller and its DTO), and if so, how should we determine relatedness -- using 1b relationships, file path proximity, or import chains?
**Answer:** One file per LLM call for v1 (simplest, most predictable token budget). Include the file's 1a atom summary and its 1b relationship context (import/export references) as additional context in the prompt. This gives the LLM enough context about the file's role without the complexity of multi-file grouping. Group-based analysis can be added in a future increment if needed.

**Q4:** The gateway endpoint design needs a decision: should we create a NEW endpoint (e.g., `POST /api/v1/discovery/analyze-files`) completely separate from the existing `POST /api/v1/discovery/resolve-decision-tasks`, or refactor the existing endpoint to support a new task type (e.g., `file_analysis`)? I'm leaning toward a new endpoint since file analysis has a fundamentally different request/response shape (source code in, structured entities out) compared to decision task resolution (task data in, JSON verdict out). What is your preference?
**Answer:** Create a NEW endpoint (`POST /api/v1/discovery/analyze-files`). The existing `resolve-decision-tasks` endpoint is KEPT because step 1b still uses it for decision task resolution. The new endpoint is additional, not a replacement. Dead code from the old clustering/candidate pipeline that is no longer referenced should be cleaned up (cluster-related and candidate-related prompt templates and decision task types from 1c/1d, but NOT the 1b confirm_relationship and resolve_competing_relationships types).

**Q5:** For the structured JSON response schema from the LLM, I need to understand the expected entity shape. I'm assuming each identified entity in the LLM response includes: `{ entityType: CandidateType, name: string, confidence: number, filePath: string, lineRange?: [number, number], parentEntityName?: string, metadata: Record<string, unknown> }`. Should the LLM also identify relationships between entities it finds (e.g., "method X belongs to class Y", "class Z implements interface W"), or should parent-child relationships be inferred post-LLM by matching names and file paths?
**Answer:** The LLM should identify relationships between entities it finds (e.g., "method X belongs to class Y", "class Z implements interface W", "endpoint A is on controller B"). These relationships should be part of the structured JSON response from the LLM. This means the LLM response schema includes both an `entities` array and a `relationships` array connecting them.

**Q6:** The initialization mentions that the new candidate types (`endpoint`, `class`, `method`, `physical_attribute`) need corresponding entries in `CANDIDATE_TYPE_CONFIG`. For save-back parent FK resolution, I'm assuming: `class` has `parentFkField: 'app_component_id'` or `'service_id'`, `method` has `parentFkField: 'class_id'`, `endpoint` has `parentFkField: 'interface_id'` or `'service_id'`, and `physical_attribute` has `parentFkField: 'physical_data_entity_id'`. Can you confirm the correct parent FK mappings for each new type, especially `class` and `endpoint` which could have multiple possible parents?
**Answer:** Confirmed parent FK mappings:
- `class` -> `service_id` (requires schema change -- see Follow-up 1 below)
- `method` -> `class_id`
- `endpoint` -> `interface_id`
- `physical_attribute` -> `physical_data_entity_id`

**Q7:** For token budget management, a typical source file can be 100-500 lines (1K-5K tokens). With a codebase of 600+ interesting files, sending each to the LLM individually would mean 600+ LLM calls. The existing batching pattern sends 50 tasks per HTTP request to the gateway, where tasks are resolved sequentially. I'm assuming we keep this same batching pattern (50 files per gateway request, resolved sequentially within the gateway). Should we also consider a token budget per call that truncates very large files (e.g., >1000 lines), or should the LLM receive the full file regardless of size?
**Answer:** Make the file line limit CONFIGURABLE with a default of 10,000 lines (very high -- effectively sends all files as-is for now). The user can reduce this config value later. Files exceeding the configured limit should be truncated with a note in the prompt telling the LLM the file was truncated. Configuration lives in discovery-service config (environment variable or config file).

**Q8:** Regarding the Extension Pack framework for v1: the initialization says the pack list will be empty and extension packs hook in AFTER LLM analysis. I'm assuming the extension pack interface needs: `{ id: string, name: string, when: ExtensionPackPredicate, enrich(candidates: DiscoveryCandidate[], atoms: EvidenceAtom[], relationships: EvidenceRelationship[]): Promise<DiscoveryCandidate[]> }` where `ExtensionPackPredicate` evaluates against techHints. Since this is a no-op for v1, should the spec fully define the pack interface and registry, or just define the hook point in runManager with a TODO for the interface details in a future spec?
**Answer:** Fully define the Extension Pack interface and registry in this spec. Increments 2 (Java/Spring Boot pack) and 3 (React/TypeScript pack) depend on it, so the contract must be complete. Define: the interface, the registry, the applicability predicate system, and the hook point in runManager. The pack list will be empty in v1 but the contract is fully specified so Increments 2 and 3 can implement against it.

**Q9:** Is there anything that should be explicitly excluded from this spec's scope that I haven't mentioned? For example: changes to the frontend candidate review UI to display the new candidate types, changes to the candidate review/approval workflow, modifications to step 1b linker rules, or changes to the discovery summary/dashboard views?
**Answer:**
- EXCLUDED: Changes to the frontend candidate review UI (existing UI already displays candidates -- new types will appear automatically). Changes to the candidate review/approval workflow. Changes to step 1b linker rules (kept as-is).
- INCLUDED: New CandidateType values (endpoint, class, method, physical_attribute) added to the union type. New entries in CANDIDATE_TYPE_CONFIG for save-back. Discovery summary/dashboard views updated only if they break with the new candidate types (minimal changes).

### Existing Code to Reference

**Similar Features Identified (from researcher analysis):**
- Feature: Phase 1a Analyzer Pack - Path: `discovery-service/src/services/phase1aAnalyzerPack.ts`
- Feature: Gateway Decision Task Resolution - Path: `gateway/src/routes/discoveryDecisionTasks.ts`
- Feature: Gateway Decision Task Prompts - Path: `gateway/src/routes/discoveryDecisionTaskPrompts.ts`
- Feature: Gateway Client (batching) - Path: `discovery-service/src/services/gatewayClient.ts`
- Feature: Run Manager orchestration - Path: `discovery-service/src/services/runManager.ts`
- Feature: Candidate Save-Back Service - Path: `mcp-server/src/services/candidateSaveBackService.ts`
- Feature: Candidate type definitions - Path: `discovery-service/src/types/candidate.ts`
- Feature: Evidence atom types - Path: `discovery-service/src/types/evidenceAtom.ts`
- Feature: LLM Client interface - Path: `gateway/src/services/llmClient.ts`
- Feature: Classes/Methods DB schema - Path: `architecture-model-service/src/main/resources/db/changelog/sql/002-classes-methods.sql`
- Feature: Class FK migration (025) - Path: `architecture-model-service/src/main/resources/db/changelog/sql/025-class-application-point-id.sql`
- Feature: ClassEntity JPA - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ClassEntity.java`
- Feature: ClassDto JPA - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ClassDto.java`
- Feature: Frontend model types - Path: `frontend/src/types/model.ts` (Class interface at line 413)
- Feature: Frontend Grid config - Path: `frontend/src/components/Grid/Grid.tsx` (classes columns at line 958)
- Feature: Application Point derivation util - Path: `frontend/src/utils/applicationPointDerivation.ts`

No additional similar features were identified by the user.

### Follow-up Questions

**Follow-up 1:** I found a discrepancy between your stated parent FK for the `class` candidate type (`service_id`) and the actual database schema. The `classes` table currently has `application_point_id` as its parent FK (referencing `application_points`), NOT `service_id`. Migration 025 explicitly dropped the polymorphic `owned_by_ref_kind`/`owned_by_ref_id` columns and replaced them with `application_point_id`. The JPA `ClassEntity` confirms this structure. For save-back, should we: (a) use `application_point_id` as the parent FK for `class` candidates (matching the current DB schema, which requires creating or finding an application_point first), (b) add a new `service_id` column to the `classes` table via a migration and update the JPA entity, or (c) treat `class` candidates differently in save-back -- skip the parent FK entirely and populate it as a follow-up manual step?
**Answer:** Replace `application_point_id` with `service_id` on the `classes` table. This is a full schema change requiring:
- **Database migration:** Drop `application_point_id` from `classes`, add `service_id` referencing `services(id)`
- **JPA entity update:** `ClassEntity` changes from `applicationPointId` to `serviceId`
- **JPA DTO update:** `ClassDto` changes from `applicationPointId` to `serviceId`
- **Frontend UI update:** Classes table in "Architecture & Design" -> "Application" section shows "Service" dropdown instead of "Application Point"
- **Frontend type model:** `model.ts` Class interface changes `application_point_id` to `service_id`
- **Frontend utility:** `applicationPointDerivation.ts` logic referencing `application_point_id` on classes needs updating or removal
- **Save-back config:** `class` -> `parentFkField: 'service_id'`
- This simplifies save-back significantly -- the LLM identifies which service a class belongs to, and that maps directly to the FK

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via filesystem check).

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Replace steps 1c (clustering) and 1d (candidate generation) with a new LLM file-level analysis step
- Build a "scan plan" from 1a atoms and 1b relationships to identify architecturally interesting files, prioritizing by import centrality
- Send one file per LLM call with 1a atom summary and 1b relationship context
- LLM returns structured JSON with typed entity proposals AND relationships between them
- Each LLM-identified entity becomes a DiscoveryCandidate with appropriate CandidateType
- Parent-child relationships established from LLM-identified relationships
- Repurpose `sourceClusterIds` field to hold source file paths for traceability
- Persist intermediate LLM analysis results as evidence (new `llm_file_analysis` evidence type)
- New gateway endpoint `POST /api/v1/discovery/analyze-files` for file-level LLM calls
- Configurable file line limit (default 10,000 lines) with truncation note in prompt
- Reuse existing batching pattern (50 files per gateway request, sequential processing within gateway)
- Extension Pack framework: fully defined interface, registry, applicability predicate system, and hook point in runManager (empty pack list for v1)
- Add 4 new candidate types: `endpoint`, `class`, `method`, `physical_attribute`
- Add corresponding CANDIDATE_TYPE_CONFIG entries for save-back
- Schema change: replace `application_point_id` with `service_id` on `classes` table (migration, JPA entity, JPA DTO, frontend type model, frontend Grid config, frontend utility)
- Remove dead clustering and candidate generation code (engines, rules, registries, triage engines)
- Clean up dead decision task types from 1c/1d (cluster_merge_decision, cluster_type_classification, cluster_anchor_assignment, cluster_noise_decision, candidate_type_classification, candidate_parent_assignment, candidate_name_refinement, candidate_merge_decision, candidate_rejection_review) and their prompt templates
- Keep 1b decision task types (confirm_relationship, resolve_competing_relationships) and their prompt templates

### Reusability Opportunities
- Gateway `discoveryDecisionTasks.ts` pattern for the new file analysis endpoint (prompt loading, LLM call, JSON parsing, parseLlmJsonResponse utility)
- `gatewayClient.ts` batching pattern (batches of 50, 20-min timeout) for file analysis calls -- extend with new method for file analysis
- `phase1aAnalyzerPack.ts` as a model for the new LLM file analysis step structure
- `candidateSaveBackService.ts` CANDIDATE_TYPE_CONFIG for adding new candidate types
- `AnalyzerPack` interface in `analyzerPack.ts` as a basis for the Extension Pack interface
- `createEmptyModelShell()` already has `endpoints`, `classes`, `methods`, `physical_data_attributes` arrays
- Existing DB tables: `classes`, `methods`, `endpoints`, `physical_data_attributes` already exist in the meta-model
- `LlmClient` interface in `gateway/src/services/llmClient.ts` with `sendChatRequest` for the new endpoint

### Scope Boundaries
**In Scope:**
- New LLM file-level analysis pipeline step replacing 1c/1d
- Scan plan builder using 1a atoms and 1b relationships
- New gateway endpoint for file analysis (`POST /api/v1/discovery/analyze-files`)
- New prompt template for file-level entity extraction (`discovery.file-analysis.prompt.md`)
- Extension Pack interface, registry, predicate system (fully defined, empty pack list)
- Extension Pack hook point in runManager
- 4 new CandidateType values (`endpoint`, `class`, `method`, `physical_attribute`) and CANDIDATE_TYPE_CONFIG entries
- Intermediate evidence persistence (`llm_file_analysis` evidence type)
- Configurable file line limit with truncation
- Schema change: `classes` table `application_point_id` -> `service_id` (DB migration, JPA, frontend)
- Dead code removal (clustering engine, candidate generation engine, related rules/registries/triage)
- Dead decision task type cleanup (1c cluster_* and 1d candidate_* task types and prompt templates)
- Minimal dashboard/summary fixes if new candidate types break existing views

**Out of Scope:**
- Frontend candidate review UI changes (new types appear automatically)
- Candidate review/approval workflow changes
- Step 1b linker rule modifications
- Multi-file grouping for LLM calls (future increment)
- Actual Extension Pack implementations (Java/Spring Boot and React/TypeScript packs are separate increments 2 and 3)
- Changes to the `resolve-decision-tasks` gateway endpoint (kept for 1b)

### Technical Considerations
- `DiscoveryCandidate.sourceClusterIds` field repurposed for file paths -- no DB migration, just semantic change
- `discovery_evidence` table `type` column needs new `llm_file_analysis` value (TypeScript union and JPA)
- `EvidenceAtomType` TypeScript union needs extending for LLM evidence
- `CandidateType` union needs 4 new types: `endpoint`, `class`, `method`, `physical_attribute`
- `VALID_STEPS` in runManager needs updating -- step naming for the new LLM analysis step (replaces 1c/1d)
- `classes` table schema change: drop `application_point_id`, add `service_id` FK to `services(id)` -- impacts JPA ClassEntity, ClassDto, frontend model.ts Class interface, Grid.tsx classes columns, applicationPointDerivation.ts utility, and related tests
- `endpoints` table uses `interface_id` FK -- confirmed, no change needed
- `methods` table uses `class_id` FK -- confirmed, no change needed
- `physical_data_attributes` table uses `physical_entity_id` FK -- confirmed, no change needed
- CANDIDATE_TYPE_CONFIG new entries: `class` -> `{ targetArrayKey: 'classes', idPrefix: 'cls-', parentFkField: 'service_id' }`, `method` -> `{ targetArrayKey: 'methods', idPrefix: 'mth-', parentFkField: 'class_id' }`, `endpoint` -> `{ targetArrayKey: 'endpoints', idPrefix: 'ep-', parentFkField: 'interface_id' }`, `physical_attribute` -> `{ targetArrayKey: 'physical_data_attributes', idPrefix: 'pda-', parentFkField: 'physical_entity_id' }`
- Gateway processes LLM tasks sequentially within a batch -- acceptable for v1
- File line limit configurable via environment variable (default 10,000)
- `DecisionTaskTypeString` union in gateway needs cleanup of dead 1c/1d types
- `PROMPT_TEMPLATE_FILES` map needs dead entries removed and new `file_analysis` entry added
- Prompt template file needed: `discovery.file-analysis.prompt.md`
- LLM response schema must include both entities array and relationships array
- Dead prompt template files to remove: `discovery.cluster-merge-decision.prompt.md`, `discovery.cluster-type-classification.prompt.md`, `discovery.cluster-anchor-assignment.prompt.md`, `discovery.cluster-noise-decision.prompt.md`, `discovery.candidate-type-classification.prompt.md`, `discovery.candidate-parent-assignment.prompt.md`, `discovery.candidate-name-refinement.prompt.md`, `discovery.candidate-merge-decision.prompt.md`, `discovery.candidate-rejection-review.prompt.md`
