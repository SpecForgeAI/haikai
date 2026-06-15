# Task Breakdown: Phase 0 Persistence Contract

## Overview
Total Tasks: 7 Task Groups, 44 sub-tasks

This is Increment 2 of 16 for the legacy/current-state discovery capability. It defines the persistence contract for Phase 0 discovery framing outputs: a dedicated `discovery_config` table (structured JSONB with upsert semantics), a discovery brief markdown artifact (via existing ProjectArtifact infrastructure), and an MCP save tool.

## Task List

### Database Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete Liquibase migration for discovery_config table
  - [x] 1.1 Create `architecture-model-service/src/main/resources/db/changelog/sql/064-discovery-config.sql`
    - Follow `054-temporary-diagrams.sql` as template
    - `CREATE TABLE IF NOT EXISTS discovery_config` with columns:
      - `id UUID PRIMARY KEY`
      - `project_id UUID NOT NULL` with FK to `project(id) ON DELETE CASCADE`
      - `config_payload JSONB NOT NULL`
      - `status TEXT NOT NULL DEFAULT 'DRAFT'`
      - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
      - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_config_project_id ON discovery_config (project_id)` for one-per-project upsert
    - `CREATE INDEX IF NOT EXISTS idx_discovery_config_project_id_lookup ON discovery_config (project_id)` (note: unique index already covers lookups, but include for consistency with the established pattern if desired -- or skip the redundant non-unique index since the unique index serves lookups)
    - Add `COMMENT ON TABLE` and `COMMENT ON COLUMN` for `config_payload` and `status` following the `054-temporary-diagrams.sql` comment pattern
  - [x] 1.2 Append changeset entry to `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Changeset ID: `064-discovery-config`
    - Author: `architecture-tool`
    - `preConditions: onFail: MARK_RAN`, `onError: HALT`, `not: tableExists: tableName: discovery_config`
    - `sqlFile: path: db/changelog/sql/064-discovery-config.sql` with `relativeToChangelogFile: false`, `splitStatements: true`, `stripComments: true`
    - Add a YAML comment block above: `# Discovery Config Table` / `# Spec: Phase 0 Persistence Contract (Increment 2)` / `# Stores structured JSONB discovery config with one-per-project upsert semantics.`
  - [x] 1.3 Verify migration file is well-formed SQL
    - Confirm all `IF NOT EXISTS` guards are present
    - Confirm FK constraint name follows pattern: `fk_discovery_config_project`
    - Confirm index names are descriptive and unique

**Acceptance Criteria:**
- SQL file is syntactically valid with proper IF NOT EXISTS guards
- YAML changeset follows the exact indentation and structure of existing entries (054-temporary-diagrams)
- Precondition uses `not: tableExists` to make migration idempotent

---

#### Task Group 2: JPA Entity, DTO, and Repository
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA persistence stack for discovery_config
  - [x] 2.1 Create `DiscoveryConfigEntity.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryConfigEntity.java`
    - Follow `TemporaryDiagramEntity.java` pattern exactly
    - Annotations: `@Entity`, `@Table(name = "discovery_config", indexes = { @Index(name = "idx_discovery_config_project_id", columnList = "project_id", unique = true) })`, `@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`
    - Fields:
      - `@Id @Column(name = "id", nullable = false) UUID id`
      - `@Column(name = "project_id", nullable = false) UUID projectId`
      - `@Type(JsonType.class) @Column(name = "config_payload", columnDefinition = "jsonb", nullable = false) @Builder.Default Map<String, Object> configPayload = new HashMap<>()`
      - `@Column(name = "status", nullable = false) @Builder.Default String status = "DRAFT"`
      - `@Column(name = "created_at", nullable = false, updatable = false) @Builder.Default Instant createdAt = Instant.now()`
      - `@Column(name = "updated_at", nullable = false) @Builder.Default Instant updatedAt = Instant.now()`
    - `@PrePersist` and `@PreUpdate` lifecycle callbacks matching `TemporaryDiagramEntity`
    - Import `io.hypersistence.utils.hibernate.type.json.JsonType` and `org.hibernate.annotations.Type`
  - [x] 2.2 Create `DiscoveryConfigDto.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryConfigDto.java`
    - Follow `TemporaryDiagramDto.java` record pattern
    - Java record with `@JsonProperty` snake_case annotations:
      - `UUID id`
      - `@JsonProperty("project_id") UUID projectId`
      - `@JsonProperty("config_payload") Map<String, Object> configPayload`
      - `String status`
      - `@JsonProperty("created_at") String createdAt`
      - `@JsonProperty("updated_at") String updatedAt`
  - [x] 2.3 Create `DiscoveryConfigRepository.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryConfigRepository.java`
    - Follow `TemporaryDiagramRepository.java` pattern
    - `@Repository` interface extending `JpaRepository<DiscoveryConfigEntity, UUID>`
    - Add `Optional<DiscoveryConfigEntity> findByProjectId(UUID projectId)` (simpler than TemporaryDiagram since there is no secondary ID -- just one record per project)

**Acceptance Criteria:**
- Entity compiles with correct JPA annotations and Hypersistence JSONB type
- DTO is a Java record with snake_case JSON serialization
- Repository interface provides `findByProjectId` for upsert lookups

---

#### Task Group 3: Service and Controller
**Dependencies:** Task Group 2

- [x] 3.0 Complete service and controller for discovery config
  - [x] 3.1 Write 4 focused unit tests for `DiscoveryConfigService` at `architecture-model-service/src/test/java/com/example/architecturemodel/service/DiscoveryConfigServiceTest.java`
    - Follow `TemporaryDiagramServiceTest.java` pattern: `@ExtendWith(MockitoExtension.class)`, `@Mock` repository, service instantiation in `@BeforeEach`
    - Test 1: `upsertConfig_createsNewEntity_whenNoneExists` -- verifies new entity creation when `findByProjectId` returns empty
    - Test 2: `upsertConfig_updatesExistingEntity_whenAlreadyExists` -- verifies payload/status update preserving entity ID and createdAt
    - Test 3: `getConfig_returnsDto_whenEntityExists` -- verifies DTO field mapping
    - Test 4: `getConfig_returnsNull_whenNoEntityExists` -- verifies null return on empty Optional
  - [x] 3.2 Create `DiscoveryConfigService.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryConfigService.java`
    - Follow `TemporaryDiagramService.java` pattern: `@Service`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`, `@RequiredArgsConstructor`, `@Slf4j`
    - `@Transactional public DiscoveryConfigDto upsertConfig(UUID projectId, Map<String, Object> configPayload, String status)`:
      - Validate status against allowed values (`DRAFT`, `COMPLETE`) -- throw `IllegalArgumentException` if invalid (matches `WorkItemEntity.status` validation-in-service approach)
      - `repository.findByProjectId(projectId).orElseGet(() -> DiscoveryConfigEntity.builder().id(UUID.randomUUID()).projectId(projectId).build())`
      - Set `configPayload` and `status` on entity, then `repository.save(entity)`
      - Return `toDto(saved)`
    - `@Transactional(readOnly = true) public DiscoveryConfigDto getConfig(UUID projectId)`:
      - `repository.findByProjectId(projectId).map(this::toDto).orElse(null)`
    - Private `toDto(DiscoveryConfigEntity entity)` method returning `new DiscoveryConfigDto(...)` with `entity.getCreatedAt().toString()` and `entity.getUpdatedAt().toString()`
  - [x] 3.3 Write 3 focused unit tests for `DiscoveryConfigController` at `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryConfigControllerTest.java`
    - Follow `TemporaryDiagramControllerTest.java` pattern: `@WebMvcTest(DiscoveryConfigController.class)`, `@MockBean DiscoveryConfigService`
    - Test 5: `putConfig_returns200WithDto_onSuccess` -- PUT with valid body returns DTO
    - Test 6: `getConfig_returns404_whenNotFound` -- GET returns 404 when service returns null
    - Test 7: `getConfig_returns200WithDto_whenExists` -- GET returns DTO when config exists
  - [x] 3.4 Create `DiscoveryConfigController.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryConfigController.java`
    - Follow `TemporaryDiagramController.java` pattern: `@RestController`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`, `@RequiredArgsConstructor`, `@Slf4j`
    - `@RequestMapping("/api/model/projects/{projectId}/discovery/config")` (note: spec says `/api/model/projects/...`)
    - `@PutMapping` method: accepts `@PathVariable UUID projectId`, `@RequestBody SaveDiscoveryConfigRequest request`; calls `service.upsertConfig(projectId, request.configPayload(), request.status())`; returns `ResponseEntity.ok(dto)`
    - `@GetMapping` method: accepts `@PathVariable UUID projectId`; calls `service.getConfig(projectId)`; returns `ResponseEntity.ok(dto)` or `ResponseEntity.notFound().build()` if null
    - Inner record `SaveDiscoveryConfigRequest` with `@JsonProperty("config_payload") Map<String, Object> configPayload` and `@JsonProperty("status") String status`
  - [x] 3.5 Add `upsertConfig_rejectsInvalidStatus` test to `DiscoveryConfigServiceTest`
    - Test 8: Verify `IllegalArgumentException` when status is not `DRAFT` or `COMPLETE`
  - [x] 3.6 Run service and controller tests
    - Run ONLY `DiscoveryConfigServiceTest` and `DiscoveryConfigControllerTest`
    - Verify all 8 tests pass

**Acceptance Criteria:**
- All 8 Java tests pass (4 service + 3 controller + 1 status validation)
- Upsert semantics work correctly (create new / update existing)
- GET returns 404 when no config exists
- Invalid status values are rejected at the service layer

---

### Discovery Brief Artifact Extension

#### Task Group 4: ProjectArtifactService Allowlist Extension
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Extend ProjectArtifactService to support DISCOVERY_BRIEF_MD
  - [x] 4.1 Add `"DISCOVERY_BRIEF_MD"` to the `ALLOWED_ARTIFACT_TYPES` Set in `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectArtifactService.java`
    - Current set: `Set.of("MISSION_MD", "ROADMAP_MD", "BACKLOG_MD")`
    - New set: `Set.of("MISSION_MD", "ROADMAP_MD", "BACKLOG_MD", "DISCOVERY_BRIEF_MD")`
    - No new entity, table, controller, or DTO needed -- existing `ProjectArtifactController` POST endpoint at `/api/model/projects/{projectId}/artifacts/DISCOVERY_BRIEF_MD` will handle creation automatically

**Acceptance Criteria:**
- `DISCOVERY_BRIEF_MD` is accepted by `validateArtifactType()` without exception
- Existing artifact types continue to work unchanged
- No new files created -- single line change

---

### MCP Server Layer

#### Task Group 5: MCP Save Tool and archModelClient Methods
**Dependencies:** Task Groups 3 and 4 (REST endpoints must exist)

- [x] 5.0 Complete MCP save tool for discovery config
  - [x] 5.1 Create type definitions at `mcp-server/src/types/saveDiscoveryConfig.ts`
    - Follow `saveTemporaryArchitectureDiagram.ts` pattern exactly
    - `SaveDiscoveryConfigRequest` interface: `sessionId: string`, `projectId: string`, `discoveryConfigJson: string`
    - `SaveDiscoveryConfigResult` interface: `projectId: string`, `status: string` (the config lifecycle status, e.g., "DRAFT" or "COMPLETE")
  - [x] 5.2 Export types from `mcp-server/src/types/index.ts`
    - Add `export * from './saveDiscoveryConfig';` section with comment header following the established pattern
  - [x] 5.3 Add archModelClient methods in `mcp-server/src/services/archModelClient.ts`
    - Add `DiscoveryConfigResponseDto` interface (following `TemporaryDiagramResponseDto` pattern):
      - `id: string`, `project_id: string`, `config_payload: object`, `status: string`, `created_at: string`, `updated_at: string`
    - Add `saveDiscoveryConfig(projectId: string, configPayload: object, status: string): Promise<DiscoveryConfigResponseDto>` method:
      - Calls `PUT /api/model/projects/${encodeURIComponent(projectId)}/discovery/config`
      - Request body: `{ config_payload: configPayload, status }`
      - Returns `response.data`
    - Add `getDiscoveryConfig(projectId: string): Promise<DiscoveryConfigResponseDto | null>` method:
      - Calls `GET /api/model/projects/${encodeURIComponent(projectId)}/discovery/config`
      - Returns null on 404 (catch AxiosError, check `.response?.status === 404`)
      - Follow the `getTemporaryDiagram` null-on-404 pattern exactly
    - Add `createProjectArtifact(projectId: string, artifactType: string, content: string, source: string): Promise<any>` method:
      - Calls `POST /api/model/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactType)}`
      - Request body: `{ content, source }`
      - Returns `response.data`
  - [x] 5.4 Create service at `mcp-server/src/services/discoveryConfigService.ts`
    - Follow `temporaryArchitectureDiagramService.ts` parse-validate-persist pattern
    - `MAX_PAYLOAD_SIZE_BYTES = 500 * 1024` constant
    - `export async function saveDiscoveryConfig(projectId: string, discoveryConfigJson: string): Promise<SaveDiscoveryConfigResult>`:
      1. Validate payload size (500KB); throw `createHttpError(400, ...)` if exceeded
      2. `JSON.parse(discoveryConfigJson)`; throw `createHttpError(400, 'Invalid JSON: ...')` on parse error
      3. Validate parsed result is a non-null object; throw 400 if not (`typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)`)
      4. Validate project exists via `archModelClient.getProjectById(projectId)` (let AxiosError propagate for 502)
      5. Extract `status` from parsed config if present, default to `'DRAFT'`
      6. Persist via `archModelClient.saveDiscoveryConfig(projectId, parsed, status)`
      7. Return `{ projectId, status: backendResponse.status }`
    - Import `createHttpError` from `../middleware/errorHandler`
    - Import `archModelClient` from `./archModelClient`
    - Import `SaveDiscoveryConfigResult` from `../types/saveDiscoveryConfig`
  - [x] 5.5 Create route at `mcp-server/src/routes/saveDiscoveryConfigRoute.ts`
    - Follow `saveTemporaryArchitectureDiagramRoute.ts` pattern exactly
    - `UUID_V4_REGEX` constant
    - `export const saveDiscoveryConfigRouter = Router()`
    - POST `/` handler:
      - Destructure `{ sessionId, projectId, discoveryConfigJson }` from `req.body as SaveDiscoveryConfigRequest`
      - Validate sessionId (non-empty string)
      - Validate projectId (UUID v4 regex)
      - Validate discoveryConfigJson (non-empty string)
      - `getOrCreateSession(sessionId)`
      - `const response = await saveDiscoveryConfig(projectId, discoveryConfigJson)`
      - `res.json(response)`
    - Error handling: 400 and 502 status codes with `{ error: { code, message } }` response shape
  - [x] 5.6 Mount route in `mcp-server/src/routes/tools.ts`
    - Import: `import { saveDiscoveryConfigRouter } from './saveDiscoveryConfigRoute';`
    - Mount: `toolsRouter.use('/save_discovery_config', saveDiscoveryConfigRouter);`
    - Add import and mount line following the established pattern (after `saveUserJourneysRouter` mount)
  - [x] 5.7 Write 4 focused tests for MCP route at `mcp-server/src/__tests__/saveDiscoveryConfigRoute.test.ts`
    - Follow `saveTemporaryArchitectureDiagramRoute.test.ts` pattern: `jest.mock('dotenv')`, `jest.mock('axios')`, `jest.mock('../services/sessionManager')`, `jest.mock('../services/discoveryConfigService')`
    - Test 1: Returns 400 when sessionId is missing
    - Test 2: Returns 400 when projectId is not a valid UUID
    - Test 3: Returns 400 when discoveryConfigJson is empty
    - Test 4: Returns 200 with `{ projectId, status }` for valid request (mock service success)
  - [x] 5.8 Write 3 focused tests for MCP service at `mcp-server/src/__tests__/discoveryConfigService.test.ts`
    - Follow `temporaryArchitectureDiagramService.test.ts` pattern: `jest.mock('dotenv')`, `jest.mock('axios')`
    - Test 5: Returns `{ projectId, status }` for valid JSON config
    - Test 6: Throws 400 for invalid JSON string
    - Test 7: Throws 400 for payload exceeding 500KB
  - [x] 5.9 Write 2 focused tests for archModelClient methods at `mcp-server/src/__tests__/archModelClient.discoveryConfig.test.ts`
    - Follow `archModelClient.temporaryDiagram.test.ts` pattern
    - Test 8: `saveDiscoveryConfig` calls PUT with correct URL and body, returns `DiscoveryConfigResponseDto`
    - Test 9: `getDiscoveryConfig` returns null on 404 response
  - [x] 5.10 Run MCP server tests
    - Run ONLY `saveDiscoveryConfigRoute.test.ts`, `discoveryConfigService.test.ts`, and `archModelClient.discoveryConfig.test.ts`
    - Verify all 9 tests pass

**Acceptance Criteria:**
- All 9 MCP tests pass (4 route + 3 service + 2 client)
- Route validates sessionId, projectId (UUID), and discoveryConfigJson (non-empty)
- Service validates payload size, JSON validity, and non-null object shape
- archModelClient correctly calls the architecture-model-service REST API
- Route is mounted and accessible at `/mcp/tools/save_discovery_config`

---

### Gateway Layer

#### Task Group 6: Gateway Tool Registration
**Dependencies:** Task Group 5 (MCP tool must be implemented)

- [x] 6.0 Register save_discovery_config in gateway tool infrastructure
  - [x] 6.1 Update `gateway/src/types/tools.ts` -- ToolName union
    - Add `| 'save_discovery_config'` to the `ToolName` union type (after `'save_user_journeys'`)
  - [x] 6.2 Update `gateway/src/types/tools.ts` -- ALLOWED_TOOL_NAMES array
    - Add `'save_discovery_config'` to the `ALLOWED_TOOL_NAMES` array
  - [x] 6.3 Update `gateway/src/types/tools.ts` -- SaveDiscoveryConfigParams interface
    - Add new interface:
      ```
      export interface SaveDiscoveryConfigParams {
        /** Project UUID (v4 format) */
        projectId: string;
        /** JSON string containing the discovery config payload */
        discoveryConfigJson: string;
      }
      ```
  - [x] 6.4 Update `gateway/src/types/tools.ts` -- ToolParams union
    - Add `| SaveDiscoveryConfigParams` to the `ToolParams` union type
  - [x] 6.5 Update `gateway/src/types/tools.ts` -- TOOL_DEFINITIONS array
    - Add new entry following `saveTemporaryArchitectureDiagram` pattern:
      ```
      {
        type: 'function',
        function: {
          name: 'save_discovery_config',
          description: 'Save the Phase 0 discovery configuration for a project. Persists structured JSONB config covering repo scope, repo-to-application mappings, tech hints, exclusions, and notes.',
          parameters: {
            type: 'object',
            required: ['projectId', 'discoveryConfigJson'],
            properties: {
              projectId: {
                type: 'string',
                description: 'Project UUID (v4 format)'
              },
              discoveryConfigJson: {
                type: 'string',
                description: 'JSON string containing the discovery config payload with repos, repoApplicationMappings, techHints, exclusions, and notes'
              }
            }
          }
        }
      }
      ```
  - [x] 6.6 Update `gateway/src/services/toolExecutor.ts` -- TOOL_ENDPOINTS
    - Add `save_discovery_config: '/mcp/tools/save_discovery_config'` to the `TOOL_ENDPOINTS` record
  - [x] 6.7 Update `gateway/src/services/toolExecutor.ts` -- TOOL_REQUIRED_PARAMS
    - Add `save_discovery_config: ['projectId', 'discoveryConfigJson']` to the `TOOL_REQUIRED_PARAMS` record
  - [x] 6.8 Update `gateway/src/services/toolExecutor.ts` -- import
    - Add `SaveDiscoveryConfigParams` to the import from `'../types'`
  - [x] 6.9 Verify TypeScript compilation
    - Run `npx tsc --noEmit` in the gateway directory to confirm no type errors

**Acceptance Criteria:**
- `save_discovery_config` appears in `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`, and `TOOL_DEFINITIONS`
- TypeScript compilation passes with no errors
- Tool parameter schema correctly requires `projectId` and `discoveryConfigJson`

---

### Test Review

#### Task Group 7: Test Review and Critical Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review and fill critical test gaps
  - [x] 7.1 Review existing tests from Task Groups 3 and 5
    - Review 8 Java tests from Task Group 3 (DiscoveryConfigServiceTest + DiscoveryConfigControllerTest)
    - Review 9 MCP tests from Task Group 5 (route + service + archModelClient)
    - Total existing: 17 tests
  - [x] 7.2 Identify critical gaps
    - Check for: upsert-then-retrieve round-trip flow (service creates, then get returns same data)
    - Check for: status field validation at the controller level (what happens when status is missing from PUT body)
    - Check for: MCP service handling of non-object JSON (e.g., JSON array, JSON string literal)
    - Check for: archModelClient `createProjectArtifact` method coverage
  - [x] 7.3 Write up to 5 additional tests to fill gaps
    - Gap test 1 (Java): `upsertConfig_thenGetConfig_returnsMatchingDto` -- round-trip upsert-then-get
    - Gap test 2 (MCP): discoveryConfigService rejects JSON array input (`'[1,2,3]'`)
    - Gap test 3 (MCP): archModelClient `createProjectArtifact` calls POST with correct URL and body
    - Gap test 4 (MCP): MCP route returns 502 on upstream failure (mock service throwing statusCode 502)
    - Gap test 5 (Java): `putConfig_returns200_withDefaultDraftStatus` -- PUT without explicit status defaults to DRAFT
  - [x] 7.4 Run all feature-specific tests
    - Run Java tests: `DiscoveryConfigServiceTest`, `DiscoveryConfigControllerTest`
    - Run MCP tests: `saveDiscoveryConfigRoute.test.ts`, `discoveryConfigService.test.ts`, `archModelClient.discoveryConfig.test.ts`
    - Expected total: approximately 22 tests
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All approximately 22 feature-specific tests pass
- Critical round-trip and validation gaps are covered
- No more than 5 additional tests added in this phase

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migration** -- Foundation; creates the database table
2. **Task Group 2: JPA Entity, DTO, and Repository** -- Java persistence objects on top of the table
3. **Task Group 3: Service and Controller** -- REST API with tests (depends on Groups 1-2)
4. **Task Group 4: ProjectArtifactService Extension** -- Single-line change, can run in parallel with Groups 1-3
5. **Task Group 5: MCP Save Tool and archModelClient** -- MCP layer calling the REST API (depends on Group 3)
6. **Task Group 6: Gateway Tool Registration** -- Wires MCP tool to LLM tool calling (depends on Group 5)
7. **Task Group 7: Test Review and Gap Analysis** -- Final validation across all layers (depends on Groups 1-6)

## Files Created (New)

| File | Template |
|------|----------|
| `architecture-model-service/src/main/resources/db/changelog/sql/064-discovery-config.sql` | `054-temporary-diagrams.sql` |
| `architecture-model-service/.../model/entity/DiscoveryConfigEntity.java` | `TemporaryDiagramEntity.java` |
| `architecture-model-service/.../model/dto/DiscoveryConfigDto.java` | `TemporaryDiagramDto.java` |
| `architecture-model-service/.../repository/entity/DiscoveryConfigRepository.java` | `TemporaryDiagramRepository.java` |
| `architecture-model-service/.../service/DiscoveryConfigService.java` | `TemporaryDiagramService.java` |
| `architecture-model-service/.../controller/DiscoveryConfigController.java` | `TemporaryDiagramController.java` |
| `architecture-model-service/.../service/DiscoveryConfigServiceTest.java` | `TemporaryDiagramServiceTest.java` |
| `architecture-model-service/.../controller/DiscoveryConfigControllerTest.java` | `TemporaryDiagramControllerTest.java` |
| `mcp-server/src/types/saveDiscoveryConfig.ts` | `saveTemporaryArchitectureDiagram.ts` |
| `mcp-server/src/services/discoveryConfigService.ts` | `temporaryArchitectureDiagramService.ts` |
| `mcp-server/src/routes/saveDiscoveryConfigRoute.ts` | `saveTemporaryArchitectureDiagramRoute.ts` |
| `mcp-server/src/__tests__/saveDiscoveryConfigRoute.test.ts` | `saveTemporaryArchitectureDiagramRoute.test.ts` |
| `mcp-server/src/__tests__/discoveryConfigService.test.ts` | `temporaryArchitectureDiagramService.test.ts` |
| `mcp-server/src/__tests__/archModelClient.discoveryConfig.test.ts` | `archModelClient.temporaryDiagram.test.ts` |

## Files Modified (Existing)

| File | Change |
|------|--------|
| `architecture-model-service/.../db/changelog/db.changelog-master.yaml` | Append 064-discovery-config changeset |
| `architecture-model-service/.../service/ProjectArtifactService.java` | Add `"DISCOVERY_BRIEF_MD"` to `ALLOWED_ARTIFACT_TYPES` |
| `mcp-server/src/types/index.ts` | Add `export * from './saveDiscoveryConfig'` |
| `mcp-server/src/services/archModelClient.ts` | Add `DiscoveryConfigResponseDto`, `saveDiscoveryConfig()`, `getDiscoveryConfig()`, `createProjectArtifact()` |
| `mcp-server/src/routes/tools.ts` | Import and mount `saveDiscoveryConfigRouter` |
| `gateway/src/types/tools.ts` | Add to ToolName, ALLOWED_TOOL_NAMES, params interface, ToolParams, TOOL_DEFINITIONS |
| `gateway/src/services/toolExecutor.ts` | Add to TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS, imports |
