# Spec Requirements: Phase 0 Persistence Contract

## Initial Description
Increment 2 of 16 for the legacy/current-state discovery capability. Increment 1 (already implemented) created the discovery-service skeleton at `discovery-service/`. This increment defines the persistence contract for Phase 0 outputs -- the data structures, database tables, API endpoints, and save tool(s) needed to persist the results of Phase 0 (discovery framing/setup) so that downstream pipeline stages and the frontend can consume them.

## Requirements Discussion

### First Round Questions

**Q1:** I assume Phase 0 outputs represent the "discovery framing/setup" results -- things like the project context that was captured (repo URL, tech stack hints, folder structure summary, or similar framing metadata). Could you describe the specific data elements that Phase 0 produces? For example, is it a structured JSON document capturing the project's technology landscape, a set of key-value findings, or something else entirely?
**Answer:** Yes -- treat the structured config as a machine-readable JSON-style document covering repo scope, repo-to-application mapping, tech hints, exclusions, and notes/ambiguities.

**Q2:** For the persistence target, I see two viable patterns in the codebase: (A) a new table in the architecture-model-service PostgreSQL database with a JPA entity, repository, controller, DTO, mapper, and Liquibase migration (following the `ProjectArtifactEntity` or `TemporaryDiagramEntity` pattern); or (B) storing the Phase 0 output as a versioned `project_artifact` with a new artifact type (e.g., `DISCOVERY_PHASE0`), reusing the existing `ProjectArtifactEntity` infrastructure. I'm leaning toward option A (a dedicated `discovery_findings` or `discovery_phase0_output` table) since the data structure is likely specific to discovery. Which approach do you prefer?
**Answer:** Use a dedicated persistence shape for the structured config; the markdown discovery brief can use the normal artifact-style pattern separately.

**Q3:** For the save mechanism, I assume this will follow the existing MCP save tool pattern: a new route in `mcp-server/` (e.g., `POST /mcp/tools/save_discovery_phase0`) that validates input, then calls the architecture-model-service REST API to persist. Alternatively, the discovery-service itself could call the architecture-model-service directly (it already has `ARCHITECTURE_MODEL_SERVICE_BASE_URL` configured as a placeholder). Which service should own the save logic -- the MCP server (consistent with all existing save tools) or the discovery-service (keeping discovery logic co-located)?
**Answer:** Keep MCP as the controlled save boundary; do not have the discovery service write directly to the architecture backend.

**Q4:** I assume the Phase 0 output should be scoped to a project via `projectId` (UUID FK to `project.id`), consistent with `WorkItemEntity`, `TemporaryDiagramEntity`, and `ProjectArtifactEntity`. Should there be upsert semantics (one Phase 0 output per project, overwritten on re-run) like `TemporaryDiagramEntity`, or versioned/append semantics (multiple revisions kept) like `ProjectArtifactEntity`?
**Answer:** Use one-per-project upsert semantics for the structured config, but keep the markdown discovery brief as a durable artifact in the normal artifact style.

**Q5:** Should the persistence include a status/lifecycle field (e.g., `IN_PROGRESS`, `COMPLETE`, `FAILED`) so that the frontend or downstream pipeline stages can check whether Phase 0 has been completed for a project? Or is the mere existence of a record sufficient to indicate completion?
**Answer:** Yes -- include a simple status/lifecycle field so later phases can explicitly tell whether Phase 0 is complete.

**Q6:** The Increment 1 skeleton defined `AnalyzerResult` with `findings: AnalyzerFinding[]` and `metadata: Record<string, unknown>`. I assume the Phase 0 persistence contract should be able to store these `AnalyzerResult` outputs. Should the DB schema store the full `AnalyzerResult` as a JSONB blob (like `TemporaryDiagramEntity.diagram_payload`), or should findings be normalized into individual rows?
**Answer:** Do not store full AnalyzerResult-style findings here; Phase 0 config should stay as framing/configuration, not a generic findings blob.

**Q7:** Should this increment also include a read/retrieval API (e.g., `GET /api/model/projects/{projectId}/discovery/phase0`) so that Phase 1 pipeline stages and the frontend can consume the persisted Phase 0 output? Or is the read API a separate increment?
**Answer:** Yes -- include a simple retrieval path now so later Phase 1 work can consume Phase 0 outputs cleanly.

**Q8:** Is there anything that should be explicitly excluded from this increment? For example: gateway proxy routing to the new endpoints, frontend UI for viewing Phase 0 results, Phase 1 persistence, or the actual Phase 0 pipeline logic that produces the data to be saved?
**Answer:** Exclude version-history complexity, normalized findings rows, discovery-run state, and any attempt to mix Phase 0 framing data into canonical architecture entities beyond the agreed anchors.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: TemporaryDiagramEntity -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/TemporaryDiagramEntity.java` -- JSONB payload scoped to project with upsert semantics via composite unique index on (project_id, temporary_diagram_id). Closest structural match for the discovery config table (one-per-project upsert, JSONB payload).
- Feature: Temporary Diagrams Liquibase migration -- Path: `architecture-model-service/src/main/resources/db/changelog/sql/054-temporary-diagrams.sql` -- Template for the new discovery config table migration (UUID PK, project_id FK with ON DELETE CASCADE, JSONB column, created_at/updated_at timestamps, unique composite index).
- Feature: ProjectArtifactEntity -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectArtifactEntity.java` -- Versioned content scoped to project with artifact_type discrimination and revision tracking. Pattern to follow for the markdown discovery brief persistence.
- Feature: ProjectArtifactController -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectArtifactController.java` -- REST controller pattern for CRUD operations scoped under `/api/model/projects/{projectId}/...` with @ConditionalOnProperty for feature flagging.
- Feature: ProjectArtifactService -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectArtifactService.java` -- Service layer with @Transactional, allowed-type validation, auto-revision calculation. Template for the discovery config service.
- Feature: ProjectArtifactRepository -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ProjectArtifactRepository.java` -- Spring Data JPA repository with custom finder methods (findFirstBy...OrderByRevisionDesc, findByProjectId...).
- Feature: Save Temporary Architecture Diagram MCP route -- Path: `mcp-server/src/routes/saveTemporaryArchitectureDiagramRoute.ts` -- MCP save tool pattern: validate sessionId/projectId/JSON, delegate to service, return result.
- Feature: Temporary Architecture Diagram Service -- Path: `mcp-server/src/services/temporaryArchitectureDiagramService.ts` -- Parse-validate-persist service: size check, JSON.parse, structural validation, project existence check via archModelClient, persist via archModelClient, return result.
- Feature: archModelClient -- Path: `mcp-server/src/services/archModelClient.ts` -- HTTP client for the architecture-model-service; contains getProjectById, saveTemporaryDiagram, and similar methods. New save/get methods for discovery config will be added here.
- Feature: Discovery service types -- Path: `discovery-service/src/types/analyzerPack.ts` -- Defines AnalyzerResult, AnalyzerFinding, AnalyzerInput, AnalyzerPack interfaces. Phase 0 config is explicitly NOT the AnalyzerResult shape, but these types inform what Phase 0 is distinct from.
- Feature: Discovery project context types -- Path: `discovery-service/src/types/projectContext.ts` -- Defines DiscoveryProjectContext (projectId, projectFolderPath, repoUrl) and DiscoveryRequest. The Phase 0 config shape will extend/supersede this basic context.
- Feature: Liquibase changelog master -- Path: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` -- The new migration needs to be appended here following the established pattern (next ID would be 064-xxx). Uses preConditions with onFail: MARK_RAN.

### Follow-up Questions
No follow-up questions were needed. All answers were clear, specific, and internally consistent.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Two distinct persistence shapes for Phase 0:**

1. **Discovery Config (structured JSON) -- dedicated table with upsert semantics:**
   - A new `discovery_config` table in the architecture-model-service PostgreSQL database
   - Scoped to a project via `project_id` (UUID FK to `project.id`, ON DELETE CASCADE)
   - One record per project (upsert on re-run, not versioned)
   - Stores a machine-readable JSONB document covering: repo scope, repo-to-application mapping, tech hints, exclusions, and notes/ambiguities
   - Includes a status/lifecycle field (e.g., `DRAFT`, `COMPLETE`) so downstream phases can check Phase 0 completion
   - UUID primary key, created_at/updated_at timestamps
   - Full JPA persistence stack: Entity, DTO, Repository, Service, Controller, Mapper, Liquibase migration

2. **Discovery Brief (markdown) -- existing project_artifact pattern:**
   - Stored as a `ProjectArtifact` with a new artifact type (e.g., `DISCOVERY_BRIEF_MD`)
   - Uses the existing versioned/append semantics with auto-incrementing revision numbers
   - Persisted via the existing `ProjectArtifactController` / `ProjectArtifactService` infrastructure
   - The artifact_type allowlist in `ProjectArtifactService` needs to be extended to include the new type

**Architecture-model-service REST API (Discovery Config):**
- `PUT /api/model/projects/{projectId}/discovery/config` -- upsert the Phase 0 structured config (create or overwrite)
- `GET /api/model/projects/{projectId}/discovery/config` -- retrieve the current Phase 0 config for a project
- Controller follows the `@ConditionalOnProperty` pattern for feature flagging
- Standard validation: projectId must be valid UUID, request body must contain required fields
- 404 on GET if no config exists for the project

**MCP Save Tool (discovery config):**
- New route in `mcp-server/`: `POST /mcp/tools/save_discovery_config`
- Accepts `sessionId`, `projectId`, and `discoveryConfigJson` (stringified JSON)
- Validates input (sessionId non-empty, projectId UUID, discoveryConfigJson non-empty valid JSON)
- Validates project existence via `archModelClient.getProjectById`
- Persists via new `archModelClient` method that calls the architecture-model-service REST API
- Returns success response with projectId and status

**MCP Save Tool (discovery brief markdown):**
- Uses the existing `save_markdown_artifact` MCP tool or creates a minimal new route that delegates to the existing `ProjectArtifact` API with the new artifact type
- Alternatively, if the LLM produces the brief, it can call the existing artifact creation endpoint directly through a new MCP tool or by extending the existing `saveProductArtifacts` pattern

**Discovery Config JSONB Schema (the structured payload):**
- `repos`: array of repo scope entries (URL, branch, paths to include/exclude)
- `repo_application_mappings`: array mapping repos/paths to architecture-model application names
- `tech_hints`: array of technology hints (language, framework, build tool per repo/path)
- `exclusions`: array of paths/patterns to exclude from analysis
- `notes`: array of free-text notes capturing ambiguities or special considerations
- The exact schema is flexible (stored as JSONB), but the above fields represent the expected top-level structure

### Reusability Opportunities
- `TemporaryDiagramEntity` pattern for the dedicated discovery_config table (JSONB payload, project-scoped, upsert via unique composite index)
- `ProjectArtifactEntity` / `ProjectArtifactService` infrastructure for the discovery brief markdown (extend artifact_type allowlist)
- `mcp-server/src/routes/saveTemporaryArchitectureDiagramRoute.ts` as template for the new MCP save route
- `mcp-server/src/services/temporaryArchitectureDiagramService.ts` as template for the parse-validate-persist service
- `mcp-server/src/services/archModelClient.ts` for adding new save/get methods
- `architecture-model-service/src/main/resources/db/changelog/sql/054-temporary-diagrams.sql` as template for the Liquibase migration
- `ProjectArtifactController` REST endpoint pattern for the new discovery config controller

### Scope Boundaries

**In Scope:**
- New `discovery_config` table with Liquibase migration (next changeset ID after 063)
- JPA Entity, DTO (Java record), Repository, Service, Controller, Mapper for discovery config
- Status/lifecycle field on the discovery config record (e.g., DRAFT, COMPLETE)
- REST API: PUT (upsert) and GET (retrieve) for discovery config, scoped under `/api/model/projects/{projectId}/discovery/config`
- New MCP save tool route and service in `mcp-server/` for persisting discovery config
- New methods on `archModelClient` for save and get of discovery config
- Extension of `ProjectArtifactService` allowed artifact types to include the discovery brief markdown type
- TypeScript type definitions for the discovery config save request/response in `mcp-server/src/types/`
- Unit tests for the new MCP route, service, and archModelClient methods (Jest in mcp-server)
- Unit tests for the new JPA service and controller (JUnit 5 in architecture-model-service)
- Gateway tool wiring: registering the new MCP tool name in `ALLOWED_TOOL_NAMES` and `TOOL_ENDPOINTS` so the LLM can invoke the save tool

**Out of Scope:**
- Version history / revision tracking for the structured config (upsert only, not versioned)
- Normalized findings rows (Phase 0 config is framing/configuration, not findings)
- Discovery-run state tracking (no run history, no run-level status beyond the config lifecycle field)
- Mixing Phase 0 framing data into canonical architecture entities (applications, services, etc.) beyond agreed anchor references
- Frontend UI for viewing or editing Phase 0 results
- Phase 1 persistence contract (separate increment)
- Actual Phase 0 pipeline logic that produces the data (separate increment)
- Gateway proxy routing to the discovery-service endpoints (the discovery service does not own persistence)
- Discovery-service writing directly to the architecture-model-service (MCP is the save boundary)
- Authentication/authorization on the new endpoints
- WebSocket/streaming support

### Technical Considerations
- The Liquibase migration should be the next sequential changeset after 063 (i.e., 064-discovery-config.sql) in `db.changelog-master.yaml`
- The discovery_config table should use a unique index on `project_id` to enforce one-per-project upsert semantics (simpler than the composite key pattern in temporary_diagrams since there is no secondary identifier)
- The JSONB column should be typed as `Map<String, Object>` in the JPA entity with `@Type(JsonType.class)` from hypersistence-utils, consistent with `TemporaryDiagramEntity.diagramPayload` and `WorkItemEntity.tagsJson`
- The controller should use `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` consistent with all existing DB-dependent controllers
- The MCP save tool should follow the parse-validate-persist pattern from `temporaryArchitectureDiagramService.ts`: size check, JSON.parse, structural validation, project existence check, persist, return result
- The archModelClient methods should follow the existing Axios-based HTTP client pattern
- The discovery brief markdown can reuse the existing `ProjectArtifact` infrastructure by adding a new allowed artifact type string (e.g., `DISCOVERY_BRIEF_MD`) to the `ALLOWED_ARTIFACT_TYPES` set in `ProjectArtifactService`
- Status field values should be a simple enum-style TEXT column (e.g., `DRAFT`, `COMPLETE`) validated in the service layer, not enforced as a DB CHECK constraint, consistent with how `WorkItemEntity.status` and `ProjectArtifactEntity.source` are handled
