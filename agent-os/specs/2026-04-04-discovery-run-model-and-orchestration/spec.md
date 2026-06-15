# Specification: Discovery Run Model and Orchestration

## Goal
Introduce a first-class discovery run entity and orchestration plumbing so that Phase 1 execution (steps 1a-1d) is explicit, trackable, and stateful -- decoupled from chat and driven by persisted Phase 0 outputs. This is Increment 5 of 16; all Phase 1 steps remain stubs returning placeholder responses.

## User Stories
- As a platform operator, I want to create and start a discovery run for a project so that Phase 1 code-repo analysis is tracked as an explicit, auditable execution rather than implicit chat state.
- As a gateway consumer, I want to poll the status of a discovery run so that I can determine when all steps have completed (or failed) without managing step sequencing myself.

## Specific Requirements

**Liquibase Migration 065-discovery-run.sql**
- New `discovery_run` table following the `064-discovery-config.sql` pattern exactly (UUID PK, project_id FK with ON DELETE CASCADE, JSONB columns, status TEXT, timestamps)
- Columns: `id` (UUID PK), `project_id` (UUID NOT NULL FK to project), `status` (TEXT NOT NULL DEFAULT 'PENDING'), `current_step` (TEXT), `config_snapshot` (JSONB NOT NULL), `steps_payload` (JSONB NOT NULL DEFAULT '{}'), `error_message` (TEXT), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW()), `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- No unique index on project_id (multiple historical runs per project); add a non-unique index on project_id for query performance
- Add the changeSet entry to `db.changelog-master.yaml` as id `065-discovery-run` with `preConditions: not tableExists: discovery_run`, following the 064 entry format exactly
- `config_snapshot` stores the full Phase 0 discovery config JSON snapshotted at run creation time for immutability and reproducibility
- `steps_payload` stores per-step status tracking as JSONB: `{ "1a": { "status": "pending" }, "1b": { "status": "pending" }, "1c": { "status": "pending" }, "1d": { "status": "pending" } }`

**DiscoveryRunEntity JPA Entity**
- Follow `DiscoveryConfigEntity.java` pattern: `@Entity`, `@Table`, Lombok annotations (`@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`), `@PrePersist`/`@PreUpdate` for timestamps
- Use `@Type(JsonType.class)` with `columnDefinition = "jsonb"` for both `configSnapshot` and `stepsPayload` fields, typed as `Map<String, Object>`
- `status` field as String with `@Builder.Default` value `"PENDING"`
- `stepsPayload` gets a `@Builder.Default` that initializes all four steps (1a, 1b, 1c, 1d) with status `"pending"`

**DiscoveryRunDto Record**
- Java record following `DiscoveryConfigDto.java` pattern with `@JsonProperty` snake_case mapping
- Fields: `id`, `projectId`, `status`, `currentStep`, `configSnapshot`, `stepsPayload`, `errorMessage`, `createdAt`, `updatedAt`

**DiscoveryRunRepository**
- Spring Data JPA repository interface extending `JpaRepository<DiscoveryRunEntity, UUID>` following `DiscoveryConfigRepository.java`
- Custom finders: `List<DiscoveryRunEntity> findByProjectId(UUID projectId)`, `List<DiscoveryRunEntity> findByProjectIdAndStatusIn(UUID projectId, Collection<String> statuses)`, `Optional<DiscoveryRunEntity> findById(UUID id)`

**DiscoveryRunService**
- `@Service` with `@ConditionalOnProperty(name = "app.features.include-database")` and `@RequiredArgsConstructor` following `DiscoveryConfigService.java`
- `createRun(UUID projectId)`: validates no active run exists for project (query by projectId + status in [PENDING, RUNNING]); fetches the project's discovery config via `DiscoveryConfigRepository`; rejects if config is missing or status is not COMPLETE; snapshots `configPayload` into `configSnapshot`; creates entity with status PENDING; returns DTO
- `getRun(UUID runId)`: returns DTO by id or null
- `getRunsByProject(UUID projectId)`: returns list of DTOs ordered by createdAt descending
- `updateRun(UUID runId, String status, String currentStep, Map<String, Object> stepsPayload, String errorMessage)`: updates the specified fields; validates status is one of PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
- Active-run constraint enforced at service layer (not DB unique index) since multiple historical runs share the same project_id

**DiscoveryRunController**
- `@RestController` at `/api/model/projects/{projectId}/discovery/runs` following `DiscoveryConfigController.java`
- `POST /` -- create a new run (calls `createRun`); returns 200 with DTO; returns 409 if active run exists; returns 400 if config not COMPLETE
- `GET /` -- list runs for project (calls `getRunsByProject`); returns 200 with array
- `GET /{runId}` -- get single run (calls `getRun`); returns 200 with DTO or 404
- `PUT /{runId}` -- update run status/step/payload (calls `updateRun`); request body includes status, currentStep, stepsPayload, errorMessage; returns 200 with updated DTO

**Discovery-Service Run Manager**
- New `services/runManager.ts` module in discovery-service that owns internal step sequencing
- `startRun(projectId, runId)`: async function that progresses through steps 1a, 1b, 1c, 1d sequentially; before each step, updates run status to RUNNING and currentStep via HTTP call to architecture-model-service; calls the existing Phase 1 stub route logic internally (reuse the stub response shape, not HTTP self-call); after each step, updates the step's entry in stepsPayload to `completed`; on final step completion, sets overall status to COMPLETED
- On any step failure: set the failing step status to `failed`, set overall run status to FAILED, record error_message, and stop (fail-fast, no retry)
- The run manager calls the architecture-model-service REST API (PUT endpoint on DiscoveryRunController) to persist state after each step transition, using the `ARCHITECTURE_MODEL_SERVICE_BASE_URL` from discovery-service config

**Discovery-Service HTTP Client for Architecture-Model-Service**
- New `services/archModelClient.ts` in discovery-service (similar to `mcp-server/src/services/archModelClient.ts` pattern) using axios or node-fetch
- Methods: `createDiscoveryRun(projectId)`, `updateDiscoveryRun(projectId, runId, payload)`, `getDiscoveryRun(projectId, runId)`, `getDiscoveryConfig(projectId)`
- Base URL from `ARCHITECTURE_MODEL_SERVICE_BASE_URL` config value (already declared in discovery-service config.ts)

**Discovery-Service Run Endpoints**
- New route file `routes/runs.ts` mounted at `/discovery/runs` via the routes barrel (`routes/index.ts`)
- `POST /` -- accepts `{ projectId }`, calls archModelClient to create run in architecture-model-service, then kicks off `startRun()` asynchronously (fire-and-forget, run executes in background), returns the created run DTO immediately with status PENDING
- `GET /:runId` -- accepts `projectId` as query param, calls archModelClient to fetch run from architecture-model-service, returns run DTO or 404
- Validate projectId as non-empty string in both endpoints

**Gateway Discovery Run Routes**
- Extend `gateway/src/routes/discovery.ts` (currently minimal capability descriptor) with new proxy routes for run operations
- `POST /runs` -- proxies to discovery-service `POST /discovery/runs` with `{ projectId }` body; uses fetch with `discoveryServiceBaseUrl` from gateway config
- `GET /runs/:runId?projectId=<uuid>` -- proxies to discovery-service `GET /discovery/runs/:runId?projectId=<uuid>`
- Follow the existing gateway proxy pattern: structured error logging, 503 for network errors, transparent response forwarding
- The gateway routes are mounted at `/api/v1/discovery` (already configured in `server.ts` line 63)

**MCP save_discovery_run Tool**
- New MCP tool endpoint at `/mcp/tools/save_discovery_run` following `saveDiscoveryConfigRoute.ts` and `discoveryConfigService.ts` patterns
- Route: `POST /` accepting `{ sessionId, projectId, discoveryRunJson }` where discoveryRunJson is a stringified JSON object with run fields (status, currentStep, stepsPayload, errorMessage)
- Service: `saveDiscoveryRun(projectId, discoveryRunJson)` with payload size validation (500KB), JSON parsing, object validation, project existence check, then persist via `archModelClient.updateDiscoveryRun` or `archModelClient.createDiscoveryRun`
- Add `saveDiscoveryRun` and `getDiscoveryRun` methods to `mcp-server/src/services/archModelClient.ts` following the `saveDiscoveryConfig`/`getDiscoveryConfig` method pair

**Docker Compose Update**
- Add `depends_on` for the discovery-service container to depend on the architecture-model-service, since discovery-service now makes real HTTP calls to persist run state

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**DiscoveryConfigEntity persistence stack (architecture-model-service)**
- `DiscoveryConfigEntity.java` is the direct template for `DiscoveryRunEntity` -- same UUID PK, project_id FK, JSONB `@Type(JsonType.class)` column, status string, Lombok annotations, `@PrePersist`/`@PreUpdate` timestamp hooks
- `DiscoveryConfigDto.java` record pattern with `@JsonProperty` snake_case mapping is the template for `DiscoveryRunDto`
- `DiscoveryConfigRepository.java` interface extending `JpaRepository` with custom `findByProjectId` is the template for `DiscoveryRunRepository` (extended with `findByProjectIdAndStatusIn`)
- `DiscoveryConfigService.java` service with `@ConditionalOnProperty`, `@Transactional`, status validation, and entity-to-DTO mapping is the template for `DiscoveryRunService`
- `DiscoveryConfigController.java` with inner request record, `@RequestMapping` at project-scoped path, PUT and GET handlers is the template for `DiscoveryRunController`

**Liquibase migration 064-discovery-config.sql**
- SQL structure (CREATE TABLE IF NOT EXISTS, FK constraint, index creation, COMMENT ON statements) is the exact template for `065-discovery-run.sql`
- The `db.changelog-master.yaml` entry format (changeSet id, preConditions with `not: tableExists`, sqlFile path) must be replicated for the 065 entry

**MCP save_discovery_config tool chain (mcp-server)**
- `saveDiscoveryConfigRoute.ts` route structure (sessionId/projectId/JSON-string validation, delegation to service, 400/502 error handling) is the template for the `save_discovery_run` route
- `discoveryConfigService.ts` orchestration flow (size validation, JSON parse, object check, project existence, persist) is the template for the `saveDiscoveryRun` service
- `archModelClient.ts` methods `saveDiscoveryConfig` and `getDiscoveryConfig` (PUT/GET with encoded projectId, AxiosError handling) are the templates for `saveDiscoveryRun`/`getDiscoveryRun` methods

**Discovery-service Phase 1 stub routes and types**
- `routes/phase1.ts` step validation (VALID_STEPS array) and stub response shape (`{ phase, step, status: 'stub', projectId }`) should be reused by the run manager when executing each step internally
- `types/analyzerPack.ts` AnalyzerInput/AnalyzerResult types provide the eventual extension point that future increments will wire into the run sequencer
- `routes/index.ts` barrel pattern (Router mounting sub-routers) is the pattern for adding the new `/runs` routes

**Gateway discovery route and config**
- `gateway/src/routes/discovery.ts` is the existing file to extend with run proxy routes (currently only has a GET `/` capability descriptor)
- `gateway/src/config.ts` already has `discoveryServiceBaseUrl` configured at `http://localhost:8091` -- no new config needed
- `gateway/src/server.ts` already mounts discoveryRouter at `/api/v1/discovery` -- new run routes will be available at `/api/v1/discovery/runs` automatically

## Out of Scope
- Frontend UI for viewing, managing, or monitoring discovery runs
- WebSocket or streaming-based real-time step progress updates
- Retry or resume logic for failed steps (simple fail-fast in this increment)
- Rich run history, audit trail, or diff-between-runs features
- Real analyzer pack execution or code analysis (all steps remain stubs)
- Phase 2+ pipeline stages
- Authentication or authorization on discovery run endpoints
- Evidence schema or DecisionTask engine integration
- Log-based or hypothesis-first discovery approaches
- Transaction rollback across multi-step run execution (fail-fast, record failure, no compensation)
