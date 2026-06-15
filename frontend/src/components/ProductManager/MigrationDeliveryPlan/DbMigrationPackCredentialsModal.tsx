/**
 * DbMigrationPackCredentialsModal
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.6 credential prompt).
 *
 * Per-invocation connection + credential prompt for the two live-DB pack
 * actions, reusing the connection-form field set from
 * `StartDiscoveryRunModal.tsx` (dbSource section — host / port / database
 * name / schema / username / password):
 *
 *   - mode 'refresh-seeds': SOURCE Sybase ASE connection (default port 5000).
 *   - mode 'verify':        TARGET PostgreSQL connection (default port 5432)
 *                           + an optional area scope (schemas / tables) for
 *                           per-area re-verification.
 *
 * CREDENTIALS ARE NEVER STORED CLIENT-SIDE: the form state lives only inside
 * this component instance and is discarded when the modal unmounts; the
 * parent forwards the payload straight to the gateway, where the
 * discovery-service holds it in its in-process secrets bundle for the
 * duration of the scan and purges it at completion.
 */

import React, { useMemo, useState } from 'react';
import type {
  DbMigrationPackCredentialedRequest,
  VerifyDbMigrationPackRequest,
} from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export type DbMigrationPackCredentialsMode = 'refresh-seeds' | 'verify';

export interface DbMigrationPackCredentialsModalProps {
  mode: DbMigrationPackCredentialsMode;
  /** True while the parent's API call is in flight (disables the form). */
  busy: boolean;
  /** Inline error from the parent's last submit attempt (if any). */
  error: string | null;
  onSubmit: (
    payload: DbMigrationPackCredentialedRequest | VerifyDbMigrationPackRequest,
  ) => void;
  onClose: () => void;
}

const MODE_COPY: Record<
  DbMigrationPackCredentialsMode,
  { title: string; engineLabel: string; defaultPort: number; submitLabel: string }
> = {
  'refresh-seeds': {
    title: 'Refresh seeds — source Sybase ASE connection',
    engineLabel: 'Sybase ASE (source)',
    defaultPort: 5000,
    submitLabel: 'Run seed re-scan',
  },
  verify: {
    title: 'Verify schema — target PostgreSQL connection',
    engineLabel: 'PostgreSQL (target)',
    defaultPort: 5432,
    submitLabel: 'Run verification scan',
  },
};

/** Split a comma-separated scope input into trimmed non-empty entries. */
function parseScopeList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const DbMigrationPackCredentialsModal: React.FC<
  DbMigrationPackCredentialsModalProps
> = ({ mode, busy, error, onSubmit, onClose }) => {
  const copy = MODE_COPY[mode];

  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(copy.defaultPort);
  const [databaseName, setDatabaseName] = useState('');
  const [schemaName, setSchemaName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Verify-only optional area scope (comma-separated).
  const [scopeSchemas, setScopeSchemas] = useState('');
  const [scopeTables, setScopeTables] = useState('');

  const canSubmit = useMemo(
    () =>
      !busy &&
      host.trim().length > 0 &&
      databaseName.trim().length > 0 &&
      username.length > 0 &&
      password.length > 0 &&
      Number.isFinite(port) &&
      port > 0,
    [busy, host, databaseName, username, password, port],
  );

  const handleSubmit = () => {
    if (!canSubmit) return;
    const base: DbMigrationPackCredentialedRequest = {
      db: {
        host: host.trim(),
        port,
        databaseName: databaseName.trim(),
        schemaName: schemaName.trim() ? schemaName.trim() : null,
      },
      username,
      password,
    };
    if (mode === 'verify') {
      const schemas = parseScopeList(scopeSchemas);
      const tables = parseScopeList(scopeTables);
      const scope =
        schemas.length > 0 || tables.length > 0
          ? {
              ...(schemas.length > 0 ? { schemas } : {}),
              ...(tables.length > 0 ? { tables } : {}),
            }
          : null;
      onSubmit({ ...base, scope } satisfies VerifyDbMigrationPackRequest);
      return;
    }
    onSubmit(base);
  };

  return (
    <div
      className={styles.modalOverlay}
      data-testid="db-pack-credentials-modal"
      data-mode={mode}
    >
      <div className={styles.modal} role="dialog" aria-label={copy.title}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{copy.title}</h3>
          <p className={styles.modalHint}>
            Engine: {copy.engineLabel}. Credentials are used for this action
            only — they are sent per invocation and never stored.
          </p>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.fieldRow}>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Host</span>
              <input
                className={styles.filterInput}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                disabled={busy}
                data-testid="db-pack-credentials-host"
              />
            </label>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Port</span>
              <input
                className={styles.filterInput}
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                disabled={busy}
                data-testid="db-pack-credentials-port"
              />
            </label>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Database name</span>
              <input
                className={styles.filterInput}
                value={databaseName}
                onChange={(e) => setDatabaseName(e.target.value)}
                disabled={busy}
                data-testid="db-pack-credentials-database"
              />
            </label>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Schema (optional)</span>
              <input
                className={styles.filterInput}
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value)}
                disabled={busy}
                data-testid="db-pack-credentials-schema"
              />
            </label>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Username</span>
              <input
                className={styles.filterInput}
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                data-testid="db-pack-credentials-username"
              />
            </label>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Password</span>
              <input
                className={styles.filterInput}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                data-testid="db-pack-credentials-password"
              />
            </label>
          </div>

          {mode === 'verify' && (
            <div className={styles.fieldRow}>
              <label className={styles.filterGroup}>
                <span className={styles.filterLabel}>
                  Scope schemas (optional, comma-separated)
                </span>
                <input
                  className={styles.filterInput}
                  value={scopeSchemas}
                  onChange={(e) => setScopeSchemas(e.target.value)}
                  disabled={busy}
                  data-testid="db-pack-credentials-scope-schemas"
                />
              </label>
              <label className={styles.filterGroup}>
                <span className={styles.filterLabel}>
                  Scope tables (optional, comma-separated)
                </span>
                <input
                  className={styles.filterInput}
                  value={scopeTables}
                  onChange={(e) => setScopeTables(e.target.value)}
                  disabled={busy}
                  data-testid="db-pack-credentials-scope-tables"
                />
              </label>
            </div>
          )}

          {error && (
            <div className={styles.errorBanner} data-testid="db-pack-credentials-error">
              {error}
            </div>
          )}
        </div>
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={onClose}
            disabled={busy}
            data-testid="db-pack-credentials-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="db-pack-credentials-submit"
          >
            {busy ? 'Running…' : copy.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DbMigrationPackCredentialsModal;
