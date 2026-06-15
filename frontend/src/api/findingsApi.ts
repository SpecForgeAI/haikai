/**
 * Discovery Findings API Client
 *
 * Spec: 2026-05-16 Discovery Findings / Evidence as a First-Class Discovery
 * Concept -- Task Group 6 (Phase 4 / Commit 4).
 *
 * Frontend client for the discovery findings + finding-links REST surface
 * exposed by the gateway under
 *
 *   /api/v1/discovery/projects/:projectId/architectures/:architectureId
 *     /runs/:runId/findings[...]
 *
 * which in turn proxies the architecture-model-service path
 *
 *   /api/model/projects/:projectId/architectures/:architectureId
 *     /discovery/runs/:runId/findings[...]
 *
 * The TypeScript DTO shapes mirror the AMS DTOs verbatim using snake_case to
 * match the global Jackson SNAKE_CASE serialiser; sibling clients in the
 * codebase (`apiBehaviourClient.ts`, `discoveryApi.ts`) follow the same
 * convention.
 *
 * Spec F (2026-06-02 Normalize Findings Review Actions): the finding
 * disposition field is `review_status` (was `status`) carrying the
 * candidate-parity vocabulary `pending_review`/`approved`/`rejected`/
 * `deferred`, plus a `previous_review_status` audit field. NOTE: the GET
 * `/findings` list filter still travels on the literal AMS query param
 * `status` (`@RequestParam status`); only the VALUE vocabulary changed, not
 * that query-key name (intentional param-name vs field-name asymmetry).
 *
 * Per-spec constraints honoured here:
 *   - Numeric / boolean PATCH-mutable fields typed as `number | null` /
 *     `boolean | null` so an explicit `null` round-trips the wire as JSON
 *     null and the AMS PATCH handler's null-guard skips the field
 *     (`project_primitive_double_dto_overwrite.md`). `confidence` is the
 *     highest-risk field.
 *   - JSONB fields typed as `Record<string, unknown> | null`.
 *   - All URLs include `:projectId` AND `:architectureId` (forgetting
 *     `:architectureId` 404s at the gateway router -- this is by design).
 *   - The AppShell model cache (`project_appshell_model_cache.md`) is NOT
 *     invalidated on finding writes -- findings live outside the
 *     architecture model.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Gateway base URL from env. Defaults to empty string (same origin) for the
 * Vite dev proxy. Mirrors `discoveryApi.ts` and `apiBehaviourClient.ts`.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface FindingsApiErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

/**
 * Typed error thrown on non-2xx responses. Drawer + table callers branch on
 * `error.status` and `error.body.code` to render structured error messages
 * (in particular the AMS 400 `invalid_link_target` codes pass through
 * verbatim).
 */
export class FindingsApiError extends Error {
  readonly status: number;
  readonly body: FindingsApiErrorBody;

  constructor(status: number, body: FindingsApiErrorBody, message?: string) {
    super(message ?? body.message ?? `Findings API error (status ${status})`);
    this.name = 'FindingsApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<FindingsApiErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        if (wrapped && typeof wrapped === 'object') {
          return wrapped as FindingsApiErrorBody;
        }
        return obj as FindingsApiErrorBody;
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
// DTOs (snake_case -- matches AMS Jackson SNAKE_CASE)
// ============================================================================

/**
 * Finding review-disposition vocabulary (`review_status` field). String-typed
 * at the wire so future pack-specific values don't require a TS DTO change;
 * the union here documents the values.
 *
 * Spec F (2026-06-02 Normalize Findings Review Actions): findings adopt the
 * candidate disposition vocabulary -- the legacy
 * `new`/`accepted`/`ignored`/`needs_review`/`resolved` set is retired.
 */
export type DiscoveryFindingStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'deferred';

/**
 * Severity vocabulary (`severity` field). String-typed at the wire.
 */
export type DiscoveryFindingSeverity =
  | 'info'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

/**
 * Link target type vocabulary (`target_type` field). String-typed at the
 * wire; v1 target types listed here. `work_item` and `api_behaviour_baseline`
 * are documented but not emitted in v1.
 */
export type DiscoveryFindingLinkTargetType =
  | 'discovery_evidence'
  | 'discovery_candidate'
  | 'discovery_relationship'
  | 'discovery_cluster'
  | 'discovery_decision_task'
  | 'architecture_element'
  | 'work_item'
  | 'api_behaviour_baseline';

/**
 * A single link from a finding to one of its supporting / related targets.
 * Mirrors the AMS `DiscoveryFindingLinkDto` record exactly.
 */
export interface DiscoveryFindingLinkDto {
  id: string;
  finding_id: string;
  link_type: string;
  target_type: DiscoveryFindingLinkTargetType | string;
  target_id: string;
  label: string | null;
  created_at: string;
}

/**
 * Response shape for a single `discovery_findings` row, with embedded links.
 * Mirrors the AMS `DiscoveryFindingDto` record (snake_case via the global
 * Jackson SNAKE_CASE strategy).
 *
 * `confidence` is `number | null` per the boxed-Double pitfall.
 *
 * Spec F (2026-06-02): `review_status` (was `status`) carries the disposition
 * vocabulary; `previous_review_status` is the audit field stamped with the
 * prior disposition on every transition (null until the first transition).
 */
export interface DiscoveryFindingDto {
  id: string;
  run_id: string;
  project_id: string;
  architecture_id: string;
  finding_type: string;
  category: string;
  severity: DiscoveryFindingSeverity | string;
  confidence: number | null;
  review_status: DiscoveryFindingStatus | string;
  previous_review_status: string | null;
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
 * Inline link shape for finding-creation requests (matches the AMS
 * `CreateDiscoveryFindingLinkRequest` nested record).
 */
export interface CreateDiscoveryFindingLinkRequestBody {
  link_type: string;
  target_type: DiscoveryFindingLinkTargetType | string;
  target_id: string;
  label?: string | null;
}

/**
 * Request body for a single finding create. The path tuple
 * `(projectId, architectureId, runId)` supplies the scoping ids; this body
 * carries the finding's content + an optional list of links to attach
 * transactionally.
 *
 * `review_status` is optional; omitted lets AMS apply its `pending_review`
 * default (Spec F).
 */
export interface CreateDiscoveryFindingRequest {
  finding_type: string;
  category: string;
  severity: DiscoveryFindingSeverity | string;
  confidence?: number | null;
  review_status?: DiscoveryFindingStatus | string | null;
  title: string;
  summary?: string | null;
  detail_json?: Record<string, unknown> | null;
  source?: string | null;
  created_by_stage?: string | null;
  reviewer_notes?: string | null;
  links?: CreateDiscoveryFindingLinkRequestBody[];
}

/**
 * Request body for the bulk create endpoint. The service-layer enforces a
 * per-request cap; over-cap requests 400.
 */
export interface BulkCreateDiscoveryFindingsRequest {
  findings: CreateDiscoveryFindingRequest[];
}

/**
 * PATCH body. Every field optional; `null` means "leave the persisted column
 * alone" -- the AMS handler null-guards every field. `confidence` is
 * `number | null` to round-trip the wire correctly.
 */
export interface UpdateDiscoveryFindingRequest {
  finding_type?: string | null;
  category?: string | null;
  severity?: DiscoveryFindingSeverity | string | null;
  confidence?: number | null;
  review_status?: DiscoveryFindingStatus | string | null;
  title?: string | null;
  summary?: string | null;
  detail_json?: Record<string, unknown> | null;
  source?: string | null;
  created_by_stage?: string | null;
  reviewer_notes?: string | null;
}

/**
 * Convenience body for `POST .../findings/:findingId/review`. AMS stamps
 * `reviewed_at` server-side and captures `previous_review_status`.
 *
 * `review_status` must be a reviewer-valid disposition: `approved`,
 * `rejected`, or `deferred` (Spec F). Transitions are unrestricted
 * (any-&gt;any), so no status-transition error is returned.
 */
export interface ReviewDiscoveryFindingRequest {
  review_status: DiscoveryFindingStatus | string;
  reviewer_notes?: string | null;
}

/**
 * Filter set for the list endpoint. Mirrors the AMS query-parameter surface.
 * The text search hits `title` + `summary`.
 *
 * `review_status` filters on the renamed disposition column (Spec F). NOTE:
 * `buildQueryString` maps it onto the literal AMS `status` query param, which
 * was intentionally NOT renamed.
 */
export interface ListFindingsFilters {
  category?: string | null;
  finding_type?: string | null;
  severity?: DiscoveryFindingSeverity | string | null;
  review_status?: DiscoveryFindingStatus | string | null;
  source?: string | null;
  created_by_stage?: string | null;
  linked_target_type?: DiscoveryFindingLinkTargetType | string | null;
  linked_target_id?: string | null;
  q?: string | null;
  page?: number | null;
  size?: number | null;
}

/**
 * Request body for the bulk-review endpoint
 * `POST .../findings/bulk-review`.
 *
 * Scope is selected by EITHER `ids` (explicit list) OR `filter` (the same
 * shape as the GET list endpoint's query params, snake_case at the wire);
 * AMS returns 400 `mutually_exclusive_inputs` when both are supplied.
 * When neither is supplied the action targets every finding in the run.
 *
 * `review_status` must be a reviewer-valid disposition (`approved` /
 * `rejected` / `deferred`, Spec F).
 *
 * `reviewer_notes` follows the single-row `reviewFinding` semantics: a
 * non-empty trimmed value overwrites existing notes on every actioned row;
 * omitted / null preserves whatever notes are already persisted.
 *
 * Spec 2026-05-28: Bulk Findings Actions -- Task Group 2; normalized by
 * Spec F (2026-06-02).
 */
export interface BulkReviewFindingsRequest {
  ids?: string[];
  filter?: ListFindingsFilters;
  review_status: DiscoveryFindingStatus | string;
  reviewer_notes?: string;
}

/**
 * Response shape from the bulk-review endpoint. snake_case wire fields
 * mirror the AMS `BulkReviewDiscoveryFindingsResponse` record verbatim
 * (Jackson global `SNAKE_CASE` -- see CLAUDE.md).
 *
 * - `updated_count` = number of rows whose review_status was changed.
 * - `skipped_count` = rows that were not changed; the optional
 *   `skipped_by_reason` breakdown splits this into the two reasons AMS
 *   recognises:
 *     - `already_in_target`: row's current review_status already equals the
 *       requested disposition (no-op).
 *     - `transition_not_allowed`: RETAINED for response-shape stability but
 *       ALWAYS `0` under Spec F -- transitions are unrestricted (any->any),
 *       so no row is ever skipped for a forbidden transition.
 * - `delta_by_from_status` is keyed by the pre-mutation disposition string
 *   (`pending_review`, `approved`, `rejected`, `deferred`); the frontend
 *   applies these deltas to the `runSummary` pills in one pass (decrement
 *   each from-status pill by its count; increment the to-status pill by
 *   `updated_count`).
 */
export interface BulkReviewFindingsResponse {
  updated_count: number;
  skipped_count: number;
  skipped_by_reason?: {
    already_in_target: number;
    transition_not_allowed: number;
  };
  delta_by_from_status: Record<string, number>;
}

/**
 * Pagination envelope returned by `GET .../findings`. Mirrors the AMS
 * `DiscoveryFindingSearchResponse` record.
 */
export interface DiscoveryFindingSearchResponse {
  items: DiscoveryFindingDto[];
  total: number;
  page: number;
  size: number;
}

// ============================================================================
// Internal URL + fetch helpers
// ============================================================================

/**
 * Build the gateway findings path prefix for a given
 * `(projectId, architectureId, runId)`. All three ids are URL-encoded.
 */
function findingsPathPrefix(
  projectId: string,
  architectureId: string,
  runId: string,
): string {
  return (
    `${GATEWAY_BASE}/api/v1/discovery` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/runs/${encodeURIComponent(runId)}/findings`
  );
}

/**
 * Serialise filter values into a query string. `null` / `undefined` /
 * empty-string values are skipped so the AMS handler can default them.
 *
 * NOTE (Spec F): the disposition filter rides the literal AMS `status` query
 * param (`@RequestParam status` on the GET list endpoint) even though the DTO
 * field + stored column are now named `review_status`. This param-name vs
 * field-name asymmetry is intentional -- do NOT rename the query key.
 */
function buildQueryString(filters: ListFindingsFilters | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  const entries: Array<[string, unknown]> = [
    ['category', filters.category],
    ['findingType', filters.finding_type],
    ['severity', filters.severity],
    ['status', filters.review_status],
    ['source', filters.source],
    ['createdByStage', filters.created_by_stage],
    ['linkedTargetType', filters.linked_target_type],
    ['linkedTargetId', filters.linked_target_id],
    ['q', filters.q],
    ['page', filters.page],
    ['size', filters.size],
  ];
  for (const [key, value] of entries) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new FindingsApiError(res.status, body);
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
// Public API
// ============================================================================

/**
 * List findings for a run, with optional filters + paging. Returns the AMS
 * pagination envelope (`{ items, total, page, size }`).
 */
export async function listFindings(
  projectId: string,
  architectureId: string,
  runId: string,
  filters?: ListFindingsFilters,
): Promise<DiscoveryFindingSearchResponse> {
  const url = findingsPathPrefix(projectId, architectureId, runId) + buildQueryString(filters);
  return jsonRequest<DiscoveryFindingSearchResponse>(url, { method: 'GET' });
}

/**
 * Fetch a single finding by id. Response includes the finding's `links`
 * array populated server-side.
 */
export async function getFinding(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
): Promise<DiscoveryFindingDto> {
  const url =
    findingsPathPrefix(projectId, architectureId, runId) +
    `/${encodeURIComponent(findingId)}`;
  return jsonRequest<DiscoveryFindingDto>(url, { method: 'GET' });
}

/**
 * Single-create a finding. Frontend callers seldom hit this directly --
 * findings are typically emitted by the discovery-service `FindingEmitter`.
 * Exposed for completeness and for any future "user-authored finding" UX.
 */
export async function createFinding(
  projectId: string,
  architectureId: string,
  runId: string,
  body: CreateDiscoveryFindingRequest,
): Promise<DiscoveryFindingDto> {
  const url = findingsPathPrefix(projectId, architectureId, runId);
  return jsonRequest<DiscoveryFindingDto>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Bulk-create findings (used by the discovery-service emit pipeline; not
 * typically called from the frontend, exposed for completeness).
 */
export async function bulkCreateFindings(
  projectId: string,
  architectureId: string,
  runId: string,
  bodies: CreateDiscoveryFindingRequest[],
): Promise<DiscoveryFindingDto[]> {
  const url = findingsPathPrefix(projectId, architectureId, runId) + '/bulk';
  const payload: BulkCreateDiscoveryFindingsRequest = { findings: bodies };
  return jsonRequest<DiscoveryFindingDto[]>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * PATCH a finding. Every field optional; `null` preserves the column
 * (AMS service null-guards every PATCH field per the boxed-Double pitfall).
 * Used by the drawer for reviewer-notes-only edits and other mutable
 * field updates that don't go through the convenience review endpoint.
 */
export async function updateFinding(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
  body: UpdateDiscoveryFindingRequest,
): Promise<DiscoveryFindingDto> {
  const url =
    findingsPathPrefix(projectId, architectureId, runId) +
    `/${encodeURIComponent(findingId)}`;
  return jsonRequest<DiscoveryFindingDto>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * POST a reviewer action. AMS sets `review_status` + `reviewed_at` (+ optional
 * `reviewer_notes`) and captures `previous_review_status` in one call.
 * Transitions are unrestricted (any disposition -> any disposition, Spec F).
 *
 * Reviewer-notes-only edits should go through `updateFinding` instead --
 * this endpoint is for state-changing actions.
 */
export async function reviewFinding(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
  body: ReviewDiscoveryFindingRequest,
): Promise<DiscoveryFindingDto> {
  const url =
    findingsPathPrefix(projectId, architectureId, runId) +
    `/${encodeURIComponent(findingId)}/review`;
  return jsonRequest<DiscoveryFindingDto>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Bulk reviewer action -- AMS atomically applies a review_status change to
 * every row in the scope and returns the aggregated `{ updated_count,
 * skipped_count, skipped_by_reason?, delta_by_from_status }` envelope.
 *
 * Scope: pass either `body.ids` OR `body.filter` (not both -- AMS rejects
 * the combination with a 400 `mutually_exclusive_inputs` body). Omit both
 * to target every finding in the run.
 *
 * The gateway is a thin pass-through: there is NO per-row PATCH fan-out;
 * AMS does the batch in one transactional boundary. Transitions are
 * unrestricted (any->any, Spec F), so the only skip reason is
 * `already_in_target` (same-disposition rows); `transition_not_allowed`
 * stays in the response shape but is always 0.
 *
 * The caller is expected to apply `delta_by_from_status` to its local
 * `runSummary` pills in one pass to keep the dashboard pills in sync
 * without a refetch.
 *
 * Spec 2026-05-28: Bulk Findings Actions -- Task Group 2; normalized by
 * Spec F (2026-06-02).
 */
export async function bulkReviewFindings(
  projectId: string,
  architectureId: string,
  runId: string,
  body: BulkReviewFindingsRequest,
): Promise<BulkReviewFindingsResponse> {
  const url = findingsPathPrefix(projectId, architectureId, runId) + '/bulk-review';
  return jsonRequest<BulkReviewFindingsResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * List links for a finding. The single-finding GET also includes the links
 * array; this dedicated endpoint exists for callers that just want the
 * link list (e.g. lazy-loading panels in the drawer).
 */
export async function listFindingLinks(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
): Promise<DiscoveryFindingLinkDto[]> {
  const url =
    findingsPathPrefix(projectId, architectureId, runId) +
    `/${encodeURIComponent(findingId)}/links`;
  return jsonRequest<DiscoveryFindingLinkDto[]>(url, { method: 'GET' });
}

/**
 * Create a link from a finding to a target. AMS hard-rejects invalid
 * targets per D6: the target must exist AND belong to the same run / same
 * architecture as the parent finding. Failures surface as 400 with the
 * structured `{ code: "invalid_link_target", message }` body, which is
 * carried through to `FindingsApiError.body`.
 */
export async function createFindingLink(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
  body: CreateDiscoveryFindingLinkRequestBody,
): Promise<DiscoveryFindingLinkDto> {
  const url =
    findingsPathPrefix(projectId, architectureId, runId) +
    `/${encodeURIComponent(findingId)}/links`;
  return jsonRequest<DiscoveryFindingLinkDto>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Delete a single link from a finding.
 */
export async function deleteFindingLink(
  projectId: string,
  architectureId: string,
  runId: string,
  findingId: string,
  linkId: string,
): Promise<void> {
  const url =
    findingsPathPrefix(projectId, architectureId, runId) +
    `/${encodeURIComponent(findingId)}/links/${encodeURIComponent(linkId)}`;
  await jsonRequest<void>(url, { method: 'DELETE' });
}
