/**
 * CascadeSummaryControls
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5, Surface 4
 *
 * Renders a `cascade-summary` turn's proposed `cascadedDecisions[]` with
 * per-cascade controls (accept / override) plus an "Accept all" button that
 * fires the gateway batch endpoint (per Q10 -- N rows sharing one
 * `conversation_turn_ref`).
 *
 * Per-cascade override opens an inline reason input; submission records
 * `wasOverridden: true` + `overrideReason` for that single cascade only.
 *
 * Per Q18 the 60-second per-turn frontend timeout is owned by the API client
 * (`architectConversationApi.ts`); on timeout it throws which the caller
 * surfaces as an error toast + retry button.
 */

import { useState } from 'react';
import type {
  CascadeSummaryEntry,
  CascadeSummaryTurn,
} from '../../../api/architectConversationApi';
import styles from './ArchitectConversation.module.css';

export interface CascadeSummaryControlsProps {
  turn: CascadeSummaryTurn;
  /** The parent decision id this cascade was triggered by. */
  parentDecisionId: string;
  /** Whether the batch / override calls are in-flight. */
  busy: boolean;
  error: string | null;
  onAcceptAll: (proposals: CascadeSummaryEntry[]) => Promise<void> | void;
  onOverrideOne: (proposal: CascadeSummaryEntry, overrideValue: string, reason: string) => Promise<void> | void;
  onRetry?: () => void;
}

interface OverrideDraft {
  proposalIndex: number;
  overrideValue: string;
  reason: string;
}

export function CascadeSummaryControls({
  turn,
  parentDecisionId,
  busy,
  error,
  onAcceptAll,
  onOverrideOne,
  onRetry,
}: CascadeSummaryControlsProps) {
  const [override, setOverride] = useState<OverrideDraft | null>(null);

  const handleAcceptAll = () => {
    void onAcceptAll(turn.cascadedDecisions);
  };

  const beginOverride = (index: number, currentProposed: unknown) => {
    setOverride({
      proposalIndex: index,
      overrideValue: typeof currentProposed === 'string' ? currentProposed : '',
      reason: '',
    });
  };

  const submitOverride = () => {
    if (!override) return;
    const proposal = turn.cascadedDecisions[override.proposalIndex];
    void onOverrideOne(proposal, override.overrideValue, override.reason);
    setOverride(null);
  };

  return (
    <div
      className={`${styles.turn} ${styles.turnCascadeSummary}`}
      data-testid="architect-conversation-cascade-summary"
      data-parent-decision-id={parentDecisionId}
    >
      <div className={styles.turnLabel}>Cascade summary</div>
      <p style={{ margin: 0 }}>
        Based on your answer, we propose pre-filling{' '}
        {turn.cascadedDecisions.length} downstream decision
        {turn.cascadedDecisions.length === 1 ? '' : 's'}:
      </p>

      <div className={styles.cascadeList}>
        {turn.cascadedDecisions.map((proposal, idx) => {
          const isOverriding = override?.proposalIndex === idx;
          return (
            <div
              key={proposal.decisionCode}
              className={styles.cascadeRow}
              data-testid={`architect-conversation-cascade-row-${proposal.decisionCode}`}
            >
              <div className={styles.cascadeRowMeta}>
                <span>
                  <strong>{proposal.decisionCode}</strong> →{' '}
                  {String(proposal.proposedValue)}
                </span>
                <span style={{ color: '#57606a', fontSize: '0.75rem' }}>
                  {proposal.sourceStandardId}
                </span>
              </div>
              {!isOverriding && (
                <div className={styles.cascadeRowControls}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => beginOverride(idx, proposal.proposedValue)}
                    disabled={busy}
                    data-testid={`architect-conversation-cascade-override-button-${proposal.decisionCode}`}
                  >
                    Override
                  </button>
                </div>
              )}
              {isOverriding && (
                <div className={styles.cascadeRowOverrideInput}>
                  <input
                    type="text"
                    className={styles.inputField}
                    value={override.overrideValue}
                    onChange={(e) =>
                      setOverride({ ...override, overrideValue: e.target.value })
                    }
                    placeholder="Override value"
                    data-testid={`architect-conversation-cascade-override-value-${proposal.decisionCode}`}
                  />
                  <input
                    type="text"
                    className={styles.inputField}
                    value={override.reason}
                    onChange={(e) =>
                      setOverride({ ...override, reason: e.target.value })
                    }
                    placeholder="Reason for override"
                    data-testid={`architect-conversation-cascade-override-reason-${proposal.decisionCode}`}
                  />
                  <div className={styles.cascadeRowControls}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setOverride(null)}
                      data-testid={`architect-conversation-cascade-override-cancel-${proposal.decisionCode}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={!override.reason.trim() || busy}
                      onClick={submitOverride}
                      data-testid={`architect-conversation-cascade-override-submit-${proposal.decisionCode}`}
                    >
                      Submit override
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleAcceptAll}
          disabled={busy || !!override}
          data-testid="architect-conversation-cascade-accept-all"
        >
          {busy ? (
            <>
              <span className={styles.spinner} aria-hidden="true" /> Thinking...
            </>
          ) : (
            `Accept all (${turn.cascadedDecisions.length})`
          )}
        </button>
      </div>

      {error && (
        <div
          className={`${styles.banner} ${styles.bannerError}`}
          role="alert"
          data-testid="architect-conversation-cascade-error"
        >
          {error}
          {onRetry && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={onRetry}
              data-testid="architect-conversation-cascade-retry"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
