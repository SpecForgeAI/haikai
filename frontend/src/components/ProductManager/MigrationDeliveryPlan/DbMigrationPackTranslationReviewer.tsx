/**
 * DbMigrationPackTranslationReviewer
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts —
 * Task Group 5 (Task 5.5).
 *
 * Side-by-side draft reviewer built on the `MigrationDeliveryInlineDiff.tsx`
 * precedent: it reuses the exported `computeLineDiff` LCS to ALIGN the two
 * panes — source T-SQL on the left, draft PL/pgSQL on the right — with
 * removed-only lines tinted red on the left and added-only lines tinted
 * green on the right.
 *
 * Alongside the panes:
 *   - the judge verdict + confidence + the construct/concern/severity flags
 *     table (flags INFORM the reviewer, they never gate the actions);
 *   - prominent fidelity warning banners — "body truncated at capture"
 *     (terminal `needs_manual`, NO review possible) and "literals collapsed
 *     at capture — re-scan recommended" (`legacy_redacted`, reviewable but
 *     warned);
 *   - review controls: approve / reject / needs-rework, each with optional
 *     notes (needs-rework notes encouraged); reviewed-at shown after action.
 *
 * There is deliberately NO editing affordance for the draft SQL anywhere —
 * the draft is a starting artifact for the reviewer's IDE (spec rule).
 */

import React, { useMemo, useState } from 'react';
import { computeLineDiff } from '../MigrationDeliveryDashboard/MigrationDeliveryInlineDiff';
import type {
  DbMigrationPackTranslationDto,
  DbMigrationPackTranslationReviewAction,
} from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackTranslationReviewerProps {
  translation: DbMigrationPackTranslationDto;
  busy: boolean;
  onReview: (
    action: DbMigrationPackTranslationReviewAction,
    notes: string,
  ) => void;
  onClose: () => void;
  /**
   * Supply the FULL source body for a truncated capture (2026-08-07): the
   * old terminal "translate it by hand in your IDE" dead-end is gone.
   */
  onSupplyBody?: (sourceBody: string) => void;
}

interface AlignedLine {
  left: string | null;
  right: string | null;
  op: 'equal' | 'added' | 'removed';
}

export const DbMigrationPackTranslationReviewer: React.FC<
  DbMigrationPackTranslationReviewerProps
> = ({ translation, busy, onReview, onClose, onSupplyBody }) => {
  const [notes, setNotes] = useState<string>(translation.reviewer_notes ?? '');
  const [suppliedBody, setSuppliedBody] = useState<string>('');

  const sourceBody = translation.source_body ?? '';
  const draftContent = translation.draft_content ?? '';
  const hasDraft = draftContent.length > 0;
  const isNeedsManual = translation.pipeline_state === 'needs_manual';
  const verdict = translation.judge_verdict_json;
  const flags = Array.isArray(verdict?.flags) ? verdict!.flags! : [];

  // LCS-aligned side-by-side rows (MigrationDeliveryInlineDiff precedent).
  const alignedLines = useMemo<AlignedLine[]>(() => {
    if (!hasDraft) {
      return sourceBody
        .split('\n')
        .map((text) => ({ left: text, right: null, op: 'removed' as const }));
    }
    return computeLineDiff(sourceBody, draftContent).map((line) => ({
      left: line.op === 'added' ? null : line.text,
      right: line.op === 'removed' ? null : line.text,
      op: line.op,
    }));
  }, [sourceBody, draftContent, hasDraft]);

  // Review is possible only for a drafted row carrying its judge verdict —
  // unverified drafts never become reviewable, needs_manual is terminal.
  const reviewable =
    !isNeedsManual && translation.pipeline_state === 'drafted' && hasDraft;

  return (
    <div
      className={styles.manifestSection}
      data-testid="db-pack-translation-reviewer"
    >
      <div className={styles.reviewerHeader}>
        <div>
          <h4 className={styles.manifestSectionTitle}>
            <span className={styles.badge}>{translation.kind}</span>{' '}
            {translation.object_ref}
          </h4>
          <p className={styles.manifestNote}>
            {translation.translation_key}
            {translation.translated_at
              ? ` · drafted ${translation.translated_at}`
              : ''}
          </p>
        </div>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onClose}
          data-testid="db-pack-translation-reviewer-close"
        >
          Close
        </button>
      </div>

      {/* Fidelity warning banners (prominent, above the panes). */}
      {translation.truncated === true && (
        <div
          className={styles.errorBanner}
          data-testid="db-pack-translation-truncated-banner"
        >
          Body truncated at capture (64KB cap) — no review is possible for
          this object until the FULL source body is supplied. Paste it below
          (from the original source) and the pipeline re-translates it; no
          manual translation outside the tool.
        </div>
      )}
      {translation.truncated === true && onSupplyBody && (
        <div
          className={styles.manifestSection}
          data-testid="db-pack-translation-supply-body"
        >
          <textarea
            className={styles.reviewerNotesInput}
            rows={10}
            placeholder="Paste the COMPLETE source body (T-SQL) here…"
            value={suppliedBody}
            onChange={(e) => setSuppliedBody(e.target.value)}
            disabled={busy}
            data-testid="db-pack-translation-supply-body-input"
          />
          <button
            type="button"
            className={styles.actionButton}
            disabled={busy || suppliedBody.trim().length === 0}
            onClick={() => onSupplyBody(suppliedBody)}
            data-testid="db-pack-translation-supply-body-submit"
          >
            Supply full source body
          </button>
        </div>
      )}
      {translation.legacy_redacted === true && (
        <div
          className={styles.staleBanner}
          data-testid="db-pack-translation-legacy-banner"
        >
          <span>
            Source literals collapsed at capture — re-scan recommended. This
            body was captured before the targeted-scrub redaction fix; string
            literals were blanket-collapsed, so the draft may be incomplete.
            Re-run discovery to capture the full body.
          </span>
        </div>
      )}

      {/* Side-by-side panes: source T-SQL left, draft PL/pgSQL right. */}
      <div className={styles.reviewerLayout}>
        <div
          className={styles.reviewerPane}
          data-testid="db-pack-translation-source"
        >
          <div className={styles.reviewerPaneTitle}>Source T-SQL (Sybase ASE)</div>
          {alignedLines.map((line, idx) => (
            <div
              key={`l-${idx}`}
              className={`${styles.reviewerLine} ${
                line.left === null
                  ? styles.reviewerLineBlank
                  : line.op === 'removed'
                    ? styles.reviewerLineRemoved
                    : ''
              }`}
            >
              {line.left === null || line.left === ''
                ? ' '
                : line.left}
            </div>
          ))}
        </div>
        <div
          className={styles.reviewerPane}
          data-testid="db-pack-translation-draft"
        >
          <div className={styles.reviewerPaneTitle}>Draft PL/pgSQL (PostgreSQL)</div>
          {hasDraft ? (
            alignedLines.map((line, idx) => (
              <div
                key={`r-${idx}`}
                className={`${styles.reviewerLine} ${
                  line.right === null
                    ? styles.reviewerLineBlank
                    : line.op === 'added'
                      ? styles.reviewerLineAdded
                      : ''
                }`}
              >
                {line.right === null || line.right === ''
                  ? ' '
                  : line.right}
              </div>
            ))
          ) : (
            <div className={styles.emptyMessage} data-testid="db-pack-translation-no-draft">
              {isNeedsManual
                ? 'No draft — this object needs manual translation.'
                : 'No draft yet — run Translate to produce one.'}
            </div>
          )}
        </div>
      </div>

      {/* Judge verdict + confidence + flags table. */}
      {verdict && (
        <div
          className={styles.verdictPanel}
          data-testid="db-pack-translation-verdict"
        >
          <h4 className={styles.manifestSectionTitle}>Judge verdict</h4>
          <p className={styles.manifestNote}>
            Verdict:{' '}
            <span className={styles.badge}>
              {typeof verdict.verdict === 'string' ? verdict.verdict : '—'}
            </span>{' '}
            · Confidence:{' '}
            {typeof verdict.confidence === 'number'
              ? verdict.confidence.toFixed(2)
              : '—'}
          </p>
          {flags.length > 0 && (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Construct</th>
                  <th>Concern</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((flag, idx) => (
                  <tr key={idx} data-testid={`db-pack-translation-flag-${idx}`}>
                    <td>
                      <code>{flag.construct}</code>
                    </td>
                    <td>{flag.concern}</td>
                    <td>
                      <span
                        className={
                          flag.severity === 'high'
                            ? styles.badgeMissing
                            : flag.severity === 'medium'
                              ? styles.badgeFlagged
                              : styles.badge
                        }
                      >
                        {flag.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.manifestNote}>
            Judge flags inform the review — they never gate approval.
          </p>
        </div>
      )}

      {/* Review controls — approve / reject / needs-rework with notes. */}
      {reviewable ? (
        <div
          className={styles.reviewControls}
          data-testid="db-pack-translation-review-controls"
        >
          <label className={styles.filterLabel} htmlFor="db-pack-translation-review-notes">
            Reviewer notes (encouraged for needs-rework)
          </label>
          <textarea
            id="db-pack-translation-review-notes"
            className={styles.reviewNotes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            data-testid="db-pack-translation-review-notes"
          />
          <div className={styles.actionsBar}>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
              onClick={() => onReview('approve', notes)}
              disabled={busy}
              data-testid="db-pack-translation-approve"
            >
              Approve
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onReview('reject', notes)}
              disabled={busy}
              data-testid="db-pack-translation-reject"
            >
              Reject
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onReview('needs_rework', notes)}
              disabled={busy}
              data-testid="db-pack-translation-needs-rework"
            >
              Needs rework
            </button>
            <span className={styles.badge}>{translation.review_status}</span>
          </div>
        </div>
      ) : (
        !isNeedsManual && (
          <p className={styles.manifestNote}>
            Review actions become available once a judge-verified draft
            exists.
          </p>
        )
      )}

      {translation.reviewed_at && (
        <p
          className={styles.manifestNote}
          data-testid="db-pack-translation-reviewed-at"
        >
          Reviewed at {translation.reviewed_at}
          {translation.reviewer_notes
            ? ` — notes: ${translation.reviewer_notes}`
            : ''}
        </p>
      )}
    </div>
  );
};

export default DbMigrationPackTranslationReviewer;
