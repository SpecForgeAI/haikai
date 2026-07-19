/**
 * Findings Register (Security health dashboard, 2026-07-19, Spec 3 of 3)
 *
 * The flattened detail screen over the structured security store -- rows are
 * FINDINGS (not CVEs), flattened in exactly one place (the AMS register
 * service) with provenance-named columns (severity_reported vs
 * cve_severity_official).
 *
 * Deep-linked from Security Overview clicks with the scope filter applied via
 * URL search params (application_id / match_status / report_id); every filter
 * is user-changeable and drives the table. The endpoint is parameterized on
 * filters AND the column set, so future register configurability is pure UI
 * work -- this v1 screen passes the fixed default column set.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useArchitecture, useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import {
  SecurityRegisterResponse,
  getSecurityRegister,
} from '../../api/securityFindingsApi';
import styles from './FindingsRegister.module.css';

const PAGE_SIZE = 50;

/** Human labels for the register's flattened column vocabulary. */
const COLUMN_LABELS: Record<string, string> = {
  finding_id: 'Finding',
  entity_id: 'Entity id',
  entity_name: 'Entity',
  application_id: 'Application id',
  application_name: 'Application',
  application_component_id: 'Component id',
  application_component_name: 'Component',
  service_name: 'Service',
  service_repo_location: 'Repo',
  linking_value: 'Linking value',
  level: 'Level',
  match_status: 'Match',
  severity_reported: 'Severity (reported)',
  severity_raw: 'Severity (raw)',
  title: 'Title',
  description: 'Description',
  detected_at: 'Detected',
  location: 'Location',
  source_path: 'Source path',
  cvss_vector_reported: 'CVSS vector (reported)',
  source_finding_id: 'Scanner id',
  other_identifiers: 'Other identifiers',
  cve_ids: 'CVEs',
  cwe_ids: 'CWEs',
  cwe_names: 'Weakness',
  cve_summary: 'CVE summary',
  cve_severity_official: 'Severity (official)',
  cve_cvss_score: 'CVSS (official)',
  cve_enrichment_status: 'Enrichment',
};

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low', 'info'];
const MATCH_STATUS_OPTIONS = ['auto', 'manual', 'unmatched'];

export function FindingsRegister() {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const state = useArchitecture();
  const [searchParams, setSearchParams] = useSearchParams();

  const [response, setResponse] = useState<SecurityRegisterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState(searchParams.get('text') ?? '');

  const applications = state.model.metaModel.entities.applications;
  const components = state.model.metaModel.entities.app_components;
  const services = state.model.metaModel.entities.services;

  const applicationId = searchParams.get('application_id') ?? '';
  const applicationComponentId = searchParams.get('application_component_id') ?? '';
  const serviceId = searchParams.get('service_id') ?? '';
  const matchStatus = searchParams.get('match_status') ?? '';
  const severity = searchParams.get('severity') ?? '';
  const text = searchParams.get('text') ?? '';
  const reportId = searchParams.get('report_id') ?? '';
  const page = Math.max(0, Number(searchParams.get('page') ?? '0') || 0);

  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!project?.id || !architectureId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSecurityRegister(project.id, architectureId, {
      reportId: reportId || undefined,
      applicationId: applicationId || undefined,
      applicationComponentId: applicationComponentId || undefined,
      serviceId: serviceId || undefined,
      matchStatus: matchStatus || undefined,
      severity: severity || undefined,
      text: text || undefined,
      page,
      size: PAGE_SIZE,
    })
      .then((result) => {
        if (!cancelled) setResponse(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setResponse(null);
          setError(err instanceof Error ? err.message : 'Failed to load the register');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.id, architectureId, reportId, applicationId, applicationComponentId,
      serviceId, matchStatus, severity, text, page]);

  const totalPages = useMemo(
    () => (response ? Math.max(1, Math.ceil(response.total / PAGE_SIZE)) : 1),
    [response],
  );

  const hasActiveFilter = Boolean(
    applicationId || applicationComponentId || serviceId
    || matchStatus || severity || text || reportId,
  );

  if (!project?.id || !architectureId) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Select a project and architecture first.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Findings Register</h2>
        {reportId && (
          <span className={styles.historicalBadge}>
            historical report
            <button type="button" onClick={() => setFilter('report_id', '')}>
              back to latest
            </button>
          </span>
        )}
      </div>

      <div className={styles.filters}>
        <select
          value={applicationId}
          onChange={(e) => setFilter('application_id', e.target.value)}
          aria-label="Filter by application"
        >
          <option value="">All applications</option>
          {[...applications]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
        </select>
        {components.length > 0 && (
          <select
            value={applicationComponentId}
            onChange={(e) => setFilter('application_component_id', e.target.value)}
            aria-label="Filter by application component"
          >
            <option value="">Any component</option>
            {[...components]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((comp) => (
                <option key={comp.id} value={comp.id}>
                  {comp.name}
                </option>
              ))}
          </select>
        )}
        {services.length > 0 && (
          <select
            value={serviceId}
            onChange={(e) => setFilter('service_id', e.target.value)}
            aria-label="Filter by service"
          >
            <option value="">Any service</option>
            {[...services]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
          </select>
        )}
        <select
          value={matchStatus}
          onChange={(e) => setFilter('match_status', e.target.value)}
          aria-label="Filter by match status"
        >
          <option value="">Any match status</option>
          {MATCH_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => setFilter('severity', e.target.value)}
          aria-label="Filter by severity"
        >
          <option value="">Any severity</option>
          {SEVERITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search title / description / location…"
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter('text', textDraft.trim());
          }}
        />
        {hasActiveFilter && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              setTextDraft('');
              setSearchParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.loading}>Loading…</div>}

      {response && !loading && (
        <>
          <div className={styles.meta}>
            {response.total} finding(s)
            {hasActiveFilter ? ' (filtered)' : ''}
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {response.columns
                    .filter((column) => column !== 'finding_id')
                    .map((column) => (
                      <th key={column}>{COLUMN_LABELS[column] ?? column}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {response.data.map((row, index) => (
                  <tr key={String(row.finding_id ?? index)}>
                    {response.columns
                      .filter((column) => column !== 'finding_id')
                      .map((column) => (
                        <td key={column} className={cellClass(column, row[column])}>
                          {renderCell(row[column])}
                        </td>
                      ))}
                  </tr>
                ))}
                {response.data.length === 0 && (
                  <tr>
                    <td colSpan={response.columns.length} className={styles.empty}>
                      No findings match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className={styles.pager}>
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setFilter('page', String(page - 1))}
              >
                Previous
              </button>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page + 1 >= totalPages}
                onClick={() => setFilter('page', String(page + 1))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  return String(value);
}

function cellClass(column: string, value: unknown): string {
  if (column === 'severity_reported' || column === 'cve_severity_official') {
    const severity = String(value ?? '');
    if (severity === 'critical') return styles.sevCritical;
    if (severity === 'high') return styles.sevHigh;
    if (severity === 'medium') return styles.sevMedium;
    if (severity === 'low') return styles.sevLow;
    if (severity === 'info') return styles.sevInfo;
  }
  if (column === 'match_status' && value === 'unmatched') return styles.matchUnmatched;
  return '';
}
