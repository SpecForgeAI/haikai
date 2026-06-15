/**
 * Carry-over completeness-gate API client (frontend).
 *
 * Spec: 2026-06-14 D4 — Carry-over Completeness Gate — Task Group 4.
 *
 * The read + three actions the extended Capabilities review surface
 * (`CapabilitiesSection.tsx`, rendered by `FindingsTab.tsx`) calls to clear the
 * carry_over gate, all hosted on the gateway's Migration Execution router:
 *
 *   - {@link getCarryOverCoverage} — GET .../carry-over-coverage: the per-item
 *     coverage status (`un-actioned` / `cited-by-story` / `dismissed`), the
 *     must-account set, and the un-accounted list, server-computed per
 *     book-of-work (the UI never re-derives the gate).
 *   - {@link citeCapability} — POST .../items/append-capability-story (D3's
 *     existing cite route): "Create story" for ONE capability → it flips to
 *     `cited-by-story`.
 *   - {@link dismissCarryOverItem} — POST .../carry-over/dismiss: dismiss ONE
 *     behaviour-bearing item with a MANDATORY non-empty reason.
 *   - {@link generateAllCapabilityStories} — POST
 *     .../carry-over/generate-all-capability-stories: the batch (cite once per
 *     un-covered approved behaviour-bearing capability).
 *
 * The coverage read carries the gateway's `CarryOverCoverageResult` shape
 * verbatim (its keys are idiomatic camelCase — the gateway builds it in
 * TypeScript). The cite call's request/response is the AMS snake_case
 * `append-capability-story` shape (`source_capability_id` etc.), mirroring
 * `migrationCarryOverActions.ts`. Sibling clients (`capabilitiesApi.ts`,
 * `findingsApi.ts`) follow the same typed-error + fetch idiom.
 */

// ============================================================================
// Constants
// ============================================================================

/** Gateway base URL from env (same-origin default for the Vite dev proxy). */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface CarryOverApiErrorBody {
  code?: string | number;
  message?: string;
  error?: string;
  [k: string]: unknown;
}

/** Typed error thrown on non-2xx responses (mirrors `CapabilitiesApiError`). */
export class CarryOverApiError extends Error {
  readonly status: number;
  readonly body: CarryOverApiErrorBody;

  constructor(status: number, body: CarryOverApiErrorBody, message?: string) {
    super(
      message ??
        body.message ??
        body.error ??
        `Carry-over API error (status ${status})`,
    );
    this.name = 'CarryOverApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseErrorBody(res: Response): Promise<CarryOverApiErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as CarryOverApiErrorBody;
      }
      return { message: res.statusText };
    }
    const text = await res.text();
    return { message: text || res.statusText };
  } catch {
    return { message: res.statusText };
  }
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new CarryOverApiError(res.status, body);
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
// Coverage read shapes (mirror the gateway `CarryOverCoverageResult`)
// ============================================================================

/** Per-item coverage status (D8). */
export type CoverageStatus = 'un-actioned' | 'cited-by-story' | 'dismissed';

/** One resolved coverage item (capability or finding). */
export interface CarryOverCoverageItem {
  kind: 'capability' | 'finding';
  id: string;
  status: CoverageStatus;
  /** True iff behaviour-bearing (and therefore a gating candidate). */
  behaviourBearing: boolean;
  /** True iff this finding is rolled up under a covered/dismissed capability. */
  rolledUp?: boolean;
  label: string;
}

/** The full per-book carry_over coverage result. */
export interface CarryOverCoverageResult {
  items: CarryOverCoverageItem[];
  mustAccount: CarryOverCoverageItem[];
  unaccounted: CarryOverCoverageItem[];
  accountedCount: number;
  totalMustAccount: number;
  ok: boolean;
}

// ============================================================================
// Action request / response shapes
// ============================================================================

/** The cite (append-capability-story) AMS snake_case request body. */
export interface CiteCapabilityRequest {
  source_capability_id: string;
  title: string;
  description?: string | null;
  parent_book_item_id?: string | null;
  sequence_order?: number | null;
}

/** The cite (append-capability-story) AMS snake_case response body. */
export interface CiteCapabilityResponse {
  work_item_id?: string | null;
  book_item_id?: string | null;
  source_capability_id?: string | null;
  message?: string | null;
}

/** The dismiss request body. A finding requires `run_id` (run-scoped review). */
export interface DismissCarryOverItemRequest {
  kind: 'capability' | 'finding';
  id: string;
  architecture_id: string;
  run_id?: string | null;
  /** The MANDATORY non-empty dismissal reason. */
  reason: string;
}

/** The "Generate all capability stories" batch response. */
export interface GenerateAllCapabilityStoriesResponse {
  citedCount: number;
  skippedCount: number;
  failures: Array<{ capabilityId: string; error: string }>;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * GET the per-item carry_over coverage for a book of work (server-computed):
 * the per-capability / per-finding `un-actioned` / `cited-by-story` /
 * `dismissed` status, the must-account set, and the un-accounted list.
 */
export async function getCarryOverCoverage(
  projectId: string,
  bookId: string,
): Promise<CarryOverCoverageResult> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/carry-over-coverage`;
  return jsonRequest<CarryOverCoverageResult>(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
}

/**
 * Cite ONE capability into a story via D3's `append-capability-story` route.
 * Stamps `source_capability_id` (column + blob) so the capability flips to
 * `cited-by-story` and the carry_over gate clears for it.
 */
export async function citeCapability(
  projectId: string,
  bookId: string,
  body: CiteCapabilityRequest,
): Promise<CiteCapabilityResponse> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/items/append-capability-story`;
  return jsonRequest<CiteCapabilityResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Dismiss ONE behaviour-bearing carry_over item with a MANDATORY non-empty
 * reason. The gateway rejects an empty reason (400) — the gate is not satisfied
 * without one. A finding requires `run_id`.
 */
export async function dismissCarryOverItem(
  projectId: string,
  body: DismissCarryOverItemRequest,
): Promise<{ ok: true }> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/carry-over/dismiss`;
  return jsonRequest<{ ok: true }>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Run the "Generate all capability stories" batch: cite once per un-covered
 * approved behaviour-bearing capability. The gateway derives the already-cited
 * set server-side so the UI cannot under/over-cite.
 */
export async function generateAllCapabilityStories(
  projectId: string,
  bookId: string,
): Promise<GenerateAllCapabilityStoriesResponse> {
  const url =
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}` +
    `/carry-over/generate-all-capability-stories`;
  return jsonRequest<GenerateAllCapabilityStoriesResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
}
