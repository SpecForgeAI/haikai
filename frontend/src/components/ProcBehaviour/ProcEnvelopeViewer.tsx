/**
 * ProcEnvelopeViewer — renders one routine invocation envelope.
 *
 * Spec 3 (Proc Behaviour Capture), 2026-09-09. Doctrine: "a routine's output
 * is five things" — return status, OUTPUT parameter values, an ordered list of
 * result sets, messages/errors, and the state delta on the tables it writes.
 * This component shows all five (the state delta arrives beside the envelope
 * on the capture / baseline item, so it is passed in separately) plus the
 * volatile-cell evidence from the double-fire.
 *
 * A SEQUENCE envelope carries `steps[]` and is rendered as an ordered list of
 * nested envelopes inside one bracket.
 *
 * Result sets are capped at {@link DEFAULT_MAX_ROWS} rendered rows with an
 * honest "showing N of M" note — never a silent truncation.
 */

import React from 'react';
import type { ProcEnvelope, ProcResultSet } from '../../api/procBehaviourApi';
import { summariseStateDelta } from '../../api/procBehaviourApi';
import styles from './ProcBehaviour.module.css';

/** Rows rendered per result set before the "showing N of M" note kicks in. */
export const DEFAULT_MAX_ROWS = 50;

export interface ProcEnvelopeViewerProps {
  envelope: ProcEnvelope | null;
  /** Raw `state_delta_json` (opaque shape; summarised defensively). */
  stateDelta?: Record<string, unknown> | null;
  /** Cells the volatility double-fire proved non-deterministic. */
  volatileCells?: unknown[];
  maxRows?: number;
  testId?: string;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const ResultSetTable: React.FC<{
  rs: ProcResultSet;
  maxRows: number;
  testId: string;
}> = ({ rs, maxRows, testId }) => {
  const shown = rs.rows.slice(0, maxRows);
  const total = rs.rowCount ?? rs.rows.length;
  return (
    <div data-testid={`${testId}-result-set`} data-ordinal={String(rs.ordinal)}>
      <div className={styles.envelopeHeading}>
        Result set {rs.ordinal} — {rs.columns.length} column
        {rs.columns.length === 1 ? '' : 's'}, {total} row{total === 1 ? '' : 's'}
        {rs.truncated ? ' (truncated by the capture cap)' : ''}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {rs.columns.map((c, i) => (
                <th key={`${c.name}-${i}`} title={c.type ?? undefined}>
                  {c.name || `col${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, ri) => (
              <tr key={ri} data-testid={`${testId}-result-row`}>
                {rs.columns.map((_c, ci) => (
                  <td key={ci} className={styles.mono}>
                    {renderCell(row[ci])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length < rs.rows.length && (
          <div className={styles.truncatedNote} data-testid={`${testId}-rows-capped`}>
            Showing {shown.length} of {rs.rows.length} captured rows.
          </div>
        )}
      </div>
    </div>
  );
};

export const ProcEnvelopeViewer: React.FC<ProcEnvelopeViewerProps> = ({
  envelope,
  stateDelta = null,
  volatileCells = [],
  maxRows = DEFAULT_MAX_ROWS,
  testId = 'proc-envelope',
}) => {
  if (!envelope) {
    return (
      <div className={styles.envelope} data-testid={`${testId}-empty`}>
        <div className={styles.envelopeLine}>No envelope recorded for this capture.</div>
      </div>
    );
  }

  // Sequence envelope: one bracket, ordered steps.
  if (envelope.steps && envelope.steps.length > 0) {
    return (
      <div className={styles.envelope} data-testid={testId} data-sequence="true">
        <div className={styles.envelopeLine}>
          Sequence of {envelope.steps.length} invocation
          {envelope.steps.length === 1 ? '' : 's'} fired inside one compensation
          bracket.
        </div>
        {envelope.steps.map((step, i) => (
          <div className={styles.step} key={i} data-testid={`${testId}-step`}>
            <div className={styles.envelopeHeading}>Step {i + 1}</div>
            <ProcEnvelopeViewer
              envelope={step}
              maxRows={maxRows}
              testId={`${testId}-step-${i + 1}`}
            />
          </div>
        ))}
        <StateDeltaBlock stateDelta={stateDelta} volatileCells={volatileCells} testId={testId} />
      </div>
    );
  }

  const outParams = Object.entries(envelope.outputParams);

  return (
    <div className={styles.envelope} data-testid={testId} data-outcome={envelope.outcome}>
      <div className={styles.envelopeLine} data-testid={`${testId}-outcome`}>
        Outcome: <strong>{envelope.outcome}</strong>
        {envelope.returnStatus !== null && (
          <> · return status <strong>{envelope.returnStatus}</strong></>
        )}
        {envelope.timingMs !== null && <> · {envelope.timingMs} ms</>}
        {envelope.sessionLogin && <> · login {envelope.sessionLogin}</>}
      </div>
      {envelope.sessionSetOptions.length > 0 && (
        <div className={styles.envelopeLine} data-testid={`${testId}-set-options`}>
          Session SETs: <span className={styles.mono}>{envelope.sessionSetOptions.join(', ')}</span>
        </div>
      )}

      {outParams.length > 0 && (
        <>
          <div className={styles.envelopeHeading}>OUTPUT parameters</div>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid={`${testId}-output-params`}>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {outParams.map(([k, v]) => (
                  <tr key={k}>
                    <td className={styles.mono}>{k}</td>
                    <td className={styles.mono}>{renderCell(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {envelope.resultSets.map((rs, i) => (
        <ResultSetTable key={i} rs={rs} maxRows={maxRows} testId={testId} />
      ))}

      {envelope.updateCounts.length > 0 && (
        <div className={styles.envelopeLine} data-testid={`${testId}-update-counts`}>
          Update counts: {envelope.updateCounts.join(', ')}
        </div>
      )}

      {envelope.messages.length > 0 && (
        <>
          <div className={styles.envelopeHeading}>Messages</div>
          <ul data-testid={`${testId}-messages`}>
            {envelope.messages.map((m, i) => (
              <li key={i} className={styles.envelopeLine}>
                {m.kind ? `${m.kind} · ` : ''}
                {m.number !== null ? `#${m.number} ` : ''}
                {m.severity !== null ? `sev ${m.severity} ` : ''}
                {m.state !== null ? `state ${m.state} ` : ''}
                {m.text}
              </li>
            ))}
          </ul>
        </>
      )}

      {envelope.error && (
        <div className={styles.envelopeError} data-testid={`${testId}-error`}>
          Error {envelope.error.number ?? '?'}
          {envelope.error.sqlstate ? ` (SQLSTATE ${envelope.error.sqlstate})` : ''}
          {envelope.error.severity !== null ? ` severity ${envelope.error.severity}` : ''}
          {envelope.error.state !== null ? ` state ${envelope.error.state}` : ''}
          : {envelope.error.message}
        </div>
      )}

      <StateDeltaBlock stateDelta={stateDelta} volatileCells={volatileCells} testId={testId} />
    </div>
  );
};

const StateDeltaBlock: React.FC<{
  stateDelta: Record<string, unknown> | null;
  volatileCells: unknown[];
  testId: string;
}> = ({ stateDelta, volatileCells, testId }) => {
  const rows = summariseStateDelta(stateDelta);
  if (rows.length === 0 && volatileCells.length === 0) return null;
  return (
    <>
      {rows.length > 0 && (
        <div className={styles.envelopeLine} data-testid={`${testId}-state-delta`}>
          State delta:{' '}
          {rows.map((r) => (
            <span key={r.label} className={`${styles.flag} ${styles.flagInfo}`}>
              {r.label}: {r.count === null ? 'changed' : r.count}
            </span>
          ))}
        </div>
      )}
      {volatileCells.length > 0 && (
        <div className={styles.envelopeLine} data-testid={`${testId}-volatile-cells`}>
          Volatile cells (excluded from comparison by evidence):{' '}
          {volatileCells.length}
        </div>
      )}
    </>
  );
};

export default ProcEnvelopeViewer;
