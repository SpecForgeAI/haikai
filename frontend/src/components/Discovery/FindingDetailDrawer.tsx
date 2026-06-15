/**
 * FindingDetailDrawer Component
 *
 * Spec 2026-05-16 Discovery Findings -- Task Group 7.3.
 * Spec F 2026-06-02 Normalize Findings Review Actions -- the reviewer surface
 * becomes exactly Approve / Reject / Defer (candidate-parity verbs); the
 * legacy "Mark Needs Review" + "Mark Resolved" buttons are removed and the
 * disposition field is `review_status`.
 *
 * Right-side drawer that opens when a row in `FindingsTab` is clicked. Shows
 * the full finding payload (title, summary, formatted `detail_json`, the
 * severity / category / type / status / confidence / source+stage meta), the
 * linked-items panel grouped by `target_type`, and the reviewer action
 * controls (Approve / Reject / Defer / Save Notes).
 *
 * AppShell model cache (`project_appshell_model_cache.md`) is intentionally
 * NOT invalidated on review actions -- findings live outside the
 * architecture model, so no `LOAD_MODEL` dispatch is needed.
 *
 * "Create work item" is a UI affordance only -- the backend is deferred per
 * spec out-of-scope.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingLinkDto,
  DiscoveryFindingStatus,
  DiscoveryFindingLinkTargetType,
} from '../../api/findingsApi';
import { reviewFinding, updateFinding, FindingsApiError } from '../../api/findingsApi';
import { labelForFindingType } from './findingTypeLabels';
import styles from './FindingDetailDrawer.module.css';

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
    case 'approved':
      return styles.badgeStatusApproved;
    case 'rejected':
      return styles.badgeStatusRejected;
    case 'deferred':
      return styles.badgeStatusDeferred;
    case 'pending_review':
      return styles.badgeStatusPendingReview;
    default:
      return '';
  }
}

const LINK_TARGET_TYPE_LABELS: Record<string, string> = {
  discovery_candidate: 'Linked Candidates',
  discovery_decision_task: 'Linked Decision Tasks',
  discovery_relationship: 'Linked Relationships',
  discovery_evidence: 'Linked Evidence',
  discovery_cluster: 'Linked Clusters',
  architecture_element: 'Linked Architecture Elements',
  work_item: 'Linked Work Items',
  api_behaviour_baseline: 'Linked API Behaviour Baselines',
};

/**
 * Whether a link's target can be "opened" via existing discovery navigation.
 * v1 the candidate / decision-task / evidence surfaces have detail pages; the
 * others render as read-only summary stubs (`disabled` "Open" button) per
 * spec.
 */
function isOpenableLinkTarget(targetType: string): boolean {
  return (
    targetType === 'discovery_candidate' ||
    targetType === 'discovery_decision_task' ||
    targetType === 'discovery_evidence'
  );
}

/**
 * Group a list of links by `target_type` so the drawer can render one
 * panel per target-type. Returns groups in a stable spec-defined order so
 * reviewer cognitive load is consistent across findings.
 */
function groupLinksByTargetType(
  links: DiscoveryFindingLinkDto[],
): Array<{ targetType: string; links: DiscoveryFindingLinkDto[] }> {
  const order: DiscoveryFindingLinkTargetType[] = [
    'discovery_candidate',
    'discovery_decision_task',
    'discovery_relationship',
    'discovery_evidence',
    'discovery_cluster',
    'architecture_element',
    'work_item',
    'api_behaviour_baseline',
  ];
  const buckets = new Map<string, DiscoveryFindingLinkDto[]>();
  for (const link of links) {
    const arr = buckets.get(link.target_type) ?? [];
    arr.push(link);
    buckets.set(link.target_type, arr);
  }
  const groups: Array<{ targetType: string; links: DiscoveryFindingLinkDto[] }> = [];
  for (const t of order) {
    const arr = buckets.get(t);
    if (arr && arr.length > 0) {
      groups.push({ targetType: t, links: arr });
      buckets.delete(t);
    }
  }
  // Any unrecognised target_type (forward-compat) appears last in
  // insertion order. Sorted for determinism.
  const unknownTypes = Array.from(buckets.keys()).sort();
  for (const t of unknownTypes) {
    groups.push({ targetType: t, links: buckets.get(t)! });
  }
  return groups;
}

function tryFormatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ============================================================================
// Props + component
// ============================================================================

export interface FindingDetailDrawerProps {
  projectId: string;
  architectureId: string;
  runId: string;
  finding: DiscoveryFindingDto;
  onClose: () => void;
  /**
   * Called after a successful action (review or notes-only update) with the
   * fresh finding row. Parent uses this to refresh the table row + bump the
   * summary-counts strip without a full list re-fetch.
   *
   * AppShell model cache is deliberately NOT invalidated -- findings live
   * outside the architecture model (`project_appshell_model_cache.md`).
   */
  onFindingUpdated: (updated: DiscoveryFindingDto) => void;
  /**
   * Optional callback for "open" affordance on linked items. When provided,
   * the drawer delegates to the caller (typically `useNavigate`). When
   * absent, openable links render a non-functional button so the test
   * surface stays stable without coupling to react-router in unit tests.
   */
  onOpenLinkedTarget?: (
    targetType: string,
    targetId: string,
  ) => void;
}

export const FindingDetailDrawer: React.FC<FindingDetailDrawerProps> = ({
  projectId,
  architectureId,
  runId,
  finding,
  onClose,
  onFindingUpdated,
  onOpenLinkedTarget,
}) => {
  // Local reviewer-notes draft; seeded from the finding's persisted notes on
  // mount and on finding-id change. Edits don't auto-save -- the user must
  // click "Save Notes" or one of the action buttons (which carry notes
  // through in the same call).
  const [notesDraft, setNotesDraft] = useState<string>(finding.reviewer_notes ?? '');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setNotesDraft(finding.reviewer_notes ?? '');
    setSubmitError(null);
  }, [finding.id, finding.reviewer_notes]);

  const linkGroups = useMemo(
    () => groupLinksByTargetType(finding.links ?? []),
    [finding.links],
  );

  const detailJsonString = useMemo(() => {
    if (!finding.detail_json) return null;
    return tryFormatJson(finding.detail_json);
  }, [finding.detail_json]);

  const doReview = useCallback(
    async (reviewStatus: DiscoveryFindingStatus) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        const updated = await reviewFinding(
          projectId,
          architectureId,
          runId,
          finding.id,
          {
            review_status: reviewStatus,
            // Send the draft notes through with the review action so the
            // reviewer's typed-but-unsaved notes are persisted in one call.
            // Empty string passes through as ''; null leaves the column
            // alone, which we don't want here because the user explicitly
            // edited the textarea.
            reviewer_notes: notesDraft,
          },
        );
        onFindingUpdated(updated);
      } catch (err) {
        const message =
          err instanceof FindingsApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to update finding';
        setSubmitError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [projectId, architectureId, runId, finding.id, notesDraft, onFindingUpdated],
  );

  const doSaveNotesOnly = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Use the general PATCH endpoint for a notes-only edit so we don't
      // accidentally stamp `reviewed_at` -- the convenience review endpoint
      // is reserved for state-changing actions.
      const updated = await updateFinding(
        projectId,
        architectureId,
        runId,
        finding.id,
        { reviewer_notes: notesDraft },
      );
      onFindingUpdated(updated);
    } catch (err) {
      const message =
        err instanceof FindingsApiError
          ? err.body.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to save notes';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }, [projectId, architectureId, runId, finding.id, notesDraft, onFindingUpdated]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Finding detail"
      data-testid="finding-detail-drawer"
      onClick={onClose}
    >
      <div
        className={styles.drawer}
        // Stop propagation so clicks inside the drawer don't dismiss it via
        // the overlay's onClick handler.
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerTopRow}>
            <h2 className={styles.title} data-testid="finding-detail-title">
              {finding.title}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              data-testid="finding-detail-close-button"
            >
              Close
            </button>
          </div>
          <div className={styles.badgeRow}>
            <span
              className={`${styles.badge} ${severityBadgeClass(finding.severity)}`}
              data-testid="finding-detail-severity-badge"
            >
              {finding.severity}
            </span>
            <span
              className={`${styles.badge} ${statusBadgeClass(finding.review_status)}`}
              data-testid="finding-detail-status-badge"
            >
              {finding.review_status}
            </span>
            <span className={styles.badge}>{finding.category}</span>
            <span className={styles.badge}>{labelForFindingType(finding.finding_type)}</span>
            {typeof finding.confidence === 'number' && (
              <span className={styles.badge}>
                conf {Math.round((finding.confidence ?? 0) * 100)}%
              </span>
            )}
          </div>
        </div>

        <div className={styles.body}>
          {/* Summary */}
          {finding.summary && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Summary</h3>
              <p className={styles.summaryText} data-testid="finding-detail-summary">
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
              <pre className={styles.detailJson} data-testid="finding-detail-json">
                {detailJsonString}
              </pre>
            </div>
          )}

          {/* Linked items panels (grouped by target_type) */}
          <div className={styles.section} data-testid="finding-detail-links-section">
            <h3 className={styles.sectionTitle}>Linked Items</h3>
            {linkGroups.length === 0 ? (
              <span className={styles.emptyLinksMessage}>
                No linked items.
              </span>
            ) : (
              linkGroups.map((group) => (
                <div
                  key={group.targetType}
                  data-testid={`finding-detail-links-group-${group.targetType}`}
                >
                  <h4 className={styles.sectionTitle}>
                    {LINK_TARGET_TYPE_LABELS[group.targetType] ??
                      `Linked (${group.targetType})`}{' '}
                    ({group.links.length})
                  </h4>
                  <ul className={styles.linksList}>
                    {group.links.map((link) => {
                      const openable =
                        isOpenableLinkTarget(group.targetType) &&
                        !!onOpenLinkedTarget;
                      return (
                        <li
                          key={link.id}
                          className={styles.linkItem}
                          data-testid="finding-detail-link-item"
                        >
                          <div className={styles.linkLabel}>
                            <span>
                              {link.label ?? link.link_type}{' '}
                              <span className={styles.linkTargetId}>
                                ({link.target_id})
                              </span>
                            </span>
                          </div>
                          <button
                            type="button"
                            className={styles.linkOpenButton}
                            disabled={!openable}
                            onClick={() => {
                              if (openable) {
                                onOpenLinkedTarget?.(
                                  group.targetType,
                                  link.target_id,
                                );
                              }
                            }}
                            data-testid="finding-detail-link-open-button"
                            title={
                              openable
                                ? 'Open the linked item'
                                : 'No detail page available for this target type yet'
                            }
                          >
                            Open
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>

          {/* Reviewer notes */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Reviewer Notes</h3>
            <textarea
              className={styles.notesTextarea}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Add notes for your review..."
              data-testid="finding-detail-notes-textarea"
              aria-label="Reviewer notes"
            />
          </div>

          {submitError && (
            <div className={styles.errorMessage} data-testid="finding-detail-error">
              {submitError}
            </div>
          )}
        </div>

        <div className={styles.actionsRow}>
          <button
            type="button"
            className={styles.actionButton}
            disabled={submitting}
            onClick={() => void doReview('approved')}
            data-testid="finding-action-approve"
          >
            Approve
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonDanger}`}
            disabled={submitting}
            onClick={() => void doReview('rejected')}
            data-testid="finding-action-reject"
          >
            Reject
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            disabled={submitting}
            onClick={() => void doReview('deferred')}
            data-testid="finding-action-defer"
          >
            Defer
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            disabled={submitting}
            onClick={() => void doSaveNotesOnly()}
            data-testid="finding-action-save-notes"
          >
            Save Notes
          </button>
          {/* "Create work item" -- UI affordance only; backend deferred per
              spec out-of-scope. The disabled state + tooltip surface the
              intent without wiring a no-op backend. */}
          <span className={styles.workItemAffordance}>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.disabledButton}`}
              disabled
              title="Backend deferred"
              data-testid="finding-action-create-work-item"
            >
              Create work item
            </button>
          </span>
        </div>
      </div>
    </div>
  );
};
