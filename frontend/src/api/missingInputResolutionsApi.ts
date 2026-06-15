/**
 * Missing Input Resolutions API client.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 6.2
 *
 * Frontend boundary for the new missing-input resolver endpoints proxied
 * through the gateway (mounted at `/api`, see
 * `gateway/src/routes/missingInputResolutions.ts`):
 *
 *   POST   /api/projects/{projectId}/missing-input-resolutions          (single create)
 *   POST   /api/projects/{projectId}/missing-input-resolutions/bulk     (preview/commit)
 *   POST   /api/projects/{projectId}/missing-input-resolutions/parse-files (multipart upload)
 *   GET    /api/projects/{projectId}/missing-input-resolutions          (list active)
 *   DELETE /api/projects/{projectId}/missing-input-resolutions/{id}     (soft-delete + cascade)
 *   GET    /api/projects/{projectId}/spec-generations/ready-to-retry    (ready summary)
 *   POST   /api/projects/{projectId}/spec-generations/retry-batch       (orchestrate)
 *
 * Wire-shape note:
 *   AMS serialises through Jackson with `spring.jackson.property-naming-strategy=SNAKE_CASE`,
 *   so server responses are snake_case on the wire. This module routes every
 *   inbound payload through a `*WireDto -> *Dto` boundary mapper before
 *   exposing the camelCase shape to UI components (matches precedent in
 *   `migrationDeliveryDashboardApi.ts`). Outbound requests are also written
 *   in snake_case so the gateway's byte-for-byte pass-through reaches AMS
 *   verbatim.
 *
 * Boxed-type rule:
 *   All numeric / boolean fields that participate in optional PATCH semantics
 *   are typed `number | null` / `boolean | null` so an omitted JSON field
 *   surfaces as `null` rather than the primitive default -- per
 *   `project_primitive_double_dto_overwrite.md`.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Exported camelCase types -- consumed by all resolver UI components.
// ============================================================================

/** Discriminator for the three v1 missing-input types + the read-only bucket. */
export type MissingInputType =
  | 'api_contract'
  | 'mapping'
  | 'target_element'
  | 'out_of_v1';

/**
 * A row in `missing_input_resolutions` as exposed to the UI. Audit fields are
 * surfaced inline so the resolver panel can render the "resolved at / by" line
 * without a follow-up fetch.
 */
export interface MissingInputResolutionDto {
  id: string;
  projectId: string;
  missingInputKey: string;
  missingInputType: string;
  resolutionPayloadJson: Record<string, unknown> | null;
  resolvedAt: string;
  resolvedBy: string;
  softDeleted: boolean | null;
  softDeletedAt: string | null;
  softDeletedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * POST body for `/missing-input-resolutions`. The caller MAY supply a
 * pre-computed `missingInputKey` (the typical path -- the frontend already
 * knows the key from the spec's `missing_input_keys_json`) OR supply the
 * per-type canonical descriptor fields and let AMS compute the key.
 */
export interface MissingInputResolutionCreateRequest {
  missingInputKey?: string | null;
  missingInputType: string;
  canonicalDescriptor?: string | null;
  serviceName?: string | null;
  operationName?: string | null;
  sourceElementId?: string | null;
  targetElementId?: string | null;
  targetElementLogicalName?: string | null;
  resolutionPayload?: Record<string, unknown> | null;
  resolvedBy: string;
}

/** Response of `POST /missing-input-resolutions`. */
export interface CreateResolutionResponse {
  resolution: MissingInputResolutionDto;
  affectedSpecIds: string[];
}

/** One bulk-resolve item (uploaded OAS operation / mapping pair / etc.). */
export interface BulkResolveItem {
  type: string;
  serviceName?: string | null;
  operationName?: string | null;
  sourceElementId?: string | null;
  targetElementId?: string | null;
  targetElementLogicalName?: string | null;
  payload?: Record<string, unknown> | null;
}

/** POST body for `/missing-input-resolutions/bulk`. */
export interface BulkResolveRequest {
  items: BulkResolveItem[];
  commit: boolean;
  resolvedBy?: string | null;
}

/** A single bulk-resolve preview row. */
export interface BulkResolveRow {
  key: string;
  missingInputType: string;
  descriptor: string | null;
  affectedSpecIds: string[];
  resolutionPayload: Record<string, unknown> | null;
}

/** Response of `POST /missing-input-resolutions/bulk`. */
export interface BulkResolveResponse {
  resolutions: BulkResolveRow[];
  previewOnly: boolean | null;
  committed: boolean | null;
  totalSpecsAffected: number | null;
}

/** Response of `DELETE /missing-input-resolutions/{id}`. */
export interface SoftDeleteResolutionResponse {
  deletedResolution: MissingInputResolutionDto;
  affectedSpecCount: number | null;
  affectedSpecIds: string[];
}

/** One ready-to-retry story row. */
export interface ReadyToRetrySpec {
  specGenerationId: string;
  workItemId: string;
  title: string | null;
  totalKeys: number | null;
  missingInputKeyCount: number | null;
  resolvedKeys: number | null;
}

/** Response of `GET /spec-generations/ready-to-retry`. */
export interface ReadyToRetryResponse {
  count: number;
  specGenerationIds: string[];
  specs: ReadyToRetrySpec[];
}

/** POST body for `/spec-generations/retry-batch`. */
export interface RetryBatchRequest {
  workItemIds: string[];
  bookOfWorkId: string;
  confirmed?: boolean;
  confirmOverwrite?: boolean;
}

/**
 * Cost-preview envelope returned alongside `requiresConfirmation` when the
 * retry-batch route gates a batch. Mirrors the gateway's
 * `CostPreviewResponse` shape; the resolver panel forwards this verbatim to
 * the cost-preview modal.
 */
export interface RetryBatchCostPreview {
  estimatedTokens: number;
  estimatedWallClockSeconds: number;
  perStoryEstimates?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

/**
 * Result of `POST /spec-generations/retry-batch`. When the threshold gate
 * fires the response carries `requiresConfirmation: true` plus the preview;
 * otherwise the batch handler's full result is round-tripped through.
 */
export interface RetryBatchResult {
  requiresConfirmation?: boolean;
  costPreview?: RetryBatchCostPreview;
  threshold?: string;
  /** Full batch handler envelope when the gate did not fire. */
  perStoryResults?: Array<Record<string, unknown>>;
  persistedCount?: number;
  resultsCouldNotPersist?: number;
  summary?: Record<string, number>;
  [key: string]: unknown;
}

// ----------------------------------------------------------------------------
// parse-files types (Spec 2026-05-20 Bulk-Resolve OAS/WSDL Parser, Task 6)
// ----------------------------------------------------------------------------

/** Per-operation classification inside a parsed contract file. */
export interface ContractIngestOperation {
  identifier: string;
  missingInputKey: string | null;
  status: string; // matched | already_resolved | no_match | parse_skipped
  matchedSpecIds: string[];
  existingResolutionId: string | null;
}

/** Per-file block in the parse-files response. */
export interface ContractIngestFile {
  fileName: string;
  fileSize: number | null;
  format: string | null;
  status: string; // queued | parsing | parsed | failed
  failureReason: string | null;
  suggestedServiceName: string | null;
  finalServiceName: string | null;
  operations: ContractIngestOperation[];
}

/** Aggregate counts derived from the per-file breakdown. */
export interface ContractIngestSummary {
  totalOperations: number;
  matched: number;
  alreadyResolved: number;
  noMatch: number;
  willCreateResolutions: number;
  affectedSpecCount: number;
}

/** Response of `POST /missing-input-resolutions/parse-files`. */
export interface ContractIngestResponse {
  files: ContractIngestFile[];
  summary: ContractIngestSummary;
  previewOnly: boolean;
}

// ============================================================================
// Private wire types -- inbound JSON shape (snake_case on the wire).
// Not exported; consumers should not touch these directly.
// ============================================================================

interface MissingInputResolutionWireDto {
  id: string;
  project_id?: string;
  projectId?: string;
  missing_input_key?: string;
  missingInputKey?: string;
  missing_input_type?: string;
  missingInputType?: string;
  resolution_payload_json?: Record<string, unknown> | null;
  resolutionPayloadJson?: Record<string, unknown> | null;
  resolved_at?: string;
  resolvedAt?: string;
  resolved_by?: string;
  resolvedBy?: string;
  soft_deleted?: boolean | null;
  softDeleted?: boolean | null;
  soft_deleted_at?: string | null;
  softDeletedAt?: string | null;
  soft_deleted_by?: string | null;
  softDeletedBy?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

interface CreateResolutionWireResponse {
  resolution: MissingInputResolutionWireDto;
  affected_spec_ids?: string[];
  affectedSpecIds?: string[];
}

interface BulkResolveRowWireDto {
  key: string;
  missing_input_type?: string;
  missingInputType?: string;
  descriptor?: string | null;
  affected_spec_ids?: string[];
  affectedSpecIds?: string[];
  resolution_payload?: Record<string, unknown> | null;
  resolutionPayload?: Record<string, unknown> | null;
}

interface BulkResolveWireResponse {
  resolutions?: BulkResolveRowWireDto[];
  preview_only?: boolean | null;
  previewOnly?: boolean | null;
  committed?: boolean | null;
  total_specs_affected?: number | null;
  totalSpecsAffected?: number | null;
}

interface SoftDeleteResolutionWireResponse {
  deleted_resolution?: MissingInputResolutionWireDto;
  deletedResolution?: MissingInputResolutionWireDto;
  affected_spec_count?: number | null;
  affectedSpecCount?: number | null;
  affected_spec_ids?: string[];
  affectedSpecIds?: string[];
}

interface ReadyToRetrySpecWireDto {
  spec_generation_id?: string;
  specGenerationId?: string;
  work_item_id?: string;
  workItemId?: string;
  title?: string | null;
  total_keys?: number | null;
  totalKeys?: number | null;
  missing_input_key_count?: number | null;
  missingInputKeyCount?: number | null;
  resolved_keys?: number | null;
  resolvedKeys?: number | null;
}

interface ReadyToRetryWireResponse {
  count?: number;
  spec_generation_ids?: string[];
  specGenerationIds?: string[];
  specs?: ReadyToRetrySpecWireDto[];
}

interface ContractIngestOperationWireDto {
  identifier?: string;
  missing_input_key?: string | null;
  missingInputKey?: string | null;
  status?: string;
  matched_spec_ids?: string[] | null;
  matchedSpecIds?: string[] | null;
  existing_resolution_id?: string | null;
  existingResolutionId?: string | null;
}

interface ContractIngestFileWireDto {
  file_name?: string;
  fileName?: string;
  file_size?: number | null;
  fileSize?: number | null;
  format?: string | null;
  status?: string;
  failure_reason?: string | null;
  failureReason?: string | null;
  suggested_service_name?: string | null;
  suggestedServiceName?: string | null;
  final_service_name?: string | null;
  finalServiceName?: string | null;
  operations?: ContractIngestOperationWireDto[] | null;
}

interface ContractIngestSummaryWireDto {
  total_operations?: number | null;
  totalOperations?: number | null;
  matched?: number | null;
  already_resolved?: number | null;
  alreadyResolved?: number | null;
  no_match?: number | null;
  noMatch?: number | null;
  will_create_resolutions?: number | null;
  willCreateResolutions?: number | null;
  affected_spec_count?: number | null;
  affectedSpecCount?: number | null;
}

interface ContractIngestWireResponse {
  files?: ContractIngestFileWireDto[] | null;
  summary?: ContractIngestSummaryWireDto | null;
  preview_only?: boolean | null;
  previewOnly?: boolean | null;
}

// ============================================================================
// Boundary mappers (wire -> camelCase). Tolerate either casing because the
// in-house controller tests (MockMvc standalone) emit camelCase while the
// running Spring application emits snake_case via the global Jackson naming
// strategy.
// ============================================================================

function readString(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  fallback: string = '',
): string {
  if (primary != null) return primary;
  if (secondary != null) return secondary;
  return fallback;
}

function readNullableString(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string | null {
  if (primary != null) return primary;
  if (secondary != null) return secondary;
  return null;
}

function readNullableNumber(
  primary: number | null | undefined,
  secondary: number | null | undefined,
): number | null {
  if (primary != null) return primary;
  if (secondary != null) return secondary;
  return null;
}

function readNullableBoolean(
  primary: boolean | null | undefined,
  secondary: boolean | null | undefined,
): boolean | null {
  if (primary != null) return primary;
  if (secondary != null) return secondary;
  return null;
}

function mapResolutionWireToDto(
  w: MissingInputResolutionWireDto,
): MissingInputResolutionDto {
  return {
    id: w.id,
    projectId: readString(w.projectId, w.project_id),
    missingInputKey: readString(w.missingInputKey, w.missing_input_key),
    missingInputType: readString(w.missingInputType, w.missing_input_type),
    resolutionPayloadJson:
      w.resolutionPayloadJson ?? w.resolution_payload_json ?? null,
    resolvedAt: readString(w.resolvedAt, w.resolved_at),
    resolvedBy: readString(w.resolvedBy, w.resolved_by),
    softDeleted: readNullableBoolean(w.softDeleted, w.soft_deleted),
    softDeletedAt: readNullableString(w.softDeletedAt, w.soft_deleted_at),
    softDeletedBy: readNullableString(w.softDeletedBy, w.soft_deleted_by),
    createdAt: readNullableString(w.createdAt, w.created_at),
    updatedAt: readNullableString(w.updatedAt, w.updated_at),
  };
}

function mapCreateResolutionResponse(
  w: CreateResolutionWireResponse,
): CreateResolutionResponse {
  return {
    resolution: mapResolutionWireToDto(w.resolution),
    affectedSpecIds: w.affectedSpecIds ?? w.affected_spec_ids ?? [],
  };
}

function mapBulkRowWireToDto(w: BulkResolveRowWireDto): BulkResolveRow {
  return {
    key: w.key,
    missingInputType: readString(w.missingInputType, w.missing_input_type),
    descriptor: w.descriptor ?? null,
    affectedSpecIds: w.affectedSpecIds ?? w.affected_spec_ids ?? [],
    resolutionPayload: w.resolutionPayload ?? w.resolution_payload ?? null,
  };
}

function mapBulkResponse(w: BulkResolveWireResponse): BulkResolveResponse {
  return {
    resolutions: (w.resolutions ?? []).map(mapBulkRowWireToDto),
    previewOnly: readNullableBoolean(w.previewOnly, w.preview_only),
    committed: w.committed ?? null,
    totalSpecsAffected: readNullableNumber(
      w.totalSpecsAffected,
      w.total_specs_affected,
    ),
  };
}

function mapSoftDeleteResponse(
  w: SoftDeleteResolutionWireResponse,
): SoftDeleteResolutionResponse {
  const raw = w.deletedResolution ?? w.deleted_resolution;
  if (!raw) {
    throw new Error('Soft-delete response missing deletedResolution');
  }
  return {
    deletedResolution: mapResolutionWireToDto(raw),
    affectedSpecCount: readNullableNumber(
      w.affectedSpecCount,
      w.affected_spec_count,
    ),
    affectedSpecIds: w.affectedSpecIds ?? w.affected_spec_ids ?? [],
  };
}

function mapReadyToRetrySpec(w: ReadyToRetrySpecWireDto): ReadyToRetrySpec {
  return {
    specGenerationId: readString(w.specGenerationId, w.spec_generation_id),
    workItemId: readString(w.workItemId, w.work_item_id),
    title: w.title ?? null,
    totalKeys: readNullableNumber(w.totalKeys, w.total_keys),
    missingInputKeyCount: readNullableNumber(
      w.missingInputKeyCount,
      w.missing_input_key_count,
    ),
    resolvedKeys: readNullableNumber(w.resolvedKeys, w.resolved_keys),
  };
}

function mapReadyToRetryResponse(
  w: ReadyToRetryWireResponse,
): ReadyToRetryResponse {
  return {
    count: w.count ?? 0,
    specGenerationIds:
      w.specGenerationIds ?? w.spec_generation_ids ?? [],
    specs: (w.specs ?? []).map(mapReadyToRetrySpec),
  };
}

function mapContractIngestOperation(
  w: ContractIngestOperationWireDto,
): ContractIngestOperation {
  return {
    identifier: readString(w.identifier, undefined),
    missingInputKey: readNullableString(w.missingInputKey, w.missing_input_key),
    status: readString(w.status, undefined),
    matchedSpecIds: w.matchedSpecIds ?? w.matched_spec_ids ?? [],
    existingResolutionId: readNullableString(
      w.existingResolutionId,
      w.existing_resolution_id,
    ),
  };
}

function mapContractIngestFile(
  w: ContractIngestFileWireDto,
): ContractIngestFile {
  return {
    fileName: readString(w.fileName, w.file_name),
    fileSize: readNullableNumber(w.fileSize, w.file_size),
    format: readNullableString(w.format, undefined),
    status: readString(w.status, undefined),
    failureReason: readNullableString(w.failureReason, w.failure_reason),
    suggestedServiceName: readNullableString(
      w.suggestedServiceName,
      w.suggested_service_name,
    ),
    finalServiceName: readNullableString(w.finalServiceName, w.final_service_name),
    operations: (w.operations ?? []).map(mapContractIngestOperation),
  };
}

function mapContractIngestSummary(
  w: ContractIngestSummaryWireDto | null | undefined,
): ContractIngestSummary {
  const s = w ?? {};
  return {
    totalOperations: readNullableNumber(s.totalOperations, s.total_operations) ?? 0,
    matched: readNullableNumber(s.matched, s.matched) ?? 0,
    alreadyResolved:
      readNullableNumber(s.alreadyResolved, s.already_resolved) ?? 0,
    noMatch: readNullableNumber(s.noMatch, s.no_match) ?? 0,
    willCreateResolutions:
      readNullableNumber(s.willCreateResolutions, s.will_create_resolutions) ?? 0,
    affectedSpecCount:
      readNullableNumber(s.affectedSpecCount, s.affected_spec_count) ?? 0,
  };
}

function mapContractIngestResponse(
  w: ContractIngestWireResponse,
): ContractIngestResponse {
  return {
    files: (w.files ?? []).map(mapContractIngestFile),
    summary: mapContractIngestSummary(w.summary),
    previewOnly: (readNullableBoolean(w.previewOnly, w.preview_only) ?? false),
  };
}

// ============================================================================
// camelCase request body -> snake_case wire body. Outbound encoding mirrors
// the AMS Jackson naming strategy so the gateway pass-through reaches the
// server in the form Spring expects.
// ============================================================================

function encodeCreateRequest(
  req: MissingInputResolutionCreateRequest,
): Record<string, unknown> {
  return {
    missing_input_key: req.missingInputKey ?? null,
    missing_input_type: req.missingInputType,
    canonical_descriptor: req.canonicalDescriptor ?? null,
    service_name: req.serviceName ?? null,
    operation_name: req.operationName ?? null,
    source_element_id: req.sourceElementId ?? null,
    target_element_id: req.targetElementId ?? null,
    target_element_logical_name: req.targetElementLogicalName ?? null,
    resolution_payload: req.resolutionPayload ?? null,
    resolved_by: req.resolvedBy,
  };
}

function encodeBulkItem(item: BulkResolveItem): Record<string, unknown> {
  return {
    type: item.type,
    service_name: item.serviceName ?? null,
    operation_name: item.operationName ?? null,
    source_element_id: item.sourceElementId ?? null,
    target_element_id: item.targetElementId ?? null,
    target_element_logical_name: item.targetElementLogicalName ?? null,
    payload: item.payload ?? null,
  };
}

function encodeBulkRequest(req: BulkResolveRequest): Record<string, unknown> {
  return {
    items: req.items.map(encodeBulkItem),
    commit: req.commit,
    resolved_by: req.resolvedBy ?? null,
  };
}

// ============================================================================
// Error parsing (mirrors `targetArchitecturesApi.ts`).
// ============================================================================

export interface MissingInputResolutionsApiErrorBody {
  code?: string | number;
  field?: string;
  message?: string;
}

export class MissingInputResolutionsApiError extends Error {
  readonly status: number;
  readonly body: MissingInputResolutionsApiErrorBody;
  constructor(
    status: number,
    body: MissingInputResolutionsApiErrorBody,
    message?: string,
  ) {
    super(
      message ??
        body.message ??
        `Missing input resolutions API error (status ${status})`,
    );
    this.name = 'MissingInputResolutionsApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseError(
  res: Response,
): Promise<MissingInputResolutionsApiError> {
  let body: MissingInputResolutionsApiErrorBody = {};
  try {
    const raw = (await res.json()) as
      | MissingInputResolutionsApiErrorBody
      | { error?: MissingInputResolutionsApiErrorBody | string };
    if (
      raw &&
      typeof raw === 'object' &&
      'error' in raw &&
      raw.error &&
      typeof raw.error === 'object'
    ) {
      body = raw.error as MissingInputResolutionsApiErrorBody;
    } else {
      body = raw as MissingInputResolutionsApiErrorBody;
    }
  } catch {
    body = { message: res.statusText || `HTTP ${res.status}` };
  }
  return new MissingInputResolutionsApiError(res.status, body);
}

// ============================================================================
// API functions
// ============================================================================

/**
 * List active resolutions for a project. Filterable by `?type=` and
 * `?missingInputKey=` (forwarded verbatim).
 */
export async function listResolutions(
  projectId: string,
  opts?: { type?: string; missingInputKey?: string },
): Promise<MissingInputResolutionDto[]> {
  const queryParts: string[] = [];
  if (opts?.type) queryParts.push(`type=${encodeURIComponent(opts.type)}`);
  if (opts?.missingInputKey) {
    queryParts.push(
      `missingInputKey=${encodeURIComponent(opts.missingInputKey)}`,
    );
  }
  const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/missing-input-resolutions${qs}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw await parseError(res);
  const wire = (await res.json()) as MissingInputResolutionWireDto[];
  return (wire ?? []).map(mapResolutionWireToDto);
}

/**
 * Create a single resolution.
 *
 * Returns `{ resolution, affectedSpecIds }` so the caller can refresh the
 * "X of Y resolved" badge without a follow-up fetch.
 */
export async function createResolution(
  projectId: string,
  request: MissingInputResolutionCreateRequest,
): Promise<CreateResolutionResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/missing-input-resolutions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(encodeCreateRequest(request)),
  });
  if (!res.ok) throw await parseError(res);
  const wire = (await res.json()) as CreateResolutionWireResponse;
  return mapCreateResolutionResponse(wire);
}

/**
 * Bulk preview / commit. When `request.commit=false` the call is preview-only;
 * `commit=true` writes all resolutions in one AMS transaction.
 *
 * Always show the preview before any write (per spec line 64) -- the resolver
 * dashboard surface uses this to render a confirmation table.
 */
export async function bulkResolve(
  projectId: string,
  request: BulkResolveRequest,
): Promise<BulkResolveResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/missing-input-resolutions/bulk`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(encodeBulkRequest(request)),
  });
  if (!res.ok) throw await parseError(res);
  const wire = (await res.json()) as BulkResolveWireResponse;
  return mapBulkResponse(wire);
}

/**
 * Multipart parse-files upload.
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 6.
 *
 * POSTs the supplied files to the gateway proxy at
 * `POST /api/projects/{projectId}/missing-input-resolutions/parse-files`. The
 * gateway re-streams the multipart body to AMS verbatim; AMS owns format
 * detection, parsing, classification, and (when `commit=true`) persistence.
 *
 * `serviceNames` is a positional list parallel to `files` -- one entry per
 * file in upload order. Use `null` to defer to the parser's
 * `suggestedServiceName` for that file; otherwise the override wins.
 *
 * The optional `userId` is forwarded as `X-User-Id` so the audit trail
 * (resolved_by) carries the caller's identity when `commit=true`.
 */
export async function parseFiles(
  projectId: string,
  files: File[],
  serviceNames: (string | null)[],
  commit: boolean,
  userId?: string,
): Promise<ContractIngestResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/missing-input-resolutions/parse-files`;

  const fd = new FormData();
  for (const f of files) {
    fd.append('files', f, f.name);
  }
  // AMS reads `serviceNames` as a positional `@RequestParam List<String>` so
  // each entry must be appended under the same field name in upload order.
  // An empty string conveys "no override" to the AMS controller (which then
  // falls back to the parser's `suggestedServiceName`).
  for (const sn of serviceNames) {
    fd.append('serviceNames', sn ?? '');
  }
  fd.append('commit', String(commit));

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (userId) headers['X-User-Id'] = userId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: fd,
  });
  if (!res.ok) throw await parseError(res);
  const wire = (await res.json()) as ContractIngestWireResponse;
  return mapContractIngestResponse(wire);
}

/**
 * Soft-delete a resolution. Triggers the AMS-side cross-story cascade
 * (any spec whose `missing_input_keys_json` contained this key is flipped
 * back to `insufficient_context` with `stale=true, staleReason='resolution_reset'`).
 *
 * The optional `deletedBy` argument is forwarded as a query string so AMS can
 * stamp the audit trail.
 */
export async function softDeleteResolution(
  projectId: string,
  resolutionId: string,
  deletedBy?: string,
): Promise<SoftDeleteResolutionResponse> {
  const qs = deletedBy
    ? `?deletedBy=${encodeURIComponent(deletedBy)}`
    : '';
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/missing-input-resolutions/${encodeURIComponent(resolutionId)}${qs}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw await parseError(res);
  const wire = (await res.json()) as SoftDeleteResolutionWireResponse;
  return mapSoftDeleteResponse(wire);
}

/**
 * Fetch the project's ready-to-retry summary. A spec is "ready" only when
 * every entry in its `missing_input_keys_json` has an active resolution.
 */
export async function getReadyToRetry(
  projectId: string,
): Promise<ReadyToRetryResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/ready-to-retry`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw await parseError(res);
  const wire = (await res.json()) as ReadyToRetryWireResponse;
  return mapReadyToRetryResponse(wire);
}

/**
 * Retry shape-spec generation for the supplied work items.
 *
 * The gateway gates the call behind a cost-preview confirmation when
 * `workItemIds.length >= 5 OR estimatedTokens > 50000`. On the gated path the
 * response carries `{ requiresConfirmation: true, costPreview, threshold }`
 * INSTEAD of running the batch; the caller must re-POST with
 * `confirmed: true` once the user accepts the preview.
 */
export async function retryBatch(
  projectId: string,
  request: RetryBatchRequest,
): Promise<RetryBatchResult> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/spec-generations/retry-batch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workItemIds: request.workItemIds,
      bookOfWorkId: request.bookOfWorkId,
      confirmed: request.confirmed ?? false,
      confirmOverwrite: request.confirmOverwrite ?? false,
    }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as RetryBatchResult;
}
