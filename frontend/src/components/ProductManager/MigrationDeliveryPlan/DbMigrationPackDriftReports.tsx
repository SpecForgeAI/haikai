/**
 * DbMigrationPackDriftReports
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.8 drift report tab + detail drawer).
 *
 * The DB sibling of the API drift report, modeled on
 * `DashboardView/DriftReportTab.tsx` + `DiffFindingDetailDrawer.tsx`:
 *
 *   - run-history list (persisted `db_migration_pack_drift_reports` rows,
 *     append-only — newest first) with per-run summary chips
 *     (match / missing / mismatch counts + informational unexpected count),
 *   - selecting a run renders its per-object classification table
 *     (match | missing | mismatch badges) plus the informational
 *     `unexpected_in_target` section,
 *   - a mismatch row opens a right-side detail drawer with the structured
 *     expected-vs-actual property diff.
 *
 * Read-only: verification runs are triggered from the pack actions bar
 * (credential prompt per invocation); this component only renders history.
 * `refreshKey` re-fetches after the parent completes a verify run.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  listDbMigrationPackDriftReports,
  type DbMigrationPackDriftObjectEntry,
  type DbMigrationPackDriftReportDto,
} from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackDriftReportsProps {
  projectId: string;
  packId: string;
  /** Bump to re-fetch the history (e.g. after a verify run completes). */
  refreshKey?: number;
}

function classificationBadgeClass(classification: string): string {
  switch (classification) {
    case 'match':
      return styles.badgeMatch;
    case 'missing':
      return styles.badgeMissing;
    case 'mismatch':
      return styles.badgeMismatch;
    default:
      return styles.badge;
  }
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

function formatScope(
  scope: { schemas?: string[] | null; tables?: string[] | null } | null,
): string {
  if (!scope || (!scope.schemas?.length && !scope.tables?.length)) {
    return 'full';
  }
  const parts: string[] = [];
  if (scope.schemas?.length) parts.push(`schemas: ${scope.schemas.join(', ')}`);
  if (scope.tables?.length) parts.push(`tables: ${scope.tables.join(', ')}`);
  return parts.join(' · ');
}

export const DbMigrationPackDriftReports: React.FC<
  DbMigrationPackDriftReportsProps
> = ({ projectId, packId, refreshKey = 0 }) => {
  const [reports, setReports] = useState<DbMigrationPackDriftReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [openedEntry, setOpenedEntry] =
    useState<DbMigrationPackDriftObjectEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listDbMigrationPackDriftReports(projectId, packId)
      .then((rows) => {
        if (cancelled) return;
        // Newest first (history is append-only; created_at ascending on wire).
        const ordered = [...rows].sort((a, b) =>
          (b.created_at ?? '').localeCompare(a.created_at ?? ''),
        );
        setReports(ordered);
        setSelectedRunId((prev) =>
          prev && ordered.some((r) => r.id === prev) ? prev : ordered[0]?.id ?? null,
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load drift reports');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, packId, refreshKey]);

  const selectedRun = useMemo(
    () => reports.find((r) => r.id === selectedRunId) ?? null,
    [reports, selectedRunId],
  );

  if (loading) {
    return (
      <div className={styles.emptyMessage} data-testid="db-pack-drift-loading">
        Loading drift reports…
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorBanner} data-testid="db-pack-drift-error">
        {error}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className={styles.emptyMessage} data-testid="db-pack-drift-empty">
        No verification runs yet. Use "Verify schema" to scan the target
        database and append the first drift report.
      </div>
    );
  }

  return (
    <div data-testid="db-pack-drift-reports">
      {/* --- run history list ------------------------------------------- */}
      <table className={styles.dataTable} data-testid="db-pack-drift-history">
        <thead>
          <tr>
            <th>Run</th>
            <th>Scope</th>
            <th>Source</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr
              key={r.id}
              className={`${styles.driftRunRow} ${
                r.id === selectedRunId ? styles.driftRunRowSelected : ''
              }`}
              onClick={() => setSelectedRunId(r.id)}
              data-testid={`db-pack-drift-run-${r.id}`}
            >
              <td>{formatDate(r.created_at)}</td>
              <td>{formatScope(r.scan_scope_json)}</td>
              <td>{r.source}</td>
              <td>
                <span className={styles.driftChips}>
                  <span
                    className={styles.badgeMatch}
                    data-testid={`db-pack-drift-run-${r.id}-match`}
                  >
                    {r.match_count ?? 0} match
                  </span>
                  <span
                    className={styles.badgeMissing}
                    data-testid={`db-pack-drift-run-${r.id}-missing`}
                  >
                    {r.missing_count ?? 0} missing
                  </span>
                  <span
                    className={styles.badgeMismatch}
                    data-testid={`db-pack-drift-run-${r.id}-mismatch`}
                  >
                    {r.mismatch_count ?? 0} mismatch
                  </span>
                  <span className={styles.badgeUnexpected}>
                    {r.report_json?.summary?.unexpected_count ?? 0} unexpected
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* --- selected run: per-object classification table --------------- */}
      {selectedRun?.report_json && (
        <div className={styles.manifestSection} style={{ marginTop: 12 }}>
          <h4 className={styles.manifestSectionTitle}>
            Objects — run {formatDate(selectedRun.created_at)}
          </h4>
          <div className={styles.tableScroll}>
            <table
              className={styles.dataTable}
              data-testid="db-pack-drift-objects-table"
            >
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Object</th>
                  <th>Classification</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.report_json.objects.map((o, idx) => (
                  <tr
                    key={`${o.object_type}-${o.object_ref}-${idx}`}
                    data-testid="db-pack-drift-object-row"
                    data-classification={o.classification}
                  >
                    <td>{o.object_type}</td>
                    <td>{o.object_ref}</td>
                    <td>
                      <span className={classificationBadgeClass(o.classification)}>
                        {o.classification}
                      </span>
                    </td>
                    <td>
                      {o.classification === 'mismatch' &&
                      (o.details?.length ?? 0) > 0 ? (
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => setOpenedEntry(o)}
                          data-testid={`db-pack-drift-view-detail-${o.object_ref}`}
                        >
                          View detail
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* informational unexpected_in_target section ------------------- */}
          {selectedRun.report_json.unexpected_in_target.length > 0 && (
            <div style={{ marginTop: 12 }} data-testid="db-pack-drift-unexpected">
              <h4 className={styles.manifestSectionTitle}>
                Unexpected in target (informational)
              </h4>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Object</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRun.report_json.unexpected_in_target.map((u, idx) => (
                    <tr key={`${u.object_type}-${u.object_ref}-${idx}`}>
                      <td>{u.object_type}</td>
                      <td>{u.object_ref}</td>
                      <td>
                        <span className={styles.badgeUnexpected}>
                          {u.detail ?? 'present in target, not expected'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- expected-vs-actual detail drawer ----------------------------- */}
      {openedEntry && (
        <div className={styles.detailDrawer} data-testid="db-pack-drift-detail-drawer">
          <div className={styles.detailDrawerHeader}>
            <h4 className={styles.detailDrawerTitle}>
              {openedEntry.object_type}: {openedEntry.object_ref}
            </h4>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setOpenedEntry(null)}
              data-testid="db-pack-drift-detail-close"
            >
              Close
            </button>
          </div>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Property</th>
                <th>Expected</th>
                <th>Actual</th>
              </tr>
            </thead>
            <tbody>
              {(openedEntry.details ?? []).map((d, idx) => (
                <tr key={`${d.property}-${idx}`} data-testid="db-pack-drift-detail-row">
                  <td>{d.property}</td>
                  <td>{d.expected ?? '—'}</td>
                  <td>{d.actual ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DbMigrationPackDriftReports;
