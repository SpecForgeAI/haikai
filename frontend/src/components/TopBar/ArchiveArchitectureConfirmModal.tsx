/**
 * ArchiveArchitectureConfirmModal
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 6
 *
 * Confirmation modal modelled on `DeleteDiagramConfirmModal.tsx`. Asks the
 * user to confirm archiving an architecture and, when the architecture being
 * archived is the currently-active one, warns that they will be moved to the
 * next-oldest non-archived architecture before performing the archive.
 *
 * Key behaviours:
 *   - Renders nothing when `architecture === null` (the parent toggles the
 *     modal by passing the row to archive or null).
 *
 *   - Body copy:
 *       Always: "Archive '<name>'? This architecture will be hidden from the
 *               selector. You can't restore archived architectures yet."
 *       When the architecture is the currently-active one, prepend an
 *       active-warning paragraph naming the resolved next-oldest non-archived:
 *               "You're archiving the architecture you're currently viewing.
 *               You'll be moved to '<nextName>'."
 *
 *   - Confirm flow:
 *       1. Disable the buttons + show "Archiving..." while in flight.
 *       2. Call archiveArchitecture(projectId, architecture.id).
 *       3. On success:
 *            - If active architecture was being archived, call
 *              setActiveArchitecture(nextId) to move the URL/state across.
 *            - refreshArchitectures() so the list shows the archived row gone.
 *            - Fire success toast: "Architecture '<name>' archived."
 *            - onClose().
 *       4. On 422 ({code: 'last_architecture'}): server race -- keep the
 *          modal open, render the inline error from body.message. This is
 *          rare since the Manage modal disables Archive on the only-remaining
 *          row, but the server is the source of truth.
 *       5. On any other failure: render a generic inline error and keep the
 *          modal open.
 *
 *   - Esc / X close are disabled while a request is in flight (prevents the
 *     confusing case of the modal vanishing mid-request and the toast firing
 *     against a now-orphaned UI).
 *
 *   - Defensive fallback when `isActive && !nextArchitecture`: should be
 *     unreachable because Group 5's Manage modal disables Archive on the
 *     only-remaining row, but if we get here we render a fallback message and
 *     disable Confirm so the user can't trigger a guaranteed-422 round-trip.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Architecture,
  ArchitecturesApiError,
  archiveArchitecture,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import styles from './ArchiveArchitectureConfirmModal.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ArchiveArchitectureConfirmModalProps {
  /**
   * The architecture to archive. When null, the modal is hidden -- the
   * parent toggles by setting this to the row to confirm or back to null.
   */
  architecture: Architecture | null;
  /** Project the architecture lives in. */
  projectId: string;
  /** Called when the modal should close (Cancel, Escape, X, or success). */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sort architectures oldest-first by `createdAt`. Falls back to `id`
 * lexicographic order when timestamps are equal so the ordering is
 * deterministic. Mirrors the helper used by ManageArchitecturesModal so the
 * "next-oldest" resolution matches what the user sees in the manage list.
 */
function sortOldestFirst(architectures: Architecture[]): Architecture[] {
  return [...architectures].sort((a, b) => {
    const timeA = Date.parse(a.createdAt);
    const timeB = Date.parse(b.createdAt);
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArchiveArchitectureConfirmModal({
  architecture,
  projectId,
  onClose,
}: ArchiveArchitectureConfirmModalProps) {
  const {
    architectures,
    activeArchitectureId,
    refreshArchitectures,
    setActiveArchitecture,
  } = useArchitectureContext();
  const { showToast } = useToast();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset transient state every time the parent flips the modal open against
  // a (possibly different) architecture row -- otherwise stale errors from a
  // previous attempt would leak across opens.
  useEffect(() => {
    if (architecture) {
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [architecture]);

  // ---- Active + next-architecture resolution ----------------------------
  // `isActive` and `nextArchitecture` are computed from context state at
  // render time. The "next" is the new oldest non-archived after excluding
  // the row being archived -- this is the row the URL will be moved to when
  // the active architecture is archived.
  const isActive = !!architecture && architecture.id === activeArchitectureId;

  const nextArchitecture = useMemo<Architecture | null>(() => {
    if (!architecture) return null;
    if (!isActive) return null;
    const candidates = (architectures ?? []).filter(
      a => !a.archived && a.id !== architecture.id
    );
    const sorted = sortOldestFirst(candidates);
    return sorted[0] ?? null;
  }, [architecture, isActive, architectures]);

  // ---- Escape-to-close (disabled while in-flight) -----------------------
  useEffect(() => {
    if (!architecture) return;
    if (isSubmitting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [architecture, isSubmitting, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (isSubmitting) return;
      // Only close on a click directly on the overlay backdrop.
      if (e.target === e.currentTarget) onClose();
    },
    [isSubmitting, onClose]
  );

  // ---- Confirm -----------------------------------------------------------
  const handleConfirm = useCallback(async () => {
    if (!architecture) return;
    if (isSubmitting) return;

    // Defensive guard: if we somehow ended up in the unreachable state
    // (active + no next), block the request -- the server would return 422
    // anyway and this is a cleaner UX.
    if (isActive && !nextArchitecture) {
      setErrorMessage(
        "Can't archive -- no other non-archived architecture is available to move to."
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await archiveArchitecture(projectId, architecture.id);

      // If we were archiving the active architecture, explicitly move the
      // URL across before refresh so the user immediately sees the new
      // active. (Spec #2's <ProjectLayout> redirect is the safety net for
      // a stale `:architectureId`, but explicit navigation is faster.)
      if (isActive && nextArchitecture) {
        setActiveArchitecture(nextArchitecture.id);
      }

      await refreshArchitectures();
      showToast(`Architecture '${architecture.name}' archived.`, 'success');
      onClose();
    } catch (err) {
      if (err instanceof ArchitecturesApiError) {
        if (err.status === 422 && err.body?.code === 'last_architecture') {
          // Server race: another tab / API call beat us to the last
          // architecture. Surface the localised message verbatim and
          // keep the modal open so the user can decide what to do.
          setErrorMessage(
            err.body.message ?? 'A project must have at least one architecture.'
          );
        } else {
          setErrorMessage(
            err.body?.message ?? 'Could not archive -- please try again.'
          );
        }
      } else {
        setErrorMessage('Could not archive -- please try again.');
      }
      setIsSubmitting(false);
    }
  }, [
    architecture,
    isSubmitting,
    isActive,
    nextArchitecture,
    projectId,
    refreshArchitectures,
    setActiveArchitecture,
    showToast,
    onClose,
  ]);

  // ---- Render ------------------------------------------------------------
  if (!architecture) return null;

  const confirmDisabled =
    isSubmitting || (isActive && !nextArchitecture);
  const confirmLabel = isSubmitting ? 'Archiving...' : 'Archive';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="archive-architecture-confirm-modal"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-architecture-confirm-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="archive-architecture-confirm-title">
            Archive architecture?
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
            data-testid="archive-architecture-close-x"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {isActive && nextArchitecture && (
            <p
              className={styles.activeWarning}
              data-testid="archive-architecture-active-warning"
            >
              You're archiving the architecture you're currently viewing. You'll
              be moved to '{nextArchitecture.name}'.
            </p>
          )}
          {isActive && !nextArchitecture && (
            <p
              className={styles.activeWarning}
              data-testid="archive-architecture-no-next"
            >
              No other non-archived architecture is available to move to. The
              server will reject this archive.
            </p>
          )}
          <div
            className={styles.message}
            data-testid="archive-architecture-message"
          >
            Archive '{architecture.name}'? This architecture will be hidden from
            the selector. You can't restore archived architectures yet.
          </div>
          {errorMessage && (
            <div
              className={styles.errorMessage}
              role="alert"
              data-testid="archive-architecture-error"
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="archive-architecture-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={handleConfirm}
            disabled={confirmDisabled}
            data-testid="archive-architecture-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ArchiveArchitectureConfirmModal;
