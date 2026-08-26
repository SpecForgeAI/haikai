/**
 * S0RestorePanel (CSD, 2026-08-20 journey-audit fix).
 *
 * Mounted on the capture-session detail when the session HALTED on a
 * canonical-state problem (residue / fingerprint mismatch — the error
 * message names S0). Previously the halt message pointed at a raw
 * validation-service call; this panel performs the restore from the UI:
 *
 *   - shows the latest pinned snapshot (id, when, table count) or an honest
 *     "no snapshot pinned" state;
 *   - collects the source-DB credentials (function-scope only: they ride
 *     this one request body and are never persisted — connection fields are
 *     prefilled from the session's REDACTED db config when present);
 *   - requires the explicit destructive-consent checkbox (the service also
 *     refuses without confirm: true);
 *   - renders the restore report: per-table restored/skipped/failed counts
 *     and the post-restore fingerprint verification.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { ApiBehaviourCaptureSessionDto } from '../../api/apiBehaviourClient';
import {
  S0Manifest,
  S0RestoreResponse,
  getLatestS0Snapshot,
  restoreS0Snapshot,
} from '../../api/s0SnapshotApi';
import styles from './ApiBaselinesListPage.module.css';

export interface S0RestorePanelProps {
  projectId: string;
  architectureId: string;
  session: ApiBehaviourCaptureSessionDto;
}

interface RestoreFormState {
  dbType: 'postgres' | 'sybase';
  host: string;
  port: string;
  database: string;
  schema: string;
  username: string;
  password: string;
  confirm: boolean;
}

/** Best-effort prefill from the session's redacted db config (non-secret
 *  connection fields only; tolerates camelCase and snake_case keys). */
function prefillFrom(session: ApiBehaviourCaptureSessionDto): RestoreFormState {
  const raw = (session.db_config_redacted_json ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === 'string' && v.length > 0) return v;
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  const dbTypeRaw = pick('dbType', 'db_type').toLowerCase();
  return {
    dbType: dbTypeRaw === 'sybase' ? 'sybase' : 'postgres',
    host: pick('host'),
    port: pick('port'),
    database: pick('database', 'databaseName', 'database_name'),
    schema: pick('schema'),
    username: pick('username', 'user'),
    password: '',
    confirm: false,
  };
}

export const S0RestorePanel: React.FC<S0RestorePanelProps> = ({
  projectId,
  architectureId,
  session,
}) => {
  const [snapshot, setSnapshot] = useState<S0Manifest | null>(null);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [form, setForm] = useState<RestoreFormState>(() => prefillFrom(session));
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [result, setResult] = useState<S0RestoreResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLatestS0Snapshot(projectId, architectureId)
      .then((m) => {
        if (!cancelled) setSnapshot(m);
      })
      .catch((err) => {
        if (!cancelled) {
          setSnapshotError(
            err instanceof Error ? err.message : 'Failed to read the latest snapshot',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  const canRestore = useMemo(
    () =>
      !!snapshot &&
      !busy &&
      form.confirm &&
      form.host.trim().length > 0 &&
      form.port.trim().length > 0 &&
      form.database.trim().length > 0 &&
      form.username.trim().length > 0 &&
      form.password.length > 0,
    [snapshot, busy, form],
  );

  const handleRestore = async () => {
    if (!snapshot || !canRestore) return;
    setBusy(true);
    setRestoreError(null);
    setResult(null);
    try {
      const response = await restoreS0Snapshot({
        project_id: projectId,
        architecture_id: architectureId,
        source_db: {
          db_type: form.dbType,
          host: form.host.trim(),
          port: Number.parseInt(form.port, 10),
          database: form.database.trim(),
          schema: form.schema.trim().length > 0 ? form.schema.trim() : null,
          username: form.username.trim(),
          password: form.password,
        },
        snapshot_id: snapshot.snapshot_id,
        confirm: true,
      });
      setResult(response);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    key: keyof RestoreFormState,
    type: 'text' | 'password' = 'text',
  ) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140 }}>
      <span style={{ fontSize: 12, color: '#555' }}>{label}</span>
      <input
        type={type}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        data-testid={`s0-restore-${key}`}
      />
    </label>
  );

  const restoredCount =
    result?.report.tables.filter((t) => t.status === 'restored').length ?? 0;
  const skippedCount =
    result?.report.tables.filter((t) => t.status === 'skipped_not_dumped').length ?? 0;
  const unchangedCount =
    result?.report.tables.filter((t) => t.status === 'unchanged').length ?? 0;
  const failedRows = result?.report.tables.filter((t) => t.status === 'failed') ?? [];

  return (
    <div
      className={styles.detailSection}
      data-testid="s0-restore-panel"
      style={{ borderLeft: '4px solid #c62828' }}
    >
      <h3>Canonical state (S0) — restore</h3>
      <p style={{ margin: '4px 0 8px' }}>
        This run halted because the source database no longer matches the pinned
        canonical state. Restoring reloads only the tables that drifted from the
        snapshot (tables already at S0 are left untouched), reseeds identities,
        and verifies the result — after that, re-run the capture.
      </p>

      {!snapshotLoaded && <p>Loading latest snapshot…</p>}
      {snapshotLoaded && snapshotError && (
        <p style={{ color: '#c62828' }} data-testid="s0-restore-snapshot-error">
          Could not read the latest snapshot: {snapshotError}
        </p>
      )}
      {snapshotLoaded && !snapshotError && !snapshot && (
        <p style={{ color: '#c62828' }} data-testid="s0-restore-no-snapshot">
          No S0 snapshot is pinned for this architecture — run the database scan
          (it pins one automatically) before restoring.
        </p>
      )}
      {snapshot && (
        <p data-testid="s0-restore-snapshot-summary">
          Latest snapshot: <code>{snapshot.snapshot_id}</code> · taken{' '}
          {snapshot.created_at} · {snapshot.tables.length} table
          {snapshot.tables.length === 1 ? '' : 's'} ({snapshot.source_db_type})
        </p>
      )}

      {snapshot && !result && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: '#555' }}>DB type</span>
              <select
                value={form.dbType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    dbType: e.target.value === 'sybase' ? 'sybase' : 'postgres',
                  }))
                }
                data-testid="s0-restore-dbType"
              >
                <option value="postgres">postgres</option>
                <option value="sybase">sybase</option>
              </select>
            </label>
            {field('Host', 'host')}
            {field('Port', 'port')}
            {field('Database', 'database')}
            {field('Schema (optional)', 'schema')}
            {field('Username', 'username')}
            {field('Password', 'password', 'password')}
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
            <input
              type="checkbox"
              checked={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.checked }))}
              data-testid="s0-restore-confirm"
            />
            I understand this TRUNCATES and reloads the tables that drifted
            from S0 in the source database.
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleRestore}
            disabled={!canRestore}
            data-testid="s0-restore-run"
          >
            {busy ? 'Restoring…' : 'Restore S0 now'}
          </button>
        </>
      )}

      {restoreError && (
        <p style={{ color: '#c62828' }} data-testid="s0-restore-error">
          Restore failed: {restoreError}
        </p>
      )}
      {result && (
        <div data-testid="s0-restore-result">
          <p>
            Restore <strong>{result.report.status}</strong>: {restoredCount} table
            {restoredCount === 1 ? '' : 's'} restored
            {unchangedCount > 0 ? `, ${unchangedCount} already at S0` : ''}
            {skippedCount > 0 ? `, ${skippedCount} skipped (count-only tables)` : ''}
            {failedRows.length > 0 ? `, ${failedRows.length} FAILED` : ''}.
            {result.report.verification &&
              ` Verification: ${result.report.verification.matches} match(es), ` +
                `${result.report.verification.mismatches.length} mismatch(es).`}
          </p>
          {failedRows.length > 0 && (
            <ul style={{ color: '#c62828' }}>
              {failedRows.slice(0, 5).map((t) => (
                <li key={t.table}>
                  {t.table}: {t.detail ?? 'failed'}
                </li>
              ))}
            </ul>
          )}
          {result.report.status === 'restored' &&
            (result.report.verification?.mismatches.length ?? 0) === 0 && (
              <p>The database is back at S0 — re-run the capture when ready.</p>
            )}
        </div>
      )}
    </div>
  );
};

export default S0RestorePanel;
