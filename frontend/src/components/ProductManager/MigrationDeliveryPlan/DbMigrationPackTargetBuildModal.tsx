/**
 * DbMigrationPackTargetBuildModal
 *
 * Spec: 2026-09-09 Stored Proc & Function Behaviour Program — Spec 4
 * (Translation Workbench Loop), frontend step 4.
 *
 * Sibling of `DbMigrationPackCredentialsModal` for the workbench's two
 * credential prompts. The existing modal's payload shape
 * (`{ db: { host, port, databaseName, schemaName }, username, password }`)
 * does not fit the workbench wire contract, which carries a *pair* of
 * camelCase connection blocks under snake_case keys
 * (`{ target_db: { dbType, host, port, database, schema?, ... }, source_db? }`)
 * plus the rebuild flag — so this is a sibling rather than a third mode.
 *
 *   variant 'build'   — Build target: TARGET PostgreSQL block + OPTIONAL
 *                       SOURCE Sybase block (the data phase needs it; the
 *                       gateway answers 409 SOURCE_DB_MISSING without it) +
 *                       the rebuild checkbox, DEFAULT OFF with the note that
 *                       the server refuses it today.
 *   variant 'connect' — the same TARGET block only, reused by Translate &
 *                       reconcile / Reconcile / Guidance & retry whenever the
 *                       tab has no target credentials for this session yet.
 *
 * CREDENTIALS ARE PER-INVOCATION AND MEMORY-ONLY: this component holds them
 * in component state, the tab holds them in component state for the tab
 * session, and nothing is ever written to storage.
 */

import React, { useMemo, useState } from 'react';
import type { DbMigrationPackDbCredentials } from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export type DbMigrationPackTargetBuildVariant = 'build' | 'connect';

export interface DbMigrationPackTargetBuildSubmit {
  targetDb: DbMigrationPackDbCredentials;
  sourceDb: DbMigrationPackDbCredentials | null;
  rebuild: boolean;
}

export interface DbMigrationPackTargetBuildModalProps {
  variant: DbMigrationPackTargetBuildVariant;
  /** True while the parent's call is in flight (disables the form). */
  busy: boolean;
  /** Inline error from the parent's last submit attempt (if any). */
  error: string | null;
  /**
   * What the credentials will be used for, shown on the 'connect' variant
   * (e.g. "Translate & reconcile all").
   */
  purpose?: string | null;
  onSubmit: (payload: DbMigrationPackTargetBuildSubmit) => void;
  onClose: () => void;
}

interface ConnectionFields {
  host: string;
  port: number;
  database: string;
  schema: string;
  username: string;
  password: string;
}

const EMPTY_TARGET: ConnectionFields = {
  host: '',
  port: 5432,
  database: '',
  schema: '',
  username: '',
  password: '',
};

const EMPTY_SOURCE: ConnectionFields = {
  host: '',
  port: 5000,
  database: '',
  schema: '',
  username: '',
  password: '',
};

function complete(fields: ConnectionFields): boolean {
  return (
    fields.host.trim().length > 0 &&
    fields.database.trim().length > 0 &&
    fields.username.length > 0 &&
    fields.password.length > 0 &&
    Number.isFinite(fields.port) &&
    fields.port > 0
  );
}

function untouched(fields: ConnectionFields, empty: ConnectionFields): boolean {
  return (
    fields.host.trim().length === 0 &&
    fields.database.trim().length === 0 &&
    fields.username.length === 0 &&
    fields.password.length === 0 &&
    fields.schema.trim().length === 0 &&
    fields.port === empty.port
  );
}

function toCredentials(
  fields: ConnectionFields,
  dbType: 'postgres' | 'sybase',
): DbMigrationPackDbCredentials {
  return {
    dbType,
    host: fields.host.trim(),
    port: fields.port,
    database: fields.database.trim(),
    schema: fields.schema.trim() ? fields.schema.trim() : null,
    username: fields.username,
    password: fields.password,
  };
}

/** One connection block (host / port / database / schema / user / password). */
const ConnectionBlock: React.FC<{
  testIdPrefix: string;
  value: ConnectionFields;
  onChange: (next: ConnectionFields) => void;
  busy: boolean;
}> = ({ testIdPrefix, value, onChange, busy }) => (
  <>
    <div className={styles.fieldRow}>
      <label className={styles.filterGroup}>
        <span className={styles.filterLabel}>Host</span>
        <input
          className={styles.filterInput}
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
          disabled={busy}
          data-testid={`${testIdPrefix}-host`}
        />
      </label>
      <label className={styles.filterGroup}>
        <span className={styles.filterLabel}>Port</span>
        <input
          className={styles.filterInput}
          type="number"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: Number(e.target.value) })}
          disabled={busy}
          data-testid={`${testIdPrefix}-port`}
        />
      </label>
    </div>
    <div className={styles.fieldRow}>
      <label className={styles.filterGroup}>
        <span className={styles.filterLabel}>Database name</span>
        <input
          className={styles.filterInput}
          value={value.database}
          onChange={(e) => onChange({ ...value, database: e.target.value })}
          disabled={busy}
          data-testid={`${testIdPrefix}-database`}
        />
      </label>
      <label className={styles.filterGroup}>
        <span className={styles.filterLabel}>Schema (optional)</span>
        <input
          className={styles.filterInput}
          value={value.schema}
          onChange={(e) => onChange({ ...value, schema: e.target.value })}
          disabled={busy}
          data-testid={`${testIdPrefix}-schema`}
        />
      </label>
    </div>
    <div className={styles.fieldRow}>
      <label className={styles.filterGroup}>
        <span className={styles.filterLabel}>Username</span>
        <input
          className={styles.filterInput}
          autoComplete="off"
          value={value.username}
          onChange={(e) => onChange({ ...value, username: e.target.value })}
          disabled={busy}
          data-testid={`${testIdPrefix}-username`}
        />
      </label>
      <label className={styles.filterGroup}>
        <span className={styles.filterLabel}>Password</span>
        <input
          className={styles.filterInput}
          type="password"
          autoComplete="new-password"
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
          disabled={busy}
          data-testid={`${testIdPrefix}-password`}
        />
      </label>
    </div>
  </>
);

export const DbMigrationPackTargetBuildModal: React.FC<
  DbMigrationPackTargetBuildModalProps
> = ({ variant, busy, error, purpose, onSubmit, onClose }) => {
  const [target, setTarget] = useState<ConnectionFields>(EMPTY_TARGET);
  const [source, setSource] = useState<ConnectionFields>(EMPTY_SOURCE);
  const [rebuild, setRebuild] = useState(false);

  const isBuild = variant === 'build';
  const sourceTouched = !untouched(source, EMPTY_SOURCE);

  const canSubmit = useMemo(
    () =>
      !busy &&
      complete(target) &&
      // A partially filled source block is a mistake, not an omission.
      (!isBuild || !sourceTouched || complete(source)),
    [busy, target, source, isBuild, sourceTouched],
  );

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      targetDb: toCredentials(target, 'postgres'),
      sourceDb:
        isBuild && sourceTouched ? toCredentials(source, 'sybase') : null,
      rebuild: isBuild && rebuild,
    });
  };

  const title = isBuild
    ? 'Build target database from the pack'
    : 'Target PostgreSQL connection';

  return (
    <div
      className={styles.modalOverlay}
      data-testid="db-pack-wb-target-modal"
      data-variant={variant}
    >
      <div className={styles.modal} role="dialog" aria-label={title}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <p className={styles.modalHint}>
            {isBuild
              ? 'Runs the full build from this pack into the declared target ' +
                'database: schema apply, data load, then the approved ' +
                'translations. Credentials are used for this action only — ' +
                'they are sent per invocation and never stored.'
              : `Target credentials are needed for ${
                  purpose ?? 'this action'
                }. They are held in memory for this tab session only and are ` +
                'never stored.'}
          </p>
        </div>
        <div className={styles.modalBody}>
          <h4 className={styles.manifestSectionTitle}>
            Target — PostgreSQL
          </h4>
          <ConnectionBlock
            testIdPrefix="db-pack-wb-target"
            value={target}
            onChange={setTarget}
            busy={busy}
          />

          {isBuild && (
            <>
              <h4 className={styles.manifestSectionTitle}>
                Source — Sybase ASE (optional)
              </h4>
              <p className={styles.manifestNote}>
                Needed by the data phase. Leave the block empty to build the
                schema and translations only — the gateway answers
                SOURCE_DB_MISSING if the data phase needs it.
              </p>
              <ConnectionBlock
                testIdPrefix="db-pack-wb-source"
                value={source}
                onChange={setSource}
                busy={busy}
              />

              <label className={styles.filterGroup}>
                <span className={styles.filterLabel}>
                  <input
                    type="checkbox"
                    checked={rebuild}
                    onChange={(e) => setRebuild(e.target.checked)}
                    disabled={busy}
                    data-testid="db-pack-wb-target-rebuild"
                  />{' '}
                  Rebuild from scratch
                </span>
              </label>
              <p
                className={styles.manifestNote}
                data-testid="db-pack-wb-target-rebuild-note"
              >
                The server refuses rebuild today: drop and recreate the target
                database yourself, then build. The checkbox is off by default.
              </p>
            </>
          )}

          {error && (
            <div
              className={styles.errorBanner}
              data-testid="db-pack-wb-target-modal-error"
            >
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
            data-testid="db-pack-wb-target-modal-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="db-pack-wb-target-modal-submit"
          >
            {busy ? 'Working…' : isBuild ? 'Build target' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DbMigrationPackTargetBuildModal;
