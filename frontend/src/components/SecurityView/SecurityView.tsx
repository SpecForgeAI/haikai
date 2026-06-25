/**
 * SecurityView -- the new top-level "Security" tab.
 *
 * Spec: 2026-06-24 Vulnerability store + manual capture + current-state view
 *       (Spec 1 of 6) -- Task Group 5.
 *       2026-06-24 Automated Vulnerability Enrichment (Spec 2 of 6) -- Task
 *       Group 6 LAYERS the minimal enrichment surfaces ONTO this Spec 1 tab:
 *       the "Scan for vulnerabilities" on-demand trigger, the quiet "automated
 *       enrichment unavailable" roll-up note, the per-row source badge, and the
 *       "remaining -- fix version unknown" label for rows with no determinable
 *       fixed-in version.
 *
 * Mounted at the canonical architecture-scoped route
 *   /projects/:projectId/architectures/:architectureId/security
 * (registered in App.tsx; the `security` segment is added to
 * `KNOWN_VIEW_SEGMENTS` so it survives the missing-architecture redirect).
 *
 * Surfaces the current-state vulnerability foundation built in Task Groups
 * 1-4:
 *   - the full report table (one row per `vulnerabilities` record) with the
 *     normalized severity badge (raw value on hover), source badge, and a
 *     matched / unmatched-orphan indicator, wired to the latest-report list
 *     filters (`severity`, `match_status`, `source`, `affected_coordinate`,
 *     `text`) + paging via `vulnerabilitiesApi.ts`;
 *   - the deterministic severity roll-up (per `info..critical` bucket) and the
 *     group-by-library view (collapsed under the matched coordinate, with a
 *     DISTINCT "Unmatched / orphan" section) fed by `vulnerabilityRollup.ts`;
 *   - an upload control that POSTs a picked CSV / XLSX / JSON report and
 *     surfaces the ingested / dropped / matched counts on success (the
 *     no-silent-drop guarantee is visible), plus a report-history affordance;
 *   - (Spec 2) a "Scan for vulnerabilities" trigger that POSTs to the gateway
 *     proxy enrichment route and, on completion, re-pulls the rows + shows the
 *     informational availability note (NEVER a blocking banner -- the view stays
 *     fully usable on the manual/internal rows when automated is unavailable).
 *
 * All counts/grouping are deterministic (no LLM); the LLM-flexible parse lives
 * at the gateway (Task Group 3). Reads tolerate an architecture with no report
 * yet (empty list + zero-filled roll-up).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import {
  listVulnerabilities,
  listVulnerabilityReports,
  uploadVulnerabilityReport,
  scanVulnerabilities,
  VulnerabilitiesApiError,
  type VulnerabilityDto,
  type VulnerabilityReportDto,
  type VulnerabilityReportSummaryDto,
  type VulnerabilityListFilters,
  type EnrichmentAvailabilitySignal,
} from '../../api/vulnerabilitiesApi';
import {
  computeVulnerabilityRollup,
  normalizeSeverityBucket,
  SEVERITY_LADDER,
  type SeverityBucket,
  type VulnerabilityLibraryGroup,
} from '../../utils/vulnerabilityRollup';
import {
  useVulnerabilityReduction,
} from '../targetState/architectConversation/useVulnerabilityReduction';
import {
  buildTargetCveStatusMap,
  targetStatusForCve,
  type ResolvedTargetCveStatus,
  type TargetCoordinateFateInput,
} from '../../api/vulnerabilityReductionApi';
import {
  listTargetArchitectures,
  listDecommissionedInTargetAnnotations,
} from '../../api/targetArchitecturesApi';
import styles from './SecurityView.module.css';

// ============================================================================
// Constants
// ============================================================================

/** Page size for the latest-report list (mirrors the findings-list default). */
const PAGE_SIZE = 50;

/** Accept list for the upload picker (CSV / XLSX / JSON internal SCA report). */
const ACCEPT_ATTR = '.csv,.xlsx,.json';

/**
 * Label shown in the Fixed-in column for a row whose fix version could not be
 * determined (empty/unknown `fixed_in_versions`). Spec 2: surfaced as data,
 * NEVER blank-failed -- "remaining -- fix version unknown".
 */
const FIX_VERSION_UNKNOWN_LABEL = 'remaining — fix version unknown';

/** Human label for each normalized severity bucket. */
const SEVERITY_LABEL: Record<SeverityBucket, string> = {
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/**
 * Severity-badge class per bucket. Mirrors the established `info..critical`
 * palette used by the discovery / drift severity badges so the colour
 * language stays consistent across the product.
 */
const SEVERITY_BADGE_CLASS: Record<SeverityBucket, string> = {
  info: styles.severityInfo,
  low: styles.severityLow,
  medium: styles.severityMedium,
  high: styles.severityHigh,
  critical: styles.severityCritical,
};

// ============================================================================
// Small presentational helpers
// ============================================================================

/**
 * The normalized severity badge. The visible text is the `info..critical`
 * bucket; the verbatim report value is preserved on hover via the native
 * `title` (so the raw value is never lost from the UI).
 */
function SeverityBadge({ row }: { row: VulnerabilityDto }): React.ReactElement {
  const bucket = normalizeSeverityBucket(row.severity);
  const raw = row.severity_raw && row.severity_raw.trim().length > 0 ? row.severity_raw : null;
  const title = raw ? `Raw severity: ${raw}` : `Severity: ${SEVERITY_LABEL[bucket]}`;
  return (
    <span
      className={`${styles.severityBadge} ${SEVERITY_BADGE_CLASS[bucket]}`}
      title={title}
      data-testid="vuln-severity-badge"
      data-severity={bucket}
    >
      {SEVERITY_LABEL[bucket]}
    </span>
  );
}

/** Provenance/source badge (e.g. `internal_report`, `automated`, tool name). */
function SourceBadge({ source }: { source: string }): React.ReactElement {
  const label = source && source.trim().length > 0 ? source : 'unknown';
  const automated = label === 'automated';
  return (
    <span
      className={`${styles.sourceBadge} ${automated ? styles.sourceBadgeAutomated : ''}`}
      title={`Source: ${label}`}
      data-testid="vuln-source-badge"
      data-source={label}
    >
      {label}
    </span>
  );
}

/**
 * Match-status indicator. `matched` reads green with the matched declared
 * (resolved edge) version on hover; anything else is the retained
 * unmatched/orphan flag.
 */
function MatchStatusBadge({ row }: { row: VulnerabilityDto }): React.ReactElement {
  const matched =
    typeof row.match_status === 'string' && row.match_status.trim().toLowerCase() === 'matched';
  const cls = matched ? styles.matchMatched : styles.matchUnmatched;
  const label = matched ? 'Matched' : 'Unmatched / orphan';
  const title = matched
    ? row.matched_declared_version
      ? `Matched (resolved version ${row.matched_declared_version})`
      : 'Matched to a current-state library'
    : 'Coordinate not found in the scanned graph (row retained)';
  return (
    <span
      className={`${styles.matchBadge} ${cls}`}
      title={title}
      data-testid="vuln-match-badge"
      data-match-status={matched ? 'matched' : 'unmatched'}
    >
      {label}
    </span>
  );
}

/** Render a nullable string cell, falling back to an em-dash placeholder. */
function cell(value: string | null | undefined): React.ReactNode {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return <span className={styles.muted}>&mdash;</span>;
}

/** Compose the affected version / range display from the two columns. */
function versionDisplay(row: VulnerabilityDto): string | null {
  if (row.affected_version && row.affected_version.trim().length > 0) {
    return row.affected_version;
  }
  if (row.affected_version_range && row.affected_version_range.trim().length > 0) {
    return row.affected_version_range;
  }
  return null;
}

/**
 * The Fixed-in cell. When `fixed_in_versions` carries versions they are listed;
 * when it is empty/unknown the row shows "remaining -- fix version unknown" (the
 * Spec 2 data label) rather than a blank em-dash -- so a no-known-fix CVE is
 * explicit, never silently empty.
 */
function FixedInCell({ row }: { row: VulnerabilityDto }): React.ReactElement {
  const versions = Array.isArray(row.fixed_in_versions) ? row.fixed_in_versions : [];
  if (versions.length > 0) {
    return <span data-testid="vuln-fixed-in">{versions.join(', ')}</span>;
  }
  return (
    <span className={styles.fixUnknown} data-testid="vuln-fix-unknown">
      {FIX_VERSION_UNKNOWN_LABEL}
    </span>
  );
}

// ============================================================================
// Target-status cell (Spec 4 -- Task Group 7.4)
// ============================================================================

/** Human label + badge class per estimated target status. */
const TARGET_STATUS_LABEL: Record<ResolvedTargetCveStatus['status'], string> = {
  eliminated: 'Eliminated',
  remaining: 'Remaining',
  newly_introduced: 'Newly introduced',
  unknown: '—',
};

const TARGET_STATUS_CLASS: Record<ResolvedTargetCveStatus['status'], string> = {
  eliminated: styles.targetStatusEliminated,
  remaining: styles.targetStatusRemaining,
  newly_introduced: styles.targetStatusNewly,
  unknown: styles.targetStatusUnknown,
};

/**
 * The "target status" column cell (Spec 4 -- Task Group 7.4). Reads the per-CVE
 * status from the ONE shared delta (via the prebuilt status map) -- NEVER
 * re-derived here. Every value is explicitly labelled an ESTIMATE. An un-graded
 * CVE (absent from the delta) renders a plain em-dash, never an assertion.
 */
function TargetStatusCell({ status }: { status: ResolvedTargetCveStatus }): React.ReactElement {
  if (status.status === 'unknown') {
    return (
      <span className={styles.muted} data-testid="vuln-target-status" data-status="unknown">
        &mdash;
      </span>
    );
  }
  const partial =
    status.status === 'remaining' && status.partialProgress && status.partialProgress.total > 1
      ? ` (${status.partialProgress.addressed} of ${status.partialProgress.total} coordinates addressed)`
      : '';
  const reason =
    status.status === 'remaining' && status.remainingReason ? ` — ${status.remainingReason}` : '';
  return (
    <span
      className={`${styles.targetStatusBadge} ${TARGET_STATUS_CLASS[status.status]}`}
      data-testid="vuln-target-status"
      data-status={status.status}
      title={`Estimated target status: ${TARGET_STATUS_LABEL[status.status]}${reason}${partial}`}
    >
      <span className={styles.targetStatusText}>{TARGET_STATUS_LABEL[status.status]}</span>
      {(reason || partial) && (
        <span className={styles.targetStatusDetail}>{reason}{partial}</span>
      )}
      <span className={styles.targetStatusEstimate} data-testid="vuln-target-status-estimate">estimate</span>
    </span>
  );
}

// ============================================================================
// Severity roll-up strip
// ============================================================================

function SeverityRollup({
  severityCounts,
  total,
}: {
  severityCounts: Record<SeverityBucket, number>;
  total: number;
}): React.ReactElement {
  return (
    <section className={styles.rollupSection} data-testid="vuln-severity-rollup">
      <h3 className={styles.sectionTitle}>Severity roll-up</h3>
      <div className={styles.rollupRow}>
        {SEVERITY_LADDER.map((bucket) => (
          <div
            key={bucket}
            className={`${styles.rollupCard} ${SEVERITY_BADGE_CLASS[bucket]}`}
            data-testid={`vuln-rollup-${bucket}`}
            data-count={severityCounts[bucket]}
          >
            <span className={styles.rollupCount}>{severityCounts[bucket]}</span>
            <span className={styles.rollupLabel}>{SEVERITY_LABEL[bucket]}</span>
          </div>
        ))}
        <div className={styles.rollupCardTotal} data-testid="vuln-rollup-total" data-count={total}>
          <span className={styles.rollupCount}>{total}</span>
          <span className={styles.rollupLabel}>Total</span>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Group-by-library
// ============================================================================

function LibraryGroupRow({ group }: { group: VulnerabilityLibraryGroup }): React.ReactElement {
  const heading = group.unmatched ? 'Unmatched / orphan' : group.coordinate;
  return (
    <tr
      className={group.unmatched ? styles.groupRowUnmatched : undefined}
      data-testid={group.unmatched ? 'vuln-group-unmatched' : 'vuln-group-library'}
      data-coordinate={group.coordinate}
    >
      <td className={styles.groupCoordinateCell}>
        {group.unmatched ? (
          <span className={styles.unmatchedHeading}>{heading}</span>
        ) : (
          <span className={styles.coordinate}>{heading}</span>
        )}
      </td>
      <td className={styles.groupTotalCell}>{group.total}</td>
      {SEVERITY_LADDER.map((bucket) => (
        <td key={bucket} className={styles.groupSevCell}>
          {group.severityCounts[bucket] > 0 ? (
            <span className={`${styles.miniBadge} ${SEVERITY_BADGE_CLASS[bucket]}`}>
              {group.severityCounts[bucket]}
            </span>
          ) : (
            <span className={styles.muted}>0</span>
          )}
        </td>
      ))}
    </tr>
  );
}

function GroupByLibrary({
  byLibrary,
  unmatched,
}: {
  byLibrary: VulnerabilityLibraryGroup[];
  unmatched: VulnerabilityLibraryGroup | null;
}): React.ReactElement {
  const hasAny = byLibrary.length > 0 || unmatched !== null;
  return (
    <section className={styles.groupSection} data-testid="vuln-group-by-library">
      <h3 className={styles.sectionTitle}>Group by library</h3>
      {!hasAny ? (
        <div className={styles.emptyMessage}>No vulnerabilities to group.</div>
      ) : (
        <table className={styles.groupTable}>
          <thead>
            <tr>
              <th>Library coordinate</th>
              <th>Total</th>
              {SEVERITY_LADDER.map((bucket) => (
                <th key={bucket}>{SEVERITY_LABEL[bucket]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byLibrary.map((group) => (
              <LibraryGroupRow key={group.coordinate} group={group} />
            ))}
            {/* The unmatched/orphan group is rendered LAST as a distinct
                section row, never folded into the matched coordinates. */}
            {unmatched && <LibraryGroupRow key="__unmatched__" group={unmatched} />}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ============================================================================
// Upload control
// ============================================================================

interface UploadControlProps {
  projectId: string;
  architectureId: string;
  onUploaded: (summary: VulnerabilityReportSummaryDto) => void;
}

function UploadControl({ projectId, architectureId, onUploaded }: UploadControlProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VulnerabilityReportSummaryDto | null>(null);

  const doUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const result = await uploadVulnerabilityReport(projectId, architectureId, file);
        setSummary(result);
        onUploaded(result);
      } catch (err) {
        if (err instanceof VulnerabilitiesApiError) {
          setError(err.body.message ?? err.message);
        } else {
          setError(err instanceof Error ? err.message : 'Upload failed');
        }
      } finally {
        setUploading(false);
      }
    },
    [projectId, architectureId, onUploaded],
  );

  const handlePick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the native input so the same file can be re-picked after upload.
      if (inputRef.current) inputRef.current.value = '';
      if (file) void doUpload(file);
    },
    [doUpload],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void doUpload(file);
    },
    [doUpload],
  );

  return (
    <section className={styles.uploadSection} data-testid="vuln-upload-control">
      <h3 className={styles.sectionTitle}>Upload SCA report</h3>
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        data-testid="vuln-upload-dropzone"
      >
        <p className={styles.dropHint}>
          Drag &amp; drop a CSV, XLSX, or JSON SCA report here, or
        </p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          data-testid="vuln-upload-pick-button"
        >
          {uploading ? 'Uploading…' : 'Choose a file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handlePick}
          disabled={uploading}
          className={styles.fileInput}
          data-testid="vuln-upload-file-input"
        />
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert" data-testid="vuln-upload-error">
          {error}
        </div>
      )}

      {summary && (
        <div className={styles.uploadSummary} data-testid="vuln-upload-summary">
          <span className={styles.summaryStat} data-testid="vuln-upload-ingested">
            Ingested: <strong>{summary.ingested_count ?? 0}</strong>
          </span>
          <span className={styles.summaryStat} data-testid="vuln-upload-dropped">
            Dropped: <strong>{summary.report?.row_count_dropped ?? 0}</strong>
          </span>
          <span className={styles.summaryStat} data-testid="vuln-upload-matched">
            Matched: <strong>{summary.matched_count ?? 0}</strong>
          </span>
          <span className={styles.summaryStat} data-testid="vuln-upload-unmatched">
            Unmatched: <strong>{summary.unmatched_count ?? 0}</strong>
          </span>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Scan-for-vulnerabilities control (Spec 2 -- automated OSV enrichment trigger)
// ============================================================================

interface ScanControlProps {
  projectId: string;
  architectureId: string;
  /** Called after a scan completes (available OR unavailable) to re-pull rows. */
  onScanned: () => void;
}

/**
 * The "Scan for vulnerabilities" on-demand trigger. POSTs to the gateway proxy
 * enrichment route via {@link scanVulnerabilities}; on completion it re-pulls
 * the rows (a successful/refresh scan replace-latest the automated set) and
 * surfaces the INFORMATIONAL availability note via the findings-coverage /
 * Migration Discovery Context roll-up style.
 *
 * STRICTLY NON-BLOCKING: {@link scanVulnerabilities} always resolves (the quiet
 * "automated enrichment unavailable" state is data, never a thrown error), so
 * this control renders an informational note -- NOT a blocking banner -- and the
 * Security view stays fully usable on the manual/internal rows either way.
 */
function ScanControl({ projectId, architectureId, onScanned }: ScanControlProps): React.ReactElement {
  const [scanning, setScanning] = useState(false);
  const [signal, setSignal] = useState<EnrichmentAvailabilitySignal | null>(null);

  const doScan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await scanVulnerabilities(projectId, architectureId, { refresh: true });
      setSignal(result.availability);
    } catch {
      // Defensive only -- scanVulnerabilities never rejects, but if it somehow
      // did we still must NOT break the view: show the quiet unavailable note.
      setSignal({
        available: false,
        reason: 'error',
        note:
          'Automated enrichment unavailable. The Security view continues on the internal report ' +
          'alone; only the automated badged set is absent.',
        queriesBuilt: 0,
        excluded: 0,
        advisoriesFound: 0,
        rowsMinted: 0,
        internalRowsEnriched: 0,
        unknownFixRows: 0,
      });
    } finally {
      setScanning(false);
      // Re-pull regardless of availability: a successful scan replaced the
      // automated rows; an unavailable scan left the manual/internal rows as-is
      // (re-fetching is harmless + keeps the view consistent).
      onScanned();
    }
  }, [projectId, architectureId, onScanned]);

  return (
    <section className={styles.scanSection} data-testid="vuln-scan-control">
      <div className={styles.scanRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void doScan()}
          disabled={scanning}
          data-testid="vuln-scan-button"
        >
          {scanning ? 'Scanning…' : 'Scan for vulnerabilities'}
        </button>
        <span className={styles.scanHint}>
          Pulls known CVEs (and their fixed-in versions) for the scanned dependencies from the
          advisory source. Additive and non-blocking.
        </span>
      </div>

      {signal && (
        <div
          className={`${styles.scanNote} ${signal.available ? styles.scanNoteOk : styles.scanNoteUnavailable}`}
          // Informational -- the unavailable note is "status", NOT an "alert"
          // (it never halts the workflow). The available note is a plain status.
          role="status"
          data-testid={signal.available ? 'vuln-scan-note-available' : 'vuln-enrichment-unavailable'}
          data-available={signal.available ? 'true' : 'false'}
          data-reason={signal.reason ?? ''}
        >
          {signal.note}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// Report history affordance
// ============================================================================

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function ReportHistory({ reports }: { reports: VulnerabilityReportDto[] }): React.ReactElement | null {
  if (reports.length === 0) return null;
  return (
    <section className={styles.historySection} data-testid="vuln-report-history">
      <h3 className={styles.sectionTitle}>Report history</h3>
      <ul className={styles.historyList}>
        {reports.map((report) => (
          <li
            key={report.id}
            className={styles.historyRow}
            data-testid="vuln-report-history-row"
            data-is-latest={report.is_latest ? 'true' : 'false'}
          >
            <span className={styles.historyName}>
              {report.original_filename || report.format || report.source}
            </span>
            {report.is_latest && <span className={styles.latestBadge}>Latest</span>}
            <span className={styles.historyMeta}>
              {report.row_count_ingested ?? 0} ingested
              {typeof report.row_count_dropped === 'number' && report.row_count_dropped > 0
                ? `, ${report.row_count_dropped} dropped`
                : ''}
            </span>
            <span className={styles.historyDate}>{formatTimestamp(report.uploaded_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================================
// Filters bar
// ============================================================================

interface FilterState {
  severity: string;
  match_status: string;
  source: string;
  affected_coordinate: string;
  text: string;
}

const EMPTY_FILTERS: FilterState = {
  severity: '',
  match_status: '',
  source: '',
  affected_coordinate: '',
  text: '',
};

function FiltersBar({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}): React.ReactElement {
  const set = (key: keyof FilterState, value: string): void => {
    onChange({ ...filters, [key]: value });
  };
  return (
    <div className={styles.filtersBar} data-testid="vuln-filters">
      <input
        type="text"
        className={styles.filterText}
        placeholder="Search CVE / title / coordinate…"
        value={filters.text}
        onChange={(e) => set('text', e.target.value)}
        data-testid="vuln-filter-text"
      />
      <select
        className={styles.filterSelect}
        value={filters.severity}
        onChange={(e) => set('severity', e.target.value)}
        data-testid="vuln-filter-severity"
        aria-label="Filter by severity"
      >
        <option value="">All severities</option>
        {SEVERITY_LADDER.map((bucket) => (
          <option key={bucket} value={bucket}>
            {SEVERITY_LABEL[bucket]}
          </option>
        ))}
      </select>
      <select
        className={styles.filterSelect}
        value={filters.match_status}
        onChange={(e) => set('match_status', e.target.value)}
        data-testid="vuln-filter-match-status"
        aria-label="Filter by match status"
      >
        <option value="">All match states</option>
        <option value="matched">Matched</option>
        <option value="unmatched">Unmatched / orphan</option>
      </select>
      <input
        type="text"
        className={styles.filterText}
        placeholder="Source"
        value={filters.source}
        onChange={(e) => set('source', e.target.value)}
        data-testid="vuln-filter-source"
        aria-label="Filter by source"
      />
      <input
        type="text"
        className={styles.filterText}
        placeholder="Coordinate"
        value={filters.affected_coordinate}
        onChange={(e) => set('affected_coordinate', e.target.value)}
        data-testid="vuln-filter-coordinate"
        aria-label="Filter by affected coordinate"
      />
    </div>
  );
}

// ============================================================================
// Report table
// ============================================================================

function ReportTable({
  rows,
  showTargetStatus,
  targetStatusMap,
}: {
  rows: VulnerabilityDto[];
  /** Spec 4 (7.4): show the "target status" column ONLY once a target exists. */
  showTargetStatus: boolean;
  /** cveId -> resolved estimated target status (from the ONE shared delta). */
  targetStatusMap: Map<string, ResolvedTargetCveStatus>;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className={styles.emptyMessage} data-testid="vuln-table-empty">
        No vulnerabilities in the latest report. Upload an SCA report to get started.
      </div>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.reportTable} data-testid="vuln-report-table">
        <thead>
          <tr>
            <th>CVE</th>
            <th>Severity</th>
            <th>Title</th>
            <th>Coordinate</th>
            <th>Affected version</th>
            <th>Fixed in</th>
            <th>Source</th>
            <th>Match</th>
            {showTargetStatus && (
              <th data-testid="vuln-target-status-header">Target status</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={styles.dataRow} data-testid="vuln-row" data-vuln-id={row.id}>
              <td className={styles.cveCell}>{cell(row.cve_id)}</td>
              <td>
                <SeverityBadge row={row} />
              </td>
              <td className={styles.titleCell} title={row.title ?? undefined}>
                {cell(row.title)}
              </td>
              <td className={styles.coordinateCell} title={row.affected_coordinate ?? undefined}>
                {cell(row.affected_coordinate)}
              </td>
              <td>{cell(versionDisplay(row))}</td>
              <td className={styles.fixedInCell}>
                <FixedInCell row={row} />
              </td>
              <td>
                <SourceBadge source={row.source} />
              </td>
              <td>
                <MatchStatusBadge row={row} />
              </td>
              {showTargetStatus && (
                <td className={styles.targetStatusCell}>
                  <TargetStatusCell status={targetStatusForCve(targetStatusMap, row.cve_id)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export const SecurityView: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();

  const [rows, setRows] = useState<VulnerabilityDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [reports, setReports] = useState<VulnerabilityReportDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped after a successful upload OR a scan to force a re-fetch of the latest
  // list + report history (the upload/scan replaced the latest report
  // server-side).
  const [reloadToken, setReloadToken] = useState(0);

  const projectId = project?.id ?? null;

  // Build the API filter payload, dropping empty values (the client also omits
  // them, but trimming here keeps the dependency list stable).
  const apiFilters = useMemo<VulnerabilityListFilters>(() => {
    const f: VulnerabilityListFilters = { page, size: PAGE_SIZE };
    if (filters.severity) f.severity = filters.severity;
    if (filters.match_status) f.match_status = filters.match_status;
    if (filters.source.trim()) f.source = filters.source.trim();
    if (filters.affected_coordinate.trim()) f.affected_coordinate = filters.affected_coordinate.trim();
    if (filters.text.trim()) f.text = filters.text.trim();
    return f;
  }, [filters, page]);

  // Load the latest-report list whenever scope / filters / page / reload change.
  useEffect(() => {
    if (!projectId || !architectureId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listVulnerabilities(projectId, architectureId, apiFilters)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items ?? []);
        setTotal(typeof res.total === 'number' ? res.total : (res.items ?? []).length);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        setLoadError(err instanceof Error ? err.message : 'Failed to load vulnerabilities');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, apiFilters, reloadToken]);

  // Load the report history alongside the list (scope + reload only -- it does
  // not depend on the list filters).
  useEffect(() => {
    if (!projectId || !architectureId) return;
    let cancelled = false;
    listVulnerabilityReports(projectId, architectureId)
      .then((res) => {
        if (!cancelled) setReports(res ?? []);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, reloadToken]);

  const handleUploaded = useCallback(() => {
    // Reset to the first page and re-fetch the latest list + history.
    setPage(0);
    setReloadToken((t) => t + 1);
  }, []);

  // A completed scan (available OR unavailable) re-pulls the rows so the new
  // automated badged set appears; on the unavailable path the re-pull is a
  // harmless no-op (the manual/internal rows are unchanged).
  const handleScanned = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const handleFiltersChange = useCallback((next: FilterState) => {
    setFilters(next);
    setPage(0);
  }, []);

  // Deterministic roll-up + group-by-library over the CURRENT rows (the latest
  // report's items as filtered). No second round-trip; matches the AMS rollup
  // shape exactly (shared ladder + `__unmatched__` sentinel).
  const rollup = useMemo(() => computeVulnerabilityRollup(rows), [rows]);

  // -----------------------------------------------------------------------
  // Spec 4 (2026-06-24-vulnerability-reduction-and-steering) -- Task Group 7.4:
  // the "target status" column. Shown ONLY once a target exists (a delta was
  // computed). Each cell reads the per-CVE status from the ONE shared Task Group
  // 2 delta -- per-surface re-derivation is a DEFECT; the column reuses the same
  // service every other reduction surface reads.
  //
  // Resolution: find the project's ACTIVE target architecture, derive a
  // decommission-fate map from the current->target "decommissioned" annotations
  // (a decommissioned library coordinate ELIMINATES its CVEs by removal), and feed
  // it to the reduction hook keyed on the CURRENT architecture (the vulnerabilities
  // source). The column is hidden until the hook returns a non-null delta. Fully
  // fail-soft: any resolution error simply leaves the column hidden -- the report
  // table is unchanged otherwise (Spec 1 owns its layout).
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [decommissionFates, setDecommissionFates] = useState<Record<string, TargetCoordinateFateInput>>({});

  useEffect(() => {
    if (!projectId || !architectureId) {
      setActiveTargetId(null);
      setDecommissionFates({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const targets = await listTargetArchitectures(projectId);
        if (cancelled) return;
        const active = targets.find((t) => t.draftState === 'active') ?? null;
        setActiveTargetId(active?.id ?? null);
        if (!active) {
          setDecommissionFates({});
          return;
        }
        const annotations = await listDecommissionedInTargetAnnotations(
          projectId,
          architectureId,
          active.id,
        );
        if (cancelled) return;
        const fates: Record<string, TargetCoordinateFateInput> = {};
        for (const ann of annotations) {
          const coordinate = (ann.name ?? '').trim();
          if (coordinate.length === 0) continue;
          const looksLikeCoordinate =
            coordinate.includes(':') || coordinate.includes('/') || coordinate.includes('.');
          if (!looksLikeCoordinate) continue;
          fates[coordinate] = { kind: 'removed', via: 'decommissioned' };
        }
        setDecommissionFates(fates);
      } catch {
        // Fail-soft: no target status column rather than a blocking error.
        if (cancelled) return;
        setActiveTargetId(null);
        setDecommissionFates({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, reloadToken]);

  const hasDecommissionFates = Object.keys(decommissionFates).length > 0;
  const { reduction: targetReduction } = useVulnerabilityReduction({
    projectId: projectId ?? '',
    currentArchitectureId: architectureId,
    targetArchitectureId: activeTargetId,
    targetResolvedDependencies: [],
    extraFateByCoordinate: hasDecommissionFates ? decommissionFates : null,
    recomputeToken: reloadToken,
  });
  const targetDelta = targetReduction?.delta ?? null;
  // The column appears ONLY once a target snapshot produced a delta.
  const showTargetStatus = targetDelta !== null;
  const targetStatusMap = useMemo(
    () => buildTargetCveStatusMap(targetDelta),
    [targetDelta],
  );

  if (!project) {
    return (
      <div className={styles.container} data-testid="security-view">
        <div className={styles.emptyMessage}>Select a project to view security findings.</div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.container} data-testid="security-view">
      <div className={styles.header}>
        <h2>Security</h2>
      </div>

      {architectureId && projectId && (
        <ScanControl
          projectId={projectId}
          architectureId={architectureId}
          onScanned={handleScanned}
        />
      )}

      {architectureId && projectId && (
        <UploadControl
          projectId={projectId}
          architectureId={architectureId}
          onUploaded={handleUploaded}
        />
      )}

      <SeverityRollup severityCounts={rollup.severityCounts} total={rollup.total} />

      <GroupByLibrary byLibrary={rollup.byLibrary} unmatched={rollup.unmatched} />

      <section className={styles.tableSection} data-testid="vuln-report-table-section">
        <div className={styles.tableHeader}>
          <h3 className={styles.sectionTitle}>Vulnerabilities</h3>
          <span className={styles.tableCount} data-testid="vuln-total-count">
            {total} total
          </span>
        </div>
        <FiltersBar filters={filters} onChange={handleFiltersChange} />
        {loadError && (
          <div className={styles.errorBanner} role="alert" data-testid="vuln-load-error">
            {loadError}
          </div>
        )}
        {loading ? (
          <div className={styles.emptyMessage} data-testid="vuln-table-loading">
            Loading…
          </div>
        ) : (
          <ReportTable
            rows={rows}
            showTargetStatus={showTargetStatus}
            targetStatusMap={targetStatusMap}
          />
        )}
        {totalPages > 1 && (
          <div className={styles.pager} data-testid="vuln-pager">
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0}
              data-testid="vuln-pager-prev"
            >
              Previous
            </button>
            <span className={styles.pagerLabel}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              data-testid="vuln-pager-next"
            >
              Next
            </button>
          </div>
        )}
      </section>

      <ReportHistory reports={reports} />
    </div>
  );
};

export default SecurityView;
