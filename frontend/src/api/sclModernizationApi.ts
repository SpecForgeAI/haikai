/**
 * SCL modernization-decisions API client (2026-08-18 SCL pipeline design,
 * "Intermediate modernization decisions").
 *
 * Thin typed seam over the gateway's modernization review/confirm routes:
 *
 *   GET  /api/v1/projects/{projectId}/architectures/{architectureId}
 *        /scl/modernization/review
 *   POST /api/v1/projects/{projectId}/architectures/{architectureId}
 *        /scl/modernization/confirm
 *
 * The gateway speaks snake_case on this wire; the types below mirror the wire
 * shape VERBATIM (no camelCase re-mapping — the panel is the only consumer).
 *
 * Error conventions mirror `epicCapturedDecisionsApi.ts` / the reconciliation
 * clients: non-2xx responses reject with a structured error carrying the
 * server's `error` message when parseable. A 404 on the review GET is a
 * MEANINGFUL state ("no structural scan yet"), so the error object exposes
 * `status` for the panel to branch on.
 *
 * Decision-code derivation: rows arriving from the review GET do NOT carry a
 * `code`. The confirm code is `matched_rule_code` when present, else derived
 * as `modernize.<family>.<slug-of-from>` (slug: lowercase, any non-alphanumeric
 * run -> '-', leading/trailing '-' trimmed). `deriveDecisionCode` below is the
 * single source of that rule (exported + unit-tested).
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wire types (snake_case, verbatim)
// ============================================================================

export type SclModernizationProvenance =
  | 'ruleset_default'
  | 'llm_proposed'
  | 'unmapped';

export interface SclExampleCite {
  symbol: string;
  source_path: string;
}

export interface SclModernizationReviewRow {
  family: string;
  matcher_key: string;
  usage_count: number;
  example_cites: SclExampleCite[];
  /** The pair-ruleset code that matched, when any (wins as the confirm code). */
  matched_rule_code: string | null;
  from: string;
  default_to: string | null;
  provenance: SclModernizationProvenance;
  notes: string | null;
  /** Present on `llm_proposed` rows only. */
  proposal_rationale?: string;
}

export interface SclExistingDecision {
  decision_id: string;
  decision_code: string;
  answer_value: string;
  answer_summary: string | null;
  scope_kind: string;
  created_at: string;
}

/**
 * 2026-08-30: the loud proposal-pass outcome. `status: 'failed'` means the
 * LLM pass could not run — unmapped rows are NOT legitimate "needs a value"
 * work, and the panel banners a retry instead. `source` says where applied
 * proposals came from ('cache' = the persisted per-scan set, so consecutive
 * loads agree; 'none' = nothing applied).
 */
export interface SclProposalPass {
  status: 'ok' | 'failed';
  source: 'cache' | 'generated' | 'none';
  eligible: number;
  proposed: number;
  error: string | null;
  generated_at: string | null;
}

export interface SclModernizationReview {
  scan_id: string;
  target_architecture_id: string | null;
  rows: SclModernizationReviewRow[];
  existing_decisions: SclExistingDecision[];
  /** Optional for tolerance of an older gateway (treated as ok/none). */
  proposal_pass?: SclProposalPass;
}

export interface SclModernizationConfirmRow {
  code: string;
  family: string;
  from: string;
  to: string;
  provenance: SclModernizationProvenance;
  usage_count: number;
  example_cites: SclExampleCite[];
}

export interface SclModernizationConfirmPayload {
  target_architecture_id: string | null;
  rows: SclModernizationConfirmRow[];
}

export interface SclModernizationConfirmFailure {
  code: string;
  error: string;
}

export interface SclModernizationConfirmResult {
  confirmed: number;
  failed: SclModernizationConfirmFailure[];
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Structured API error carrying the HTTP status so callers can branch on the
 * MEANINGFUL 404 (no structural scan yet) without string-matching messages.
 */
export class SclModernizationApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SclModernizationApiError';
    this.status = status;
  }
}

async function parseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  let serverMessage = '';
  try {
    const errorBody = (await res.json()) as {
      message?: string;
      error?: string | { message?: string };
      offenders?: unknown[];
    };
    const nested =
      typeof errorBody.error === 'object' && errorBody.error
        ? errorBody.error.message
        : typeof errorBody.error === 'string'
          ? errorBody.error
          : '';
    serverMessage = errorBody.message || nested || '';
    if (serverMessage && Array.isArray(errorBody.offenders) && errorBody.offenders.length > 0) {
      serverMessage += ` (offenders: ${errorBody.offenders
        .map((o) => (typeof o === 'string' ? o : JSON.stringify(o)))
        .join(', ')})`;
    }
  } catch {
    // ignore JSON parse failure
  }
  return serverMessage || fallback;
}

// ============================================================================
// Decision-code derivation
// ============================================================================

/**
 * Slug per the wire contract: lowercase, every run of non-alphanumeric
 * characters collapses to a single '-', leading/trailing '-' trimmed.
 *
 * 2026-08-30 (Kiro third bug): each `[]` maps to `-array` BEFORE the general
 * collapse. The plain collapse TRIMMED a trailing `[]` entirely, so
 * `String` and `String[]` both derived `modernize.types.string` — and the
 * supersede-by-code decisions store silently kept only one of the pair
 * (98 posted, 96 landed; the `String -> java.lang.String` row was lost).
 * With the suffix: `String[]` -> `string-array`, `List<String[]>` ->
 * `list-string-array` — every array/raw pair stays distinct.
 */
export function slugForDecisionCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*\[\s*\]/g, '-array')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The confirm code for a review row: `matched_rule_code` wins when present
 * (non-null, non-blank); otherwise `modernize.<family>.<slug-of-from>`.
 * The family is slugged too (a no-op for well-formed family tokens like
 * `dates`) so a derived code is always a legal decision code.
 */
export function deriveDecisionCode(
  family: string,
  from: string,
  matchedRuleCode: string | null | undefined,
): string {
  if (matchedRuleCode != null && matchedRuleCode.trim().length > 0) {
    return matchedRuleCode;
  }
  return `modernize.${slugForDecisionCode(family)}.${slugForDecisionCode(from)}`;
}

/**
 * The plain saved TARGET value out of a persisted modernization decision.
 *
 * The confirm write stores `answer_value` as a JSON envelope
 * (`{"from","to","family","provenance","usage_count","example_cites"}` —
 * gateway `confirmModernizationDecisions`), so re-seeding the table's target
 * inputs from a saved decision must extract `.to`, NOT paste the blob. A
 * non-JSON / non-envelope value returns verbatim (tolerance for plain
 * string decisions).
 */
export function extractSavedTargetValue(answerValue: string): string {
  try {
    const parsed = JSON.parse(answerValue) as unknown;
    if (parsed && typeof parsed === 'object') {
      const to = (parsed as Record<string, unknown>).to;
      if (typeof to === 'string' && to.trim().length > 0) return to;
    }
  } catch {
    // not JSON — fall through to the raw value
  }
  return answerValue;
}

// ============================================================================
// API functions
// ============================================================================

function buildBase(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/scl/modernization`
  );
}

/**
 * GET the modernization review for the scanned architecture. Rejects with an
 * `SclModernizationApiError` whose `status` is 404 when no structural scan
 * exists yet (the panel renders the quiet "run the code scan first" banner).
 */
export async function fetchModernizationReview(
  projectId: string,
  architectureId: string,
): Promise<SclModernizationReview> {
  const res = await fetch(`${buildBase(projectId, architectureId)}/review`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to load modernization review: ${res.status} ${res.statusText}`,
    );
    throw new SclModernizationApiError(msg, res.status);
  }
  return (await res.json()) as SclModernizationReview;
}

/**
 * POST Retry-All (2026-08-30): bypass the per-scan proposal cache, re-run the
 * LLM pass and re-persist on success. Returns the SAME full review shape as
 * the GET (a failed retry replays the surviving cached set, reported via
 * `proposal_pass`), so the panel swaps its state in one shot.
 */
export async function retryModernizationProposals(
  projectId: string,
  architectureId: string,
): Promise<SclModernizationReview> {
  const res = await fetch(
    `${buildBase(projectId, architectureId)}/review/proposals/retry`,
    { method: 'POST', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to retry modernization proposals: ${res.status} ${res.statusText}`,
    );
    throw new SclModernizationApiError(msg, res.status);
  }
  return (await res.json()) as SclModernizationReview;
}

/**
 * POST the confirm-all batch. The body is snake_case verbatim; each row's
 * `code` must already be derived via `deriveDecisionCode`. A 2xx response may
 * still carry per-row `failed` entries (partial accept) — the caller renders
 * those inline; a 400 rejects with the server's `error` (+ offenders).
 */
export async function confirmModernizationDecisions(
  projectId: string,
  architectureId: string,
  payload: SclModernizationConfirmPayload,
): Promise<SclModernizationConfirmResult> {
  const res = await fetch(`${buildBase(projectId, architectureId)}/confirm`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to confirm modernization decisions: ${res.status} ${res.statusText}`,
    );
    throw new SclModernizationApiError(msg, res.status);
  }
  const raw = (await res.json()) as Partial<SclModernizationConfirmResult>;
  return {
    confirmed: typeof raw.confirmed === 'number' ? raw.confirmed : 0,
    failed: Array.isArray(raw.failed) ? raw.failed : [],
  };
}
