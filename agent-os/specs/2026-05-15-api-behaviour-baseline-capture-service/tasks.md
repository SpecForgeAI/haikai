# Task Breakdown: API Behaviour Baseline Capture Service

## Overview
Total Task Groups: 11

A larger-than-typical spec spanning a new Node/TS microservice (`api-migration-validation-service`, port 8092), 7 new AMS tables and Java layers, gateway proxy + LLM tool-call relay, and a frontend wizard + sibling dashboard surface. Groups are ordered by dependency; later groups assume earlier groups are merged. Standing constraints (Liquibase immutability, no `discovery-service/src/**` edits during a discovery run, boxed PATCH types, secrets-never-persisted, `/rerun` excluded from v1) apply to every implementer.

## Task List

### Persistence Layer

#### Task Group 1: AMS Liquibase + JPA + Repositories (7 tables)
**Dependencies:** None
**Scope:** All durable persistence for the feature — 7 Liquibase changesets, 7 JPA entities, 7 repositories. No service or controller logic. Reuse the `065-073-discovery-*.sql` style.

- [x] 1.0 Complete AMS persistence layer
  - [x] 1.1 Write 2-8 focused tests for persistence
    - One repository round-trip test for `ApiBehaviourCaptureSession` (insert → findByProjectAndArchitecture → status update)
    - One JSONB round-trip test asserting `auth_config_redacted_json` survives serialize/deserialize via `@JdbcTypeCode(SqlTypes.JSON)`
    - One cascade-delete test confirming session delete cascades to `operations`, `scenarios`, `captures`, `diagnostics`
    - One baseline + items round-trip test (baseline insert with items, retrieval ordered by `created_at`)
    - Skip exhaustive coverage of all entities and edge cases
  - [x] 1.2 Add 7 new Liquibase changesets (NEW files only — DO NOT touch ≤127)
    - `128-api-behaviour-capture-sessions.sql` per spec column list, index on `(project_id, architecture_id, status)`
    - `129-api-behaviour-operations.sql` with `session_id` index
    - `130-api-behaviour-scenarios.sql` with `session_id` and `operation_id` indexes
    - `131-api-behaviour-captures.sql` with `session_id`, `scenario_id`, `operation_id` indexes
    - `132-api-behaviour-diagnostics.sql` with `session_id` index
    - `133-api-behaviour-baselines.sql` with `(project_id, architecture_id, status)` index
    - `134-api-behaviour-baseline-items.sql` with `baseline_id` index
    - All `*_json` columns as `JSONB`; status as `TEXT NOT NULL DEFAULT '...'`; `ON DELETE CASCADE` on session-owned rows; `COMMENT ON TABLE/COLUMN`
    - Register each as a separate `changeSet` block in `db.changelog-master.yaml`
  - [x] 1.3 Create 7 JPA entities under `com.example.architecturemodel.model.entity.apibehaviour`
    - One entity per table; UUID PKs; `@JdbcTypeCode(SqlTypes.JSON)` for every `*_json` column
    - Status fields as `String` with Javadoc listing valid values
    - Numeric/boolean PATCH-mutable fields use boxed types (`Integer`, `Long`, `Boolean`)
    - `@CreationTimestamp` / `@UpdateTimestamp` on `created_at` / `updated_at`
  - [x] 1.4 Create 7 Spring Data repositories under `com.example.architecturemodel.repository.apibehaviour`
    - Extend `JpaRepository<Entity, UUID>`
    - Custom finders: `findByProjectIdAndArchitectureIdOrderByCreatedAtDesc` on sessions and baselines; `findBySessionIdOrderByCreatedAtAsc` on operations/scenarios/captures/diagnostics; `findByBaselineIdOrderByCreatedAtAsc` on baseline items
  - [x] 1.5 Run ONLY the persistence tests written in 1.1
    - Verify Liquibase migrations apply cleanly from a fresh DB
    - Verify cascade deletes fire as designed
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- All 7 changesets apply cleanly with checksums recorded; no edit to changesets ≤127
- `db.changelog-master.yaml` registers all 7 new changesets as discrete `changeSet` blocks
- JSONB columns round-trip through entities without data loss
- Cascade deletes work for all session-owned rows

---

### AMS Service + Controller Layer

#### Task Group 2: AMS DTOs, Mappers, Services, Controllers (CRUD for all 7 entities)
**Dependencies:** Task Group 1
**Scope:** Java service layer + REST controllers exposing AMS-direct CRUD for all 7 tables. PATCH semantics with boxed-type DTOs and null-guards.

- [x] 2.0 Complete AMS service + controller layer
  - [x] 2.1 Write 2-8 focused tests for AMS controllers
    - One MockMvc test for `POST /api/projects/{projectId}/api-behaviour/capture-sessions` happy path
    - One MockMvc test for PATCH on capture session with a partial body (verify boxed-type fields not wiped — covers the primitive-double pitfall)
    - One MockMvc test for `GET /api/projects/{projectId}/api-behaviour/baselines` returning ordered list
    - One MockMvc test for nested baseline-items endpoint returning items for a baseline
    - Skip exhaustive coverage of all 7 controllers
  - [x] 2.2 Create DTOs under `model.dto.apibehaviour`
    - Request + response DTO per entity
    - All numeric/boolean PATCH-mutable fields as boxed types (`Integer`, `Long`, `Boolean`)
    - JSONB fields typed as `JsonNode` or `Map<String, Object>`
  - [x] 2.3 Create mappers under `mapper.apibehaviour`
    - Entity ↔ DTO conversion; manual mapping (match existing AMS convention; do not introduce MapStruct if not already used in package)
  - [x] 2.4 Create services under `service.apibehaviour`
    - One service class per aggregate root: `ApiBehaviourCaptureSessionService`, `ApiBehaviourOperationService`, `ApiBehaviourScenarioService`, `ApiBehaviourCaptureService`, `ApiBehaviourDiagnosticService`, `ApiBehaviourBaselineService`, `ApiBehaviourBaselineItemService`
    - PATCH handlers null-guard EVERY field (per primitive-wipe pitfall)
    - Status transitions enforced at service layer (e.g. session can only move `draft → configured → running → terminal`)
  - [x] 2.5 Create controllers under `controller.apibehaviour`
    - Routes under `/api/projects/{projectId}/api-behaviour/capture-sessions`, `/operations`, `/scenarios`, `/captures`, `/diagnostics`, `/baselines`, `/baseline-items` (nested where appropriate; sessions/baselines top-level under project)
    - Standard CRUD verbs; partial-update via PATCH
    - Reuse the `:projectId`/`:architectureId` URL safety property from existing AMS controllers
  - [x] 2.6 Run ONLY the controller tests written in 2.1
    - Verify PATCH does NOT wipe untouched boxed numeric fields
    - Verify status transition guards reject invalid moves

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- PATCH semantics safe for all boxed numeric/boolean fields
- All 7 entities reachable via REST under `/api/projects/{projectId}/api-behaviour/...`
- Status transition guards reject illegal moves

---

### Gateway Proxy Layer

#### Task Group 3: Gateway CRUD proxy + LLM tool-call relay endpoint
**Dependencies:** Task Group 2
**Scope:** New `gateway/src/routes/apiMigrationValidation.ts` for AMS-direct CRUD proxies, plus the `POST /api/v1/api-migration-validation/llm-tool-loop` relay. Action-endpoint proxies are deferred to Group 7 once the new service exposes them.

- [x] 3.0 Complete gateway CRUD proxy + LLM relay
  - [x] 3.1 Write 2-8 focused tests for gateway proxies + relay
    - One test proxying `GET /capture-sessions` to AMS (mock axios → assert URL forwarded with `:projectId` and `:architectureId` preserved)
    - One test asserting an `:architectureId`-missing route 404s at Express layer (no fallback resolution — mirrors `discovery.ts` pattern)
    - One test for `POST /llm-tool-loop` happy path: relays one provider round-trip, returns assistant message with `tool_calls`
    - One test for `/llm-tool-loop` provider-error pass-through (e.g. provider returns 429 → gateway surfaces error shape)
    - Skip exhaustive per-route coverage
  - [x] 3.2 Create `gateway/src/routes/apiMigrationValidation.ts`
    - Mirror structure of `gateway/src/routes/discovery.ts`
    - Proxy routes for all 7 AMS CRUD surfaces under `/api/v1/projects/:projectId/architectures/:architectureId/api-behaviour/...`
    - Forgetting `:architectureId` MUST 404 at Express layer (no fallback)
  - [x] 3.3 Implement `POST /api/v1/api-migration-validation/llm-tool-loop` relay
    - Body schema: `{ messages: ChatMessage[], tools: ToolDefinition[], toolChoice?: 'auto'|'none'|{type:'function',function:{name:string}}, model?: string }`
    - Response: `{ message: AssistantMessage, usage?: TokenUsage }` (assistant message may include `tool_calls`)
    - Relay through existing `gateway/src/services/llmClient.ts` provider abstraction (NOT `toolExecutor.ts`)
    - Thin pass-through: gateway does ONE provider round-trip; loop control lives in the new service
    - Honour existing `LLM_PROVIDER` env (OpenAI / Azure OpenAI both work)
  - [x] 3.4 Wire route into gateway entry point
    - Register router in main gateway router file (mirror how `discovery.ts` is registered)
  - [x] 3.5 Run ONLY the gateway tests written in 3.1
    - Verify proxy URL construction
    - Verify relay does not implement loop logic (no round-counter in gateway)

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- All 7 AMS CRUD surfaces reachable through gateway with project + architecture URL safety
- LLM relay is a thin single-round-trip pass-through (no tool execution, no round-counter)
- Provider config inherited from existing `llmClient.ts` abstraction

---

### New Microservice Foundation

#### Task Group 4: api-migration-validation-service scaffold + clients + helpers
**Dependencies:** Task Group 3 (so AMS CRUD via gateway is reachable for end-to-end work; scaffold itself is independent)
**Scope:** New service folder, Dockerfile, package.json, config, axios clients, redaction + HTTP helpers. No tools or loop yet — that lands in Groups 5-6. OAS parsing + DbAdapter included here as foundation pieces.

- [x] 4.0 Complete new microservice foundation
  - [x] 4.1 Write 2-8 focused tests for foundation
    - One health-route test (`GET /health` returns `{ status: 'ok', timestamp }`)
    - One config-load test asserting all 7 env vars defaulted correctly (`PORT`, `ARCHITECTURE_MODEL_SERVICE_BASE_URL`, `GATEWAY_BASE_URL`, `OAS_SPECS_DIR`, `LLM_SCENARIO_ROUND_LIMIT`, `LLM_TOOL_CALL_TIMEOUT_MS`, `LLM_SCENARIO_WALL_CLOCK_MS`)
    - One OAS parser test using `@apidevtools/swagger-parser` against a small fixture spec — asserts dereferenced inventory shape
    - One redactor test confirming bearer tokens, basic-auth values, custom-header secrets, and DB passwords are stripped to `[REDACTED]`
    - One `PostgresAdapter` test against a mocked `pg` client confirming `LIMIT` injection and `SET statement_timeout`
    - One `SybaseAdapter.stub` test asserting every method throws `Error('Sybase support is not yet implemented in v1')`
    - Skip live HTTP and live DB tests at this stage
  - [x] 4.2 Scaffold `api-migration-validation-service/` mirroring `discovery-service/`
    - `src/{config.ts, index.ts, middleware/, routes/, services/, types/, utils/, __tests__/}`
    - `Dockerfile.dev` (Node 20 alpine, `tsx watch` style matching `discovery-service/Dockerfile.dev`)
    - `package.json` deps: `axios`, `express`, `dotenv`, `uuid`, `@apidevtools/swagger-parser`, `openapi-types`, `pg`
    - Dev deps: `jest`, `ts-jest`, `tsx`, `typescript`, `supertest`, `@types/*`
    - `tsconfig.json`, `jest.config.js` mirroring discovery-service
  - [x] 4.3 Implement `src/config.ts`
    - Env vars per spec; `dotenv` loaded; defaults: `PORT=8092`, `ARCHITECTURE_MODEL_SERVICE_BASE_URL=http://localhost:8080`, `GATEWAY_BASE_URL=http://localhost:8081`, `LLM_SCENARIO_ROUND_LIMIT=12`, `LLM_TOOL_CALL_TIMEOUT_MS=30000`, `LLM_SCENARIO_WALL_CLOCK_MS=300000`
  - [x] 4.4 Implement `src/index.ts`
    - Express app, request-logger + error-handler middleware (match discovery-service mount order)
    - Mount router at `/api-migration-validation`
    - `GET /health` returning `{ status: 'ok', timestamp }`
  - [x] 4.5 Implement `src/routes/index.ts` barrel router
    - Empty stubs for action endpoints (filled in Group 6)
  - [x] 4.6 Implement `src/services/archModelClient.ts`
    - Axios client targeting `ARCHITECTURE_MODEL_SERVICE_BASE_URL`
    - Functions: read existing `Interface` rows for an architecture, write capture-session/operation/scenario/capture/diagnostic/baseline/baseline-item rows
    - Mirror `discovery-service/src/services/archModelClient.ts` shape and error taxonomy
  - [x] 4.7 Implement `src/services/gatewayClient.ts`
    - Axios client targeting `GATEWAY_BASE_URL`
    - Function: `callLlmToolLoop({ messages, tools, toolChoice?, model? })` posting to `/api/v1/api-migration-validation/llm-tool-loop`
    - Mirror discovery-service gateway client error taxonomy
  - [x] 4.8 Implement `src/services/redactor.ts`
    - Strip auth headers (`Authorization`, custom configured names), DB passwords, bearer tokens to `[REDACTED]`
    - Pure functions reused by both axios interceptors and AMS-write flows
  - [x] 4.9 Implement HTTP helpers
    - Axios instance per session with auth-injection request interceptor and redaction-on-log response interceptor
    - Per-call timeout from session config
    - Response truncation marker for large bodies
  - [x] 4.10 Implement OAS parser at `src/services/oasParser.ts`
    - `@apidevtools/swagger-parser` for parse + dereference + validate
    - Output shape: `{ operationId, method, path, summary, description, requestSchema, responseSchema, oasOperation }[]`
    - In-memory only; no persistence here (persistence happens via `archModelClient` write in Group 6)
  - [x] 4.11 Implement DB adapter layer
    - `src/services/db/DbAdapter.ts` interface: `testConnection()`, `listMetadata(allowlist)`, `runReadonlySelect(sql, params, limits)`, `sampleValues(table, column, limits)`, `dispose()`
    - `src/services/db/PostgresAdapter.ts` — full v1 impl using `pg`; pooled connections per session; `SET statement_timeout` per query; explicit `LIMIT` injection if absent; SELECT-only statement parser (rejects `INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXEC|CALL|GRANT|REVOKE|CREATE|;.*;`)
    - `src/services/db/SybaseAdapter.stub.ts` — every method throws `Error('Sybase support is not yet implemented in v1')`
    - `src/services/db/dbAdapterFactory.ts` returning the right adapter from `dbType`
  - [x] 4.12 Implement in-memory `runManager` + `secretsStore`
    - `runManager`: `Map<sessionId, RunState>` — live run handle, abort signal, round counter, wall-clock start
    - `secretsStore`: `Map<sessionId, SecretsBundle>` — purged on terminal status; never logged
  - [x] 4.13 Implement startup reconciliation
    - On boot, query AMS for sessions with `status='running'`; mark each `failed` with `error_message='secrets_lost_during_run'`
  - [x] 4.14 Run ONLY the foundation tests written in 4.1
    - Verify health, config, OAS parser, redactor, PostgresAdapter, SybaseAdapter stub
    - Do NOT run the entire suite

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Service starts on port 8092 with `/health` returning `ok`
- All env vars default per spec; OAS parser returns dereferenced inventory
- PostgresAdapter enforces SELECT-only and limits; Sybase stub throws as designed
- Redactor strips secrets in all expected positions
- Startup reconciliation marks orphaned `running` sessions `failed`

---

### LLM Loop + Tool Registry

#### Task Group 5: LLM tool-call loop, 8-tool registry, guardrails
**Dependencies:** Task Group 4 (foundation) and Task Group 3 (gateway relay)
**Scope:** The reasoning + execution loop. Implements the per-scenario round-trip with the gateway LLM relay, the 8 tool functions, redaction-before-LLM, and the three hard limits.

- [x] 5.0 Complete LLM loop + tool registry
  - [x] 5.1 Write 2-8 focused tests for loop + tools
    - One test of the captureLoopRunner against a stubbed gatewayClient — verifies one round-trip, tool call dispatched, result fed back, terminates on `record_capture_note`
    - One test asserting the **12-round** hard cap fires and emits `retry_exhausted` diagnostic
    - One test asserting the **30s per-tool-call** timeout fires and emits `llm_generation_failure` diagnostic
    - One test asserting the **5min scenario wall-clock** fires and marks scenario `executed_error`
    - One test for `execute_http_request` gating: rejects mutating verb when `mutating_calls_confirmed=false`
    - One test for `run_readonly_sql`: rejects `DELETE FROM x; SELECT 1;` (statement parser blocks non-single-SELECT)
    - One test asserting tool outputs pass through `redactor` before being fed back to the LLM
    - Skip exhaustive coverage of every tool's happy path
  - [x] 5.2 Implement tool registry under `src/services/tools/`
    - `list_oas_operations.ts` — pure in-memory read of parsed inventory
    - `get_oas_operation_detail.ts` — pure in-memory read
    - `list_db_metadata.ts` — `information_schema` read via `DbAdapter`, allowlist-bounded
    - `sample_db_values.ts` — `DbAdapter.sampleValues` with row + timeout limits
    - `run_readonly_sql.ts` — `DbAdapter.runReadonlySelect` with SELECT-only statement parser (rejects `INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXEC|CALL|GRANT|REVOKE|CREATE|;.*;`)
    - `execute_http_request.ts` — operations gated on `included=TRUE AND safe_to_execute=TRUE`; verb gated by `mutating_calls_confirmed`; auth injected from secrets bundle; max 3 retries per scenario; large response truncation marker
    - `record_scenario_candidate.ts` — writes scenario row via `archModelClient`; pre-redacted
    - `record_capture_note.ts` — writes diagnostic note via `archModelClient`; pre-redacted
    - All tools return outputs through `redactor` before yielding to the LLM
  - [x] 5.3 Implement `src/services/captureLoopRunner.ts`
    - Per-scenario loop: round-trip with `gatewayClient.callLlmToolLoop`, dispatch returned `tool_calls` to registered tools, feed results back as tool messages
    - Hard limits enforced: 12 rounds (`LLM_SCENARIO_ROUND_LIMIT`), 30s per tool call (`LLM_TOOL_CALL_TIMEOUT_MS`), 5min wall-clock (`LLM_SCENARIO_WALL_CLOCK_MS`)
    - On limit breach: emit appropriate diagnostic (`retry_exhausted` / `llm_generation_failure`), mark scenario `executed_error`, continue to next scenario
    - LLM is planner-only — never executes HTTP/SQL directly
  - [x] 5.4 Implement `src/services/captureSessionOrchestrator.ts`
    - Top-level session driver: parse OAS → build operation inventory → for each included operation, generate scenario set → drive `captureLoopRunner` per scenario → write captures + diagnostics → mark session `completed` or `failed`
  - [x] 5.5 Run ONLY the loop + tool tests written in 5.1
    - Verify all three hard limits trip correctly
    - Verify SELECT-only statement parser rejects mixed statements
    - Verify mutating verbs blocked without confirmation

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- All 8 tools implemented and routed through the redactor before LLM feedback
- Three hard limits (12 rounds / 30s / 5min) enforced and produce the right diagnostics
- LLM never executes HTTP or SQL directly

---

### Action Endpoints + Gateway Proxy

#### Task Group 6: New service action endpoints + gateway action proxies
**Dependencies:** Task Group 5
**Scope:** HTTP entry points on the new service for orchestration, plus gateway proxy routes that forward to them. Closes the back-end loop — frontend can now drive the service end-to-end.

- [x] 6.0 Complete action endpoints + gateway proxies
  - [x] 6.1 Write 2-8 focused tests for action endpoints + proxies
    - One supertest test for `POST /capture-sessions/{id}/parse-oas` happy path (selected `Interface` rows → operations rows written via mocked `archModelClient`)
    - One supertest test for `POST /capture-sessions/{id}/test-api-connection` (mocked HTTP returns 200 → success response)
    - One supertest test for `POST /capture-sessions/{id}/test-db-connection` happy path (mocked PostgresAdapter)
    - One supertest test for `POST /capture-sessions/{id}/start` rejecting if status not `configured`
    - One supertest test for `POST /capture-sessions/{id}/cancel` setting status `cancelled` and clearing secrets
    - One gateway proxy test for any one action proxy verifying URL forwarding
    - Skip exhaustive per-action coverage
  - [x] 6.2 Implement action routes under `src/routes/captureSessionActions.ts`
    - `POST /api/capture-sessions/{id}/parse-oas` — reads `Interface` records via `archModelClient` OR accepts ad-hoc upload (multipart); parses + dereferences; writes inventory to `api_behaviour_operations`; raw bytes NOT persisted
    - `POST /api/capture-sessions/{id}/test-api-connection` — uses in-memory secrets; one redacted-logged probe call
    - `POST /api/capture-sessions/{id}/test-db-connection` — uses `DbAdapter.testConnection()`
    - `POST /api/capture-sessions/{id}/start` — guards on status=`configured` AND in-memory secrets present; transitions to `running`; spawns `captureSessionOrchestrator`
    - `POST /api/capture-sessions/{id}/cancel` — sets status `cancelled`, signals abort to live runManager entry, purges secrets
    - `POST /api/capture-sessions/{id}/secrets` — populates in-memory secrets bundle (re-entry path); NEVER writes to AMS
  - [x] 6.3 Wire action routes into `src/routes/index.ts` barrel
  - [x] 6.4 Add gateway proxy routes for action endpoints
    - In `gateway/src/routes/apiMigrationValidation.ts`, add proxies for `/parse-oas`, `/test-api-connection`, `/test-db-connection`, `/start`, `/cancel`, `/secrets`
    - Mirror `discovery.ts` proxy pattern; preserve `:projectId` + `:architectureId` URL safety
  - [x] 6.5 Run ONLY the action endpoint tests written in 6.1
    - Verify status guards on start
    - Verify cancel purges secrets
    - Verify gateway proxy URL forwarding

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- All action endpoints reachable via gateway under `/api/v1/...`
- Status guards enforced on start/cancel
- Secrets purged on terminal transitions

---

### Frontend Capture Wizard + Launcher

#### Task Group 7: Frontend API client + 5-step capture wizard + ManageArchitecturesModal launcher
**Dependencies:** Task Group 6
**Scope:** Frontend axios client for both AMS CRUD (via gateway) and action endpoints, the 5-step `StartCaptureSessionWizard`, and the launcher button placement.

- [x] 7.0 Complete capture wizard + launcher
  - [x] 7.1 Write 2-8 focused tests for wizard + launcher
    - One test of `apiBehaviourClient` confirming `createCaptureSession` POSTs to the right gateway URL
    - One Vitest test mounting `StartCaptureSessionWizard` and asserting Step 1 → Step 2 advance is blocked when no `Interface` is selected
    - One test asserting the Sybase option in step 3's DB-type dropdown is disabled and shows the "not yet implemented in v1" tooltip
    - One test asserting the mutating-call confirmation toggle is editable in step 2/4 while session is `draft` and locked once `configured`
    - One test asserting the launcher button in `ManageArchitecturesModal` opens the wizard pre-bound to row's `projectId` + `architectureId`
    - Skip exhaustive per-step validation coverage
  - [x] 7.2 Implement `frontend/src/api/apiBehaviourClient.ts`
    - All AMS CRUD calls through gateway (capture-sessions, operations, scenarios, captures, diagnostics, baselines, baseline-items)
    - Action calls: `parseOas`, `testApiConnection`, `testDbConnection`, `start`, `cancel`, `submitSecrets`
    - LLM relay surface NOT called from frontend (only the new service uses it)
  - [x] 7.3 Build `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
    - Pattern reused from `StartDiscoveryRunModal.tsx` and `SelectiveCopyWizardModal.tsx` (stepper header, per-step validation, Next/Back/Cancel/Start strip, Cancel-confirmation)
    - Step 1: select architecture (pre-bound from launcher) + multi-select existing `Interface` rows OR ad-hoc OAS upload
    - Step 2: API env name, base URL, auth type, auth config, default headers; mutating-call confirmation toggle
    - Step 3: optional DB sampling — DB type dropdown (Postgres enabled, Sybase disabled with tooltip "not yet implemented in v1"), connection details, allowlist
    - Step 4: endpoint inclusion — table of parsed operations from `parse-oas`; toggleable `included`; mutating ops auto-`included=FALSE` if confirmation off, with "excluded — mutating not confirmed" marker
    - Step 5: start summary — shows redacted config, scenario plan, then `Start` calls `/start`
    - Mutating-confirmation toggle locked once session moves to `configured`
  - [x] 7.4 Add launcher button to `frontend/src/components/TopBar/ManageArchitecturesModal.tsx`
    - Per-row "Capture API Behaviour Baseline" action; opens `StartCaptureSessionWizard` pre-bound to row's `projectId` + `architectureId`
  - [x] 7.5 Run ONLY the wizard + launcher tests written in 7.1
    - Verify Sybase tooltip + disabled state
    - Verify mutating-confirmation lock behaviour
    - Verify launcher pre-binds project + architecture

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Wizard advances step-by-step with validation
- Sybase visible-but-disabled with tooltip
- Mutating-confirmation locks at `configured`
- Launcher reachable from `ManageArchitecturesModal`

---

### Frontend Sibling Page

#### Task Group 8: "API Behaviour Baselines" sibling dashboard page (list + detail)
**Dependencies:** Task Group 6 (parallel-friendly with Group 7)
**Scope:** Durable list/detail surface for capture sessions and saved baselines, mirroring Discovery's sibling-page pattern. List page + capture session detail view + baseline detail view + 2–3s polling while running.

- [x] 8.0 Complete sibling dashboard page
  - [x] 8.1 Write 2-8 focused tests for list + detail views
    - One test of `ApiBaselinesListPage` rendering both capture-sessions list and saved-baselines list
    - One test of `CaptureSessionDetailView` polling at 2–3s cadence while session status is `running`, and stopping polling on terminal status
    - One test of the secret-loss UX: idle session with no in-memory secrets shows "Re-enter secrets" inline prompt and blocks execution actions
    - One test of the "secrets-lost-during-run" detail view showing both CTAs ("Clone configuration", "Re-enter secrets and start a new run")
    - Skip exhaustive route + render coverage
  - [x] 8.2 Build `frontend/src/components/DashboardView/ApiBaselinesListPage.tsx`
    - Sibling page under the architecture/project area; mirror `DiscoveryListPage.tsx` layout
    - Two sub-lists: `CaptureSessionsList` (active + historical) and `BaselinesList` (durable saved baselines)
  - [x] 8.3 Build `CaptureSessionsList.tsx` and `BaselinesList.tsx`
    - Reuse `DiscoveryRunsList.tsx` row + status-badge patterns
    - Click row → navigate to detail page
  - [x] 8.4 Build `CaptureSessionDetailPage.tsx` + `CaptureSessionDetailView.tsx`
    - Mirror `DiscoveryRunDetailPage.tsx` + `DiscoveryRunDetailView.tsx`
    - 2–3s polling loop while status=`running`; stop on terminal status (matches Discovery polling cadence; no SSE/WebSocket)
    - Secret-loss UX:
      - Idle session (`configured`/`completed`/`failed`/`cancelled`) with no in-memory secrets → execution actions blocked behind inline "Re-enter secrets" prompt that calls `/secrets` to repopulate in-memory bundle without writing to AMS
      - Session marked `failed` with `error_message='secrets_lost_during_run'` → show "Clone configuration" and "Re-enter secrets and start a new run" CTAs (both create a new draft session pre-filled from the failed session's redacted config; second one drops user into wizard step 2)
  - [x] 8.5 Build `BaselineDetailView.tsx`
    - Lists baseline items (operation × scenario × accepted request/response)
    - Read-only view of a saved baseline
  - [x] 8.6 Wire sibling page route into dashboard router
    - Match how Discovery's sibling page is wired
  - [x] 8.7 Run ONLY the list + detail tests written in 8.1
    - Verify polling cadence and stop-on-terminal
    - Verify secret-loss UX branching

**Acceptance Criteria:**
- The 2-8 tests written in 8.1 pass
- List page reachable as a sibling under architecture/project area
- Polling cadence matches Discovery (2–3s), stops on terminal status
- Both secret-loss flows surface the right CTAs

---

### Frontend Results Review + Save Baseline

#### Task Group 9: Capture review UX + save-baseline + secret-loss workflow polish
**Dependencies:** Task Groups 7 + 8
**Scope:** The endpoint/scenario review experience inside the capture session detail view: capture row table, scenario detail panel, accept/reject/rename/notes/mask actions, save-as-baseline modal. NO `/rerun` affordance per spec.

- [x] 9.0 Complete results review + save baseline
  - [x] 9.1 Write 2-8 focused tests for review + save
    - One test asserting the capture-row table renders captures grouped by operation × scenario
    - One test of the accept action — sends PATCH to capture endpoint with `accepted=true, accepted_at=...`
    - One test of the reject + reviewer-notes flow — PATCH with `accepted=false, reviewer_notes='...'`
    - One test of the rename + mask action persists scenario rename and field-level mask metadata
    - One test of the "Save as Baseline" flow creating a `Baseline` row + `BaselineItem` rows for accepted captures only
    - One test confirming NO `Rerun` button is rendered anywhere in the review UI (per spec — fully removed, no disabled placeholder)
    - Skip exhaustive interaction coverage
  - [x] 9.2 Build `CaptureReviewPanel.tsx` inside `CaptureSessionDetailView`
    - Capture-row table grouped by operation × scenario
    - Per-row actions: accept, reject + notes, rename scenario, mask response field(s)
    - Inline scenario detail expansion showing redacted request/response
    - NO `Rerun` action present anywhere — not even disabled
  - [x] 9.3 Build `SaveAsBaselineModal.tsx`
    - Inputs: baseline name, optional notes
    - Warns user if any operation has zero accepted captures
    - On submit: POST to AMS `baselines` endpoint, then bulk-create `baseline-items` for accepted captures
    - Success → navigate to `BaselineDetailView` for the new baseline
  - [x] 9.4 Implement field-mask metadata persistence
    - Mask actions write to `reviewer_notes` or a structured mask field on the capture row (PATCH to AMS)
    - Mask applied at render time — original redacted JSON unchanged
  - [x] 9.5 Polish secret-loss CTAs from Group 8
    - "Clone configuration" → POST to AMS to create a new draft session pre-filled from failed session's redacted config; navigate to wizard step 1
    - "Re-enter secrets and start a new run" → same clone, but drop user into wizard step 2 with config pre-filled
  - [x] 9.6 Run ONLY the review + save tests written in 9.1
    - Verify accept/reject/rename/mask flows
    - Verify save-as-baseline writes baseline + items
    - Verify no `Rerun` button anywhere

**Acceptance Criteria:**
- The 2-8 tests written in 9.1 pass
- Accept/reject/rename/notes/mask all functional
- Save-as-baseline creates baseline + items for accepted captures only
- No `Rerun` button rendered anywhere (per spec)
- Secret-loss CTAs route correctly through wizard

---

### Cache Invalidation Plumbing

#### Task Group 10: AppShell model cache invalidation for AMS-side writes
**Dependencies:** Task Groups 7, 8, 9
**Scope:** Per project memory note (AppShell holds a per-(project, architecture) in-memory model cache). Backend writes from the new service bypass the frontend dispatch and would leave the cache stale. This group ensures the relevant flows dispatch `LOAD_MODEL` (same-arch) or invalidate the cache (cross-arch) when capture sessions / baselines change.

- [x] 10.0 Complete cache invalidation plumbing
  - [x] 10.1 Write 2-8 focused tests for cache invalidation
    - One test asserting that completing a capture session triggers a `LOAD_MODEL` dispatch for the active `(projectId, architectureId)`
    - One test asserting that creating a new baseline invalidates the cache for `(projectId, architectureId)`
    - One test asserting that polling-cycle reads (mid-run) do NOT spam `LOAD_MODEL` dispatches (only on status change)
    - Skip exhaustive cache-state coverage
  - [x] 10.2 Identify cache-touching writes
    - Session status transitions to `completed` / `failed` / `cancelled`
    - Baseline create / update / archive
    - Baseline item add / remove
  - [x] 10.3 Wire dispatches in capture session detail view + save-baseline flow
    - On terminal-status detection in poll loop: dispatch `LOAD_MODEL` for current `(projectId, architectureId)`
    - On baseline create success in `SaveAsBaselineModal`: dispatch `LOAD_MODEL`
  - [x] 10.4 Run ONLY the cache invalidation tests written in 10.1
    - Verify dispatch fires on terminal status only (not on every poll)
    - Verify baseline create dispatches

**Acceptance Criteria:**
- The 2-8 tests written in 10.1 pass
- AppShell cache stays consistent with AMS state after session terminal transitions and baseline writes
- No dispatch spam during polling

---

### Cross-Stack Test Gap Review

#### Task Group 11: Test gap analysis + critical end-to-end coverage
**Dependencies:** Task Groups 1-10
**Scope:** Review the per-group tests written so far and add a maximum of 10 additional strategic tests to fill critical gaps. Focus on integration points and end-to-end workflows specific to this feature only.

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests from Task Groups 1-10
    - Group 1 persistence tests (2-8)
    - Group 2 AMS controller tests (2-8)
    - Group 3 gateway proxy + relay tests (2-8)
    - Group 4 new-service foundation tests (2-8)
    - Group 5 LLM loop + tool tests (2-8)
    - Group 6 action endpoint tests (2-8)
    - Group 7 wizard + launcher tests (2-8)
    - Group 8 list + detail tests (2-8)
    - Group 9 review + save tests (2-8)
    - Group 10 cache invalidation tests (2-8)
    - Total existing tests: approximately 20-80 tests
  - [x] 11.2 Analyze test coverage gaps for THIS feature only
    - End-to-end flow: launcher → wizard → parse-oas → start → run completes → review → save baseline
    - Secret-loss recovery flow: process restart → session marked failed → clone-config CTA → new draft session
    - LLM tool guardrail integration: confirm `execute_http_request` actually rejects mutating verbs at runtime when `mutating_calls_confirmed=false`
    - Sybase wizard option visibility (visible-but-disabled) confirmed in a real render
    - Skip exhaustive coverage of every action path; focus on workflow integration only
  - [x] 11.3 Write up to 10 additional strategic tests maximum
    - Suggested priorities (cap at 10):
      1. End-to-end happy-path integration: capture session lifecycle from create through baseline save (with mocked LLM + HTTP)
      2. Secret-loss-during-run recovery flow end-to-end (startup reconciliation → UI surfaces failed session → clone-config CTA)
      3. PATCH-doesn't-wipe-boxed-fields integration test exercising a multi-PATCH cycle on a capture session
      4. Mutating-call confirmation enforcement: end-to-end with confirmation off → mutating ops in inventory marked `included=FALSE` and `safe_to_execute=FALSE`
      5. SELECT-only guardrail end-to-end via `run_readonly_sql` tool through the loop
      6. LLM 12-round cap end-to-end producing `retry_exhausted` diagnostic and `executed_error` scenario
      7. Cancel mid-run purges secrets AND aborts in-flight tool call
      8. Save-as-baseline excludes rejected captures
      9. ManageArchitecturesModal launcher → wizard pre-binding integration
      10. Polling stop-on-terminal integration end-to-end
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 11.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from Groups 1-10 plus 11.3)
    - Expected total: approximately 30-90 tests maximum
    - Do NOT run the entire application test suite
    - Do NOT modify pre-existing broken tests listed in project memory
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 30-90 tests total)
- Critical user workflows for this feature are covered (launcher → wizard → run → review → baseline save; secret-loss recovery)
- No more than 10 additional tests added when filling testing gaps
- Testing focused exclusively on this spec's feature requirements
- Pre-existing broken tests untouched

---

## Execution Order

Recommended implementation sequence (Groups 7 and 8 may run in parallel; everything else is strictly sequential by dependency):

1. AMS persistence — Liquibase + JPA + repositories (Group 1)
2. AMS service + controller layer (Group 2)
3. Gateway CRUD proxy + LLM relay (Group 3)
4. New microservice scaffold + clients + helpers + OAS parser + DbAdapter (Group 4)
5. LLM loop + tool registry + guardrails (Group 5)
6. Action endpoints + gateway action proxies (Group 6)
7. Frontend API client + 5-step wizard + launcher (Group 7) — parallelisable with Group 8
8. Sibling "API Behaviour Baselines" dashboard page (Group 8) — parallelisable with Group 7
9. Capture review UX + save baseline + secret-loss CTA polish (Group 9)
10. AppShell model cache invalidation plumbing (Group 10)
11. Cross-stack test gap review (Group 11)

## Standing Constraints (apply to every group)

- Liquibase changesets ≤127 are immutable. NEW files only — start at `128-api-behaviour-capture-sessions.sql`.
- Do NOT edit `discovery-service/src/**` if a discovery run is active (tsx watch reload kills runs).
- All DTO fields participating in PATCH semantics MUST be boxed types (Java `Integer`/`Long`/`Boolean`; TS `number | null` / `boolean | null`).
- Secrets NEVER persisted to AMS — only redacted JSON. New service holds plaintext in process memory only while session is `configured` or `running`; purged on terminal status.
- Mapping/list lookups fetched fresh from AMS — no source-side cache layer in the new service.
- LLM loop hard limits per scenario: 12 rounds, 30s per tool call, 5min wall-clock.
- Sybase = stub only in v1; PostgreSQL fully implemented; wizard greys out Sybase with "not yet implemented in v1" tooltip (visible, not hidden).
- `/rerun` endpoint and corresponding UI action are explicitly OUT of v1 — fully removed, no disabled placeholder.
- New gateway LLM relay does NOT reuse `gateway/src/services/toolExecutor.ts` (that's MCP-bound, different lifecycle).
- Pre-existing broken tests listed in project memory must NOT be modified by this feature's work.
