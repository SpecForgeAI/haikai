# Specification: Phase 1 Evidence Schema Backbone (1a-1d)

## Goal
Define the complete persistence schema and TypeScript type contracts for Phase 1 evidence layers 1b (Relationship Inference), 1c (Cluster Formation), and 1d (Candidate Synthesis), including full JPA stacks, Liquibase migrations, archModelClient methods, and run manager stub updates that demonstrate end-to-end pipeline plumbing.

## User Stories
- As a discovery pipeline developer, I want durable database schemas and typed contracts for all four Phase 1 evidence layers so that future increments implementing real inference, clustering, and synthesis logic have a stable persistence backbone to build on.
- As a discovery pipeline developer, I want the 1b/1c/1d run manager stubs to query upstream layer outputs and persist empty backbone structures so that the step sequencing pipeline is proven end-to-end before real analysis logic is added.

## Specific Requirements

**Discovery Relationship table and full JPA stack (1b)**
- New `discovery_relationship` table via `067-discovery-relationship.sql` with columns: id (UUID PK), run_id (UUID FK to discovery_run ON DELETE CASCADE), source_atom_id (UUID FK to discovery_evidence ON DELETE CASCADE), target_atom_id (UUID FK to discovery_evidence ON DELETE CASCADE), relationship_type (TEXT NOT NULL), confidence (DOUBLE PRECISION NOT NULL), data (JSONB NOT NULL), inferred_at (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- Indexes: run_id, (run_id, relationship_type), source_atom_id, target_atom_id
- JPA entity `DiscoveryRelationshipEntity` following the `DiscoveryEvidenceEntity` pattern: Lombok annotations, `@Type(JsonType.class)` on data column, `@PrePersist` for timestamp
- Java record DTO `DiscoveryRelationshipDto` with `@JsonProperty` annotations matching the snake_case column names
- Repository with `findByRunId`, `findByRunIdAndRelationshipType`, `countByRunId`
- Service with `bulkCreate`, `getByRunId(runId, type?)`, `countByRunId`; `@Transactional` on writes, `@Transactional(readOnly = true)` on reads
- Controller at `/api/model/projects/{projectId}/discovery/runs/{runId}/relationships` with POST (bulk), GET (list with optional `?type=` filter), GET `/count`
- All beans gated by `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`

**Discovery Cluster table and full JPA stack (1c)**
- New `discovery_cluster` table via `068-discovery-cluster.sql` with columns: id (UUID PK), run_id (UUID FK to discovery_run ON DELETE CASCADE), cluster_type (TEXT NOT NULL), name (TEXT nullable), confidence (DOUBLE PRECISION NOT NULL), data (JSONB NOT NULL), formed_at (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- Indexes: run_id, (run_id, cluster_type)
- Full JPA stack (entity, DTO, repository, service, controller) following the same patterns as relationship layer
- Controller at `/api/model/projects/{projectId}/discovery/runs/{runId}/clusters` with POST (bulk), GET (list with optional `?type=` filter), GET `/count`
- Cluster DTO includes a `members` list of `ClusterMemberDto` entries so membership is managed through the cluster's bulk insert and read operations

**Discovery Cluster Member join table (1c membership)**
- New `discovery_cluster_member` table via `069-discovery-cluster-member.sql` with columns: id (UUID PK), cluster_id (UUID FK to discovery_cluster ON DELETE CASCADE), member_type (TEXT NOT NULL, values 'atom' or 'relationship'), member_id (UUID NOT NULL)
- Unique constraint on (cluster_id, member_type, member_id) to prevent duplicates
- Indexes: cluster_id, (cluster_id, member_type), member_id
- Referential integrity for member_id enforced at the application layer (service validation) because the target table varies based on member_type -- no FK constraint on member_id
- JPA entity `DiscoveryClusterMemberEntity` with no separate REST controller; members are persisted and read through the cluster service operations
- The cluster service's `bulkCreate` method persists cluster entities and their member entities together in a single transaction

**Discovery Candidate table and full JPA stack (1d)**
- New `discovery_candidate` table via `070-discovery-candidate.sql` with columns: id (UUID PK), run_id (UUID FK to discovery_run ON DELETE CASCADE), candidate_type (TEXT NOT NULL), name (TEXT NOT NULL), confidence (DOUBLE PRECISION NOT NULL), status (TEXT NOT NULL DEFAULT 'proposed'), source_cluster_ids (JSONB NOT NULL), data (JSONB NOT NULL), synthesized_at (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- Indexes: run_id, (run_id, candidate_type), (run_id, status)
- source_cluster_ids is a JSONB array of UUID strings (not a join table) because the primary query direction is "get clusters for a candidate"
- Status values: 'proposed', 'accepted', 'rejected', 'merged'
- Controller at `/api/model/projects/{projectId}/discovery/runs/{runId}/candidates` with POST (bulk), GET (list with optional `?type=` and/or `?status=` filters), GET `/count`, PUT `/{candidateId}` (update for status changes)
- Full JPA stack following the same patterns as relationship and cluster layers

**Liquibase changelog registration (067-070)**
- Append four new changeSets to `db.changelog-master.yaml` for migrations 067, 068, 069, 070
- Each follows the existing pattern: `preConditions` with `onFail: MARK_RAN`, `tableExists` (or `not: tableExists`) guard, `sqlFile` reference
- Order: 067-discovery-relationship, 068-discovery-cluster, 069-discovery-cluster-member, 070-discovery-candidate

**TypeScript type definitions for 1b, 1c, 1d layers**
- New file `discovery-service/src/types/relationship.ts`: `RelationshipType` union ('imports' | 'calls' | 'extends' | 'contains' | 'uses_data' | 'defines' | 'references'), `EvidenceRelationship` interface (id, runId, sourceAtomId, targetAtomId, relationshipType, confidence, data, inferredAt), type-specific data interfaces per relationship type
- New file `discovery-service/src/types/cluster.ts`: `ClusterType` union ('service_boundary' | 'data_domain' | 'shared_library' | 'api_layer' | 'ui_module'), `ClusterMember` interface (memberType: 'atom' | 'relationship', memberId), `EvidenceCluster` interface (id, runId, clusterType, name optional, confidence, members: ClusterMember[], data, formedAt)
- New file `discovery-service/src/types/candidate.ts`: `CandidateType` union matching meta-model element types ('application' | 'app_component' | 'service' | 'logical_entity' | 'physical_entity' | 'interface' | 'business_process' | 'data_entity'), `CandidateStatus` union ('proposed' | 'accepted' | 'rejected' | 'merged'), `DiscoveryCandidate` interface (id, runId, candidateType, name, confidence, status, sourceClusterIds, data, synthesizedAt)
- All new types exported from `discovery-service/src/types/index.ts` barrel
- JSDoc comments on each file and interface explaining the layer's purpose and data flow position (1a atoms -> 1b relationships -> 1c clusters -> 1d candidates)

**archModelClient methods for new layers**
- Add 1b methods to `archModelClient.ts`: `bulkSaveRelationships(projectId, runId, relationships)`, `getRelationshipsByRun(projectId, runId, type?)`, `getRelationshipCount(projectId, runId)` -- following the exact pattern of the existing evidence methods (URL construction, params, return types)
- Add 1c methods: `bulkSaveClusters(projectId, runId, clusters)`, `getClustersByRun(projectId, runId, type?)`, `getClusterCount(projectId, runId)`
- Add 1d methods: `bulkSaveCandidates(projectId, runId, candidates)`, `getCandidatesByRun(projectId, runId, type?, status?)`, `getCandidateCount(projectId, runId)`, `updateCandidate(projectId, runId, candidateId, update)`
- Import the new TypeScript types for method signatures

**AnalyzerResult extension for new layer outputs**
- Add optional fields to `AnalyzerResult` in `analyzerPack.ts`: `relationships?: EvidenceRelationship[]`, `clusters?: EvidenceCluster[]`, `candidates?: DiscoveryCandidate[]`
- Backward-compatible -- existing packs that only produce `evidenceAtoms` continue to work unchanged

**Run manager stub updates for 1b/1c/1d backbone readiness**
- Replace the inert stub return in `executeStep()` with dedicated `executeStep1b`, `executeStep1c`, `executeStep1d` functions
- Each follows the `executeStep1a` try/catch/update pattern: mark step running, execute, mark completed with metadata (or failed with error)
- `executeStep1b`: queries 1a atoms via `getEvidenceCount(projectId, runId)`, creates no relationships (empty backbone), returns `{ relationshipCount: 0, upstreamAtomCount: <count> }`
- `executeStep1c`: queries 1b relationships via `getRelationshipCount(projectId, runId)`, creates no clusters, returns `{ clusterCount: 0, upstreamRelationshipCount: <count> }`
- `executeStep1d`: queries 1c clusters via `getClusterCount(projectId, runId)`, creates no candidates, returns `{ candidateCount: 0, upstreamClusterCount: <count> }`
- The `stepsPayload` entries for 1b/1c/1d carry these summary count objects alongside the status (same pattern as 1a's `{ status: 'completed', atomCounts }`)

**Backward-compatible 1a alignment**
- Review `EvidenceAtom` interface and `DiscoveryEvidenceEntity` for consistency with the backbone conventions
- Add JSDoc note on `EvidenceAtomType` indicating the union is extensible and future atom types may be added
- Ensure the `type` column COMMENT in `066-discovery-evidence.sql` does not restrict valid values to only the current three types (if it does, add a new Liquibase migration to update the comment)
- Any changes to the 1a table or types must be backward-compatible (nullable new columns only)

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**Discovery Evidence JPA stack (entity, DTO, repository, service, controller)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/` under model/entity, model/dto, repository/entity, service, controller directories
- Direct structural template for all three new JPA persistence stacks: same Lombok annotations, `@Type(JsonType.class)` for JSONB, `@PrePersist` lifecycle, `@ConditionalOnProperty` gating, `@Transactional` patterns
- Controller pattern: POST bulk insert, GET list with optional query param filter, GET /count returning `Map.of("count", value)`
- Service pattern: DTO-to-entity mapping in bulkCreate, entity-to-DTO in toDto, optional filter parameter delegation to repository

**Discovery Evidence Liquibase migration (066-discovery-evidence.sql)**
- Located at `architecture-model-service/src/main/resources/db/changelog/sql/066-discovery-evidence.sql`
- Template for SQL structure: CREATE TABLE IF NOT EXISTS, FK with ON DELETE CASCADE, TIMESTAMPTZ DEFAULT NOW(), CREATE INDEX IF NOT EXISTS, COMMENT ON TABLE/COLUMN
- Changelog YAML entry pattern in `db.changelog-master.yaml`: preConditions with `not: tableExists`, sqlFile reference, splitStatements/stripComments flags

**Discovery-service TypeScript types (evidenceAtom.ts)**
- Located at `discovery-service/src/types/evidenceAtom.ts`
- Pattern: union type for the type discriminator, per-type data interfaces, union of data types, core interface with id/runId/type/data/timestamp
- JSDoc documentation style to replicate

**Discovery-service archModelClient (archModelClient.ts)**
- Located at `discovery-service/src/services/archModelClient.ts`
- Pattern for HTTP client methods: URL construction with `encodeURIComponent`, optional query params object, typed return values
- `bulkSaveEvidence`, `getEvidenceByRun`, `getEvidenceCount` are the direct templates for new layer methods

**Discovery-service run manager (runManager.ts)**
- Located at `discovery-service/src/services/runManager.ts`
- `executeStep1a` function is the template for new step functions: fetch upstream data, persist results, return summary metadata
- `startRun` loop with stepsPayload status tracking pattern (mark running, execute, mark completed with metadata or failed with error)

## Out of Scope
- Real relationship inference logic (1b analysis algorithms) -- deferred to a later increment
- Real cluster formation logic (1c analysis algorithms) -- deferred to a later increment
- Real candidate synthesis logic (1d analysis algorithms) -- deferred to a later increment
- LLM integration for inference, clustering, or scoring
- Frontend UI for browsing evidence layers, relationships, clusters, or candidates
- Frontend UI for candidate review/accept/reject workflow
- Gateway proxy routes for the new evidence layer endpoints
- MCP tool wiring for the new endpoints
- WebSocket or streaming progress for evidence layer processing
- Performance optimization such as pagination or streaming bulk inserts
- Phase 2+ pipeline stages
- Authentication or authorization on new endpoints
- Changes to the discovery_config or discovery_run table schemas (beyond stepsPayload metadata content)
- Modification to the Phase 1a analyzer pack or extractors (beyond the AnalyzerResult type extension)
