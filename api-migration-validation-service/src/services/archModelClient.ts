import axios, { AxiosInstance, AxiosError } from 'axios';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import { redactLogString } from './redactor';
import type {
  CaptureSession,
  CaptureSessionStatus,
  DiagnosticType,
  GenerationSource,
  ScenarioStatus,
  ScenarioType,
  BaselineStatus,
} from '../types/captureSession';

/**
 * Axios HTTP client for AMS communication from the api-migration-validation
 * service. Mirrors the discovery-service client shape: singleton instance,
 * uniform error class, response interceptor that LOGS but does not transform
 * non-2xx responses.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3
 *   adds the new `kind` / `paired_with_baseline_id` / `source_baseline_id`
 *   fields on the baseline + session DTOs and new helper methods
 *   (`getBaseline`, `listBaselineItems`, `listTargetBaselinesPairedWith`,
 *   `patchCapture`, `patchBaseline`). The new fields are reference types
 *   (`string` / `string | null`) -- PATCH-safe per
 *   `project_primitive_double_dto_overwrite.md` (no boxed-numeric drift
 *   risk).
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 2
 *   adds discovery-finding wrappers (`createDiffFinding`,
 *   `listFindingsByDiffId`, `listFindingsByDiffItemId`,
 *   `deleteFindingsByApiBehaviourDiffId`) used by the diff runner's
 *   emission step. The validation service calls AMS DIRECT for finding
 *   create/delete -- the gateway does NOT proxy these endpoints per
 *   accepted Q9.
 *
 * Error taxonomy mirrors `discovery-service/src/services/gatewayClient.ts`:
 * a typed error carrying `status` (HTTP code or null on transport failure),
 * `endpoint`, and the original axios `cause` so callers can decide whether
 * to retry / surface a diagnostic / abort the run.
 */

export class ArchModelClientError extends Error {
  public readonly status: number | null;
  public readonly endpoint: string;
  public readonly cause?: unknown;

  constructor(message: string, endpoint: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'ArchModelClientError';
    this.endpoint = endpoint;
    this.status = status;
    this.cause = cause;
  }
}

// --------------------------------------------------------------------------
// Wire DTOs -- snake_case to match AMS Jackson naming strategy.
// These are the minimum surface used by api-migration-validation-service.
// --------------------------------------------------------------------------

export interface InterfaceDto {
  id: string;
  name: string;
  description?: string | null;
  spec_link?: string | null;
  /** Owning architecture id for filter queries. */
  architecture_id?: string | null;
}

export interface CaptureSessionDto {
  id: string;
  project_id: string;
  architecture_id: string;
  name: string | null;
  status: CaptureSessionStatus;
  env_name: string | null;
  api_base_url: string | null;
  auth_type: string | null;
  auth_config_redacted_json: Record<string, unknown> | null;
  default_headers_redacted_json: Record<string, string> | null;
  oas_spec_refs_json: unknown;
  db_config_redacted_json: Record<string, unknown> | null;
  /** Boxed boolean -- never assume primitive default on PATCH. */
  mutating_calls_confirmed: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  /**
   * Kind discriminator added by the Target-Side Capture spec (2026-05-25).
   * Always `'current'` for legacy rows (DB column default). `'target'` rows
   * MUST also carry a non-null `source_baseline_id` -- enforced server-side
   * in AMS.
   */
  kind?: 'current' | 'target';
  /**
   * FK at the source current-state baseline this target session replays.
   * Null for current-state sessions; non-null for target sessions.
   */
  source_baseline_id?: string | null;
  /**
   * Persisted interface scope for inventory reconciliation (Model-Seeded
   * Capture Inventory spec, 2026-06-11; AMS changeset 178). Null /
   * absent = whole-architecture scope -- nothing silently absent.
   */
  scope_interface_ids_json?: string[] | null;
  /**
   * Start coverage-override audit trio -- all null when the session was
   * never overridden at /start. The count mirrors AMS's boxed Integer so
   * PATCH semantics never wipe it to 0.
   */
  coverage_override_justification?: string | null;
  coverage_override_unaccounted_count?: number | null;
  coverage_override_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCaptureSessionRequest {
  project_id: string;
  architecture_id: string;
  name?: string | null;
  env_name?: string | null;
  api_base_url?: string | null;
  auth_type?: string | null;
  auth_config_redacted_json?: Record<string, unknown> | null;
  default_headers_redacted_json?: Record<string, string> | null;
  oas_spec_refs_json?: unknown;
  db_config_redacted_json?: Record<string, unknown> | null;
  mutating_calls_confirmed?: boolean | null;
  /** `'current'` (default) or `'target'`. */
  kind?: 'current' | 'target';
  /** Required when `kind='target'`; MUST be null when `kind='current'`. */
  source_baseline_id?: string | null;
}

export interface PatchCaptureSessionRequest {
  name?: string | null;
  status?: CaptureSessionStatus;
  env_name?: string | null;
  api_base_url?: string | null;
  auth_type?: string | null;
  auth_config_redacted_json?: Record<string, unknown> | null;
  default_headers_redacted_json?: Record<string, string> | null;
  oas_spec_refs_json?: unknown;
  db_config_redacted_json?: Record<string, unknown> | null;
  mutating_calls_confirmed?: boolean | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  /**
   * Per-run scenario outcome tallies (AMS changeset 171, misleading-COMPLETED
   * fix). Sent on the completion PATCH so a session that "completed" with
   * every scenario errored (zero captures) is distinguishable from a
   * successful run — the dashboard renders "Completed — N of M scenarios
   * captured" from these.
   */
  scenarios_attempted?: number | null;
  scenarios_completed?: number | null;
  scenarios_errored?: number | null;
  /**
   * Model-Seeded Capture Inventory (2026-06-11): persisted reconciliation
   * scope + the /start coverage-override trio. All optional/nullable --
   * omitted keys are PATCH no-ops on the AMS side (null-guarded, boxed).
   */
  scope_interface_ids_json?: string[] | null;
  coverage_override_justification?: string | null;
  coverage_override_unaccounted_count?: number | null;
  coverage_override_at?: string | null;
}

export interface OperationDto {
  id: string;
  session_id: string;
  operation_id: string;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  included: boolean | null;
  safe_to_execute: boolean | null;
  request_schema_json: unknown;
  response_schema_json: unknown;
  oas_operation_json: unknown;
  /**
   * Non-null when the row is an explicit exclude-with-reason accounting
   * record (`included = false`) written by the capture-inventory
   * reconciliation flow (Model-Seeded Capture Inventory spec, 2026-06-11).
   * Persistence IS the accounting record -- an excluded row still ACCOUNTS
   * for its committed endpoint at the /start gate.
   */
  exclusion_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOperationRequest {
  session_id: string;
  operation_id: string;
  method: string;
  path: string;
  summary?: string | null;
  description?: string | null;
  included?: boolean | null;
  safe_to_execute?: boolean | null;
  request_schema_json?: unknown;
  response_schema_json?: unknown;
  oas_operation_json?: unknown;
  /** See {@link OperationDto.exclusion_reason}. */
  exclusion_reason?: string | null;
}

// ---------------------------------------------------------------------------
// Capture-session inventory reconciliation (Model-Seeded Capture Inventory
// spec, 2026-06-11). Mirrors the AMS `InventoryReconciliationRequest` /
// `InventoryReconciliationResponse` records VERBATIM (snake_case wire via the
// AMS global Jackson strategy). The reconciliation KEY and the comparison
// live ONLY in the Java `InventoryReconciliationCalculator` -- this client
// (and every other TypeScript consumer) only carries the payload, never
// recomputes it.
// ---------------------------------------------------------------------------

export interface InventoryReconciliationRequest {
  /**
   * Explicit scope override. Null/omitted -> AMS falls back to the session
   * row's persisted `scope_interface_ids_json`; when that is also null the
   * WHOLE architecture's endpoint set is in scope.
   */
  scope_interface_ids?: string[] | null;
  /** True + ids provided -> AMS persists the scope onto the session row. */
  persist_scope?: boolean | null;
  /**
   * Null/omitted defaults to TRUE on the AMS side (refreshes session-linked
   * reconciliation findings delete-before-emit); display-only callers pass
   * false.
   */
  refresh_findings?: boolean | null;
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
 * returns this verbatim, the `/start` gate reads it, and every frontend
 * surface renders it without reshaping. All numerics nullable (AMS boxed).
 */
export interface InventoryReconciliationResponse {
  in_scope_unaccounted_endpoints: InventoryUnaccountedEndpointRef[];
  operations_without_model_endpoint: InventoryOperationWithoutModelEndpointRef[];
  excluded_by_scope_endpoints: InventoryExcludedByScopeEndpointRef[];
  in_scope_coverage_pct: number | null;
  in_scope_accounted_count: number | null;
  in_scope_total_count: number | null;
  architecture_coverage_pct: number | null;
  architecture_accounted_count: number | null;
  architecture_total_count: number | null;
}

export interface ScenarioDto {
  id: string;
  session_id: string;
  operation_id: string;
  scenario_name: string | null;
  scenario_type: ScenarioType | null;
  status: ScenarioStatus;
  generation_source: GenerationSource | null;
  request_method: string | null;
  request_path: string | null;
  request_query_json: unknown;
  request_headers_redacted_json: Record<string, string> | null;
  request_body_json: unknown;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScenarioRequest {
  session_id: string;
  operation_id: string;
  scenario_name?: string | null;
  scenario_type?: ScenarioType | null;
  status?: ScenarioStatus;
  generation_source?: GenerationSource | null;
  request_method?: string | null;
  request_path?: string | null;
  request_query_json?: unknown;
  request_headers_redacted_json?: Record<string, string> | null;
  request_body_json?: unknown;
  notes?: string | null;
}

export interface CaptureDto {
  id: string;
  session_id: string;
  scenario_id: string;
  operation_id: string;
  attempt_number: number | null;
  request_method: string | null;
  request_path: string | null;
  request_query_json: unknown;
  request_headers_redacted_json: Record<string, string> | null;
  request_body_json: unknown;
  response_status: number | null;
  response_headers_redacted_json: Record<string, string> | null;
  response_body_json: unknown;
  duration_ms: number | null;
  error_type: string | null;
  error_message: string | null;
  captured_at: string | null;
  /** Boxed boolean -- PATCH-mutable. */
  accepted: boolean | null;
  accepted_at: string | null;
  reviewer_notes: string | null;
}

export interface CreateCaptureRequest {
  session_id: string;
  scenario_id: string;
  operation_id: string;
  attempt_number?: number | null;
  request_method?: string | null;
  request_path?: string | null;
  request_query_json?: unknown;
  request_headers_redacted_json?: Record<string, string> | null;
  request_body_json?: unknown;
  response_status?: number | null;
  response_headers_redacted_json?: Record<string, string> | null;
  response_body_json?: unknown;
  duration_ms?: number | null;
  error_type?: string | null;
  error_message?: string | null;
  captured_at?: string | null;
}

/**
 * PATCH body for an existing `api_behaviour_captures` row. The replay
 * runner uses this to flip the `accepted` flag immediately after persisting
 * each target-side capture (target captures are auto-accepted by design --
 * the reviewer flips back to rejected only for clearly-broken responses on
 * the existing CaptureReviewPanel).
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
 */
export interface PatchCaptureRequest {
  accepted?: boolean | null;
  accepted_at?: string | null;
  reviewer_notes?: string | null;
}

export interface DiagnosticDto {
  id: string;
  session_id: string;
  operation_id: string | null;
  scenario_id: string | null;
  diagnostic_type: DiagnosticType;
  message: string;
  detail_json: unknown;
  created_at: string;
}

export interface CreateDiagnosticRequest {
  session_id: string;
  operation_id?: string | null;
  scenario_id?: string | null;
  diagnostic_type: DiagnosticType;
  message: string;
  detail_json?: unknown;
}

export interface BaselineDto {
  id: string;
  project_id: string;
  architecture_id: string;
  session_id: string;
  name: string | null;
  status: BaselineStatus;
  accepted_capture_count: number | null;
  operation_count: number | null;
  notes: string | null;
  /**
   * Kind discriminator added by the Target-Side Capture spec (2026-05-25).
   * Always `'current'` for legacy rows (DB column default).
   */
  kind?: 'current' | 'target';
  /**
   * Self-FK at the source current-state baseline this target baseline was
   * replayed from. Null for current-state baselines; non-null for target
   * baselines.
   */
  paired_with_baseline_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBaselineRequest {
  project_id: string;
  architecture_id: string;
  session_id: string;
  name?: string | null;
  status?: BaselineStatus;
  accepted_capture_count?: number | null;
  operation_count?: number | null;
  notes?: string | null;
  /** `'current'` (default) or `'target'`. */
  kind?: 'current' | 'target';
  /** Required when `kind='target'`; MUST be null when `kind='current'`. */
  paired_with_baseline_id?: string | null;
}

/**
 * PATCH body for an existing `api_behaviour_baselines` row. Used by the
 * target replay runner to finalise the target baseline to `status='active'`
 * after the replay completes.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
 */
export interface PatchBaselineRequest {
  name?: string | null;
  status?: BaselineStatus;
  accepted_capture_count?: number | null;
  operation_count?: number | null;
  notes?: string | null;
}

export interface BaselineItemDto {
  id: string;
  baseline_id: string;
  capture_id: string;
  operation_id: string;
  scenario_id: string;
  method: string | null;
  path: string | null;
  scenario_name: string | null;
  request_json: unknown;
  response_status: number | null;
  response_json: unknown;
  business_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBaselineItemRequest {
  baseline_id: string;
  capture_id: string;
  operation_id: string;
  scenario_id: string;
  method?: string | null;
  path?: string | null;
  scenario_name?: string | null;
  request_json?: unknown;
  response_status?: number | null;
  response_json?: unknown;
  business_notes?: string | null;
}
// --------------------------------------------------------------------------
// Diff DTOs -- mirror the AMS Java DTOs from
// `architecture-model-service/src/main/java/com/example/architecturemodel/
//   model/dto/apibehaviour/{ApiBehaviourDiffDto, ApiBehaviourDiffItemDto,
//   CreateApiBehaviourDiffRequest, UpdateApiBehaviourDiffRequest,
//   CreateApiBehaviourDiffItemRequest}.java`.
//
// Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3.
//
// All numeric count fields are typed `number | null` (TS mirror of the Java
// boxed `Integer`). Per `project_primitive_double_dto_overwrite.md`, PATCH
// semantics require nullable types so missing JSON does not silently wipe
// to 0. Future maintainers adding count fields MUST follow this rule.
// --------------------------------------------------------------------------

export type ApiBehaviourDiffStatus = 'computing' | 'completed' | 'failed';

export type ApiBehaviourDiffStatusClassification =
  | 'status_match'
  | 'status_drift'
  | 'source_only'
  | 'target_only';

export type ApiBehaviourDiffBodyClassification =
  | 'body_match'
  | 'body_shape_drift'
  | 'body_value_drift';

export interface ApiBehaviourDiffDto {
  id: string;
  project_id: string;
  architecture_id: string;
  source_baseline_id: string;
  target_baseline_id: string;
  status: ApiBehaviourDiffStatus;
  /** Boxed Integer in AMS -- nullable on the wire. */
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

export interface ApiBehaviourDiffItemDto {
  id: string;
  diff_id: string;
  method: string;
  path: string;
  scenario_name: string;
  source_baseline_item_id: string | null;
  target_baseline_item_id: string | null;
  status_classification: ApiBehaviourDiffStatusClassification;
  body_classification: ApiBehaviourDiffBodyClassification | null;
  /** Boxed Integer in AMS -- nullable on the wire. */
  source_response_status: number | null;
  target_response_status: number | null;
  body_diff_json: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

export interface CreateApiBehaviourDiffRequest {
  project_id: string;
  architecture_id: string;
  source_baseline_id: string;
  target_baseline_id: string;
  /** Defaults to `'computing'` at the AMS service layer when absent. */
  status?: ApiBehaviourDiffStatus;
}

export interface UpdateApiBehaviourDiffRequest {
  status?: ApiBehaviourDiffStatus;
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

export interface CreateApiBehaviourDiffItemRequest {
  diff_id: string;
  method: string;
  path: string;
  scenario_name: string;
  source_baseline_item_id?: string | null;
  target_baseline_item_id?: string | null;
  status_classification: ApiBehaviourDiffStatusClassification;
  body_classification?: ApiBehaviourDiffBodyClassification | null;
  source_response_status?: number | null;
  target_response_status?: number | null;
  body_diff_json?: Record<string, unknown> | null;
  notes?: string | null;
}

// --------------------------------------------------------------------------
// Discovery-Finding wire DTOs -- mirror the AMS Java DTOs from
// `architecture-model-service/src/main/java/com/example/architecturemodel/
//   model/dto/discovery/{DiscoveryFindingDto, DiscoveryFindingLinkDto,
//   CreateDiscoveryFindingRequest}.java`.
//
// Spec: 2026-05-16 Discovery Findings First-Class (created the surface);
// extended 2026-05-25 API Test Harness -- Findings Integration with the
// optional `api_behaviour_diff_id` origin field.
//
// Origin invariant: exactly one of `run_id` / `api_behaviour_diff_id`
// MUST be non-null. Enforced at the DB layer by the
// `discovery_finding_exactly_one_origin` CHECK (changeset 160) and at the
// AMS service layer.
//
// Boxed-type rule: `confidence` is `number | null` (Java `Double`). Any
// numeric field added here must follow the same convention per
// `project_primitive_double_dto_overwrite.md`.
// --------------------------------------------------------------------------

export interface DiscoveryFindingLinkDto {
  id: string;
  finding_id: string;
  link_type: string;
  target_type: string;
  target_id: string;
  label: string | null;
  created_at: string;
}

export interface DiscoveryFindingDto {
  id: string;
  /** Origin (run-sourced). Null when `api_behaviour_diff_id` is set. */
  run_id: string | null;
  /**
   * Origin (diff-sourced). Null when `run_id` is set. Added by the
   * 2026-05-25 Findings Integration spec.
   */
  api_behaviour_diff_id: string | null;
  project_id: string;
  architecture_id: string;
  finding_type: string;
  category: string;
  severity: string;
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
  links: DiscoveryFindingLinkDto[];
}

/**
 * Inline link shape used when creating a finding alongside its links in
 * one POST. Mirrors `CreateDiscoveryFindingRequest.CreateDiscoveryFindingLinkRequest`.
 */
export interface CreateDiscoveryFindingLinkInline {
  link_type: string;
  target_type: string;
  target_id: string;
  label?: string | null;
}

/**
 * Body shape for the new internal POST endpoint at
 * `/api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings`.
 * The architectureId is resolved off the diff row server-side (the
 * controller calls `verifyAndLoad` and forwards the diff's architectureId
 * to the service), so it is NOT included in the body. The runner passes a
 * single `links` entry with `target_type='api_behaviour_diff_item'` and
 * `link_type='derived_from'` pointing at the originating diff_item row.
 */
export interface CreateDiscoveryFindingRequest {
  finding_type: string;
  category: string;
  severity: string;
  confidence?: number | null;
  status?: string | null;
  title: string;
  summary?: string | null;
  detail_json?: Record<string, unknown> | null;
  source?: string | null;
  created_by_stage?: string | null;
  reviewer_notes?: string | null;
  links?: CreateDiscoveryFindingLinkInline[];
}

// --------------------------------------------------------------------------
// Migration Discovery Context wire DTOs.
//
// These mirror the Java DTOs at
// `architecture-model-service/src/main/java/com/example/architecturemodel/
//   model/dto/migration/{MigrationDiscoveryContextRequestDto,
//   MigrationDiscoveryContextDto, ReadinessAssessmentDto}.java`.
//
// AMS publishes the response with camelCase JSON keys (the records carry
// explicit `@JsonProperty` annotations), so unlike the snake_case capture
// DTOs above these mirror the Java types verbatim with camelCase.
//
// Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 3
// (D3 fetch-at-/start fail-soft + once-per-session prompt injection).
// --------------------------------------------------------------------------

export interface MigrationDiscoveryContextRequest {
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  discoveryRunIds?: string[];
  apiBehaviourBaselineIds?: string[];
  includeFindings?: boolean;
  includeEvidence?: boolean;
  includeRuntimeEvidence?: boolean;
  includeDbFindings?: boolean;
  includeMappings?: boolean;
  maxFindings?: number;
  maxEvidenceItems?: number;
}

export interface MigrationArchitectureSummaryDto {
  architectureId: string;
  name: string;
  applicationCount?: number;
  serviceCount?: number;
  interfaceCount?: number;
  dataEntityCount?: number;
  dataStoreCount?: number;
  businessUserCount?: number;
  processActivityCount?: number;
  uiScreenCount?: number;
  userJourneyCount?: number;
  hasModel?: boolean;
}

export interface MigrationDiscoveryRunHighlightDto {
  runId: string;
  architectureId: string;
  status: string;
  discoveryKind: string;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationDiscoveryRunsSummaryDto {
  totalRuns?: number;
  completedRuns?: number;
  runs?: MigrationDiscoveryRunHighlightDto[];
}

export interface MigrationFindingsSummaryDto {
  totalFindings?: number;
  countsByStatus?: Record<string, number>;
  countsBySeverity?: Record<string, number>;
  countsByCategory?: Record<string, number>;
  highSeverityUnreviewedCount?: number;
  sampleDataHintCount?: number;
}

export interface MigrationFindingHighlightDto {
  findingId: string;
  runId: string;
  findingType: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  confidence?: number | null;
}

export interface MigrationEvidenceHighlightDto {
  evidenceId: string;
  runId: string;
  type: string;
  source?: string | null;
  filePath?: string | null;
  linkedFindingIds?: string[];
}

export interface MigrationCandidateSummaryDto {
  totalCandidates?: number;
  countsByType?: Record<string, number>;
  countsByStatus?: Record<string, number>;
}

export interface MigrationDecisionTaskHighlightDto {
  taskId: string;
  runId: string;
  taskType: string;
  status: string;
  createdAt: string;
}

export interface MigrationRuntimeUsageSummaryDto {
  runtimeEvidenceCount?: number;
  runtimeFindingCount?: number;
  hasRuntimeEvidence?: boolean;
}

export interface MigrationDatabaseDiscoverySummaryDto {
  databaseFindingCount?: number;
  databaseRunCount?: number;
  sampleDataHintCount?: number;
  hasDatabaseDiscovery?: boolean;
}

export interface MigrationBaselineHighlightDto {
  baselineId: string;
  architectureId: string;
  sessionId?: string | null;
  name: string;
  status: string;
  operationCount?: number;
  acceptedCaptureCount?: number;
  createdAt: string;
}

export interface MigrationApiBehaviourBaselineSummaryDto {
  totalBaselines?: number;
  activeBaselineCount?: number;
  draftBaselineCount?: number;
  baselines?: MigrationBaselineHighlightDto[];
}

export interface MigrationArchitectureMappingsSummaryDto {
  totalMappings?: number;
  countsBySourceType?: Record<string, number>;
  countsByTargetType?: Record<string, number>;
  countsByMappingType?: Record<string, number>;
}

export interface MigrationReadinessAssessmentDto {
  overallStatus: string;
  apiReadiness?: string;
  dataReadiness?: string;
  infrastructureReadiness?: string;
  discoveryReadiness?: string;
  mappingReadiness?: string;
  baselineReadiness?: string;
  decisionReadiness?: string;
  gaps?: string[];
}

/**
 * One seeded scenario computed from the discovery model. Mirrors the AMS Java
 * record `ScenarioSeedDto` (camelCase wire). The harness uses these as a
 * starting point for scenario generation; values are refined against the live
 * OAS / response evidence rather than trusted blindly.
 *
 * Spec: 2026-05-?? Capture Scenario Seeding -- Task Group (harness side).
 */
export interface ScenarioSeedDto {
  scenarioType: 'happy_path' | 'edge' | 'error' | 'auth_variant' | string;
  scenarioName: string;
  exampleRequest?: Record<string, unknown> | null;
  preconditions?: string[] | null;
  expectedStatus?: number | null;
  safeToExecute?: boolean | null;
  provenance?: string | null;
}

/**
 * Set of seeded scenarios for a single operation, keyed by `operationKey`
 * (`"<METHOD> <path>"`). Mirrors the AMS Java record `ScenarioSeedSetDto`.
 */
export interface ScenarioSeedSetDto {
  operationKey: string;
  method?: string | null;
  path?: string | null;
  safeToExecute?: boolean | null;
  seeds?: ScenarioSeedDto[] | null;
}

export interface MigrationDiscoveryContextDto {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  discoveryRunIds?: string[];
  apiBehaviourBaselineIds?: string[];
  generatedAt: string;
  summary?: string;
  currentArchitectureSummary?: MigrationArchitectureSummaryDto | null;
  targetArchitectureSummary?: MigrationArchitectureSummaryDto | null;
  discoveryRunsSummary?: MigrationDiscoveryRunsSummaryDto | null;
  findingsSummary?: MigrationFindingsSummaryDto | null;
  highPriorityFindings?: MigrationFindingHighlightDto[];
  findingsByCategory?: Record<string, number>;
  evidenceHighlights?: MigrationEvidenceHighlightDto[];
  candidateSummary?: MigrationCandidateSummaryDto | null;
  unresolvedDecisionTasks?: MigrationDecisionTaskHighlightDto[];
  runtimeUsageSummary?: MigrationRuntimeUsageSummaryDto | null;
  databaseDiscoverySummary?: MigrationDatabaseDiscoverySummaryDto | null;
  apiBehaviourBaselineSummary?: MigrationApiBehaviourBaselineSummaryDto | null;
  architectureMappingsSummary?: MigrationArchitectureMappingsSummaryDto | null;
  readinessAssessment?: MigrationReadinessAssessmentDto | null;
  contextWarnings?: string[];
  /**
   * Per-operation seeded scenarios computed from the discovery model. Optional
   * for backward compatibility; older AMS versions omit it entirely.
   */
  scenarioSeeds?: ScenarioSeedSetDto[];
}

// --------------------------------------------------------------------------
// Client class
// --------------------------------------------------------------------------

class ArchModelClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: ARCHITECTURE_MODEL_SERVICE_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Log non-2xx response bodies for diagnosability -- mirror discovery
    // gatewayClient pattern. Body snippet is run through the redactor in
    // case AMS surfaces an echoed payload that contained secrets.
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          const { status, config } = error.response;
          const method = config?.method?.toUpperCase() || '?';
          const url = config?.url || '?';
          const body = error.response.data;
          const bodySnippet = typeof body === 'string'
            ? body.substring(0, 500)
            : JSON.stringify(body).substring(0, 500);
          console.error(
            redactLogString(
              `[ArchModelClient] ${method} ${url} returned ${status}: ${bodySnippet}`,
            ),
          );
        }
        return Promise.reject(error);
      },
    );
  }

  // ----------------------------------------------------------------------
  // Reads -- existing AMS surfaces this client consumes.
  // ----------------------------------------------------------------------

  /**
   * Read existing `Interface` rows for an architecture. The wizard step 1
   * surfaces these so the user can multi-select existing OAS specs without
   * uploading.
   */
  /**
   * Fetch all interfaces bound to the given architecture.
   *
   * Bug fix (2026-05-17): the previous implementation hit the non-existent
   * endpoint `GET /api/projects/{id}/interfaces?architectureId=...` and
   * every call 404'd, killing the capture-session wizard's /parse-oas step.
   * The corrected path loads the full architecture model from
   * `GET /api/model/projects/{p}/architectures/{a}` and extracts
   * `metaModel.entities.interfaces` (the array is shaped exactly the same
   * as the snake-case `InterfaceDto` this method returns).
   */
  async listInterfacesForArchitecture(
    projectId: string,
    architectureId: string,
  ): Promise<InterfaceDto[]> {
    const model = await this.loadModel(projectId, architectureId);
    const ifaces = model?.metaModel?.entities?.interfaces;
    return Array.isArray(ifaces) ? (ifaces as InterfaceDto[]) : [];
  }

  /**
   * Fetch all endpoints attached to a given interface in the architecture.
   *
   * Used by the capture-session wizard's Step 4 to pre-populate the
   * operation grid when an interface has no OAS spec (Phase A of the
   * SOAP-friendly fix): code-discovery framework adapters already emit
   * `endpoints` entities into `metaModel.entities.endpoints` with the
   * owning `interface_id` set, so the wizard can show the reviewer those
   * pre-discovered operations instead of forcing manual entry.
   *
   * Returns the raw model endpoint rows untouched -- the caller maps them
   * into its in-form operation shape.
   */
  async listEndpointsForInterface(
    projectId: string,
    architectureId: string,
    interfaceId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const model = await this.loadModel(projectId, architectureId);
    const endpoints = model?.metaModel?.entities?.endpoints;
    if (!Array.isArray(endpoints)) return [];
    return (endpoints as Array<Record<string, unknown>>).filter(
      (e) => typeof e?.interface_id === 'string' && e.interface_id === interfaceId,
    );
  }

  /**
   * Fetch EVERY endpoint entity in the architecture model (no interface
   * filter). Used by the `account-endpoints` accounting action (Model-Seeded
   * Capture Inventory spec, 2026-06-11) to resolve the endpoint rows named
   * by `endpoint_id` regardless of which interface owns them.
   */
  async listEndpointsForArchitecture(
    projectId: string,
    architectureId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const model = await this.loadModel(projectId, architectureId);
    const endpoints = model?.metaModel?.entities?.endpoints;
    return Array.isArray(endpoints)
      ? (endpoints as Array<Record<string, unknown>>)
      : [];
  }

  /**
   * Load the full architecture model. Defined once so callers like
   * {@link listInterfacesForArchitecture} and {@link listEndpointsForInterface}
   * share the same fetch shape (and so a future call site that needs more
   * of `metaModel` doesn't reinvent the request).
   *
   * @internal -- intentionally returns a loose shape; the AMS DTO surface
   * is huge and consumers only need narrow slices.
   */
  private async loadModel(
    projectId: string,
    architectureId: string,
  ): Promise<{
    metaModel?: {
      entities?: {
        interfaces?: unknown;
        endpoints?: unknown;
        [k: string]: unknown;
      };
    };
  }> {
    const endpoint = `/api/model/projects/${projectId}/architectures/${architectureId}`;
    try {
      const res = await this.client.get<Record<string, unknown>>(endpoint);
      return (res.data ?? {}) as never;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'load architecture model');
    }
  }


  /**
   * Read a single capture-session row by id. Used by the action endpoints
   * (`/parse-oas`, `/test-api-connection`, `/test-db-connection`, `/start`,
   * `/cancel`) to source the session before any subsequent work.
   */
  async getCaptureSession(
    projectId: string,
    sessionId: string,
  ): Promise<CaptureSessionDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/capture-sessions/${sessionId}`;
    try {
      const res = await this.client.get<CaptureSessionDto>(endpoint);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'get capture-session');
    }
  }

  /**
   * Read every operation row owned by a session. Used by `/start` to load
   * the persisted operation inventory before spawning the orchestrator.
   */
  async listOperationsBySession(
    projectId: string,
    sessionId: string,
  ): Promise<OperationDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/operations?sessionId=${encodeURIComponent(sessionId)}`;
    try {
      const res = await this.client.get<OperationDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list operations by session');
    }
  }

  /**
   * Run the AMS capture-session inventory reconciliation (Model-Seeded
   * Capture Inventory spec, 2026-06-11). Both call sites -- the
   * configure-time `reconcile-inventory` action and the fail-closed `/start`
   * gate -- hit this single AMS endpoint; finding emission lives ONLY inside
   * the AMS side of it.
   */
  async reconcileCaptureSessionInventory(
    projectId: string,
    sessionId: string,
    body: InventoryReconciliationRequest,
  ): Promise<InventoryReconciliationResponse> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/capture-sessions/${sessionId}/inventory-reconciliation`;
    try {
      const res = await this.client.post<InventoryReconciliationResponse>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'reconcile capture-session inventory');
    }
  }

  /**
   * Read a single baseline row by id. Used by the target replay runner to
   * resolve the source baseline before walking its accepted items.
   *
   * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
   */
  async getBaseline(
    projectId: string,
    baselineId: string,
  ): Promise<BaselineDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/baselines/${baselineId}`;
    try {
      const res = await this.client.get<BaselineDto>(endpoint);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'get baseline');
    }
  }

  /**
   * Read every baseline-item row owned by a baseline. Used by the target
   * replay runner to walk the source baseline's accepted item set.
   *
   * Items on a baseline are by definition accepted (they were promoted
   * from accepted captures), so no `?accepted=true` query filter is needed.
   *
   * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
   */
  async listBaselineItems(
    projectId: string,
    baselineId: string,
  ): Promise<BaselineItemDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/baseline-items?baselineId=${encodeURIComponent(baselineId)}`;
    try {
      const res = await this.client.get<BaselineItemDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list baseline-items');
    }
  }

  /**
   * Read the target baselines paired with a given source current-state
   * baseline. Ships in this spec to keep the AMS contract complete (Spec #5's
   * diff UI consumes this).
   *
   * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3
   * (additive client method matching the new AMS controller route at
   * `GET /api/projects/{projectId}/api-behaviour/baselines/{sourceId}/target-baselines`).
   */
  async listTargetBaselinesPairedWith(
    projectId: string,
    sourceBaselineId: string,
  ): Promise<BaselineDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/baselines/${sourceBaselineId}/target-baselines`;
    try {
      const res = await this.client.get<BaselineDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list target-baselines paired with source');
    }
  }

  /**
   * Fetch the aggregated Migration Discovery Context for a project. Returns
   * the AMS `MigrationDiscoveryContextDto` verbatim so the orchestrator can
   * inject relevant slices into per-scenario prompts.
   *
   * Call path: AMS-direct (the AMS controller is at
   * `POST /api/projects/{projectId}/migration-discovery-context`). The
   * gateway proxy route at `POST /api/v1/projects/:projectId/migration-
   * discovery-context` exists for non-Node callers (frontend wizard
   * pre-fetch); this service hits AMS directly per the existing
   * `archModelClient` convention.
   *
   * Caller is responsible for fail-soft handling: the capture session
   * `/start` action catches any error from this method, logs a warning, and
   * appends `context_unavailable` to the 202 response warnings array. The
   * orchestrator continues unchanged with no discovery context attached.
   *
   * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 3
   * (D3 fetch-at-/start fail-soft).
   */
  async getMigrationDiscoveryContext(
    projectId: string,
    body: MigrationDiscoveryContextRequest,
  ): Promise<MigrationDiscoveryContextDto> {
    const endpoint = `/api/projects/${projectId}/migration-discovery-context`;
    try {
      const res = await this.client.post<MigrationDiscoveryContextDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'get migration-discovery-context');
    }
  }

  // ----------------------------------------------------------------------
  // Writes -- one method per AMS resource.
  // ----------------------------------------------------------------------

  async createCaptureSession(
    projectId: string,
    body: CreateCaptureSessionRequest,
  ): Promise<CaptureSessionDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/capture-sessions`;
    try {
      const res = await this.client.post<CaptureSessionDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create capture-session');
    }
  }

  async patchCaptureSession(
    projectId: string,
    sessionId: string,
    body: PatchCaptureSessionRequest,
  ): Promise<CaptureSessionDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/capture-sessions/${sessionId}`;
    try {
      const res = await this.client.patch<CaptureSessionDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'patch capture-session');
    }
  }

  async listCaptureSessionsByStatus(
    projectId: string,
    status: CaptureSessionStatus,
  ): Promise<CaptureSessionDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/capture-sessions?status=${encodeURIComponent(status)}`;
    try {
      const res = await this.client.get<CaptureSessionDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list capture-sessions by status');
    }
  }

  /**
   * Cross-project list used by startup reconciliation -- AMS exposes a
   * project-scoped list, so the reconciliation pass walks per project. Most
   * deployments only run a handful of projects; if that grows, add an AMS
   * `?status=running` global endpoint and this method becomes a thin call.
   */
  async listAllCaptureSessionsByStatus(
    status: CaptureSessionStatus,
  ): Promise<CaptureSessionDto[]> {
    const endpoint = `/api/api-behaviour/capture-sessions?status=${encodeURIComponent(status)}`;
    try {
      const res = await this.client.get<CaptureSessionDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list capture-sessions by status (all projects)');
    }
  }

  async createOperation(
    projectId: string,
    body: CreateOperationRequest,
  ): Promise<OperationDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/operations`;
    try {
      const res = await this.client.post<OperationDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create operation');
    }
  }

  async createScenario(
    projectId: string,
    body: CreateScenarioRequest,
  ): Promise<ScenarioDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/scenarios`;
    try {
      const res = await this.client.post<ScenarioDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create scenario');
    }
  }

  async createCapture(
    projectId: string,
    body: CreateCaptureRequest,
  ): Promise<CaptureDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/captures`;
    try {
      const res = await this.client.post<CaptureDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create capture');
    }
  }

  /**
   * PATCH an existing capture row. The target replay runner uses this to
   * flip `accepted=true` immediately after persisting each captured target
   * response (target captures are auto-accepted by design -- the reviewer
   * may flip back to rejected post-hoc on the existing CaptureReviewPanel).
   *
   * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
   */
  async patchCapture(
    projectId: string,
    captureId: string,
    body: PatchCaptureRequest,
  ): Promise<CaptureDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/captures/${captureId}`;
    try {
      const res = await this.client.patch<CaptureDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'patch capture');
    }
  }

  async createDiagnostic(
    projectId: string,
    body: CreateDiagnosticRequest,
  ): Promise<DiagnosticDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diagnostics`;
    try {
      const res = await this.client.post<DiagnosticDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create diagnostic');
    }
  }

  async createBaseline(
    projectId: string,
    body: CreateBaselineRequest,
  ): Promise<BaselineDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/baselines`;
    try {
      const res = await this.client.post<BaselineDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create baseline');
    }
  }

  /**
   * PATCH an existing baseline row. Used by the target replay runner to
   * finalise the target baseline to `status='active'` after the replay
   * completes successfully.
   *
   * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
   */
  async patchBaseline(
    projectId: string,
    baselineId: string,
    body: PatchBaselineRequest,
  ): Promise<BaselineDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/baselines/${baselineId}`;
    try {
      const res = await this.client.patch<BaselineDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'patch baseline');
    }
  }

  async createBaselineItem(
    projectId: string,
    body: CreateBaselineItemRequest,
  ): Promise<BaselineItemDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/baseline-items`;
    try {
      const res = await this.client.post<BaselineItemDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create baseline-item');
    }
  }

  // ----------------------------------------------------------------------
  // Diff endpoints -- additive surface for Spec 2026-05-25 Diff Engine.
  //
  // All paths follow the per-project scoping convention used by the rest
  // of the api-behaviour controllers
  // (`/api/projects/{projectId}/api-behaviour/diffs/...`). The runner side
  // passes `projectId` through from the diff row.
  // ----------------------------------------------------------------------

  /**
   * Create a new diff row in AMS. The AMS service layer enforces the
   * FK-pairing invariant: source must be `kind='current'`, target must be
   * `kind='target'` with `paired_with_baseline_id == source_baseline_id`.
   * Rejections surface as HTTP 400 via the global exception handler.
   *
   * Spec: 2026-05-25 Diff Engine -- Task Group 3.
   */
  async createDiff(
    projectId: string,
    body: CreateApiBehaviourDiffRequest,
  ): Promise<ApiBehaviourDiffDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs`;
    try {
      const res = await this.client.post<ApiBehaviourDiffDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create diff');
    }
  }

  /**
   * PATCH an existing diff row. Used by the runner to flip status to
   * `completed` / `failed` and write the count summary + `computed_at` +
   * baseline `updated_at` snapshots.
   */
  async updateDiff(
    projectId: string,
    diffId: string,
    body: UpdateApiBehaviourDiffRequest,
  ): Promise<ApiBehaviourDiffDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}`;
    try {
      const res = await this.client.patch<ApiBehaviourDiffDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'update diff');
    }
  }

  /** Read a single diff row by id. */
  async getDiff(
    projectId: string,
    diffId: string,
  ): Promise<ApiBehaviourDiffDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}`;
    try {
      const res = await this.client.get<ApiBehaviourDiffDto>(endpoint);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'get diff');
    }
  }

  /**
   * UI-lookup endpoint -- the Drift report tab calls this when opening a
   * target baseline detail view. Returns `null` on HTTP 404 (no diff yet
   * computed for this target) -- callers distinguish "not yet computed"
   * from "AMS unreachable".
   */
  async getDiffByTargetBaselineId(
    projectId: string,
    targetBaselineId: string,
  ): Promise<ApiBehaviourDiffDto | null> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/by-target/${targetBaselineId}`;
    try {
      const res = await this.client.get<ApiBehaviourDiffDto>(endpoint);
      return res.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr?.response?.status === 404) return null;
      throw this.toClientError(err, endpoint, 'get diff by target-baseline');
    }
  }

  /**
   * Read all diffs that point at a given source baseline. Schema supports
   * one-source-to-many-targets; v1 UI is target-driven so this is
   * forward-compat (Spec #6 may consume it).
   */
  async listDiffsBySourceBaselineId(
    projectId: string,
    sourceBaselineId: string,
  ): Promise<ApiBehaviourDiffDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs?sourceBaselineId=${encodeURIComponent(
      sourceBaselineId,
    )}`;
    try {
      const res = await this.client.get<ApiBehaviourDiffDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list diffs by source-baseline');
    }
  }

  /** Delete a diff row. CASCADEs to diff_items via the FK constraint. */
  async deleteDiff(projectId: string, diffId: string): Promise<void> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}`;
    try {
      await this.client.delete(endpoint);
    } catch (err) {
      throw this.toClientError(err, endpoint, 'delete diff');
    }
  }

  /**
   * Persist a single diff_item row. Called once per classified scenario
   * pair by the runner.
   */
  async createDiffItem(
    projectId: string,
    diffId: string,
    body: CreateApiBehaviourDiffItemRequest,
  ): Promise<ApiBehaviourDiffItemDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/items`;
    try {
      const res = await this.client.post<ApiBehaviourDiffItemDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create diff-item');
    }
  }

  /**
   * List all diff_items for a diff. Returned items are ordered by
   * `(method, path)` per the AMS repository finder.
   */
  async listDiffItemsByDiffId(
    projectId: string,
    diffId: string,
  ): Promise<ApiBehaviourDiffItemDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/items`;
    try {
      const res = await this.client.get<ApiBehaviourDiffItemDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list diff-items');
    }
  }

  /**
   * Bulk-delete all diff_items for a diff. Used by the recompute route to
   * wipe the prior result set before re-running the runner.
   */
  async deleteDiffItemsByDiffId(
    projectId: string,
    diffId: string,
  ): Promise<void> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/items`;
    try {
      await this.client.delete(endpoint);
    } catch (err) {
      throw this.toClientError(err, endpoint, 'delete diff-items');
    }
  }

  // ----------------------------------------------------------------------
  // Discovery-finding endpoints (diff-sourced) -- additive surface for
  // Spec 2026-05-25 API Test Harness -- Findings Integration -- Task
  // Group 2.
  //
  // Emission goes from validation-service DIRECT to AMS via these
  // wrappers (mirrors `discovery-service/.../findings/FindingEmitter.ts`).
  // The gateway does NOT proxy create / delete per accepted Q9 -- only
  // read + review proxies on the gateway side. PATCH (reviewer
  // transitions) is exercised by the frontend drawer through the gateway,
  // not by this service.
  //
  // All paths target the new diff-scoped controller at
  // `/api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings`.
  // The architectureId for new findings is resolved server-side off the
  // diff row (the controller's `verifyAndLoad` forwards it to the service);
  // this keeps the wire contract tight.
  // ----------------------------------------------------------------------

  /**
   * Create a diff-sourced discovery_finding row. Called once per
   * classified diff_item where {@link findingEmissionRules.classifyDiffItem}
   * returns `shouldEmit=true`.
   *
   * The body is expected to carry exactly one inline link with
   * `target_type='api_behaviour_diff_item'` + `link_type='derived_from'`
   * pointing at the originating diff_item. This avoids a separate POST
   * to the link sub-resource.
   */
  async createDiffFinding(
    projectId: string,
    diffId: string,
    body: CreateDiscoveryFindingRequest,
  ): Promise<DiscoveryFindingDto> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`;
    try {
      const res = await this.client.post<DiscoveryFindingDto>(endpoint, body);
      return res.data;
    } catch (err) {
      throw this.toClientError(err, endpoint, 'create diff-sourced finding');
    }
  }

  /**
   * Bulk-delete all findings sourced from a diff.
   *
   * <b>Load-bearing for diff recompute -- NOT defensive</b> per accepted
   * Q6. The {@code api_behaviour_diff_id ON DELETE CASCADE} only fires on
   * diff-row deletion; recompute keeps the diff row alive while replacing
   * diff_items, so the runner MUST call this BEFORE re-emit. Without it,
   * findings accumulate across recomputes (2x, 3x, ...). The runner's
   * regression test covers this.
   */
  async deleteFindingsByApiBehaviourDiffId(
    projectId: string,
    diffId: string,
  ): Promise<void> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`;
    try {
      await this.client.delete(endpoint);
    } catch (err) {
      throw this.toClientError(err, endpoint, 'delete diff-sourced findings');
    }
  }

  /**
   * Read all findings sourced from a diff. Mirrors the AMS controller's
   * `GET /findings` route. Not used by the runner; available for
   * diagnostics + future cross-service flows.
   */
  async listFindingsByDiffId(
    projectId: string,
    diffId: string,
  ): Promise<DiscoveryFindingDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`;
    try {
      const res = await this.client.get<DiscoveryFindingDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list diff-sourced findings');
    }
  }

  /**
   * Read findings linked to a specific diff_item. Mirrors the AMS
   * controller's `GET /findings/by-diff-item/{diffItemId}` route. Not
   * used by the runner; available for diagnostics + future cross-service
   * flows.
   */
  async listFindingsByDiffItemId(
    projectId: string,
    diffId: string,
    diffItemId: string,
  ): Promise<DiscoveryFindingDto[]> {
    const endpoint = `/api/projects/${projectId}/api-behaviour/diffs/${diffId}/findings/by-diff-item/${diffItemId}`;
    try {
      const res = await this.client.get<DiscoveryFindingDto[]>(endpoint);
      return res.data ?? [];
    } catch (err) {
      throw this.toClientError(err, endpoint, 'list diff-item findings');
    }
  }

  // ----------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------

  private toClientError(err: unknown, endpoint: string, action: string): ArchModelClientError {
    const axiosErr = err as AxiosError;
    const status = axiosErr?.response?.status ?? null;
    const baseMessage = err instanceof Error ? err.message : String(err);
    const message = status !== null
      ? `Failed to ${action} via AMS (HTTP ${status}): ${baseMessage}`
      : `Failed to ${action} via AMS: ${baseMessage}`;
    return new ArchModelClientError(message, endpoint, status, err);
  }
}

/**
 * Singleton instance of the architecture-model-service client.
 */
export const archModelClient = new ArchModelClient();

/** Exported for tests that need to inject mocks. */
export { ArchModelClient };

/**
 * Map a CaptureSessionDto (snake_case wire shape) to the camelCase domain
 * `CaptureSession`. Kept narrow -- field-by-field copy with no derivation.
 */
export function toCaptureSession(dto: CaptureSessionDto): CaptureSession {
  return {
    id: dto.id,
    projectId: dto.project_id,
    architectureId: dto.architecture_id,
    name: dto.name,
    status: dto.status,
    envName: dto.env_name,
    apiBaseUrl: dto.api_base_url,
    authType: dto.auth_type as CaptureSession['authType'],
    authConfigRedactedJson: dto.auth_config_redacted_json as CaptureSession['authConfigRedactedJson'],
    defaultHeadersRedactedJson: dto.default_headers_redacted_json,
    oasSpecRefsJson: dto.oas_spec_refs_json as CaptureSession['oasSpecRefsJson'],
    dbConfigRedactedJson: dto.db_config_redacted_json as CaptureSession['dbConfigRedactedJson'],
    mutatingCallsConfirmed: dto.mutating_calls_confirmed,
    startedAt: dto.started_at,
    completedAt: dto.completed_at,
    errorMessage: dto.error_message,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
