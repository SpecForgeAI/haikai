/**
 * Security Findings API client (Security health dashboard, 2026-07-19,
 * Specs 2+3 of 3).
 *
 * The department-level security area's wire client. Two backends, matching the
 * repo convention:
 *   - Upload-wizard endpoints (multi-file parse preview + ingest) go through
 *     the GATEWAY (`/api/v1/...`) -- files and external calls live there.
 *   - Everything else (register, rollup, report history, aliases, prefill)
 *     talks straight to AMS (`/api/model/...`) on its snake_case wire (the
 *     vite catch-all proxies `/api` to AMS unless a gateway rule matches --
 *     see the AMS-direct wire-case convention).
 *
 * All DTO fields are snake_case, mirroring the AMS Jackson SNAKE_CASE global.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wire types
// ============================================================================

export interface SecurityGenericAttribute {
  name: string;
  label: string;
  required: boolean;
  defaultVisible: boolean;
  multiValue?: boolean;
}

export interface SecurityParsePreview {
  files: { name: string; headers: string[]; row_count: number }[];
  total_rows: number;
  headers: string[];
  proposed_mapping: Record<string, string>;
  generic_attributes: SecurityGenericAttribute[];
  linking_column: string | null;
  distinct_linking_values: { value: string; count: number }[];
  sample_rows: Record<string, string>[];
}

export interface SecurityLinkingResolution {
  linking_value: string;
  application_id: string | null;
  match_status: 'auto' | 'manual' | 'unmatched';
}

export interface SecurityIngestSummary {
  report_id: string;
  source: string;
  association_level: string;
  uploaded_at: string;
  original_filenames: string[];
  rows_received: number;
  row_count_ingested: number;
  row_count_dropped: number;
  matched_count: number;
  unmatched_count: number;
  distinct_cves: number;
  distinct_cwes: number;
  cve_stubs_created: number;
  cwe_stubs_created: number;
  notes: string | null;
}

export interface SecurityFindingReport {
  id: string;
  project_id: string;
  architecture_id: string;
  source: string;
  association_level: string;
  original_filenames: string[];
  column_mapping: Record<string, string> | null;
  uploaded_at: string;
  is_latest: boolean;
  row_count_ingested: number | null;
  row_count_dropped: number | null;
  notes: string | null;
}

export interface SecurityLinkingAlias {
  id: string;
  level: string;
  alias_value: string;
  entity_id: string;
  entity_name: string | null;
}

export interface SecurityRegisterResponse {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  size: number;
  columns: string[];
}

export interface SecurityRollupEntry {
  application_id: string;
  application_name: string;
  counts: Record<string, number>;
}

export interface SecurityRollup {
  report_id: string | null;
  uploaded_at: string | null;
  association_level: string | null;
  applications: SecurityRollupEntry[];
  unmatched: Record<string, number>;
  totals: Record<string, number>;
}

export class SecurityFindingsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SecurityFindingsApiError';
    this.status = status;
  }
}

async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? detail;
    } catch {
      // non-JSON error body -- keep statusText
    }
    throw new SecurityFindingsApiError(res.status, detail);
  }
  return res;
}

const amsSecurityBase = (projectId: string, architectureId: string) =>
  `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(
    architectureId,
  )}/security`;

const gatewaySecurityBase = (projectId: string, architectureId: string) =>
  `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(
    projectId,
  )}/architectures/${encodeURIComponent(architectureId)}/security`;

// ============================================================================
// Wizard endpoints (gateway)
// ============================================================================

/** Step-1/3 preview: parse the selected files, propose the mapping, list distinct linking values. */
export async function parseSecurityUpload(
  projectId: string,
  architectureId: string,
  files: File[],
  linkingColumn?: string,
): Promise<SecurityParsePreview> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  if (linkingColumn) form.append('linking_column', linkingColumn);
  const res = await fetch(`${gatewaySecurityBase(projectId, architectureId)}/uploads/parse`, {
    method: 'POST',
    body: form,
  });
  return (await (await ensureOk(res)).json()) as SecurityParsePreview;
}

/** Final ingest: files + confirmed wizard answers -> ONE appended report. */
export async function ingestSecurityUpload(
  projectId: string,
  architectureId: string,
  files: File[],
  columnMapping: Record<string, string>,
  associationLevel: string,
  resolutions: SecurityLinkingResolution[],
): Promise<SecurityIngestSummary> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  form.append('column_mapping', JSON.stringify(columnMapping));
  form.append('association_level', associationLevel);
  form.append('resolutions', JSON.stringify(resolutions));
  const res = await fetch(`${gatewaySecurityBase(projectId, architectureId)}/uploads/ingest`, {
    method: 'POST',
    body: form,
  });
  return (await (await ensureOk(res)).json()) as SecurityIngestSummary;
}

// ============================================================================
// AMS reads + alias teaching
// ============================================================================

/** The wizard's prefill: the project's most recent report (mapping + level). Null when none. */
export async function getSecurityPrefill(
  projectId: string,
): Promise<SecurityFindingReport | null> {
  const res = await fetch(
    `/api/model/projects/${encodeURIComponent(projectId)}/security/reports/latest`,
  );
  if (res.status === 204) return null;
  return (await (await ensureOk(res)).json()) as SecurityFindingReport;
}

export async function listSecurityAliases(
  projectId: string,
  level = 'application',
): Promise<SecurityLinkingAlias[]> {
  const res = await fetch(
    `/api/model/projects/${encodeURIComponent(projectId)}/security/aliases?level=${encodeURIComponent(level)}`,
  );
  return (await (await ensureOk(res)).json()) as SecurityLinkingAlias[];
}

/** Teach confirmed value-matcher pairings (batch upsert). */
export async function upsertSecurityAliases(
  projectId: string,
  level: string,
  aliases: { alias_value: string; entity_id: string; entity_name: string | null }[],
): Promise<SecurityLinkingAlias[]> {
  const res = await fetch(
    `/api/model/projects/${encodeURIComponent(projectId)}/security/aliases`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, aliases }),
    },
  );
  return (await (await ensureOk(res)).json()) as SecurityLinkingAlias[];
}

export async function listSecurityReports(
  projectId: string,
  architectureId: string,
): Promise<SecurityFindingReport[]> {
  const res = await fetch(`${amsSecurityBase(projectId, architectureId)}/reports`);
  return (await (await ensureOk(res)).json()) as SecurityFindingReport[];
}

export interface SecurityRegisterQuery {
  reportId?: string;
  applicationId?: string;
  matchStatus?: string;
  severity?: string;
  text?: string;
  columns?: string[];
  page?: number;
  size?: number;
}

/** The parameterized Findings Register read (filters + column set + paging). */
export async function getSecurityRegister(
  projectId: string,
  architectureId: string,
  query: SecurityRegisterQuery = {},
): Promise<SecurityRegisterResponse> {
  const params = new URLSearchParams();
  if (query.reportId) params.set('report_id', query.reportId);
  if (query.applicationId) params.set('application_id', query.applicationId);
  if (query.matchStatus) params.set('match_status', query.matchStatus);
  if (query.severity) params.set('severity', query.severity);
  if (query.text) params.set('text', query.text);
  if (query.columns && query.columns.length > 0) params.set('columns', query.columns.join(','));
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 50));
  const res = await fetch(
    `${amsSecurityBase(projectId, architectureId)}/register?${params.toString()}`,
  );
  return (await (await ensureOk(res)).json()) as SecurityRegisterResponse;
}

/** The Overview circles: severity counts per application + Not-matched bucket. */
export async function getSecurityRollup(
  projectId: string,
  architectureId: string,
  reportId?: string,
): Promise<SecurityRollup> {
  const params = reportId ? `?report_id=${encodeURIComponent(reportId)}` : '';
  const res = await fetch(`${amsSecurityBase(projectId, architectureId)}/rollup${params}`);
  return (await (await ensureOk(res)).json()) as SecurityRollup;
}
