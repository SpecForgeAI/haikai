/**
 * RetryUncoveredModal — Coverage Closure control (Spec 2026-07-20; table
 * redesign 2026-08-02).
 *
 * A single wide table of EVERY missing coverage scenario — happy-path
 * baselines (the gate) AND other failed scenarios (error paths, auth-negative,
 * …), one row each with a Type badge. Per row: the LLM attempt budget, hints
 * for the repair pass, and a "Not possible" toggle.
 *
 * "Not possible" removes the row from the closure run AND excludes it from the
 * coverage population with an audited reason (the row's notes): a happy-path
 * row excludes the whole operation from the gate denominator; an "other" row
 * excludes just that failed dimension. A compact "Include other failed
 * coverage scenarios" checkbox beside the buttons governs whether the "other"
 * rows take part in the run (the table always shows them).
 */
import React, { useMemo, useState } from 'react';
import type { UnresolvedEndpoint } from './CoverageSummaryPanel';
import type { FailedDimensionItem } from './CoverageSummaryPanel';
import modal from './RetryUncoveredModal.module.css';

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

/** A unified table row: a happy-path baseline OR an other failed scenario. */
type RowKind = 'happy' | 'other';
interface TableRow {
  key: string;
  kind: RowKind;
  operation_id: string;
  method: string;
  path: string;
  /** Present only for `other` rows — the dimension identity for exclusion. */
  scenarioName?: string;
  reason: string | null;
}

export interface RetryUncoveredModalProps {
  /** Happy-path baselines still missing (the gate denominator). */
  unresolved: UnresolvedEndpoint[];
  /** Other failed non-happy scenarios (error paths, auth-negative, …). */
  failedDimensions?: FailedDimensionItem[];
  classes: RetryUncoveredModalClasses;
  onClose: () => void;
  /**
   * Launch closure with the per-endpoint Pass B config for the NON-excluded
   * happy-path rows. `includeOtherDimensions` reflects the checkbox.
   */
  onLaunch?: (config: EndpointRetryConfig[], includeOtherDimensions: boolean) => void;
  /**
   * Exclude-with-reason. `scenarioName` present → dimension-level exclusion of
   * an `other` row; absent → the whole endpoint (happy-path row). When omitted
   * the "Not possible" control is not rendered.
   */
  onExclude?: (operationId: string, reason: string, scenarioName?: string) => void;
  /** Disables inputs + buttons while a launch/exclude is in flight. */
  busy?: boolean;
  /** Progress / error note shown after a run (e.g. "closed 3; 2 left"). */
  note?: string | null;
  /** Pass C: download ALL endpoints as a Postman collection. */
  onDownloadPostman?: () => void;
  testId?: string;
}

export const RetryUncoveredModal: React.FC<RetryUncoveredModalProps> = ({
  unresolved,
  failedDimensions = [],
  classes,
  onClose,
  onLaunch,
  onExclude,
  busy = false,
  note = null,
  onDownloadPostman,
  testId = 'retry-uncovered-modal',
}) => {
  const rows = useMemo<TableRow[]>(() => {
    const happy: TableRow[] = unresolved.map((u) => ({
      key: `happy:${u.operation_id}`,
      kind: 'happy',
      operation_id: u.operation_id,
      method: u.method,
      path: u.path,
      reason: u.reason ?? null,
    }));
    const other: TableRow[] = failedDimensions.map((d) => ({
      key: `other:${d.operation_id}:${d.name}`,
      kind: 'other',
      operation_id: d.operation_id,
      method: d.method,
      path: d.path,
      scenarioName: d.name,
      reason: d.reason ?? null,
    }));
    return [...happy, ...other];
  }, [unresolved, failedDimensions]);

  const [config, setConfig] = useState<Record<string, { attempts: number; notes: string }>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, { attempts: DEFAULT_ATTEMPTS, notes: '' }])),
  );
  const [notPossible, setNotPossible] = useState<Record<string, boolean>>({});
  const [includeOtherDimensions, setIncludeOtherDimensions] = useState(false);

  const otherCount = failedDimensions.length;
  const dimensionalOnly = unresolved.length === 0 && otherCount > 0;

  const setAttempts = (key: string, raw: string) => {
    const n = Number.parseInt(raw, 10);
    setConfig((c) => ({
      ...c,
      [key]: { ...c[key], attempts: Number.isFinite(n) && n > 0 ? n : DEFAULT_ATTEMPTS },
    }));
  };
  const setNotes = (key: string, notes: string) =>
    setConfig((c) => ({ ...c, [key]: { ...c[key], notes } }));

  const toggleNotPossible = (row: TableRow) => {
    setNotPossible((p) => {
      const next = { ...p, [row.key]: !p[row.key] };
      // Marking not-possible fires the exclusion immediately with the row's
      // notes as the audited reason (the host refreshes the list on success).
      if (next[row.key] && onExclude) {
        const reason = (config[row.key]?.notes ?? '').trim();
        if (reason.length > 0) {
          onExclude(row.operation_id, reason, row.scenarioName);
        }
      }
      return next;
    });
  };

  const launch = () => {
    if (!onLaunch) return;
    // Only the happy-path rows NOT marked not-possible drive the gate closure.
    const happyConfig = rows
      .filter((r) => r.kind === 'happy' && !notPossible[r.key])
      .map((r) => ({
        operation_id: r.operation_id,
        method: r.method,
        path: r.path,
        attempts: config[r.key]?.attempts ?? DEFAULT_ATTEMPTS,
        notes: (config[r.key]?.notes ?? '').trim(),
      }));
    onLaunch(happyConfig, dimensionalOnly || (includeOtherDimensions && otherCount > 0));
  };

  const panelClass = `${classes.panel} ${modal.wide}`;

  return (
    <div className={classes.backdrop} data-testid={`${testId}-backdrop`} role="presentation">
      <div
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-label="Retry uncovered APIs"
        data-testid={testId}
      >
        <div className={classes.header}>
          <strong>{dimensionalOnly ? 'Re-attempt failed scenarios' : 'Retry uncovered APIs'}</strong>
          <span data-testid={`${testId}-count`}>
            {unresolved.length} without a happy-path baseline
            {otherCount > 0 ? ` · ${otherCount} other failed scenario${otherCount === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        <div className={classes.body}>
          {rows.length === 0 ? (
            <p className={modal.emptyState} data-testid={`${testId}-empty`}>
              Every included endpoint has its happy-path baseline and no other
              scenario is failing.
            </p>
          ) : (
            <div className={modal.tableWrap}>
              <table className={modal.table} data-testid={`${testId}-table`}>
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Type</th>
                    <th>LLM attempts</th>
                    <th>Notes / reason to the LLM</th>
                    {onExclude && <th className={modal.notPossibleCell}>Not possible</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const excluded = !!notPossible[r.key];
                    // Unique per-row testid suffix (an operation can appear as
                    // both a happy row and an other row).
                    const rid =
                      r.kind === 'happy' ? r.operation_id : `${r.operation_id}-${r.scenarioName}`;
                    return (
                      <tr
                        key={r.key}
                        className={excluded ? modal.excludedRow : undefined}
                        data-testid={`${testId}-row`}
                        data-operation-id={r.operation_id}
                        data-kind={r.kind}
                      >
                        <td className={modal.opCell}>
                          <code>
                            {(r.method || '').toUpperCase()} {r.path || r.operation_id}
                          </code>
                          {r.kind === 'other' && (
                            <span className={modal.reasonHint}>{r.scenarioName}</span>
                          )}
                          {r.reason && <span className={modal.reasonHint}>{r.reason}</span>}
                        </td>
                        <td>
                          <span
                            className={`${modal.typeBadge} ${
                              r.kind === 'happy' ? modal.typeHappy : modal.typeOther
                            }`}
                          >
                            {r.kind === 'happy' ? 'Happy path' : 'Other'}
                          </span>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            className={modal.attemptsInput}
                            value={config[r.key]?.attempts ?? DEFAULT_ATTEMPTS}
                            disabled={busy || excluded}
                            data-testid={`${testId}-attempts-${rid}`}
                            onChange={(e) => setAttempts(r.key, e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className={modal.notesInput}
                            placeholder={
                              excluded
                                ? 'reason for exclusion (required)'
                                : "e.g. try ID=3275, use 'Core' for parameter 'type'"
                            }
                            value={config[r.key]?.notes ?? ''}
                            disabled={busy}
                            data-testid={`${testId}-notes-${rid}`}
                            onChange={(e) => setNotes(r.key, e.target.value)}
                          />
                        </td>
                        {onExclude && (
                          <td className={modal.notPossibleCell}>
                            <input
                              type="checkbox"
                              checked={excluded}
                              disabled={
                                busy || (!excluded && (config[r.key]?.notes ?? '').trim().length === 0)
                              }
                              title={
                                (config[r.key]?.notes ?? '').trim().length === 0
                                  ? 'Enter a reason in Notes first'
                                  : 'Exclude from coverage — uses the notes as the audited reason'
                              }
                              data-testid={`${testId}-notpossible-${rid}`}
                              onChange={() => toggleNotPossible(r)}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {note && (
            <p className={modal.note} data-testid={`${testId}-note`} role="status">
              {note}
            </p>
          )}

          <div className={modal.footerRow}>
            {otherCount > 0 && !dimensionalOnly && (
              <label className={modal.includeOther} data-testid={`${testId}-dimensions-toggle`}>
                <input
                  type="checkbox"
                  checked={includeOtherDimensions}
                  disabled={busy}
                  data-testid={`${testId}-dimensions-checkbox`}
                  onChange={(e) => setIncludeOtherDimensions(e.target.checked)}
                />
                Include other failed coverage scenarios ({otherCount})
              </label>
            )}
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
              {busy ? 'Running closure…' : dimensionalOnly ? 'Re-attempt failed scenarios' : 'Run closure'}
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
        </div>
      </div>
    </div>
  );
};

export default RetryUncoveredModal;
