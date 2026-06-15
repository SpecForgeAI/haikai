/**
 * SaveTargetArchitecturePickerModal
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 8
 *
 * Picker modal that fires when an LLM in a `clarify-at-save`-mode task
 * (V1: `ux-designer--users-interactions`, `ux-designer--ui-domain`) signals
 * "ready to save". Lets the user pick the target architecture before the
 * save proceeds; pre-filled with the URL-active architecture so the common
 * case is one-click confirm.
 *
 * Modeled on `frontend/src/components/Discovery/SaveBackConfirmModal.tsx`
 * (spec #4 Group 8) -- same shell semantics:
 *   - Renders nothing when `open === false` (parent toggles via state).
 *   - Esc-to-close, X close, click-outside-to-close, Cancel -- all disabled
 *     while a request is in flight (prevents the modal vanishing mid-save
 *     and the parent firing post-close handlers against an orphaned UI).
 *   - Confirm flow:
 *       1. Disable buttons + show "Saving..." while in flight.
 *       2. Await `onConfirm(architectureId)`.
 *       3. On success: call `onClose()`.
 *       4. On error: render the error inline and KEEP THE MODAL OPEN so the
 *          user can read what went wrong and retry / cancel.
 *
 * Body:
 *   - Single explanation line: `Choose the architecture to save this <taskName> output to.`
 *   - <select> listing all non-archived architectures from
 *     `useArchitectureContext().architectures`, oldest-first (the backend
 *     contract for the architectures list -- spec #1 / spec #2). Pre-selected
 *     with `defaultArchitectureId` (typically `useActiveArchitectureId()`
 *     from the caller).
 *
 * Footer:
 *   - Cancel (calls `onClose`)
 *   - Primary: `Save to <selected-name>` -- updates as the user changes the
 *     selection so the affordance stays explicit about where the output lands.
 *
 * Architecture-list source: `useArchitectureContext().architectures`. The
 * caller does not pass the list in -- the modal is meant to be the single
 * place the picker UI lives, so it owns the data fetch via the existing
 * context. The caller only supplies the default selection (typically the
 * URL-active id) so the picker pre-fills correctly even if the user has
 * navigated away from the URL that opened the conversation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import styles from './SaveTargetArchitecturePickerModal.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SaveTargetArchitecturePickerModalProps {
  /** Whether the modal is visible. The parent toggles this. */
  open: boolean;
  /** Called when the modal should close (Cancel, Escape, X, or success). */
  onClose: () => void;
  /**
   * Called with the user's chosen `architectureId` when they click Save.
   * The modal awaits this and keeps itself open if it throws (so the inline
   * error is visible and the user can retry / cancel).
   */
  onConfirm: (architectureId: string) => Promise<void>;
  /**
   * Pre-selected architecture id. The caller typically passes
   * `useActiveArchitectureId()` so the URL-active architecture is the
   * default. If null/undefined OR the id is not in the (non-archived)
   * architectures list, the picker falls back to the first non-archived
   * architecture (oldest-first).
   */
  defaultArchitectureId?: string | null;
  /**
   * Human-readable name of the task that triggered the picker (e.g.
   * `ux-designer--users-interactions`). Surfaced in the body explanation
   * sentence so the user understands which output the chosen architecture
   * will receive.
   */
  taskName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SaveTargetArchitecturePickerModal({
  open,
  onClose,
  onConfirm,
  defaultArchitectureId,
  taskName,
}: SaveTargetArchitecturePickerModalProps) {
  const { architectures } = useArchitectureContext();

  // Filter to non-archived. The architectures list is already oldest-first by
  // the backend contract (spec #1 / spec #2), so the filter preserves order.
  const candidateArchitectures = useMemo(
    () => architectures.filter((a) => !a.archived),
    [architectures]
  );

  // Resolve the initial selection: the explicit default if present in the
  // candidate list, otherwise the first (oldest) non-archived architecture.
  const resolveInitialSelection = useCallback((): string => {
    if (
      defaultArchitectureId &&
      candidateArchitectures.some((a) => a.id === defaultArchitectureId)
    ) {
      return defaultArchitectureId;
    }
    return candidateArchitectures[0]?.id ?? '';
  }, [defaultArchitectureId, candidateArchitectures]);

  const [selectedId, setSelectedId] = useState<string>(resolveInitialSelection);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset transient state every time the parent flips the modal open. Without
  // this, stale errors / selections from a previous open would leak across.
  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      setIsSubmitting(false);
      setSelectedId(resolveInitialSelection());
    }
  }, [open, resolveInitialSelection]);

  // Esc-to-close (disabled while in-flight).
  useEffect(() => {
    if (!open) return;
    if (isSubmitting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, isSubmitting, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (isSubmitting) return;
      // Only close on a click directly on the overlay backdrop.
      if (e.target === e.currentTarget) onClose();
    },
    [isSubmitting, onClose]
  );

  const handleSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedId(e.target.value);
    },
    []
  );

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) return;
    if (!selectedId) return; // Defensive: button should be disabled in this state.

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onConfirm(selectedId);
      onClose();
    } catch (err) {
      // Keep the modal open and surface the inline error so the user can read
      // what went wrong and decide whether to retry or cancel.
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not save -- please try again.'
      );
      setIsSubmitting(false);
    }
  }, [isSubmitting, selectedId, onConfirm, onClose]);

  if (!open) return null;

  const selectedArch = candidateArchitectures.find((a) => a.id === selectedId);
  const selectedName = selectedArch?.name ?? '';
  const confirmLabel = isSubmitting
    ? 'Saving...'
    : selectedName
      ? `Save to ${selectedName}`
      : 'Save';
  const confirmDisabled = isSubmitting || !selectedId;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="save-target-arch-picker-modal"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-target-arch-picker-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="save-target-arch-picker-title">
            Save target architecture
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
            data-testid="save-target-arch-picker-close-x"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          <div
            className={styles.message}
            data-testid="save-target-arch-picker-message"
          >
            Choose the architecture to save this {taskName} output to.
          </div>

          <label
            className={styles.fieldLabel}
            htmlFor="save-target-arch-picker-select"
          >
            Architecture
          </label>
          <select
            id="save-target-arch-picker-select"
            className={styles.select}
            value={selectedId}
            onChange={handleSelectChange}
            disabled={isSubmitting || candidateArchitectures.length === 0}
            data-testid="save-target-arch-picker-select"
          >
            {candidateArchitectures.length === 0 ? (
              <option value="" disabled>
                No architectures available
              </option>
            ) : (
              candidateArchitectures.map((arch) => (
                <option key={arch.id} value={arch.id}>
                  {arch.name}
                </option>
              ))
            )}
          </select>

          {errorMessage && (
            <div
              className={styles.errorMessage}
              role="alert"
              data-testid="save-target-arch-picker-error"
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
            data-testid="save-target-arch-picker-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleConfirm}
            disabled={confirmDisabled}
            data-testid="save-target-arch-picker-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SaveTargetArchitecturePickerModal;
