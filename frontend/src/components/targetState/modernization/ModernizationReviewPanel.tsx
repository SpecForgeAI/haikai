/**
 * ModernizationReviewPanel
 *
 * 2026-08-18 SCL pipeline design — "Intermediate modernization decisions".
 *
 * The two-column old→new modernization decisions review that follows the
 * high-level target-state conversation. Loads the review for the SCANNED
 * architecture on mount and renders:
 *
 *   - loading / quiet no-scan banner (404) / error banner / the table;
 *   - the table grouped by family (group header row = family + row count),
 *     groups AND rows blast-radius sorted (usage_count desc);
 *   - columns: Current (from + usage badge + up to 3 example cites in the
 *     title attr), Target (editable input prefilled with `default_to`,
 *     highlighted while empty), Provenance badge (ruleset default /
 *     LLM proposed [rationale in title] / unmapped → needs a value), Notes;
 *   - the confirmed state: a row whose DERIVED code appears in
 *     `existing_decisions` shows a tick + the persisted answer summary.
 *     Editing a confirmed row stays allowed — re-confirming supersedes
 *     server-side (same posture as the conversation decisions store);
 *   - footer: batch "Confirm all" ONLY (per the design's confirm-all
 *     posture — no per-row confirm), disabled while any target value is
 *     empty (with a missing-row count). On confirm every row is POSTed
 *     (code derived via `deriveDecisionCode`, `to` = the input value);
 *     per-row failures render inline; full success reloads the review.
 *
 * Collapsible: the header toggle collapses the body (staleness-free — the
 * review is loaded on mount regardless so re-expanding is instant).
 *
 * `deps` injection mirrors `DecisionsFileUploadPanel` so tests can shim the
 * api seam without touching global fetch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  confirmModernizationDecisions as defaultConfirmModernizationDecisions,
  deriveDecisionCode,
  fetchModernizationReview as defaultFetchModernizationReview,
  SclModernizationApiError,
  type SclModernizationConfirmRow,
  type SclModernizationReview,
  type SclModernizationReviewRow,
} from '../../../api/sclModernizationApi';
import styles from './ModernizationReviewPanel.module.css';

export interface ModernizationReviewPanelDeps {
  fetchModernizationReview: typeof defaultFetchModernizationReview;
  confirmModernizationDecisions: typeof defaultConfirmModernizationDecisions;
}

export const defaultModernizationReviewPanelDeps: ModernizationReviewPanelDeps = {
  fetchModernizationReview: (projectId, architectureId) =>
    defaultFetchModernizationReview(projectId, architectureId),
  confirmModernizationDecisions: (projectId, architectureId, payload) =>
    defaultConfirmModernizationDecisions(projectId, architectureId, payload),
};

export interface ModernizationReviewPanelProps {
  projectId: string;
  /** The SCANNED architecture id (the review is keyed to the code scan). */
  architectureId: string;
  /** Collapsed/expanded initial state of the collapsible section body. */
  defaultOpen?: boolean;
  deps?: ModernizationReviewPanelDeps;
}

/** Stable per-row key: (family, matcher_key) is unique within a review. */
function rowKey(row: SclModernizationReviewRow): string {
  return `${row.family}::${row.matcher_key}`;
}

function citesTitle(row: SclModernizationReviewRow): string | undefined {
  const cites = (row.example_cites ?? []).slice(0, 3);
  if (cites.length === 0) return undefined;
  return cites.map((c) => `${c.symbol} — ${c.source_path}`).join('\n');
}

const PROVENANCE_LABEL: Record<SclModernizationReviewRow['provenance'], string> = {
  ruleset_default: 'ruleset default',
  llm_proposed: 'LLM proposed',
  unmapped: 'unmapped — needs a value',
};

export function ModernizationReviewPanel({
  projectId,
  architectureId,
  defaultOpen = true,
  deps = defaultModernizationReviewPanelDeps,
}: ModernizationReviewPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [noScan, setNoScan] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [review, setReview] = useState<SclModernizationReview | null>(null);

  /** Per-row target values keyed by `rowKey`, seeded from `default_to`. */
  const [targetValues, setTargetValues] = useState<Record<string, string>>({});
  /** Per-row confirm failures keyed by DERIVED decision code. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  const loadReview = useCallback(async () => {
    setLoading(true);
    setNoScan(false);
    setLoadError(null);
    try {
      const data = await deps.fetchModernizationReview(projectId, architectureId);
      setReview(data);
      // Seed the editable target values from the defaults; a re-load after a
      // confirm re-seeds so the inputs reflect what was just persisted (the
      // gateway echoes confirmed values back as defaults on subsequent GETs;
      // when it does not, the user's typed values are re-derivable from the
      // existing_decisions summaries shown per row).
      const seeded: Record<string, string> = {};
      for (const row of data.rows ?? []) {
        seeded[rowKey(row)] = row.default_to ?? '';
      }
      setTargetValues(seeded);
      setRowErrors({});
    } catch (err) {
      if (err instanceof SclModernizationApiError && err.status === 404) {
        setNoScan(true);
        setReview(null);
      } else {
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load modernization review',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [deps, projectId, architectureId]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  // Grouped + blast-radius sorted view: groups ordered by their total
  // usage_count desc, rows within a group by usage_count desc.
  const groups = useMemo(() => {
    const byFamily = new Map<string, SclModernizationReviewRow[]>();
    for (const row of review?.rows ?? []) {
      const bucket = byFamily.get(row.family);
      if (bucket) bucket.push(row);
      else byFamily.set(row.family, [row]);
    }
    const entries = [...byFamily.entries()].map(([family, rows]) => ({
      family,
      rows: [...rows].sort((a, b) => b.usage_count - a.usage_count),
      totalUsage: rows.reduce((sum, r) => sum + r.usage_count, 0),
    }));
    entries.sort((a, b) => b.totalUsage - a.totalUsage);
    return entries;
  }, [review]);

  const confirmedCodes = useMemo(
    () => new Set((review?.existing_decisions ?? []).map((d) => d.decision_code)),
    [review],
  );

  const summaryByCode = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const d of review?.existing_decisions ?? []) {
      map.set(d.decision_code, d.answer_summary);
    }
    return map;
  }, [review]);

  const allRows = review?.rows ?? [];
  const missingCount = allRows.filter(
    (row) => (targetValues[rowKey(row)] ?? '').trim().length === 0,
  ).length;

  const handleConfirmAll = useCallback(async () => {
    if (!review || missingCount > 0 || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError(null);
    setConfirmSuccess(null);
    setRowErrors({});
    try {
      const rows: SclModernizationConfirmRow[] = review.rows.map((row) => ({
        code: deriveDecisionCode(row.family, row.from, row.matched_rule_code),
        family: row.family,
        from: row.from,
        to: (targetValues[rowKey(row)] ?? '').trim(),
        provenance: row.provenance,
        usage_count: row.usage_count,
        example_cites: row.example_cites,
      }));
      const result = await deps.confirmModernizationDecisions(
        projectId,
        architectureId,
        { target_architecture_id: review.target_architecture_id, rows },
      );
      if (result.failed.length > 0) {
        const errs: Record<string, string> = {};
        for (const f of result.failed) errs[f.code] = f.error;
        setRowErrors(errs);
        setConfirmError(
          `${result.failed.length} row(s) failed to confirm — see the rows below.`,
        );
      } else {
        setConfirmSuccess(
          `Confirmed ${result.confirmed || rows.length} modernization decision(s).`,
        );
        await loadReview();
      }
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : 'Failed to confirm modernization decisions',
      );
    } finally {
      setConfirmBusy(false);
    }
  }, [
    review,
    missingCount,
    confirmBusy,
    targetValues,
    deps,
    projectId,
    architectureId,
    loadReview,
  ]);

  return (
    <section
      className={styles.panel}
      data-testid="modernization-review-panel"
      aria-label="Modernization decisions (from code scan)"
    >
      <div className={styles.headerRow}>
        <h3 className={styles.heading}>Modernization decisions (from code scan)</h3>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="modernization-review-toggle"
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {open && (
        <>
          <p className={styles.subheading}>
            Old → new idiom mappings observed in the code scan, grouped by
            family and sorted by blast radius. Every target is editable;
            confirming persists <code>modernize.*</code> captured decisions.
          </p>

          {loading && (
            <div className={styles.banner} data-testid="modernization-review-loading">
              Loading modernization review…
            </div>
          )}

          {!loading && noScan && (
            <div className={styles.banner} data-testid="modernization-review-no-scan">
              No structural scan yet — run the code scan first
            </div>
          )}

          {!loading && loadError && (
            <div
              className={`${styles.banner} ${styles.bannerError}`}
              role="alert"
              data-testid="modernization-review-error"
            >
              {loadError}
            </div>
          )}

          {!loading && !noScan && !loadError && review && allRows.length === 0 && (
            <div className={styles.banner} data-testid="modernization-review-empty">
              The scan produced no modernization candidates.
            </div>
          )}

          {!loading && !noScan && !loadError && review && allRows.length > 0 && (
            <>
              <table className={styles.table} data-testid="modernization-review-table">
                <thead>
                  <tr>
                    <th>Current</th>
                    <th>Target</th>
                    <th>Provenance</th>
                    <th>Notes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <FamilyGroup
                      key={group.family}
                      family={group.family}
                      rows={group.rows}
                      targetValues={targetValues}
                      onTargetChange={(key, value) => {
                        setTargetValues((prev) => ({ ...prev, [key]: value }));
                        setConfirmSuccess(null);
                      }}
                      confirmedCodes={confirmedCodes}
                      summaryByCode={summaryByCode}
                      rowErrors={rowErrors}
                    />
                  ))}
                </tbody>
              </table>

              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={missingCount > 0 || confirmBusy}
                  onClick={() => void handleConfirmAll()}
                  data-testid="modernization-confirm-all"
                >
                  {confirmBusy ? 'Confirming…' : 'Confirm all'}
                </button>
                {missingCount > 0 && (
                  <span
                    className={styles.missingNote}
                    data-testid="modernization-missing-count"
                  >
                    {missingCount} row{missingCount === 1 ? ' still needs' : 's still need'}{' '}
                    a target value
                  </span>
                )}
              </div>

              {confirmError && (
                <div
                  className={`${styles.banner} ${styles.bannerError}`}
                  role="alert"
                  data-testid="modernization-confirm-error"
                >
                  {confirmError}
                </div>
              )}
              {confirmSuccess && (
                <div
                  className={`${styles.banner} ${styles.bannerSuccess}`}
                  data-testid="modernization-confirm-success"
                >
                  {confirmSuccess}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ============================================================================
// Group + row renderers (kept in-file: the panel is self-contained)
// ============================================================================

function FamilyGroup({
  family,
  rows,
  targetValues,
  onTargetChange,
  confirmedCodes,
  summaryByCode,
  rowErrors,
}: {
  family: string;
  rows: SclModernizationReviewRow[];
  targetValues: Record<string, string>;
  onTargetChange: (key: string, value: string) => void;
  confirmedCodes: Set<string>;
  summaryByCode: Map<string, string | null>;
  rowErrors: Record<string, string>;
}) {
  return (
    <>
      <tr
        className={styles.groupHeaderRow}
        data-testid={`modernization-group-${family}`}
      >
        <td colSpan={5}>
          {family}
          <span className={styles.groupCount}>
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </span>
        </td>
      </tr>
      {rows.map((row) => {
        const key = rowKey(row);
        const code = deriveDecisionCode(row.family, row.from, row.matched_rule_code);
        const value = targetValues[key] ?? '';
        const isEmpty = value.trim().length === 0;
        const isConfirmed = confirmedCodes.has(code);
        const rowError = rowErrors[code];
        const provenanceClass =
          row.provenance === 'llm_proposed'
            ? `${styles.provenanceBadge} ${styles.provenanceLlm}`
            : row.provenance === 'unmapped'
              ? `${styles.provenanceBadge} ${styles.provenanceUnmapped}`
              : styles.provenanceBadge;
        return (
          <tr key={key} data-testid="modernization-row" data-decision-code={code}>
            <td className={styles.fromCell} title={citesTitle(row)}>
              {row.from}
              <span
                className={styles.usageBadge}
                data-testid="modernization-usage-badge"
              >
                {row.usage_count} use{row.usage_count === 1 ? '' : 's'}
              </span>
            </td>
            <td>
              <input
                type="text"
                className={
                  isEmpty
                    ? `${styles.targetInput} ${styles.targetInputEmpty}`
                    : styles.targetInput
                }
                value={value}
                onChange={(e) => onTargetChange(key, e.target.value)}
                aria-label={`Target for ${row.from}`}
                data-testid="modernization-target-input"
              />
              {rowError && (
                <p className={styles.rowError} data-testid="modernization-row-error">
                  {rowError}
                </p>
              )}
            </td>
            <td>
              <span
                className={provenanceClass}
                title={
                  row.provenance === 'llm_proposed'
                    ? row.proposal_rationale
                    : undefined
                }
                data-testid="modernization-provenance-badge"
              >
                {PROVENANCE_LABEL[row.provenance]}
              </span>
            </td>
            <td className={styles.notesCell}>{row.notes ?? ''}</td>
            <td>
              {isConfirmed && (
                <span
                  className={styles.confirmedTick}
                  data-testid="modernization-confirmed-tick"
                >
                  ✓ confirmed
                  {summaryByCode.get(code) ? (
                    <span className={styles.confirmedSummary}>
                      {summaryByCode.get(code)}
                    </span>
                  ) : null}
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
