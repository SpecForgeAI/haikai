/**
 * DbMigrationPackTranslationsTab
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts —
 * Task Group 5 (Tasks 5.3 object list + coverage chips, 5.4 actions).
 *
 * The fourth section tab on the Schema Migration surface
 * (`DbMigrationPackView` contents / decisions / drift / translations):
 *
 *   - coverage-summary chips for the per-object buckets (drafted / approved /
 *     rewrite-in-app / dropped / failed / needs-manual), fed by the gateway
 *     list response's deterministic coverage summary;
 *   - object list table: object_ref, kind, body size, disposition, pipeline
 *     state, review status, judge confidence, fidelity warning indicators;
 *   - actions (product rule: never individual-only): per-object Translate /
 *     Re-translate / Retry AND bulk Translate-all (the gateway scopes
 *     Translate-all to pending + failed only); per-object outcomes from the
 *     response surface in a notice — no polling-only behaviour;
 *   - per-object disposition control (translate / rewrite-in-app / drop with
 *     REQUIRED reason — the call never fires without one); flipping back to
 *     translate returns the row to pending server-side;
 *   - `needs_manual` rows are terminal: no translate action, excluded from
 *     Translate-all (server-side), reviewer shows the truncated banner only;
 *   - stale `translating` rows (gateway restart mid-run) render as retryable;
 *   - the side-by-side reviewer (`DbMigrationPackTranslationReviewer`) opens
 *     per row beneath the table.
 *
 * Errors parse via the api module's `extractGatewayErrorMessage` pattern
 * (every call throws an `Error` with the parsed gateway message).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listDbMigrationPackTranslations,
  retryDbMigrationPackTranslation,
  reviewDbMigrationPackTranslation,
  setDbMigrationPackTranslationDisposition,
  translateAllDbMigrationPackTranslations,
  translateDbMigrationPackTranslation,
  type DbMigrationPackTranslationCoverageSummary,
  type DbMigrationPackTranslationDisposition,
  type DbMigrationPackTranslationDto,
  type DbMigrationPackTranslationEmission,
  type DbMigrationPackTranslationOutcome,
  type DbMigrationPackTranslationReviewAction,
} from '../../../api/dbMigrationPackApi';
import DbMigrationPackTranslationReviewer from './DbMigrationPackTranslationReviewer';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackTranslationsTabProps {
  projectId: string;
  packId: string;
  /**
   * Invoked after an action whose response reported a CHANGED approved-only
   * emission (approve / un-approve / disposition off an approved row) so the
   * parent can refresh the pack-contents file rows.
   */
  onEmissionChanged?: () => void;
}

function formatBodySize(body: string | null): string {
  if (body === null || body.length === 0) return '—';
  if (body.length < 1024) return `${body.length} B`;
  return `${(body.length / 1024).toFixed(1)} KB`;
}

function pipelineStateBadgeClass(state: string): string {
  switch (state) {
    case 'drafted':
      return styles.badgeTranslated;
    case 'failed':
      return styles.badgeMissing;
    case 'needs_manual':
      return styles.badgeFlagged;
    case 'translating':
      return styles.badgeFlagged;
    default:
      return styles.badge;
  }
}

function reviewStatusBadgeClass(status: string): string {
  switch (status) {
    case 'approved':
      return styles.badgeResolved;
    case 'rejected':
      return styles.badgeMissing;
    case 'needs_rework':
      return styles.badgeFlagged;
    default:
      return styles.badge;
  }
}

/** Human summary of per-object run outcomes (no polling-only behaviour). */
function summarizeOutcomes(outcomes: DbMigrationPackTranslationOutcome[]): string {
  if (outcomes.length === 0) {
    return 'No objects required translation (Translate-all targets pending + failed only).';
  }
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    counts.set(outcome.new_state, (counts.get(outcome.new_state) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([state, n]) => `${n} ${state}`);
  const failures = outcomes
    .filter((o) => o.error)
    .map((o) => `${o.object_ref}: ${o.error}`);
  let text = `Translation run complete — ${parts.join(', ')}.`;
  if (failures.length > 0) {
    text += ` Failures: ${failures.join('; ')}`;
  }
  return text;
}

export const DbMigrationPackTranslationsTab: React.FC<
  DbMigrationPackTranslationsTabProps
> = ({ projectId, packId, onEmissionChanged }) => {
  const [rows, setRows] = useState<DbMigrationPackTranslationDto[]>([]);
  const [coverage, setCoverage] =
    useState<DbMigrationPackTranslationCoverageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Id of the row a translate/retry/disposition/review action is running on, or 'all'. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Rows currently in drop-reason entry mode (id -> draft reason text). */
  const [dropDrafts, setDropDrafts] = useState<Record<string, string>>({});
  /** Row whose side-by-side reviewer is open. */
  const [reviewerId, setReviewerId] = useState<string | null>(null);

  const loadTranslations = useCallback(async () => {
    const result = await listDbMigrationPackTranslations(projectId, packId);
    setRows(result.translations);
    setCoverage(result.coverage);
    return result;
  }, [projectId, packId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await listDbMigrationPackTranslations(projectId, packId);
        if (!cancelled) {
          setRows(result.translations);
          setCoverage(result.coverage);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load translations',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, packId]);

  const reviewerRow = useMemo(
    () => rows.find((r) => r.id === reviewerId) ?? null,
    [rows, reviewerId],
  );

  // --- translate / retry / translate-all -------------------------------------

  const runTranslateAction = useCallback(
    async (
      kind: 'all' | 'translate' | 'retry',
      translationId?: string,
    ) => {
      if (busyId) return;
      setBusyId(kind === 'all' ? 'all' : translationId ?? null);
      setError(null);
      setNotice(null);
      try {
        const result =
          kind === 'all'
            ? await translateAllDbMigrationPackTranslations(projectId, packId)
            : kind === 'translate'
              ? await translateDbMigrationPackTranslation(
                  projectId,
                  packId,
                  translationId!,
                )
              : await retryDbMigrationPackTranslation(
                  projectId,
                  packId,
                  translationId!,
                );
        setNotice(summarizeOutcomes(result.outcomes));
        await loadTranslations();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Translation run failed');
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, packId, loadTranslations],
  );

  // --- disposition -------------------------------------------------------------

  const handleEmission = useCallback(
    (emission: DbMigrationPackTranslationEmission | null) => {
      if (emission) {
        setNotice(
          `Approved-only emission re-ran: ${emission.approved_count} approved ` +
            `translation(s) on the executable path` +
            `${emission.changed ? ' (pack files updated)' : ' (no change)'}.`,
        );
        if (emission.changed) onEmissionChanged?.();
      }
    },
    [onEmissionChanged],
  );

  const applyDisposition = useCallback(
    async (
      translationId: string,
      disposition: DbMigrationPackTranslationDisposition,
      dropReason?: string,
    ) => {
      if (busyId) return;
      setBusyId(translationId);
      setError(null);
      setNotice(null);
      try {
        const result = await setDbMigrationPackTranslationDisposition(
          projectId,
          packId,
          translationId,
          disposition,
          dropReason,
        );
        setDropDrafts((prev) => {
          const next = { ...prev };
          delete next[translationId];
          return next;
        });
        handleEmission(result.emission);
        await loadTranslations();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to set the disposition',
        );
      } finally {
        setBusyId(null);
      }
    },
    [busyId, projectId, packId, loadTranslations, handleEmission],
  );

  const handleDispositionChange = useCallback(
    (row: DbMigrationPackTranslationDto, value: string) => {
      if (value === 'drop') {
        // Drop REQUIRES a reason — open the inline reason entry; the API
        // call only fires from the explicit confirm with a non-empty reason.
        setError(null);
        setDropDrafts((prev) => ({ ...prev, [row.id]: prev[row.id] ?? '' }));
        return;
      }
      setDropDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      if (value !== row.disposition) {
        void applyDisposition(
          row.id,
          value as DbMigrationPackTranslationDisposition,
        );
      }
    },
    [applyDisposition],
  );

  const confirmDrop = useCallback(
    (row: DbMigrationPackTranslationDto) => {
      const reason = (dropDrafts[row.id] ?? '').trim();
      if (!reason) {
        setError(
          `An explicit reason is required to drop ${row.object_ref} — dropped objects always carry one.`,
        );
        return;
      }
      void applyDisposition(row.id, 'drop', reason);
    },
    [dropDrafts, applyDisposition],
  );

  // --- review -------------------------------------------------------------------

  const handleReview = useCallback(
    async (action: DbMigrationPackTranslationReviewAction, notes: string) => {
      if (!reviewerRow || busyId) return;
      setBusyId(reviewerRow.id);
      setError(null);
      setNotice(null);
      try {
        const result = await reviewDbMigrationPackTranslation(
          projectId,
          packId,
          reviewerRow.id,
          action,
          notes,
        );
        setRows((prev) =>
          prev.map((r) => (r.id === result.translation.id ? result.translation : r)),
        );
        handleEmission(result.emission);
        // Re-fetch so the coverage chips track the new review status.
        await loadTranslations().catch(() => {
          /* chips refresh is best-effort; the row itself is already updated */
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The review action failed');
      } finally {
        setBusyId(null);
      }
    },
    [reviewerRow, busyId, projectId, packId, loadTranslations, handleEmission],
  );

  // -------------------------------------------------------------------------------

  if (loading) {
    return (
      <div className={styles.emptyMessage} data-testid="db-pack-translations-loading">
        Loading translations…
      </div>
    );
  }

  return (
    <div className={styles.translationsTab} data-testid="db-pack-translations-tab">
      {/* Coverage-summary chips ------------------------------------------------ */}
      {coverage && (
        <div
          className={styles.coverageChips}
          data-testid="db-pack-translations-coverage"
        >
          <span
            className={`${styles.coverageChip} ${styles.coverageChipTranslated}`}
            data-testid="db-pack-translation-coverage-drafted"
          >
            {coverage.drafted} drafted
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipTranslated}`}
            data-testid="db-pack-translation-coverage-approved"
          >
            {coverage.approved} approved
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipSkipped}`}
            data-testid="db-pack-translation-coverage-rewrite-in-app"
          >
            {coverage.rewrite_in_app} rewrite in app
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipSkipped}`}
            data-testid="db-pack-translation-coverage-dropped"
          >
            {coverage.dropped} dropped
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipFlagged}`}
            data-testid="db-pack-translation-coverage-failed"
          >
            {coverage.failed} failed
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipFlagged}`}
            data-testid="db-pack-translation-coverage-needs-manual"
          >
            {coverage.needs_manual} needs manual
          </span>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} data-testid="db-pack-translations-error">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.noticeBanner} data-testid="db-pack-translations-notice">
          {notice}
        </div>
      )}

      {/* Bulk action (product rule: never individual-only actions). */}
      <div className={styles.actionsBar}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          onClick={() => void runTranslateAction('all')}
          disabled={busyId !== null}
          title="Translates every pending + failed object (drafted, approved, dispositioned-away and needs-manual objects are skipped)"
          data-testid="db-pack-translate-all"
        >
          {busyId === 'all' ? 'Translating…' : 'Translate all'}
        </button>
        <span className={styles.manifestNote}>
          Translate-all processes pending + failed objects only.
        </span>
      </div>

      {/* Object list ------------------------------------------------------------ */}
      {rows.length === 0 ? (
        <div className={styles.emptyMessage} data-testid="db-pack-translations-empty">
          No objects require translation in this pack.
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>Object</th>
                <th>Kind</th>
                <th>Body size</th>
                <th>Disposition</th>
                <th>Pipeline state</th>
                <th>Review status</th>
                <th>Judge confidence</th>
                <th>Fidelity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const inDropEntry = Object.prototype.hasOwnProperty.call(
                  dropDrafts,
                  row.id,
                );
                const confidence = row.judge_verdict_json?.confidence;
                const translatable =
                  row.disposition === 'translate' &&
                  row.pipeline_state !== 'needs_manual';
                return (
                  <tr key={row.id} data-testid={`db-pack-translation-row-${row.id}`}>
                    <td>{row.object_ref}</td>
                    <td>
                      <span className={styles.badge}>{row.kind}</span>
                    </td>
                    <td>{formatBodySize(row.source_body)}</td>
                    <td>
                      <select
                        className={styles.filterSelect}
                        value={inDropEntry ? 'drop' : row.disposition}
                        onChange={(e) => handleDispositionChange(row, e.target.value)}
                        disabled={busyId !== null}
                        data-testid={`db-pack-translation-disposition-${row.id}`}
                      >
                        <option value="translate">translate</option>
                        <option value="rewrite_in_app">rewrite in app</option>
                        <option value="drop">drop</option>
                      </select>
                      {inDropEntry && (
                        <div className={styles.inlineResolve}>
                          <input
                            type="text"
                            className={styles.filterInput}
                            placeholder="Reason (required)"
                            value={dropDrafts[row.id]}
                            onChange={(e) =>
                              setDropDrafts((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                            data-testid={`db-pack-translation-drop-reason-${row.id}`}
                          />
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => confirmDrop(row)}
                            disabled={busyId !== null}
                            data-testid={`db-pack-translation-drop-confirm-${row.id}`}
                          >
                            Drop
                          </button>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              setDropDrafts((prev) => {
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              })
                            }
                            data-testid={`db-pack-translation-drop-cancel-${row.id}`}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {row.disposition === 'drop' && row.drop_reason && (
                        <p className={styles.manifestNote}>{row.drop_reason}</p>
                      )}
                    </td>
                    <td>
                      <span className={pipelineStateBadgeClass(row.pipeline_state)}>
                        {row.pipeline_state === 'translating'
                          ? 'translating (retry if stuck)'
                          : row.pipeline_state}
                      </span>
                    </td>
                    <td>
                      <span className={reviewStatusBadgeClass(row.review_status)}>
                        {row.review_status}
                      </span>
                    </td>
                    <td>
                      {typeof confidence === 'number' ? confidence.toFixed(2) : '—'}
                    </td>
                    <td>
                      {row.truncated === true && (
                        <span
                          className={styles.badgeMissing}
                          title="Body truncated at capture (64KB cap) — needs manual translation"
                        >
                          truncated
                        </span>
                      )}{' '}
                      {row.legacy_redacted === true && (
                        <span
                          className={styles.badgeFlagged}
                          title="Literals collapsed at capture — re-scan recommended"
                        >
                          legacy literals
                        </span>
                      )}
                    </td>
                    <td>
                      <div className={styles.actionsBar}>
                        {translatable && row.pipeline_state === 'pending' && (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              void runTranslateAction('translate', row.id)
                            }
                            disabled={busyId !== null}
                            data-testid={`db-pack-translation-translate-${row.id}`}
                          >
                            {busyId === row.id ? 'Translating…' : 'Translate'}
                          </button>
                        )}
                        {translatable && row.pipeline_state === 'drafted' && (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() =>
                              void runTranslateAction('translate', row.id)
                            }
                            disabled={busyId !== null}
                            title="Re-translate resets the review status to unreviewed with a fresh judge pass"
                            data-testid={`db-pack-translation-translate-${row.id}`}
                          >
                            {busyId === row.id ? 'Translating…' : 'Re-translate'}
                          </button>
                        )}
                        {translatable &&
                          (row.pipeline_state === 'failed' ||
                            row.pipeline_state === 'translating') && (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => void runTranslateAction('retry', row.id)}
                              disabled={busyId !== null}
                              data-testid={`db-pack-translation-retry-${row.id}`}
                            >
                              {busyId === row.id ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => setReviewerId(row.id)}
                          data-testid={`db-pack-translation-review-${row.id}`}
                        >
                          Review
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Side-by-side draft reviewer -------------------------------------------- */}
      {reviewerRow && (
        <DbMigrationPackTranslationReviewer
          key={reviewerRow.id}
          translation={reviewerRow}
          busy={busyId !== null}
          onReview={(action, notes) => void handleReview(action, notes)}
          onClose={() => setReviewerId(null)}
        />
      )}
    </div>
  );
};

export default DbMigrationPackTranslationsTab;
