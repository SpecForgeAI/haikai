/**
 * ProcRetryUncoveredModal — the routine analogue of the API surface's
 * `RetryUncoveredModal` (Spec 3, 2026-09-09).
 *
 * "No manual residue": every routine that did not reach its coverage floor
 * leaves this modal with an honest disposition —
 *   - checked  → re-attempted (`POST .../retry-uncovered`);
 *   - "Not possible" → recorded reason, waived out of the floor
 *     (`POST .../not-possible`);
 *   - "Exclude" → recorded reason, out of the population entirely
 *     (`POST .../exclude-routine`).
 * Both dispositions REQUIRE a reason; the buttons stay inert until one is
 * typed, and the reason is what the diagnostic carries.
 */

import React, { useMemo, useState } from 'react';
import type { ProcRoutineCoverage } from '../../api/procBehaviourApi';
import styles from '../DashboardView/ApiBaselinesListPage.module.css';
import proc from './ProcBehaviour.module.css';

export interface ProcRetryUncoveredModalProps {
  /** Routines in the `not_exercised` bucket (the retry population). */
  rows: ProcRoutineCoverage[];
  busy?: boolean;
  note?: string | null;
  onClose: () => void;
  onRetry: (routineIds: string[]) => void;
  onNotPossible: (routineId: string, reason: string) => void;
  onExclude: (routineId: string, reason: string) => void;
  testId?: string;
}

export const ProcRetryUncoveredModal: React.FC<ProcRetryUncoveredModalProps> = ({
  rows,
  busy = false,
  note = null,
  onClose,
  onRetry,
  onNotPossible,
  onExclude,
  testId = 'proc-retry-uncovered-modal',
}) => {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(rows.map((r) => r.routineId)),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [disposed, setDisposed] = useState<Record<string, string>>({});

  const checkedIds = useMemo(
    () => rows.map((r) => r.routineId).filter((id) => checked.has(id) && !disposed[id]),
    [rows, checked, disposed],
  );

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const dispose = (
    routineId: string,
    kind: 'not_possible' | 'excluded',
    fire: (routineId: string, reason: string) => void,
  ) => {
    const reason = (reasons[routineId] ?? '').trim();
    if (!reason) return;
    fire(routineId, reason);
    setDisposed((d) => ({ ...d, [routineId]: kind }));
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(routineId);
      return next;
    });
  };

  return (
    <div className={styles.diffModalBackdrop} data-testid={`${testId}-backdrop`} role="presentation">
      <div
        className={`${styles.diffModalPanel} ${proc.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-label="Retry uncovered routines"
        data-testid={testId}
      >
        <div className={styles.diffModalHeader}>
          <strong>Retry uncovered routines</strong>
          <span data-testid={`${testId}-count`}>
            {rows.length} routine{rows.length === 1 ? '' : 's'} below the coverage floor
          </span>
        </div>
        <div className={styles.diffModalBody}>
          {note && <div className={styles.errorBanner}>{note}</div>}
          {rows.length === 0 ? (
            <p data-testid={`${testId}-empty`}>
              Every in-scope routine met its coverage floor or carries a recorded
              disposition.
            </p>
          ) : (
            <div className={proc.tableWrap}>
              <table className={proc.table} data-testid={`${testId}-table`}>
                <thead>
                  <tr>
                    <th />
                    <th>Routine</th>
                    <th>Missing outcomes</th>
                    <th>Reason (required to waive)</th>
                    <th>Not possible</th>
                    <th>Exclude</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const gone = disposed[r.routineId];
                    const reason = reasons[r.routineId] ?? '';
                    return (
                      <tr
                        key={r.routineId}
                        data-testid={`${testId}-row`}
                        data-routine-id={r.routineId}
                        data-disposed={gone ?? ''}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={checked.has(r.routineId)}
                            disabled={busy || !!gone}
                            onChange={() => toggle(r.routineId)}
                            data-testid={`${testId}-check-${r.routineId}`}
                            aria-label={`Retry ${r.routineName}`}
                          />
                        </td>
                        <td className={proc.mono}>{r.routineName || r.routineId}</td>
                        <td>
                          {r.missing.length > 0
                            ? r.missing.join(', ')
                            : `${r.achieved.length}/${r.required.length} outcomes`}
                        </td>
                        <td>
                          <input
                            type="text"
                            className={proc.reasonInput}
                            value={reason}
                            disabled={busy || !!gone}
                            placeholder="why this routine cannot be exercised"
                            onChange={(e) =>
                              setReasons((s) => ({ ...s, [r.routineId]: e.target.value }))
                            }
                            data-testid={`${testId}-reason-${r.routineId}`}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className={proc.linkButton}
                            disabled={busy || !!gone || reason.trim() === ''}
                            onClick={() =>
                              dispose(r.routineId, 'not_possible', onNotPossible)
                            }
                            data-testid={`${testId}-not-possible-${r.routineId}`}
                            title="Record that this routine cannot be exercised; it is waived out of the coverage floor with this reason"
                          >
                            {gone === 'not_possible' ? 'recorded' : 'Not possible'}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={proc.linkButton}
                            disabled={busy || !!gone || reason.trim() === ''}
                            onClick={() => dispose(r.routineId, 'excluded', onExclude)}
                            data-testid={`${testId}-exclude-${r.routineId}`}
                            title="Exclude this routine from the capture population with this reason"
                          >
                            {gone === 'excluded' ? 'excluded' : 'Exclude with reason'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid={`${testId}-close`}
          >
            Close
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onRetry(checkedIds)}
            disabled={busy || checkedIds.length === 0}
            data-testid={`${testId}-confirm`}
          >
            Retry {checkedIds.length} routine{checkedIds.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProcRetryUncoveredModal;
