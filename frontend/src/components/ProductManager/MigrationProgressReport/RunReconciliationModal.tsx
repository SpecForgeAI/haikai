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
  type ManualAuthDto,
  type ManualDbBlockDto,
  type StartReconciliationRequestDto,
  type StartReconciliationResultDto,
} from '../../../api/migrationProgressReportApi';
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

interface AuthFieldsState {
  type: ManualAuthDto['type'];
  bearerToken: string;
  headerName: string;
  headerValue: string;
  queryParamName: string;
  queryParamValue: string;
  username: string;
  password: string;
}

const emptyAuth = (): AuthFieldsState => ({
  type: 'none',
  bearerToken: '',
  headerName: '',
  headerValue: '',
  queryParamName: '',
  queryParamValue: '',
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

function authFromFields(fields: AuthFieldsState): ManualAuthDto {
  switch (fields.type) {
    case 'bearer':
      return { type: 'bearer', bearerToken: fields.bearerToken };
    case 'api_key_header':
      return { type: 'api_key_header', headerName: fields.headerName, headerValue: fields.headerValue };
    case 'api_key_query':
      return {
        type: 'api_key_query',
        queryParamName: fields.queryParamName,
        queryParamValue: fields.queryParamValue,
      };
    case 'basic':
      return { type: 'basic', username: fields.username, password: fields.password };
    case 'custom_header':
      return { type: 'custom_header', headerName: fields.headerName, headerValue: fields.headerValue };
    default:
      return { type: 'none' };
  }
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

function AuthFields({
  value,
  onChange,
  idPrefix,
}: {
  value: AuthFieldsState;
  onChange: (next: AuthFieldsState) => void;
  idPrefix: string;
}) {
  const field = (key: keyof AuthFieldsState, label: string, type: 'text' | 'password' = 'text') => (
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
    <>
      <label className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Auth</span>
        <select
          className={styles.fieldInput}
          value={value.type}
          data-testid={`${idPrefix}-type`}
          onChange={(e) => onChange({ ...value, type: e.target.value as AuthFieldsState['type'] })}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="api_key_header">API key (header)</option>
          <option value="api_key_query">API key (query)</option>
          <option value="basic">Basic</option>
          <option value="custom_header">Custom header</option>
        </select>
      </label>
      {value.type === 'bearer' && field('bearerToken', 'Bearer token', 'password')}
      {(value.type === 'api_key_header' || value.type === 'custom_header') && (
        <>
          {field('headerName', 'Header name')}
          {field('headerValue', 'Header value', 'password')}
        </>
      )}
      {value.type === 'api_key_query' && (
        <>
          {field('queryParamName', 'Query param name')}
          {field('queryParamValue', 'Query param value', 'password')}
        </>
      )}
      {value.type === 'basic' && (
        <>
          {field('username', 'Username')}
          {field('password', 'Password', 'password')}
        </>
      )}
    </>
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
}

export function RunReconciliationModal({
  projectId,
  architectureId,
  bookId,
  scope,
  onClose,
  startFn = startManualReconciliation,
}: RunReconciliationModalProps) {
  const [runDb, setRunDb] = useState<boolean>(scope.db);
  const [runApi, setRunApi] = useState<boolean>(scope.service);
  const [sourceDb, setSourceDb] = useState<DbFieldsState>(emptyDb('sybase'));
  const [targetDb, setTargetDb] = useState<DbFieldsState>(emptyDb('postgres'));
  const [targetBaseUrl, setTargetBaseUrl] = useState<string>('');
  const [targetAuth, setTargetAuth] = useState<AuthFieldsState>(emptyAuth());
  const [currentBaseUrl, setCurrentBaseUrl] = useState<string>('');
  const [currentAuth, setCurrentAuth] = useState<AuthFieldsState>(emptyAuth());
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StartReconciliationResultDto | null>(null);

  const ranAny = useMemo(
    () =>
      result !== null &&
      (result.dataParity?.status === 'started' || result.apiReconcile?.status === 'started'),
    [result],
  );

  const submit = async () => {
    setError(null);
    if (!runDb && !runApi) {
      setError('Select at least one reconciliation to run.');
      return;
    }
    const source = dbBlockFromFields(sourceDb, 'Current state database');
    if (runDb && source.error) return setError(source.error);
    const target = dbBlockFromFields(targetDb, 'Target state database');
    if ((runDb || runApi) && target.error) return setError(target.error);

    const body: StartReconciliationRequestDto = {
      run_data_parity: runDb,
      run_api_reconcile: runApi,
      ...(source.block ? { source_db: source.block } : {}),
      ...(target.block ? { target_db: target.block } : {}),
      ...(runApi ? { api: authFromFields(targetAuth) } : {}),
      ...(runApi && targetBaseUrl.trim() !== '' ? { target_base_url: targetBaseUrl.trim() } : {}),
      ...(runApi && currentBaseUrl.trim() !== ''
        ? {
            source_api: {
              current_base_url: currentBaseUrl.trim(),
              api: authFromFields(currentAuth),
            },
          }
        : {}),
    };
    setSubmitting(true);
    try {
      setResult(await startFn(projectId, architectureId, bookId, body));
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
        </div>

        {result === null ? (
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
            {runApi && (
              <div className={styles.credColumns} data-testid="rrm-api-fields">
                <fieldset className={styles.credFieldset}>
                  <legend className={styles.credLegend}>Current state service</legend>
                  <label className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Base URL</span>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      placeholder="optional — behaviour replays from the recorded baseline"
                      value={currentBaseUrl}
                      data-testid="rrm-current-base-url"
                      onChange={(e) => setCurrentBaseUrl(e.target.value)}
                    />
                  </label>
                  {currentBaseUrl.trim() !== '' && (
                    <AuthFields value={currentAuth} onChange={setCurrentAuth} idPrefix="rrm-current-auth" />
                  )}
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
                  <AuthFields value={targetAuth} onChange={setTargetAuth} idPrefix="rrm-target-auth" />
                </fieldset>
              </div>
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
            {outcomeLine('Database', result.dataParity)}
            {outcomeLine('Service (API)', result.apiReconcile)}
          </div>
        )}

        {error && (
          <div className={styles.recError} data-testid="rrm-error">
            {error}
          </div>
        )}

        <div className={styles.modalActions}>
          {result === null ? (
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
                {submitting ? 'Starting…' : 'Run selected'}
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
