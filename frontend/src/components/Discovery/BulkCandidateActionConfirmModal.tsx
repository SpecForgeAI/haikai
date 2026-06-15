/**
 * BulkCandidateActionConfirmModal
 *
 * Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression (Spec 2) --
 * Task Group 5.3. SIBLING of `BulkFindingActionConfirmModal.tsx` (header /
 * content / footer layout, escape + overlay dismiss, reviewer-note textarea,
 * spinner-on-confirm). Where the finding modal echoes a scope + approximate
 * skipped count, THIS modal is a THIN RENDERER over the deterministic
 * `resolveBulkActionSet` output (the Spec 1 blast-radius the grid already
 * fetched on mount):
 *
 *   - NET COUNTS: how many candidates (seed + cascaded) and linked findings the
 *     action will touch, with the whole-run "of N" context from `aggregations`.
 *   - CASCADE-PULLED ITEMS: every dependent candidate pulled in BY CASCADE, with
 *     the EDGE that pulled it in (provenance: `via_edge_kind` +
 *     `via_predecessor_id`) -- each DESELECTABLE.
 *   - LINKED FINDINGS: every finding pulled in via a touched candidate -- each
 *     DESELECTABLE.
 *   - optional reviewer-note textarea (forwarded only when non-empty after trim).
 *
 * CURATION lives here (Decision 9: no per-row grid checkboxes). The SEED
 * candidates the user selected via the toolbar are NOT deselectable (they are the
 * explicit selection); the reviewer DESELECTS cascaded dependents and/or linked
 * findings they want to keep. Confirm posts ONLY the curated id set:
 *   - candidate_ids = seeds + selected cascaded dependents
 *   - finding_ids   = selected linked findings
 *
 * The parent (`DiscoveryCandidateTable`) owns the atomic `bulkReviewCascade`
 * call -- this modal is purely UI + an
 * `onConfirm({ candidateIds, findingIds, reviewerNotes? })` callback.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './BulkCandidateActionConfirmModal.module.css';
import type {
  BulkReviewAction,
  ResolvedBulkActionSet,
} from './resolveBulkActionSet';

const NOTES_SOFT_CAP = 500;

/**
 * Human-readable disposition label rendered in the title (`Mark X candidates as
 * Approved?`). Mirrors the finding modal's `statusDisplayLabel`.
 */
function actionDisplayLabel(action: BulkReviewAction | string): string {
  switch (action) {
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'deferred':
      return 'Deferred';
    default:
      return String(action);
  }
}

/**
 * Human-readable label for a cascade edge kind (the `via_edge_kind` provenance).
 * Falls back to the raw snake_case token (humanised) for any future edge kind.
 */
function edgeKindLabel(edgeKind: string | null): string {
  switch (edgeKind) {
    case 'parent_child':
      return 'parent → child';
    case 'interface_logical_entities':
      return 'interface → logical entity';
    case 'endpoint_data_effects':
      return 'endpoint → data entity';
    case 'logical_data_entity_physical_data_entities':
      return 'logical → physical entity';
    case 'logical_data_attribute_physical_data_attributes':
      return 'logical → physical attribute';
    case 'logical_data_entity_relationships':
      return 'entity relationship';
    case 'data_movements':
      return 'data movement';
    case null:
    case undefined:
      return 'direct';
    default:
      return String(edgeKind).replace(/_/g, ' ');
  }
}

/** The curated set the reviewer confirms (only the still-selected ids). */
export interface BulkCandidateActionConfirmPayload {
  /** Seed candidates + selected cascaded dependents. */
  candidateIds: string[];
  /** Selected linked findings. */
  findingIds: string[];
  /** Trimmed reviewer notes, only present when non-empty. */
  reviewerNotes?: string;
}

export interface BulkCandidateActionConfirmModalProps {
  isOpen: boolean;
  /**
   * The deterministic touched set resolved from the Spec 1 blast-radius for the
   * seeded candidates (`resolveBulkActionSet` output). The modal renders a THIN
   * view over it; curation toggles a local deselect set on top of it.
   */
  actionSet: ResolvedBulkActionSet;
  /**
   * Optional id -> display-name map so the preview can label candidates by name
   * instead of bare ids. Absence-tolerant: an id with no entry shows the id.
   */
  candidateNamesById?: Record<string, string>;
  /**
   * Optional finding id -> title map so the preview can label findings.
   * Absence-tolerant.
   */
  findingTitlesById?: Record<string, string>;
  /**
   * True while `bulkReviewCascade` is in flight. Disables Cancel + Confirm and
   * renders a spinner inside Confirm.
   */
  inFlight: boolean;
  onClose: () => void;
  /**
   * Fired when the reviewer clicks Confirm. Carries ONLY the curated id set
   * (seeds + still-selected cascaded dependents; still-selected findings) plus
   * trimmed reviewer notes when non-empty.
   */
  onConfirm: (payload: BulkCandidateActionConfirmPayload) => void;
}

export function BulkCandidateActionConfirmModal({
  isOpen,
  actionSet,
  candidateNamesById,
  findingTitlesById,
  inFlight,
  onClose,
  onConfirm,
}: BulkCandidateActionConfirmModalProps) {
  const [notes, setNotes] = useState<string>('');
  // Ids the reviewer has DESELECTED (kept out of the curated apply set). Seeds
  // are never deselectable, so this only ever holds cascaded-dependent ids and
  // finding ids. Reset on each open so a stale deselect can't leak across opens.
  const [deselectedCandidateIds, setDeselectedCandidateIds] = useState<
    Set<string>
  >(new Set());
  const [deselectedFindingIds, setDeselectedFindingIds] = useState<Set<string>>(
    new Set(),
  );

  // Reset curation + textarea whenever the modal transitions closed -> open (or
  // the action set identity changes) so a previous action's state never leaks.
  useEffect(() => {
    if (isOpen) {
      setNotes('');
      setDeselectedCandidateIds(new Set());
      setDeselectedFindingIds(new Set());
    }
  }, [isOpen, actionSet]);

  // Escape-key dismiss (mirrors BulkFindingActionConfirmModal). Suppressed while
  // the API call is in flight so an ill-timed key event can't dismiss mid-trip.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, inFlight, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !inFlight) {
        onClose();
      }
    },
    [onClose, inFlight],
  );

  const toggleCandidate = useCallback((id: string) => {
    setDeselectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFinding = useCallback((id: string) => {
    setDeselectedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Split the resolved candidates into the (always-included) seeds and the
  // (deselectable) cascaded dependents.
  const seedCandidates = useMemo(
    () => actionSet.candidates.filter((c) => c.provenance === 'seed'),
    [actionSet.candidates],
  );
  const cascadedCandidates = useMemo(
    () => actionSet.candidates.filter((c) => c.provenance === 'cascaded'),
    [actionSet.candidates],
  );

  // The CURATED id sets the Confirm posts: seeds always; cascaded dependents +
  // findings only when still selected (not in the deselected set).
  const curatedCandidateIds = useMemo(() => {
    const ids: string[] = [];
    for (const c of actionSet.candidates) {
      if (c.provenance === 'seed' || !deselectedCandidateIds.has(c.candidate_id)) {
        ids.push(c.candidate_id);
      }
    }
    return ids;
  }, [actionSet.candidates, deselectedCandidateIds]);

  const curatedFindingIds = useMemo(
    () =>
      actionSet.findings
        .filter((f) => !deselectedFindingIds.has(f.finding_id))
        .map((f) => f.finding_id),
    [actionSet.findings, deselectedFindingIds],
  );

  const handleConfirm = useCallback(() => {
    const trimmed = notes.trim();
    onConfirm({
      candidateIds: curatedCandidateIds,
      findingIds: curatedFindingIds,
      reviewerNotes: trimmed.length > 0 ? trimmed : undefined,
    });
  }, [notes, curatedCandidateIds, curatedFindingIds, onConfirm]);

  if (!isOpen) {
    return null;
  }

  const actionLabel = actionDisplayLabel(actionSet.action);
  const overCap = notes.length > NOTES_SOFT_CAP;

  const candidateName = (id: string): string => candidateNamesById?.[id] ?? id;
  const findingTitle = (id: string): string => findingTitlesById?.[id] ?? id;

  // Net "of N" context strings from the resolved counts.
  const { counts } = actionSet;
  const curatedCandidateCount = curatedCandidateIds.length;
  const curatedFindingCount = curatedFindingIds.length;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="bulk-candidate-action-confirm-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title} data-testid="bulk-candidate-confirm-title">
            Mark {curatedCandidateCount} candidate
            {curatedCandidateCount === 1 ? '' : 's'} as {actionLabel}?
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={inFlight}
            title="Close"
            data-testid="bulk-candidate-confirm-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {/* Net counts -- the deterministic preview header. */}
          <div
            className={styles.countsLine}
            data-testid="bulk-candidate-confirm-counts"
          >
            <span data-testid="bulk-candidate-confirm-candidate-count">
              {curatedCandidateCount}
              {counts.run_total_candidates !== null
                ? ` of ${counts.run_total_candidates}`
                : ''}{' '}
              candidate{curatedCandidateCount === 1 ? '' : 's'}
            </span>
            <span className={styles.countsSeparator}>·</span>
            <span data-testid="bulk-candidate-confirm-finding-count">
              {curatedFindingCount}
              {counts.run_total_findings !== null
                ? ` of ${counts.run_total_findings}`
                : ''}{' '}
              linked finding{curatedFindingCount === 1 ? '' : 's'}
            </span>
          </div>
          <div
            className={styles.cascadeSummary}
            data-testid="bulk-candidate-confirm-cascade-summary"
          >
            {counts.seed_candidates} selected ·{' '}
            {counts.cascaded_candidates} pulled in by cascade
          </div>

          {/* SEED candidates (the explicit selection; not deselectable). */}
          {seedCandidates.length > 0 && (
            <div
              className={styles.section}
              data-testid="bulk-candidate-confirm-seed-section"
            >
              <div className={styles.sectionTitle}>Selected candidates</div>
              <ul className={styles.itemList}>
                {seedCandidates.map((c) => (
                  <li
                    key={c.candidate_id}
                    className={styles.itemRow}
                    data-testid={`bulk-candidate-seed-${c.candidate_id}`}
                  >
                    <span className={styles.itemName}>
                      {candidateName(c.candidate_id)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CASCADED dependents -- pulled in BY CASCADE, each deselectable,
              each labelled with the edge (provenance) that pulled it in. */}
          {cascadedCandidates.length > 0 && (
            <div
              className={styles.section}
              data-testid="bulk-candidate-confirm-cascade-section"
            >
              <div className={styles.sectionTitle}>
                Dependents pulled in by cascade
              </div>
              <ul className={styles.itemList}>
                {cascadedCandidates.map((c) => {
                  const selected = !deselectedCandidateIds.has(c.candidate_id);
                  return (
                    <li
                      key={c.candidate_id}
                      className={`${styles.itemRow} ${selected ? '' : styles.itemDeselected}`}
                      data-testid={`bulk-candidate-cascaded-${c.candidate_id}`}
                    >
                      <label className={styles.itemLabel}>
                        <input
                          type="checkbox"
                          className={styles.itemCheckbox}
                          checked={selected}
                          disabled={inFlight}
                          onChange={() => toggleCandidate(c.candidate_id)}
                          data-testid={`bulk-candidate-cascaded-toggle-${c.candidate_id}`}
                        />
                        <span className={styles.itemName}>
                          {candidateName(c.candidate_id)}
                        </span>
                        <span
                          className={styles.itemProvenance}
                          data-testid={`bulk-candidate-cascaded-provenance-${c.candidate_id}`}
                        >
                          via {edgeKindLabel(c.via_edge_kind)}
                          {c.via_predecessor_id
                            ? ` from ${candidateName(c.via_predecessor_id)}`
                            : ''}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* LINKED findings -- each deselectable. */}
          {actionSet.findings.length > 0 && (
            <div
              className={styles.section}
              data-testid="bulk-candidate-confirm-findings-section"
            >
              <div className={styles.sectionTitle}>Linked findings</div>
              <ul className={styles.itemList}>
                {actionSet.findings.map((f) => {
                  const selected = !deselectedFindingIds.has(f.finding_id);
                  return (
                    <li
                      key={f.finding_id}
                      className={`${styles.itemRow} ${selected ? '' : styles.itemDeselected}`}
                      data-testid={`bulk-candidate-finding-${f.finding_id}`}
                    >
                      <label className={styles.itemLabel}>
                        <input
                          type="checkbox"
                          className={styles.itemCheckbox}
                          checked={selected}
                          disabled={inFlight}
                          onChange={() => toggleFinding(f.finding_id)}
                          data-testid={`bulk-candidate-finding-toggle-${f.finding_id}`}
                        />
                        <span className={styles.itemName}>
                          {findingTitle(f.finding_id)}
                        </span>
                        <span
                          className={styles.itemProvenance}
                          data-testid={`bulk-candidate-finding-provenance-${f.finding_id}`}
                        >
                          via {candidateName(f.via_candidate_id)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <label
            className={styles.notesLabel}
            htmlFor="bulk-candidate-confirm-notes-textarea"
          >
            Reviewer notes (optional)
          </label>
          <textarea
            id="bulk-candidate-confirm-notes-textarea"
            className={styles.notesTextarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note that will be saved on every updated candidate + finding..."
            disabled={inFlight}
            data-testid="bulk-candidate-confirm-notes-textarea"
          />
          <div
            className={`${styles.notesCounter} ${overCap ? styles.notesCounterOver : ''}`}
            data-testid="bulk-candidate-confirm-notes-counter"
          >
            {notes.length} / {NOTES_SOFT_CAP}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={inFlight}
            data-testid="bulk-candidate-confirm-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleConfirm}
            disabled={inFlight}
            data-testid="bulk-candidate-confirm-confirm-button"
          >
            {inFlight && <span className={styles.spinner} aria-hidden="true" />}
            {inFlight ? 'Applying...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
