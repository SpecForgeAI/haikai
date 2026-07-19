/**
 * Security Findings Pipeline
 *
 * Spec: Security health dashboard (2026-07-19, Spec 2 of 3) -- the
 * deterministic gateway half of the upload wizard: per-file parsing of GitLab
 * vulnerability-report exports (CSV / XLSX), column-mapping proposal for the
 * wizard's column matcher, distinct linking-value extraction for the value
 * matcher, and normalization of mapped rows into the AMS ingest wire shape.
 *
 * Design decisions (from the 2026-07-18/19 design conversation):
 *   - Multi-file uploads are the "handy append": each file is parsed
 *     INDEPENDENTLY (its own header row), then the normalized rows are
 *     appended into ONE logical report. Raw bytes are never concatenated.
 *   - Parsing is DETERMINISTIC (no LLM step): the GitLab export format is a
 *     known, documented shape; the proposal below covers its headers, and the
 *     wizard's column matcher lets the user correct anything for other
 *     scanner exports. (Contrast with the migration-workflow
 *     `vulnerabilityReportParser`, whose LLM-flexible parse targets unknown
 *     one-off files.)
 *   - The Ruby-hash `Location` blob is normalized via the battle-tested
 *     `parseGitlabLocationBlob` from the existing parser.
 *   - Multi-value CVE / CWE / identifier cells split on `,` `;` `|`.
 *   - One-fact-one-home: this module only shapes REPORTED data; attribution
 *     (application id / match status) arrives as wizard-confirmed resolutions
 *     and is applied verbatim; world facts are never written here.
 */

import * as XLSX from 'xlsx';
import { parseGitlabLocationBlob } from './vulnerabilityReportParser';

// ============================================================================
// Generic attributes (the wizard's column-matcher vocabulary)
// ============================================================================

export interface SecurityGenericAttribute {
  /** Snake_case attribute name -- matches the AMS ingest row field. */
  name: string;
  /** Human label shown in the column matcher. */
  label: string;
  /** Required attributes are pinned in the matcher and must be mapped. */
  required: boolean;
  /** Default-visible rows in the matcher; the rest sit behind "Add attribute". */
  defaultVisible: boolean;
  /** Multi-value cells (split on , ; |). */
  multiValue?: boolean;
}

export const SECURITY_GENERIC_ATTRIBUTES: SecurityGenericAttribute[] = [
  { name: 'linking_value', label: 'Linking id', required: true, defaultVisible: true },
  { name: 'severity', label: 'Severity', required: true, defaultVisible: true },
  { name: 'cve_ids', label: 'CVE id(s)', required: false, defaultVisible: true, multiValue: true },
  { name: 'cwe_ids', label: 'CWE id(s)', required: false, defaultVisible: true, multiValue: true },
  { name: 'title', label: 'Title', required: false, defaultVisible: true },
  { name: 'description', label: 'Description', required: false, defaultVisible: false },
  { name: 'detected_at', label: 'Detected at', required: false, defaultVisible: true },
  { name: 'location', label: 'Location', required: false, defaultVisible: true },
  { name: 'source_path', label: 'Source path', required: false, defaultVisible: false },
  {
    name: 'cvss_vector_reported',
    label: 'CVSS vector (reported)',
    required: false,
    defaultVisible: false,
  },
  { name: 'source_finding_id', label: 'Scanner finding id', required: false, defaultVisible: true },
  {
    name: 'other_identifiers',
    label: 'Other identifiers',
    required: false,
    defaultVisible: false,
    multiValue: true,
  },
];

/**
 * Known GitLab vulnerability-report export headers -> generic attribute.
 * Keys are lowercased/trimmed. Headers deliberately OUT of the v1 subset
 * (Tool, Scanner Name, Group Name, Activity, Comments, Dismissal Reason,
 * Tracked Context Name, Additional Info) are intentionally absent -- they
 * propose as unmapped and are not captured.
 */
export const GITLAB_HEADER_PROPOSALS: Record<string, string> = {
  'project name': 'linking_value',
  severity: 'severity',
  cve: 'cve_ids',
  cwe: 'cwe_ids',
  vulnerability: 'title',
  details: 'description',
  'detected at': 'detected_at',
  location: 'location',
  'full path': 'source_path',
  'cvss vectors': 'cvss_vector_reported',
  'vulnerability id': 'source_finding_id',
  'other identifiers': 'other_identifiers',
};

// ============================================================================
// Per-file parsing (deterministic, header-based)
// ============================================================================

export interface SecurityParsedFile {
  name: string;
  headers: string[];
  /** One record per data row: header -> trimmed cell text. */
  rows: Record<string, string>[];
}

/**
 * Parse one uploaded file (CSV or XLSX -- SheetJS reads both from a buffer)
 * into header-keyed row records. Empty rows are skipped. Never throws on
 * content; a workbook with no usable sheet yields zero rows.
 */
export function parseSecurityFile(buffer: Buffer, filename: string): SecurityParsedFile {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (matrix.length === 0) continue;
    const headers = (matrix[0] ?? [])
      .map((h) => String(h ?? '').trim())
      .filter((h) => h.length > 0);
    if (headers.length === 0) continue;
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i] ?? [];
      const record: Record<string, string> = {};
      let hasContent = false;
      for (let c = 0; c < headers.length; c++) {
        const text = String(cells[c] ?? '').trim();
        record[headers[c]] = text;
        if (text.length > 0) hasContent = true;
      }
      if (hasContent) rows.push(record);
    }
    return { name: filename, headers, rows };
  }
  return { name: filename, headers: [], rows: [] };
}

/** Propose header -> generic-attribute mapping from the known GitLab shape. */
export function proposeColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const claimed = new Set<string>();
  for (const header of headers) {
    const attribute = GITLAB_HEADER_PROPOSALS[header.trim().toLowerCase()];
    if (attribute && !claimed.has(attribute)) {
      mapping[header] = attribute;
      claimed.add(attribute);
    }
  }
  return mapping;
}

/** Ordered union of every file's headers (first-seen order). */
export function unionHeaders(files: SecurityParsedFile[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const header of file.headers) {
      if (!seen.has(header)) {
        seen.add(header);
        out.push(header);
      }
    }
  }
  return out;
}

/**
 * Distinct values of the linking column across ALL files, with row counts,
 * ordered by first appearance -- the value matcher's left-hand column.
 */
export function distinctLinkingValues(
  files: SecurityParsedFile[],
  linkingHeader: string,
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const row of file.rows) {
      const value = (row[linkingHeader] ?? '').trim();
      if (value.length === 0) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
}

// ============================================================================
// Normalization into the AMS ingest wire shape
// ============================================================================

/** Wizard-confirmed resolution for one distinct linking value. */
export interface LinkingResolution {
  linking_value: string;
  application_id: string | null;
  /** auto | manual | unmatched */
  match_status: string;
}

/** One normalized row on the AMS `IngestSecurityFindingRowDto` wire. */
export interface NormalizedSecurityRow {
  linking_value: string;
  application_id: string | null;
  match_status: string;
  severity_raw: string | null;
  title: string | null;
  description: string | null;
  detected_at: string | null;
  location: string | null;
  source_path: string | null;
  cvss_vector_reported: string | null;
  source_finding_id: string | null;
  other_identifiers: string[];
  cve_ids: string[];
  cwe_ids: string[];
}

export interface NormalizationResult {
  rows: NormalizedSecurityRow[];
  /** Rows dropped here (no linking value); AMS counts them via parser_dropped_count. */
  droppedCount: number;
  notes: string | null;
}

/**
 * Apply the confirmed column mapping + value resolutions to every file's rows,
 * appending into the single logical report. Rows with an empty linking value
 * are counted dropped (no silent drops); values without a resolution entry
 * fall to `unmatched` (kept -- the Not-matched bucket).
 */
export function normalizeSecurityRows(
  files: SecurityParsedFile[],
  columnMapping: Record<string, string>,
  resolutions: LinkingResolution[],
): NormalizationResult {
  const headerFor = new Map<string, string>();
  for (const [header, attribute] of Object.entries(columnMapping)) {
    if (!headerFor.has(attribute)) headerFor.set(attribute, header);
  }
  const linkingHeader = headerFor.get('linking_value');
  if (!linkingHeader) {
    throw new Error('column_mapping must map a linking_value column');
  }
  if (!headerFor.get('severity')) {
    throw new Error('column_mapping must map a severity column');
  }
  const resolutionByValue = new Map<string, LinkingResolution>();
  for (const resolution of resolutions) {
    resolutionByValue.set(resolution.linking_value, resolution);
  }

  const cell = (row: Record<string, string>, attribute: string): string | null => {
    const header = headerFor.get(attribute);
    if (!header) return null;
    const value = (row[header] ?? '').trim();
    return value.length === 0 ? null : value;
  };

  const rows: NormalizedSecurityRow[] = [];
  let droppedCount = 0;
  for (const file of files) {
    for (const raw of file.rows) {
      const linkingValue = (raw[linkingHeader] ?? '').trim();
      if (linkingValue.length === 0) {
        droppedCount++;
        continue;
      }
      const resolution = resolutionByValue.get(linkingValue);
      rows.push({
        linking_value: linkingValue,
        application_id: resolution?.application_id ?? null,
        match_status: resolution?.match_status ?? 'unmatched',
        severity_raw: cell(raw, 'severity'),
        title: cell(raw, 'title'),
        description: cell(raw, 'description'),
        detected_at: normalizeDetectedAt(cell(raw, 'detected_at')),
        location: normalizeLocation(cell(raw, 'location')),
        source_path: cell(raw, 'source_path'),
        cvss_vector_reported: cell(raw, 'cvss_vector_reported'),
        source_finding_id: cell(raw, 'source_finding_id'),
        other_identifiers: splitMultiValue(cell(raw, 'other_identifiers')),
        cve_ids: splitMultiValue(cell(raw, 'cve_ids')),
        cwe_ids: splitMultiValue(cell(raw, 'cwe_ids')),
      });
    }
  }
  const notes =
    droppedCount > 0
      ? `${droppedCount} row(s) dropped at the gateway: empty linking value.`
      : null;
  return { rows, droppedCount, notes };
}

/** Split a multi-value cell on `,` `;` `|`; trim; drop empties; dedupe in order. */
export function splitMultiValue(cellText: string | null): string[] {
  if (!cellText) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of cellText.split(/[,;|]/)) {
    const value = part.trim().replace(/^"|"$/g, '').trim();
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * GitLab exports stamp `Detected At` as `YYYY-MM-DD HH:mm:ss UTC`; also accept
 * plain ISO. Returns an ISO-8601 instant string (AMS `Instant`-parseable) or
 * null when unparseable (the raw file remains the source of truth).
 */
export function normalizeDetectedAt(raw: string | null): string | null {
  if (!raw) return null;
  const gitlabShape = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*UTC$/i.exec(raw);
  const candidate = gitlabShape ? `${gitlabShape[1]}T${gitlabShape[2]}Z` : raw;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Normalize the GitLab Ruby-hash `Location` blob to its file/module coordinate
 * (dependency findings keep `file`; SAST findings keep `file:start_line`).
 * Non-blob values pass through verbatim.
 */
export function normalizeLocation(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = parseGitlabLocationBlob(raw);
  if (parsed && parsed.file) return parsed.file;
  if (parsed && parsed.coordinate) return parsed.coordinate;
  return raw;
}
