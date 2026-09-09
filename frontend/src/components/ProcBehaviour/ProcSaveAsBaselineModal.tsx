/**
 * ProcSaveAsBaselineModal — promote a proc capture session's accepted
 * captures into a durable proc behaviour baseline (Spec 3, 2026-09-09).
 *
 * The canonical capture per scenario is chosen server-side (first accepted
 * capture with a clean|compensated bracket outcome), so this modal only
 * carries the reviewer's intent: a name and whether to pin. Pinning
 * supersedes the previous pinned baseline of the kind, which is why it
 * defaults ON — the workbench and the execution check both replay the
 * PINNED baseline.
 */

import React, { useState } from 'react';
import styles from '../DashboardView/ApiBaselinesListPage.module.css';
import proc from './ProcBehaviour.module.css';

export interface ProcSaveAsBaselineModalProps {
  defaultName: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (name: string, pin: boolean) => void;
  testId?: string;
}

export const ProcSaveAsBaselineModal: React.FC<ProcSaveAsBaselineModalProps> = ({
  defaultName,
  busy = false,
  error = null,
  onClose,
  onSave,
  testId = 'proc-save-baseline-modal',
}) => {
  const [name, setName] = useState(defaultName);
  const [pin, setPin] = useState(true);

  return (
    <div className={styles.diffModalBackdrop} data-testid={`${testId}-backdrop`} role="presentation">
      <div
        className={styles.diffModalPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Save as proc behaviour baseline"
        data-testid={testId}
      >
        <div className={styles.diffModalHeader}>
          <strong>Save as proc behaviour baseline</strong>
        </div>
        <div className={styles.diffModalBody}>
          {error && (
            <div className={styles.errorBanner} data-testid={`${testId}-error`}>
              {error}
            </div>
          )}
          <label className={styles.detailKey} htmlFor="proc-baseline-name">
            Baseline name
          </label>
          <input
            id="proc-baseline-name"
            className={proc.reasonInput}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            data-testid={`${testId}-name`}
          />
          <label className={proc.hint} style={{ display: 'block', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={pin}
              disabled={busy}
              onChange={(e) => setPin(e.target.checked)}
              data-testid={`${testId}-pin`}
            />{' '}
            Pin this baseline (supersedes the current pinned baseline of this
            kind; the workbench and the DB-plane check replay the pinned one).
          </label>
        </div>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={busy}
            data-testid={`${testId}-cancel`}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onSave(name.trim(), pin)}
            disabled={busy || name.trim() === ''}
            data-testid={`${testId}-confirm`}
          >
            {busy ? 'Saving…' : 'Save baseline'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProcSaveAsBaselineModal;
