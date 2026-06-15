/**
 * DiffFindingDetailDrawer Component
 *
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 4
 * sub-task 4.4.
 *
 * Right-side drawer that opens when the per-row "Findings" badge on the
 * Drift report tab is clicked. Pre-loaded with the findings linked to that
 * specific diff_item (passed from the parent so we avoid a second fetch on
 * badge-click).
 *
 * Copy-modify of `frontend/src/components/Discovery/FindingDetailDrawer.tsx`
 * per accepted Q4 (~150 LOC; acceptable duplication for lower risk to the
 * existing reviewer flow; refactor to a shared base deferred to v2 if
 * surfaces diverge further).
 *
 * Differences from the original:
 *   - Lives under `DashboardView/` (NOT `Discovery/`) -- colocates with the
 *     parent `DriftReportTab.tsx`.
 *   - Accepts `diffId: string` instead of `runId: string`.
 *   - Calls `patchDiffFinding` from `diffFindingsApi.ts` instead of
 *     `reviewFinding` / `updateFinding` from `findingsApi.ts`.
 *   - Accepts an array of findings (the v1 emission rules produce at most
 *     one finding per diff_item, but the props signature accepts the full
 *     filtered list to keep room for future multi-emission rules). When the
 *     list has > 1 entries, a small in-drawer selector lets the reviewer
 *     cycle through them.
 *   - Renders the diff_item context (method, path, scenario name) at the
 *     top so the reviewer can correlate the finding back to the Drift
 *     report row that opened it.
 *   - "Linked Items" panel from the original is omitted -- diff-sourced
 *     findings link only to one `api_behaviour_diff_item` (the row that
 *     opened the drawer), so the link list would be a tautology.
 *
 * AppShell model cache (`project_appshell_model_cache.md`) is intentionally
 * NOT invalidated on review actions -- findings live outside the
 * architecture model.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingStatus,
  UpdateDiscoveryFindingRequest,
} from '../../api/diffFindingsApi';
import { DiffFindingsApiError, patchDiffFinding } from '../../api/diffFindingsApi';
import styles from './DiffFindingDetailDrawer.module.css';

// ============================================================================
// Helpers
// ============================================================================

function severityBadgeClass(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return styles.badgeSeverityCritical;
    case 'high':
      return styles.badgeSeverityHigh;
    case 'medium':
      return styles.badgeSeverityMedium;
    case 'low':
      return styles.badgeSeverityLow;
    case 'info':
      return styles.badgeSeverityInfo;
    default:
      return '';
  }
}

function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'accepted':
      return styles.badgeStatusAccepted;
    case 'ignored':
      return styles.badgeStatusIgnored;
    case 'needs_review':
      return styles.badgeStatusNeedsReview;
    case 'resolved':
      return styles.badgeStatusResolved;
    default:
      return '';
  }
}

function tryFormatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ============================================================================
// Diff item context shape -- minimal subset of `ApiBehaviourDiffItemDto`
// passed from the parent so the drawer can render the row's identity
// without re-importing the full DTO.
// ============================================================================

export interface DiffFindingDrawerDiffItemContext {
  id: string;
  method: string;
  path: string;
  scenario_name: string;
}

// ============================================================================
// Props + component
// ============================================================================

export interface DiffFindingDetailDrawerProps {
  projectId: string;
  diffId: string;
  /**
   * The diff_item row that opened the drawer -- rendered as a context strip
   * at the top so the reviewer can correlate the finding back to its source.
   */
  diffItem: DiffFindingDrawerDiffItemContext;
  /**
   * The findings linked to this diff_item. v1 emission rules produce at
   * most one finding per diff_item, but the array signature leaves room for
   * future multi-emission rules. The drawer renders a small selector when
   * the length is > 1.
   */
  findings: DiscoveryFindingDto[];
  onClose: () => void;
  /**
   * Called after a successful PATCH with the fresh finding row. Parent uses
   * this to refresh the badge count + drawer state without a full list
   * re-fetch.
   *
   * AppShell model cache is deliberately NOT invalidated -- findings live
   * outside the architecture model (`project_appshell_model_cache.md`).
   */
  onFindingUpdated: (updated: DiscoveryFindingDto) => void;
}

export const DiffFindingDetailDrawer: React.FC<DiffFindingDetailDrawerProps> = ({
  projectId,
  diffId,
  diffItem,
  findings,
  onClose,
  onFindingUpdated,
}) => {
  // Multi-finding navigation: index into the `findings` array. v1 rules
  // emit at most one per diff_item so this is almost always 0, but the
  // selector buttons make the cycle explicit when present.
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // Clamp activeIndex when the findings array shrinks (e.g. a status
  // transition resolves a finding and the parent filters it out).
  useEffect(() => {
    if (activeIndex >= findings.length && findings.length > 0) {
      setActiveIndex(findings.length - 1);
    }
  }, [findings.length, activeIndex]);

  const finding: DiscoveryFindingDto | null = findings[activeIndex] ?? null;

  // Local reviewer-notes draft; seeded from the finding's persisted notes
  // on mount and on finding-id change.
  const [notesDraft, setNotesDraft] = useState<string>(finding?.reviewer_notes ?? '');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setNotesDraft(finding?.reviewer_notes ?? '');
    setSubmitError(null);
  }, [finding?.id, finding?.reviewer_notes]);

  const detailJsonString = useMemo(() => {
    if (!finding?.detail_json) return null;
    return tryFormatJson(finding.detail_json);
  }, [finding?.detail_json]);

  const doReview = useCallback(
    async (status: DiscoveryFindingStatus) => {
      if (!finding) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const patch: UpdateDiscoveryFindingRequest = {
          status,
          // Send the draft notes through with the status transition so the
          // reviewer's typed-but-unsaved notes are persisted in one call.
          reviewer_notes: notesDraft,
        };
        const updated = await patchDiffFinding(projectId, diffId, finding.id, patch);
        onFindingUpdated(updated);
      } catch (err) {
        const message =
          err instanceof DiffFindingsApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to update finding';
        setSubmitError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [projectId, diffId, finding, notesDraft, onFindingUpdated],
  );

  const doSaveNotesOnly = useCallback(async () => {
    if (!finding) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await patchDiffFinding(projectId, diffId, finding.id, {
        reviewer_notes: notesDraft,
      });
      onFindingUpdated(updated);
    } catch (err) {
      const message =
        err instanceof DiffFindingsApiError
          ? err.body.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to save notes';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [projectId, diffId, finding, notesDraft, onFindingUpdated]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Diff finding detail"
      data-testid="diff-finding-detail-drawer"
      onClick={onClose}
    >
      <div
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerTopRow}>
            <h2 className={styles.title} data-testid="diff-finding-detail-title">
              {finding?.title ?? 'No finding selected'}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              data-testid="diff-finding-detail-close-button"
            >
              Close
            </button>
          </div>

          {/* Diff_item context strip -- correlates the finding back to its
              source row on the Drift report tab. */}
          <div
            className={styles.diffItemContext}
            data-testid="diff-finding-detail-diff-item-context"
          >
            <span className={styles.diffItemContextLabel}>Diff item:</span>
            <span className={styles.diffItemMethod}>{diffItem.method}</span>
            <span className={styles.diffItemPath}>{diffItem.path}</span>
            <span className={styles.diffItemScenario}>"{diffItem.scenario_name}"</span>
          </div>

          {finding && (
            <div className={styles.badgeRow}>
              <span
                className={`${styles.badge} ${severityBadgeClass(finding.severity)}`}
                data-testid="diff-finding-detail-severity-badge"
              >
                {finding.severity}
              </span>
              <span
                className={`${styles.badge} ${statusBadgeClass(finding.status)}`}
                data-testid="diff-finding-detail-status-badge"
              >
                {finding.status}
              </span>
              <span className={styles.badge}>{finding.category}</span>
              <span className={styles.badge}>{finding.finding_type}</span>
            </div>
          )}
        </div>

        {/* Multi-finding selector strip -- only rendered when > 1 findings
            are present for the diff_item (v1 rules emit at most one, but
            future rules may emit several). */}
        {findings.length > 1 && (
          <div
            className={styles.findingsListNav}
            data-testid="diff-finding-detail-findings-nav"
          >
            {findings.map((f, idx) => (
              <button
                key={f.id}
                type="button"
                className={`${styles.findingsListNavButton} ${
                  idx === activeIndex ? styles.findingsListNavButtonActive : ''
                }`}
                onClick={() => setActiveIndex(idx)}
                data-testid="diff-finding-detail-findings-nav-button"
              >
                {f.severity}: {f.finding_type}
              </button>
            ))}
          </div>
        )}

        <div className={styles.body}>
          {!finding ? (
            <div
              className={styles.emptyFindingsMessage}
              data-testid="diff-finding-detail-empty"
            >
              No findings linked to this diff item.
            </div>
          ) : (
            <>
              {/* Summary */}
              {finding.summary && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>Summary</h3>
                  <p
                    className={styles.summaryText}
                    data-testid="diff-finding-detail-summary"
                  >
                    {finding.summary}
                  </p>
                </div>
              )}

              {/* Meta grid */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Meta</h3>
                <div className={styles.metaGrid}>
                  <div className={styles.metaCell}>
                    <span className={styles.metaLabel}>Source</span>
                    <span className={styles.metaValue}>{finding.source ?? '-'}</span>
                  </div>
                  <div className={styles.metaCell}>
                    <span className={styles.metaLabel}>Stage</span>
                    <span className={styles.metaValue}>
                      {finding.created_by_stage ?? '-'}
                    </span>
                  </div>
                  <div className={styles.metaCell}>
                    <span className={styles.metaLabel}>Created</span>
                    <span className={styles.metaValue}>{finding.created_at}</span>
                  </div>
                  <div className={styles.metaCell}>
                    <span className={styles.metaLabel}>Reviewed</span>
                    <span className={styles.metaValue}>
                      {finding.reviewed_at ?? '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Detail JSON */}
              {detailJsonString && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>Detail</h3>
                  <pre
                    className={styles.detailJson}
                    data-testid="diff-finding-detail-json"
                  >
                    {detailJsonString}
                  </pre>
                </div>
              )}

              {/* Reviewer notes */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Reviewer Notes</h3>
                <textarea
                  className={styles.notesTextarea}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Add notes for your review..."
                  data-testid="diff-finding-detail-notes-textarea"
                  aria-label="Reviewer notes"
                />
              </div>

              {submitError && (
                <div
                  className={styles.errorMessage}
                  data-testid="diff-finding-detail-error"
                >
                  {submitError}
                </div>
              )}
            </>
          )}
        </div>

        {finding && (
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={styles.actionButton}
              disabled={submitting}
              onClick={() => void doReview('accepted')}
              data-testid="diff-finding-action-accept"
            >
              Accept
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonDanger}`}
              disabled={submitting}
              onClick={() => void doReview('ignored')}
              data-testid="diff-finding-action-ignore"
            >
              Ignore
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
              disabled={submitting}
              onClick={() => void doReview('needs_review')}
              data-testid="diff-finding-action-needs-review"
            >
              Mark Needs Review
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
              disabled={submitting}
              onClick={() => void doReview('resolved')}
              data-testid="diff-finding-action-resolved"
            >
              Mark Resolved
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
              disabled={submitting}
              onClick={() => void doSaveNotesOnly()}
              data-testid="diff-finding-action-save-notes"
            >
              Save Notes
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiffFindingDetailDrawer;
