/**
 * ProcRoutineCoveragePanel — the routine analogue of
 * `DashboardView/CoverageSummaryPanel` (Spec 3, 2026-09-09).
 *
 * DEFAULT COLLAPSED: a one-line roll-up is always visible; the per-routine
 * detail expands on demand. Display-only — no gate, no block. A session
 * without a `coverage_summary_json` renders the honest "not recorded"
 * sentinel rather than an error.
 *
 * The floor (design decision 5) is deterministic: the denominator is the
 * statically enumerated exit outcomes (each distinct RETURN value, each
 * RAISERROR site, the implicit success exit) plus the seeded families found
 * in the body; the numerator is the distinct outcomes actually observed. Each
 * routine ends in exactly one bucket.
 */

import React from 'react';
import type {
  ProcCoverageSummary,
  ProcRoutineBucket,
} from '../../api/procBehaviourApi';
import styles from '../DashboardView/ApiBaselinesListPage.module.css';
import proc from './ProcBehaviour.module.css';

export interface ProcRoutineCoveragePanelProps {
  summary: ProcCoverageSummary | null;
  defaultCollapsed?: boolean;
  testId?: string;
}

const BUCKET_CLASS: Record<ProcRoutineBucket, string> = {
  verified: proc.bucketVerified,
  not_exercised: proc.bucketNotExercised,
  unverifiable: proc.bucketUnverifiable,
  excluded: proc.bucketExcluded,
};

export const ProcRoutineCoveragePanel: React.FC<ProcRoutineCoveragePanelProps> = ({
  summary,
  defaultCollapsed = true,
  testId = 'proc-coverage-panel',
}) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  if (!summary) {
    return (
      <div className={styles.detailSection} data-testid={`${testId}-not-recorded`}>
        <strong>Routine coverage not recorded.</strong>{' '}
        <span>
          No coverage summary has been written for this session yet — it is
          computed when the capture run reaches a terminal state.
        </span>
      </div>
    );
  }

  return (
    <div
      className={styles.detailSection}
      data-testid={testId}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className={styles.sectionHeader}>
        <h3 data-testid={`${testId}-summary`}>
          Routine coverage: {summary.verified} of {summary.routinesInScope} verified ·{' '}
          {summary.notExercised} not exercised · {summary.unverifiable} unverifiable ·{' '}
          {summary.excluded} excluded
        </h3>
        <button
          type="button"
          className={styles.refreshButton}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          data-testid={`${testId}-toggle`}
        >
          {collapsed ? 'Show per-routine detail' : 'Hide per-routine detail'}
        </button>
      </div>
      {!collapsed && (
        <div className={proc.tableWrap} data-testid={`${testId}-detail`}>
          <table className={proc.table}>
            <thead>
              <tr>
                <th>Routine</th>
                <th>Bucket</th>
                <th>Outcomes achieved / required</th>
                <th>Missing</th>
                <th className={proc.numeric}>Scenarios fired</th>
                <th className={proc.numeric}>Captures accepted</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {summary.perRoutine.map((r) => (
                <tr
                  key={r.routineId}
                  data-testid={`${testId}-row`}
                  data-routine-id={r.routineId}
                  data-bucket={r.bucket}
                >
                  <td className={proc.mono}>{r.routineName || r.routineId}</td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${BUCKET_CLASS[r.bucket] ?? ''}`}
                    >
                      {r.bucket}
                    </span>
                  </td>
                  <td>
                    {r.achieved.length} / {r.required.length}
                    {r.floorMet ? ' (floor met)' : ''}
                  </td>
                  <td>{r.missing.length > 0 ? r.missing.join(', ') : '—'}</td>
                  <td className={proc.numeric}>{r.scenariosFired}</td>
                  <td className={proc.numeric}>{r.capturesAccepted}</td>
                  <td>{r.unverifiableReason ?? '—'}</td>
                </tr>
              ))}
              {summary.perRoutine.length === 0 && (
                <tr>
                  <td colSpan={7} data-testid={`${testId}-detail-empty`}>
                    No per-routine coverage rows were recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProcRoutineCoveragePanel;
