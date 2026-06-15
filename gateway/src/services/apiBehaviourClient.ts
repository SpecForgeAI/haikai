/**
 * Gateway typed-client wrapper for the api-behaviour surface.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 4
 * sub-task 4.4.
 *
 * Provides additive TypeScript wrappers around the gateway proxy routes
 * defined in `gateway/src/routes/apiMigrationValidation.ts`. The wrappers
 * are intended for in-process callers within the gateway that need a
 * strongly-typed interface against the api-behaviour surface rather than
 * the loose `fetch` + `JSON.parse` pattern used in ad-hoc handlers.
 *
 * Wire-format convention
 * ----------------------
 * The existing api-behaviour AMS surface speaks snake_case on the wire
 * (per the project's AMS wire-format audit -- AMS still publishes
 * snake_case for the legacy api-behaviour endpoints rather than the
 * camelCase the newer endpoints use). The validation service
 * (`api-migration-validation-service`) forwards the same snake_case
 * DTOs verbatim. The TypeScript interfaces below mirror that
 * convention.
 *
 * What ships in this file
 * -----------------------
 *   - `ApiBehaviourBaselineDto` / `ApiBehaviourCaptureSessionDto` --
 *     existing DTO shape extensions for the new `kind` discriminator and
 *     pairing FK fields (`paired_with_baseline_id` /
 *     `source_baseline_id`).
 *   - Request shapes for the six new target-capture endpoints.
 *   - Six wrapper functions, one per route:
 *       - createTargetCaptureSession
 *       - setTargetSessionSecrets
 *       - testTargetConnection
 *       - startTargetCaptureSession
 *       - cancelTargetCaptureSession
 *       - getTargetCaptureSessionStatus
 *   - One wrapper for the AMS-direct pairing-read endpoint:
 *       - listTargetBaselinesPairedWith
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 4 adds
 * the diff-engine surface:
 *   - `ApiBehaviourDiffDto` / `ApiBehaviourDiffItemDto` -- snake_case DTOs
 *     mirroring the AMS Java records. All numeric count fields are typed
 *     as `number | null` (NEVER plain `number`) to match the boxed
 *     `Integer` contract enforced on the AMS side (PATCH safety per
 *     `project_primitive_double_dto_overwrite.md`).
 *   - Request shapes (`CreateApiBehaviourDiffRequest`,
 *     `UpdateApiBehaviourDiffRequest`, `CreateApiBehaviourDiffItemRequest`).
 *   - Six wrapper functions (`createDiff`, `recomputeDiff`, `getDiffStatus`,
 *     `cancelDiff`, `getDiffByTargetBaseline`, `listDiffItems`).
 *
 * Each wrapper takes a gateway base URL plus the route's typed inputs and
 * returns the typed response shape. Network/HTTP errors throw an
 * `ApiBehaviourClientError` carrying the upstream status code and body
 * so callers can branch on status (`error.status === 404`) without
 * re-parsing.
 */

/**
 * Wire-shape DTO for an `api_behaviour_baseline` row. Mirrors the
 * existing snake_case JSON the AMS publishes; this iteration extends
 * the shape with the new `kind` discriminator + `paired_with_baseline_id`
 * FK introduced by Spec 2026-05-25 (changeset 156).
 *
 * `kind` is `'current'` (default for legacy rows) or `'target'`. When
 * `kind === 'target'`, `paired_with_baseline_id` MUST be a non-null
 * UUID pointing at the source current-state baseline; AMS service-layer
 * validation enforces this on create + update.
 */
export interface ApiBehaviourBaselineDto {
  id?: string;
  project_id?: string;
  architecture_id?: string;
  name?: string | null;
  status?: string | null;
  notes?: string | null;
  source_session_id?: string | null;
  source_oas_refs_json?: unknown | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  /**
   * Discriminator added by Spec 2026-05-25 Task Group 1. Valid values are
   * `'current'` (default) and `'target'`. Legacy rows pick up `'current'`
   * via the changeset 156 DB column default.
   */
  kind?: 'current' | 'target' | null;
  /**
   * FK pairing field added by Spec 2026-05-25 Task Group 1. Set only when
   * `kind === 'target'`; null on current-state baselines. Points at the
   * source `kind='current', status='active'` baseline being replayed.
   */
  paired_with_baseline_id?: string | null;
}

/**
 * Wire-shape DTO for an `api_behaviour_capture_session` row. Mirrors the
 * existing snake_case JSON; extended for the new `kind` + `source_baseline_id`
 * fields introduced by Spec 2026-05-25 (changeset 157).
 *
 * Target sessions (`kind === 'target'`) have a non-null `source_baseline_id`
 * pointing at the current-state baseline being replayed against the target
 * URL. AMS service-layer validation enforces the invariant.
 */
export interface ApiBehaviourCaptureSessionDto {
  id?: string;
  project_id?: string;
  architecture_id?: string;
  name?: string | null;
  env_name?: string | null;
  api_base_url?: string | null;
  auth_type?: string | null;
  auth_config_redacted_json?: Record<string, unknown> | null;
  default_headers_redacted_json?: Record<string, string> | null;
  oas_spec_refs_json?: unknown | null;
  db_config_redacted_json?: Record<string, unknown> | null;
  mutating_calls_confirmed?: boolean | null;
  status?: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /**
   * Discriminator added by Spec 2026-05-25 Task Group 1. `'current'` for
   * legacy rows + new current-state sessions; `'target'` for replay
   * sessions created via `POST /target-capture-sessions`.
   */
  kind?: 'current' | 'target' | null;
  /**
   * FK pairing field added by Spec 2026-05-25 Task Group 1. Set only when
   * `kind === 'target'`; null on current-state sessions.
   */
  source_baseline_id?: string | null;
}

/**
 * Request body for `POST /api/v1/api-migration-validation/target-capture-sessions`.
 *
 * Mirrors the validation-service route's body shape. `projectId` may travel
 * here or as a `?projectId=...` query string param; the validation service
 * accepts either source. Server sets `kind='target'` -- callers do NOT
 * supply it.
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
 * Request body for `POST .../target-capture-sessions/:id/secrets`. Mirrors
 * the validation-service's secrets shape -- the gateway is a transparent
 * pass-through, the validation service stores the bundle in-memory only.
 *
 * Auth `type` is one of the validation service's six allowed values; the
 * `key`/`value`/`username`/`password` fields are type-specific and the
 * server validates them. The gateway client wrapper does not narrow them
 * further to keep the wrapper additive.
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

/**
 * Response shape for `POST .../target-capture-sessions/:id/secrets`.
 */
export interface TargetCaptureSecretsResponse {
  sessionId: string;
  loaded: boolean;
}

/**
 * Response shape for `POST .../target-capture-sessions/:id/test-connection`.
 * `success === true` when the probe returned an HTTP status in `[200, 500)`
 * (any structured response, even non-2xx, is enough to confirm the target
 * URL is reachable).
 */
export interface TargetCaptureTestConnectionResponse {
  sessionId: string;
  success: boolean;
  status: number;
  durationMs: number;
}

/**
 * Response shape for `POST .../target-capture-sessions/:id/start`. Returns
 * the running session row plus the runId (server uses sessionId as runId).
 */
export interface TargetCaptureStartResponse extends ApiBehaviourCaptureSessionDto {
  runId: string;
}

/**
 * Response shape for `GET .../target-capture-sessions/:id/status`. Polled
 * by the frontend `CaptureSessionDetailView` at the same 2-3s cadence as
 * current-state sessions.
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

/**
 * Error thrown by the wrappers on a non-2xx upstream response or a
 * network failure. Callers can branch on `.status` (when present) to
 * distinguish e.g. 404 from 5xx; `.body` carries the raw parsed JSON or
 * text payload, whichever the upstream returned.
 */
export class ApiBehaviourClientError extends Error {
  readonly status: number | null;
  readonly body: unknown;

  constructor(message: string, status: number | null, body: unknown) {
    super(message);
    this.name = 'ApiBehaviourClientError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Parse the upstream response body, preferring JSON when the
 * content-type advertises it. Returns `null` on empty body.
 */
async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  if (text.length === 0) return null;
  return text;
}

/**
 * Run an HTTP request against the gateway, throwing
 * `ApiBehaviourClientError` on non-2xx or network failure. The thrown
 * error carries the upstream status code + body so callers can branch
 * without re-fetching.
 */
async function runRequest(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiBehaviourClientError(
      `Network error calling ${url}: ${message}`,
      null,
      null,
    );
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw new ApiBehaviourClientError(
      `Upstream ${response.status} from ${url}`,
      response.status,
      body,
    );
  }
  return body;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  };
}

/**
 * `POST /api/v1/api-migration-validation/target-capture-sessions`.
 *
 * Creates a target-side capture session in `draft` status. The validation
 * service stamps `kind='target'` server-side; callers do not supply it.
 * Returns the persisted session row including its server-assigned `id`.
 */
export async function createTargetCaptureSession(
  gatewayBaseUrl: string,
  body: CreateTargetCaptureSessionRequest,
): Promise<ApiBehaviourCaptureSessionDto> {
  const url = `${gatewayBaseUrl}/api/v1/api-migration-validation/target-capture-sessions`;
  return (await runRequest(url, jsonInit('POST', body))) as ApiBehaviourCaptureSessionDto;
}

/**
 * `POST /api/v1/api-migration-validation/target-capture-sessions/:id/secrets`.
 *
 * Loads target-side auth into the validation service's in-memory
 * `secretsStore`. NEVER hits AMS -- the bundle lives in-process for the
 * session's lifetime and is purged on terminal state.
 */
export async function setTargetSessionSecrets(
  gatewayBaseUrl: string,
  sessionId: string,
  body: TargetCaptureSecretsRequest,
): Promise<TargetCaptureSecretsResponse> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/target-capture-sessions/` +
    `${encodeURIComponent(sessionId)}/secrets`;
  return (await runRequest(url, jsonInit('POST', body))) as TargetCaptureSecretsResponse;
}

/**
 * `POST /api/v1/api-migration-validation/target-capture-sessions/:id/test-connection`.
 *
 * Runs one redacted probe call against the target API base URL using the
 * in-memory secrets bundle. Returns the upstream status code plus the
 * round-trip duration so the wizard can disable Next until connectivity
 * is confirmed.
 *
 * `projectId` is passed via the query string (the validation service
 * reads it off `?projectId=...`).
 */
export async function testTargetConnection(
  gatewayBaseUrl: string,
  sessionId: string,
  projectId: string,
): Promise<TargetCaptureTestConnectionResponse> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/target-capture-sessions/` +
    `${encodeURIComponent(sessionId)}/test-connection` +
    `?projectId=${encodeURIComponent(projectId)}`;
  return (await runRequest(url, jsonInit('POST', {}))) as TargetCaptureTestConnectionResponse;
}

/**
 * `POST /api/v1/api-migration-validation/target-capture-sessions/:id/start`.
 *
 * Moves the session to `running`, registers it with the runManager, and
 * fires `runTargetReplay(sessionId)` as a background task. Returns 202
 * with the running session row plus `runId`; per-item replay results are
 * polled via `getTargetCaptureSessionStatus` below.
 */
export async function startTargetCaptureSession(
  gatewayBaseUrl: string,
  sessionId: string,
  projectId: string,
): Promise<TargetCaptureStartResponse> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/target-capture-sessions/` +
    `${encodeURIComponent(sessionId)}/start` +
    `?projectId=${encodeURIComponent(projectId)}`;
  return (await runRequest(url, jsonInit('POST', {}))) as TargetCaptureStartResponse;
}

/**
 * `POST /api/v1/api-migration-validation/target-capture-sessions/:id/cancel`.
 *
 * Signals abort to any in-flight HTTP calls, purges the in-memory secrets
 * bundle, and patches the session to `cancelled`. Returns the cancelled
 * session row.
 */
export async function cancelTargetCaptureSession(
  gatewayBaseUrl: string,
  sessionId: string,
  projectId: string,
): Promise<ApiBehaviourCaptureSessionDto> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/target-capture-sessions/` +
    `${encodeURIComponent(sessionId)}/cancel` +
    `?projectId=${encodeURIComponent(projectId)}`;
  return (await runRequest(url, jsonInit('POST', {}))) as ApiBehaviourCaptureSessionDto;
}

/**
 * `GET /api/v1/api-migration-validation/target-capture-sessions/:id/status`.
 *
 * Polling endpoint returning the current session status plus the live
 * runManager presence flag. Wizard polls at 2-3s cadence and stops on
 * terminal status.
 */
export async function getTargetCaptureSessionStatus(
  gatewayBaseUrl: string,
  sessionId: string,
  projectId: string,
): Promise<TargetCaptureSessionStatusResponse> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/target-capture-sessions/` +
    `${encodeURIComponent(sessionId)}/status` +
    `?projectId=${encodeURIComponent(projectId)}`;
  return (await runRequest(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })) as TargetCaptureSessionStatusResponse;
}

/**
 * `GET /api/v1/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines`.
 *
 * AMS-direct pairing-read endpoint. Returns the list of target baselines
 * paired with the given source baseline, ordered `created_at desc`.
 * Frontend in this spec does NOT call it; Spec #5's diff UI will. The
 * wrapper ships now so the gateway typed-client surface is complete.
 */
export async function listTargetBaselinesPairedWith(
  gatewayBaseUrl: string,
  projectId: string,
  sourceBaselineId: string,
): Promise<ApiBehaviourBaselineDto[]> {
  const url =
    `${gatewayBaseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/` +
    `baselines/${encodeURIComponent(sourceBaselineId)}/target-baselines`;
  const raw = await runRequest(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(raw) ? (raw as ApiBehaviourBaselineDto[]) : [];
}

// ============================================================================
// Diff Engine DTOs + client wrappers
//
// Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 4.
//
// PATCH-safety note: every numeric count field on `ApiBehaviourDiffDto` is
// typed `number | null` (NEVER plain `number`). The AMS Java side uses
// boxed `Integer` for the same reason -- per
// `project_primitive_double_dto_overwrite.md`, any field that participates
// in PATCH semantics must be nullable so a PATCH payload missing the field
// does not silently wipe the persisted column to `0`.
// ============================================================================

/**
 * Wire-shape DTO for an `api_behaviour_diffs` row. Mirrors the AMS Java
 * `ApiBehaviourDiffDto` record verbatim (per-field `@JsonProperty`
 * snake_case convention).
 *
 * All numeric count fields (`matched_count`, `status_drift_count`,
 * `body_shape_drift_count`, `body_value_drift_count`, `source_only_count`,
 * `target_only_count`) are typed `number | null` to match the boxed
 * `Integer` contract enforced on the AMS side.
 */
export interface ApiBehaviourDiffDto {
  id?: string;
  project_id?: string;
  architecture_id?: string;
  source_baseline_id?: string;
  target_baseline_id?: string;
  /** One of `'computing' | 'completed' | 'failed'`. */
  status?: string;
  matched_count?: number | null;
  status_drift_count?: number | null;
  body_shape_drift_count?: number | null;
  body_value_drift_count?: number | null;
  source_only_count?: number | null;
  target_only_count?: number | null;
  source_baseline_updated_at?: string | null;
  target_baseline_updated_at?: string | null;
  computed_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Wire-shape DTO for an `api_behaviour_diff_items` row. Mirrors the AMS
 * Java `ApiBehaviourDiffItemDto` record.
 *
 * `source_response_status` + `target_response_status` are boxed `Integer`
 * on the AMS side (null when classification is `source_only` /
 * `target_only`); typed `number | null` here for PATCH safety.
 *
 * `body_diff_json` is the JSONB blob carrying the comparator's flat list
 * of per-pointer differences (`key_added` / `key_removed` / `type_changed`
 * / `value_changed`). Typed `Record<string, unknown> | null` because the
 * AMS Java entity maps it as `Map<String, Object>` and the persistence
 * boundary rejects non-object root JSON.
 */
export interface ApiBehaviourDiffItemDto {
  id?: string;
  diff_id?: string;
  method?: string;
  path?: string;
  scenario_name?: string;
  source_baseline_item_id?: string | null;
  target_baseline_item_id?: string | null;
  /** One of `'status_match' | 'status_drift' | 'source_only' | 'target_only'`. */
  status_classification?: string;
  /** One of `'body_match' | 'body_shape_drift' | 'body_value_drift'`; null for source_only/target_only. */
  body_classification?: string | null;
  source_response_status?: number | null;
  target_response_status?: number | null;
  body_diff_json?: Record<string, unknown> | null;
  notes?: string | null;
  created_at?: string | null;
}

/**
 * Request body for `POST /api/v1/api-migration-validation/diffs`. The
 * validation service creates the diff row in `status='computing'`, fires
 * `diffRunner.runDiff(diffId)` as a fire-and-forget local call, and
 * returns the diffId + status immediately.
 *
 * AMS service-layer validation enforces the FK-pairing invariant: the
 * source baseline must be `kind='current'`; the target baseline must be
 * `kind='target'` with `paired_with_baseline_id == source_baseline_id`.
 */
export interface CreateApiBehaviourDiffRequest {
  projectId: string;
  architectureId: string;
  sourceBaselineId: string;
  targetBaselineId: string;
}

/**
 * Request body for `PATCH /api/v1/projects/:projectId/api-behaviour/
 * diffs/:diffId`. Every field optional; null preserves the column on the
 * AMS side. All count fields are `number | null` for PATCH safety.
 */
export interface UpdateApiBehaviourDiffRequest {
  status?: string | null;
  matched_count?: number | null;
  status_drift_count?: number | null;
  body_shape_drift_count?: number | null;
  body_value_drift_count?: number | null;
  source_only_count?: number | null;
  target_only_count?: number | null;
  source_baseline_updated_at?: string | null;
  target_baseline_updated_at?: string | null;
  computed_at?: string | null;
  error_message?: string | null;
}

/**
 * Request body for `POST /api/v1/projects/:projectId/api-behaviour/
 * diffs/:diffId/items`. Used by the validation-service-side `diffRunner`
 * to persist each per-scenario classification.
 */
export interface CreateApiBehaviourDiffItemRequest {
  method: string;
  path: string;
  scenario_name: string;
  source_baseline_item_id?: string | null;
  target_baseline_item_id?: string | null;
  status_classification: string;
  body_classification?: string | null;
  source_response_status?: number | null;
  target_response_status?: number | null;
  body_diff_json?: Record<string, unknown> | null;
  notes?: string | null;
}

/**
 * Response shape for `GET /api/v1/api-migration-validation/diffs/:id/status`.
 * The validation service's polling endpoint -- returns the live counts +
 * the computed_at timestamp + any error message.
 *
 * All count fields are `number | null` to match the underlying AMS contract.
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

/**
 * `POST /api/v1/api-migration-validation/diffs`.
 *
 * Creates a diff in `status='computing'`. If a diff already exists for the
 * (source, target) pair, the validation service reuses its id (recompute
 * semantics). Throws `ApiBehaviourClientError` with `status=400` and
 * `body.error='target_baseline_not_finalised'` if the target baseline is
 * still `draft`.
 */
export async function createDiff(
  gatewayBaseUrl: string,
  body: CreateApiBehaviourDiffRequest,
): Promise<ApiBehaviourDiffDto> {
  const url = `${gatewayBaseUrl}/api/v1/api-migration-validation/diffs`;
  return (await runRequest(url, jsonInit('POST', body))) as ApiBehaviourDiffDto;
}

/**
 * `POST /api/v1/api-migration-validation/diffs/:id/recompute`.
 *
 * Re-runs the existing diff. Returns the updated diff row with
 * `status='computing'`. Throws `ApiBehaviourClientError` with `status=409`
 * and `body.currentStatus='computing'` if the diff is already running.
 */
export async function recomputeDiff(
  gatewayBaseUrl: string,
  diffId: string,
): Promise<ApiBehaviourDiffDto> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/diffs/` +
    `${encodeURIComponent(diffId)}/recompute`;
  return (await runRequest(url, jsonInit('POST', {}))) as ApiBehaviourDiffDto;
}

/**
 * `GET /api/v1/api-migration-validation/diffs/:id/status`.
 *
 * Polling endpoint. UI polls at 2-3s cadence while `status='computing'`
 * and stops on terminal status (`completed` / `failed`).
 */
export async function getDiffStatus(
  gatewayBaseUrl: string,
  diffId: string,
): Promise<DiffStatusResponse> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/diffs/` +
    `${encodeURIComponent(diffId)}/status`;
  return (await runRequest(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })) as DiffStatusResponse;
}

/**
 * `POST /api/v1/api-migration-validation/diffs/:id/cancel`.
 *
 * Signals abort to any in-flight diff computation; PATCHes the diff to
 * `status='failed'` with `error_message='cancelled'`.
 */
export async function cancelDiff(
  gatewayBaseUrl: string,
  diffId: string,
): Promise<void> {
  const url =
    `${gatewayBaseUrl}/api/v1/api-migration-validation/diffs/` +
    `${encodeURIComponent(diffId)}/cancel`;
  await runRequest(url, jsonInit('POST', {}));
}

/**
 * `GET /api/v1/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId`.
 *
 * AMS-direct by-target lookup. The Drift report tab on
 * `BaselineDetailView` calls this with the target baseline's id to
 * discover whether a diff exists. Returns `null` on 404 (no diff yet --
 * UI shows the "Recompute" button to spawn one).
 */
export async function getDiffByTargetBaseline(
  gatewayBaseUrl: string,
  projectId: string,
  targetBaselineId: string,
): Promise<ApiBehaviourDiffDto | null> {
  const url =
    `${gatewayBaseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/` +
    `diffs/by-target/${encodeURIComponent(targetBaselineId)}`;
  try {
    return (await runRequest(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })) as ApiBehaviourDiffDto;
  } catch (error) {
    if (error instanceof ApiBehaviourClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/items`.
 *
 * Lists all `api_behaviour_diff_items` for the diff, ordered by
 * `(method, path)` (AMS finder convention). The Drift report tab uses
 * this for the diff-items table.
 */
export async function listDiffItems(
  gatewayBaseUrl: string,
  projectId: string,
  diffId: string,
): Promise<ApiBehaviourDiffItemDto[]> {
  const url =
    `${gatewayBaseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/` +
    `diffs/${encodeURIComponent(diffId)}/items`;
  const raw = await runRequest(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(raw) ? (raw as ApiBehaviourDiffItemDto[]) : [];
}

// ============================================================================
// Diff-scoped findings DTOs + client wrappers
//
// Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 3.
//
// Read + review wrappers only (per accepted Q9). Emission goes from the
// validation-service DIRECT to AMS via the validation-service's
// `archModelClient` (mirrors `discovery-service/.../findings/FindingEmitter.ts`);
// the gateway typed-client surface intentionally omits a create wrapper.
//
// DTO shape mirrors the AMS `DiscoveryFindingDto` record verbatim (snake_case
// wire). The optional `api_behaviour_diff_id` field is the spec's load-bearing
// addition: it's set on diff-sourced findings and null on the legacy
// run-sourced findings. The exactly-one-of-origin invariant is enforced by an
// AMS DB CHECK constraint (`discovery_finding_exactly_one_origin`); both
// `run_id` and `api_behaviour_diff_id` are typed `string | null` here to
// match.
// ============================================================================

/**
 * Wire-shape DTO for a `discovery_findings` row (extended for diff-sourced
 * findings).
 *
 * Mirrors the AMS Java `DiscoveryFindingDto` record under Jackson's
 * snake_case strategy. The exactly-one-of-origin rule (run_id XOR
 * api_behaviour_diff_id) is enforced by the AMS DB CHECK constraint
 * `discovery_finding_exactly_one_origin`; both fields are typed nullable
 * here to match.
 */
export interface DiscoveryFindingDto {
  id: string;
  /** Origin: discovery run id. Null when finding is diff-sourced. */
  run_id: string | null;
  /**
   * Origin: api_behaviour_diff id. Null when finding is run-sourced.
   * Added by Spec 2026-05-25 (changeset 160).
   */
  api_behaviour_diff_id: string | null;
  project_id: string;
  architecture_id: string;
  finding_type: string;
  category: string;
  severity: string;
  /** Boxed Double on AMS side -- nullable for PATCH safety. */
  confidence: number | null;
  status: string;
  title: string;
  summary: string | null;
  detail_json: Record<string, unknown> | null;
  source: string | null;
  created_by_stage: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  links: Array<{
    id: string;
    finding_id: string;
    link_type: string;
    target_type: string;
    target_id: string;
    label: string | null;
    created_at: string;
  }>;
}

/**
 * PATCH body for `PATCH .../findings/:findingId`. Every field optional;
 * `null` preserves the persisted column (AMS handler null-guards each
 * field per the boxed-Double pitfall).
 */
export interface UpdateDiscoveryFindingRequest {
  finding_type?: string | null;
  category?: string | null;
  severity?: string | null;
  confidence?: number | null;
  status?: string | null;
  title?: string | null;
  summary?: string | null;
  detail_json?: Record<string, unknown> | null;
  source?: string | null;
  created_by_stage?: string | null;
  reviewer_notes?: string | null;
}

/**
 * GET `/api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings`.
 *
 * Lists all findings sourced from this diff, ordered ascending by
 * `created_at`. Forwarded verbatim to AMS.
 */
export async function listDiffFindings(
  gatewayBaseUrl: string,
  projectId: string,
  diffId: string,
): Promise<DiscoveryFindingDto[]> {
  const url =
    `${gatewayBaseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/` +
    `diffs/${encodeURIComponent(diffId)}/findings`;
  const raw = await runRequest(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(raw) ? (raw as DiscoveryFindingDto[]) : [];
}

/**
 * GET `/api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/by-diff-item/:diffItemId`.
 *
 * Lists findings linked to a specific diff_item via
 * `discovery_finding_links` (target_type='api_behaviour_diff_item'). Used by
 * the per-row "Findings" badge on the Drift report tab.
 */
export async function listDiffFindingsByDiffItem(
  gatewayBaseUrl: string,
  projectId: string,
  diffId: string,
  diffItemId: string,
): Promise<DiscoveryFindingDto[]> {
  const url =
    `${gatewayBaseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/` +
    `diffs/${encodeURIComponent(diffId)}/findings/by-diff-item/` +
    `${encodeURIComponent(diffItemId)}`;
  const raw = await runRequest(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(raw) ? (raw as DiscoveryFindingDto[]) : [];
}

/**
 * PATCH `/api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/:findingId`.
 *
 * Reviewer status transitions (and field edits) on a diff-sourced finding.
 * Same body shape as the existing run-scoped PATCH on AMS's
 * `DiscoveryFindingController`. Returns the updated finding row.
 */
export async function patchDiffFinding(
  gatewayBaseUrl: string,
  projectId: string,
  diffId: string,
  findingId: string,
  patch: UpdateDiscoveryFindingRequest,
): Promise<DiscoveryFindingDto> {
  const url =
    `${gatewayBaseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/api-behaviour/` +
    `diffs/${encodeURIComponent(diffId)}/findings/` +
    `${encodeURIComponent(findingId)}`;
  return (await runRequest(url, jsonInit('PATCH', patch))) as DiscoveryFindingDto;
}
