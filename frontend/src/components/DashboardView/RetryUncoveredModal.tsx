/**
 * RetryUncoveredModal (Spec 2026-07-20 API Behaviour Baseline Coverage Closure).
 *
 * The one-step modal the "Retry uncovered APIs" button opens. It lists the
 * endpoints still missing their happy-path baseline and, per endpoint, lets the
 * user set:
 *   - the LLM attempt budget (default 15) for the Pass B repair loop, and
 *   - free-text notes to the LLM ("try ID=3275, use 'Core' for parameter
 *     'type'").
 * Both are Pass B controls (Pass A runs deterministically first, free, with no
 * config). On launch the collected per-endpoint config drives Coverage Closure.
 *
 * CC3 (this revision) completes the config-capture UI. The `onLaunch` handler is
 * supplied by the host once the server-side closure run is wired; while it is
 * absent the launch control renders disabled with an honest affordance rather
 * than firing a request that would not yet close coverage.
 */
import React, { useState } from 'react';
import type { UnresolvedEndpoint } from './CoverageSummaryPanel';

/** Default per-endpoint LLM attempts (mirrors service DEFAULT_REPAIR_ATTEMPTS). */
export const DEFAULT_ATTEMPTS = 15;

/** Per-endpoint Pass B config the user confirms in the modal. */
export interface EndpointRetryConfig {
  operation_id: string;
  method: string;
  path: string;
  attempts: number;
  notes: string;
}

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
   * Launch closure with the per-endpoint Pass B config. Wired by the host once
   * the server-side run exists; absent → the launch control is disabled.
   */
  onLaunch?: (config: EndpointRetryConfig[]) => void;
  /** Disables inputs + buttons while a launch is in flight. */
  busy?: boolean;
  testId?: string;
}

export const RetryUncoveredModal: React.FC<RetryUncoveredModalProps> = ({
  unresolved,
  classes,
  onClose,
  onLaunch,
  busy = false,
  testId = 'retry-uncovered-modal',
}) => {
  const [config, setConfig] = useState<Record<string, { attempts: number; notes: string }>>(() =>
    Object.fromEntries(
      unresolved.map((u) => [u.operation_id, { attempts: DEFAULT_ATTEMPTS, notes: '' }]),
    ),
  );

  const setAttempts = (id: string, raw: string) => {
    const n = Number.parseInt(raw, 10);
    setConfig((c) => ({
      ...c,
      [id]: { ...c[id], attempts: Number.isFinite(n) && n > 0 ? n : DEFAULT_ATTEMPTS },
    }));
  };
  const setNotes = (id: string, notes: string) => {
    setConfig((c) => ({ ...c, [id]: { ...c[id], notes } }));
  };

  const launch = () => {
    if (!onLaunch) return;
    onLaunch(
      unresolved.map((u) => ({
        operation_id: u.operation_id,
        method: u.method,
        path: u.path,
        attempts: config[u.operation_id]?.attempts ?? DEFAULT_ATTEMPTS,
        notes: (config[u.operation_id]?.notes ?? '').trim(),
      })),
    );
  };

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
            Coverage Closure first runs a free, deterministic pass (replays real IDs
            harvested anywhere in the session and mines the source database for missing
            path-param values). Whatever remains goes to an LLM repair pass — set its
            attempt budget and add any hints per endpoint below.
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
                <label>
                  LLM attempts
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={config[u.operation_id]?.attempts ?? DEFAULT_ATTEMPTS}
                    disabled={busy}
                    data-testid={`${testId}-attempts-${u.operation_id}`}
                    onChange={(e) => setAttempts(u.operation_id, e.target.value)}
                  />
                </label>
                <label>
                  Notes to the LLM
                  <input
                    type="text"
                    placeholder="e.g. try ID=3275, use 'Core' for parameter 'type'"
                    value={config[u.operation_id]?.notes ?? ''}
                    disabled={busy}
                    data-testid={`${testId}-notes-${u.operation_id}`}
                    onChange={(e) => setNotes(u.operation_id, e.target.value)}
                  />
                </label>
              </li>
            ))}
          </ul>
          <div>
            <button
              type="button"
              className={classes.primaryButton}
              data-testid={`${testId}-launch`}
              onClick={launch}
              disabled={!onLaunch || busy}
              title={
                onLaunch
                  ? 'Run Coverage Closure over the uncovered endpoints'
                  : 'Closure run is wired in the next step'
              }
            >
              {busy ? 'Running closure…' : 'Run closure'}
            </button>
            <button
              type="button"
              className={classes.secondaryButton}
              data-testid={`${testId}-close`}
              onClick={onClose}
              disabled={busy}
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
