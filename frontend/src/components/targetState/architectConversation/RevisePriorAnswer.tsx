/**
 * RevisePriorAnswer
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5, Surface 7
 *
 * Inline edit dialog for revising a prior captured-decision row. Submitting
 * triggers a new superseding POST (insert-only per settled decision #10) and
 * the gateway returns the `edit-superseded` turn carrying the Q6
 * `affectedDownstreamCodes[]` banner payload. The downstream-codes banner is
 * rendered separately by `DownstreamCodesBanner` below.
 *
 * Per Q6 there is NO auto-replay -- dismissing the banner does not reset any
 * downstream decision; the cascaded codes remain at their original values
 * until the user manually re-visits them.
 */

import { useState } from 'react';
import type {
  CapturedDecisionRow,
  DecisionScope,
} from '../../../api/architectConversationApi';
import styles from './ArchitectConversation.module.css';

export interface RevisePriorAnswerDialogProps {
  decision: CapturedDecisionRow;
  onSubmit: (args: {
    newAnswerValue: string;
    scope?: DecisionScope;
  }) => Promise<void> | void;
  onCancel: () => void;
}

export function RevisePriorAnswerDialog({
  decision,
  onSubmit,
  onCancel,
}: RevisePriorAnswerDialogProps) {
  const [newValue, setNewValue] = useState(decision.answerValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const scope: DecisionScope =
        decision.scopeKind === 'element' && decision.scopeRefType && decision.scopeRefId
          ? {
              kind: 'element',
              refType: decision.scopeRefType,
              refId: decision.scopeRefId,
            }
          : { kind: 'architecture' };
      await onSubmit({ newAnswerValue: newValue.trim(), scope });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revise prior answer';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      data-testid="architect-conversation-revise-dialog"
    >
      <div className={styles.modal}>
        <h3>Revise {decision.decisionCode}</h3>
        <p style={{ fontSize: '0.85rem', color: '#57606a', margin: 0 }}>
          A new superseding decision row will be written. Downstream cascaded
          decisions will be listed for your review but not re-applied
          automatically.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.85rem' }}>New answer value</span>
          <input
            type="text"
            className={styles.inputField}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            data-testid="architect-conversation-revise-value-input"
          />
        </label>

        {error && (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            {error}
          </div>
        )}

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
            data-testid="architect-conversation-revise-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!newValue.trim() || submitting}
            onClick={() => void handleSubmit()}
            data-testid="architect-conversation-revise-submit"
          >
            {submitting ? 'Submitting...' : 'Save revision'}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface DownstreamCodesBannerProps {
  affectedDownstreamCodes: string[];
  onDismiss: () => void;
}

/**
 * Q6 banner surfaced after a revision lands. Lists the downstream cascaded
 * decision codes the user may want to re-visit. NO auto-replay (per Q6).
 */
export function DownstreamCodesBanner({
  affectedDownstreamCodes,
  onDismiss,
}: DownstreamCodesBannerProps) {
  if (affectedDownstreamCodes.length === 0) return null;
  return (
    <div
      className={styles.banner}
      data-testid="architect-conversation-downstream-codes-banner"
    >
      <span>
        You revised an upstream decision. Consider re-visiting these downstream
        cascaded decisions:{' '}
        <strong>{affectedDownstreamCodes.join(', ')}</strong>. They remain at
        their previous values.
      </span>
      <button
        type="button"
        className={styles.linkButton}
        onClick={onDismiss}
        data-testid="architect-conversation-downstream-codes-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
