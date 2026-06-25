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
 *     DISTINCT "Unmatched / orphan" section). These are fed by the SERVER-side
 *     `GET .../vulnerabilities/rollup` GRAND TOTAL over the latest report
 *     (unpaged, filter-independent) so the counts reflect the whole report --
 *     NOT just the visible page; the client `vulnerabilityRollup.ts` util is the
 *     fail-soft fallback when the server roll-up is unavailable;
 *   - an upload control that POSTs a picked CSV / XLSX / JSON report and
 *     surfaces the ingested / dropped / matched counts on success (the
 *     no-silent-drop guarantee is visible -- the dropped split distinguishes
 *     collapsed duplicates from unparseable rows, with the report's drop notes
 *     surfaced on demand), plus a report-history affordance;
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
import { useActiveArchitectureId, useArchitectureContext } from '../../contexts/ArchitectureContext';
import {
  listVulnerabilities,
  listVulnerabilityReports,
  uploadVulnerabilityReport,
  scanVulnerabilities,
  getVulnerabilityRollup,
  VulnerabilitiesApiError,
  UNMATCHED_GROUP_COORDINATE,
  type VulnerabilityDto,
  type VulnerabilityReportDto,
  type VulnerabilityReportSummaryDto,
  type VulnerabilityRollupDto,
  type VulnerabilityLibraryRollup,
  type VulnerabilityListFilters,
  type EnrichmentAvailabilitySignal,
} from '../../api/vulnerabilitiesApi';
import {
  computeVulnerabilityRollup,
  normalizeSeverityBucket,
  zeroSeverityCounts,
  SEVERITY_LADDER,
  type SeverityBucket,
  type VulnerabilityLibraryGroup,
  type VulnerabilityRollupResult,
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

/** Default page size for the latest-report list (mirrors the findings-list default). */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Page-size choices for the list pager. The AMS list endpoint caps `size` at
 * 500, so the largest choice is 500 -- surfaced as "All (max 500)" so the cap is
 * explicit and we never request more than the server will honour.
 */
const PAGE_SIZE_MAX = 500;
const PAGE_SIZE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: PAGE_SIZE_MAX, label: 'All (max 500)' },
];

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
// Server roll-up adapter (snake_case wire -> the client roll-up shape)
//
// FIX 1 (grand total): the severity roll-up + group-by-library are fed by the
// SERVER `GET .../vulnerabilities/rollup` aggregate, which is computed over the
// WHOLE latest report (unpaged, filter-independent) -- so the counts show the
// grand total (e.g. 88), never the visible page (e.g. 38). The server DTO is
// snake_case (`severity_counts` / `by_library` / `library_id`); this adapter
// maps it onto the same `VulnerabilityRollupResult` shape the client util
// returns, so `<SeverityRollup>` / `<GroupByLibrary>` render either source
// interchangeably. Counts are re-banded through the shared `info..critical`
// ladder + zero-filled so a server bucket outside the ladder can never leak a
// stray key into the strip.
// ============================================================================

/** Re-band a wire `severity_counts` map onto the zero-filled `info..critical` ladder. */
function adaptSeverityCounts(
  counts: Record<string, number> | null | undefined,
): Record<SeverityBucket, number> {
  const out = zeroSeverityCounts();
  if (counts && typeof counts === 'object') {
    for (const [key, value] of Object.entries(counts)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const bucket = normalizeSeverityBucket(key);
      out[bucket] += value;
    }
  }
  return out;
}

/** Adapt one wire library/unmatched roll-up onto the client group shape. */
function adaptLibraryGroup(
  group: VulnerabilityLibraryRollup,
  unmatched: boolean,
): VulnerabilityLibraryGroup {
  return {
    coordinate: group.coordinate,
    libraryId: group.library_id ?? null,
    unmatched,
    total: typeof group.total === 'number' ? group.total : 0,
    severityCounts: adaptSeverityCounts(group.severity_counts),
  };
}

/**
 * The adapted server roll-up: the shared `VulnerabilityRollupResult` PLUS the two
 * all-rows HEADLINE figures (kept separate from the severity roll-up so the strip
 * stays internally consistent -- see {@link adaptServerRollup}).
 */
interface AdaptedServerRollup extends VulnerabilityRollupResult {
  /**
   * All kept finding rows (the "{n} findings" headline). Null when the server
   * omitted `total_findings` (older server) -> the headline is hidden (fail-soft).
   */
  totalFindings: number | null;
  /**
   * Distinct non-null CVEs (the "{n} distinct CVEs" headline). Null when the
   * server omitted `distinct_cves` -> headline hidden (fail-soft).
   */
  distinctCves: number | null;
}

/** Sum a zero-filled `info..critical` map (the unique-unit roll-up TOTAL). */
function sumSeverityCounts(counts: Record<SeverityBucket, number>): number {
  return SEVERITY_LADDER.reduce((sum, bucket) => sum + (counts[bucket] || 0), 0);
}

/**
 * Adapt the server roll-up DTO onto the `VulnerabilityRollupResult` shape so the
 * presentational components consume it exactly like the client util's output.
 * The unmatched group is recognised by its sentinel coordinate when the wire
 * folds it into `by_library`, but normally rides the dedicated `unmatched` slot.
 *
 * MODEL (keep-all-rows): the severity tiles now count UNIQUE (CVE x coordinate)
 * units, so the strip stays internally consistent ONLY if its TOTAL tile equals
 * the SUM of those tiles. We therefore derive `total` from the SUM of
 * `severity_counts` -- NOT from `dto.total` / `total_findings` (the all-rows
 * count), which would make TOTAL != sum-of-buckets and look broken. The all-rows
 * `total_findings` + `distinct_cves` ride the SEPARATE headline figures instead.
 */
function adaptServerRollup(dto: VulnerabilityRollupDto): AdaptedServerRollup {
  const byLibrary: VulnerabilityLibraryGroup[] = [];
  let unmatched: VulnerabilityLibraryGroup | null = dto.unmatched
    ? adaptLibraryGroup(dto.unmatched, true)
    : null;

  for (const group of dto.by_library ?? []) {
    if (group.coordinate === UNMATCHED_GROUP_COORDINATE) {
      // Defensive: if the wire ever folds the orphan group into by_library,
      // keep it as the DISTINCT unmatched section rather than a library row.
      if (!unmatched) unmatched = adaptLibraryGroup(group, true);
      continue;
    }
    byLibrary.push(adaptLibraryGroup(group, false));
  }
  byLibrary.sort((a, b) => a.coordinate.localeCompare(b.coordinate));

  const severityCounts = adaptSeverityCounts(dto.severity_counts);
  const matchedCount = byLibrary.reduce((sum, g) => sum + g.total, 0);
  const unmatchedCount = unmatched ? unmatched.total : 0;
  return {
    // The severity-roll-up TOTAL == the SUM of the (unique-unit) severity tiles,
    // so the strip is self-consistent. (Deliberately NOT `total_findings`.)
    total: sumSeverityCounts(severityCounts),
    severityCounts,
    byLibrary,
    unmatched,
    matchedCount,
    unmatchedCount,
    totalFindings:
      typeof dto.total_findings === 'number'
        ? dto.total_findings
        : typeof dto.total === 'number'
          ? dto.total
          : null,
    distinctCves: typeof dto.distinct_cves === 'number' ? dto.distinct_cves : null,
  };
}

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
// Roll-up headlines (all-rows figures -- SEPARATE from the severity tiles)
//
// MODEL (keep-all-rows): two headline figures sit beside the severity roll-up:
//   - "{total_findings} findings" -- EVERY kept finding row (one per source row),
//   - "{distinct_cves} distinct CVEs" -- distinct non-null CVEs across them.
// These come straight from the SERVER rollup and are DELIBERATELY distinct from
// the severity tiles (which count unique CVE x coordinate units), so a CVE
// across five modules is five findings here but one severity-tile unit. Each is
// fail-soft: a figure the server omitted (null) is simply not rendered.
// ============================================================================

function RollupHeadlines({
  totalFindings,
  distinctCves,
}: {
  totalFindings: number | null;
  distinctCves: number | null;
}): React.ReactElement | null {
  if (totalFindings === null && distinctCves === null) return null;
  return (
    <section className={styles.headlineRow} data-testid="vuln-rollup-headlines">
      {totalFindings !== null && (
        <div className={styles.headlineStat} data-testid="vuln-headline-findings">
          <span className={styles.headlineNumber}>{totalFindings}</span>
          <span className={styles.headlineLabel}>findings</span>
        </div>
      )}
      {distinctCves !== null && (
        <div className={styles.headlineStat} data-testid="vuln-headline-distinct-cves">
          <span className={styles.headlineNumber}>{distinctCves}</span>
          <span className={styles.headlineLabel}>distinct CVEs</span>
        </div>
      )}
    </section>
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
      <p className={styles.rollupCaption} data-testid="vuln-rollup-caption">
        by unique CVE &times; library
      </p>
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

/**
 * Sentinel the gateway column mapping uses for the report's Location column --
 * it maps to a retained location blob rather than a single canonical field. Kept
 * in sync with the gateway parser's `location_blob` sentinel.
 */
const LOCATION_BLOB_SENTINEL = 'location_blob';

/**
 * Friendly label for a mapped canonical field. The `location_blob` sentinel is
 * rendered as a human phrase ("package coordinate (from Location)") rather than
 * the raw sentinel; every other target is shown verbatim so the mapping stays
 * an honest record of how the report was read.
 */
function mappedFieldLabel(target: string): string {
  return target === LOCATION_BLOB_SENTINEL ? 'package coordinate (from Location)' : target;
}

/**
 * The upload-result transparency panel: the verbatim column mapping the gateway
 * used to read this report (source header -> canonical field). Rendered compact
 * in a <details> so the user can confirm HOW each column was interpreted without
 * a layout explosion; the `location_blob` sentinel is relabelled to a friendly
 * "package coordinate (from Location)". Renders nothing when the gateway did not
 * report a mapping (older gateway -- fail-soft).
 */
function ColumnMappingSummary({
  parseStrategy,
  columnMapping,
}: {
  parseStrategy?: string;
  columnMapping?: Record<string, string>;
}): React.ReactElement | null {
  const entries = columnMapping ? Object.entries(columnMapping) : [];
  if (entries.length === 0) return null;
  return (
    <details className={styles.columnMapping} data-testid="vuln-upload-column-mapping">
      <summary className={styles.columnMappingSummary}>
        Columns mapped{parseStrategy ? ` (${parseStrategy})` : ''}
      </summary>
      <ul className={styles.columnMappingList}>
        {entries.map(([source, target]) => (
          <li
            key={source}
            className={styles.columnMappingItem}
            data-testid="vuln-upload-column-mapping-row"
            data-source-header={source}
            data-target-field={target}
          >
            <span className={styles.columnMappingSource}>{source}</span>
            <span className={styles.columnMappingArrow}> &rarr; </span>
            <span className={styles.columnMappingTarget}>{mappedFieldLabel(target)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The dropped-rows summary line (FIX 3 -- drop-reason visibility). The total
 * dropped count is split into its two NON-OVERLAPPING causes carried by the
 * ingest summary:
 *   - `dropped_duplicates`: rows COLLAPSED because an identical CVE+coordinate
 *     was already ingested -- de-duplication, NOT data loss (the surviving row
 *     still represents them);
 *   - `dropped_unparseable`: rows the gateway parser could not read into the
 *     normalized shape.
 * The duplicate portion is deliberately RELABELLED "collapsed (same
 * CVE+coordinate)" with a one-line hint so a large number reads as expected
 * de-dup, not as silently-lost findings. The report's `notes` (the first few
 * drop reasons) are surfaced in a compact <details> line so the user can see
 * WHY rows dropped without a layout explosion.
 */
function DroppedSummary({
  summary,
}: {
  summary: VulnerabilityReportSummaryDto;
}): React.ReactElement {
  const droppedTotal = summary.report?.row_count_dropped ?? 0;
  const collapsed = summary.dropped_duplicates ?? 0;
  const unparseable = summary.dropped_unparseable ?? 0;
  const notes = summary.report?.notes ?? '';
  const hasSplit = collapsed > 0 || unparseable > 0;

  return (
    <span className={styles.summaryStat} data-testid="vuln-upload-dropped">
      Dropped: <strong>{droppedTotal}</strong>
      {hasSplit && (
        <span className={styles.dropSplit} data-testid="vuln-upload-dropped-split">
          {' ('}
          <span data-testid="vuln-upload-dropped-collapsed">
            {collapsed} collapsed (same CVE+coordinate)
          </span>
          {', '}
          <span data-testid="vuln-upload-dropped-unparseable">{unparseable} unparseable</span>
          {')'}
        </span>
      )}
      {hasSplit && (
        <span className={styles.dropHintInline} data-testid="vuln-upload-dropped-hint">
          Collapsed rows are de-duplicated (same CVE + coordinate already
          counted), not lost.
        </span>
      )}
      {notes.trim().length > 0 && (
        <details className={styles.dropNotes} data-testid="vuln-upload-dropped-notes">
          <summary className={styles.dropNotesSummary}>Why were rows dropped?</summary>
          <div className={styles.dropNotesBody}>{notes}</div>
        </details>
      )}
    </span>
  );
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
          <DroppedSummary summary={summary} />
          <span className={styles.summaryStat} data-testid="vuln-upload-matched">
            Matched: <strong>{summary.matched_count ?? 0}</strong>
          </span>
          <span className={styles.summaryStat} data-testid="vuln-upload-unmatched">
            Unmatched: <strong>{summary.unmatched_count ?? 0}</strong>
          </span>
          {/* Upload-result transparency: HOW each source column was read (the
              location_blob sentinel is relabelled to a friendly phrase). */}
          <ColumnMappingSummary
            parseStrategy={summary.parse_strategy}
            columnMapping={summary.column_mapping}
          />
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
 * Resolve the scan note's variant + message (FIX 4 -- "nothing to scan").
 *
 * Three distinct outcomes, branched off the availability signal so the user
 * gets an ACTIONABLE message rather than a confusing "0 findings from 0
 * advisories across 0 queried coordinates":
 *   - available:true WITH queries built -> the plain success roll-up note (kept
 *     verbatim);
 *   - available:true but NOTHING was queried (`queriesBuilt === 0` and nothing
 *     even excluded) -> the scan RAN fine, but there were no discovered
 *     current-state dependencies to query. The prerequisite is missing: tell the
 *     user to run a code/dependency discovery FIRST, then scan -- calm +
 *     non-blocking. This is the empty-SBOM case, NOT an advisory-source outage;
 *   - available:false -> a genuine advisory-source outage (OSV / proxy / TLS
 *     unreachable, malformed response, transport failure). KEEP its existing
 *     reassuring "automated enrichment unavailable" note verbatim.
 *
 * The "nothing to scan" case is distinguished from the outage case by the
 * AVAILABILITY flag (a successful-but-empty scan is `available:true`; an outage
 * is `available:false`) -- not by the queried count alone, since a transport
 * outage also reports zero queries built. The queried-coordinate count then
 * separates the empty-SBOM success from a normal success.
 */
const NOTHING_TO_SCAN_MESSAGE =
  'No current-state dependencies have been discovered for this architecture yet — run a ' +
  'code/dependency discovery first, then scan. The Security view stays usable on any manually ' +
  'uploaded report in the meantime.';

interface ScanNoteView {
  variant: 'available' | 'nothing-to-scan' | 'unavailable';
  testId: string;
  message: string;
  ok: boolean;
}

function resolveScanNote(signal: EnrichmentAvailabilitySignal): ScanNoteView {
  if (signal.available) {
    // A successful scan that queried NOTHING => the empty-SBOM prerequisite
    // case: nothing was discovered to scan. Surface the actionable "run a
    // discovery first" note rather than the bare "0 from 0 across 0" roll-up.
    if (signal.queriesBuilt <= 0 && signal.excluded <= 0) {
      return {
        variant: 'nothing-to-scan',
        testId: 'vuln-scan-nothing-to-scan',
        message: NOTHING_TO_SCAN_MESSAGE,
        ok: true,
      };
    }
    // A normal successful scan with real coordinates queried.
    return {
      variant: 'available',
      testId: 'vuln-scan-note-available',
      message: signal.note,
      ok: true,
    };
  }
  // available:false => a genuine advisory-source outage. Keep the existing
  // reassuring "automated enrichment unavailable" note verbatim (NOT the
  // prerequisite message -- a transport outage also reports zero queries).
  return {
    variant: 'unavailable',
    testId: 'vuln-enrichment-unavailable',
    message: signal.note,
    ok: false,
  };
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

  const note = signal ? resolveScanNote(signal) : null;

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

      {note && (
        <div
          className={`${styles.scanNote} ${note.ok ? styles.scanNoteOk : styles.scanNoteUnavailable}`}
          // Informational -- the unavailable / nothing-to-scan notes are
          // "status", NOT an "alert" (they never halt the workflow). The
          // available note is a plain status too.
          role="status"
          data-testid={note.testId}
          data-available={signal && signal.available ? 'true' : 'false'}
          data-variant={note.variant}
          data-reason={signal?.reason ?? ''}
        >
          {note.message}
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
              <td
                className={styles.coordinateCell}
                title={
                  row.location && row.location.trim().length > 0
                    ? `${row.affected_coordinate ?? ''} (${row.location})`.trim()
                    : row.affected_coordinate ?? undefined
                }
              >
                {cell(row.affected_coordinate)}
                {row.location && row.location.trim().length > 0 && (
                  <span className={styles.coordinateLocation} data-testid="vuln-row-location">
                    {row.location}
                  </span>
                )}
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
  // The Security area is architecture-scoped: vulnerabilities are uploaded
  // against, and matched to, ONE architecture's discovered libraries. The
  // active architecture is the DEFAULT, but the binding must be explicit +
  // changeable here so findings are never silently attached to the wrong
  // architecture. `setActiveArchitecture` navigates (URL = source of truth),
  // so every architecture-scoped fetch below re-runs against the chosen id.
  const { architectures, setActiveArchitecture } = useArchitectureContext();

  const [rows, setRows] = useState<VulnerabilityDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  // FIX 2: the list page size is now selectable (default 50; max 500 = "All").
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [reports, setReports] = useState<VulnerabilityReportDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // FIX 1: the GRAND-TOTAL roll-up over the whole latest report (server-side,
  // unpaged + filter-independent). Null until the first fetch resolves (or when
  // the fetch failed); the render falls back to the client page roll-up then.
  const [serverRollup, setServerRollup] = useState<AdaptedServerRollup | null>(null);
  // Bumped after a successful upload OR a scan to force a re-fetch of the latest
  // list + report history (the upload/scan replaced the latest report
  // server-side).
  const [reloadToken, setReloadToken] = useState(0);

  const projectId = project?.id ?? null;

  // Build the API filter payload, dropping empty values (the client also omits
  // them, but trimming here keeps the dependency list stable).
  const apiFilters = useMemo<VulnerabilityListFilters>(() => {
    const f: VulnerabilityListFilters = { page, size: pageSize };
    if (filters.severity) f.severity = filters.severity;
    if (filters.match_status) f.match_status = filters.match_status;
    if (filters.source.trim()) f.source = filters.source.trim();
    if (filters.affected_coordinate.trim()) f.affected_coordinate = filters.affected_coordinate.trim();
    if (filters.text.trim()) f.text = filters.text.trim();
    return f;
  }, [filters, page, pageSize]);

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

  // FIX 1: load the server GRAND-TOTAL roll-up over the WHOLE latest report.
  // Keyed on scope + `reloadToken` ONLY -- deliberately NOT on `page` / filters /
  // `pageSize`, so the strip reflects the full report (e.g. 88) regardless of
  // what the table is paging/filtering to (e.g. 38). Fail-soft: on any error the
  // state is left null and the render falls back to the client page roll-up.
  useEffect(() => {
    if (!projectId || !architectureId) {
      setServerRollup(null);
      return;
    }
    let cancelled = false;
    getVulnerabilityRollup(projectId, architectureId)
      .then((dto) => {
        if (!cancelled) setServerRollup(adaptServerRollup(dto));
      })
      .catch(() => {
        if (!cancelled) setServerRollup(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, reloadToken]);

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

  // FIX 2: changing the page size resets to the first page (the current page
  // index is meaningless against the new page count).
  const handlePageSizeChange = useCallback((next: number) => {
    setPageSize(next);
    setPage(0);
  }, []);

  // FIX 1: the page roll-up (client util over the CURRENT visible rows) is the
  // FAIL-SOFT fallback only. The grand-total `serverRollup` (the whole latest
  // report, unpaged) is preferred so the strip never shows the page count.
  const pageRollup = useMemo(() => computeVulnerabilityRollup(rows), [rows]);
  const rollup = serverRollup ?? pageRollup;

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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={styles.container} data-testid="security-view">
      <div className={styles.header}>
        <h2>Security</h2>
      </div>

      <div className={styles.architectureScope} data-testid="security-architecture-scope">
        <label className={styles.architectureScopeLabel} htmlFor="security-architecture-select">
          Findings apply to architecture
        </label>
        <select
          id="security-architecture-select"
          className={styles.architectureScopeSelect}
          value={architectureId ?? ''}
          onChange={(e) => {
            const next = e.target.value;
            if (next && next !== architectureId) setActiveArchitecture(next);
          }}
          data-testid="security-architecture-select"
        >
          {!architectureId && <option value="">Select an architecture…</option>}
          {(architectures ?? [])
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <span className={styles.architectureScopeHint}>
          Vulnerabilities are uploaded against, and matched to, this architecture&rsquo;s
          discovered libraries — almost always your <strong>Current State</strong>.
        </span>
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

      {serverRollup && (
        <RollupHeadlines
          totalFindings={serverRollup.totalFindings}
          distinctCves={serverRollup.distinctCves}
        />
      )}

      <SeverityRollup severityCounts={rollup.severityCounts} total={rollup.total} />

      <GroupByLibrary byLibrary={rollup.byLibrary} unmatched={rollup.unmatched} />

      <section className={styles.tableSection} data-testid="vuln-report-table-section">
        <div className={styles.tableHeader}>
          <h3 className={styles.sectionTitle}>Vulnerabilities</h3>
          <div className={styles.tableHeaderControls}>
            <label className={styles.pageSizeControl} data-testid="vuln-page-size-control">
              <span className={styles.pageSizeLabel}>Rows per page</span>
              <select
                className={styles.filterSelect}
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                data-testid="vuln-page-size-select"
                aria-label="Rows per page"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={styles.tableCount} data-testid="vuln-total-count">
              {total} total
            </span>
          </div>
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
