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
 * 2026-08-30 UX (main-area relocation round): when a load finds EVERY row
 * already confirmed the panel lands in read-only REVIEW mode (targets as
 * text, no Confirm-all); an explicit "Re-open to edit" button returns to
 * editing so values can change and re-save (re-confirm supersedes). Confirmed
 * rows seed their value from the PERSISTED decision, not the ruleset default.
 *
 * 2026-08-30 proposal honesty round: `proposal_pass.status === 'failed'`
 * renders a LOUD error banner with a retry (a failed LLM pass previously
 * looked like dozens of legitimate "needs a value" rows), and a "Retry All"
 * footer button regenerates + re-persists the per-scan proposal cache. A
 * retry failure never blanks the table — the current rows stay put under a
 * dedicated error banner.
 *
 * `deps` injection mirrors `DecisionsFileUploadPanel` so tests can shim the
 * api seam without touching global fetch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  confirmModernizationDecisions as defaultConfirmModernizationDecisions,
  deriveDecisionCode,
  extractSavedTargetValue,
  fetchModernizationReview as defaultFetchModernizationReview,
  retryModernizationProposals as defaultRetryModernizationProposals,
  SclModernizationApiError,
  type SclModernizationConfirmRow,
  type SclModernizationReview,
  type SclModernizationReviewRow,
  type SclProposalPass,
  type SclModernizationProvenance,
} from '../../../api/sclModernizationApi';
import styles from './ModernizationReviewPanel.module.css';

export interface ModernizationReviewPanelDeps {
  fetchModernizationReview: typeof defaultFetchModernizationReview;
  confirmModernizationDecisions: typeof defaultConfirmModernizationDecisions;
  retryModernizationProposals: typeof defaultRetryModernizationProposals;
}

export const defaultModernizationReviewPanelDeps: ModernizationReviewPanelDeps = {
  fetchModernizationReview: (projectId, architectureId) =>
    defaultFetchModernizationReview(projectId, architectureId),
  confirmModernizationDecisions: (projectId, architectureId, payload) =>
    defaultConfirmModernizationDecisions(projectId, architectureId, payload),
  retryModernizationProposals: (projectId, architectureId) =>
    defaultRetryModernizationProposals(projectId, architectureId),
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

const PROVENANCE_LABEL: Record<SclModernizationProvenance, string> = {
  ruleset_default: 'ruleset default',
  llm_proposed: 'LLM proposed',
  llm_proposed_review_advised: 'LLM proposed — user review highly advised',
  user_provided: 'user provided',
  unmapped: 'unmapped — needs a value',
};

/**
 * The provenance a row's value ACTUALLY has right now (2026-09-04): once the
 * operator types or changes the target, it is theirs — the badge, its title
 * and the confirm payload all say 'user_provided' rather than crediting the
 * ruleset or the LLM for a value they did not produce. An untouched value
 * keeps the row's own provenance; an empty input is still 'unmapped'.
 */
function effectiveRowProvenance(
  row: Pick<SclModernizationReviewRow, 'provenance' | 'default_to'>,
  value: string,
): SclModernizationProvenance {
  const trimmed = value.trim();
  if (trimmed.length === 0) return row.provenance === 'unmapped' ? 'unmapped' : row.provenance;
  if (trimmed !== (row.default_to ?? '').trim()) return 'user_provided';
  return row.provenance;
}

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
  /**
   * 2026-08-30 UX: read-only REVIEW mode. Entered whenever a load finds EVERY
   * row already confirmed (a previously saved table — including right after a
   * successful Confirm-all reload); the explicit "Re-open" affordance drops
   * back to editing so the user can change values and re-save (re-confirming
   * supersedes server-side).
   */
  const [reviewMode, setReviewMode] = useState(false);

  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  /** 2026-08-30: the loud proposal-pass outcome + the Retry-All in-flight
   *  state. `proposalPass.status === 'failed'` banners a retry instead of
   *  letting empty rows masquerade as legitimate human work. */
  const [proposalPass, setProposalPass] = useState<SclProposalPass | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  /** Shared ingest for the initial load, the post-confirm reload and a
   *  Retry-All response (all return the same full review shape). */
  const ingestReview = useCallback((data: SclModernizationReview) => {
    setReview(data);
    setProposalPass(data.proposal_pass ?? null);
    // Seed the editable target values. Confirmed rows seed from the
    // PERSISTED decision's `.to` (extractSavedTargetValue unwraps the JSON
    // answer_value envelope) so coming BACK to a saved table shows every
    // saved value in its input — change one of 98 and Confirm all again,
    // instead of facing a wall of empty "needs a value" rows. Unconfirmed
    // rows fall back to the ruleset/LLM default.
    const seeded: Record<string, string> = {};
    const valueByCode = new Map(
      (data.existing_decisions ?? []).map((d) => [
        d.decision_code,
        extractSavedTargetValue(d.answer_value),
      ]),
    );
    for (const row of data.rows ?? []) {
      const code = deriveDecisionCode(row.family, row.from, row.matched_rule_code);
      seeded[rowKey(row)] = valueByCode.get(code) ?? row.default_to ?? '';
    }
    setTargetValues(seeded);
    setRowErrors({});
    // Fully-confirmed review -> land read-only (saved data in review mode);
    // any unconfirmed row keeps the table editable.
    const confirmed = new Set(
      (data.existing_decisions ?? []).map((d) => d.decision_code),
    );
    const rows = data.rows ?? [];
    setReviewMode(
      rows.length > 0 &&
        rows.every((row) =>
          confirmed.has(
            deriveDecisionCode(row.family, row.from, row.matched_rule_code),
          ),
        ),
    );
  }, []);

  const loadReview = useCallback(async () => {
    setLoading(true);
    setNoScan(false);
    setLoadError(null);
    try {
      const data = await deps.fetchModernizationReview(projectId, architectureId);
      ingestReview(data);
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
  }, [deps, projectId, architectureId, ingestReview]);

  /** Retry-All (2026-08-30): regenerate + re-persist the AI proposals, then
   *  swap in the returned review. A retry failure NEVER blanks the table —
   *  it surfaces its own banner and the current rows stay put. */
  const handleRetryProposals = useCallback(async () => {
    setRetryBusy(true);
    setRetryError(null);
    setConfirmSuccess(null);
    try {
      const data = await deps.retryModernizationProposals(projectId, architectureId);
      ingestReview(data);
    } catch (err) {
      setRetryError(
        err instanceof Error ? err.message : 'Failed to retry AI proposals',
      );
    } finally {
      setRetryBusy(false);
    }
  }, [deps, projectId, architectureId, ingestReview]);

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
        provenance: effectiveRowProvenance(row, targetValues[rowKey(row)] ?? ''),
        usage_count: row.usage_count,
        example_cites: row.example_cites,
      }));
      // Collision guard (2026-08-30, Kiro third bug): rows deriving the SAME
      // code silently supersede one another in the decisions store — 98
      // posted, 96 landed, and one of each colliding pair was LOST. Refuse
      // the whole batch loudly, naming every collision.
      const fromsByCode = new Map<string, string[]>();
      for (const row of rows) {
        fromsByCode.set(row.code, [...(fromsByCode.get(row.code) ?? []), row.from]);
      }
      const collisions = [...fromsByCode.entries()].filter(
        ([, froms]) => froms.length > 1,
      );
      if (collisions.length > 0) {
        setConfirmError(
          `Refusing to confirm: ${collisions.length} decision-code collision${collisions.length === 1 ? '' : 's'} ` +
            'would silently overwrite rows — ' +
            collisions
              .map(([code, froms]) => `${code} <- [${froms.join(', ')}]`)
              .join('; '),
        );
        return;
      }
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
        // Report writes AND distinct codes (they match because the collision
        // guard above blocks any batch where they would not).
        setConfirmSuccess(
          `Confirmed ${result.confirmed || rows.length} modernization decision(s) ` +
            `(${fromsByCode.size} distinct codes).`,
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

          {/* 2026-08-30: a FAILED proposal pass is loud — without this, the
              affected rows render as legitimate-looking "needs a value" work
              and the user starts typing dozens of answers by hand. */}
          {!loading && !noScan && !loadError && review && !reviewMode &&
            proposalPass?.status === 'failed' && (
              <div
                className={`${styles.banner} ${styles.bannerError}`}
                role="alert"
                data-testid="modernization-proposals-failed"
              >
                <span>
                  {proposalPass.source === 'cache'
                    ? `AI proposal regeneration failed (${proposalPass.error ?? 'unknown error'}) — showing the previously saved proposals.`
                    : `AI proposals unavailable — ${proposalPass.eligible} row${proposalPass.eligible === 1 ? ' shows' : 's show'} "needs a value" because the proposal pass failed (${proposalPass.error ?? 'unknown error'}). Retry rather than typing them by hand.`}
                </span>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleRetryProposals()}
                  disabled={retryBusy || confirmBusy}
                  data-testid="modernization-proposals-failed-retry"
                >
                  {retryBusy ? 'Retrying…' : 'Retry AI proposals'}
                </button>
              </div>
            )}

          {retryError && (
            <div
              className={`${styles.banner} ${styles.bannerError}`}
              role="alert"
              data-testid="modernization-retry-error"
            >
              {retryError}
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
                      readOnly={reviewMode}
                    />
                  ))}
                </tbody>
              </table>

              <div className={styles.footer}>
                {reviewMode ? (
                  <>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setReviewMode(false)}
                      data-testid="modernization-reopen"
                    >
                      Re-open to edit
                    </button>
                    <span
                      className={styles.reviewModeNote}
                      data-testid="modernization-review-mode-note"
                    >
                      Saved — read-only review. Re-open to change targets and
                      re-save.
                    </span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={missingCount > 0 || confirmBusy || retryBusy}
                      onClick={() => void handleConfirmAll()}
                      data-testid="modernization-confirm-all"
                    >
                      {confirmBusy ? 'Confirming…' : 'Confirm all'}
                    </button>
                    {/* Retry-All (2026-08-30): regenerate the AI proposals
                        for the unmapped rows and re-seed the table. Only
                        offered when the pass had eligible rows. */}
                    {(proposalPass?.eligible ?? 0) > 0 && (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={retryBusy || confirmBusy}
                        onClick={() => void handleRetryProposals()}
                        title="Re-run the AI proposal pass for the unmapped rows and refresh the table (typed-but-unconfirmed values are re-seeded)"
                        data-testid="modernization-retry-all"
                      >
                        {retryBusy ? 'Retrying…' : 'Retry All'}
                      </button>
                    )}
                    {missingCount > 0 && (
                      <span
                        className={styles.missingNote}
                        data-testid="modernization-missing-count"
                      >
                        {missingCount} row{missingCount === 1 ? ' still needs' : 's still need'}{' '}
                        a target value
                      </span>
                    )}
                  </>
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
  readOnly,
}: {
  family: string;
  rows: SclModernizationReviewRow[];
  targetValues: Record<string, string>;
  onTargetChange: (key: string, value: string) => void;
  confirmedCodes: Set<string>;
  summaryByCode: Map<string, string | null>;
  rowErrors: Record<string, string>;
  /** 2026-08-30 review mode: saved values render as text, not inputs. */
  readOnly: boolean;
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
        const provenance = effectiveRowProvenance(row, value);
        const provenanceClass =
          provenance === 'llm_proposed'
            ? `${styles.provenanceBadge} ${styles.provenanceLlm}`
            : provenance === 'llm_proposed_review_advised'
              ? `${styles.provenanceBadge} ${styles.provenanceReviewAdvised}`
              : provenance === 'user_provided'
                ? `${styles.provenanceBadge} ${styles.provenanceUserProvided}`
                : provenance === 'unmapped'
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
              {readOnly ? (
                <span
                  className={styles.targetReadOnly}
                  data-testid="modernization-target-readonly"
                >
                  {value}
                </span>
              ) : (
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
              )}
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
                  provenance === 'llm_proposed' || provenance === 'llm_proposed_review_advised'
                    ? row.proposal_rationale
                    : provenance === 'user_provided'
                      ? 'Value entered or changed by you'
                      : undefined
                }
                data-testid="modernization-provenance-badge"
              >
                {PROVENANCE_LABEL[provenance]}
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
