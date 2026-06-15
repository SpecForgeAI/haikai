# Task Breakdown: Discovery Run Model and Orchestration

## Overview
Total Tasks: 59 sub-tasks across 8 task groups spanning 4 services
Spec: Increment 5 of 16 -- Discovery Run Model and Orchestration

This increment introduces a first-class discovery run entity and orchestration plumbing so that Phase 1 execution (steps 1a-1d) is explicit, trackable, and stateful. All Phase 1 steps remain stubs returning placeholder responses.

## Task List

### Architecture-Model-Service: Database Layer

#### Task Group 1: Liquibase Migration
**Dependencies:** None
**Service:** `architecture-model-service`
**Template:** `064-discovery-config.sql` and its `db.changelog-master.yaml` entry

- [x] 1.0 Complete database migration for discovery_run table
  - [x] 1.1 Create `architecture-model-service/src/main/resources/db/changelog/sql/065-discovery-run.sql`
    - Follow the exact SQL structure from `064-discovery-config.sql` (CREATE TABLE IF NOT EXISTS, FK constraint, index, COMMENT ON statements)
    - Columns: `id` UUID PRIMARY KEY, `project_id` UUID NOT NULL, `status` TEXT NOT NULL DEFAULT 'PENDING', `current_step` TEXT, `config_snapshot` JSONB NOT NULL, `steps_payload` JSONB NOT NULL DEFAULT '{}', `error_message` TEXT, `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW(), `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
    - FK constraint: `fk_discovery_run_project` referencing `project(id) ON DELETE CASCADE`
    - Non-unique index on project_id: `CREATE INDEX IF NOT EXISTS idx_discovery_run_project_id ON discovery_run (project_id)` (NOT unique -- multiple historical runs per project)
    - COMMENT ON table and key columns (config_snapshot, steps_payload, status)
  - [x] 1.2 Add changeSet entry to `db.changelog-master.yaml`
    - Append after the `064-discovery-config` entry
    - Use id `065-discovery-run`, author `architecture-tool`
    - preConditions: `not: tableExists: tableName: discovery_run` with `onFail: MARK_RAN` and `onError: HALT`
    - sqlFile path: `db/changelog/sql/065-discovery-run.sql`
    - Include comment: `# Discovery Run Table` and `# Spec: Discovery Run Model and Orchestration (Increment 5)`

**Acceptance Criteria:**
- SQL file follows the exact pattern of `064-discovery-config.sql`
- Index on project_id is non-unique (unlike discovery_config which uses unique)
- YAML entry follows the exact format of the 064 entry
- Migration is idempotent (IF NOT EXISTS guards)

---

### Architecture-Model-Service: JPA Entity Stack

#### Task Group 2: Entity, DTO, Repository, Service, Controller
**Dependencies:** Task Group 1
**Service:** `architecture-model-service`
**Templates:** `DiscoveryConfigEntity.java`, `DiscoveryConfigDto.java`, `DiscoveryConfigRepository.java`, `DiscoveryConfigService.java`, `DiscoveryConfigController.java`

- [x] 2.0 Complete JPA entity stack for discovery_run
  - [x] 2.1 Write 6 focused unit tests for the DiscoveryRun stack
    - Test 1: DiscoveryRunService.createRun -- creates a run with PENDING status and config snapshot when config is COMPLETE and no active run exists
    - Test 2: DiscoveryRunService.createRun -- returns 409-equivalent (throws) when an active run (PENDING or RUNNING) already exists for the project
    - Test 3: DiscoveryRunService.createRun -- returns 400-equivalent (throws) when discovery config is missing or not COMPLETE
    - Test 4: DiscoveryRunService.updateRun -- updates status, currentStep, stepsPayload, and errorMessage fields
    - Test 5: DiscoveryRunController.createRun -- returns 200 with DTO for valid creation
    - Test 6: DiscoveryRunController.listRuns -- returns 200 with array of DTOs for a given project
  - [x] 2.2 Create `DiscoveryRunEntity.java` in `model/entity/`
    - Follow `DiscoveryConfigEntity.java` pattern exactly: `@Entity`, `@Table`, Lombok annotations (`@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`)
    - `@Table(name = "discovery_run")` with non-unique `@Index` on `project_id`
    - Fields: `id` (UUID, `@Id`), `projectId` (UUID, `@Column(name = "project_id")`), `status` (String, `@Builder.Default` value `"PENDING"`), `currentStep` (String, `@Column(name = "current_step")`), `configSnapshot` (Map<String, Object>, `@Type(JsonType.class)`, `@Column(columnDefinition = "jsonb")`), `stepsPayload` (Map<String, Object>, `@Type(JsonType.class)`, `@Column(columnDefinition = "jsonb")`, `@Builder.Default` initializing 1a/1b/1c/1d all with `{ "status": "pending" }`), `errorMessage` (String, `@Column(name = "error_message")`), `createdAt`/`updatedAt` (Instant, with `@PrePersist`/`@PreUpdate` hooks)
  - [x] 2.3 Create `DiscoveryRunDto.java` record in `model/dto/`
    - Follow `DiscoveryConfigDto.java` pattern: Java record with `@JsonProperty` snake_case mapping
    - Fields: `id` (UUID), `projectId` (UUID, mapped to `project_id`), `status` (String), `currentStep` (String, mapped to `current_step`), `configSnapshot` (Map<String, Object>, mapped to `config_snapshot`), `stepsPayload` (Map<String, Object>, mapped to `steps_payload`), `errorMessage` (String, mapped to `error_message`), `createdAt` (String, mapped to `created_at`), `updatedAt` (String, mapped to `updated_at`)
  - [x] 2.4 Create `DiscoveryRunRepository.java` in `repository/entity/`
    - Extend `JpaRepository<DiscoveryRunEntity, UUID>` following `DiscoveryConfigRepository.java`
    - Custom finders: `List<DiscoveryRunEntity> findByProjectId(UUID projectId)`, `List<DiscoveryRunEntity> findByProjectIdAndStatusIn(UUID projectId, Collection<String> statuses)`, `Optional<DiscoveryRunEntity> findById(UUID id)` (inherited but explicit for clarity)
    - `List<DiscoveryRunEntity> findByProjectIdOrderByCreatedAtDesc(UUID projectId)` for descending-order listing
  - [x] 2.5 Create `DiscoveryRunService.java` in `service/`
    - Follow `DiscoveryConfigService.java` pattern: `@Service`, `@ConditionalOnProperty(name = "app.features.include-database")`, `@RequiredArgsConstructor`, `@Slf4j`
    - Inject `DiscoveryRunRepository` and `DiscoveryConfigRepository`
    - `ALLOWED_STATUSES = Set.of("PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED")`
    - `createRun(UUID projectId)`: (1) query for active runs via `findByProjectIdAndStatusIn(projectId, List.of("PENDING", "RUNNING"))`; if non-empty, throw IllegalStateException ("Active run already exists"); (2) fetch discovery config via `DiscoveryConfigRepository.findByProjectId(projectId)`; if absent or status not "COMPLETE", throw IllegalArgumentException; (3) build entity with `UUID.randomUUID()`, snapshot configPayload into configSnapshot, status PENDING, default stepsPayload; (4) save and return DTO
    - `getRun(UUID runId)`: find by id, map to DTO or return null
    - `getRunsByProject(UUID projectId)`: find by projectId ordered by createdAt desc, map to DTOs
    - `updateRun(UUID runId, String status, String currentStep, Map<String, Object> stepsPayload, String errorMessage)`: find by id (throw if not found), validate status, update fields, save, return DTO
    - Private `toDto(DiscoveryRunEntity)` method converting entity to DTO with ISO-8601 timestamp strings
  - [x] 2.6 Create `DiscoveryRunController.java` in `controller/`
    - Follow `DiscoveryConfigController.java` pattern: `@RestController`, `@ConditionalOnProperty`, `@RequestMapping("/api/model/projects/{projectId}/discovery/runs")`, `@RequiredArgsConstructor`, `@Slf4j`
    - `POST /` -- create a new run; calls `createRun(projectId)`; returns 200 with DTO; catches IllegalStateException for 409 (active run exists); catches IllegalArgumentException for 400 (config not COMPLETE)
    - `GET /` -- list runs for project; calls `getRunsByProject(projectId)`; returns 200 with array
    - `GET /{runId}` -- get single run; calls `getRun(runId)`; returns 200 or 404
    - `PUT /{runId}` -- update run; accepts `UpdateDiscoveryRunRequest` inner record (status, currentStep, stepsPayload, errorMessage with `@JsonProperty` snake_case mapping); calls `updateRun`; returns 200 with updated DTO
    - Inner request record: `UpdateDiscoveryRunRequest(String status, @JsonProperty("current_step") String currentStep, @JsonProperty("steps_payload") Map<String, Object> stepsPayload, @JsonProperty("error_message") String errorMessage)`
  - [x] 2.7 Ensure JPA entity stack tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify compilation succeeds for all new Java files

**Acceptance Criteria:**
- The 6 tests from 2.1 pass
- Entity uses `@Type(JsonType.class)` for both JSONB columns
- stepsPayload `@Builder.Default` initializes all four steps (1a, 1b, 1c, 1d) with `{ "status": "pending" }`
- createRun enforces active-run constraint at service layer
- createRun snapshots config_payload from DiscoveryConfigEntity into configSnapshot
- Controller returns 409 for active run conflict, 400 for missing/incomplete config
- DTO uses snake_case `@JsonProperty` mapping for all multi-word fields

---

### Discovery-Service: Architecture-Model-Service HTTP Client

#### Task Group 3: archModelClient for Discovery Service
**Dependencies:** Task Group 2 (needs to know the REST API contract)
**Service:** `discovery-service`
**Template:** `mcp-server/src/services/archModelClient.ts` (method patterns for discovery config)

- [x] 3.0 Complete archModelClient for discovery-service
  - [x] 3.1 Write 4 focused tests for archModelClient methods
    - Test 1: `createDiscoveryRun(projectId)` calls POST to correct URL and returns the run DTO
    - Test 2: `updateDiscoveryRun(projectId, runId, payload)` calls PUT to correct URL with body and returns updated DTO
    - Test 3: `getDiscoveryRun(projectId, runId)` calls GET and returns DTO; returns null on 404
    - Test 4: `getDiscoveryConfig(projectId)` calls GET to config endpoint and returns config DTO; returns null on 404
  - [x] 3.2 Create `discovery-service/src/services/archModelClient.ts`
    - Follow the class-based singleton pattern from `mcp-server/src/services/archModelClient.ts`
    - Import `ARCHITECTURE_MODEL_SERVICE_BASE_URL` from `../config`
    - Use axios with `baseURL`, 30s timeout, JSON content-type headers
    - Define response interfaces: `DiscoveryRunResponseDto` (id, project_id, status, current_step, config_snapshot, steps_payload, error_message, created_at, updated_at), `DiscoveryConfigResponseDto` (id, project_id, config_payload, status, created_at, updated_at)
    - Method: `createDiscoveryRun(projectId: string)` -- POST to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs`; returns `DiscoveryRunResponseDto`
    - Method: `updateDiscoveryRun(projectId: string, runId: string, payload: { status?: string, current_step?: string, steps_payload?: object, error_message?: string })` -- PUT to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}`; returns `DiscoveryRunResponseDto`
    - Method: `getDiscoveryRun(projectId: string, runId: string)` -- GET; returns `DiscoveryRunResponseDto | null` (null on 404, following getDiscoveryConfig pattern from mcp-server)
    - Method: `getDiscoveryConfig(projectId: string)` -- GET to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/config`; returns `DiscoveryConfigResponseDto | null` (null on 404)
    - Export singleton instance: `export const archModelClient = new ArchModelClient()`
  - [x] 3.3 Ensure archModelClient tests pass
    - Run ONLY the 4 tests written in 3.1

**Acceptance Criteria:**
- The 4 tests from 3.1 pass
- Client uses the same axios instance pattern as the MCP archModelClient
- All URL paths use `encodeURIComponent` for dynamic segments
- 404 responses return null instead of throwing (for GET methods)
- Base URL comes from `ARCHITECTURE_MODEL_SERVICE_BASE_URL` config value

---

### Discovery-Service: Run Manager and Routes

#### Task Group 4: Run Manager and Run Endpoints
**Dependencies:** Task Group 3
**Service:** `discovery-service`
**Templates:** `routes/phase1.ts` (stub response shape), `routes/index.ts` (barrel pattern)

- [x] 4.0 Complete run manager and run routes
  - [x] 4.1 Write 6 focused tests for run manager and routes
    - Test 1: `POST /discovery/runs` with valid projectId returns 200 with run DTO (mocking archModelClient.createDiscoveryRun)
    - Test 2: `POST /discovery/runs` with missing/empty projectId returns 400
    - Test 3: `GET /discovery/runs/:runId?projectId=<uuid>` returns 200 with run DTO (mocking archModelClient.getDiscoveryRun)
    - Test 4: `GET /discovery/runs/:runId?projectId=<uuid>` returns 404 when run not found
    - Test 5: runManager.startRun calls archModelClient.updateDiscoveryRun for each step transition (1a, 1b, 1c, 1d) and sets final status to COMPLETED
    - Test 6: runManager.startRun sets status to FAILED and records error_message when a step fails
  - [x] 4.2 Create `discovery-service/src/services/runManager.ts`
    - `VALID_STEPS` array: `['1a', '1b', '1c', '1d']` (reuse from phase1.ts concept)
    - `startRun(projectId: string, runId: string): Promise<void>` -- async function that:
      - Iterates through steps 1a, 1b, 1c, 1d sequentially
      - Before each step: calls `archModelClient.updateDiscoveryRun(projectId, runId, { status: 'RUNNING', current_step: step, steps_payload: <updated> })` setting the current step's status to `"running"`
      - Executes the step internally: reuse the Phase 1 stub response shape `{ phase: 'phase1', step, status: 'stub', projectId }` (direct function call, NOT HTTP self-call)
      - After each step: updates the step's entry in stepsPayload to `{ "status": "completed" }`
      - On final step completion: calls updateDiscoveryRun with `status: 'COMPLETED'`, `current_step: null`
    - On any step failure (try/catch per step): set the failing step status to `"failed"`, set overall run status to `"FAILED"`, record `error_message`, and return immediately (fail-fast, no retry)
    - Export `startRun` function
  - [x] 4.3 Create `discovery-service/src/routes/runs.ts`
    - Follow the Router pattern from `routes/phase1.ts`
    - `POST /` -- accepts `{ projectId }` body; validates projectId as non-empty string; calls `archModelClient.createDiscoveryRun(projectId)`; kicks off `startRun(projectId, run.id)` asynchronously (fire-and-forget with `.catch()` for error logging); returns the created run DTO immediately with status PENDING
    - `GET /:runId` -- accepts `projectId` as query param; validates projectId; calls `archModelClient.getDiscoveryRun(projectId, runId)`; returns run DTO or 404
    - Export `runsRouter`
  - [x] 4.4 Update `discovery-service/src/routes/index.ts` barrel
    - Import `runsRouter` from `./runs`
    - Mount: `discoveryRouter.use('/runs', runsRouter)`
    - Existing phase0 and phase1 mounts remain unchanged
  - [x] 4.5 Ensure run manager and routes tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify the discovery-service compiles with no TypeScript errors

**Acceptance Criteria:**
- The 6 tests from 4.1 pass
- startRun executes steps sequentially (not in parallel)
- startRun is fire-and-forget from the POST handler (async, not awaited)
- Step execution reuses the Phase 1 stub response shape internally (no HTTP self-call)
- Fail-fast behavior: first step failure stops the entire run
- Routes are mounted at `/discovery/runs` via the barrel

---

### MCP Server: save_discovery_run Tool

#### Task Group 5: MCP Tool for Discovery Run Persistence
**Dependencies:** Task Group 2 (architecture-model-service API contract)
**Service:** `mcp-server`
**Templates:** `saveDiscoveryConfigRoute.ts`, `discoveryConfigService.ts`, `archModelClient.ts` (saveDiscoveryConfig/getDiscoveryConfig methods)

- [x] 5.0 Complete MCP save_discovery_run tool
  - [x] 5.1 Write 6 focused tests for the MCP save_discovery_run chain
    - Test 1: archModelClient `saveDiscoveryRun` calls PUT with correct URL and body, returns DiscoveryRunResponseDto (follow `archModelClient.discoveryConfig.test.ts` Test 8 pattern)
    - Test 2: archModelClient `getDiscoveryRun` returns null on 404 (follow Test 9 pattern)
    - Test 3: discoveryRunService returns `{ projectId, status }` for valid JSON input (follow `discoveryConfigService.test.ts` Test 5 pattern)
    - Test 4: discoveryRunService throws 400 for invalid JSON string (follow Test 6 pattern)
    - Test 5: saveDiscoveryRunRoute returns 400 when sessionId is missing (follow `saveDiscoveryConfigRoute.test.ts` Test 1 pattern)
    - Test 6: saveDiscoveryRunRoute returns 200 with `{ projectId, status }` for valid request (follow Test 4 pattern)
  - [x] 5.2 Add `saveDiscoveryRun` and `getDiscoveryRun` methods to `mcp-server/src/services/archModelClient.ts`
    - Add `DiscoveryRunResponseDto` interface (id, project_id, status, current_step, config_snapshot, steps_payload, error_message, created_at, updated_at)
    - `saveDiscoveryRun(projectId, runId, discoveryRunPayload, status)` -- PUT to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}`; body: `{ status, ...discoveryRunPayload }`; returns `DiscoveryRunResponseDto`
    - `getDiscoveryRun(projectId, runId)` -- GET to `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}`; returns `DiscoveryRunResponseDto | null` (null on 404)
  - [x] 5.3 Create `mcp-server/src/types/saveDiscoveryRun.ts`
    - Follow `saveDiscoveryConfig.ts` pattern
    - `SaveDiscoveryRunRequest`: `sessionId: string`, `projectId: string`, `discoveryRunJson: string`
    - `SaveDiscoveryRunResult`: `projectId: string`, `status: string`
  - [x] 5.4 Create `mcp-server/src/services/discoveryRunService.ts`
    - Follow `discoveryConfigService.ts` orchestration flow exactly
    - `saveDiscoveryRun(projectId: string, discoveryRunJson: string): Promise<SaveDiscoveryRunResult>`
    - Orchestration flow: (1) validate payload size (500KB limit), (2) JSON.parse with 400 on failure, (3) validate parsed result is non-null object, (4) validate project exists via `archModelClient.getProjectById(projectId)`, (5) extract status (default to 'PENDING'), (6) determine if creating or updating -- if `parsed.id` exists, call `archModelClient.saveDiscoveryRun(projectId, parsed.id, parsed, status)`, otherwise call `archModelClient.createDiscoveryRun` via a new POST method, (7) return `{ projectId, status: backendResponse.status }`
  - [x] 5.5 Create `mcp-server/src/routes/saveDiscoveryRunRoute.ts`
    - Follow `saveDiscoveryConfigRoute.ts` pattern exactly
    - Router at `/` (mounted externally at `/mcp/tools/save_discovery_run`)
    - POST handler: validate sessionId (non-empty string), projectId (UUID v4 regex), discoveryRunJson (non-empty string)
    - Call `getOrCreateSession(sessionId)`
    - Delegate to `saveDiscoveryRun(projectId, discoveryRunJson)`
    - Handle 400 and 502 errors in the catch block following the saveDiscoveryConfig pattern
  - [x] 5.6 Register route in `mcp-server/src/routes/tools.ts`
    - Import `saveDiscoveryRunRouter` from `./saveDiscoveryRunRoute`
    - Add mount: `toolsRouter.use('/save_discovery_run', saveDiscoveryRunRouter)`
    - Place after the existing `save_discovery_config` mount for logical grouping
  - [x] 5.7 Ensure MCP save_discovery_run tests pass
    - Run ONLY the 6 tests written in 5.1

**Acceptance Criteria:**
- The 6 tests from 5.1 pass
- Route, service, and archModelClient methods follow the save_discovery_config template exactly
- Tool is registered at `/mcp/tools/save_discovery_run`
- Payload size validation enforced at 500KB
- UUID v4 validation on projectId
- 400/502 error handling matches saveDiscoveryConfigRoute pattern

---

### Gateway: Discovery Run Proxy Routes

#### Task Group 6: Gateway Proxy Routes for Discovery Runs
**Dependencies:** Task Group 4 (discovery-service run endpoints must exist)
**Service:** `gateway`
**Templates:** `gateway/src/routes/discovery.ts` (existing file to extend), gateway proxy pattern from orchestrations.ts

- [x] 6.0 Complete gateway proxy routes for discovery runs
  - [x] 6.1 Write 4 focused tests for gateway discovery run routes
    - Test 1: `POST /api/v1/discovery/runs` proxies to discovery-service and returns 200 with run DTO
    - Test 2: `POST /api/v1/discovery/runs` returns 503 when discovery-service is unreachable
    - Test 3: `GET /api/v1/discovery/runs/:runId?projectId=<uuid>` proxies to discovery-service and returns 200 with run DTO
    - Test 4: Existing `GET /api/v1/discovery` capability descriptor still works (regression check)
  - [x] 6.2 Extend `gateway/src/routes/discovery.ts` with run proxy routes
    - Import `getConfig` from `../config` to access `discoveryServiceBaseUrl`
    - `POST /runs` -- extracts `{ projectId }` from request body; calls `fetch(${discoveryServiceBaseUrl}/discovery/runs, { method: 'POST', body, headers })` (or node-fetch/axios); on success, forwards the response body and status code transparently; on network error, returns 503 with structured error (`{ error: { code: 503, message: 'Discovery service unavailable' } }`); log structured errors
    - `GET /runs/:runId` -- extracts `projectId` from query params; calls `fetch(${discoveryServiceBaseUrl}/discovery/runs/${runId}?projectId=${projectId})`; on success, forwards response transparently; on network error, returns 503
    - Keep existing `GET /` capability descriptor endpoint unchanged
  - [x] 6.3 Ensure gateway discovery run tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify existing discovery.test.ts tests still pass (regression)

**Acceptance Criteria:**
- The 4 tests from 6.1 pass
- Existing discovery capability descriptor endpoint remains functional
- POST /runs proxies to discovery-service `POST /discovery/runs`
- GET /runs/:runId proxies to discovery-service `GET /discovery/runs/:runId`
- Network errors return 503 with structured JSON error
- No new config entries needed (uses existing `discoveryServiceBaseUrl`)

---

### Infrastructure: Docker Compose Update

#### Task Group 7: Docker Compose depends_on
**Dependencies:** None (can be done in parallel with other groups)
**File:** `docker-compose.yml`

- [x] 7.0 Update docker-compose for discovery-service dependency
  - [x] 7.1 Add `depends_on` to discovery-service container
    - Add `depends_on: architecture-model-service: condition: service_healthy` to the `discovery-service` service block
    - Follow the same pattern as the `mcp-server` service block (lines 121-123) which already depends on architecture-model-service
    - Add `ARCHITECTURE_MODEL_SERVICE_BASE_URL: http://architecture-model-service:8080` to the discovery-service `environment` section (the container uses the Docker network hostname, not localhost)

**Acceptance Criteria:**
- discovery-service starts after architecture-model-service is healthy
- ARCHITECTURE_MODEL_SERVICE_BASE_URL environment variable points to the Docker network hostname

---

### Cross-Service Integration Verification

#### Task Group 8: Test Review and Integration Verification
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and verify end-to-end integration
  - [x] 8.1 Review tests from Task Groups 2-6
    - Review the 6 tests written by architecture-model-service (Task 2.1)
    - Review the 4 tests written by discovery-service archModelClient (Task 3.1)
    - Review the 6 tests written by discovery-service run manager/routes (Task 4.1)
    - Review the 6 tests written by MCP server (Task 5.1)
    - Review the 4 tests written by gateway (Task 6.1)
    - Total existing tests: approximately 26 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical integration points that lack coverage
    - Focus on: (1) run creation with config snapshot integrity, (2) step sequencing order correctness, (3) active-run constraint enforcement across create attempts, (4) error propagation from archModelClient through runManager, (5) gateway-to-discovery-service request/response shape compatibility
  - [x] 8.3 Write up to 8 additional strategic tests to fill gaps
    - Gap Test 1 (arch-model-service): DiscoveryRunService.updateRun rejects invalid status values
    - Gap Test 2 (arch-model-service): DiscoveryRunController.getRunById returns 404 for non-existent run
    - Gap Test 3 (discovery-service): runManager.startRun updates stepsPayload correctly at each transition (verify intermediate state shape)
    - Gap Test 4 (discovery-service): `POST /discovery/runs` returns the DTO immediately (before startRun completes) confirming fire-and-forget behavior
    - Gap Test 5 (mcp-server): discoveryRunService rejects JSON array input (follow discoveryConfigService gap test pattern)
    - Gap Test 6 (mcp-server): discoveryRunService enforces 500KB payload size limit
    - Gap Test 7 (gateway): `POST /api/v1/discovery/runs` forwards 409 from discovery-service transparently
    - Gap Test 8 (gateway): `GET /api/v1/discovery/runs/:runId` with missing projectId query param returns 400
  - [x] 8.4 Run all feature-specific tests
    - Run architecture-model-service DiscoveryRun-related tests only (6 + 2 gap = 8 tests)
    - Run discovery-service tests only (4 + 6 + 2 gap = 12 tests)
    - Run MCP server discovery run tests only (6 + 2 gap = 8 tests)
    - Run gateway discovery tests only (4 + 2 gap = 6 tests)
    - Expected total: approximately 34 tests
    - Do NOT run the entire application test suite
  - [x] 8.5 Verify REST API contract compatibility across services
    - Confirm discovery-service archModelClient URL paths match DiscoveryRunController `@RequestMapping` paths
    - Confirm gateway proxy routes match discovery-service `/discovery/runs` routes
    - Confirm MCP archModelClient URL paths match DiscoveryRunController paths
    - Confirm DTO field names (snake_case JSON) are consistent across all service boundaries
    - Confirm stepsPayload default shape `{ "1a": { "status": "pending" }, ... }` is consistent between entity `@Builder.Default`, runManager initialization, and archModelClient response parsing

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34 tests total)
- No more than 8 additional gap tests added
- REST API contract is verified consistent across all 4 services
- DTO shapes are compatible at every service boundary
- stepsPayload structure is consistent everywhere

---

## Execution Order

Recommended implementation sequence:

```
Phase A: Foundation (can be parallel)
  1. Task Group 1: Liquibase Migration (no dependencies)
  7. Task Group 7: Docker Compose Update (no dependencies)

Phase B: Architecture-Model-Service Stack
  2. Task Group 2: JPA Entity Stack (depends on TG1)

Phase C: Downstream Consumers (can be parallel after TG2)
  3. Task Group 3: Discovery-Service archModelClient (depends on TG2 API contract)
  5. Task Group 5: MCP save_discovery_run Tool (depends on TG2 API contract)

Phase D: Orchestration Layer (depends on TG3)
  4. Task Group 4: Discovery-Service Run Manager and Routes (depends on TG3)

Phase E: Gateway Layer (depends on TG4)
  6. Task Group 6: Gateway Proxy Routes (depends on TG4)

Phase F: Integration Verification
  8. Task Group 8: Test Review and Integration Verification (depends on TG1-7)
```

**Dependency graph:**

```
TG1 (Migration) -----> TG2 (JPA Stack) -----> TG3 (DS archModelClient) -----> TG4 (Run Manager/Routes) -----> TG6 (Gateway Routes)
                                         \                                                                  /
                                          \---> TG5 (MCP Tool) -----------------------------------------/
                                                                                                          \
TG7 (Docker Compose) -------------------------------------------------> TG8 (Integration Verification) <--/
```

## Key Files Created/Modified

### New Files
| File | Service | Task Group |
|------|---------|------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/065-discovery-run.sql` | arch-model-service | TG1 |
| `architecture-model-service/src/main/java/.../model/entity/DiscoveryRunEntity.java` | arch-model-service | TG2 |
| `architecture-model-service/src/main/java/.../model/dto/DiscoveryRunDto.java` | arch-model-service | TG2 |
| `architecture-model-service/src/main/java/.../repository/entity/DiscoveryRunRepository.java` | arch-model-service | TG2 |
| `architecture-model-service/src/main/java/.../service/DiscoveryRunService.java` | arch-model-service | TG2 |
| `architecture-model-service/src/main/java/.../controller/DiscoveryRunController.java` | arch-model-service | TG2 |
| `discovery-service/src/services/archModelClient.ts` | discovery-service | TG3 |
| `discovery-service/src/services/runManager.ts` | discovery-service | TG4 |
| `discovery-service/src/routes/runs.ts` | discovery-service | TG4 |
| `mcp-server/src/types/saveDiscoveryRun.ts` | mcp-server | TG5 |
| `mcp-server/src/services/discoveryRunService.ts` | mcp-server | TG5 |
| `mcp-server/src/routes/saveDiscoveryRunRoute.ts` | mcp-server | TG5 |

### Modified Files
| File | Service | Task Group |
|------|---------|------------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | arch-model-service | TG1 |
| `discovery-service/src/routes/index.ts` | discovery-service | TG4 |
| `mcp-server/src/services/archModelClient.ts` | mcp-server | TG5 |
| `mcp-server/src/routes/tools.ts` | mcp-server | TG5 |
| `gateway/src/routes/discovery.ts` | gateway | TG6 |
| `docker-compose.yml` | infrastructure | TG7 |
