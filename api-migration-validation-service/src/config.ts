import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Server port
 * Default: 8092 (per spec; must not collide with discovery-service:8091,
 * gateway:8081, mcp:8090, ams:8080, ars:8079, jira:8078)
 */
export const PORT: number =
  parseInt(process.env.PORT || '8092', 10);

/**
 * Base URL for the architecture-model-service backend
 * Default: http://localhost:8080
 *
 * The new service writes capture-session / operation / scenario / capture /
 * diagnostic / baseline / baseline-item rows back into AMS via this base URL
 * (mirrors discovery-service/src/config.ts conventions).
 */
export const ARCHITECTURE_MODEL_SERVICE_BASE_URL: string =
  process.env.ARCHITECTURE_MODEL_SERVICE_BASE_URL || 'http://localhost:8080';

/**
 * Base URL for the gateway service
 * Default: http://localhost:8081
 *
 * Used by api-migration-validation-service to call the gateway's
 * `/api/v1/api-migration-validation/llm-tool-loop` thin-relay endpoint.
 * The gateway in turn relays through `gateway/src/services/llmClient.ts`.
 */
export const GATEWAY_BASE_URL: string =
  process.env.GATEWAY_BASE_URL || 'http://localhost:8081';

/**
 * Base URL of the discovery-service backend.
 * Default: http://localhost:8091 (matches discovery-service's own default port).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2) --
 * Task Group 8 (`get_operation_payload_context` LLM tool). The tool fetches
 * JAXB DTO source files from the discovery-service's run-scoped source endpoint
 * at `GET /discovery/projects/:p/architectures/:a/runs/:r/source/<repo-path>`
 * (W-2 / W-12). No new auth surface is introduced -- the call is service-to-
 * service over the internal cluster network.
 */
export const DISCOVERY_SERVICE_BASE_URL: string =
  process.env.DISCOVERY_SERVICE_BASE_URL || 'http://localhost:8091';

/**
 * Filesystem directory containing OAS spec files written by AMS's
 * `OasSpecService`. The new service resolves `Interface.spec_link` against
 * this directory when the wizard's "select existing OAS" path is used.
 *
 * Default: `./oas-specs` (matches the host-side mount used by docker-compose
 * for AMS at `./oas-specs:/app/oas-specs`). Operators must set this to the
 * absolute container path (`/app/oas-specs`) inside Docker.
 */
export const OAS_SPECS_DIR: string =
  process.env.OAS_SPECS_DIR || './oas-specs';

/**
 * Base URL of the `sybase-discovery-sidecar` JVM service. The
 * `SybaseAdapter` posts to this URL for `/test-connection`, `/introspect`,
 * and `/query`; the sidecar handles the JDBC layer (jTDS + jConnect
 * auto-fallback).
 *
 * Default: `http://localhost:8093` (the sidecar's own default port).
 * Mirrors the discovery-service env var of the same name so a single
 * sidecar instance serves both Node services.
 */
export const SYBASE_SIDECAR_URL: string =
  process.env.SYBASE_SIDECAR_URL || 'http://localhost:8093';

/**
 * Maximum number of LLM/tool-call rounds per scenario before the loop is
 * aborted with a `retry_exhausted` diagnostic. Spec-fixed limit.
 * Default: 12.
 */
export const LLM_SCENARIO_ROUND_LIMIT: number =
  parseInt(process.env.LLM_SCENARIO_ROUND_LIMIT || '12', 10);

/**
 * Hard timeout (ms) for any single tool-call execution. Breaching this limit
 * emits an `llm_generation_failure` diagnostic and marks the scenario
 * `executed_error`. Spec-fixed limit.
 * Default: 30000 (30 seconds).
 */
export const LLM_TOOL_CALL_TIMEOUT_MS: number =
  parseInt(process.env.LLM_TOOL_CALL_TIMEOUT_MS || '30000', 10);

/**
 * Hard wall-clock cap (ms) for a single scenario's full LLM loop. Breaching
 * this limit marks the scenario `executed_error` and continues to the next
 * scenario. Spec-fixed limit.
 * Default: 300000 (5 minutes).
 */
export const LLM_SCENARIO_WALL_CLOCK_MS: number =
  parseInt(process.env.LLM_SCENARIO_WALL_CLOCK_MS || '300000', 10);

/**
 * Maximum number of HTTP attempts per scenario before `execute_http_request`
 * emits a `retry_exhausted` diagnostic and refuses further calls. The counter
 * lives on `runManager.scenarioHttpAttempts` and is reset at every scenario
 * boundary via `runManager.beginScenario`.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- Decision D7.
 * Default: 3.
 */
export const LLM_HTTP_ATTEMPTS_PER_SCENARIO: number =
  parseInt(process.env.LLM_HTTP_ATTEMPTS_PER_SCENARIO || '3', 10);

/**
 * Per-call token cap for the Workstream A `propose_endpoints_from_code`
 * LLM tool. Inputs (prompt + source-file payload) exceeding this cap are
 * TRUNCATED with a warning marker — never hard-failed (W-7).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- W-7 token budgeting. Workstream A: 20 K tokens / call, 100 K / session.
 * Default: 20000.
 */
export const AMVS_LLM_EXTRACT_CALL_TOKEN_CAP: number =
  parseInt(process.env.AMVS_LLM_EXTRACT_CALL_TOKEN_CAP || '20000', 10);

/**
 * Per-session token cap for the Workstream A `propose_endpoints_from_code`
 * LLM tool. The per-session counter is keyed by the Step 4 review session id
 * and accumulates across multiple calls within the same session; on overflow
 * the helper truncates subsequent calls to zero and surfaces a warning.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- W-7 token budgeting. Workstream A: 100 K / session.
 * Default: 100000.
 */
export const AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP: number =
  parseInt(process.env.AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP || '100000', 10);

/**
 * Per-call token cap for the Workstream B `get_operation_payload_context`
 * LLM tool. Inputs (WSDL message metadata + JAXB DTO source) exceeding this
 * cap are TRUNCATED with a warning marker — never hard-failed (W-7).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- W-7 token budgeting. Workstream B: 8 K tokens / call, 50 K / session.
 * Default: 8000.
 */
export const AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP: number =
  parseInt(process.env.AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP || '8000', 10);

/**
 * Per-session token cap for the Workstream B `get_operation_payload_context`
 * LLM tool. The per-session counter is keyed by the capture-session id and
 * accumulates across all operations within a single capture run; on overflow
 * the helper truncates subsequent calls to zero and surfaces a warning so
 * the LLM falls back to WSDL-types-only payload construction.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- W-7 token budgeting. Workstream B: 50 K / session.
 * Default: 50000.
 */
export const AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP: number =
  parseInt(process.env.AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP || '50000', 10);

/**
 * Consecutive transport-level failure threshold for the target replay runner.
 * On reaching the threshold the runner aborts the session with
 * `error_message='target_unreachable'`. Only transport-level errors count
 * toward this counter (network errors, DNS errors, connection refused,
 * timeouts) -- HTTP 4xx/5xx responses are data the diff engine wants and
 * reset the counter to zero on any successful HTTP response (any status code).
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture (accepted Q6).
 * Default: 10.
 */
export const TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT: number =
  parseInt(process.env.TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT || '10', 10);
