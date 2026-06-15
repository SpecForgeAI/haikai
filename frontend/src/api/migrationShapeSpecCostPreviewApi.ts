/**
 * Migration Shape-Spec Cost-Preview API client.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7
 *
 * Front-end client for the gateway endpoint that estimates the token + wall-
 * clock cost of a Generate-all batch BEFORE the user submits. Two-pass mode
 * (`includePass2=true`) roughly doubles the estimate vs pass-1-only.
 *
 *   POST /api/migration-shape-spec/cost-preview
 *     Body: { projectId, bookOfWorkId, includePass2?, tokensPerSecond? }
 *
 * Response shape mirrors the gateway-side `CostPreviewResponse` from
 * `gateway/src/services/migrationShapeSpecCostPreview.ts` so the dialog can
 * surface a sorted-by-cost per-story breakdown alongside the headline
 * total. We keep the API shape camelCase end-to-end because the gateway
 * service is TypeScript and already emits camelCase JSON.
 *
 * Conventions mirror `frontend/src/api/migrationDeliveryDashboardApi.ts` for
 * naming, URL building (`encodeURIComponent`), and structured error parsing
 * on non-2xx responses.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Public types
// ============================================================================

export interface PerStoryCostEstimate {
  workItemId: string;
  bookItemId: string;
  title: string;
  pass1EstimatedTokens: number;
  pass2EstimatedTokens: number;
  totalEstimatedTokens: number;
}

export interface CostPreviewResponse {
  estimatedTokens: number;
  estimatedWallClockSeconds: number;
  perStoryEstimates: PerStoryCostEstimate[];
  meta: {
    storyCount: number;
    includePass2: boolean;
    perStoryContextTokenCap: number;
    crossStoryContextTokenCap: number;
    tokensPerSecond: number;
    outputBufferTokens: number;
  };
  /** Aggregated pass-1 totals (sum across all per-story `pass1EstimatedTokens`). */
  pass1TotalTokens?: number;
  /** Aggregated pass-2 additional totals (sum across all per-story `pass2EstimatedTokens`). */
  pass2AdditionalTokens?: number;
}

export interface CostPreviewRequest {
  projectId: string;
  bookOfWorkId: string;
  includePass2?: boolean;
  tokensPerSecond?: number;
}

// ============================================================================
// API function
// ============================================================================

/**
 * Call the gateway cost-preview endpoint. Returns the estimated tokens +
 * wall-clock seconds + per-story breakdown that the Generate-all dialog
 * renders next to the auto-run pass-2 toggle.
 *
 * Network or 5xx errors surface as rejected promises so the caller (dialog)
 * can swap the cost-preview block for an inline error placeholder; the
 * Generate-all action stays available regardless (the estimate is purely
 * informational).
 */
export async function fetchMigrationShapeSpecCostPreview(
  request: CostPreviewRequest,
): Promise<CostPreviewResponse> {
  const url = `${GATEWAY_BASE}/api/migration-shape-spec/cost-preview`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errorBody = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      const nested =
        typeof errorBody.error === 'object' && errorBody.error
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : '';
      serverMessage = errorBody.message || nested || '';
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(
      serverMessage ||
        `Failed to fetch shape-spec cost preview: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as CostPreviewResponse;
}

// ============================================================================
// WorkstreamLockedError helpers
// ============================================================================

/**
 * Structured 409 error envelope shape the gateway emits when a second
 * concurrent batch is attempted for the same workstream. The dialog/dashboard
 * uses this signal to render the "Batch in progress" banner.
 */
export interface WorkstreamLockedErrorPayload {
  code: 'WORKSTREAM_LOCKED';
  message: string;
  workstreamId: string;
  activePass: number;
}

/** Convenience type guard for the structured 409 envelope. */
export function isWorkstreamLockedError(
  value: unknown,
): value is WorkstreamLockedErrorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.code === 'WORKSTREAM_LOCKED' &&
    typeof v.workstreamId === 'string' &&
    typeof v.activePass === 'number'
  );
}
