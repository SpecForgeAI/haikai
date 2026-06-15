# Spec Requirements: Phase 1 Evidence Schema Backbone

## Initial Description
Increment 7 of 16 -- Legacy / Current-State Discovery capability. Formalizes the Phase 1 evidence schema backbone covering all four sub-phases (1a through 1d). Phase 1a already has a working extraction pipeline producing evidence atoms (file_structure, symbol, string_pattern) persisted to the discovery_evidence table. This increment defines the TypeScript type contracts and persistence schemas for the remaining three layers of the Phase 1 pipeline:

- **1b Relationship Inference**: Produces relationship evidence linking pairs of 1a atoms (e.g., "file X imports symbol Y", "service A calls service B")
- **1c Cluster Formation**: Groups related atoms and relationships into coherent clusters (e.g., "these files + symbols + relationships form a service boundary")
- **1d Candidate Synthesis**: Synthesizes clusters into discovery candidates that map to meta-model element types (e.g., "this cluster is likely an Application named X")

## Requirements Discussion

### First Round Questions

**Q1:** The existing `discovery_evidence` table stores 1a atoms with columns (id, run_id, repo_url, file_path, type, data JSONB). I see two approaches for 1b relationships, 1c clusters, and 1d candidates: (A) create separate tables per layer (`discovery_relationship`, `discovery_cluster`, `discovery_candidate`), each with layer-specific columns and FKs; or (B) extend/reuse the single `discovery_evidence` table by adding a `layer` discriminator column and broadening the `type` column to include new type values per layer. I'm leaning toward (A) separate tables because each layer has fundamentally different fields. Is that correct, or do you prefer the single-table approach?
**Answer:** Use a clean persisted structure that keeps the four layers explicit; do not collapse everything into one amorphous record if that harms clarity or later evolution.

**Q2:** I assume a relationship links two 1a atoms with fields like: `id` (UUID), `runId`, `sourceAtomId` (FK to discovery_evidence.id), `targetAtomId` (FK to discovery_evidence.id), `relationshipType` (e.g., 'imports', 'calls', 'extends', 'contains', 'uses_data'), `confidence` (0.0-1.0 float), and `data` (JSONB for type-specific payload). Should there also be `repoUrl` and `filePath` on the relationship itself (to indicate where the relationship was inferred from), or is the source atom's location sufficient? And should confidence be a required field at this schema level, or optional?
**Answer:** Source atom traceability is the main requirement; extra source-location fields are optional if they add real value. Confidence should be present for inferred relationships.

**Q3:** I assume a cluster groups atoms and/or relationships with fields like: `id` (UUID), `runId`, `clusterType`, `name` (optional/nullable label), `confidence` (0.0-1.0), and `data` (JSONB for metadata). For membership, I see two approaches: (A) a JSONB array of member IDs stored on the cluster record, or (B) a separate `discovery_cluster_member` join table with (cluster_id, member_type, member_id). Which approach do you prefer? And should clusters reference only atoms, only relationships, or both?
**Answer:** Use a membership shape that stays easy to query and evolve; clusters should be able to reference both atoms and relationships where useful.

**Q4:** I assume a discovery candidate maps to the existing architecture meta-model element types. Should candidates reference their source clusters via a JSONB array of cluster IDs or via a join table? And should there be a `status` field on candidates (e.g., 'proposed', 'accepted', 'rejected') for future human review, or is that out of scope for the schema backbone?
**Answer:** Candidates should reference their source clusters and should include a status/review field so later review workflows fit cleanly.

**Q5:** Increment 6 established a pattern where the `EvidenceAtom` TypeScript interface in discovery-service mirrors the `DiscoveryEvidenceEntity` JPA entity in architecture-model-service. I assume this increment should define both TypeScript interfaces and JPA entities + DTOs + Liquibase migrations + REST endpoints for each new layer. Is that correct, or should we define TypeScript types only and defer persistence to a later increment?
**Answer:** Define the durable backend contract in this increment, not just TypeScript-only placeholders; later phases will depend on it being real.

**Q6:** Currently 1b/1c/1d stubs in the run manager return `{ phase: 'phase1', step, status: 'stub', projectId }`. Should this increment update those stubs to at least query the 1a atoms, create empty backbone structures in the new tables, and return summary metadata? Or should the stubs remain completely inert?
**Answer:** Yes -- 1b/1c/1d should have real empty backbone readiness rather than remaining completely inert.

**Q7:** The current `discovery_evidence` table schema and `EvidenceAtom` TypeScript interface appear to already be compatible with the formalized 1a atom contract. I assume no modifications are needed. Is that correct, or are there any changes needed?
**Answer:** Keep 1a aligned to the new backbone; update it where needed rather than forcing the backbone to match earlier temporary shapes.

**Q8:** Is there anything that should be explicitly excluded from this increment?
**Answer:** Yes -- exclude real inference/clustering/synthesis logic, frontend work, and LLM integration in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Discovery Evidence TypeScript types -- Path: `discovery-service/src/types/evidenceAtom.ts` -- The 1a atom types (EvidenceAtom, EvidenceAtomType, FileStructureData, SymbolData, StringPatternData) as the structural template for defining 1b/1c/1d TypeScript interfaces
- Feature: Discovery Evidence JPA entity -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryEvidenceEntity.java` -- JPA entity pattern with JSONB data column, UUID PK, runId FK, @Type(JsonType.class), @Builder, @PrePersist. Direct template for new layer entities.
- Feature: Discovery Evidence DTO -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryEvidenceDto.java` -- Java record DTO with @JsonProperty annotations. Template for new layer DTOs.
- Feature: Discovery Evidence Repository -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryEvidenceRepository.java` -- Spring Data JPA repository with findByRunId, findByRunIdAndType, countByRunId. Template for new layer repositories.
- Feature: Discovery Evidence Service -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryEvidenceService.java` -- Service with bulkCreate, getByRunId, countByRunId, entity-to-DTO mapping. Template for new layer services.
- Feature: Discovery Evidence Controller -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryEvidenceController.java` -- REST controller with bulk insert (POST), list with filter (GET), count (GET /count) under `/api/model/projects/{projectId}/discovery/runs/{runId}/evidence`. Template for new layer controllers.
- Feature: Discovery Evidence Liquibase migration -- Path: `architecture-model-service/src/main/resources/db/changelog/sql/066-discovery-evidence.sql` -- SQL migration with UUID PK, run_id FK with ON DELETE CASCADE, TEXT columns, JSONB column, TIMESTAMPTZ, indexes, comments. Template for new layer migrations.
- Feature: Discovery-service archModelClient -- Path: `discovery-service/src/services/archModelClient.ts` -- Axios-based HTTP client with bulkSaveEvidence, getEvidenceByRun, getEvidenceCount methods. New bulk save/query methods for each layer will be added here.
- Feature: Discovery-service run manager -- Path: `discovery-service/src/services/runManager.ts` -- Step execution engine with executeStep() dispatch and per-step state updates. The 1b/1c/1d stubs will be updated here to create empty backbone structures.
- Feature: Discovery Run JPA entity -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryRunEntity.java` -- Run entity with stepsPayload JSONB tracking per-step status. The stepsPayload metadata shape for 1b/1c/1d will carry summary counts from the new layers.
- Feature: Analyzer Pack types -- Path: `discovery-service/src/types/analyzerPack.ts` -- AnalyzerResult with optional evidenceAtoms field. May need extension for relationship/cluster/candidate result types.

### Follow-up Questions
No follow-up questions were needed. All answers were clear and provided sufficient direction for each design decision.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**FR-1: Separate tables for each evidence layer (1b, 1c, 1d)**

Three new database tables in architecture-model-service, each with its own distinct schema reflecting the semantics of its layer. All three tables use the same foundational patterns as the existing `discovery_evidence` table (UUID PK, run_id FK with ON DELETE CASCADE, JSONB data column, timestamps, indexes).

**FR-2: Discovery Relationship table and full persistence stack (1b)**

A new `discovery_relationship` table and corresponding JPA entity, DTO, repository, service, controller, and Liquibase migration for storing inferred relationships between 1a evidence atoms.

Table columns:
- `id` -- UUID primary key
- `run_id` -- UUID FK to discovery_run.id, ON DELETE CASCADE, NOT NULL
- `source_atom_id` -- UUID FK to discovery_evidence.id, ON DELETE CASCADE, NOT NULL
- `target_atom_id` -- UUID FK to discovery_evidence.id, ON DELETE CASCADE, NOT NULL
- `relationship_type` -- TEXT NOT NULL (e.g., 'imports', 'calls', 'extends', 'contains', 'uses_data', 'defines', 'references')
- `confidence` -- DOUBLE PRECISION NOT NULL (0.0 to 1.0, required for all inferred relationships)
- `data` -- JSONB NOT NULL (type-specific payload: e.g., line number of import, method signature, additional context)
- `inferred_at` -- TIMESTAMPTZ NOT NULL DEFAULT NOW()

Indexes:
- Non-unique index on `run_id`
- Composite index on `(run_id, relationship_type)`
- Index on `source_atom_id`
- Index on `target_atom_id`

REST endpoints (base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/relationships`):
- POST (bulk insert)
- GET (list with optional `?type=` filter on relationship_type)
- GET `/count` (count)

**FR-3: Discovery Cluster table and full persistence stack (1c)**

A new `discovery_cluster` table and corresponding JPA entity, DTO, repository, service, controller, and Liquibase migration for storing formed clusters that group atoms and relationships.

Table columns:
- `id` -- UUID primary key
- `run_id` -- UUID FK to discovery_run.id, ON DELETE CASCADE, NOT NULL
- `cluster_type` -- TEXT NOT NULL (e.g., 'service_boundary', 'data_domain', 'shared_library', 'api_layer', 'ui_module')
- `name` -- TEXT (nullable; optional human-readable label)
- `confidence` -- DOUBLE PRECISION NOT NULL (0.0 to 1.0)
- `data` -- JSONB NOT NULL (metadata: dominant language, directory root, member summary counts, etc.)
- `formed_at` -- TIMESTAMPTZ NOT NULL DEFAULT NOW()

Indexes:
- Non-unique index on `run_id`
- Composite index on `(run_id, cluster_type)`

REST endpoints (base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/clusters`):
- POST (bulk insert)
- GET (list with optional `?type=` filter on cluster_type)
- GET `/count` (count)

**FR-4: Discovery Cluster Member join table (1c membership)**

A separate `discovery_cluster_member` join table for cluster membership, enabling clusters to reference both atoms and relationships. This is preferred over JSONB arrays because it stays easy to query and evolve (e.g., "find all clusters containing atom X" becomes a simple indexed join rather than a JSONB containment query).

Table columns:
- `id` -- UUID primary key
- `cluster_id` -- UUID FK to discovery_cluster.id, ON DELETE CASCADE, NOT NULL
- `member_type` -- TEXT NOT NULL ('atom' or 'relationship')
- `member_id` -- UUID NOT NULL (references discovery_evidence.id when member_type='atom', references discovery_relationship.id when member_type='relationship'; referential integrity enforced at the application layer, not via FK, because the target table varies)

Indexes:
- Non-unique index on `cluster_id`
- Composite index on `(cluster_id, member_type)`
- Index on `member_id`
- Unique constraint on `(cluster_id, member_type, member_id)` to prevent duplicate memberships

No separate REST endpoints for the join table -- membership is managed through the cluster's bulk insert and read operations (the cluster DTO includes a list of member entries).

**FR-5: Discovery Candidate table and full persistence stack (1d)**

A new `discovery_candidate` table and corresponding JPA entity, DTO, repository, service, controller, and Liquibase migration for storing synthesized discovery candidates that map to meta-model element types.

Table columns:
- `id` -- UUID primary key
- `run_id` -- UUID FK to discovery_run.id, ON DELETE CASCADE, NOT NULL
- `candidate_type` -- TEXT NOT NULL (matching meta-model element types: 'application', 'app_component', 'service', 'logical_entity', 'physical_entity', 'interface', 'business_process', 'data_entity')
- `name` -- TEXT NOT NULL (proposed name for the meta-model element)
- `confidence` -- DOUBLE PRECISION NOT NULL (0.0 to 1.0)
- `status` -- TEXT NOT NULL DEFAULT 'proposed' (lifecycle status for review workflow: 'proposed', 'accepted', 'rejected', 'merged')
- `source_cluster_ids` -- JSONB NOT NULL (array of UUID strings referencing discovery_cluster.id entries; JSONB array is preferred here because candidates typically reference a small number of clusters and the primary query direction is "clusters for this candidate" not "candidates for this cluster")
- `data` -- JSONB NOT NULL (proposed properties: description, tech stack indicators, relationships to other candidates, any evidence summary)
- `synthesized_at` -- TIMESTAMPTZ NOT NULL DEFAULT NOW()

Indexes:
- Non-unique index on `run_id`
- Composite index on `(run_id, candidate_type)`
- Composite index on `(run_id, status)`

REST endpoints (base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/candidates`):
- POST (bulk insert)
- GET (list with optional `?type=` and/or `?status=` filters)
- GET `/count` (count)
- PUT `/{candidateId}` (update -- at minimum for status changes during future review workflow)

**FR-6: TypeScript type definitions for all three new layers**

New TypeScript interfaces in `discovery-service/src/types/` for each layer, following the pattern established by `evidenceAtom.ts`:

1b types (e.g., `relationship.ts`):
- `RelationshipType` union type (e.g., 'imports' | 'calls' | 'extends' | 'contains' | 'uses_data' | 'defines' | 'references')
- `EvidenceRelationship` interface with id, runId, sourceAtomId, targetAtomId, relationshipType, confidence, data, inferredAt
- Type-specific data interfaces for different relationship types

1c types (e.g., `cluster.ts`):
- `ClusterType` union type (e.g., 'service_boundary' | 'data_domain' | 'shared_library' | 'api_layer' | 'ui_module')
- `ClusterMember` interface with memberType ('atom' | 'relationship') and memberId
- `EvidenceCluster` interface with id, runId, clusterType, name (optional), confidence, members (ClusterMember[]), data, formedAt

1d types (e.g., `candidate.ts`):
- `CandidateType` union type (matching meta-model element types)
- `CandidateStatus` union type ('proposed' | 'accepted' | 'rejected' | 'merged')
- `DiscoveryCandidate` interface with id, runId, candidateType, name, confidence, status, sourceClusterIds, data, synthesizedAt

All new types exported via the `discovery-service/src/types/index.ts` barrel export.

**FR-7: archModelClient methods for new layers**

New methods on `discovery-service/src/services/archModelClient.ts` for each layer, following the existing evidence methods pattern:

1b methods:
- `bulkSaveRelationships(projectId, runId, relationships)` -- POST to relationships endpoint
- `getRelationshipsByRun(projectId, runId, type?)` -- GET with optional type filter
- `getRelationshipCount(projectId, runId)` -- GET count

1c methods:
- `bulkSaveClusters(projectId, runId, clusters)` -- POST to clusters endpoint
- `getClustersByRun(projectId, runId, type?)` -- GET with optional type filter
- `getClusterCount(projectId, runId)` -- GET count

1d methods:
- `bulkSaveCandidates(projectId, runId, candidates)` -- POST to candidates endpoint
- `getCandidatesByRun(projectId, runId, type?, status?)` -- GET with optional filters
- `getCandidateCount(projectId, runId)` -- GET count
- `updateCandidate(projectId, runId, candidateId, update)` -- PUT for status updates

**FR-8: Run manager stub updates for 1b/1c/1d backbone readiness**

Update the 1b, 1c, 1d stubs in `discovery-service/src/services/runManager.ts` to:
- Query the outputs of the previous step (e.g., 1b queries 1a atoms via `getEvidenceByRun`, 1c queries relationships via `getRelationshipsByRun`, 1d queries clusters via `getClustersByRun`)
- Create empty backbone structures in the new tables (zero relationships, zero clusters, zero candidates -- no real logic, just demonstrates the pipeline plumbing works end-to-end)
- Return summary metadata consistent with 1a's `{ atomCounts }` pattern (e.g., `{ relationshipCount: 0 }`, `{ clusterCount: 0 }`, `{ candidateCount: 0 }`)
- The stepsPayload entries for 1b/1c/1d in the run JSONB should carry these summary counts alongside the status

**FR-9: Align 1a to the backbone where needed**

Review the existing `EvidenceAtom` TypeScript interface and `DiscoveryEvidenceEntity` JPA entity for consistency with the new backbone conventions. Potential alignment changes:
- If a `layer` discriminator column or a `confidence` field is added to the backbone pattern and makes sense for atoms, consider adding it to the evidence table as well (nullable, backward-compatible)
- Ensure the `EvidenceAtomType` union in TypeScript is extensible (add documentation noting future atom types may be added)
- Ensure the `type` column comment in 066-discovery-evidence.sql does not restrict valid values to only the current three if the backbone introduces new atom types
- Any changes to the 1a table must be backward-compatible (nullable new columns, no breaking changes to existing data)

**FR-10: AnalyzerResult extension for new layer outputs**

Extend the `AnalyzerResult` interface in `discovery-service/src/types/analyzerPack.ts` with optional fields for the new layer outputs, following the same backward-compatible pattern used for `evidenceAtoms`:
- `relationships?: EvidenceRelationship[]` -- for 1b analyzer results
- `clusters?: EvidenceCluster[]` -- for 1c analyzer results
- `candidates?: DiscoveryCandidate[]` -- for 1d analyzer results

### Reusability Opportunities
- `DiscoveryEvidenceEntity` / `DiscoveryEvidenceService` / `DiscoveryEvidenceController` / `DiscoveryEvidenceRepository` pattern is the direct structural template for all three new JPA persistence stacks
- `066-discovery-evidence.sql` Liquibase migration is the direct template for new table migrations (067, 068, 069, 070)
- `discovery-service/src/types/evidenceAtom.ts` pattern (union types, data interfaces, core interface) is the template for the three new TypeScript type files
- `discovery-service/src/services/archModelClient.ts` existing evidence methods are the template for new HTTP client methods
- `discovery-service/src/services/runManager.ts` executeStep1a function is the template for the updated 1b/1c/1d stub functions (query previous layer, persist results, return summary metadata)
- `DiscoveryEvidenceDto` Java record pattern for new layer DTOs
- `DiscoveryEvidenceRepository` Spring Data JPA finder methods pattern for new layer repositories

### Scope Boundaries

**In Scope:**
- New `discovery_relationship` table with Liquibase migration, JPA entity, DTO, repository, service, controller
- New `discovery_cluster` table with Liquibase migration, JPA entity, DTO, repository, service, controller
- New `discovery_cluster_member` join table with Liquibase migration, JPA entity (no separate controller -- managed through cluster operations)
- New `discovery_candidate` table with Liquibase migration, JPA entity, DTO, repository, service, controller
- TypeScript interfaces for EvidenceRelationship, EvidenceCluster, ClusterMember, DiscoveryCandidate in discovery-service
- Union types for RelationshipType, ClusterType, CandidateType, CandidateStatus
- archModelClient methods for bulk save, query, and count on each new layer
- AnalyzerResult extension with optional relationship/cluster/candidate fields
- Run manager stub updates: 1b/1c/1d stubs query the previous layer's output, create empty backbone structures, and return summary metadata
- Backward-compatible alignment of 1a evidence types/table if the backbone pattern introduces fields that benefit 1a (e.g., confidence)
- Updated types barrel export (discovery-service/src/types/index.ts)
- Unit tests for all new architecture-model-service code (JUnit 5: services, controllers)
- Unit tests for all new discovery-service code (Jest: archModelClient methods, updated run manager stubs, type validations)

**Out of Scope:**
- Real relationship inference logic (1b analysis algorithms -- later increment)
- Real cluster formation logic (1c analysis algorithms -- later increment)
- Real candidate synthesis logic (1d analysis algorithms -- later increment)
- LLM integration for inference, clustering, or scoring
- Frontend UI for browsing evidence layers, relationships, clusters, or candidates
- Frontend UI for candidate review/accept/reject workflow
- Gateway proxy routes for the new evidence layer endpoints (discovery-service already calls architecture-model-service directly)
- MCP tool wiring for the new endpoints
- WebSocket or streaming progress for evidence layer processing
- Performance optimization (pagination, streaming bulk inserts) -- addressed in later increments if needed
- Phase 2+ pipeline stages
- Authentication or authorization on new endpoints
- Changes to the discovery_config or discovery_run table schemas (beyond stepsPayload metadata content)
- Modification to the Phase 1a analyzer pack or extractors (beyond the AnalyzerResult type extension)

### Technical Considerations
- The latest Liquibase migration is `066-discovery-evidence.sql`. New migrations will be `067-discovery-relationship.sql`, `068-discovery-cluster.sql`, `069-discovery-cluster-member.sql`, `070-discovery-candidate.sql`. All must be appended to `db.changelog-master.yaml` with the standard `preConditions` / `onFail: MARK_RAN` pattern.
- The `discovery_cluster_member` join table uses `member_type` + `member_id` polymorphic pattern rather than dual FK columns. Referential integrity for member_id is enforced at the application layer (service validation) because the target table varies based on member_type. This is the same pragmatic pattern used elsewhere in the codebase for polymorphic references.
- The `source_cluster_ids` JSONB array on discovery_candidate is chosen over a join table because the primary query direction is "get clusters for a candidate" (small array, deserialize in application) rather than "get all candidates referencing a cluster" (which would benefit from a join table). This keeps the schema simpler for the common access pattern.
- All new JPA entities should follow the `DiscoveryEvidenceEntity` pattern: Lombok `@Getter/@Setter/@Builder/@NoArgsConstructor/@AllArgsConstructor`, `@Type(JsonType.class)` for JSONB columns, `@Builder.Default` for default values, `@PrePersist`/`@PreUpdate` lifecycle callbacks for timestamps.
- All new controllers should use `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` consistent with all existing DB-dependent controllers.
- All new services should use `@ConditionalOnProperty` matching the controller pattern, with `@Transactional` annotations on write methods and `@Transactional(readOnly = true)` on read methods.
- The `confidence` field uses DOUBLE PRECISION in PostgreSQL (mapped to `double` in Java) rather than NUMERIC/BigDecimal for simplicity, since the 0.0-1.0 range does not require arbitrary precision.
- The run manager stub updates should follow the same try/catch/update pattern as `executeStep1a`: mark step as running, execute (query previous layer + create empty structures), mark step as completed with metadata, or mark as failed with error message.
- Docker Compose: no new service entries needed -- all changes are within existing discovery-service and architecture-model-service containers.
- The TypeScript type files should include JSDoc comments explaining each layer's purpose, the data flow between layers (1a atoms -> 1b relationships -> 1c clusters -> 1d candidates), and the semantic meaning of each type and field.
