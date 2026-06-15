# Specification: API Behaviour Baseline Capture Service

## Goal

Add a new microservice (`api-migration-validation-service`), backing AMS persistence, gateway proxy/relay surface, and frontend wizard + sibling page that lets an Architect / Test Engineer drive an LLM-guided capture loop against a current-state non-prod API and save the accepted request/response examples as a durable API Behaviour Baseline. The baseline becomes the evidence base for later migration planning, target-state implementation backlog, Migration Test Pack creation, and a future API reconciliation capability.

## User Stories

- As an Architect preparing a current-to-target migration, I want to point the platform at a non-prod current-state API and let an LLM-guided loop generate, execute, and capture realistic request/response examples per OAS operation, so that I have a real-evidence behaviour baseline rather than hand-authored fixtures.
- As a Test Engineer reviewing captured behaviour, I want to see endpoint-by-endpoint and scenario-by-scenario captures with accept/reject/rename/notes/mask actions, so that only meaningful examples are saved into the durable baseline.
- As a security-conscious operator, I want secrets (API auth tokens, DB passwords) held only in service memory during a single run and never persisted, so that a crash or restart cannot leak credentials and a re-run forces explicit re-entry.

## Specific Requirements

**New `api-migration-validation-service` skeleton (Node/TypeScript)**
- Mirror `discovery-service/` exactly: `src/{config.ts, index.ts, middleware/, routes/, services/, types/, utils/, __tests__/}`, plus `Dockerfile.dev`, `package.json`, `tsconfig.json`, `jest.config.js`.
- Express + axios + `tsx watch`; Node 20 alpine base; port `8092` (must not collide with existing service ports).
- `src/config.ts` env vars: `PORT` (default `8092`), `ARCHITECTURE_MODEL_SERVICE_BASE_URL` (default `http://localhost:8080`), `GATEWAY_BASE_URL` (default `http://localhost:8081`), `OAS_SPECS_DIR` (shared volume path matching AMS), `LLM_SCENARIO_ROUND_LIMIT=12`, `LLM_TOOL_CALL_TIMEOUT_MS=30000`, `LLM_SCENARIO_WALL_CLOCK_MS=300000`.
- Health route `GET /health` returning `{ status: 'ok', timestamp }` (matches discovery-service pattern).
- Mount router at `/api-migration-validation` in `src/index.ts`; barrel router under `src/routes/index.ts`.
- Service is **stateless on disk** — only AMS persists durable state; in-process state limited to `runManager`-style in-memory maps for live sessions and a `secretsStore` keyed by `sessionId` (cleared on terminal status).
- `package.json` deps: `axios`, `express`, `dotenv`, `uuid`, `@apidevtools/swagger-parser`, `openapi-types`, `pg`. Dev deps mirror discovery-service (`jest`, `ts-jest`, `tsx`, `typescript`, `supertest`, `@types/*`).

**AMS persistence — 7 new tables, Liquibase changesets 128–134**
- One changeset file per table, each registered as a separate `changeSet` block in `db.changelog-master.yaml`. Style reference: `065-073-discovery-*.sql` (UUID PKs, snake_case, `JSONB` for redacted config / payload bags, status as `TEXT NOT NULL DEFAULT '...'`, `TIMESTAMPTZ DEFAULT NOW()` columns, `ON DELETE CASCADE` on session-owned rows).
- `128-api-behaviour-capture-sessions.sql` — `id UUID PK, project_id UUID NOT NULL FK→project ON DELETE CASCADE, architecture_id UUID NOT NULL, name TEXT, status TEXT (draft|configured|running|completed|failed|cancelled), env_name TEXT, api_base_url TEXT, auth_type TEXT, auth_config_redacted_json JSONB, default_headers_redacted_json JSONB, oas_spec_refs_json JSONB, db_config_redacted_json JSONB, mutating_calls_confirmed BOOLEAN NOT NULL DEFAULT FALSE, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, error_message TEXT, created_at, updated_at`. Index on `(project_id, architecture_id, status)`.
- `129-api-behaviour-operations.sql` — `id, session_id FK CASCADE, operation_id TEXT, method TEXT, path TEXT, summary TEXT, description TEXT, included BOOLEAN, safe_to_execute BOOLEAN, request_schema_json JSONB, response_schema_json JSONB, oas_operation_json JSONB, created_at, updated_at`. Index on `session_id`.
- `130-api-behaviour-scenarios.sql` — `id, session_id FK CASCADE, operation_id FK→api_behaviour_operations CASCADE, scenario_name, scenario_type TEXT (happy_path|not_found|validation_error|empty_result|boundary_value|auth_error|business_edge_case|generated_candidate), status TEXT (draft|executed_success|executed_error|accepted|rejected|needs_review), generation_source TEXT (oas_example|db_sample|llm_generated|llm_refined|user_edited), request_method, request_path, request_query_json JSONB, request_headers_redacted_json JSONB, request_body_json JSONB, notes TEXT, created_at, updated_at`.
- `131-api-behaviour-captures.sql` — `id, session_id FK CASCADE, scenario_id FK CASCADE, operation_id FK CASCADE, attempt_number INT, request_method, request_path, request_query_json JSONB, request_headers_redacted_json JSONB, request_body_json JSONB, response_status INT, response_headers_redacted_json JSONB, response_body_json JSONB, duration_ms INT, error_type TEXT, error_message TEXT, captured_at TIMESTAMPTZ, accepted BOOLEAN NOT NULL DEFAULT FALSE, accepted_at TIMESTAMPTZ, reviewer_notes TEXT`.
- `132-api-behaviour-diagnostics.sql` — `id, session_id FK CASCADE, operation_id NULLABLE, scenario_id NULLABLE, diagnostic_type TEXT (failed_request|auth_failure|db_sample_failure|llm_generation_failure|redaction_warning|endpoint_skipped|retry_exhausted), message TEXT, detail_json JSONB, created_at`.
- `133-api-behaviour-baselines.sql` — `id, project_id FK→project CASCADE, architecture_id UUID, session_id FK→api_behaviour_capture_sessions, name TEXT, status TEXT (draft|active|archived), accepted_capture_count INT, operation_count INT, notes TEXT, created_at, updated_at`. Index on `(project_id, architecture_id, status)`.
- `134-api-behaviour-baseline-items.sql` — `id, baseline_id FK CASCADE, capture_id FK→api_behaviour_captures, operation_id, scenario_id, method, path, scenario_name, request_json JSONB, response_status INT, response_json JSONB, business_notes TEXT, created_at, updated_at`. Kept as a proper join table (NOT collapsed into a JSONB array on the baseline row).

**AMS Java layer — entities, repos, services, controllers**
- Package layout under `com.example.architecturemodel.{model.entity, model.dto.apibehaviour, repository.apibehaviour, service.apibehaviour, controller.apibehaviour, mapper.apibehaviour}` mirroring the existing `discovery` and `oas` packages.
- One JPA entity per table; `@JdbcTypeCode(SqlTypes.JSON)` for all `*_json` JSONB columns; status as `String` with comment listing valid values (matches existing AMS convention rather than DB-level enum).
- DTO PATCH-mutable numeric/boolean fields **must use boxed types** (`Integer`, `Long`, `Boolean`) per the primitive-wipe pitfall; PATCH handlers null-guard each field.
- Repositories extend `JpaRepository`; controllers under `/api/projects/{projectId}/api-behaviour/...` exposing CRUD per the surface listed in `gateway` section below.
- New service writes back into AMS via the new service's `archModelClient.ts` using the same axios pattern as `discovery-service/src/services/archModelClient.ts`.

**Secrets policy**
- Plaintext auth secrets (bearer tokens, API keys, basic auth passwords, custom-header values) and DB passwords NEVER cross into AMS — only `*_redacted_json` field shapes (`auth_type`, header names with values omitted, base URL, db host/port/db/schema/username) are persisted.
- New service holds plaintext secrets in an in-process `Map<sessionId, SecretsBundle>` only while the session status is `configured` (between wizard completion and start) or `running`. On terminal status (`completed`/`failed`/`cancelled`) the entry is purged.
- Secrets never logged; redaction applied at the axios request-interceptor level inside the new service.

**Secret-loss UX (after process restart)**
- For idle sessions (`configured` / `completed` / `failed` / `cancelled`) where in-memory secrets are gone: open detail page normally; execution actions (start, test-api-connection, test-db-connection) blocked behind a "Re-enter secrets" inline prompt that re-populates the in-memory bundle without writing to AMS.
- For sessions whose AMS status was `running` at restart: a startup reconciliation step in the new service marks them `failed` with `error_message='secrets_lost_during_run'`. The UI detail view shows two CTAs: "Clone configuration" (creates a new draft session pre-filled from the failed session's redacted config) and "Re-enter secrets and start a new run" (also creates a new draft session, drops the user straight into wizard step 2 with config pre-filled).

**LLM tool-call relay (gateway endpoint)**
- New endpoint `POST /api/v1/api-migration-validation/llm-tool-loop` accepts `{ messages: ChatMessage[], tools: ToolDefinition[], toolChoice?: 'auto'|'none'|{type:'function',function:{name:string}}, model?: string }` and returns `{ message: AssistantMessage, usage?: TokenUsage }` where the assistant message may contain `tool_calls`.
- Implementation relays to the existing gateway provider abstraction (`gateway/src/services/llmClient.ts` + `azureOpenaiClient.ts` + `openaiClient.ts`) — same provider config selection (`LLM_PROVIDER`) used elsewhere in the gateway.
- Endpoint is a **thin pass-through**: the new service owns the loop, the round-counter, the tool registry, tool execution, and termination. Gateway only marshals one provider round-trip per call.
- Distinct from `gateway/src/services/toolExecutor.ts` (the MCP/hub-bound tool shape) — do not reuse that executor; it serves a different lifecycle.

**LLM loop control + hard limits (enforced in new service)**
- Per-scenario loop in `src/services/captureLoopRunner.ts`: round-trips with the LLM tool-call relay; aborts at any of (a) **12 LLM/tool-call rounds**, (b) any single tool-call exceeding **30 seconds**, (c) total scenario wall-clock exceeding **5 minutes**. On any limit breach: emit `retry_exhausted` or `llm_generation_failure` diagnostic, mark scenario `executed_error`, continue to next scenario.
- LLM is the planner/proposer; it never executes HTTP or SQL directly — only by emitting `tool_calls` against the registered tool functions.

**LLM tool registry + guardrails**
- Eight tools defined in `src/services/tools/`: `list_oas_operations`, `get_oas_operation_detail`, `list_db_metadata`, `sample_db_values`, `run_readonly_sql`, `execute_http_request`, `record_scenario_candidate`, `record_capture_note`.
- `execute_http_request`: only operations marked `included=TRUE AND safe_to_execute=TRUE` for the current session; verb gated by per-session `mutating_calls_confirmed`; auth injected from in-memory secrets bundle; per-call timeout from session config; max 3 retry attempts per scenario; large response bodies truncated with truncation marker before persistence.
- `run_readonly_sql` + `sample_db_values`: routed through `DbAdapter`; statement parser blocks anything that is not a single `SELECT` (rejects `INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXEC|CALL|GRANT|REVOKE|CREATE|;.*;`); enforces row limit (`maxRowsPerQuery`) and `queryTimeoutSeconds`; allowlisted schemas/tables checked when set.
- `list_db_metadata`: read-only `information_schema` queries through the same adapter; bounded by allowlists.
- `list_oas_operations` / `get_oas_operation_detail`: pure in-memory reads of the parsed inventory (no I/O).
- `record_scenario_candidate` / `record_capture_note`: writes a candidate scenario row / note to AMS via `archModelClient.ts`; outputs already redacted.
- All tool outputs pass through `src/services/redactor.ts` before being sent back to the LLM and before any AMS write.

**DB sampling — PostgreSQL implemented, Sybase stub**
- `src/services/db/DbAdapter.ts` interface with methods `testConnection()`, `listMetadata(allowlist)`, `runReadonlySelect(sql, params, limits)`, `sampleValues(table, column, limits)`, `dispose()`.
- `src/services/db/PostgresAdapter.ts` — full v1 implementation using the `pg` npm package; pooled connections per session; `SET statement_timeout` per query; explicit `LIMIT` injection if absent.
- `src/services/db/SybaseAdapter.stub.ts` — exported class whose every method throws `new Error('Sybase support is not yet implemented in v1')`.
- `src/services/db/dbAdapterFactory.ts` returns the right adapter based on `dbType`; tests assert the stub throws as designed.

**OAS upload + storage**
- Preferred path: wizard step 1 lets the user multi-select existing `Interface` rows for the chosen architecture (read via existing AMS `Interface` controller). The new service's `parse-oas` action reads each `spec_link` from AMS and resolves the file from the shared `oas-specs/` volume mounted into the new service container (matching the path `OasSpecService.java` already writes to).
- Fallback path: ad-hoc upload during the wizard. File parsed in-memory by the new service; **raw bytes are NOT persisted** — only the parsed inventory lands in `api_behaviour_operations`. To save the raw OAS, the user must use the existing OAS storage flow separately.
- Parse + dereference + validate via `@apidevtools/swagger-parser`; types from `openapi-types`. Inventory rows store `oas_operation_json` (the dereferenced operation object), `request_schema_json`, `response_schema_json`, plus method/path/summary/description for fast listing.
- A `POST /api/capture-sessions/{id}/parse-oas` action endpoint on the new service triggers parsing and inventory write; gateway proxies it.

**Mutating-call confirmation**
- Per-session boolean `mutating_calls_confirmed`. Toggleable in wizard steps 2/4 only while session is `draft`; locked once session moves to `configured`.
- Confirmation copy in the UI: `"I confirm this is a non-prod migration-test environment and mutating API calls are allowed."`
- Without confirmation: `safe_to_execute` is set TRUE for `GET|HEAD|OPTIONS` only; mutating ops are inserted with `included=FALSE` and a visual "excluded — mutating not confirmed" marker in step 4. Per-operation override is **out of scope for v1** (deferred to v2).

## Visual Design

No visual assets were provided in `planning/visuals/` — this section intentionally empty. Frontend layout decisions follow the explicit reuse of the Discovery wizard and Discovery list/detail patterns documented in "Existing Code to Leverage".

## Existing Code to Leverage

**`discovery-service/src/{index.ts, config.ts, routes/index.ts, services/{archModelClient.ts, gatewayClient.ts, runManager.ts}}` + `Dockerfile.dev` + `package.json`**
- Copy this skeleton verbatim as the starting point for `api-migration-validation-service/`. Match: `tsx watch` dev script, `dotenv` config loading, request-logger + error-handler middleware mount order, `axios` client conventions, in-process `runManager` map for live runs, gateway client error taxonomy pattern, port-from-env config style.
- Borrow the pattern (not the contents) for naming `archModelClient.ts` and `gatewayClient.ts` so cross-service maintainers find the same shapes in the same files.

**`gateway/src/routes/discovery.ts` (proxy pattern + architecture-mismatch defence)**
- Mirror the structure for a new `gateway/src/routes/apiMigrationValidation.ts` exposing both action proxies (forward to the new service) and AMS-direct CRUD proxies. Reuse the same `:projectId`/`:architectureId` URL safety property — forgetting `:architectureId` produces a 404 at the Express layer with no fallback resolution.

**`gateway/src/services/{llmClient.ts, openaiClient.ts, azureOpenaiClient.ts}`**
- Provider abstraction the new `/llm-tool-loop` endpoint relays through. No new provider plumbing required — pick up whatever `LLM_PROVIDER` is configured. Do NOT use `gateway/src/services/toolExecutor.ts` (different lifecycle, MCP-bound).

**`architecture-model-service/src/main/resources/db/changelog/sql/065-073-discovery-*.sql` + `db.changelog-master.yaml`**
- Style template for the seven new changesets: JSONB-heavy, snake_case, UUID PKs, `TEXT NOT NULL DEFAULT '...'` for status, `ON DELETE CASCADE` on session-owned rows, `COMMENT ON TABLE/COLUMN` blocks, indexes on the high-traffic FK columns. Register each new changeset as its own `changeSet` block in the master YAML — never edit changesets ≤127 (immutable per project-wide constraint).

**`architecture-model-service/.../service/OasSpecService.java` + `controller/OasSpecController.java` + `Interface` JPA entity**
- Source of truth for the "select existing OAS" wizard path. The new service reads `Interface.spec_link` and loads the file from the shared `oas-specs/` volume, exactly as the existing OAS read flow already does. No changes required to the existing OAS controller for v1.

**`frontend/src/components/Discovery/StartDiscoveryRunModal.tsx` + `frontend/src/components/TopBar/SelectiveCopyWizardModal.tsx`**
- Patterns for the new 5-step `StartCaptureSessionWizard.tsx` modal: stepper header, per-step validation, `Next`/`Back`/`Cancel`/`Start` button strip, `Cancel`-confirmation behaviour, error banner placement.

**`frontend/src/components/DashboardView/{DiscoveryListPage.tsx, DiscoveryRunsList.tsx, DiscoveryRunDetailPage.tsx, DiscoveryRunDetailView.tsx}`**
- Exact template for the new sibling page "API Behaviour Baselines": `ApiBaselinesListPage.tsx`, `CaptureSessionsList.tsx`, `CaptureSessionDetailPage.tsx`, `CaptureSessionDetailView.tsx`, `BaselinesList.tsx`, `BaselineDetailView.tsx`. Reuse the 2–3 second polling cadence pattern while session status is `running` (matches Discovery's polling, no SSE/WebSocket).

**`frontend/src/components/TopBar/ManageArchitecturesModal.tsx`**
- Insertion point for the per-row "Capture API Behaviour Baseline" launcher button. The button opens `StartCaptureSessionWizard` pre-bound to the row's `projectId` + `architectureId`.

## Out of Scope

- API reconciliation of captured baselines against a target service (separate spec).
- DB reconciliation, data migration, proxy/log capture, OAS generation, migration roadmap/backlog generation, full business-rule equivalence proof.
- DB engines beyond PostgreSQL (Sybase stub only) and Sybase **execution** (interface stub + greyed-out wizard option are in scope; actual driver work is not).
- Java sidecar for Sybase (only build if implementation later proves no Node-compatible Sybase route exists).
- `POST /captures/{captureId}/rerun` endpoint AND any "rerun scenario" UI affordance — fully removed, no disabled placeholder.
- Per-operation mutating-call override (v2 — session-level toggle is the only v1 control).
- Full session resumability after crash; "clone configuration" + "re-enter secrets and start a new run" replace it for v1.
- WebSocket / SSE progress streams (polling-only in v1).
- Free-form unrestricted SQL; only the constrained `SELECT`-only `run_readonly_sql` tool is exposed.
- Production API or production DB execution (non-prod environments only; mutating-call confirmation copy enforces this).
- Crypto-at-rest for secrets (the v1 design avoids the problem by never persisting them).
- Modifying any pre-existing broken tests listed in project memory; new tests for this feature only.
