/**
 * StartDiscoveryRunModal
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start
 * Task Group 4.3: Pre-run modal for the default Start Discovery Run flow
 *
 * The default "Start Discovery Run" context-menu action (Tier A / Tier B)
 * historically fired the run immediately with no upfront modal. Spec 4
 * inserts this minimal pre-run modal so the user can optionally attach
 * runtime log files before the run is created.
 *
 * Shape (deliberately minimal -- per shaping-notes resolved Q1):
 *   - Title row + close button
 *   - Embedded `LogFileUploadInput` (the only first-class addition)
 *   - Start / Cancel footer buttons
 *
 * Explicitly NOT replicated from `PreflightModal`:
 *   - "Include external libraries" toggle
 *   - BFS scan plan preview
 *   - Architecture picker (the parent already has architectureId in scope at
 *     the call site -- `handleStartDiscoveryRunFromMenu` in Grid.tsx)
 *
 * Run-start orchestration (locked sequence -- see spec.md "Run-start
 * orchestration: create-run-first then upload-after"):
 *   1. User clicks Start.
 *   2. We call `startDiscoveryRun(projectId, architectureId, serviceId, false)`.
 *      This is the existing run-creation path, signature unchanged.
 *   3. Capture the returned `runId`.
 *   4. If `selectedFiles.length > 0` -> POST the multipart upload via
 *      `uploadDiscoveryRunLogFiles(projectId, architectureId, runId, files, maxLogPathPrefixSegments)`.
 *   5. On all success -> `onRunStarted(runId)` (parent navigates) and close.
 *   6. On upload failure -> KEEP the run (do NOT roll back per spec ACs),
 *      surface an inline error banner with the gateway error detail, do NOT
 *      auto-close the modal. The user dismisses via Cancel / X.
 *
 * 409-handling note: this modal owns ONLY the happy / non-409 paths. The
 * existing Tier-C 409 confirmation flow (`StartDiscoveryRunConfirmModal`)
 * remains a SEPARATE gate -- if a 409 surfaces from `startDiscoveryRun`, we
 * re-throw it through `onRunStartError` so the parent can fall back to its
 * existing error-handling pipeline (toast + open the confirm modal).
 *
 * Spec 2026-05-11: Discovery Run Robustness -- Section 1
 *   - Adds a per-run M control (`maxLogPathPrefixSegments`) visible only
 *     when at least one log file is selected. The default is 1 and the
 *     value clamps to [0..5] via the HTML `min`/`max` attributes. The
 *     value is forwarded to `uploadDiscoveryRunLogFiles` so it rides the
 *     log-files PATCH; the run-create POST shape is UNCHANGED.
 *
 * Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Group 5
 *   - Adds a `Source` toggle at the top: `Code` (existing) vs `Database`
 *     (new). The `Code` panel is the existing log-files flow above -- when
 *     the user keeps `Code` selected, behaviour is unchanged.
 *   - The `Database` panel renders a connection form (engine dropdown,
 *     host, port, database name, schema/table filters, profiling mode
 *     radio, username, password, read-only confirmation checkbox).
 *   - `Test connection` button calls the gateway proxy
 *     `POST /api/v1/discovery/db/test-connection` (which forwards to the
 *     discovery-service) and surfaces success / error inline.
 *   - `Start run` is disabled until BOTH (a) test-connection succeeded AND
 *     (b) the read-only confirmation checkbox is checked.
 *   - Workload-log upload is rendered as a DISABLED control with a
 *     "Coming in v1.5" tooltip (D4 deferral marker).
 *   - For `deep` profiling mode, a second confirmation checkbox is shown
 *     and required (D8).
 *   - On Start, the run-create POST carries `discovery_kind='database'`
 *     plus the connection config (with the password included in the
 *     request body only -- the discovery-service stores it in-memory for
 *     the run's lifetime and purges it on completion). The frontend NEVER
 *     persists the password beyond the in-form state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { LogFileUploadInput } from './LogFileUploadInput';
import {
  uploadDiscoveryRunLogFiles,
  testDatabaseConnection,
  type DiscoveryDatabaseConnectionConfig,
  type DiscoveryDatabaseEngine,
  type DiscoveryDatabaseProfilingMode,
  type DiscoveryDatabaseTestConnectionResult,
  type DiscoverySybaseDriverChoice,
} from '../../api/discoveryApi';
import { startDiscoveryRun } from '../../services/gatewayClient';
import styles from './StartDiscoveryRunModal.module.css';

export interface StartDiscoveryRunModalProps {
  isOpen: boolean;
  /** Project the run belongs to. */
  projectId: string;
  /** Architecture the run will be bound to (for life). */
  architectureId: string;
  /** The service the run is rooted at. */
  serviceId: string;
  /** Display name for the title row. */
  serviceName?: string;
  /** Closes the modal without starting a run (Cancel / Escape / overlay click / X). */
  onClose: () => void;
  /**
   * Called once `startDiscoveryRun` succeeds (regardless of upload outcome --
   * the run already exists at that point per spec). The parent typically
   * navigates to the run-detail route here.
   */
  onRunStarted: (runId: string) => void;
  /**
   * Called when `startDiscoveryRun` itself fails (e.g. 409 LLM_SOLO /
   * TECH_HINTS, network error). The parent's existing error pipeline
   * (toast + Tier-C confirm modal) handles this. Upload-only failures are
   * NOT routed here -- they stay inside the modal so the user can read the
   * detail and dismiss explicitly.
   */
  onRunStartError: (err: unknown) => void;
  /**
   * Spec 2026-06-06: when set, LOCKS the Source to this value and HIDES the
   * Code/Database toggle. The two service-row context-menu entry points pass
   * it so "Start Discovery Run (No Libraries)" is unambiguously a Code scan and
   * "Start Discovery Run (Database)" is unambiguously a Database scan -- the
   * Tech Type / Core Tech of the service decides which item is offered, so the
   * in-modal toggle would only reintroduce the ambiguity. When undefined/null
   * the toggle is shown and defaults to Code (the legacy behaviour).
   */
  lockedSourceMode?: SourceMode | null;
}

// Spec 2026-05-11 Section 1: default value for the per-run M control.
// Matches the discovery-service orchestrator's defensive default at the
// matcher-read site.
const DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS = 1;
const MIN_MAX_LOG_PATH_PREFIX_SEGMENTS = 0;
const MAX_MAX_LOG_PATH_PREFIX_SEGMENTS = 5;

// Spec 2026-05-16 Group 5: defaults for the new DB connection form.
const DEFAULT_PORT_BY_ENGINE: Record<DiscoveryDatabaseEngine, number> = {
  postgres: 5432,
  sybase: 5000,
};

export type SourceMode = 'code' | 'database';

interface DatabaseFormState {
  engine: DiscoveryDatabaseEngine;
  host: string;
  port: number;
  databaseName: string;
  includeSchemasCsv: string;
  excludeSchemasCsv: string;
  includeTablesCsv: string;
  excludeTablesCsv: string;
  profilingMode: DiscoveryDatabaseProfilingMode;
  deepProfilingConfirmed: boolean;
  username: string;
  password: string;
  readOnlyConfirmed: boolean;
  // Sybase-only driver picker. Carried in form state regardless of engine
  // so toggling between engines doesn't lose the user's selection; the
  // value is only sent on the wire when engine === 'sybase'.
  sybaseDriver: DiscoverySybaseDriverChoice;
}

const INITIAL_DB_FORM: DatabaseFormState = {
  engine: 'postgres',
  host: '',
  port: DEFAULT_PORT_BY_ENGINE.postgres,
  databaseName: '',
  includeSchemasCsv: '',
  excludeSchemasCsv: '',
  includeTablesCsv: '',
  excludeTablesCsv: '',
  profilingMode: 'standard',
  deepProfilingConfirmed: false,
  username: '',
  password: '',
  readOnlyConfirmed: false,
  sybaseDriver: 'auto',
};

function csvToList(raw: string): string[] | null {
  const cleaned = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return cleaned.length === 0 ? null : cleaned;
}

function buildConnectionConfig(form: DatabaseFormState): DiscoveryDatabaseConnectionConfig {
  return {
    dbEngine: form.engine,
    host: form.host.trim(),
    port: form.port,
    databaseName: form.databaseName.trim(),
    includeSchemas: csvToList(form.includeSchemasCsv),
    excludeSchemas: csvToList(form.excludeSchemasCsv),
    includeTables: csvToList(form.includeTablesCsv),
    excludeTables: csvToList(form.excludeTablesCsv),
    profilingMode: form.profilingMode,
    deepProfilingConfirmed: form.deepProfilingConfirmed,
    readOnlyConfirmed: form.readOnlyConfirmed,
    username: form.username,
    password: form.password,
    // Wire the driver choice only for Sybase. Sending it for other engines
    // would be harmless (server ignores it) but omitting keeps the payload
    // tidy and surface-area honest.
    ...(form.engine === 'sybase' ? { sybaseDriver: form.sybaseDriver } : {}),
  };
}

export function StartDiscoveryRunModal({
  isOpen,
  projectId,
  architectureId,
  serviceId,
  serviceName,
  onClose,
  onRunStarted,
  onRunStartError,
  lockedSourceMode,
}: StartDiscoveryRunModalProps) {
  // Existing code-path state.
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [maxLogPathPrefixSegments, setMaxLogPathPrefixSegments] = useState<number>(
    DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Upload-only error stays inside the modal so the user can read it and
  // dismiss explicitly per spec ACs (run already started; user must SEE
  // that logs failed to attach before closing the dialog).
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Spec 2026-05-16 Group 5: new state for the Source toggle + DB form.
  const [sourceMode, setSourceMode] = useState<SourceMode>('code');
  const [dbForm, setDbForm] = useState<DatabaseFormState>(INITIAL_DB_FORM);
  const [testResult, setTestResult] = useState<DiscoveryDatabaseTestConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Re-seed state whenever the modal opens. The previous run's selection /
  // error must NOT bleed into the next open.
  useEffect(() => {
    if (isOpen) {
      setSelectedFiles([]);
      setMaxLogPathPrefixSegments(DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS);
      setIsSubmitting(false);
      setUploadError(null);
      // Spec 2026-06-06: seed from the locked mode (if the entry point fixed
      // the Source); otherwise default to Code as before.
      setSourceMode(lockedSourceMode ?? 'code');
      setDbForm(INITIAL_DB_FORM);
      setTestResult(null);
      setIsTesting(false);
      setTestError(null);
    }
  }, [isOpen, lockedSourceMode]);

  // Escape key closes the modal (only when no submit is in flight, to avoid
  // tearing down a half-completed orchestration).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSubmitting]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isSubmitting) onClose();
    },
    [onClose, isSubmitting],
  );

  const handleMaxSegmentsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Empty string -> fall back to the default; otherwise parseInt and
      // clamp to [MIN..MAX] defensively (the `min`/`max` HTML attributes
      // do the same on the browser side but a programmatic / paste path
      // could land outside the range).
      const raw = e.target.value;
      if (raw === '') {
        setMaxLogPathPrefixSegments(DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS);
        return;
      }
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        setMaxLogPathPrefixSegments(DEFAULT_MAX_LOG_PATH_PREFIX_SEGMENTS);
        return;
      }
      const clamped = Math.max(
        MIN_MAX_LOG_PATH_PREFIX_SEGMENTS,
        Math.min(MAX_MAX_LOG_PATH_PREFIX_SEGMENTS, parsed)
      );
      setMaxLogPathPrefixSegments(clamped);
    },
    []
  );

  // --------------------------------------------------------------------------
  // DB-form helpers (Spec 2026-05-16 Group 5)
  // --------------------------------------------------------------------------

  // Fields that influence the connection probe -- changing any of these
  // invalidates a prior test result. Profiling-mode / read-only / deep
  // confirmation toggles do NOT affect the probe so we leave the result
  // standing for those.
  const CONNECTION_FIELDS: ReadonlyArray<keyof DatabaseFormState> = [
    'engine',
    'host',
    'port',
    'databaseName',
    'includeSchemasCsv',
    'excludeSchemasCsv',
    'includeTablesCsv',
    'excludeTablesCsv',
    'username',
    'password',
    'sybaseDriver',
  ];

  const updateDbForm = useCallback(
    <K extends keyof DatabaseFormState>(field: K, value: DatabaseFormState[K]) => {
      setDbForm((prev) => ({ ...prev, [field]: value }));
      // Connection-affecting field edits invalidate a prior successful test
      // result -- otherwise the user could test against host A, edit to host
      // B, and submit a run that "thinks" the connection was verified.
      if (CONNECTION_FIELDS.includes(field)) {
        setTestResult(null);
        setTestError(null);
      }
    },
    []
  );

  const handleEngineChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const engine = e.target.value as DiscoveryDatabaseEngine;
      setDbForm((prev) => ({
        ...prev,
        engine,
        // Reset the port to the engine default when the user switches engines
        // unless they have already edited away from a known default.
        port: DEFAULT_PORT_BY_ENGINE[engine] ?? prev.port,
      }));
      setTestResult(null);
      setTestError(null);
    },
    []
  );

  const handleTestConnection = useCallback(async () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testDatabaseConnection(buildConnectionConfig(dbForm));
      setTestResult(result);
      if (!result.success) {
        setTestError(result.error?.message ?? 'Connection test failed.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTestError(message);
      setTestResult({ success: false, engine: dbForm.engine, error: { code: 0, message } });
    } finally {
      setIsTesting(false);
    }
  }, [dbForm, isTesting]);

  // Validation: the DB Start button is enabled only when BOTH (a) the test
  // connection succeeded AND (b) the read-only confirmation checkbox is
  // checked. For `deep` profiling mode we ALSO require the second-click
  // confirmation (D8).
  const dbStartEnabled =
    sourceMode === 'database' &&
    testResult?.success === true &&
    dbForm.readOnlyConfirmed &&
    (dbForm.profilingMode !== 'deep' || dbForm.deepProfilingConfirmed) &&
    !isSubmitting;

  // The Test button is enabled when the minimum identifying fields are
  // populated AND the read-only confirmation is checked (so we never
  // exercise credentials against a DB without an explicit RO confirmation).
  const dbTestEnabled =
    sourceMode === 'database' &&
    dbForm.host.trim().length > 0 &&
    dbForm.databaseName.trim().length > 0 &&
    dbForm.username.length > 0 &&
    dbForm.password.length > 0 &&
    dbForm.readOnlyConfirmed &&
    !isTesting &&
    !isSubmitting;

  // --------------------------------------------------------------------------
  // Start handler -- branches on sourceMode
  // --------------------------------------------------------------------------

  const handleStart = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setUploadError(null);

    // --- Database source branch ---------------------------------------------
    if (sourceMode === 'database') {
      let runId: string | null = null;
      try {
        // Run-create POST with discovery_kind='database' + the connection
        // config (including the password) in the body. The discovery-service
        // holds the password in-memory for the run's lifetime and purges it
        // on completion. The gateway is a transparent forwarder.
        const config = buildConnectionConfig(dbForm);
        const created = await startDiscoveryRun(
          projectId,
          architectureId,
          serviceId,
          false,
          {
            discoveryKind: 'database',
            // Cast to the loose record shape the gatewayClient signature
            // accepts -- the DiscoveryDatabaseConnectionConfig is a strict
            // typed interface and TypeScript will not implicitly widen it.
            databaseConfig: config as unknown as Record<string, unknown>,
            // The discovery-service expects username/password as a separate
            // top-level field on the run-create body, not nested inside
            // database_config. They are held in-process for the run's
            // lifetime and purged on completion; the frontend MUST NOT
            // persist them beyond the in-form state.
            databaseCredentials: {
              username: dbForm.username,
              password: dbForm.password,
            },
          },
        );
        runId = created?.id ?? null;
        if (!runId) {
          throw new Error('Run was created but no run id was returned by the gateway.');
        }
      } catch (err) {
        setIsSubmitting(false);
        onRunStartError(err);
        onClose();
        return;
      }
      setIsSubmitting(false);
      onRunStarted(runId);
      onClose();
      return;
    }

    // --- Code source branch (existing flow, unchanged) ---------------------
    let runId: string | null = null;
    try {
      // Step 2-3: create the run first. Existing signature unchanged --
      // confirmLlmSolo=false on first attempt; Tier-C is handled separately
      // by the parent's StartDiscoveryRunConfirmModal pipeline.
      const created = await startDiscoveryRun(projectId, architectureId, serviceId, false);
      runId = created?.id ?? null;
      if (!runId) {
        throw new Error('Run was created but no run id was returned by the gateway.');
      }
    } catch (err) {
      setIsSubmitting(false);
      // Hand the run-start error back to the parent so it can drive its
      // existing pipeline (Tier-C confirm modal, tech-hints toast, etc.).
      // We close ourselves so the parent's confirm modal can take over the
      // surface without two dialogs stacking.
      onRunStartError(err);
      onClose();
      return;
    }

    // Step 4: upload-after only when the user picked files.
    if (selectedFiles.length === 0) {
      setIsSubmitting(false);
      onRunStarted(runId);
      onClose();
      return;
    }

    try {
      // Spec 2026-05-11 Section 1: thread the M value through to the
      // log-files PATCH. The run-create POST shape is UNCHANGED -- M only
      // rides this multipart upload call.
      await uploadDiscoveryRunLogFiles(
        projectId,
        architectureId,
        runId,
        selectedFiles,
        maxLogPathPrefixSegments
      );
      // Step 5: full success -> hand off + close.
      setIsSubmitting(false);
      onRunStarted(runId);
      onClose();
    } catch (err) {
      // Step 6: upload-only failure. Run is NOT rolled back -- we keep the
      // modal open with an inline error banner so the user can read the
      // detail and dismiss explicitly. Notify the parent that the run
      // started so it can still navigate / refresh state if it wants to.
      setIsSubmitting(false);
      const detail = err instanceof Error ? err.message : 'Upload failed.';
      setUploadError(detail);
      // Run already exists -- let the parent know so any side-effects
      // (e.g. invalidating the run list) can fire even though the modal
      // stays open.
      onRunStarted(runId);
    }
  }, [
    isSubmitting,
    projectId,
    architectureId,
    serviceId,
    sourceMode,
    dbForm,
    selectedFiles,
    maxLogPathPrefixSegments,
    onRunStarted,
    onRunStartError,
    onClose,
  ]);

  if (!isOpen) return null;

  // Spec 2026-05-11 Section 1: M control is irrelevant without logs, so
  // we hide it entirely until at least one file is selected.
  const showMaxSegmentsControl = selectedFiles.length > 0;

  const codeStartEnabled = sourceMode === 'code' && !isSubmitting;
  const primaryEnabled = sourceMode === 'code' ? codeStartEnabled : dbStartEnabled;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="start-discovery-run-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            Start Discovery Run
            {serviceName ? <span className={styles.subtitle}>{serviceName}</span> : null}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
            data-testid="start-discovery-run-modal-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {/* Spec 2026-05-16 Group 5: Source toggle. Code preserves the
              existing flow; Database swaps in the new connection form.
              Spec 2026-06-06: hidden entirely when the entry point locked the
              Source -- the toggle would only reintroduce the Code/Database
              ambiguity the locked entry points exist to remove. */}
          {!lockedSourceMode && (
          <div
            className={styles.sourceToggle}
            role="radiogroup"
            aria-label="Discovery source"
            data-testid="start-discovery-run-modal-source-toggle"
          >
            <label className={styles.sourceToggleLabel}>
              <input
                type="radio"
                name="source"
                value="code"
                checked={sourceMode === 'code'}
                onChange={() => setSourceMode('code')}
                disabled={isSubmitting}
                data-testid="start-discovery-run-modal-source-code"
              />
              <span>Code</span>
            </label>
            <label className={styles.sourceToggleLabel}>
              <input
                type="radio"
                name="source"
                value="database"
                checked={sourceMode === 'database'}
                onChange={() => setSourceMode('database')}
                disabled={isSubmitting}
                data-testid="start-discovery-run-modal-source-database"
              />
              <span>Database</span>
            </label>
          </div>
          )}

          {sourceMode === 'code' && (
            <div data-testid="start-discovery-run-modal-code-panel">
              <LogFileUploadInput
                selectedFiles={selectedFiles}
                onChange={setSelectedFiles}
                disabled={isSubmitting}
              />

              {showMaxSegmentsControl && (
                <div
                  className={styles.fieldGroup}
                  data-testid="start-discovery-run-modal-max-segments-field"
                >
                  <label
                    className={styles.label}
                    htmlFor="start-discovery-run-modal-max-segments-input"
                  >
                    Max proxy prefix segments
                  </label>
                  <input
                    id="start-discovery-run-modal-max-segments-input"
                    type="number"
                    min={MIN_MAX_LOG_PATH_PREFIX_SEGMENTS}
                    max={MAX_MAX_LOG_PATH_PREFIX_SEGMENTS}
                    step={1}
                    className={styles.input}
                    value={maxLogPathPrefixSegments}
                    onChange={handleMaxSegmentsChange}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-max-segments-input"
                  />
                  <span
                    className={styles.hint}
                    data-testid="start-discovery-run-modal-max-segments-hint"
                  >
                    Tolerate up to N proxy prefix segments when matching log paths to endpoints (0-5, default 1)
                  </span>
                </div>
              )}

              {uploadError && (
                <div
                  className={styles.errorBanner}
                  role="alert"
                  data-testid="start-discovery-run-modal-upload-error"
                >
                  <strong>Log upload failed.</strong>
                  <span> The run was started, but log files were not attached.</span>
                  <div className={styles.errorDetail}>{uploadError}</div>
                </div>
              )}
            </div>
          )}

          {sourceMode === 'database' && (
            <div
              className={styles.databasePanel}
              data-testid="start-discovery-run-modal-database-panel"
            >
              {/* Spec 2026-06-06: engine + (when Sybase) the driver picker on
                  one row -- the driver appears to the right of the engine. */}
              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-engine">
                    DB engine
                  </label>
                  <select
                    id="db-engine"
                    className={styles.input}
                    value={dbForm.engine}
                    onChange={handleEngineChange}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-db-engine"
                  >
                    <option value="postgres">PostgreSQL</option>
                    <option value="sybase">Sybase ASE</option>
                  </select>
                </div>

                {dbForm.engine === 'sybase' && (
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor="db-sybase-driver">
                      Sybase driver
                    </label>
                    <select
                      id="db-sybase-driver"
                      className={styles.input}
                      value={dbForm.sybaseDriver}
                      onChange={(e) =>
                        updateDbForm(
                          'sybaseDriver',
                          e.target.value as DiscoverySybaseDriverChoice,
                        )
                      }
                      disabled={isSubmitting}
                      data-testid="start-discovery-run-modal-db-sybase-driver"
                    >
                      <option value="auto">Auto (try jTDS, then jConnect)</option>
                      <option value="jtds">jTDS</option>
                      <option value="jconnect">jConnect (jconn4)</option>
                    </select>
                    <span className={styles.hint}>
                      jConnect requires <code>sybase-discovery-sidecar/lib/jconn4.jar</code> to be present.
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-host">Host</label>
                  <input
                    id="db-host"
                    type="text"
                    className={styles.input}
                    value={dbForm.host}
                    onChange={(e) => updateDbForm('host', e.target.value)}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-db-host"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-port">Port</label>
                  <input
                    id="db-port"
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    className={styles.input}
                    value={dbForm.port}
                    onChange={(e) => updateDbForm('port', parseInt(e.target.value, 10) || 0)}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-db-port"
                  />
                </div>
                {/* Spec 2026-06-06: Database name shares the Host/Port row. */}
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-name">Database name</label>
                  <input
                    id="db-name"
                    type="text"
                    className={styles.input}
                    value={dbForm.databaseName}
                    onChange={(e) => updateDbForm('databaseName', e.target.value)}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-db-name"
                  />
                </div>
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-include-schemas">
                    Include schemas (CSV)
                  </label>
                  <input
                    id="db-include-schemas"
                    type="text"
                    className={styles.input}
                    value={dbForm.includeSchemasCsv}
                    onChange={(e) => updateDbForm('includeSchemasCsv', e.target.value)}
                    disabled={isSubmitting}
                    placeholder="public, sales"
                    data-testid="start-discovery-run-modal-db-include-schemas"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-exclude-schemas">
                    Exclude schemas (CSV)
                  </label>
                  <input
                    id="db-exclude-schemas"
                    type="text"
                    className={styles.input}
                    value={dbForm.excludeSchemasCsv}
                    onChange={(e) => updateDbForm('excludeSchemasCsv', e.target.value)}
                    disabled={isSubmitting}
                    placeholder="information_schema, pg_catalog"
                    data-testid="start-discovery-run-modal-db-exclude-schemas"
                  />
                </div>
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-include-tables">
                    Include tables (CSV)
                  </label>
                  <input
                    id="db-include-tables"
                    type="text"
                    className={styles.input}
                    value={dbForm.includeTablesCsv}
                    onChange={(e) => updateDbForm('includeTablesCsv', e.target.value)}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-db-include-tables"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-exclude-tables">
                    Exclude tables (CSV)
                  </label>
                  <input
                    id="db-exclude-tables"
                    type="text"
                    className={styles.input}
                    value={dbForm.excludeTablesCsv}
                    onChange={(e) => updateDbForm('excludeTablesCsv', e.target.value)}
                    disabled={isSubmitting}
                    data-testid="start-discovery-run-modal-db-exclude-tables"
                  />
                </div>
              </div>

              <div
                className={styles.fieldGroup}
                role="radiogroup"
                aria-label="Profiling mode"
                data-testid="start-discovery-run-modal-db-profiling-mode"
              >
                <span className={styles.label}>Profiling mode</span>
                {/* Spec 2026-06-06: the four options on a single row. */}
                <div className={styles.radioRow}>
                  {(['none', 'basic', 'standard', 'deep'] as DiscoveryDatabaseProfilingMode[]).map(
                    (mode) => (
                      <label key={mode} className={styles.sourceToggleLabel}>
                        <input
                          type="radio"
                          name="profilingMode"
                          value={mode}
                          checked={dbForm.profilingMode === mode}
                          onChange={() => updateDbForm('profilingMode', mode)}
                          disabled={isSubmitting}
                          data-testid={`start-discovery-run-modal-db-profiling-mode-${mode}`}
                        />
                        <span>{mode}</span>
                      </label>
                    )
                  )}
                </div>
                {dbForm.profilingMode === 'deep' && (
                  <label
                    className={styles.checkboxRow}
                    data-testid="start-discovery-run-modal-db-deep-confirmation"
                  >
                    <input
                      type="checkbox"
                      checked={dbForm.deepProfilingConfirmed}
                      onChange={(e) =>
                        updateDbForm('deepProfilingConfirmed', e.target.checked)
                      }
                      disabled={isSubmitting}
                    />
                    <span>
                      I confirm deep profiling is acceptable -- it may run heavier queries
                      against the database.
                    </span>
                  </label>
                )}
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-username">Username</label>
                  <input
                    id="db-username"
                    type="text"
                    className={styles.input}
                    value={dbForm.username}
                    onChange={(e) => updateDbForm('username', e.target.value)}
                    disabled={isSubmitting}
                    autoComplete="off"
                    data-testid="start-discovery-run-modal-db-username"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="db-password">Password</label>
                  <input
                    id="db-password"
                    type="password"
                    className={styles.input}
                    value={dbForm.password}
                    onChange={(e) => updateDbForm('password', e.target.value)}
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    data-testid="start-discovery-run-modal-db-password"
                  />
                </div>
              </div>

              <label
                className={styles.checkboxRow}
                data-testid="start-discovery-run-modal-db-readonly-row"
              >
                <input
                  type="checkbox"
                  checked={dbForm.readOnlyConfirmed}
                  onChange={(e) => updateDbForm('readOnlyConfirmed', e.target.checked)}
                  disabled={isSubmitting}
                  data-testid="start-discovery-run-modal-db-readonly-confirmed"
                />
                <span>
                  I confirm these credentials are read-only and connecting will not modify the
                  database.
                </span>
              </label>

              <div className={styles.fieldGroup}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleTestConnection}
                  disabled={!dbTestEnabled}
                  data-testid="start-discovery-run-modal-db-test-connection-button"
                >
                  {isTesting ? 'Testing...' : 'Test connection'}
                </button>
                {testResult?.success && (
                  <span
                    className={styles.hint}
                    data-testid="start-discovery-run-modal-db-test-success"
                  >
                    Connection ok
                    {testResult.serverVersion ? ` (${testResult.serverVersion})` : ''}
                    {testResult.driverUsed ? ` via ${testResult.driverUsed}` : ''}
                  </span>
                )}
                {testError && (
                  <div
                    className={styles.errorBanner}
                    role="alert"
                    data-testid="start-discovery-run-modal-db-test-error"
                  >
                    <strong>Connection failed.</strong>
                    <div className={styles.errorDetail}>{testError}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="start-discovery-run-modal-cancel-button"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleStart}
            disabled={!primaryEnabled}
            data-testid="start-discovery-run-modal-start-button"
          >
            {isSubmitting ? 'Starting...' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartDiscoveryRunModal;
