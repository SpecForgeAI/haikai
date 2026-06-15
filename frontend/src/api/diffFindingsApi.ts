/**
 * Diff Findings API Client
 *
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 4
 * sub-task 4.2.
 *
 * Frontend client for the diff-scoped discovery findings REST surface exposed
 * by the gateway under
 *
 *   /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings[...]
 *
 * which in turn proxies the architecture-model-service path
 *
 *   /api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings[...]
 *
 * Why a new file instead of extending `findingsApi.ts`
 * ----------------------------------------------------
 * Per accepted Q3 + Q4 of the spec, diff-sourced findings live exclusively on
 * the Drift report tab in v1 (the existing `FindingsTab.tsx` keeps showing
 * run-sourced findings only). The run-scoped `findingsApi.ts` bakes
 * `:runId` into its URL builder and all eight method signatures. Extending
 * it to dynamically dispatch between run-scoped and diff-scoped variants
 * would either (a) make every caller signature ambiguous, or (b) require a
 * fan-out edit of all eight method call sites. A new dedicated file keeps
 * the diff-scoped surface explicit and the existing run-scoped surface
 * untouched -- the lower-risk split for v1.
 *
 * Per-spec constraints honoured here:
 *   - Numeric fields typed `number | null` so an explicit `null` round-trips
 *     the wire correctly (`project_primitive_double_dto_overwrite.md`).
 *     `confidence` is the highest-risk field; the new `api_behaviour_diff_id`
 *     is a UUID (string) so no primitive-drift risk.
 *   - JSONB fields typed `Record<string, unknown> | null`.
 *   - Snake_case field names match the AMS Jackson SNAKE_CASE serialiser.
 *   - DTO includes BOTH `run_id` and `api_behaviour_diff_id` as `string | null`
 *     -- the AMS DB CHECK constraint `discovery_finding_exactly_one_origin`
 *     enforces exactly one is non-null; we type both nullable to match.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Gateway base URL from env. Defaults to empty string (same origin) for the
 * Vite dev proxy. Mirrors `apiBehaviourClient.ts` and `findingsApi.ts`.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface DiffFindingsApiErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

/**
 * Typed error thrown on non-2xx responses. Drawer callers branch on
 * `error.status` and `error.body.code` to render structured error messages
 * (in particular AMS 422 status-transition codes pass through verbatim).
 */
export class DiffFindingsApiError extends Error {
  readonly status: number;
  readonly body: DiffFindingsApiErrorBody;

  constructor(status: number, body: DiffFindingsApiErrorBody, message?: string) {
    super(message ?? body.message ?? `Diff findings API error (status ${status})`);
    this.name = 'DiffFindingsApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<DiffFindingsApiErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        if (wrapped && typeof wrapped === 'object') {
          return wrapped as DiffFindingsApiErrorBody;
        }
        return obj as DiffFindingsApiErrorBody;
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
 * Finding status vocabulary. String-typed at the wire so future pack-specific
 * values don't require a TS DTO change; the union here documents v1.
 */
export type DiscoveryFindingStatus =
  | 'new'
  | 'accepted'
  | 'ignored'
  | 'needs_review'
  | 'resolved';

/**
 * Severity vocabulary. v1 introduces the first-ever `critical` value for
 * `status_drift` 2xx -> 5xx -- see `findingEmissionRules.ts` for the full
 * ladder.
 */
export type DiscoveryFindingSeverity =
  | 'info'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

/**
 * Wire-shape DTO for a single `discovery_finding_links` row.
 */
export interface DiscoveryFindingLinkDto {
  id: string;
  finding_id: string;
  link_type: string;
  target_type: string;
  target_id: string;
  label: string | null;
  created_at: string;
}

/**
 * Response shape for a single `discovery_findings` row, with embedded links.
 *
 * Mirrors the AMS `DiscoveryFindingDto` record (snake_case via the global
 * Jackson SNAKE_CASE strategy).
 *
 * Both `run_id` and `api_behaviour_diff_id` are typed `string | null` -- the
 * AMS DB CHECK constraint `discovery_finding_exactly_one_origin` enforces
 * exactly one of them is non-null on every row. Diff-sourced findings have
 * `run_id === null` and `api_behaviour_diff_id === <diffId>`; run-sourced
 * findings (legacy) have the opposite. The frontend in this spec only ever
 * sees diff-sourced findings (the diff-scoped endpoints filter to those).
 *
 * `confidence` is `number | null` per the boxed-Double pitfall.
 */
export interface DiscoveryFindingDto {
  id: string;
  /** Origin: discovery run id. Null when finding is diff-sourced. */
  run_id: string | null;
  /**
   * Origin: api_behaviour_diff id. Null when finding is run-sourced.
   * Spec 2026-05-25 (changeset 160).
   */
  api_behaviour_diff_id: string | null;
  project_id: string;
  architecture_id: string;
  finding_type: string;
  category: string;
  severity: DiscoveryFindingSeverity | string;
  confidence: number | null;
  status: DiscoveryFindingStatus | string;
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
 * PATCH body for `PATCH .../findings/:findingId`. Every field optional;
 * `null` preserves the persisted column (AMS handler null-guards each field
 * per the boxed-Double pitfall). Used by the drawer for reviewer status
 * transitions + notes edits.
 */
export interface UpdateDiscoveryFindingRequest {
  finding_type?: string | null;
  category?: string | null;
  severity?: DiscoveryFindingSeverity | string | null;
  confidence?: number | null;
  status?: DiscoveryFindingStatus | string | null;
  title?: string | null;
  summary?: string | null;
  detail_json?: Record<string, unknown> | null;
  source?: string | null;
  created_by_stage?: string | null;
  reviewer_notes?: string | null;
}

// ============================================================================
// Internal URL + fetch helpers
// ============================================================================

/**
 * Build the gateway diff-findings path prefix for `(projectId, diffId)`.
 * Both ids URL-encoded. Mirrors `findingsPathPrefix(...)` in `findingsApi.ts`
 * but bakes `diffId` instead of `runId`.
 */
function diffFindingsPathPrefix(projectId: string, diffId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/api-behaviour/diffs/${encodeURIComponent(diffId)}/findings`
  );
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new DiffFindingsApiError(res.status, body);
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
 * GET all findings emitted by this diff, ordered ascending by `created_at`.
 *
 * Used by the Drift report tab to populate the per-diff_item "Findings"
 * badge column via a single batch query at tab load (the results are then
 * grouped client-side by `target_id` where `target_type='api_behaviour_diff_item'`
 * on the linked diff_item id).
 */
export async function listDiffFindings(
  projectId: string,
  diffId: string,
): Promise<DiscoveryFindingDto[]> {
  const url = diffFindingsPathPrefix(projectId, diffId);
  const raw = await jsonRequest<unknown>(url, { method: 'GET' });
  return Array.isArray(raw) ? (raw as DiscoveryFindingDto[]) : [];
}

/**
 * GET findings linked to a specific diff_item via `discovery_finding_links`
 * (target_type='api_behaviour_diff_item').
 *
 * Used as the per-row drill-down query when the user clicks a "Findings"
 * badge. In v1 the rules emit at most one finding per diff_item, but the
 * endpoint returns an array to keep room for future multi-emission rules.
 */
export async function listDiffFindingsByDiffItem(
  projectId: string,
  diffId: string,
  diffItemId: string,
): Promise<DiscoveryFindingDto[]> {
  const url =
    diffFindingsPathPrefix(projectId, diffId) +
    `/by-diff-item/${encodeURIComponent(diffItemId)}`;
  const raw = await jsonRequest<unknown>(url, { method: 'GET' });
  return Array.isArray(raw) ? (raw as DiscoveryFindingDto[]) : [];
}

/**
 * PATCH a diff-sourced finding -- reviewer status transitions + edits.
 *
 * Same body shape as the existing run-scoped PATCH (status-transition rules
 * are enforced server-side; invalid moves surface as 422).
 */
export async function patchDiffFinding(
  projectId: string,
  diffId: string,
  findingId: string,
  patch: UpdateDiscoveryFindingRequest,
): Promise<DiscoveryFindingDto> {
  const url =
    diffFindingsPathPrefix(projectId, diffId) +
    `/${encodeURIComponent(findingId)}`;
  return jsonRequest<DiscoveryFindingDto>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}
