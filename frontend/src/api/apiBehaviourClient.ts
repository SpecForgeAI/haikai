/**
 * API Behaviour Capture API Client
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
 *
 * Frontend client for the capture-baseline feature. Talks to the gateway,
 * which proxies AMS-direct CRUD for the seven `api_behaviour_*` resources
 * AND the six action endpoints on the new `api-migration-validation-service`
 * (port 8092). The LLM tool-loop relay endpoint is NOT called from the
 * frontend -- only the new microservice consumes it.
 *
 * URL shape (all routes URL-safed by `:projectId` + `:architectureId`):
 *   - AMS CRUD:
 *       /api/v1/projects/:projectId/architectures/:architectureId/
 *         api-behaviour/<resource>[/<id>]
 *   - Actions:
 *       /api/v1/projects/:projectId/architectures/:architectureId/
 *         api-behaviour/capture-sessions/:sessionId/<action>
 *
 * Per-spec constraints honoured here:
 *   - All numeric/boolean PATCH-mutable fields typed as `number | null` /
 *     `boolean | null` so an explicit `null` round-trips the wire as JSON
 *     null and the AMS PATCH handler's null-guard skips the field.
 *   - JSONB fields typed as `Record<string, unknown> | null`.
 *   - Snake_case field names match the AMS Jackson SNAKE_CASE serialiser.
 *   - No `/rerun` surface anywhere -- explicitly out of v1.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Gateway base URL from env. Defaults to empty string (same origin) for the
 * Vite dev proxy. Mirrors `discoveryApi.ts` and `architecturesApi.ts`.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface ApiBehaviourErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

/**
 * Typed error class thrown on non-2xx responses. Modal callers branch on
 * `error.status` and `error.body.code` to render inline messages.
 */
export class ApiBehaviourApiError extends Error {
  readonly status: number;
  readonly body: ApiBehaviourErrorBody;

  constructor(status: number, body: ApiBehaviourErrorBody, message?: string) {
    super(message ?? body.message ?? `API behaviour API error (status ${status})`);
    this.name = 'ApiBehaviourApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<ApiBehaviourErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      // Parse as `unknown` and narrow explicitly. Some endpoints wrap the
      // payload as `{ error: {...} }`; others return the body directly. The
      // `ApiBehaviourErrorBody` index signature `[k: string]: unknown` means
      // `body.error` is typed as `unknown` after key narrowing, so the
      // assignment must go through an explicit cast.
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        if (wrapped && typeof wrapped === 'object') {
          return wrapped as ApiBehaviourErrorBody;
        }
        return obj as ApiBehaviourErrorBody;
      }
      return { message: res.statusText };
    }
    const text = await res.text();
    return { message: text || res.statusText };
  } catch {
    return { message: res.statusText };
  }
}

// ============================================================================
// DTOs (snake_case — matches AMS Jackson SNAKE_CASE)
// ============================================================================

export type CaptureSessionStatus =
  | 'draft'
  | 'configured'
  | 'running'
  | 'completed'
  | 'failed'
  // Terminal: the LLM provider's per-DAY token quota was reached mid-capture
  // (Spec 2026-07-22). Captured data is intact — resume via "Retry uncovered
  // APIs" after the quota resets.
  | 'paused_rate_limited'
  // Terminal: the session credential expired mid-run (consecutive all-401
  // scenarios; Foundations Spec 0, 2026-08-22). Re-enter secrets, then
  // resume via "Retry uncovered APIs".
  | 'paused_auth_expired'
  // Terminal (state-discipline remediation, 2026-08-27): the run FINISHED,
  // healed what it could, and flagged the rest (manual-rec todos / healed
  // receipts). NOT a failure.
  | 'completed_with_findings'
  | 'cancelled';

export interface ApiBehaviourCaptureSessionDto {
  id: string;
  project_id: string;
  architecture_id: string;
  name: string | null;
  status: CaptureSessionStatus | string;
  environment_name: string | null;
  api_base_url: string | null;
  auth_type: string | null;
  auth_config_redacted_json: Record<string, unknown> | null;
  default_headers_redacted_json: Record<string, unknown> | null;
  oas_spec_refs_json: Record<string, unknown> | null;
  db_config_redacted_json: Record<string, unknown> | null;
  mutating_calls_confirmed: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  /**
   * Per-run scenario outcome tallies (AMS changeset 171, misleading-COMPLETED
   * fix). A session is `completed` whenever there is no INFRASTRUCTURE error —
   * every scenario can have errored with zero captures. Null/absent = "counts
   * not recorded" (legacy rows / pre-fix runners). The detail view renders
   * "N of M scenarios captured" and warns when a completed run captured nothing.
   */
  scenarios_attempted?: number | null;
  scenarios_completed?: number | null;
  scenarios_errored?: number | null;
  created_at: string;
  updated_at: string;
  /**
   * Discriminator added by Spec 2026-05-25 (API Test Harness -- Target-Side
   * Capture). `'current'` for current-state capture sessions (default for
   * legacy rows via the DB column DEFAULT); `'target'` for replay sessions
   * created via `POST /target-capture-sessions`. Optional on the wire so
   * unaware callers continue to compile against the legacy DTO shape.
   */
  kind?: 'current' | 'target' | null;
  /**
   * FK pairing field. Set only when `kind === 'target'`; null on current
   * sessions. Points at the source current-state baseline being replayed.
   * AMS service-layer validation enforces the FK-pairing invariant.
   */
  source_baseline_id?: string | null;
  /**
   * Model-Seeded Capture Inventory (Spec 2026-06-11). Persisted interface
   * scope used by inventory reconciliation. Null/absent = the WHOLE
   * architecture's endpoint set is in scope -- nothing silently absent.
   */
  scope_interface_ids_json?: string[] | null;
  /**
   * Start coverage-override audit trio (Spec 2026-06-11). All null when the
   * session was never overridden at /start -- legacy rows render unchanged.
   * The count mirrors AMS's boxed Integer so PATCH semantics never wipe it.
   */
  coverage_override_justification?: string | null;
  coverage_override_unaccounted_count?: number | null;
  coverage_override_at?: string | null;
  /**
   * Whole oracle-coverage summary for the session (Spec 2026-06-17 Oracle
   * Coverage Scoring; AMS changeset 189). Plain JSON blob, snake_case wire
   * (AMS default). Null / absent = legacy or pre-fix session = "coverage not
   * recorded" (NEVER an error). Display-only this iteration -- no hard gate.
   * Typed loosely here (Record) as the JSONB wire shape; parse it into the
   * structured {@link CoverageSummary} via `parseCoverageSummary` before
   * rendering. A later spec (baseline integrity & provenance, Spec C) reads
   * `overall_score` + per-endpoint dimensions/reasons off this field.
   */
  coverage_summary_json?: Record<string, unknown> | null;
  /**
   * Per-data-type operator-confirmed format defaults (Spec 2026-06-20 Capture
   * data-type format defaults; AMS changeset 195). A plain map
   * `category -> format string` where a non-null string is the operator
   * default, an explicit `null` records "no default" (the run gets no nudge
   * for that type), and an ABSENT key is untouched/never-decided. The map
   * itself may be `null` / absent (legacy or never-configured session = the
   * valid empty state -- NO backfill). snake_case wire (AMS default; no
   * `@CamelCaseWire`). The wizard's Step 5 PATCHes this via
   * {@link updateCaptureSession}; the preview rows that seed it come from
   * {@link dataTypeDefaultsPreview}. The `null` values inside the map MUST
   * survive the round-trip (not be dropped or coerced to a string).
   */
  data_type_defaults_json?: Record<string, string | null> | null;
  /**
   * Per-API operator-confirmed response-semantics config (Spec 2026-06-23
   * Semantics-aware API Behaviour Baseline coverage; AMS changeset 196). A
   * structured JSON blob mirroring the validation service's
   * `ResponseSemanticsConfig` (optional `statusBucketOverride` /
   * `notFoundMarkers` / `badRequestMarkers` / `fiveXxIsBadInput`). Null/absent
   * = built-in default vocabulary (the valid empty state -- NO backfill).
   * snake_case wire (AMS default; no `@CamelCaseWire`). PATCHed by the capture
   * wizard's semantics step via {@link updateCaptureSession}.
   */
  behaviour_semantics_config_json?: Record<string, unknown> | null;
}

export interface CreateApiBehaviourCaptureSessionRequest {
  project_id: string;
  architecture_id: string;
  name?: string | null;
  environment_name?: string | null;
  api_base_url?: string | null;
  auth_type?: string | null;
  auth_config_redacted_json?: Record<string, unknown> | null;
  default_headers_redacted_json?: Record<string, unknown> | null;
  oas_spec_refs_json?: Record<string, unknown> | null;
  db_config_redacted_json?: Record<string, unknown> | null;
  mutating_calls_confirmed?: boolean | null;
  /**
   * Per-data-type operator-confirmed format defaults (Spec 2026-06-20). A map
   * `category -> format string`; a `null` VALUE means explicit "no default".
   * The map may be null/absent. snake_case wire (AMS default).
   */
  data_type_defaults_json?: Record<string, string | null> | null;
  /**
   * Per-API operator-confirmed response-semantics config (Spec 2026-06-23). A
   * structured JSON blob; null/absent = built-in default vocabulary. snake_case
   * wire (AMS default).
   */
  behaviour_semantics_config_json?: Record<string, unknown> | null;
}

/** PATCH body — every field optional; null preserves the column. */
export interface UpdateApiBehaviourCaptureSessionRequest {
  name?: string | null;
  status?: CaptureSessionStatus | string | null;
  environment_name?: string | null;
  api_base_url?: string | null;
  auth_type?: string | null;
  auth_config_redacted_json?: Record<string, unknown> | null;
  default_headers_redacted_json?: Record<string, unknown> | null;
  oas_spec_refs_json?: Record<string, unknown> | null;
  db_config_redacted_json?: Record<string, unknown> | null;
  /** Per-session capture tuning (Item #5/S-1, 2026-08-27, AMS changeset
   *  227): { llm_tool_call_timeout_ms, max_response_body_bytes }. Omit for
   *  the validation service's env defaults. */
  capture_tuning_json?: Record<string, unknown> | null;
  mutating_calls_confirmed?: boolean | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  /**
   * Per-data-type operator-confirmed format defaults (Spec 2026-06-20). The
   * wizard's Step 5 PATCHes this map (`category -> format string`); a `null`
   * VALUE is an explicit "no default" decision and MUST round-trip intact.
   * Omitting the field entirely leaves the persisted column unchanged
   * (AMS null-guarded write path). snake_case wire (AMS default).
   */
  data_type_defaults_json?: Record<string, string | null> | null;
  /**
   * Per-API operator-confirmed response-semantics config (Spec 2026-06-23). A
   * structured JSON blob; null/absent = built-in default vocabulary. snake_case
   * wire (AMS default).
   */
  behaviour_semantics_config_json?: Record<string, unknown> | null;
}

export interface ApiBehaviourOperationDto {
  id: string;
  session_id: string;
  operation_id: string | null;
  method: string | null;
  path: string | null;
  summary: string | null;
  description: string | null;
  included: boolean | null;
  safe_to_execute: boolean | null;
  request_schema_json: Record<string, unknown> | null;
  response_schema_json: Record<string, unknown> | null;
  oas_operation_json: Record<string, unknown> | null;
  /**
   * Model-Seeded Capture Inventory (Spec 2026-06-11). Non-null iff this row
   * is an exclusion-with-reason accounting record written by
   * `account-endpoints` (`included = false`). Persistence IS the accounting
   * record the /start coverage gate reads -- no extra state exists.
   */
  exclusion_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateApiBehaviourOperationRequest {
  included?: boolean | null;
  safe_to_execute?: boolean | null;
  summary?: string | null;
  description?: string | null;
}

export interface ApiBehaviourScenarioDto {
  id: string;
  session_id: string;
  operation_id: string;
  scenario_name: string | null;
  scenario_type: string | null;
  status: string | null;
  generation_source: string | null;
  request_method: string | null;
  request_path: string | null;
  request_query_json: Record<string, unknown> | null;
  request_headers_redacted_json: Record<string, unknown> | null;
  request_body_json: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * PATCH body for a scenario row. The review UX uses this to persist scenario
 * renames triggered by the "rename scenario" action in `CaptureReviewPanel`.
 * Every field optional; `null` preserves the AMS column per the boxed-DTO
 * convention.
 */
export interface UpdateApiBehaviourScenarioRequest {
  scenario_name?: string | null;
  scenario_type?: string | null;
  status?: string | null;
  notes?: string | null;
}

export interface ApiBehaviourCaptureDto {
  id: string;
  session_id: string;
  scenario_id: string;
  operation_id: string;
  attempt_number: number | null;
  request_method: string | null;
  request_url_redacted: string | null;
  request_path: string | null;
  request_query_json: Record<string, unknown> | null;
  request_headers_redacted_json: Record<string, unknown> | null;
  request_body_json: Record<string, unknown> | null;
  response_status: number | null;
  response_headers_redacted_json: Record<string, unknown> | null;
  response_body_json: Record<string, unknown> | null;
  duration_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  captured_at: string | null;
  accepted: boolean | null;
  accepted_at: string | null;
  reviewer_notes: string | null;
  /**
   * Capture-time volatility envelope { paths, volatility_source, k } measured
   * by the probe in the validation-service `execute_http_request`. Carried
   * forward onto the source baseline item on Save-as-baseline. `null` => no
   * volatility recorded => strict comparison. snake_case wire (AMS default).
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling -- FU-2.
   */
  volatile_paths_json?: Record<string, unknown> | null;
}

export interface UpdateApiBehaviourCaptureRequest {
  accepted?: boolean | null;
  accepted_at?: string | null;
  reviewer_notes?: string | null;
}

// ============================================================================
// Manual capture ("Add New Behaviour") -- spec 2026-06-20
// ============================================================================

/**
 * Request body for the amvs `POST /capture-sessions/:id/manual-capture`
 * action ("Add New Behaviour" manual capture, spec 2026-06-20). camelCase to
 * match the amvs route ManualCaptureBody reader (the route maps onto the
 * snake_case AMS scenario/capture create shapes server-side).
 *
 *   - `operationId` is the AMS operation ROW id (`ApiBehaviourOperationDto.id`),
 *     used to attach the manual scenario + capture and enforce the
 *     included-operation guard.
 *   - `path` arrives ALREADY substituted -- the frontend resolves `{param}`
 *     tokens client-side so the server persists the concrete `request_path`.
 *   - `mutatingCallsConfirmed` carries the modals explicit-intent confirm
 *     flag (informational server-side; the send is permitted on either posture).
 */
export interface ManualCaptureRequest {
  operationId: string;
  method: string;
  path: string;
  query?: Record<string, unknown> | null;
  headers?: Record<string, string> | null;
  body?: unknown;
  mutatingCallsConfirmed?: boolean;
}

/**
 * Response from a successful manual capture (HTTP 201). Returns the created
 * `manual` scenario id alongside the persisted capture row (`accepted=null`,
 * `volatile_paths_json=null`) so the host panel can refresh the review table.
 */
export interface ManualCaptureResponse {
  sessionId: string;
  scenarioId: string;
  capture: ApiBehaviourCaptureDto;
}

/**
 * Machine-readable code on the manual-capture (and test-api-connection) 409
 * when the sessions in-memory secret is not loaded. The amvs route returns
 * `{ error: { code: SECRETS_NOT_LOADED, message } }` and `parseErrorBody`
 * unwraps the `error` envelope, so callers detect it via
 * `(err as ApiBehaviourApiError).body.code === SECRETS_NOT_LOADED_CODE` --
 * NEVER by message-string matching.
 */
export const SECRETS_NOT_LOADED_CODE = 'SECRETS_NOT_LOADED';

/**
 * Detect the 409 `SECRETS_NOT_LOADED` failure on a manual-capture (or any
 * secrets-gated action) error so the caller can route the user to the existing
 * parent-owned re-enter-secrets prompt instead of a generic error toast.
 */
export function isSecretsNotLoadedError(err: unknown): boolean {
  return (
    err instanceof ApiBehaviourApiError &&
    err.status === 409 &&
    err.body?.code === SECRETS_NOT_LOADED_CODE
  );
}


export interface ApiBehaviourDiagnosticDto {
  id: string;
  session_id: string;
  operation_id: string | null;
  scenario_id: string | null;
  diagnostic_type: string | null;
  message: string | null;
  detail_json: Record<string, unknown> | null;
  created_at: string;
}

export type BaselineStatus = 'draft' | 'active' | 'archived';

export interface ApiBehaviourBaselineDto {
  id: string;
  project_id: string;
  architecture_id: string;
  session_id: string | null;
  name: string | null;
  status: BaselineStatus | string;
  accepted_capture_count: number | null;
  operation_count: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Discriminator added by Spec 2026-05-25 (API Test Harness -- Target-Side
   * Capture). `'current'` is the default for legacy rows; `'target'`
   * identifies replay baselines that pair back to a source baseline via
   * `paired_with_baseline_id`.
   */
  kind?: 'current' | 'target' | null;
  /**
   * FK pairing field. Set only when `kind === 'target'`; null on current
   * baselines. Points at the source `kind='current', status='active'`
   * baseline this target was replayed from.
   */
  paired_with_baseline_id?: string | null;
  /**
   * Tamper-evidence content hash (Spec 2026-06-17 Baseline Integrity &
   * Provenance; AMS changeset 191). A lowercase-hex SHA-256 stamped
   * SERVER-SIDE at the draft -> active transition over the canonically
   * serialized baseline item set. snake_case wire (AMS default; no
   * `@CamelCaseWire`).
   *
   * `null` / absent = pre-existing or never-activated baseline = "no
   * integrity hash recorded" (NEVER an error; NO backfill). The integrity
   * badge in `BaselineDetailView` reads this null-vs-present distinction;
   * the at-rest baseline view surfaces the recorded hash + provenance, while
   * the live verified/mismatch verdict is the reconcile-side concern (the
   * AMS `GET .../baselines/{id}/integrity` operation consumed by the
   * validation service `diffRunner`).
   */
  content_hash?: string | null;
  /**
   * Provenance record stamped alongside `content_hash` at activate (Spec
   * 2026-06-17). Plain JSONB blob, snake_case wire. Shape:
   * `{ session_id, environment_name, activated_at, coverage_score,
   * coverage_summary, accepted_capture_count, operation_count,
   * hash_algo: "sha256", canonical_version: 1 }`. `coverage_score` is Spec
   * A's `overall_score` (0..1 fraction; null when the session summary was
   * not recorded). Typed loosely as a JSONB blob and read DEFENSIVELY via
   * {@link parseBaselineProvenance}; `null` / absent on pre-existing or
   * never-activated baselines.
   */
  provenance_json?: Record<string, unknown> | null;
}

/**
 * Structured view of `ApiBehaviourBaselineDto.provenance_json` (Spec
 * 2026-06-17 Baseline Integrity & Provenance). Every field is nullable
 * because the blob is read defensively -- a legacy / partial / malformed
 * record never throws, it just yields nulls that the view renders as an
 * em-dash. `coverage_score` is Spec A's `overall_score`, a 0..1 fraction.
 */
export interface BaselineProvenance {
  session_id: string | null;
  environment_name: string | null;
  activated_at: string | null;
  coverage_score: number | null;
  accepted_capture_count: number | null;
  operation_count: number | null;
  hash_algo: string | null;
  canonical_version: number | null;
}

/**
 * Defensively parse the raw `provenance_json` JSONB blob into the typed
 * {@link BaselineProvenance}. Returns `null` for null / absent / non-object
 * values so the caller can render "no provenance recorded" rather than an
 * error. Never throws; unknown / mistyped fields coerce to null.
 */
export function parseBaselineProvenance(
  raw: Record<string, unknown> | null | undefined,
): BaselineProvenance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    session_id: str(o.session_id),
    environment_name: str(o.environment_name),
    activated_at: str(o.activated_at),
    coverage_score: num(o.coverage_score),
    accepted_capture_count: num(o.accepted_capture_count),
    operation_count: num(o.operation_count),
    hash_algo: str(o.hash_algo),
    canonical_version: num(o.canonical_version),
  };
}

/**
 * Server-side integrity verdict from the AMS
 * `GET /api/v1/projects/{projectId}/architectures/{architectureId}/
 * api-behaviour/baselines/{baselineId}/integrity` operation (Spec
 * 2026-06-17). AMS recomputes the hash over the CURRENT stored items and
 * compares it to the recorded `content_hash`. snake_case wire.
 *
 * `integrity_verified === true`  -> recorded hash matches the recompute.
 * `integrity_verified === false` with non-null `content_hash` -> MISMATCH.
 * `content_hash === null` -> neutral "no hash recorded" (NOT a mismatch);
 * AMS returns `integrity_verified: false` in this case and the consumer
 * treats null-hash as neutral.
 */
export interface ApiBehaviourBaselineIntegrityDto {
  content_hash: string | null;
  recomputed_hash: string | null;
  integrity_verified: boolean;
}

export interface CreateApiBehaviourBaselineRequest {
  project_id: string;
  architecture_id: string;
  session_id?: string | null;
  name?: string | null;
  notes?: string | null;
}

export interface ApiBehaviourBaselineItemDto {
  id: string;
  baseline_id: string;
  capture_id: string;
  operation_id: string;
  scenario_id: string;
  method: string | null;
  path: string | null;
  scenario_name: string | null;
  request_json: Record<string, unknown> | null;
  response_status: number | null;
  response_json: Record<string, unknown> | null;
  business_notes: string | null;
  /**
   * Volatility envelope { paths, volatility_source, k } pinned on the source
   * baseline item (carried forward from the capture row). `null` => strict.
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling.
   */
  volatile_paths_json?: Record<string, unknown> | null;
  /**
   * Pinned ordered HTTP chain (setup -> act -> cleanup) for a stateful
   * sequence scenario. `null` / absent => today's single-shot item (zero
   * regression). Non-null carries the assembled steps:
   *   { steps: [ { index, role: 'setup'|'act'|'cleanup', kind: 'http',
   *       request: { method, path, query, headers, body }, expected_status,
   *       response_refs: [ { ref: '$<step>.<jsonpath>', from_step, json_path } ] } ],
   *     act_step_index, cleanup_best_effort }.
   * Read DEFENSIVELY (loose Record) -- the renderer narrows each field. The
   * column itself is AMS changeset 192 (nullable jsonb, snake_case wire).
   * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D).
   */
  sequence_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApiBehaviourBaselineItemRequest {
  baseline_id: string;
  capture_id: string;
  operation_id: string;
  scenario_id: string;
  method?: string | null;
  path?: string | null;
  scenario_name?: string | null;
  request_json?: Record<string, unknown> | null;
  response_status?: number | null;
  response_json?: Record<string, unknown> | null;
  business_notes?: string | null;
  /**
   * OPTIONAL volatility envelope carried forward from the capture row at
   * Save-as-baseline. Write-once at create time (baseline immutability); there
   * is deliberately NO update path. `null` / omitted => strict comparison.
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
   * Task Group 1 (AMS) + FU-2 (frontend carry-through).
   */
  volatile_paths_json?: Record<string, unknown> | null;
  /**
   * OPTIONAL pinned ordered HTTP chain for a stateful sequence scenario,
   * carried onto the ACT-step baseline item at Save-as-baseline (write-once at
   * create; NO update path -- mirrors `volatile_paths_json`). `null` / omitted
   * => single-shot item. Assembled capture-side and surfaced via the
   * `sequence_pinned` diagnostic marker on the canonical act-step capture.
   * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- Task Group 4.
   */
  sequence_json?: Record<string, unknown> | null;
}

// ============================================================================
// Action endpoint payload + response shapes
// ============================================================================

/** Body for `parse-oas` when selecting `Interface` rows from the architecture. */
export interface ParseOasRequest {
  interfaceIds?: string[];
}

export interface ParseOasResponse {
  sessionId: string;
  operationCount: number;
  mutatingExcluded: number;
  title: string | null;
  version: string | null;
}

// ----------------------------------------------------------------------------
// Inventory reconciliation wire shapes (Model-Seeded Capture Inventory spec,
// 2026-06-11, Task Group 4). These mirror the AMS reconciliation endpoint's
// snake_case payload VERBATIM (single wire contract defined once in AMS; the
// validation service's `reconcile-inventory` action passes it through
// untouched). The reconciliation KEY and the endpoint<->operation comparison
// live ONLY in the AMS Java calculator -- this client (like every TypeScript
// consumer) only carries the payload, never recomputes it.
// ----------------------------------------------------------------------------

/** Body for the `reconcile-inventory` action (snake_case, AMS wire). */
export interface ReconcileInventoryRequest {
  /**
   * Explicit scope override. Null/omitted -> the session row's persisted
   * `scope_interface_ids_json`; when that is also null the WHOLE
   * architecture's endpoint set is in scope.
   */
  scope_interface_ids?: string[] | null;
  /** True + ids provided -> AMS persists the scope onto the session row. */
  persist_scope?: boolean;
  /**
   * Omitted defaults to TRUE on the AMS side (session-linked reconciliation
   * findings are refreshed delete-before-emit). Display-only callers (the
   * baseline coverage figure) pass false explicitly.
   */
  refresh_findings?: boolean;
}

/** In-scope committed endpoint with NO matching operation row (gate blocker). */
export interface InventoryUnaccountedEndpointRef {
  endpoint_id: string;
  interface_id: string | null;
  key: string;
  name: string | null;
  method: string | null;
  path: string | null;
  protocol: string | null;
  soap_action: string | null;
  request_root_element: string | null;
}

/** Harness operation the committed model does not know (discovery gap). */
export interface InventoryOperationWithoutModelEndpointRef {
  operation_row_id: string;
  operation_id: string | null;
  method: string | null;
  path: string | null;
  key: string;
}

/** Endpoint excluded because its interface is outside the scope set. */
export interface InventoryExcludedByScopeEndpointRef {
  endpoint_id: string;
  interface_id: string | null;
  key: string;
  name: string | null;
}

/**
 * THE wire contract for the feature: the `reconcile-inventory` action
 * returns this verbatim and every frontend surface renders it without
 * reshaping. All numerics nullable (AMS boxed-Integer contract).
 */
export interface InventoryReconciliationResponse {
  in_scope_unaccounted_endpoints: InventoryUnaccountedEndpointRef[];
  operations_without_model_endpoint: InventoryOperationWithoutModelEndpointRef[];
  excluded_by_scope_endpoints: InventoryExcludedByScopeEndpointRef[];
  /**
   * Internal (non-HTTP) entry points auto-classified out of capture scope
   * (Spec 2026-07-24) — visible, never demanding accounting, never in any
   * coverage denominator. Optional: absent from pre-fix AMS responses.
   */
  internal_excluded_endpoints?: InventoryExcludedByScopeEndpointRef[];
  in_scope_coverage_pct: number | null;
  in_scope_accounted_count: number | null;
  in_scope_total_count: number | null;
  architecture_coverage_pct: number | null;
  architecture_accounted_count: number | null;
  architecture_total_count: number | null;
}

/** One bulk item for the `account-endpoints` action. */
export interface AccountEndpointsRequestItem {
  endpoint_id: string;
  action: 'include' | 'exclude';
  /** REQUIRED (non-empty) when `action === 'exclude'`; 400 otherwise. */
  reason?: string;
}

/**
 * `account-endpoints` response: the created/updated operation rows, so the
 * wizard can refresh its Step 4 table without a separate list call.
 */
export interface AccountEndpointsResponse {
  sessionId: string;
  operations: ApiBehaviourOperationDto[];
}

// ----------------------------------------------------------------------------
// Data-type format-defaults preview wire shapes (Spec 2026-06-20 Capture
// data-type format defaults, Task Group 5). These mirror the amvs route
// `POST /api/capture-sessions/:id/data-type-defaults-preview` response
// VERBATIM (snake_case, AMS-style wire). The classification + Col-4 seeding
// live ONLY amvs-side (the code-format inputs come from
// `request_contract.param_formats`, which the frontend cannot reach); this
// client only carries the rows, it never recomputes them.
// ----------------------------------------------------------------------------

/**
 * One contributing field listed under a preview row for the per-row
 * transparency UI (Q9): the field name, its location (`body`/`query`/`path`/
 * `header`, or null), and the raw code/contract format that fed the row. A
 * field contributes via exactly one side, so the other format is `null`.
 */
export interface DataTypeDefaultsContributingField {
  name: string;
  location: string | null;
  code_format: string | null;
  contract_format: string | null;
}

/**
 * One classified taxonomy row in the preview -- ONE per DISCOVERED category
 * (never an empty category, F3). `category` is the data-type bucket (`date`,
 * `datetime`, `decimal`, ...). `code_formats` / `contract_formats` are the
 * DISTINCT Col-2 / Col-3 format variations discovered. `default_format` is the
 * seeded Col-4 value (chain (a): code > contract > standard guess; `null` when
 * the category has no sensible standard, e.g. enum/boolean). `contributing_fields`
 * feeds the per-row transparency list.
 */
export interface DataTypeDefaultsPreviewRow {
  category: string;
  code_formats: string[];
  contract_formats: string[];
  default_format: string | null;
  contributing_fields: DataTypeDefaultsContributingField[];
}

/**
 * Response from the `data-type-defaults-preview` action. `rows` is empty when
 * no classifiable data types were discovered -- the wizard reads that empty
 * result as the auto-skip-the-step signal (Q8).
 */
export interface DataTypeDefaultsPreviewResponse {
  sessionId: string;
  rows: DataTypeDefaultsPreviewRow[];
}

/**
 * Response from the session-bound `POST /capture-sessions/:id/test-api-connection`
 * action. The route returns HTTP 200 even when the *target* responds with an
 * error status: `success` is `status >= 200 && status < 500`, so a 401/403/404
 * RESOLVES (does NOT throw) with `success: false`. Callers MUST inspect
 * `success` to distinguish a reachable-but-rejected probe from a healthy one.
 *
 * Shape matches the api-migration-validation-service route
 * (`captureSessionActions.ts`) verbatim -- the gateway proxies the JSON body
 * without reshaping.
 */
export interface TestApiConnectionResponse {
  sessionId: string;
  /** `status >= 200 && status < 500`. `false` = reachable but rejected. */
  success: boolean;
  /** `true` when the target was reached but rejected auth (HTTP 401/403). */
  authRejected?: boolean;
  /** HTTP status of the upstream probe (a GET on the base URL). */
  status: number;
  /** Wall-clock duration of the probe in milliseconds. */
  durationMs: number;
}

/**
 * Response from the session-bound `POST /capture-sessions/:id/test-db-connection`
 * action. Like the API probe, the route returns HTTP 200 with `success: false`
 * when the DB driver reports a non-infrastructure failure, so callers MUST
 * inspect `success`. Shape matches the route verbatim.
 */
export interface TestDbConnectionResponse {
  sessionId: string;
  /** `true` when the DB adapter's `testConnection()` succeeded. */
  success: boolean;
  /** Server version string reported by the driver on success, else null. */
  serverVersion?: string | null;
}

/**
 * Stateless "Test API connection" probe (in-wizard, pre-session).
 *
 * Unlike `testApiConnection` (which probes a persisted session using its
 * in-memory secrets bundle), this variant carries the FULL connection
 * config in the request body so the capture wizard can validate the API
 * environment in Step 2 BEFORE any session row exists. The gateway endpoint
 * `POST /api/v1/projects/:projectId/architectures/:architectureId/
 * api-behaviour/test-connection` is itself stateless: it fires one probe call
 * with the supplied baseUrl/auth/headers and returns the result. Secrets are
 * never persisted -- they live only in this request body for the duration of
 * the probe.
 */
export interface TestApiConnectionStatelessRequest {
  baseUrl: string;
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'header';
    token?: string;
    headerName?: string;
    headerValue?: string;
    username?: string;
    password?: string;
  };
  defaultHeaders?: { name: string; value: string }[];
}

export interface TestApiConnectionStatelessResponse {
  success: boolean;
  /**
   * `true` when the probe REACHED the target but auth was rejected (HTTP
   * 401/403). Surfaced distinctly from a green "Success" so a bad/expired
   * token cannot masquerade as a working connection (the probe proves
   * reachability + header wiring, not that the credentials were accepted).
   */
  authRejected?: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

/**
 * Body for `/secrets`. Mirrors the new service's `SecretsBundle` shape;
 * plaintext fields are typed loosely because the auth shape varies by
 * `auth_type`. NEVER persisted to AMS — held in process memory only.
 */
export interface SubmitSecretsRequest {
  apiAuth: {
    type: 'none' | 'bearer' | 'basic' | 'header' | string;
    token?: string;
    username?: string;
    password?: string;
    headerName?: string;
    headerValue?: string;
    [k: string]: unknown;
  };
  dbPassword?: string | null;
  /**
   * Optional READ-ONLY observation login (credential-role split): when BOTH
   * are present the capture service's observational DB paths (sampling,
   * snapshots, imaging, fingerprints) use this login and the write login
   * exists only inside compensation brackets. Sent as
   * `db.readonly_username` / `db.readonly_password` on the wire.
   */
  dbReadonlyUsername?: string | null;
  dbReadonlyPassword?: string | null;
  customHeaderSecrets?: Record<string, string>;
}

// ============================================================================
// Reviewer-notes encoding convention (Task Group 9)
// ============================================================================

/**
 * The `api_behaviour_captures.reviewer_notes` column is `TEXT`. To carry both
 * the human-typed notes string AND the structured field-mask metadata from
 * the review UX without adding a new column we encode the combined payload as
 * a single JSON document:
 *
 *   {
 *     "text": "human notes string",
 *     "masks": [
 *       { "path": "response.body.user.email", "label": "PII" },
 *       { "path": "response.body.token",      "label": "secret" }
 *     ]
 *   }
 *
 * Notes that pre-date this encoding (or are written by any non-UI caller as
 * plain text) parse defensively: `parseReviewerNotes` returns the literal
 * string as `text` and an empty mask list.
 *
 * The original redacted JSON on the capture row is never mutated -- masks
 * are applied at render time only, so the audit trail of what came back from
 * the upstream API is preserved exactly.
 */
export interface FieldMask {
  /**
   * Dotted/bracketed path into the rendered request/response JSON tree.
   * Format mirrors the conventional JSONPath subset (e.g. `body.user.email`
   * or `headers[0].value`); the renderer matches by exact-string equality
   * against the path-builder output so the rules are simple and deterministic.
   */
  path: string;
  /** Free-form reviewer label shown alongside the masked placeholder. */
  label?: string;
}

export interface ReviewerNotesPayload {
  text: string;
  masks: FieldMask[];
}

const REVIEWER_NOTES_VERSION_SENTINEL = 'masks';

/**
 * Parse a `reviewer_notes` cell into the structured payload shape. Defensive
 * against:
 *   - null / undefined / empty string -> `{ text: '', masks: [] }`
 *   - legacy plain-text notes -> `{ text: <literal>, masks: [] }`
 *   - well-formed JSON missing `text` or `masks` -> coerce to the contract
 *   - malformed JSON -> treat as legacy plain text
 *
 * The sentinel is the presence of the literal `"masks"` substring AND a
 * successful JSON parse with an object root. Any string that starts with a
 * `{` but doesn't carry that sentinel is treated as legacy text to avoid
 * accidental capture of user-typed JSON-looking strings.
 */
export function parseReviewerNotes(raw: string | null | undefined): ReviewerNotesPayload {
  if (raw === null || raw === undefined || raw === '') {
    return { text: '', masks: [] };
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes(REVIEWER_NOTES_VERSION_SENTINEL)) {
    return { text: raw, masks: [] };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { text: raw, masks: [] };
    }
    const obj = parsed as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? obj.text : '';
    const masksRaw = Array.isArray(obj.masks) ? obj.masks : [];
    const masks: FieldMask[] = [];
    for (const m of masksRaw) {
      if (!m || typeof m !== 'object') continue;
      const mo = m as Record<string, unknown>;
      if (typeof mo.path !== 'string' || mo.path.length === 0) continue;
      const entry: FieldMask = { path: mo.path };
      if (typeof mo.label === 'string') entry.label = mo.label;
      masks.push(entry);
    }
    return { text, masks };
  } catch {
    return { text: raw, masks: [] };
  }
}

/**
 * Serialise a structured reviewer-notes payload back to the wire string. If
 * the payload has no masks AND no text we write `null` to clear the column;
 * if there's text but no masks we still emit the structured wrapper so the
 * round-trip stays lossless (i.e. once a row is touched by the UI, its
 * `reviewer_notes` is always JSON from then on).
 *
 * Returns `null` for the empty case so callers can pass it straight into the
 * PATCH body and let the AMS null-guard skip the column on no-op edits.
 */
export function serialiseReviewerNotes(
  payload: ReviewerNotesPayload | null | undefined,
): string | null {
  if (!payload) return null;
  if (!payload.text && payload.masks.length === 0) return null;
  return JSON.stringify({ text: payload.text, masks: payload.masks });
}

// ============================================================================
// Internal URL helpers
// ============================================================================

function gatewayUrl(
  projectId: string,
  architectureId: string,
  resource: string,
  resourceId?: string,
): string {
  const base =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/api-behaviour/${resource}`;
  return resourceId ? `${base}/${encodeURIComponent(resourceId)}` : base;
}

function actionUrl(
  projectId: string,
  architectureId: string,
  sessionId: string,
  action: string,
): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/api-behaviour/capture-sessions/${encodeURIComponent(sessionId)}/${action}`
  );
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  // `no-store` (2026-07-25): every api-behaviour resource is live run state
  // (session status, scenario tallies, captures). A cached GET here renders a
  // stale run — the "Refresh run details" affordance must always hit the
  // server. Callers may still override via their own `cache` in `init`.
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiBehaviourApiError(res.status, body);
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

// ============================================================================
// Capture sessions CRUD
// ============================================================================

export async function listCaptureSessions(
  projectId: string,
  architectureId: string,
): Promise<ApiBehaviourCaptureSessionDto[]> {
  return jsonRequest<ApiBehaviourCaptureSessionDto[]>(
    gatewayUrl(projectId, architectureId, 'capture-sessions'),
    { method: 'GET' },
  );
}

export async function getCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    gatewayUrl(projectId, architectureId, 'capture-sessions', sessionId),
    { method: 'GET' },
  );
}

export async function createCaptureSession(
  projectId: string,
  architectureId: string,
  payload: CreateApiBehaviourCaptureSessionRequest,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    gatewayUrl(projectId, architectureId, 'capture-sessions'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function updateCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
  payload: UpdateApiBehaviourCaptureSessionRequest,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    gatewayUrl(projectId, architectureId, 'capture-sessions', sessionId),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<void> {
  await jsonRequest<void>(
    gatewayUrl(projectId, architectureId, 'capture-sessions', sessionId),
    { method: 'DELETE' },
  );
}

/**
 * Convenience helper for the secret-loss "Clone configuration" CTA. Issues a
 * POST against the capture-sessions collection with EVERY redacted field
 * from `source` pre-filled. The new draft is bound to the SAME project +
 * architecture as the source; callers can navigate to the returned id to
 * pick up wizard step 2 with the config already populated.
 *
 * Secrets are NEVER copied -- the source's plaintext lived only in process
 * memory on the new service. The clone always starts with status='draft'
 * and the reviewer-supplied `name` defaulting to `"<source.name> (clone)"`.
 */
export async function cloneCaptureSession(
  projectId: string,
  architectureId: string,
  source: ApiBehaviourCaptureSessionDto,
  overrides: Partial<CreateApiBehaviourCaptureSessionRequest> = {},
): Promise<ApiBehaviourCaptureSessionDto> {
  const payload: CreateApiBehaviourCaptureSessionRequest = {
    project_id: projectId,
    architecture_id: architectureId,
    name: source.name ? `${source.name} (clone)` : null,
    environment_name: source.environment_name,
    api_base_url: source.api_base_url,
    auth_type: source.auth_type,
    auth_config_redacted_json: source.auth_config_redacted_json,
    default_headers_redacted_json: source.default_headers_redacted_json,
    oas_spec_refs_json: source.oas_spec_refs_json,
    db_config_redacted_json: source.db_config_redacted_json,
    mutating_calls_confirmed: source.mutating_calls_confirmed,
    ...overrides,
  };
  return createCaptureSession(projectId, architectureId, payload);
}

// ============================================================================
// Operations CRUD
// ============================================================================

export async function listOperations(
  projectId: string,
  architectureId: string,
  sessionId?: string,
): Promise<ApiBehaviourOperationDto[]> {
  const base = gatewayUrl(projectId, architectureId, 'operations');
  const url = sessionId ? `${base}?sessionId=${encodeURIComponent(sessionId)}` : base;
  return jsonRequest<ApiBehaviourOperationDto[]>(url, { method: 'GET' });
}

export async function updateOperation(
  projectId: string,
  architectureId: string,
  operationId: string,
  payload: UpdateApiBehaviourOperationRequest,
): Promise<ApiBehaviourOperationDto> {
  return jsonRequest<ApiBehaviourOperationDto>(
    gatewayUrl(projectId, architectureId, 'operations', operationId),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

// ============================================================================
// Scenarios CRUD
// ============================================================================

export async function listScenarios(
  projectId: string,
  architectureId: string,
  sessionId?: string,
): Promise<ApiBehaviourScenarioDto[]> {
  const base = gatewayUrl(projectId, architectureId, 'scenarios');
  const url = sessionId ? `${base}?sessionId=${encodeURIComponent(sessionId)}` : base;
  return jsonRequest<ApiBehaviourScenarioDto[]>(url, { method: 'GET' });
}

/**
 * PATCH a single scenario row. Used by the review UX (`CaptureReviewPanel`)
 * to persist scenario renames. Every field on the request body is optional;
 * `null` round-trips to AMS where the null-guard skips it.
 */
export async function updateScenario(
  projectId: string,
  architectureId: string,
  scenarioId: string,
  payload: UpdateApiBehaviourScenarioRequest,
): Promise<ApiBehaviourScenarioDto> {
  return jsonRequest<ApiBehaviourScenarioDto>(
    gatewayUrl(projectId, architectureId, 'scenarios', scenarioId),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

// ============================================================================
// Captures CRUD
// ============================================================================

export async function listCaptures(
  projectId: string,
  architectureId: string,
  sessionId?: string,
): Promise<ApiBehaviourCaptureDto[]> {
  const base = gatewayUrl(projectId, architectureId, 'captures');
  const url = sessionId ? `${base}?sessionId=${encodeURIComponent(sessionId)}` : base;
  return jsonRequest<ApiBehaviourCaptureDto[]>(url, { method: 'GET' });
}

export async function updateCapture(
  projectId: string,
  architectureId: string,
  captureId: string,
  payload: UpdateApiBehaviourCaptureRequest,
): Promise<ApiBehaviourCaptureDto> {
  return jsonRequest<ApiBehaviourCaptureDto>(
    gatewayUrl(projectId, architectureId, 'captures', captureId),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

// ============================================================================
// Diagnostics CRUD
// ============================================================================

export async function listDiagnostics(
  projectId: string,
  architectureId: string,
  sessionId?: string,
): Promise<ApiBehaviourDiagnosticDto[]> {
  const base = gatewayUrl(projectId, architectureId, 'diagnostics');
  const url = sessionId ? `${base}?sessionId=${encodeURIComponent(sessionId)}` : base;
  return jsonRequest<ApiBehaviourDiagnosticDto[]>(url, { method: 'GET' });
}

// ============================================================================
// Baselines CRUD
// ============================================================================

export async function listBaselines(
  projectId: string,
  architectureId: string,
  options?: { kind?: 'current' | 'target' },
): Promise<ApiBehaviourBaselineDto[]> {
  const base = gatewayUrl(projectId, architectureId, 'baselines');
  const kind = options?.kind;
  const url = kind ? `${base}?kind=${encodeURIComponent(kind)}` : base;
  return jsonRequest<ApiBehaviourBaselineDto[]>(url, { method: 'GET' });
}

export async function getBaseline(
  projectId: string,
  architectureId: string,
  baselineId: string,
): Promise<ApiBehaviourBaselineDto> {
  return jsonRequest<ApiBehaviourBaselineDto>(
    gatewayUrl(projectId, architectureId, 'baselines', baselineId),
    { method: 'GET' },
  );
}

export async function createBaseline(
  projectId: string,
  architectureId: string,
  payload: CreateApiBehaviourBaselineRequest,
): Promise<ApiBehaviourBaselineDto> {
  return jsonRequest<ApiBehaviourBaselineDto>(
    gatewayUrl(projectId, architectureId, 'baselines'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/**
 * PATCH body for an existing baseline. The status transitions are validated
 * server-side (`draft → active|archived`, `active → archived|draft`,
 * `archived → active`) — the UI's Activate/Archive controls send `status`
 * alone. Other fields are PATCH-optional (null-guarded server-side).
 */
export interface UpdateApiBehaviourBaselineRequest {
  name?: string | null;
  status?: BaselineStatus;
  notes?: string | null;
}

/**
 * Update a baseline — most notably PROMOTE a draft to `active` (the readiness
 * rules require an ACTIVE baseline for the api/baseline streams to read
 * sufficient) or retire one to `archived`. Closes the "promotion to active is
 * out of scope for v1" gap noted in `SaveAsBaselineModal`.
 */
export async function updateBaseline(
  projectId: string,
  architectureId: string,
  baselineId: string,
  payload: UpdateApiBehaviourBaselineRequest,
): Promise<ApiBehaviourBaselineDto> {
  return jsonRequest<ApiBehaviourBaselineDto>(
    gatewayUrl(projectId, architectureId, 'baselines', baselineId),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Delete a saved baseline and its child rows (baseline items, plus any
 * diff/drift reports computed FROM or AGAINST it -- all cascade server-side).
 * Powers the Saved Baselines list delete action so a user can clean up
 * test/iteration baselines without starting a fresh project.
 *
 * Note: deleting a baseline does NOT touch the capture session it was saved
 * from (the soft `session_id` back-reference is set null, not cascaded).
 */
export async function deleteBaseline(
  projectId: string,
  architectureId: string,
  baselineId: string,
): Promise<void> {
  await jsonRequest<void>(
    gatewayUrl(projectId, architectureId, 'baselines', baselineId),
    { method: 'DELETE' },
  );
}

/**
 * Fetch the server-side integrity verdict for a baseline (Spec 2026-06-17
 * Baseline Integrity & Provenance). Calls the AMS
 * `GET .../baselines/{id}/integrity` operation, which recomputes the hash
 * over the CURRENT stored items and returns
 * `{ content_hash, recomputed_hash, integrity_verified }` (snake_case).
 *
 * Mirrors the `getBaseline` endpoint shape; the path is the baseline route
 * with a trailing `/integrity` segment. Verification is ENTIRELY server-side
 * -- this client only carries the verdict, it never recomputes the hash.
 */
export async function getBaselineIntegrity(
  projectId: string,
  architectureId: string,
  baselineId: string,
): Promise<ApiBehaviourBaselineIntegrityDto> {
  return jsonRequest<ApiBehaviourBaselineIntegrityDto>(
    `${gatewayUrl(projectId, architectureId, "baselines", baselineId)}/integrity`,
    { method: "GET" },
  );
}

// ============================================================================
// Baseline items CRUD
// ============================================================================

export async function listBaselineItems(
  projectId: string,
  architectureId: string,
  baselineId?: string,
): Promise<ApiBehaviourBaselineItemDto[]> {
  const base = gatewayUrl(projectId, architectureId, 'baseline-items');
  const url = baselineId ? `${base}?baselineId=${encodeURIComponent(baselineId)}` : base;
  return jsonRequest<ApiBehaviourBaselineItemDto[]>(url, { method: 'GET' });
}

export async function createBaselineItem(
  projectId: string,
  architectureId: string,
  payload: CreateApiBehaviourBaselineItemRequest,
): Promise<ApiBehaviourBaselineItemDto> {
  return jsonRequest<ApiBehaviourBaselineItemDto>(
    gatewayUrl(projectId, architectureId, 'baseline-items'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

// ----------------------------------------------------------------------------
// Batch baseline-items + captures (Spec 2026-06-20 Baseline Save & Review --
// Batch + Activate + Export, R1). The save / accept-all / reject-all tails
// previously looped one gateway request PER capture (~263 sequential calls),
// tripping the gateway rate limiter. These two helpers collapse each loop into
// a SINGLE best-effort, NON-atomic batch call: every item is persisted /
// patched independently and a bad item is reported in `failed[]` WITHOUT
// aborting the rest. The gateway registers `/baseline-items/batch` (POST) and
// `/captures/batch` (PATCH) explicitly BEFORE the generic `/:id` routes, so the
// literal `batch` segment is never captured as an id. Per-call cap is 500
// (a clear 400 above that). Snake_case wire (AMS default).
// ----------------------------------------------------------------------------

/**
 * Per-item failure record for a baseline-items batch create. `index` is the
 * 0-based position of the offending item in the submitted `items[]`; `capture_id`
 * echoes that item's `capture_id` (null when the item carried none) so the UI
 * can name the exact capture that failed without re-deriving it.
 */
export interface BatchCreateBaselineItemFailure {
  index: number;
  capture_id: string | null;
  reason: string;
}

/** Request body for `POST .../baseline-items/batch`. */
export interface BatchCreateBaselineItemsRequest {
  items: CreateApiBehaviourBaselineItemRequest[];
}

/**
 * Response from `POST .../baseline-items/batch`. `created` holds the persisted
 * rows (in submission order, minus the failures); `failed` holds one record
 * per item that did not persist. Best-effort: a non-empty `failed[]` does NOT
 * mean the whole call failed -- the `created` rows are committed regardless.
 */
export interface BatchCreateBaselineItemsResponse {
  created: ApiBehaviourBaselineItemDto[];
  failed: BatchCreateBaselineItemFailure[];
}

/** One `{ id, patch }` entry for a captures batch update. */
export interface BatchUpdateCaptureItem {
  id: string;
  patch: UpdateApiBehaviourCaptureRequest;
}

/** Request body for `PATCH .../captures/batch`. */
export interface BatchUpdateCapturesRequest {
  items: BatchUpdateCaptureItem[];
}

/** Per-item failure record for a captures batch update (keyed by capture id). */
export interface BatchUpdateCaptureFailure {
  id: string;
  reason: string;
}

/**
 * Response from `PATCH .../captures/batch`. `updated` holds the patched rows;
 * `failed` holds one record per id that did not patch. Best-effort / non-atomic
 * (see the section note above).
 */
export interface BatchUpdateCapturesResponse {
  updated: ApiBehaviourCaptureDto[];
  failed: BatchUpdateCaptureFailure[];
}

/**
 * Persist many baseline items in ONE best-effort batch (replaces the per-item
 * `createBaselineItem` save loop). POSTs `{ items }` to
 * `.../baseline-items/batch` and returns `{ created, failed }`. Callers render
 * `failed[]` as a warning naming the captures that did not persist; the
 * `created` rows are committed even when `failed[]` is non-empty.
 */
export async function createBaselineItemsBatch(
  projectId: string,
  architectureId: string,
  items: CreateApiBehaviourBaselineItemRequest[],
): Promise<BatchCreateBaselineItemsResponse> {
  return jsonRequest<BatchCreateBaselineItemsResponse>(
    `${gatewayUrl(projectId, architectureId, 'baseline-items')}/batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  );
}

/**
 * Patch many captures in ONE best-effort batch (replaces the per-item
 * `updateCapture` accept-all / reject-all loops). Each entry carries its OWN
 * `{ id, patch }` so reject-all can preserve every row's reviewer-notes masks
 * while accept-all sends the same patch per id. PATCHes `{ items }` to
 * `.../captures/batch` and returns `{ updated, failed }`; callers merge
 * `updated[]` into state and surface `failed[]` as a warning.
 */
export async function updateCapturesBatch(
  projectId: string,
  architectureId: string,
  items: BatchUpdateCaptureItem[],
): Promise<BatchUpdateCapturesResponse> {
  return jsonRequest<BatchUpdateCapturesResponse>(
    `${gatewayUrl(projectId, architectureId, 'captures')}/batch`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  );
}

// ============================================================================
// Action endpoints (proxied to api-migration-validation-service)
// ============================================================================

/**
 * Trigger OAS parsing on the new service. Either supply `interfaceIds`
 * (preferred — pulls each `Interface.spec_link` and reads from the shared
 * `oas-specs/` volume) OR upload a raw OAS file (fallback; bytes are NOT
 * persisted, only the parsed inventory).
 */
export async function parseOas(
  projectId: string,
  architectureId: string,
  sessionId: string,
  body: ParseOasRequest | { file: File } | { files: File[] },
): Promise<ParseOasResponse> {
  const url = actionUrl(projectId, architectureId, sessionId, 'parse-oas');

  // Multi-file upload (spec 2026-06-03 OAS-YAML + WADL/XSD): the wizard may
  // upload a single OAS doc OR a WADL together with one-or-more sibling `.xsd`
  // grammar files. Every part is sent under the SAME `file` field name; the
  // backend's `multer().array('file')` collects them and classifies the set.
  if ('files' in body) {
    const fd = new FormData();
    for (const f of body.files) fd.append('file', f, f.name);
    return jsonRequest<ParseOasResponse>(url, { method: 'POST', body: fd });
  }
  if ('file' in body) {
    const fd = new FormData();
    fd.append('file', body.file, body.file.name);
    return jsonRequest<ParseOasResponse>(url, { method: 'POST', body: fd });
  }
  return jsonRequest<ParseOasResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Parse-ONLY contract refresh (2026-08-08): repopulate the service's
 * in-memory OAS inventory cache for a session from an uploaded contract
 * (OAS doc, or WADL + sibling XSDs) WITHOUT persisting operation rows.
 * Optional enrichment for "Retry uncovered APIs" — the repair pass works
 * without it by rebuilding from the session's persisted operations.
 */
export async function refreshOasCache(
  projectId: string,
  architectureId: string,
  sessionId: string,
  files: File[],
): Promise<{ sessionId: string; operationCount: number }> {
  const url = actionUrl(projectId, architectureId, sessionId, 'refresh-oas-cache');
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  return jsonRequest<{ sessionId: string; operationCount: number }>(url, {
    method: 'POST',
    body: fd,
  });
}

export async function testApiConnection(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<TestApiConnectionResponse> {
  return jsonRequest<TestApiConnectionResponse>(
    actionUrl(projectId, architectureId, sessionId, 'test-api-connection'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

export async function testDbConnection(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<TestDbConnectionResponse> {
  return jsonRequest<TestDbConnectionResponse>(
    actionUrl(projectId, architectureId, sessionId, 'test-db-connection'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

/**
 * Pre-start compensation preflight (CSD Spec 3 gap fix, 2026-08-19). Read-
 * only: lists every INCLUDED write endpoint with no effect-table map in the
 * committed model (`"METHOD /path"` strings) — those mutating scenarios are
 * REFUSED fail-closed at capture time. The wizard warns off this BEFORE
 * /start. Shape matches the validation-service route verbatim (snake_case;
 * the gateway proxies without reshaping).
 */
export interface CompensationPreflightResponse {
  session_id: string;
  model_resolvable: boolean;
  write_endpoints_without_effect_map: string[];
  note: string | null;
}

export async function getCompensationPreflight(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<CompensationPreflightResponse> {
  return jsonRequest<CompensationPreflightResponse>(
    actionUrl(projectId, architectureId, sessionId, 'compensation-preflight'),
    { method: 'GET' },
  );
}

/**
 * Stateless "Test API connection" probe used by the capture wizard's Step 2
 * (API environment) BEFORE a session row exists. Posts the full connection
 * config (baseUrl + auth + default headers) to the gateway's stateless
 * endpoint:
 *
 *   POST /api/v1/projects/:projectId/architectures/:architectureId/
 *        api-behaviour/test-connection
 *
 * The endpoint fires one probe call and returns `{ success, status,
 * durationMs, error? }`. Distinct from `testApiConnection`, which probes a
 * persisted session via its in-memory secrets bundle and rides the session
 * id in the path. Secrets are never persisted -- they live only in this
 * request body for the duration of the probe.
 */
export async function testApiConnectionStateless(
  projectId: string,
  architectureId: string,
  body: TestApiConnectionStatelessRequest,
): Promise<TestApiConnectionStatelessResponse> {
  return jsonRequest<TestApiConnectionStatelessResponse>(
    gatewayUrl(projectId, architectureId, 'test-connection'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/**
 * Optional body forwarded verbatim to api-migration-validation-service's
 * `POST /api/capture-sessions/:id/start` handler. The downstream route
 * accepts `discoveryRunIds`, `includeDiscoveryContext`, `maxFindings`, and
 * `maxEvidenceItems` so the capture wizard can pass through the
 * Discovery Context section selections (Spec 2026-05-16 Migration Discovery
 * Context Integration -- Task Group 4). All fields are optional; omitting
 * any one lets the downstream service apply its documented defaults.
 */
export interface StartCaptureSessionRequest {
  discoveryRunIds?: string[];
  includeDiscoveryContext?: boolean;
  maxFindings?: number;
  maxEvidenceItems?: number;
  /**
   * Model-Seeded Capture Inventory (Spec 2026-06-11): justified override for
   * the fail-closed inventory-coverage gate. When present and non-empty the
   * validation service persists the override trio (justification, unaccounted
   * count at override time, timestamp) onto the session row and proceeds to
   * start despite unaccounted in-scope endpoints. CamelCase, matching the
   * existing `includeDiscoveryContext` / `discoveryRunIds` body fields.
   */
  coverageOverrideJustification?: string;
  /**
   * Postman-only run mode (Spec 2026-06-23 Import a Postman Collection into
   * Capture, R4c / D3 Mode 1c). When true the orchestrator skips the planner
   * AND the per-scenario execute_http_request loop -- the imported Postman items
   * were already fired as concrete manual-capture sends before /start, so
   * coverage is intentionally partial and the caller MUST also carry
   * coverageOverrideJustification so the coverage gate does not fail closed.
   * CamelCase, matching the other body fields and the amvs /start handler
   * (captureSessionActions.ts:598).
   */
  postmanOnly?: boolean;
  /**
   * Mode 1(b) Postman + LLM delta (Spec 2026-06-23, R6). The per-operation
   * captured-Postman map the wizard builds from its pre-/start manual-capture
   * sends (keyed by operation_id; method + path + the real response status
   * class). The amvs /start handler forwards it into the orchestrator deps so
   * the two-stage bounded subtraction tops up only the delta. Absent/empty ->
   * the full candidate set generates (today behaviour). CamelCase wire field.
   */
  postmanCapturedByOp?: Record<
    string,
    Array<{ method: string; path: string; expectedStatus: string | null }>
  >;
}

/**
 * Start the capture loop. Guarded server-side on `status='configured' AND
 * secrets present AND OAS inventory parsed`. Returns the running session
 * snapshot.
 *
 * The optional `body` was added by the 2026-05-16 Migration Discovery
 * Context Integration spec so the wizard can pass through the Discovery
 * Context section selections (run IDs + include toggle + count limits).
 * Backwards-compatible: calling with no body sends `{}` exactly as before
 * and the downstream service defaults to `includeDiscoveryContext=true` +
 * latest-relevant discovery context.
 */
export async function startCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
  body?: StartCaptureSessionRequest,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    actionUrl(projectId, architectureId, sessionId, 'start'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  );
}

/**
 * Cancel a running session. Sets status `cancelled`, signals abort, and
 * purges in-memory secrets on the new service.
 */
export async function cancelCaptureSession(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    actionUrl(projectId, architectureId, sessionId, 'cancel'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

/**
 * Map the wizard's auth-type vocabulary to the backend's. The wizard uses
 * short, UI-friendly names (`'header'`) while the backend (`SecretsBundle`
 * in api-migration-validation-service/types/secrets.ts) distinguishes
 * `'api_key_header' | 'api_key_query' | 'custom_header'`. v1 only emits
 * `'header'` from the wizard which maps cleanly to `'custom_header'`;
 * other values pass through (so a backend-vocabulary type like
 * `'api_key_header'` supplied directly still works).
 *
 * @internal
 */
function mapAuthTypeToBackend(raw: string | undefined): string {
  if (!raw) return 'none';
  switch (raw) {
    case 'header':
      return 'custom_header';
    case 'sso_token':
      // Convenience option: a fixed-name `ssoToken` custom header. On the wire
      // it is an ordinary custom_header (the wizard supplies the fixed
      // headerName + the trimmed headerValue).
      return 'custom_header';
    default:
      return raw;
  }
}

/**
 * Reshape the wizard-friendly camelCase secrets bundle into the wire shape
 * the backend `/secrets` action endpoint validates against. The backend
 * expects `{ api: { type, ... }, db?: { password } }` -- this function
 * is the single point of translation so callers can keep using the
 * domain-friendly `apiAuth` / `dbPassword` field names.
 *
 * @internal
 */
function toSecretsWireBody(payload: SubmitSecretsRequest): {
  api: Record<string, unknown>;
  db: {
    password: string;
    readonly_username?: string;
    readonly_password?: string;
  } | null;
} {
  const apiIn = payload.apiAuth ?? { type: 'none' };
  const api: Record<string, unknown> = {
    ...apiIn,
    type: mapAuthTypeToBackend(typeof apiIn.type === 'string' ? apiIn.type : 'none'),
  };
  // The wizard sends `headerName` / `headerValue` for its `'header'` auth
  // mode; the backend reads the same field names for `'custom_header'`, so
  // no further key remapping is needed.
  const dbPassword = payload.dbPassword;
  // Credential-role split: both-or-nothing, matching the backend rule (a
  // lone value silently keeps the single-login posture).
  const readonlySplit =
    typeof payload.dbReadonlyUsername === 'string' &&
    payload.dbReadonlyUsername.length > 0 &&
    typeof payload.dbReadonlyPassword === 'string' &&
    payload.dbReadonlyPassword.length > 0;
  return {
    api,
    db: typeof dbPassword === 'string' && dbPassword.length > 0
      ? {
          password: dbPassword,
          ...(readonlySplit
            ? {
                readonly_username: payload.dbReadonlyUsername as string,
                readonly_password: payload.dbReadonlyPassword as string,
              }
            : {}),
        }
      : null,
  };
}

/**
 * Re-populate the in-memory secrets bundle for a session. NEVER writes to
 * AMS — the new service holds plaintext in process memory only while the
 * session is `configured` or `running`. Used by the wizard finalisation step
 * AND by the secret-loss "Re-enter secrets" inline prompt.
 *
 * Bug fix (2026-05-17): callers pass the friendly `{ apiAuth, dbPassword }`
 * shape; this function reshapes it to the backend's wire DTO
 * `{ api, db: { password } }` before posting. A prior revision sent the
 * frontend shape verbatim and every secrets submission failed with 400
 * "secrets body must include { api: { type, ... } }".
 */
export async function submitSecrets(
  projectId: string,
  architectureId: string,
  sessionId: string,
  payload: SubmitSecretsRequest,
): Promise<{ ok: true }> {
  const wireBody = toSecretsWireBody(payload);
  return jsonRequest<{ ok: true }>(
    actionUrl(projectId, architectureId, sessionId, 'secrets'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wireBody),
    },
  );
}


// ============================================================================
// Inventory reconciliation actions (Model-Seeded Capture Inventory spec,
// 2026-06-11, Task Group 4)
// ============================================================================

/**
 * Configure-time inventory reconciliation. Proxied by the gateway to the
 * validation service's `reconcile-inventory` action, which calls the AMS
 * reconciliation endpoint and returns its snake_case payload VERBATIM.
 * Display-only callers (baseline coverage figure) pass
 * `{ refresh_findings: false }`; configure-time callers omit the flag so
 * the AMS default (true) refreshes session-linked reconciliation findings.
 */
export async function reconcileInventory(
  projectId: string,
  architectureId: string,
  sessionId: string,
  body: ReconcileInventoryRequest = {},
): Promise<InventoryReconciliationResponse> {
  return jsonRequest<InventoryReconciliationResponse>(
    actionUrl(projectId, architectureId, sessionId, 'reconcile-inventory'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/** Per-endpoint Pass B config for the `retry-uncovered` action (CC3). */
export interface RetryUncoveredConfigEntry {
  operationId: string;
  attempts?: number;
  notes?: string;
}

/** Response from the `retry-uncovered` Coverage Closure action. */
export interface RetryUncoveredResponse {
  sessionId: string;
  passA: { fired: number; closed: string[] };
  passB: { attempted: number; closed: string[]; available: boolean };
  /** Dimensional retry results (2026-07-25; zeros unless the flag was sent). */
  dimensional?: {
    attempted: number;
    closed: Array<{ operation_id: string; name: string; capture_id: string }>;
  };
  /** Auth-negative re-probe outcome (null when not needed / not requested). */
  authReprobe?: { attempted: boolean; achieved: boolean } | null;
  gate: {
    complete: boolean;
    included_total: number;
    happy_achieved: number;
    unresolved: Array<{ operation_id: string; method: string; path: string; reason: string }>;
  };
  note?: string;
}

/**
 * Kick off Coverage Closure over a completed session's uncovered endpoints
 * (Spec 2026-07-20). Proxied by the gateway to the validation service's
 * `retry-uncovered` action, which runs Pass A (deterministic id replay) then
 * Pass B (per-endpoint LLM repair with the supplied attempts/notes), patches
 * the coverage summary, and returns the fresh happy-path gate. Mirrors
 * `reconcileInventory`: `actionUrl(..., 'retry-uncovered')` + a JSON POST.
 */
export async function retryUncoveredApis(
  projectId: string,
  architectureId: string,
  sessionId: string,
  config: RetryUncoveredConfigEntry[],
  includeOtherDimensions = false,
): Promise<RetryUncoveredResponse> {
  return jsonRequest<RetryUncoveredResponse>(
    actionUrl(projectId, architectureId, sessionId, 'retry-uncovered'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, includeOtherDimensions }),
    },
  );
}

/** Response from the `exclude-endpoint` Pass C action (fresh gate). */
export interface ExcludeEndpointResponse {
  sessionId: string;
  gate: RetryUncoveredResponse['gate'];
}

/**
 * Coverage Closure Pass C exclude-with-reason (Spec 2026-07-20). Proxied to the
 * validation service's `exclude-endpoint` action, which drops the endpoint from
 * the coverage summary (leaving the happy-path gate denominator, "accounted"
 * not "unresolved") with an audited reason, and returns the fresh gate.
 */
export async function excludeEndpoint(
  projectId: string,
  architectureId: string,
  sessionId: string,
  operationId: string,
  reason: string,
  /**
   * Optional (2026-08-02): scope the exclusion to ONE failed non-happy
   * dimension ("Not Possible" on an `other` row). Absent excludes the whole
   * endpoint (the happy-path "Not Possible").
   */
  scenarioName?: string,
): Promise<ExcludeEndpointResponse> {
  return jsonRequest<ExcludeEndpointResponse>(
    actionUrl(projectId, architectureId, sessionId, 'exclude-endpoint'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId,
        reason,
        ...(scenarioName ? { scenarioName } : {}),
      }),
    },
  );
}

/**
 * Compute the wizard Step 5 "Data-type formats" preview (Spec 2026-06-20
 * Capture data-type format defaults). Proxied by the gateway to the amvs
 * `data-type-defaults-preview` action, which loads the architecture endpoints
 * (code evidence via `request_contract.param_formats`) + the session's
 * contract-derived operations, runs the colocated data-type classifier, and
 * returns ONE row per DISCOVERED category with the distinct code/contract
 * format variations, the seeded Col-4 default, and the contributing-fields
 * transparency list. An empty `rows` array means no classifiable data types
 * were found -- the wizard auto-skips the step in that case.
 *
 * Mirrors `reconcileInventory` / `accountEndpoints`: `actionUrl(...,
 * 'data-type-defaults-preview')` + a JSON POST.
 */
export async function dataTypeDefaultsPreview(
  projectId: string,
  architectureId: string,
  sessionId: string,
): Promise<DataTypeDefaultsPreviewResponse> {
  return jsonRequest<DataTypeDefaultsPreviewResponse>(
    actionUrl(projectId, architectureId, sessionId, 'data-type-defaults-preview'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

/**
 * Bulk include / exclude-with-reason accounting action. INCLUDE auto-creates
 * a schema-less operation row from the committed endpoint's metadata; EXCLUDE
 * persists the same identity row with `included = false` + the supplied
 * `exclusion_reason` (which the server REQUIRES non-empty). Bulk-capable so
 * "Include all" is one round trip. Responds with the created rows so the
 * wizard refreshes its Step 4 table without a separate list call.
 */
export async function accountEndpoints(
  projectId: string,
  architectureId: string,
  sessionId: string,
  items: AccountEndpointsRequestItem[],
): Promise<AccountEndpointsResponse> {
  return jsonRequest<AccountEndpointsResponse>(
    actionUrl(projectId, architectureId, sessionId, 'account-endpoints'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  );
}

// ----------------------------------------------------------------------------
// Add-operation action (Spec 2026-06-23 Import a Postman Collection into
// Capture, R7/R8). Mode 2 (and Mode 1 staging) can append endpoints NOT already
// in the session. The amvs add-operation action creates the operation row with
// included = true BEFORE the manual-capture send, reusing
// synthesiseOperationFromEndpoint + the account-endpoints createOperation
// snake_case AMS shape server-side. This client mirrors accountEndpoints:
// actionUrl(..., 'add-operation') + a JSON POST. The request body is camelCase
// (this client owns the shape); the snake_case AMS create shape is applied
// server-side (R8). The created operation row comes back snake_case (AMS DTO),
// so the staging UI can refresh without a re-list.
// ----------------------------------------------------------------------------

/**
 * Body for the add-operation action. Appends ONE endpoint to the session as an
 * included = true operation row so the subsequent manualCapture send passes the
 * route OPERATION_NOT_FOUND / OPERATION_NOT_INCLUDED guards.
 *
 *   - endpointId  The committed architecture endpoint id when the imported item
 *                 matched one (server reuses synthesiseOperationFromEndpoint).
 *                 Omitted for an architecture-unmatched endpoint the user kept.
 *   - method/path The concrete operation identity (always sent so the server can
 *                 synthesise a row even with no endpointId); the path is the
 *                 resolved path the import staged.
 *   - operationId Optional explicit operation id; the server derives one from
 *                 method/path when omitted.
 *   - summary/description Optional human labels carried onto the row.
 */
export interface AddOperationRequest {
  endpointId?: string | null;
  method: string;
  path: string;
  operationId?: string | null;
  summary?: string | null;
  description?: string | null;
}

/**
 * add-operation response: the created (or already-present) operation row.
 * Snake_case AMS DTO (ApiBehaviourOperationDto) so the staging UI refreshes its
 * row list verbatim; created distinguishes a fresh insert from an idempotent
 * hit on an operation that already existed for the session.
 */
export interface AddOperationResponse {
  sessionId: string;
  operation: ApiBehaviourOperationDto;
  created: boolean;
}

/**
 * Append ONE endpoint to the session as an included = true operation row BEFORE
 * any manual-capture send (R7/A2). Mirrors accountEndpoints / manualCapture:
 * actionUrl(..., 'add-operation') + a JSON POST. The request body is camelCase
 * (this client owns the shape); the validation service maps it to the snake_case
 * AMS createOperation shape (R8). Returns the created snake_case operation row so
 * the staging table refreshes without a separate list call.
 */
export async function addOperation(
  projectId: string,
  architectureId: string,
  sessionId: string,
  body: AddOperationRequest,
): Promise<AddOperationResponse> {
  return jsonRequest<AddOperationResponse>(
    actionUrl(projectId, architectureId, sessionId, 'add-operation'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

// ============================================================================
// Manual capture action ("Add New Behaviour", spec 2026-06-20)
// ============================================================================

/**
 * Send ONE ad-hoc request for an EXISTING included operation during capture
 * review and persist it as a `manual` scenario + `accepted=null` capture.
 * Proxied by the gateway to the validation services `manual-capture` action,
 * which physically sends the request through the per-session executor so
 * redaction is applied IDENTICALLY to LLM captures. Mirrors `reconcileInventory`
 * / `accountEndpoints`: `actionUrl(..., 'manual-capture')` + a JSON POST.
 *
 * A 409 `SECRETS_NOT_LOADED` surfaces as an `ApiBehaviourApiError` whose
 * `body.code === SECRETS_NOT_LOADED_CODE` (use `isSecretsNotLoadedError`) so
 * the caller can route the user to the existing re-enter-secrets prompt.
 */
export async function manualCapture(
  projectId: string,
  architectureId: string,
  sessionId: string,
  body: ManualCaptureRequest,
): Promise<ManualCaptureResponse> {
  return jsonRequest<ManualCaptureResponse>(
    actionUrl(projectId, architectureId, sessionId, 'manual-capture'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/** Machine-readable code on the /start 409 inventory-coverage block. */
export const INVENTORY_UNACCOUNTED_ENDPOINTS_CODE = 'INVENTORY_UNACCOUNTED_ENDPOINTS';

/** Parsed shape of the /start 409 `INVENTORY_UNACCOUNTED_ENDPOINTS` body. */
export interface InventoryUnaccountedBlock {
  message: string;
  unaccountedCount: number;
  /** Embedded refs, capped server-side at 50 entries. */
  unaccounted: InventoryUnaccountedEndpointRef[];
  /** The FULL count (may exceed `unaccounted.length` past the cap). */
  unaccountedTotalCount: number;
}

/**
 * Detect the /start inventory-coverage hard block. The validation service
 * responds 409 with `{ error: { code: 'INVENTORY_UNACCOUNTED_ENDPOINTS',
 * unaccountedCount, unaccounted[<=50], unaccountedTotalCount } }`; the
 * gateway passes that envelope through verbatim and `parseErrorBody`
 * unwraps the `error` wrapper, so detection is by `body.code` -- NEVER by
 * message-string matching. Returns null for every other error.
 */
export function parseInventoryUnaccountedError(
  err: unknown,
): InventoryUnaccountedBlock | null {
  if (!(err instanceof ApiBehaviourApiError)) return null;
  if (err.status !== 409) return null;
  if (err.body.code !== INVENTORY_UNACCOUNTED_ENDPOINTS_CODE) return null;
  const raw = err.body as Record<string, unknown>;
  const unaccounted = Array.isArray(raw.unaccounted)
    ? (raw.unaccounted as InventoryUnaccountedEndpointRef[])
    : [];
  const count =
    typeof raw.unaccountedCount === 'number' ? raw.unaccountedCount : unaccounted.length;
  const total =
    typeof raw.unaccountedTotalCount === 'number' ? raw.unaccountedTotalCount : count;
  return {
    message: typeof err.body.message === 'string' ? err.body.message : '',
    unaccountedCount: count,
    unaccounted,
    unaccountedTotalCount: total,
  };
}

// ============================================================================
// Target capture session helpers (Spec 2026-05-25 Task Group 5)
//
// The "target-side capture" flow replays an existing current-state baseline's
// accepted items against a new target service URL and persists the responses
// as a paired target baseline (`kind='target', paired_with_baseline_id=<src>`).
// The validation-service routes are mirrored by the gateway at
// `/api/v1/api-migration-validation/target-capture-sessions/...`; the
// helpers below wrap those routes 1:1 from the frontend. The validation
// service's POST/GET payloads use camelCase keys (it owns its own DTOs),
// so the request shapes are camelCase verbatim. The session DTOs returned
// by the create/start/cancel routes still come back snake_case (AMS edge).
// ============================================================================

/**
 * Body for `POST /api/v1/api-migration-validation/target-capture-sessions`.
 *
 * Server stamps `kind='target'`; callers do NOT supply it. `sourceBaselineId`
 * is the FK at the current-state baseline being replayed. AMS service-layer
 * validation enforces the source baseline lives in the same project +
 * architecture and itself has `kind='current'`.
 */
export interface CreateTargetCaptureSessionRequest {
  projectId: string;
  architectureId: string;
  sourceBaselineId: string;
  targetApiBaseUrl: string;
  name?: string | null;
  authType?: string | null;
  authConfigRedactedJson?: Record<string, unknown> | null;
  defaultHeadersRedactedJson?: Record<string, string> | null;
  mutatingCallsConfirmed?: boolean;
}

/**
 * Body for `POST .../target-capture-sessions/:id/secrets`. Mirrors the
 * validation service's in-memory `SecretsBundle` shape -- the gateway is a
 * transparent pass-through, AMS NEVER sees plaintext.
 */
export interface TargetCaptureSecretsRequest {
  api: {
    type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header';
    token?: string;
    headerName?: string;
    paramName?: string;
    value?: string;
    username?: string;
    password?: string;
  };
}

export interface TargetCaptureSecretsResponse {
  sessionId: string;
  loaded: boolean;
}

export interface TargetCaptureTestConnectionResponse {
  sessionId: string;
  success: boolean;
  status: number;
  durationMs: number;
}

export interface TargetCaptureStartResponse extends ApiBehaviourCaptureSessionDto {
  runId: string;
}

/**
 * Polling endpoint response. Fields mirror the validation service's
 * `targetCaptureSessionActions.ts /status` route shape. Frontend polls at
 * the same 2-3s cadence as current-state and stops on terminal status.
 */
export interface TargetCaptureSessionStatusResponse {
  sessionId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  isLiveInRunManager: boolean;
  lastDiagnosticMessage: string | null;
}

/** Build a gateway URL for a target-capture route. */
function targetCaptureUrl(
  sessionId: string | null,
  action: 'create' | 'secrets' | 'test-connection' | 'start' | 'cancel' | 'status',
  projectId?: string,
): string {
  const base = `${GATEWAY_BASE}/api/v1/api-migration-validation/target-capture-sessions`;
  if (action === 'create') return base;
  const sid = encodeURIComponent(sessionId ?? '');
  const path = `${base}/${sid}/${action}`;
  // The validation-service routes read projectId from query string OR body.
  // For the id-scoped routes we ride it on the query string (matches the
  // gateway client wrapper convention used in gateway/src/services/apiBehaviourClient.ts).
  return projectId ? `${path}?projectId=${encodeURIComponent(projectId)}` : path;
}

/**
 * POST `/api/v1/api-migration-validation/target-capture-sessions` -- creates
 * a target session in `draft` status with `kind='target'` server-stamped.
 */
export async function createTargetCaptureSession(
  body: CreateTargetCaptureSessionRequest,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    targetCaptureUrl(null, 'create'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/**
 * POST `/.../target-capture-sessions/:id/secrets` -- loads the in-memory
 * secrets bundle on the validation service. NEVER touches AMS.
 */
export async function setTargetSessionSecrets(
  sessionId: string,
  body: TargetCaptureSecretsRequest,
): Promise<TargetCaptureSecretsResponse> {
  return jsonRequest<TargetCaptureSecretsResponse>(
    targetCaptureUrl(sessionId, 'secrets'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

/**
 * POST `/.../target-capture-sessions/:id/test-connection` -- one redacted
 * probe call against the target URL using the in-memory secrets bundle.
 */
export async function testTargetConnection(
  sessionId: string,
  projectId: string,
): Promise<TargetCaptureTestConnectionResponse> {
  return jsonRequest<TargetCaptureTestConnectionResponse>(
    targetCaptureUrl(sessionId, 'test-connection', projectId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

/**
 * POST `/.../target-capture-sessions/:id/start` -- moves the session to
 * `running` and fires `runTargetReplay(sessionId)` as a background task.
 * Returns 202 with the running session row + `runId`.
 */
export async function startTargetCaptureSession(
  sessionId: string,
  projectId: string,
  /** Item #6 restore gate (2026-08-27): recorded proceed-anyway override. */
  options?: { confirmNoRestore?: boolean },
): Promise<TargetCaptureStartResponse> {
  return jsonRequest<TargetCaptureStartResponse>(
    targetCaptureUrl(sessionId, 'start', projectId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        options?.confirmNoRestore ? { confirm_no_restore: true } : {},
      ),
    },
  );
}

/**
 * POST `/.../target-capture-sessions/:id/cancel` -- signals abort to any
 * in-flight HTTP calls, purges the secrets bundle, and marks the session
 * `cancelled`.
 */
export async function cancelTargetCaptureSession(
  sessionId: string,
  projectId: string,
): Promise<ApiBehaviourCaptureSessionDto> {
  return jsonRequest<ApiBehaviourCaptureSessionDto>(
    targetCaptureUrl(sessionId, 'cancel', projectId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
}

/**
 * GET `/.../target-capture-sessions/:id/status` -- polling endpoint used by
 * `CaptureSessionDetailView`. Returns the live session status + the
 * runManager presence flag + the most recent diagnostic message.
 */
export async function getTargetCaptureSessionStatus(
  sessionId: string,
  projectId: string,
): Promise<TargetCaptureSessionStatusResponse> {
  return jsonRequest<TargetCaptureSessionStatusResponse>(
    targetCaptureUrl(sessionId, 'status', projectId),
    { method: 'GET' },
  );
}

// ============================================================================
// Diff engine helpers (Spec 2026-05-25 Task Group 5)
//
// The diff-engine surface compares paired source / target API Behaviour
// Baselines and persists structured drift in two AMS tables. The Drift
// report tab on `BaselineDetailView` calls into these helpers to discover
// existing diffs, list per-item rows, and trigger / poll recompute.
//
// Wire-format notes:
//   - All numeric count fields on `ApiBehaviourDiffDto` and the per-item
//     `source_response_status` / `target_response_status` are typed
//     `number | null` (matching the AMS boxed `Integer` contract for PATCH
//     safety -- see `project_primitive_double_dto_overwrite.md`).
//   - `body_diff_json` is typed `Record<string, unknown> | null` because
//     the AMS Java entity maps it as `Map<String, Object>` and the
//     persistence boundary rejects non-object root JSON.
//   - The create / recompute / status / cancel routes go through the
//     validation-service proxy (`/api/v1/api-migration-validation/...`).
//   - The CRUD reads (`getDiffByTargetBaseline`, `listDiffItems`) go
//     directly to the AMS proxy under
//     `/api/v1/projects/:projectId/api-behaviour/diffs/...`.
// ============================================================================

/**
 * Wire-shape DTO for an `api_behaviour_diffs` row. Mirrors the AMS Java
 * `ApiBehaviourDiffDto` record verbatim. All numeric count fields typed
 * `number | null` for PATCH safety -- never plain `number`.
 */
export interface ApiBehaviourDiffDto {
  id: string;
  project_id: string;
  architecture_id: string;
  source_baseline_id: string;
  target_baseline_id: string;
  /** One of `'computing' | 'completed' | 'failed'`. */
  status: string;
  matched_count: number | null;
  status_drift_count: number | null;
  body_shape_drift_count: number | null;
  body_value_drift_count: number | null;
  source_only_count: number | null;
  target_only_count: number | null;
  source_baseline_updated_at: string | null;
  target_baseline_updated_at: string | null;
  computed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Wire-shape DTO for an `api_behaviour_diff_items` row. Per-scenario
 * classification produced by the diff runner. `body_diff_json` carries
 * a flat list of per-JSON-pointer differences (key_added / key_removed
 * / type_changed / value_changed) for the side-by-side modal's highlight
 * pass.
 */
export interface ApiBehaviourDiffItemDto {
  id: string;
  diff_id: string;
  method: string;
  path: string;
  scenario_name: string;
  source_baseline_item_id: string | null;
  target_baseline_item_id: string | null;
  /** One of `'status_match' | 'status_drift' | 'source_only' | 'target_only'`. */
  status_classification: string;
  /** One of `'body_match' | 'body_shape_drift' | 'body_value_drift'`; null for source/target_only. */
  body_classification: string | null;
  source_response_status: number | null;
  target_response_status: number | null;
  body_diff_json: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

/**
 * Request body for `POST /api/v1/api-migration-validation/diffs`. Validation
 * service creates the diff in `status='computing'`, fires the runner as a
 * fire-and-forget local call, and returns the diffId + status immediately.
 *
 * Rejects with 400 `error='target_baseline_not_finalised'` if the target
 * baseline is still `draft`.
 */
export interface CreateDiffRequest {
  projectId: string;
  architectureId: string;
  sourceBaselineId: string;
  targetBaselineId: string;
}

/**
 * Response shape for `GET /api/v1/api-migration-validation/diffs/:id/status`.
 * Polled at 2-3s cadence while `status='computing'`; stops on terminal status.
 */
export interface DiffStatusResponse {
  status: string;
  matched_count: number | null;
  status_drift_count: number | null;
  body_shape_drift_count: number | null;
  body_value_drift_count: number | null;
  source_only_count: number | null;
  target_only_count: number | null;
  computed_at: string | null;
  error_message: string | null;
}

/** Build a gateway URL for a validation-service diff action route. */
function diffActionUrl(diffId: string | null, action: 'create' | 'recompute' | 'status' | 'cancel'): string {
  const base = `${GATEWAY_BASE}/api/v1/api-migration-validation/diffs`;
  if (action === 'create') return base;
  return `${base}/${encodeURIComponent(diffId ?? '')}/${action}`;
}

/** Build a gateway URL for an AMS-direct diff CRUD route. */
function diffCrudUrl(projectId: string, subPath: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/diffs/${subPath}`
  );
}

/**
 * POST `/api/v1/api-migration-validation/diffs` -- create or reuse a diff
 * row. If a diff already exists for the (source, target) pair, the
 * validation service reuses its id (recompute semantics).
 */
export async function createDiff(body: CreateDiffRequest): Promise<ApiBehaviourDiffDto> {
  return jsonRequest<ApiBehaviourDiffDto>(diffActionUrl(null, 'create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * POST `/api/v1/api-migration-validation/diffs/:id/recompute` -- re-runs an
 * existing diff. Returns 409 (surfaced as `ApiBehaviourApiError.status=409`)
 * if the diff is already running.
 */
export async function recomputeDiff(diffId: string): Promise<ApiBehaviourDiffDto> {
  return jsonRequest<ApiBehaviourDiffDto>(diffActionUrl(diffId, 'recompute'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

/**
 * GET `/api/v1/api-migration-validation/diffs/:id/status` -- polling endpoint.
 * UI polls at 2-3s cadence while `status='computing'`.
 */
export async function getDiffStatus(diffId: string): Promise<DiffStatusResponse> {
  return jsonRequest<DiffStatusResponse>(diffActionUrl(diffId, 'status'), { method: 'GET' });
}

/**
 * POST `/api/v1/api-migration-validation/diffs/:id/cancel` -- signal abort
 * and mark the diff `status='failed'` with `error_message='cancelled'`.
 */
export async function cancelDiff(diffId: string): Promise<void> {
  await jsonRequest<void>(diffActionUrl(diffId, 'cancel'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

/**
 * GET `/api/v1/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId`
 * -- AMS-direct lookup. Returns `null` on 404 (no diff exists for this
 * target yet -- the Drift report tab shows the "Recompute" button to spawn
 * one).
 */
export async function getDiffByTargetBaseline(
  projectId: string,
  targetBaselineId: string,
): Promise<ApiBehaviourDiffDto | null> {
  try {
    return await jsonRequest<ApiBehaviourDiffDto>(
      diffCrudUrl(projectId, `by-target/${encodeURIComponent(targetBaselineId)}`),
      { method: 'GET' },
    );
  } catch (err) {
    if (err instanceof ApiBehaviourApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * GET `/api/v1/projects/:projectId/api-behaviour/diffs/:diffId/items` --
 * list all diff_items for a diff, ordered by `(method, path)`.
 */
export async function listDiffItems(
  projectId: string,
  diffId: string,
): Promise<ApiBehaviourDiffItemDto[]> {
  return jsonRequest<ApiBehaviourDiffItemDto[]>(
    diffCrudUrl(projectId, `${encodeURIComponent(diffId)}/items`),
    { method: 'GET' },
  );
}
