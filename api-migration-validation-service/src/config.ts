import dotenv from 'dotenv';
import path from 'path';

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
 * Base URL of the `db-discovery-sidecar` JVM service. The engine adapters
 * post to this URL for `/test-connection`, `/introspect`, `/query`,
 * `/mutate` and `/call`; the sidecar handles the JDBC layer (Sybase ASE via
 * jTDS + jConnect, SQL Server via mssql-jdbc + jTDS) and every request names
 * its `engine`.
 *
 * Resolution order (SQL Server pair programme, SPEC-1 / wire contract §6):
 * `DB_SIDECAR_URL` -> `SYBASE_SIDECAR_URL` (the pre-rename alias, still
 * honoured so an existing deployment keeps working) -> `http://localhost:8093`
 * (the sidecar's own default port). Mirrors the discovery-service resolution
 * exactly, so a single sidecar instance serves both Node services.
 */
export const DB_SIDECAR_URL: string =
  process.env.DB_SIDECAR_URL || process.env.SYBASE_SIDECAR_URL || 'http://localhost:8093';

/**
 * Pre-rename name for {@link DB_SIDECAR_URL}. Kept as an ALIAS of the same
 * value (not a second resolution) so existing importers need no change and
 * the two constants can never drift apart.
 */
export const SYBASE_SIDECAR_URL: string = DB_SIDECAR_URL;

/**
 * Maximum number of BUDGET-CONSUMING LLM/tool-call rounds per scenario
 * before the loop is aborted with a `retry_exhausted` diagnostic. Rounds
 * whose tool calls are ALL read-only research (contract/OAS reads, DB
 * metadata + sampling, read-only SQL, source search/read) are FREE
 * (2026-08-26): once DB metadata worked, legitimate per-scenario research
 * (list_db_metadata -> sample_db_values -> absence checks) pushed 59
 * scenarios over the flat cap — the accounting now mirrors the
 * fired-attempt budget's "research is free" rule.
 * Default: 12.
 */
export const LLM_SCENARIO_ROUND_LIMIT: number =
  parseInt(process.env.LLM_SCENARIO_ROUND_LIMIT || '12', 10);

/**
 * Safety ceiling on RESEARCH rounds per scenario so a pathological
 * all-research loop cannot spin until the wall clock. Budget rounds have
 * their own cap (LLM_SCENARIO_ROUND_LIMIT — including the Pass-B derived
 * budgets, which this ceiling must never undercut, hence the split
 * accounting). Generous by design (cap ruling 2026-08-24: caps never
 * ration ordinary flow) and env-tunable; the refusal diagnostic names
 * this knob.
 * Default: 60.
 */
export const LLM_SCENARIO_RESEARCH_ROUND_CEILING: number =
  parseInt(process.env.LLM_SCENARIO_RESEARCH_ROUND_CEILING || '60', 10);

/**
 * Response-body storage cap (state-discipline remediation Item #5,
 * 2026-08-27). Bodies at or under the cap are stored IN FULL; larger bodies
 * become a truncation marker. The old hardcoded 256KB turned the largest
 * responses into markers that compared marker-to-marker at reconciliation —
 * vacuous matches on exactly the payloads that matter most. Default 8MB
 * (owner confirmed storage is not a concern); per-session override via the
 * wizard's Capture tuning (capture_tuning_json.max_response_body_bytes).
 */
export const MAX_RESPONSE_BODY_BYTES: number =
  parseInt(process.env.MAX_RESPONSE_BODY_BYTES || String(8 * 1024 * 1024), 10);

/**
 * Hard timeout (ms) for any single tool-call execution. Breaching this limit
 * emits an `llm_generation_failure` diagnostic and marks the scenario
 * `executed_error`. Spec-fixed limit.
 *
 * Default: 180000 (3 minutes). Raised from 30s for Spec 2026-07-22: on a
 * provider per-minute 429 the gateway now HOLDS the request through a shared
 * 60s cool-down (up to LLM_RATE_LIMIT_MAX_WAITS times) before responding, so
 * the client timeout must comfortably exceed the max in-gateway wait or it
 * would abort a request that is legitimately waiting out the rate limit.
 */
export const LLM_TOOL_CALL_TIMEOUT_MS: number =
  parseInt(process.env.LLM_TOOL_CALL_TIMEOUT_MS || '180000', 10);

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
 * Raised 3 -> 5 (2026-06-19) to give the LLM more room to self-correct a
 * request within a scenario (e.g. a per-API date format / content-type) before
 * `retry_exhausted` fires.
 * Default: 5.
 */
export const LLM_HTTP_ATTEMPTS_PER_SCENARIO: number =
  parseInt(process.env.LLM_HTTP_ATTEMPTS_PER_SCENARIO || '5', 10);

/**
 * SETUP-call attempt budget per scenario (state-discipline remediation
 * Item #3, 2026-08-27). Setup calls — create-then-act prerequisites at
 * endpoints OTHER than the scenario's target — used to draw from the SAME
 * budget as target attempts, so a two-call setup could leave the target one
 * attempt short of its format fallback. Setup now has its own generous,
 * env-tunable budget; the refusal names this knob.
 * Default: 10.
 */
export const LLM_SETUP_ATTEMPTS_PER_SCENARIO: number =
  parseInt(process.env.LLM_SETUP_ATTEMPTS_PER_SCENARIO || '10', 10);

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

/**
 * Number of HTTP replays the capture-time volatility probe performs against
 * the current system to MEASURE which JSON paths legitimately vary. The
 * probe replays the just-captured scenario `k` times (HTTP-only, no LLM) and
 * self-diffs the responses; any path that differs across the repeats is a
 * measured volatile path. A full `k`-repeat probe is tagged `probed`.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 2 (Q1: `k = 3` default).
 * Default: 3.
 */
export const VOLATILITY_PROBE_REPEATS: number =
  parseInt(process.env.VOLATILITY_PROBE_REPEATS || '3', 10);

/**
 * Wall-clock budget (ms) for the WHOLE volatility probe across all `k`
 * replays. On exceed, the probe aborts and records a PARTIAL result from the
 * replays that DID complete (tagged `probed_partial`, storing the
 * completed-repeat count). A `probed_partial` envelope is trusted exactly
 * like a full probe -- it is NOT down-ranked.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 2 (Q1(a) probe budget, Q2 partial handling).
 * Default: 10000 (10 seconds across all repeats).
 */
export const VOLATILITY_PROBE_BUDGET_MS: number =
  parseInt(process.env.VOLATILITY_PROBE_BUDGET_MS || '10000', 10);

/**
 * Inter-replay spacing (ms) applied BETWEEN volatility-probe replays so
 * per-second clock-bucket fields (e.g. a timestamp truncated to the second)
 * surface across the repeats rather than collapsing into a single bucket.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 2 (Q1(b) inter-replay spacing).
 * Default: 250.
 */
export const VOLATILITY_PROBE_SPACING_MS: number =
  parseInt(process.env.VOLATILITY_PROBE_SPACING_MS || '250', 10);

/**
 * Compensation full-image row cap (Capture-State Discipline Spec 1). The v1
 * imaging ladder has exactly ONE rung — a complete PK-keyed row image of each
 * effect table before/after/verify — so a table whose live count exceeds this
 * cap REFUSES the bracket (`table_too_large`, fail-closed: the mutating call
 * is skipped with a finding, never fired uncompensated). Raise deliberately
 * for engagements with larger effect tables.
 * Default: 100000.
 */
export const COMPENSATION_FULL_IMAGE_MAX_ROWS: number =
  parseInt(process.env.COMPENSATION_FULL_IMAGE_MAX_ROWS || '100000', 10);

/**
 * Keyset page size for compensation table imaging. Clamped to the adapter
 * seam's MAX_SINGLE_FETCH_ROWS (the Sybase sidecar buffers one page as one
 * JSON response).
 * Default: 5000.
 */
export const COMPENSATION_IMAGE_PAGE_ROWS: number =
  parseInt(process.env.COMPENSATION_IMAGE_PAGE_ROWS || '5000', 10);

/**
 * Per-statement timeout (seconds) for compensation reads AND writes.
 * Default: 30.
 */
export const COMPENSATION_STATEMENT_TIMEOUT_SECONDS: number =
  parseInt(process.env.COMPENSATION_STATEMENT_TIMEOUT_SECONDS || '30', 10);

/**
 * S0 snapshot storage root (Capture-State Discipline Spec 2). Layout:
 * `<dir>/<projectId>/<architectureId>/<snapshotId>/manifest.json` + one
 * `<table>.jsonl` per snapshotted table. The snapshot doubles as the
 * migration dump artifact — the design rule is the data load comes FROM S0,
 * never from the live post-capture DB.
 *
 * The default is resolved against THIS FILE, not the process cwd (Kiro
 * 2026-08-25): a cwd-relative './s0-snapshots' silently relocates the
 * snapshot root whenever the service is launched from a different folder,
 * and a missing snapshot is indistinguishable from "no snapshot was ever
 * taken" — inviting a fresh S0 over polluted state. `__dirname` is `src/`
 * under tsx and `dist/` compiled, so `..` lands on the service root either
 * way.
 * Default: `<service root>/s0-snapshots`.
 */
export const S0_SNAPSHOT_DIR: string =
  process.env.S0_SNAPSHOT_DIR || path.resolve(__dirname, '..', 's0-snapshots');

/**
 * Keyset page size for S0 snapshot / fingerprint reads. Clamped to the
 * adapter seam's MAX_SINGLE_FETCH_ROWS.
 * Default: 5000.
 */
export const S0_SNAPSHOT_PAGE_ROWS: number =
  parseInt(process.env.S0_SNAPSHOT_PAGE_ROWS || '5000', 10);

/**
 * Per-page query timeout (seconds) for S0 snapshot / fingerprint reads. Deep
 * keyset pages on big tables are legitimate long engine work (same rationale
 * as the data-migration read budget).
 * Default: 21600 (6h).
 */
export const S0_SNAPSHOT_QUERY_TIMEOUT_SECONDS: number =
  parseInt(process.env.S0_SNAPSHOT_QUERY_TIMEOUT_SECONDS || '21600', 10);

/**
 * Fingerprint VERIFY checksum depth (Spec 2): tables with more live rows
 * than this cap get a COUNT-ONLY verification with an honest
 * `checksum_skipped_over_cap` note (recomputing a full-table checksum is a
 * full scan). Snapshot-time checksums are always recorded — they come free
 * while streaming the dump.
 * Default: 500000.
 */
export const S0_FINGERPRINT_CHECKSUM_MAX_ROWS: number =
  parseInt(process.env.S0_FINGERPRINT_CHECKSUM_MAX_ROWS || '500000', 10);

/**
 * INSERT statements per restore batch (Spec 2). Each batch is one
 * transactional /mutate (or PG transaction); smaller batches bound sidecar
 * request sizes, larger ones reduce round-trips on a recovery path.
 * Default: 500.
 */
export const S0_RESTORE_INSERTS_PER_BATCH: number =
  parseInt(process.env.S0_RESTORE_INSERTS_PER_BATCH || '500', 10);

/**
 * Capture compensation mode (Capture-State Discipline Spec 3).
 *   - 'required' (default): when the session has DB credentials AND the
 *     committed model resolves, every MUTATING scenario runs inside a
 *     verified compensation bracket; endpoints whose effect map / PK cannot
 *     support a bracket are REFUSED (fail-closed, loud). Bracket residue
 *     HALTS the session.
 *   - 'off': legacy behaviour (state-delta observation only) — an escape
 *     valve for diagnosis, never the recommended posture.
 * When the session has NO DB credentials at all, compensation cannot run in
 * either mode; the session carries a loud advisory instead.
 */
export const CAPTURE_COMPENSATION_MODE: 'required' | 'off' =
  process.env.CAPTURE_COMPENSATION_MODE === 'off' ? 'off' : 'required';
