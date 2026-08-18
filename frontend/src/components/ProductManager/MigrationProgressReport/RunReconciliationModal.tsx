/**
 * RunReconciliationModal (2026-08-16)
 *
 * The operator door for kicking the reconciliation engines manually from the
 * stakeholder progress report: pick WHICH rec(s) to run (Database and/or
 * Service (API), per the book's plane scope), supply the CURRENT and TARGET
 * state connection details, and go.
 *
 *   - DATABASE reconciliation = the AMVS data-parity comparator. Needs the
 *     current (source) + target DB credentials; the table scope comes from
 *     the DB migration pack server-side.
 *   - SERVICE (API) reconciliation = the full-baseline replay against the
 *     book's latest run. Needs the target service base URL + auth; the
 *     CURRENT-state service details update the source-side registration
 *     (the replay ORACLE itself is the recorded baseline — current-state
 *     behaviour is never re-captured here).
 *
 * Credential blocks are OPTIONAL: blanks fall back to the run's already-
 * registered in-memory credentials server-side, so a re-run doesn't force
 * re-typing. Everything sent lives in the gateway's in-memory stores only —
 * never persisted, never logged. Both engines run in the BACKGROUND; the
 * result lines say started/blocked per rec and the report refreshes on close.
 */

import { useMemo, useState } from 'react';
import {
  startManualReconciliation,
  runLogReplayReconciliation,
  type LogReplayReconcileResultDto,
  type ManualDbBlockDto,
  type StartReconciliationRequestDto,
  type StartReconciliationResultDto,
} from '../../../api/migrationProgressReportApi';
// THE one shared auth surface (2026-08-13): the same methods every other
// credential dialog in the tool offers — none | bearer | basic |
// ssoToken (fixed `ssoToken` header) | custom header. Never a bespoke list.
import {
  ApiAuthFields,
  EMPTY_API_AUTH,
  toApiAuthSecret,
  type ApiAuthValue,
} from '../../shared/ApiAuthFields';
import styles from './MigrationProgressReport.module.css';

// ============================================================================
// Field state
// ============================================================================

interface DbFieldsState {
  dbType: 'sybase' | 'postgres';
  host: string;
  port: string;
  database: string;
  schema: string;
  username: string;
  password: string;
}

const emptyDb = (dbType: 'sybase' | 'postgres'): DbFieldsState => ({
  dbType,
  host: '',
  port: '',
  database: '',
  schema: '',
  username: '',
  password: '',
});

function dbBlockFromFields(
  fields: DbFieldsState,
  label: string,
): { block?: ManualDbBlockDto; error?: string; empty: boolean } {
  const filled = [fields.host, fields.port, fields.database, fields.username, fields.password]
    .some((v) => v.trim() !== '');
  if (!filled) return { empty: true };
  const port = Number.parseInt(fields.port, 10);
  if (
    fields.host.trim() === '' ||
    !Number.isFinite(port) ||
    fields.database.trim() === '' ||
    fields.username.trim() === '' ||
    fields.password === ''
  ) {
    return {
      empty: false,
      error: `${label}: complete host, port, database, username and password (or clear the block to reuse registered credentials).`,
    };
  }
  return {
    empty: false,
    block: {
      dbType: fields.dbType,
      host: fields.host.trim(),
      port,
      database: fields.database.trim(),
      schema: fields.schema.trim() === '' ? null : fields.schema.trim(),
      username: fields.username.trim(),
      password: fields.password,
    },
  };
}

// ============================================================================
// Small field components
// ============================================================================

function DbFields({
  legend,
  value,
  onChange,
  idPrefix,
}: {
  legend: string;
  value: DbFieldsState;
  onChange: (next: DbFieldsState) => void;
  idPrefix: string;
}) {
  const field = (
    key: keyof DbFieldsState,
    label: string,
    type: 'text' | 'password' | 'number' = 'text',
  ) => (
    <label className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.fieldInput}
        type={type}
        value={value[key]}
        data-testid={`${idPrefix}-${key}`}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <fieldset className={styles.credFieldset}>
      <legend className={styles.credLegend}>{legend}</legend>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Engine</span>
        <select
          className={styles.fieldInput}
          value={value.dbType}
          data-testid={`${idPrefix}-dbType`}
          onChange={(e) => onChange({ ...value, dbType: e.target.value as 'sybase' | 'postgres' })}
        >
          <option value="sybase">Sybase</option>
          <option value="postgres">PostgreSQL</option>
        </select>
      </label>
      {field('host', 'Host')}
      {field('port', 'Port', 'number')}
      {field('database', 'Database')}
      {field('schema', 'Schema (optional)')}
      {field('username', 'Username')}
      {field('password', 'Password', 'password')}
    </fieldset>
  );
}

/** The shared auth surface with this modal's field-row styling. */
function AuthBlock({
  value,
  onChange,
  idPrefix,
}: {
  value: ApiAuthValue;
  onChange: (next: ApiAuthValue) => void;
  idPrefix: string;
}) {
  return (
    <ApiAuthFields
      value={value}
      onChange={(patch) => onChange({ ...value, ...patch })}
      classNames={{
        fieldGroup: styles.fieldRow,
        label: styles.fieldLabel,
        input: styles.fieldInput,
        select: styles.fieldInput,
      }}
      testIdPrefix={idPrefix}
      selectLabel="Auth"
    />
  );
}

// ============================================================================
// The modal
// ============================================================================

export interface RunReconciliationModalProps {
  projectId: string;
  architectureId: string;
  bookId: string;
  scope: { db: boolean; service: boolean };
  /** `ranAny` = at least one rec started; the page refetches when true. */
  onClose: (ranAny: boolean) => void;
  /** Test seam: the trigger call (defaults to the real client). */
  startFn?: typeof startManualReconciliation;
  /** Test seam: the round-2 log-replay call (CSD Spec 8). */
  logReplayFn?: typeof runLogReplayReconciliation;
}

export function RunReconciliationModal({
  projectId,
  architectureId,
  bookId,
  scope,
  onClose,
  startFn = startManualReconciliation,
  logReplayFn = runLogReplayReconciliation,
}: RunReconciliationModalProps) {
  const [runDb, setRunDb] = useState<boolean>(scope.db);
  const [runApi, setRunApi] = useState<boolean>(scope.service);
  const [sourceDb, setSourceDb] = useState<DbFieldsState>(emptyDb('sybase'));
  const [targetDb, setTargetDb] = useState<DbFieldsState>(emptyDb('postgres'));
  const [targetBaseUrl, setTargetBaseUrl] = useState<string>('');
  const [targetAuth, setTargetAuth] = useState<ApiAuthValue>(EMPTY_API_AUTH);
  const [currentBaseUrl, setCurrentBaseUrl] = useState<string>('');
  const [currentAuth, setCurrentAuth] = useState<ApiAuthValue>(EMPTY_API_AUTH);
  const [supersedeBreaks, setSupersedeBreaks] = useState<boolean>(false);
  // CSD Spec 8 (2026-08-18): reconciliation ROUND 2 — replay the staged log
  // corpus against BOTH systems at S0. Reuses the credential blocks this
  // modal already collects; SYNCHRONOUS (the verdict renders inline).
  const [runLogReplay, setRunLogReplay] = useState<boolean>(false);
  const [logReplayResult, setLogReplayResult] =
    useState<LogReplayReconcileResultDto | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StartReconciliationResultDto | null>(null);

  const ranAny = useMemo(
    () =>
      (result !== null &&
        (result.dataParity?.status === 'started' ||
          result.apiReconcile?.status === 'started')) ||
      logReplayResult?.ok === true,
    [result, logReplayResult],
  );

  const submit = async () => {
    setError(null);
    if (!runDb && !runApi && !runLogReplay) {
      setError('Select at least one reconciliation to run.');
      return;
    }
    const source = dbBlockFromFields(sourceDb, 'Current state database');
    if (runDb && source.error) return setError(source.error);
    const target = dbBlockFromFields(targetDb, 'Target state database');
    if ((runDb || runApi) && target.error) return setError(target.error);
    // The source-side registration is keyed by its base URL — auth without a
    // URL cannot be stored, so say so instead of silently dropping it.
    if (runApi && currentBaseUrl.trim() === '' && currentAuth.authType !== 'none') {
      return setError(
        'Current state service: a Base URL is required when its auth is set (or set auth back to None to reuse the registered details).',
      );
    }
    // Round 2 replays LIVE against BOTH systems — both base URLs are required.
    if (runLogReplay && (currentBaseUrl.trim() === '' || targetBaseUrl.trim() === '')) {
      return setError(
        'Log-replay round 2 needs BOTH service base URLs (current and target).',
      );
    }

    const body: StartReconciliationRequestDto = {
      run_data_parity: runDb,
      run_api_reconcile: runApi,
      ...(source.block ? { source_db: source.block } : {}),
      ...(target.block ? { target_db: target.block } : {}),
      ...(runApi ? { api: toApiAuthSecret(targetAuth) } : {}),
      ...(runApi && targetBaseUrl.trim() !== '' ? { target_base_url: targetBaseUrl.trim() } : {}),
      ...(runApi && currentBaseUrl.trim() !== ''
        ? {
            source_api: {
              current_base_url: currentBaseUrl.trim(),
              api: toApiAuthSecret(currentAuth),
            },
          }
        : {}),
      ...(runApi && supersedeBreaks ? { supersede_open_breaks: true } : {}),
    };
    setSubmitting(true);
    try {
      if (runDb || runApi) {
        setResult(await startFn(projectId, architectureId, bookId, body));
      }
      if (runLogReplay) {
        // Round 2 (CSD Spec 8): synchronous — the verdict renders inline.
        // A failure here never masks the round-1 kicks above.
        try {
          setLogReplayResult(
            await logReplayFn(projectId, architectureId, {
              current: {
                base_url: currentBaseUrl.trim(),
                api: toApiAuthSecret(currentAuth),
                db: source.block ?? null,
              },
              target: {
                base_url: targetBaseUrl.trim(),
                api: toApiAuthSecret(targetAuth),
                db: target.block ?? null,
              },
            }),
          );
        } catch (e) {
          setLogReplayResult({
            ok: false,
            error: e instanceof Error ? e.message : 'log-replay reconciliation failed',
            corpus_id: null,
            log_replay_baseline_id: null,
            current_side: null,
            diff_id: null,
            target_baseline_id: null,
            diff_items: 0,
            breaks: 0,
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the reconciliation');
    } finally {
      setSubmitting(false);
    }
  };

  const outcomeLine = (label: string, outcome: StartReconciliationResultDto['dataParity']) => {
    if (!outcome) return null;
    return (
      <div
        className={`${styles.recResultLine} ${
          outcome.status === 'started' ? styles.recResultStarted : styles.recResultBlocked
        }`}
        data-testid={`rrm-result-${label === 'Database' ? 'db' : 'api'}`}
      >
        <strong>{label}:</strong>{' '}
        {outcome.status === 'started' ? `started — ${outcome.detail}` : `blocked — ${outcome.reason}`}
      </div>
    );
  };

  return (
    <div className={styles.modalOverlay} data-testid="rrm-modal">
      <div className={styles.modalDialog} role="dialog" aria-label="Run reconciliation">
        <div className={styles.modalTitle}>Run reconciliation</div>

        <div className={styles.checkRow}>
          <label>
            <input
              type="checkbox"
              checked={runDb}
              disabled={!scope.db}
              data-testid="rrm-check-db"
              onChange={(e) => setRunDb(e.target.checked)}
            />{' '}
            Database reconciliation
          </label>
          <label>
            <input
              type="checkbox"
              checked={runApi}
              disabled={!scope.service}
              data-testid="rrm-check-api"
              onChange={(e) => setRunApi(e.target.checked)}
            />{' '}
            Service (API) reconciliation
          </label>
          <label>
            <input
              type="checkbox"
              checked={runLogReplay}
              data-testid="rrm-check-log-replay"
              onChange={(e) => setRunLogReplay(e.target.checked)}
            />{' '}
            Log-replay reconciliation (round 2) — replays the staged application-log
            corpus against BOTH systems at S0
          </label>
        </div>

        {result === null && logReplayResult === null ? (
          <>
            {runDb && (
              <div className={styles.credColumns} data-testid="rrm-db-fields">
                <DbFields
                  legend="Current state database (source)"
                  value={sourceDb}
                  onChange={setSourceDb}
                  idPrefix="rrm-source-db"
                />
                <DbFields
                  legend="Target state database"
                  value={targetDb}
                  onChange={setTargetDb}
                  idPrefix="rrm-target-db"
                />
              </div>
            )}
            {(runApi || runLogReplay) && (
              <div className={styles.credColumns} data-testid="rrm-api-fields">
                {/* SYMMETRIC service blocks (2026-08-16): both sides carry
                    Base URL + the shared auth surface (incl. ssoToken). */}
                <fieldset className={styles.credFieldset}>
                  <legend className={styles.credLegend}>Current state service</legend>
                  <label className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Base URL</span>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      placeholder="blank = the registered details"
                      value={currentBaseUrl}
                      data-testid="rrm-current-base-url"
                      onChange={(e) => setCurrentBaseUrl(e.target.value)}
                    />
                  </label>
                  <AuthBlock value={currentAuth} onChange={setCurrentAuth} idPrefix="rrm-current" />
                </fieldset>
                <fieldset className={styles.credFieldset}>
                  <legend className={styles.credLegend}>Target state service</legend>
                  <label className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Base URL</span>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      placeholder="blank = the run's registered URL"
                      value={targetBaseUrl}
                      data-testid="rrm-target-base-url"
                      onChange={(e) => setTargetBaseUrl(e.target.value)}
                    />
                  </label>
                  <AuthBlock value={targetAuth} onChange={setTargetAuth} idPrefix="rrm-target" />
                </fieldset>
              </div>
            )}
            {runApi && (
              <label className={styles.noteLine}>
                <input
                  type="checkbox"
                  checked={supersedeBreaks}
                  data-testid="rrm-supersede-breaks"
                  onChange={(e) => setSupersedeBreaks(e.target.checked)}
                />{' '}
                Supersede unresolved breaks from the previous reconcile (marks
                them wont_report so the re-run can start)
              </label>
            )}
            {!runDb && runApi && (
              <div className={styles.credColumns}>
                <DbFields
                  legend="Target state database (optional — enables state checks)"
                  value={targetDb}
                  onChange={setTargetDb}
                  idPrefix="rrm-target-db"
                />
              </div>
            )}
            <div className={styles.noteLine}>
              Blank credential blocks reuse the run&apos;s already-registered details. Everything
              entered stays in memory for this run only — never persisted, never logged. The
              reconciliations run in the background; refresh this report after a few minutes.
            </div>
          </>
        ) : (
          <div data-testid="rrm-results">
            {outcomeLine('Database', result?.dataParity ?? null)}
            {outcomeLine('Service (API)', result?.apiReconcile ?? null)}
            {logReplayResult && (
              <div
                className={`${styles.recResultLine} ${
                  logReplayResult.ok ? styles.recResultStarted : styles.recResultBlocked
                }`}
                data-testid="rrm-result-log-replay"
              >
                <strong>Log replay (round 2):</strong>{' '}
                {logReplayResult.ok
                  ? `complete — ${logReplayResult.diff_items} item(s) diffed, ` +
                    `${logReplayResult.breaks} differing; current side replayed ` +
                    `${logReplayResult.current_side?.itemsReplayed ?? 0}/` +
                    `${logReplayResult.current_side?.itemsTotal ?? 0}`
                  : `failed — ${logReplayResult.error ?? 'unknown error'}`}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className={styles.recError} data-testid="rrm-error">
            {error}
          </div>
        )}

        <div className={styles.modalActions}>
          {result === null && logReplayResult === null ? (
            <>
              <button type="button" onClick={() => onClose(false)} data-testid="rrm-cancel">
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={submitting}
                onClick={() => void submit()}
                data-testid="rrm-run"
              >
                {submitting ? 'Running…' : 'Run selected'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => onClose(ranAny)}
              data-testid="rrm-close"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RunReconciliationModal;
