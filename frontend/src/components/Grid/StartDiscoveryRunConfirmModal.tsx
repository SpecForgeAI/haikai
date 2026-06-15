/**
 * StartDiscoveryRunConfirmModal
 *
 * 2026-04-22 — Tier-C confirmation dialog for the "Start Discovery Run"
 * context-menu action on the services grid.
 *
 * Shown only after the initial POST is rejected with a 409
 * `LLM_SOLO_CONFIRMATION_REQUIRED` response, indicating that neither a
 * language pack nor a framework pack matched the service's resolved
 * tech hints. The dialog explains what "LLM-only" means and lets the
 * user either Continue (re-POST with `confirmLlmSolo: true`) or Cancel.
 *
 * Layout borrowed from `DeleteDiagramConfirmModal` so the visual
 * behaviour (overlay click to dismiss, Escape to close, header / content
 * / footer) is consistent across the app.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
 *   Always embeds <ArchitectureRunTargetPicker>, even when the project
 *   has only one non-archived architecture. The picker is pre-selected
 *   with `useActiveArchitectureId()` and is the source of truth for the
 *   run-start payload (NOT the URL active id) -- the user may pick a
 *   different architecture than the one they are viewing. The picked id
 *   is bound to the run for life by discovery-service.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArchitectureRunTargetPicker } from '../Discovery/ArchitectureRunTargetPicker';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import styles from './StartDiscoveryRunConfirmModal.module.css';

export interface StartDiscoveryRunConfirmModalProps {
  isOpen: boolean;
  serviceName?: string;
  /** Optional warnings from the 409 response; surfaced verbatim to the user. */
  warnings?: string[];
  onClose: () => void;
  /**
   * Spec #4 Task Group 6: confirm now passes the picker's chosen
   * `architectureId` back to the parent so the run-start retry POST
   * targets the user's explicit choice rather than the URL active id.
   */
  onConfirm: (architectureId: string) => void;
}

export function StartDiscoveryRunConfirmModal({
  isOpen,
  serviceName,
  warnings,
  onClose,
  onConfirm,
}: StartDiscoveryRunConfirmModalProps) {
  // Spec #4 Task Group 6: pre-select the picker with the URL's active
  // architecture id (matches the architecture the user was viewing when
  // they triggered the run). The user may change this in the picker --
  // the picker's value is the source of truth on Confirm.
  const activeArchitectureId = useActiveArchitectureId();
  const [targetArchId, setTargetArchId] = useState<string | null>(activeArchitectureId);

  // Re-seed the picker each time the modal opens so a previous run's
  // override does not persist into the next confirmation dialog.
  useEffect(() => {
    if (isOpen) {
      setTargetArchId(activeArchitectureId);
    }
  }, [isOpen, activeArchitectureId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleConfirmClick = useCallback(() => {
    // Defensive: if no architecture is selected yet (loading race), do
    // nothing -- the parent should ensure the modal only opens once the
    // architectures list has resolved, but this guard prevents an
    // accidental empty-id POST.
    if (!targetArchId) return;
    onConfirm(targetArchId);
  }, [targetArchId, onConfirm]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="start-discovery-run-confirm-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>LLM-only discovery run</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.message}>
            Discovery can't find a language or framework pack that matches
            <strong>{serviceName ? ` ${serviceName}'s` : ' this service\'s'}</strong> tech hints.
            The run will proceed in <strong>LLM-only</strong> mode — results will
            rely entirely on the LLM's interpretation of the source, with no
            deterministic pack coverage.
          </div>
          {warnings && warnings.length > 0 && (
            <ul className={styles.warningList} data-testid="llm-solo-warnings">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {/* Spec #4 Task Group 6 -- always-visible architecture picker.
              Pre-selected with useActiveArchitectureId(); disabled when
              only one non-archived architecture exists. The picker's
              chosen id is the source of truth for the run-start payload. */}
          <ArchitectureRunTargetPicker
            value={targetArchId}
            onChange={setTargetArchId}
          />

          <div className={styles.prompt}>Continue with an LLM-only run?</div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleConfirmClick}
            disabled={!targetArchId}
            data-testid="modal-continue-button"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
