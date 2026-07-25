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
   * `includeOtherDimensions` reflects the dimensional-retry checkbox
   * (2026-07-25): also repair the other failed coverage dimensions so the
   * full request/response rubric climbs to 100%, not just the happy path.
   */
  onLaunch?: (config: EndpointRetryConfig[], includeOtherDimensions: boolean) => void;
  /**
   * How many failed NON-happy coverage dimensions exist across the session
   * (from the coverage summary). > 0 renders the dimensional-retry checkbox.
   */
  failedDimensionsCount?: number;
  /** Disables inputs + buttons while a launch is in flight. */
  busy?: boolean;
  /** Progress / error note shown after a closure run (e.g. "closed 3; 2 left"). */
  note?: string | null;
  /**
   * Pass C: download ALL endpoints (covered + uncovered) as a Postman
   * collection. When omitted the button is not rendered.
   */
  onDownloadPostman?: () => void;
  /**
   * Pass C: exclude-with-reason for a genuinely uncapturable endpoint. Called
   * with the operation id + the reason (the row's notes value). When omitted
   * the per-row exclude button is not rendered.
   */
  onExclude?: (operationId: string, reason: string) => void;
  testId?: string;
}

export const RetryUncoveredModal: React.FC<RetryUncoveredModalProps> = ({
  unresolved,
  classes,
  onClose,
  onLaunch,
  failedDimensionsCount = 0,
  busy = false,
  note = null,
  onDownloadPostman,
  onExclude,
  testId = 'retry-uncovered-modal',
}) => {
  const [config, setConfig] = useState<Record<string, { attempts: number; notes: string }>>(() =>
    Object.fromEntries(
      unresolved.map((u) => [u.operation_id, { attempts: DEFAULT_ATTEMPTS, notes: '' }]),
    ),
  );
  const [includeOtherDimensions, setIncludeOtherDimensions] = useState(false);
  // Dimensional-only mode (2026-07-25): every happy-path baseline is complete,
  // so there are no unresolved endpoints to configure — the run exists purely
  // to re-attempt the failed coverage scenarios, and the flag is implied.
  const dimensionalOnly = unresolved.length === 0 && failedDimensionsCount > 0;

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
      dimensionalOnly || (includeOtherDimensions && failedDimensionsCount > 0),
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
          <strong>{dimensionalOnly ? 'Re-attempt failed scenarios' : 'Retry uncovered APIs'}</strong>
          <span data-testid={`${testId}-count`}>
            {dimensionalOnly
              ? `${failedDimensionsCount} failed coverage scenario${
                  failedDimensionsCount === 1 ? '' : 's'
                } — all happy-path baselines are complete`
              : `${unresolved.length} endpoint${unresolved.length === 1 ? '' : 's'} without a
            happy-path baseline`}
          </span>
        </div>
        <div className={classes.body}>
          {dimensionalOnly ? (
            <p>
              Every included endpoint already has its happy-path baseline. This run
              re-attempts the remaining failed coverage scenarios — error paths,
              auth-negative and similar — each judged against its own intended
              behaviour class. Existing baselines are untouched.
            </p>
          ) : (
          <p>
            Coverage Closure first runs a free, deterministic pass (replays real IDs
            harvested anywhere in the session and mines the source database for missing
            path-param values). Whatever remains goes to an LLM repair pass — set its
            attempt budget and add any hints per endpoint below.
          </p>
          )}
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
                {onExclude && (
                  <button
                    type="button"
                    className={classes.secondaryButton}
                    data-testid={`${testId}-exclude-${u.operation_id}`}
                    disabled={busy || (config[u.operation_id]?.notes ?? '').trim().length === 0}
                    title="Exclude this endpoint from the baseline — uses the notes above as the audited reason"
                    onClick={() =>
                      onExclude(u.operation_id, (config[u.operation_id]?.notes ?? '').trim())
                    }
                  >
                    Exclude (reason = notes)
                  </button>
                )}
              </li>
            ))}
          </ul>
          {failedDimensionsCount > 0 && !dimensionalOnly && (
            <label data-testid={`${testId}-dimensions-toggle`}>
              <input
                type="checkbox"
                checked={includeOtherDimensions}
                disabled={busy}
                data-testid={`${testId}-dimensions-checkbox`}
                onChange={(e) => setIncludeOtherDimensions(e.target.checked)}
              />
              Also re-attempt other failed coverage scenarios ({failedDimensionsCount}) —
              error paths, auth-negative and similar scenarios that never captured
              their intended behaviour. The gate stays happy-path-only; this drives
              the full request/response coverage toward 100%.
            </label>
          )}
          {note && (
            <p data-testid={`${testId}-note`} role="status">
              {note}
            </p>
          )}
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
              {busy
                ? 'Running closure…'
                : dimensionalOnly
                  ? 'Re-attempt failed scenarios'
                  : 'Run closure'}
            </button>
            {onDownloadPostman && (
              <button
                type="button"
                className={classes.secondaryButton}
                data-testid={`${testId}-postman`}
                onClick={onDownloadPostman}
                disabled={busy}
                title="Download all endpoints as a Postman collection — fix the uncovered ones and re-upload"
              >
                Download Postman collection
              </button>
            )}
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
          {onDownloadPostman && (
            <p data-testid={`${testId}-postman-hint`}>
              Prefer to fix these by hand? Download every endpoint as a Postman
              collection — covered ones carry their proven request as a reference,
              uncovered ones carry the last attempt + the failure reason. Fix them
              in Postman, then re-upload via “Append a Postman collection”; only the
              uncovered endpoints are re-attempted.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RetryUncoveredModal;
