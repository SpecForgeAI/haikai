# Specification: Phase 0 Persistence Contract

## Goal
Define and implement the canonical persistence contract for Phase 0 discovery framing outputs -- a dedicated discovery config table (structured JSONB with upsert semantics), a discovery brief markdown artifact (via existing ProjectArtifact infrastructure), and an MCP save tool -- so that later increments can durably persist and retrieve Phase 0 results through the platform's established patterns.

## User Stories
- As a downstream pipeline stage (Phase 1), I want to retrieve the structured discovery config and brief artifact for a project so that I can consume Phase 0 framing outputs without redesigning the persistence model.
- As the discovery conversation orchestrator (future Increment 3), I want an MCP save tool that persists Phase 0 discovery config through the controlled write boundary so that assistant-driven saves follow the platform's canonical pattern.

## Specific Requirements

**Discovery Config Liquibase Migration (064-discovery-config.sql)**
- Create a `discovery_config` table: UUID PK (`id`), `project_id` UUID NOT NULL FK to `project(id)` ON DELETE CASCADE, `config_payload` JSONB NOT NULL, `status` TEXT NOT NULL DEFAULT 'DRAFT', `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW(), `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- Create a UNIQUE index on `project_id` to enforce one-per-project upsert semantics (simpler than temporary_diagrams composite key since there is no secondary identifier)
- Create a standard index on `project_id` for efficient lookups
- Add table and column comments following the `054-temporary-diagrams.sql` pattern
- Append the changeset to `db.changelog-master.yaml` as ID `064-discovery-config` with `preConditions: onFail: MARK_RAN` and `tableExists` precondition check, following the established YAML structure

**DiscoveryConfigEntity (JPA Entity)**
- Follow the `TemporaryDiagramEntity` pattern: `@Entity`, `@Table(name = "discovery_config")`, Lombok `@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`
- Fields: `UUID id` (PK), `UUID projectId`, `Map<String, Object> configPayload` with `@Type(JsonType.class)` and `columnDefinition = "jsonb"`, `String status` defaulting to `"DRAFT"`, `Instant createdAt`, `Instant updatedAt`
- Include `@PrePersist` and `@PreUpdate` lifecycle callbacks for timestamps, matching `TemporaryDiagramEntity`
- Declare the unique index on `project_id` via `@Table(indexes = { ... })` annotation

**DiscoveryConfigDto (Java Record)**
- Follow the `TemporaryDiagramDto` record pattern with `@JsonProperty` snake_case annotations
- Fields: `UUID id`, `UUID projectId` (`project_id`), `Map<String, Object> configPayload` (`config_payload`), `String status`, `String createdAt` (`created_at`), `String updatedAt` (`updated_at`)

**DiscoveryConfigRepository (Spring Data JPA)**
- Extend `JpaRepository<DiscoveryConfigEntity, UUID>` following the `TemporaryDiagramRepository` pattern
- Add `Optional<DiscoveryConfigEntity> findByProjectId(UUID projectId)` for the one-per-project lookup

**DiscoveryConfigService (Java Service)**
- Follow the `TemporaryDiagramService` pattern: `@Service`, `@ConditionalOnProperty`, `@RequiredArgsConstructor`, `@Slf4j`
- `upsertConfig(UUID projectId, Map<String, Object> configPayload, String status)`: find existing by `projectId`, update payload/status if found, create new if not; return DTO
- `getConfig(UUID projectId)`: return DTO or null if not found
- Validate status against allowed values (`DRAFT`, `COMPLETE`) in the service layer, not as a DB CHECK constraint, consistent with `WorkItemEntity.status` approach
- Include a private `toDto()` conversion method matching `TemporaryDiagramService`

**DiscoveryConfigController (REST Controller)**
- Follow the `TemporaryDiagramController` pattern: `@RestController`, `@ConditionalOnProperty`, `@RequestMapping("/api/model/projects/{projectId}/discovery/config")`
- `PUT /api/model/projects/{projectId}/discovery/config` -- upsert; accepts a request body record with `config_payload` (Map) and `status` (String); returns the saved `DiscoveryConfigDto` with 200 OK
- `GET /api/model/projects/{projectId}/discovery/config` -- retrieve; returns `DiscoveryConfigDto` with 200 OK, or 404 Not Found if no config exists
- Define a `SaveDiscoveryConfigRequest` inner record (like `TemporaryDiagramController.SaveTemporaryDiagramRequest`) with `@JsonProperty` for snake_case binding

**Discovery Brief Artifact (ProjectArtifact Extension)**
- Add `"DISCOVERY_BRIEF_MD"` to the `ALLOWED_ARTIFACT_TYPES` set in `ProjectArtifactService`
- No new entity/table/controller needed -- the existing `ProjectArtifactController` POST endpoint at `/api/model/projects/{projectId}/artifacts/DISCOVERY_BRIEF_MD` handles creation with auto-incrementing revision
- The brief is persisted as versioned markdown content through the existing artifact infrastructure

**MCP Save Tool: save_discovery_config**
- New route file `mcp-server/src/routes/saveDiscoveryConfigRoute.ts` following the `saveTemporaryArchitectureDiagramRoute.ts` pattern
- New service file `mcp-server/src/services/discoveryConfigService.ts` following the `temporaryArchitectureDiagramService.ts` parse-validate-persist pattern
- New type file `mcp-server/src/types/saveDiscoveryConfig.ts` defining `SaveDiscoveryConfigRequest` (sessionId, projectId, discoveryConfigJson) and `SaveDiscoveryConfigResult` (projectId, status)
- Route validation: sessionId non-empty, projectId valid UUID, discoveryConfigJson non-empty string
- Service logic: validate payload size (500KB limit), JSON.parse the config string, validate project existence via `archModelClient.getProjectById`, persist via new `archModelClient.saveDiscoveryConfig` method, return result
- Mount in `mcp-server/src/routes/tools.ts` at `/save_discovery_config`
- Export types from `mcp-server/src/types/index.ts`

**archModelClient Extensions**
- Add `saveDiscoveryConfig(projectId: string, configPayload: object, status: string): Promise<DiscoveryConfigResponseDto>` that calls `PUT /api/model/projects/{projectId}/discovery/config` with `{ config_payload, status }`
- Add `getDiscoveryConfig(projectId: string): Promise<DiscoveryConfigResponseDto | null>` that calls `GET /api/model/projects/{projectId}/discovery/config`, returning null on 404
- Define `DiscoveryConfigResponseDto` interface in `archModelClient.ts` following the `TemporaryDiagramResponseDto` pattern
- Add `createProjectArtifact(projectId: string, artifactType: string, content: string, source: string): Promise<any>` for programmatic artifact creation (discovery brief)

**Gateway Tool Registration**
- Add `'save_discovery_config'` to the `ToolName` union type in `gateway/src/types/tools.ts`
- Add to `ALLOWED_TOOL_NAMES` array, `TOOL_ENDPOINTS` map (`/mcp/tools/save_discovery_config`), and `TOOL_REQUIRED_PARAMS` map (`['projectId', 'discoveryConfigJson']`)
- Add `SaveDiscoveryConfigParams` interface with `projectId` and `discoveryConfigJson` fields
- Add to the `ToolParams` union type
- Add a `TOOL_DEFINITIONS` entry with parameter schema describing both fields

**Discovery Config JSONB Payload Shape**
- The `config_payload` JSONB column stores a machine-readable JSON document; the schema is flexible but the expected top-level keys are: `repos` (array of repo scope entries with url, branch, includePaths, excludePaths), `repoApplicationMappings` (array mapping repos/paths to application names), `techHints` (array of technology hints per repo/path), `exclusions` (array of paths/patterns to exclude), `notes` (array of free-text notes/ambiguities)
- Structural validation in the MCP service should check that the parsed JSON is a non-null object; individual field validation is intentionally light in this increment to allow schema evolution

**Anchor Entity Save Path**
- Applications and app_components are persisted through existing canonical architecture model paths (the existing `save_architecture_baseline` MCP tool and the model PUT API) -- no new persistence path needed
- Phase 0 does NOT create duplicate anchor objects; it uses the same canonical model entities that already exist in the platform

## Visual Design
No visual assets provided for this increment.

## Existing Code to Leverage

**TemporaryDiagramEntity / Controller / Service / Repository / DTO**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/` under `model/entity/`, `controller/`, `service/`, `repository/entity/`, `model/dto/`
- Closest structural match for the new discovery config persistence stack: JSONB payload, project-scoped, upsert semantics, `@ConditionalOnProperty`, Lombok builder pattern
- The `TemporaryDiagramService.saveDiagram()` find-or-create upsert pattern should be replicated for `DiscoveryConfigService.upsertConfig()` (simplified since there is no secondary ID -- just `findByProjectId`)

**054-temporary-diagrams.sql Liquibase Migration**
- Located at `architecture-model-service/src/main/resources/db/changelog/sql/054-temporary-diagrams.sql`
- Template for the new `064-discovery-config.sql`: CREATE TABLE IF NOT EXISTS, UUID PK, project_id FK with ON DELETE CASCADE, JSONB column, timestamps, unique index, table/column comments
- The `db.changelog-master.yaml` entry follows the same `preConditions / onFail: MARK_RAN / not: tableExists` guard pattern

**ProjectArtifactService ALLOWED_ARTIFACT_TYPES**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectArtifactService.java`
- The `ALLOWED_ARTIFACT_TYPES` Set (currently `MISSION_MD`, `ROADMAP_MD`, `BACKLOG_MD`) needs `DISCOVERY_BRIEF_MD` added to enable the discovery brief artifact without any new entity or controller code
- All existing create/get/delete endpoints for artifacts will work for the new type automatically

**saveTemporaryArchitectureDiagramRoute.ts / temporaryArchitectureDiagramService.ts**
- Located at `mcp-server/src/routes/` and `mcp-server/src/services/`
- Template for the new MCP save route and service: request validation pattern (sessionId, projectId UUID, JSON string), parse-validate-persist flow, error code handling (400/502), archModelClient delegation
- The service payload size check (500KB), JSON.parse with error wrapping, and project existence verification should be replicated

**Gateway tool registration in tools.ts and toolExecutor.ts**
- Located at `gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts`
- The pattern for registering a new tool requires changes in four places: `ToolName` union, `ALLOWED_TOOL_NAMES` array, `TOOL_ENDPOINTS` map, `TOOL_REQUIRED_PARAMS` map, plus a params interface and a `TOOL_DEFINITIONS` entry
- Follow the `saveTemporaryArchitectureDiagram` registration as the closest template

## Out of Scope
- Version history or revision tracking for the structured discovery config (upsert-only, not versioned)
- Normalized findings rows or AnalyzerResult-style storage (Phase 0 is framing/configuration, not findings)
- Discovery-run state tracking (no run history, no run-level status beyond the config lifecycle field)
- Mixing Phase 0 framing data into canonical architecture meta-model entities beyond the agreed anchor references (applications, app_components)
- Frontend UI for viewing or editing Phase 0 results
- Phase 1 persistence contract (separate increment)
- Actual Phase 0 pipeline logic or conversation flow that produces the data (separate increment)
- Gateway proxy routing to the discovery-service endpoints (the discovery service does not own persistence)
- Discovery-service writing directly to the architecture-model-service (MCP is the save boundary)
- Authentication or authorization on the new endpoints
