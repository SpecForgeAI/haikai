/**
 * Vulnerabilities API Client
 *
 * Spec: 2026-06-24 Vulnerability store + manual capture + current-state view
 *       (Spec 1 of 6) -- Task Group 4 (typed frontend client + rollup util).
 *
 * Talks to the gateway, which proxies the AMS `vulnerabilities` surface scoped
 * to a (project, architecture) pair. The gateway router (`vulnerabilities.ts`,
 * Task Group 3) mounts at `/api/v1`, so the routes resolve to:
 *   - POST /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/reports
 *       multipart upload (field `file`; optional `format` / `source`) -> the
 *       gateway parses (LLM-flexible + XLSX-to-rows) and forwards the rows to
 *       the AMS ingest endpoint, piping back the report summary.
 *   - GET  /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities
 *       list the latest report's vulnerabilities (filters + paging).
 *   - GET  /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/reports
 *       report-version history (newest first).
 *   - GET  /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/rollup
 *       severity + group-by-library aggregates over the latest report.
 *
 * Spec 2 (Automated Vulnerability Enrichment, Task Group 6) ADDS one trigger:
 *   - POST /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/scan
 *       the "Scan for vulnerabilities" on-demand trigger. The gateway thin-proxies
 *       it to the discovery-service enrichment endpoint, which runs OSV enrichment
 *       STRICTLY NON-BLOCKING and returns an informational availability signal
 *       (NOT an error) -- `available:false` is the quiet "automated enrichment
 *       unavailable" state, never a blocking failure.
 *
 * Wire format: every `vulnerabilities` field name here is snake_case to match the
 * AMS Jackson `SNAKE_CASE` serialiser EXACTLY (the DTOs carry NO `@CamelCaseWire`).
 * Mirrors the snake_case-typed `apiBehaviourClient.ts` / `discoveryApi.ts` modules.
 * The `/scan` response is the discovery-service's OWN JSON (NOT an AMS DTO), so it
 * is camelCase -- see {@link EnrichmentAvailabilitySignal}.
 *
 * Cross-spec contract (LOCKED): `affected_version`, `affected_version_range`,
 * `fixed_in_versions`, and `matched_declared_version` are consumed by Spec 4 --
 * keep their names + shapes stable.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Gateway base URL from env. Defaults to empty string (same origin) for the
 * Vite dev proxy. Mirrors `discoveryApi.ts` / `apiBehaviourClient.ts`.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Typed error
// ============================================================================

export interface VulnerabilitiesApiErrorBody {
  code?: string | number;
  message?: string;
  details?: string;
  [k: string]: unknown;
}

/**
 * Typed error thrown on a non-2xx response. The upload control branches on
 * `error.status` (e.g. 400 unsupported format, 422 unparseable report, 503 AMS
 * unavailable) to render an inline message; `body.message` carries the
 * gateway/AMS reason verbatim.
 */
export class VulnerabilitiesApiError extends Error {
  readonly status: number;
  readonly body: VulnerabilitiesApiErrorBody;

  constructor(status: number, body: VulnerabilitiesApiErrorBody, message?: string) {
    super(message ?? body.message ?? `Vulnerabilities API error (status ${status})`);
    this.name = 'VulnerabilitiesApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Parse a non-ok response into the typed error body. The gateway wraps failures
 * as `{ error: { code, message, details } }`; AMS may return the envelope
 * directly. Tolerates non-JSON bodies by falling back to the status text so the
 * caller can always render some inline error.
 */
async function parseErrorBody(res: Response): Promise<VulnerabilitiesApiErrorBody> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const wrapped = obj.error;
        if (wrapped && typeof wrapped === 'object') {
          return wrapped as VulnerabilitiesApiErrorBody;
        }
        return obj as VulnerabilitiesApiErrorBody;
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
// DTOs (snake_case — matches the AMS Jackson SNAKE_CASE wire)
// ============================================================================

/** The normalized severity ladder shared with `discovery_findings.severity`. */
export type VulnerabilitySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Coordinate-match status; `unmatched` is the "orphan" flag (row retained). */
export type VulnerabilityMatchStatus = 'matched' | 'unmatched';

/**
 * One `vulnerabilities` row. Mirrors the AMS `VulnerabilityDto` record
 * field-for-field (snake_case wire). Advisory/coordinate columns are nullable
 * because internal SCA reports frequently omit them; `fixed_in_versions` is
 * primarily populated by OSV (Spec 2) and accepted from the report when present.
 *
 * `severity` is the normalized ladder bucket; `severity_raw` preserves the
 * verbatim report value (shown on hover). `raw_row` is the retained verbatim
 * source row for drill-down. `match_status` flags matched vs unmatched/orphan;
 * `matched_library_id` + `matched_declared_version` are set only when matched.
 */
export interface VulnerabilityDto {
  id: string;
  project_id: string;
  architecture_id: string;
  report_id: string;
  ingested_at: string;
  cve_id: string | null;
  cwe: string | null;
  title: string | null;
  details: string | null;
  /** Optional CVSS base score (`cvss?`); JSON number or null on the wire. */
  cvss: number | null;
  severity: VulnerabilitySeverity | string;
  severity_raw: string | null;
  affected_coordinate: string | null;
  ecosystem: string | null;
  affected_version: string | null;
  affected_version_range: string | null;
  fixed_in_versions: string[];
  source: string;
  raw_row: Record<string, unknown> | null;
  match_status: VulnerabilityMatchStatus | string;
  matched_library_id: string | null;
  matched_declared_version: string | null;
  /**
   * Stable per-finding identity from the source report (the verbatim
   * "Vulnerability ID" / finding-id column when present). Distinguishes the
   * same CVE reported against several modules; null when the report omits it.
   */
  source_finding_id: string | null;
  /**
   * The verbatim module/location the finding was reported against (the report's
   * Location column, retained as a blob). Surfaced compactly under the
   * coordinate so per-module findings are distinguishable; null when absent.
   */
  location: string | null;
}

/**
 * A `vulnerability_reports` row (the report-version / upload-history record).
 * Mirrors the AMS `VulnerabilityReportDto`. The counts are nullable (boxed
 * Integer on the wire); `is_latest` is nullable boolean.
 */
export interface VulnerabilityReportDto {
  id: string;
  project_id: string;
  architecture_id: string;
  source: string;
  original_filename: string | null;
  format: string | null;
  uploaded_at: string;
  is_latest: boolean | null;
  row_count_ingested: number | null;
  row_count_dropped: number | null;
  parse_strategy: string | null;
  notes: string | null;
}

/**
 * Response from `POST .../vulnerabilities/reports` -- the ingest result summary
 * with the persisted (latest) report plus per-ingest match statistics so the
 * upload UI can show ingested / dropped / matched / unmatched immediately.
 *
 * `dropped_duplicates` (within-report dedup collapse) + `dropped_unparseable`
 * (gateway-parser drops folded through) sum to the report's `row_count_dropped`
 * -- the no-silent-drop guarantee is visible here. Mirrors the AMS
 * `VulnerabilityReportSummaryDto`.
 */
export interface VulnerabilityReportSummaryDto {
  report: VulnerabilityReportDto;
  rows_received: number | null;
  ingested_count: number | null;
  dropped_duplicates: number | null;
  dropped_unparseable: number | null;
  matched_count: number | null;
  unmatched_count: number | null;
  /**
   * The parse strategy the gateway resolved for this upload (e.g.
   * `column_mapping`). Surfaced alongside the column mapping so the user can see
   * HOW the report was read. Optional -- absent on an older gateway.
   */
  parse_strategy?: string;
  /**
   * The verbatim source-header -> canonical-field map the gateway used (e.g.
   * `{ "CVE": "cve_id", "Vulnerability": "title" }`). The Location column maps
   * to the sentinel `"location_blob"`. Rendered in the upload-result
   * transparency panel; optional (absent on an older gateway).
   */
  column_mapping?: Record<string, string>;
}

/** Pagination envelope for the list endpoint (`items / total / page / size`). */
export interface VulnerabilitySearchResponse {
  items: VulnerabilityDto[];
  total: number;
  page: number;
  size: number;
}

/**
 * One per-library (or unmatched-group) roll-up. `coordinate` is the matched
 * library coordinate, or the sentinel {@link UNMATCHED_GROUP_COORDINATE} for the
 * distinct orphan group. `severity_counts` is a zero-filled `info..critical`
 * map. Mirrors the AMS `VulnerabilityRollupDto.LibraryRollup`.
 */
export interface VulnerabilityLibraryRollup {
  coordinate: string;
  library_id: string | null;
  total: number;
  severity_counts: Record<string, number>;
}

/**
 * Aggregate roll-up over the latest report. `severity_counts` is the overall
 * zero-filled `info..critical` ladder; `by_library` holds one entry per matched
 * coordinate (unmatched rows are NOT folded in); `unmatched` is the distinct
 * orphan group (null when there are no unmatched rows). `report_id` is the
 * resolved latest report (null when none exists yet). Mirrors the AMS
 * `VulnerabilityRollupDto`.
 */
export interface VulnerabilityRollupDto {
  report_id: string | null;
  /**
   * Backward-compat ALIAS of {@link total_findings} (every kept finding row).
   * Retained for callers that predate the headline split; NEW code should read
   * {@link total_findings} for the all-rows headline and derive the severity
   * roll-up TOTAL from the SUM of {@link severity_counts} (unique units).
   */
  total: number;
  /**
   * All kept finding rows in the latest report (one per source row retained --
   * the "keep ALL rows" model). The "{n} findings" headline figure. May be
   * absent on an older server, in which case the headline is omitted (fail-soft).
   */
  total_findings?: number;
  /**
   * Distinct non-null CVEs across the kept rows. The "{n} distinct CVEs"
   * headline figure. Absent on an older server (fail-soft -> headline omitted).
   */
  distinct_cves?: number;
  /**
   * Per-severity ladder counts of UNIQUE (CVE, coordinate) units -- a CVE across
   * five modules counts ONCE; a no-CVE/SAST finding counts once. The severity
   * tiles + their TOTAL are derived from these (the TOTAL tile == the SUM of
   * these buckets), which is internally consistent but DISTINCT from the
   * all-rows {@link total_findings} headline.
   */
  severity_counts: Record<string, number>;
  by_library: VulnerabilityLibraryRollup[];
  unmatched: VulnerabilityLibraryRollup | null;
}

/**
 * Sentinel coordinate the AMS roll-up uses for the unmatched/orphan group. The
 * frontend renders this group under its own "Unmatched / orphan" heading rather
 * than as a library coordinate. Kept in sync with the AMS
 * `VulnerabilityQueryService.UNMATCHED_COORDINATE`.
 */
export const UNMATCHED_GROUP_COORDINATE = '__unmatched__';

// ============================================================================
// Automated enrichment ("Scan for vulnerabilities") trigger DTOs
//
// Spec 2 (Automated Vulnerability Enrichment) -- Task Group 6. These mirror the
// discovery-service `EnrichmentAvailabilitySignal` + the `/vulnerabilities/scan`
// route's response (NOT an AMS DTO), so they are camelCase. The signal is the
// roll-up the Security tab renders via the findings-coverage / Migration
// Discovery Context style -- INFORMATIONAL ONLY: `available:false` is the quiet
// "automated enrichment unavailable" note, never a blocking error.
// ============================================================================

/**
 * The informational availability roll-up from the enrichment trigger. Mirrors
 * the discovery-service `EnrichmentAvailabilitySignal` (camelCase). `available`
 * is `false` for the quiet "automated enrichment unavailable" path (OSV / proxy
 * unreachable, malformed response, etc.) -- the Security view stays fully usable
 * on the manual/internal rows; only the automated badged set is absent.
 */
export interface EnrichmentAvailabilitySignal {
  /** True when the automated badged set was produced (OSV reachable). */
  available: boolean;
  /** Short reason for unavailability (`timeout` | `proxy` | `tls` | ...), else undefined. */
  reason?: string;
  /** A calm, human-readable roll-up note. ALWAYS present (reassuring when unavailable). */
  note: string;
  /** Number of OSV queries built from the SBOM (post-exclusion). */
  queriesBuilt: number;
  /** Number of SBOM entries excluded (logged, never silently dropped). */
  excluded: number;
  /** Number of mapped advisories returned by OSV across all queries. */
  advisoriesFound: number;
  /** Number of `automated` rows minted (post-reconciliation/dedup). */
  rowsMinted: number;
  /** Number of existing internal rows enriched with automated fix versions. */
  internalRowsEnriched: number;
  /** Number of automated rows with NO determinable fix ("remaining -- fix version unknown"). */
  unknownFixRows: number;
}

/**
 * The `POST .../vulnerabilities/scan` response. `status` is the enrichment
 * outcome status (`ok` | `unavailable` | `error`); `availability` is the
 * informational roll-up signal the UI renders. The full `outcome` (counts + log
 * lines) is included for diagnostics but the UI reads `availability`.
 */
export interface ScanVulnerabilitiesResponse {
  status?: string;
  availability: EnrichmentAvailabilitySignal;
  outcome?: Record<string, unknown>;
}

// ============================================================================
// Filters
// ============================================================================

/**
 * Optional filters for the latest-report list. Each maps onto an AMS
 * `@RequestParam`; undefined/empty values are omitted from the querystring.
 * `match_status` / `affected_coordinate` are the snake_case query keys the AMS
 * controller declares.
 */
export interface VulnerabilityListFilters {
  severity?: string;
  match_status?: string;
  source?: string;
  affected_coordinate?: string;
  text?: string;
  page?: number;
  size?: number;
}

// ============================================================================
// Internal helpers
// ============================================================================

function vulnerabilitiesBaseUrl(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/vulnerabilities`
  );
}

/**
 * Build the list querystring from the filter object. Omits undefined / null /
 * empty-string values defensively; numeric `page` / `size` are stringified.
 * Returns '' when no params apply.
 */
function buildListQuery(filters: VulnerabilityListFilters | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  const setStr = (key: string, value: string | undefined): void => {
    if (typeof value === 'string' && value.trim().length > 0) {
      params.set(key, value);
    }
  };
  setStr('severity', filters.severity);
  setStr('match_status', filters.match_status);
  setStr('source', filters.source);
  setStr('affected_coordinate', filters.affected_coordinate);
  setStr('text', filters.text);
  if (typeof filters.page === 'number' && Number.isFinite(filters.page)) {
    params.set('page', String(filters.page));
  }
  if (typeof filters.size === 'number' && Number.isFinite(filters.size)) {
    params.set('size', String(filters.size));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function jsonGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new VulnerabilitiesApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as T;
}

// ============================================================================
// Upload (multipart)
// ============================================================================

/** Optional rider fields accepted by the upload route alongside the file. */
export interface UploadVulnerabilityReportOptions {
  /**
   * Explicit `csv|xlsx|json` hint. Usually unnecessary -- the gateway resolves
   * the format from the filename extension / mimetype when omitted.
   */
  format?: 'csv' | 'xlsx' | 'json';
  /**
   * Provenance label for the report. Defaults to `internal_report` gateway-side
   * when omitted (the manual SCA report is the headline source).
   */
  source?: string;
}

/**
 * Upload one SCA report file (CSV / XLSX / JSON) for ingest. Sends a multipart
 * body whose file field is named `file` (matching the gateway
 * `reportUpload.single('file')` reader); the optional `format` / `source`
 * riders are appended as form fields when provided.
 *
 * The browser sets the multipart `Content-Type` boundary automatically -- DO
 * NOT set a `Content-Type` header here. On success returns the report summary
 * (ingested / dropped / matched counts). On a non-2xx the rejection is a
 * `VulnerabilitiesApiError` whose `status` distinguishes a bad format (400),
 * an unparseable report (422), and an AMS outage (503).
 */
export async function uploadVulnerabilityReport(
  projectId: string,
  architectureId: string,
  file: File,
  options: UploadVulnerabilityReportOptions = {},
): Promise<VulnerabilityReportSummaryDto> {
  const url = `${vulnerabilitiesBaseUrl(projectId, architectureId)}/reports`;

  const formData = new FormData();
  formData.append('file', file);
  if (options.format) {
    formData.append('format', options.format);
  }
  if (typeof options.source === 'string' && options.source.trim().length > 0) {
    formData.append('source', options.source);
  }

  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    throw new VulnerabilitiesApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as VulnerabilityReportSummaryDto;
}

// ============================================================================
// Scan trigger ("Scan for vulnerabilities" -- Spec 2, Task Group 6)
// ============================================================================

/** Options for {@link scanVulnerabilities}. */
export interface ScanVulnerabilitiesOptions {
  /**
   * Re-pull / refresh (default true): a refresh supersedes the prior automated
   * rows (replace-latest by source) while leaving manual/internal rows
   * untouched. Only an explicit `false` opts out of the refresh annotation.
   */
  refresh?: boolean;
}

/**
 * Trigger the on-demand "Scan for vulnerabilities" automated enrichment. POSTs
 * to the gateway proxy `.../vulnerabilities/scan`, which thin-proxies the
 * discovery-service enrichment endpoint.
 *
 * STRICTLY NON-BLOCKING: the discovery-service endpoint ALWAYS returns the
 * informational availability signal (HTTP 200) even when OSV was unreachable --
 * `available:false` is data, not an error. This client therefore resolves with
 * the {@link ScanVulnerabilitiesResponse} for both the available and the quiet
 * "unavailable" paths. A transport-level failure (gateway/discovery-service
 * unreachable, a 5xx, or a malformed body) is normalised into an
 * `available:false` signal too, so the caller NEVER has to treat a scan as a
 * hard failure -- the Security view stays usable on the manual/internal rows.
 */
export async function scanVulnerabilities(
  projectId: string,
  architectureId: string,
  options: ScanVulnerabilitiesOptions = {},
): Promise<ScanVulnerabilitiesResponse> {
  const url = `${vulnerabilitiesBaseUrl(projectId, architectureId)}/scan`;
  const refresh = options.refresh !== false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh }),
    });

    let body: unknown = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }

    // Even a non-2xx from the proxy (e.g. 503 discovery-service down, or the
    // discovery-service's own 500 backstop) carries an availability signal in
    // practice; if it does, surface it. Otherwise synthesise the quiet note.
    const signal = extractAvailability(body);
    if (signal) {
      const obj = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {});
      return {
        status: typeof obj.status === 'string' ? obj.status : res.ok ? 'ok' : 'unavailable',
        availability: signal,
        outcome:
          obj.outcome && typeof obj.outcome === 'object'
            ? (obj.outcome as Record<string, unknown>)
            : undefined,
      };
    }

    // No usable signal in the body -> degrade to the quiet unavailable note.
    return unavailableResponse(
      res.ok
        ? 'malformed'
        : res.status >= 500
          ? 'error'
          : 'unavailable',
    );
  } catch (err) {
    // Transport failure (offline, DNS, gateway down). NON-BLOCKING: surface the
    // quiet "automated enrichment unavailable" note rather than throwing -- the
    // scan trigger must never error the Security view.
    const detail = err instanceof Error ? err.message : String(err);
    return unavailableResponse('unreachable', detail);
  }
}

/**
 * Pull an {@link EnrichmentAvailabilitySignal} out of a `/scan` response body
 * when present + well-shaped (has the boolean `available` + the `note`). Returns
 * null when the body carries no usable signal.
 */
function extractAvailability(body: unknown): EnrichmentAvailabilitySignal | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const raw = obj.availability;
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.available !== 'boolean') return null;
  return {
    available: a.available,
    reason: typeof a.reason === 'string' ? a.reason : undefined,
    note: typeof a.note === 'string' ? a.note : '',
    queriesBuilt: numberOr(a.queriesBuilt, 0),
    excluded: numberOr(a.excluded, 0),
    advisoriesFound: numberOr(a.advisoriesFound, 0),
    rowsMinted: numberOr(a.rowsMinted, 0),
    internalRowsEnriched: numberOr(a.internalRowsEnriched, 0),
    unknownFixRows: numberOr(a.unknownFixRows, 0),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Build the synthetic quiet "automated enrichment unavailable" response. */
function unavailableResponse(reason: string, detail?: string): ScanVulnerabilitiesResponse {
  return {
    status: 'unavailable',
    availability: {
      available: false,
      reason,
      note:
        'Automated enrichment unavailable. The Security view continues on the internal report ' +
        'alone; only the automated badged set is absent. Re-run "Scan for vulnerabilities" once ' +
        'connectivity to the advisory source is restored.' +
        (detail ? ` (${detail})` : ''),
      queriesBuilt: 0,
      excluded: 0,
      advisoriesFound: 0,
      rowsMinted: 0,
      internalRowsEnriched: 0,
      unknownFixRows: 0,
    },
  };
}

// ============================================================================
// Reads
// ============================================================================

/**
 * List the latest report's vulnerabilities (filtered + paged). Returns the
 * `items / total / page / size` envelope; an architecture with no report yet
 * resolves to an empty page rather than throwing.
 */
export async function listVulnerabilities(
  projectId: string,
  architectureId: string,
  filters?: VulnerabilityListFilters,
): Promise<VulnerabilitySearchResponse> {
  const url = vulnerabilitiesBaseUrl(projectId, architectureId) + buildListQuery(filters);
  return jsonGet<VulnerabilitySearchResponse>(url);
}

/**
 * Fetch the full report-version history for an architecture (newest first, all
 * sources). Backs the report-history affordance on the Security tab.
 */
export async function listVulnerabilityReports(
  projectId: string,
  architectureId: string,
): Promise<VulnerabilityReportDto[]> {
  const url = `${vulnerabilitiesBaseUrl(projectId, architectureId)}/reports`;
  return jsonGet<VulnerabilityReportDto[]>(url);
}

/**
 * Fetch the deterministic severity + group-by-library roll-up over the latest
 * report. An architecture with no report yet resolves to a zero-filled empty
 * roll-up rather than throwing.
 */
export async function getVulnerabilityRollup(
  projectId: string,
  architectureId: string,
): Promise<VulnerabilityRollupDto> {
  const url = `${vulnerabilitiesBaseUrl(projectId, architectureId)}/rollup`;
  return jsonGet<VulnerabilityRollupDto>(url);
}
