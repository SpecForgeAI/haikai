/**
 * LlmSoloConfirmDialog Component
 *
 * Spec 2026-04-20: V3 Tier UX -- Task Group 6 (frontend)
 *
 * Confirm dialog shown when `POST /discovery/runs` returns 409 with
 * `LLM_SOLO_CONFIRMATION_REQUIRED`. Renders the backend warnings verbatim
 * and offers a Proceed (LLM-only) / Cancel choice.
 *
 * - On Proceed: the caller retries the same request with `confirmLlmSolo: true`.
 * - On Cancel: the caller aborts silently.
 */

import React from 'react';
import styles from './DiscoveryRunDetailView.module.css';

export interface LlmSoloConfirmDialogProps {
  warnings: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const LlmSoloConfirmDialog: React.FC<LlmSoloConfirmDialogProps> = ({
  warnings,
  onConfirm,
  onCancel,
}) => {
  return (
    <div
      className={styles.confirmDialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="llm-solo-confirm-title"
      data-testid="llm-solo-confirm-dialog"
    >
      <div className={styles.confirmDialog}>
        <h3 id="llm-solo-confirm-title" className={styles.confirmDialogTitle}>
          Proceed in LLM-only mode?
        </h3>
        <div className={styles.confirmDialogBody} data-testid="llm-solo-confirm-body">
          {warnings.length === 1 && <p>{warnings[0]}</p>}
          {warnings.length > 1 && (
            <ul>
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          )}
          {warnings.length === 0 && (
            <p>
              No language or framework pack matches this project. Proceeding will run
              discovery in LLM-only mode.
            </p>
          )}
        </div>
        <div className={styles.confirmDialogActions}>
          <button
            className={`${styles.confirmDialogButton} ${styles.confirmDialogButtonCancel}`}
            onClick={onCancel}
            data-testid="llm-solo-confirm-cancel"
          >
            Cancel
          </button>
          <button
            className={`${styles.confirmDialogButton} ${styles.confirmDialogButtonProceed}`}
            onClick={onConfirm}
            data-testid="llm-solo-confirm-proceed"
          >
            Proceed (LLM-only)
          </button>
        </div>
      </div>
    </div>
  );
};
