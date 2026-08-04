/**
 * DbMigrationPackHarvestModal
 *
 * Spec 3 — Sybase schema harvest (frontend surface).
 *
 * Per-invocation connection prompt for the structural harvest: read the REAL
 * schema from the live source database, save it back into the model, and
 * regenerate the pack. Follows the `DbMigrationPackCredentialsModal` idiom
 * (same css module classes, same field set minus schema, plus a driver
 * select) with TWO actions:
 *
 *   - Test connection      — quick probe; shows the engine/server version or
 *                            the failure inline.
 *   - Harvest & regenerate — the LONG call (up to ~10 minutes). The form is
 *                            disabled while running with a progress note. On
 *                            stage 'completed' the parent closes the modal
 *                            and refreshes; any failed stage is reported
 *                            honestly IN the modal together with the
 *                            save-back summary when present (e.g. "model was
 *                            backfilled but pack regeneration failed").
 *
 * CREDENTIALS ARE NEVER STORED CLIENT-SIDE: form state lives only inside this
 * component instance (no localStorage, no context) and is discarded when the
 * modal unmounts on close.
 */

import React, { useMemo, useState } from 'react';
import {
  runStructuralHarvest,
  testDbSourceConnection,
  type DbStructuralHarvestSavedBack,
  type DbStructuralHarvestStage,
  type RunDbStructuralHarvestResponse,
} from '../../../api/dbMigrationPackApi';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackHarvestModalProps {
  projectId: string;
  /** The pack view's architecture — rides as `architecture_id`. */
  architectureId: string;
  /** Rides as `target_architecture_id` when the mounting context has one. */
  targetArchitectureId?: string | null;
  /** Fired ONLY on stage 'completed' — the parent closes + refreshes. */
  onCompleted: (result: RunDbStructuralHarvestResponse) => void;
  onClose: () => void;
}

type SybaseDriverChoice = 'auto' | 'jtds' | 'jconnect';

/** Honest per-stage failure copy (stage 'completed' never reaches here). */
const FAILED_STAGE_COPY: Record<
  Exclude<DbStructuralHarvestStage, 'completed'>,
  string
> = {
  scan_failed: 'Source catalog scan failed — the model and pack are unchanged.',
  save_failed:
    'The scan succeeded but saving the harvested schema back into the model failed.',
  regenerate_failed:
    'Model was backfilled but pack regeneration failed — use Regenerate.',
};

function savedBackSummary(savedBack: DbStructuralHarvestSavedBack): string {
  return (
    `Saved back: ${savedBack.entitiesCreated} entities created, ` +
    `${savedBack.entitiesSkipped} skipped, ` +
    `${savedBack.candidatesCommitted} candidates committed.`
  );
}

export const DbMigrationPackHarvestModal: React.FC<
  DbMigrationPackHarvestModalProps
> = ({ projectId, architectureId, targetArchitectureId, onCompleted, onClose }) => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(5000);
  const [databaseName, setDatabaseName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [driver, setDriver] = useState<SybaseDriverChoice>('auto');

  const [testing, setTesting] = useState(false);
  const [harvesting, setHarvesting] = useState(false);
  /** Success line from the last Test connection run. */
  const [testResult, setTestResult] = useState<string | null>(null);
  /** Thrown-error text (test OR harvest transport/4xx failure). */
  const [error, setError] = useState<string | null>(null);
  /** A 200-with-failed-stage harvest outcome, reported honestly. */
  const [failure, setFailure] = useState<{
    stage: Exclude<DbStructuralHarvestStage, 'completed'>;
    error: string | null;
    savedBack: DbStructuralHarvestSavedBack | null;
  } | null>(null);

  const busy = testing || harvesting;

  const formComplete = useMemo(
    () =>
      host.trim().length > 0 &&
      databaseName.trim().length > 0 &&
      username.length > 0 &&
      password.length > 0 &&
      Number.isFinite(port) &&
      port > 0,
    [host, databaseName, username, password, port],
  );

  const handleTest = async () => {
    if (!formComplete || busy) return;
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await testDbSourceConnection(projectId, {
        host: host.trim(),
        port,
        databaseName: databaseName.trim(),
        username,
        password,
        ...(driver !== 'auto' ? { sybaseDriver: driver } : {}),
      });
      setTestResult(
        `Connected — ${result.engine} ${result.serverVersion} ` +
          `(driver: ${result.driverUsed}).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Source connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleHarvest = async () => {
    if (!formComplete || busy) return;
    setHarvesting(true);
    setError(null);
    setFailure(null);
    try {
      const result = await runStructuralHarvest(projectId, {
        architecture_id: architectureId,
        ...(targetArchitectureId
          ? { target_architecture_id: targetArchitectureId }
          : {}),
        host: host.trim(),
        port,
        database_name: databaseName.trim(),
        username,
        password,
        ...(driver !== 'auto' ? { sybase_driver: driver } : {}),
      });
      if (result.stage === 'completed') {
        onCompleted(result);
        return;
      }
      setFailure({
        stage: result.stage,
        error: result.error ?? null,
        savedBack: result.savedBack,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Structural harvest failed');
    } finally {
      setHarvesting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} data-testid="db-pack-harvest-modal">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Harvest from source DB"
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            Harvest from source DB — live Sybase connection
          </h3>
          <p className={styles.modalHint}>
            Reads the real schema from the live source database, saves it back
            into the model, and regenerates the pack. Credentials are used for
            this action only — sent per invocation and never stored.
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
                data-testid="db-pack-harvest-host"
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
                data-testid="db-pack-harvest-port"
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
                data-testid="db-pack-harvest-database"
              />
            </label>
            <label className={styles.filterGroup}>
              <span className={styles.filterLabel}>Driver (optional)</span>
              <select
                className={styles.filterSelect}
                value={driver}
                onChange={(e) => setDriver(e.target.value as SybaseDriverChoice)}
                disabled={busy}
                data-testid="db-pack-harvest-driver"
              >
                <option value="auto">Auto</option>
                <option value="jtds">jTDS</option>
                <option value="jconnect">jConnect</option>
              </select>
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
                data-testid="db-pack-harvest-username"
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
                data-testid="db-pack-harvest-password"
              />
            </label>
          </div>

          {harvesting && (
            <p className={styles.modalHint} data-testid="db-pack-harvest-progress">
              Scanning source catalogs — this can take a few minutes
            </p>
          )}

          {testResult && !harvesting && (
            <div
              className={styles.noticeBanner}
              data-testid="db-pack-harvest-test-result"
            >
              {testResult}
            </div>
          )}

          {error && (
            <div className={styles.errorBanner} data-testid="db-pack-harvest-error">
              {error}
            </div>
          )}

          {failure && (
            <div
              className={styles.errorBanner}
              data-testid="db-pack-harvest-failure"
            >
              <p>
                {FAILED_STAGE_COPY[failure.stage]}
                {failure.error ? ` ${failure.error}` : ''}
              </p>
              {failure.savedBack && (
                <p data-testid="db-pack-harvest-saved-back">
                  {savedBackSummary(failure.savedBack)}
                </p>
              )}
            </div>
          )}
        </div>
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={onClose}
            disabled={harvesting}
            data-testid="db-pack-harvest-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void handleTest()}
            disabled={!formComplete || busy}
            data-testid="db-pack-harvest-test-button"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={() => void handleHarvest()}
            disabled={!formComplete || busy}
            data-testid="db-pack-harvest-run-button"
          >
            {harvesting ? 'Harvesting…' : 'Harvest & regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DbMigrationPackHarvestModal;
