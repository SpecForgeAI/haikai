/**
 * RetryUncoveredModal (Spec 2026-07-20 API Behaviour Baseline Coverage Closure).
 *
 * The one-step modal the "Retry uncovered APIs" button opens. It lists the
 * endpoints still missing their happy-path baseline and lets the user launch
 * Coverage Closure over them.
 *
 * CC1 (this revision) establishes the modal shell + the uncovered list. CC3
 * adds the per-endpoint controls the user asked for -- an editable LLM
 * attempt count (default 15) and a free-text notes-to-the-LLM field per
 * endpoint -- plus the submit that drives the server-side closure run. The
 * component is kept deliberately small and prop-driven so CC3 extends it
 * without a rewrite.
 */
import React from 'react';
import type { UnresolvedEndpoint } from './CoverageSummaryPanel';

export interface RetryUncoveredModalClasses {
  backdrop: string;
  panel: string;
  header: string;
  body: string;
  primaryButton: string;
  secondaryButton: string;
}

export interface RetryUncoveredModalProps {
  unresolved: UnresolvedEndpoint[];
  classes: RetryUncoveredModalClasses;
  onClose: () => void;
  /**
   * Launch closure for the listed endpoints. Wired in CC3 (deterministic Pass A
   * + LLM Pass B with the per-endpoint attempts/notes). Absent in CC1, so the
   * launch control renders disabled with a "coming in closure" affordance.
   */
  onLaunch?: () => void;
  testId?: string;
}

export const RetryUncoveredModal: React.FC<RetryUncoveredModalProps> = ({
  unresolved,
  classes,
  onClose,
  onLaunch,
  testId = 'retry-uncovered-modal',
}) => {
  return (
    <div className={classes.backdrop} data-testid={`${testId}-backdrop`} role="presentation">
      <div
        className={classes.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Retry uncovered APIs"
        data-testid={testId}
      >
        <div className={classes.header}>
          <strong>Retry uncovered APIs</strong>
          <span data-testid={`${testId}-count`}>
            {unresolved.length} endpoint{unresolved.length === 1 ? '' : 's'} without a
            happy-path baseline
          </span>
        </div>
        <div className={classes.body}>
          <p>
            Coverage Closure re-attempts these endpoints — first a free,
            deterministic pass that replays real IDs harvested anywhere in the
            session and mines the source database for missing path-param values,
            then an LLM repair pass for whatever remains.
          </p>
          <ul data-testid={`${testId}-list`}>
            {unresolved.map((u) => (
              <li
                key={u.operation_id}
                data-testid={`${testId}-row`}
                data-operation-id={u.operation_id}
              >
                <code>
                  {(u.method || '').toUpperCase()} {u.path || u.operation_id}
                </code>
                <span>{u.reason}</span>
              </li>
            ))}
          </ul>
          <div>
            <button
              type="button"
              className={classes.primaryButton}
              data-testid={`${testId}-launch`}
              onClick={onLaunch}
              disabled={!onLaunch}
              title={
                onLaunch
                  ? 'Run Coverage Closure over the uncovered endpoints'
                  : 'Closure run is wired in the next step'
              }
            >
              Run closure
            </button>
            <button
              type="button"
              className={classes.secondaryButton}
              data-testid={`${testId}-close`}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RetryUncoveredModal;
