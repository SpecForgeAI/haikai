/**
 * CaptureSessionDetailView Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 *   + Task Group 9 polish for the secret-loss CTAs and the
 *   `CaptureReviewPanel` mount.
 *   + Task Group 10: AppShell model cache invalidation. The capture run
 *     writes to AMS-backed tables that the AppShell per-(project,
 *     architecture) in-memory model cache is unaware of. When the run
 *     reaches a terminal status (completed / failed / cancelled), the
 *     view dispatches `LOAD_MODEL` with a fresh fetch so the active
 *     architecture's in-memory model picks up the new rows. Edge-detect
 *     only -- we use a ref to track the previous status so the dispatch
 *     fires exactly once per terminal transition, NOT on every poll.
 *
 * Detail view for a single capture session. Mirrors the
 * `DiscoveryRunDetailView` polling pattern: poll AMS for the session row
 * every 2-3s while status is `running`, stop on terminal status.
 *
 * Secret-loss UX has TWO branches per spec:
 *
 *   (a) Idle session (`configured` / `completed` / `failed` / `cancelled`)
 *       with no in-memory secrets in the UI session: show an inline
 *       "Re-enter secrets" prompt that calls `/secrets` to repopulate the
 *       in-memory bundle. Execution actions are blocked until the prompt
 *       is satisfied.
 *
 *   (b) Session marked `failed` with `error_message='secrets_lost_during_run'`
 *       (set by the new service's startup-reconciliation): show two CTAs --
 *         "Clone configuration"            -> clone + navigate to new session
 *         "Re-enter secrets and start a new run"
 *                                          -> clone + navigate to new session
 *                                             with secrets prompt auto-open
 *       Both create a new draft session pre-filled from the failed
 *       session's redacted config via the `cloneCaptureSession` helper.
 *
 * Re-enter-secrets form is auth-type-aware (Fix A, 2026-06-03). The API-secret
 * field(s) rendered match `session.auth_type`:
 *   - `header` -> a password field for the header VALUE, labelled with the
 *     header NAME from `session.auth_config_redacted_json.headerName` (the
 *     name is redacted-safe; only the value is secret).
 *   - `basic`  -> username + password fields.
 *   - `bearer` -> the token field.
 *   - `none`   -> no API-secret field.
 * The DB password field is shown for every auth type. `handleSubmitSecrets`
 * builds `apiAuth` from `session.auth_type` + the entered value(s), matching
 * the shape `StartCaptureSessionWizard.buildSecretsBundle()` submits so both
 * submit paths are byte-identical on the wire.
 *
 * NOTE: the new service holds plaintext secrets in process memory keyed by
 * sessionId. The frontend cannot directly query that map without a new
 * service endpoint, so we approximate "in-memory secrets present" with a
 * UI-local flag flipped to true once the user submits secrets via this
 * page or the wizard. Refreshing the page resets the flag, which is the
 * conservative correct behaviour: after a refresh we MUST assume the
 * secrets need re-entry.
 *
 * The `CaptureReviewPanel` mounts at the bottom of the view once the
 * session has captures to review -- i.e. status in {running, completed,
 * failed}. While the session is still `running` the panel renders in
 * read-only mode (no action buttons) so users can watch captures stream in
 * but can't act on rows the loop may still retry.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiBehaviourCaptureSessionDto,
  ApiBehaviourApiError,
  SubmitSecretsRequest,
  TestApiConnectionResponse,
  TestDbConnectionResponse,
  cancelCaptureSession,
  cloneCaptureSession,
  getCaptureSession,
  startCaptureSession,
  submitSecrets,
  testApiConnection,
  testDbConnection,
} from '../../api/apiBehaviourClient';
import { CaptureReviewPanel } from './CaptureReviewPanel';
import { PostmanImportAppendModal } from '../ApiBehaviour/PostmanImportAppendModal';
import { CoverageSummaryPanel } from './CoverageSummaryPanel';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import styles from './ApiBaselinesListPage.module.css';

export interface CaptureSessionDetailViewProps {
  projectId: string;
  architectureId: string;
  sessionId: string;
  onClose?: () => void;
  /**
   * Polling cadence in ms while status === 'running'. Defaults to 2500ms
   * (matches the Discovery polling cadence: 2-3s).
   */
  pollIntervalMs?: number;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const SECRETS_LOST_ERROR = 'secrets_lost_during_run';

function isTerminal(status: string | null | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

/**
 * Read the redacted header name off a session's `auth_config_redacted_json`.
 * The header NAME is non-secret (it is persisted redacted-safe alongside the
 * `[REDACTED]` value), so the re-enter-secrets prompt can label the value
 * field with it. Returns an empty string when the session is not header-auth
 * or the config is missing the field.
 */
function redactedHeaderName(
  session: ApiBehaviourCaptureSessionDto | null,
): string {
  const cfg = session?.auth_config_redacted_json;
  if (!cfg || typeof cfg !== 'object') return '';
  const name = (cfg as Record<string, unknown>).headerName;
  return typeof name === 'string' ? name : '';
}

function statusClass(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'draft':
      return styles.statusDraft;
    case 'configured':
      return styles.statusConfigured;
    case 'running':
      return styles.statusRunning;
    case 'completed':
      return styles.statusCompleted;
    case 'failed':
      return styles.statusFailed;
    case 'cancelled':
      return styles.statusCancelled;
    default:
      return styles.statusDraft;
  }
}

export const CaptureSessionDetailView: React.FC<CaptureSessionDetailViewProps> = ({
  projectId,
  architectureId,
  sessionId,
  onClose,
  pollIntervalMs = 2500,
}) => {
  const navigate = useNavigate();
  const dispatch = useArchitectureDispatch();
  const activeProject = useProject();
  const [session, setSession] = useState<ApiBehaviourCaptureSessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bug 2 fix: the Test API / Test DB routes return HTTP 200 even when the
  // *target* fails (the API route's `success` is `status>=200 && status<500`,
  // so a 401/500 RESOLVES rather than throwing). The handlers used to discard
  // the resolved value, so a rejected probe was indistinguishable from no
  // click at all. We now capture the resolved result into state and render
  // inline feedback near the Test buttons -- treating `success === false` as a
  // visible FAILURE. The thrown-error path still flows to `setError` (rendered
  // as the error banner above the action footer).
  const [apiTestResult, setApiTestResult] =
    useState<TestApiConnectionResponse | null>(null);
  const [dbTestResult, setDbTestResult] =
    useState<TestDbConnectionResponse | null>(null);

  // UI-local "secrets are loaded in this UI session" flag. Reset to false
  // on every mount per the conservative rule above.
  const [secretsLoadedLocal, setSecretsLoadedLocal] = useState(false);

  // Mode 2 Postman append (Spec 2026-06-23, Task Group 8). Launched from this
  // detail view; the modal replays the imported collection live via
  // manual-capture and prompts re-enter-secrets on a purged finished session.
  const [appendModalOpen, setAppendModalOpen] = useState(false);

  // Re-enter secrets prompt visible/hidden + transient form state.
  //
  // Fix A (2026-06-03): the API-secret field(s) are auth-type-aware. The form
  // previously hardcoded a single "Bearer token" input and `handleSubmitSecrets`
  // always built `apiAuth` as `bearer | none`, ignoring `session.auth_type`.
  // A `header`-auth session (e.g. a custom header `ssoToken`) could therefore
  // never re-supply its secret, leaving Test/Start blocked forever. We now keep
  // one piece of transient state per auth shape (bearer token, header value,
  // basic username/password) and build `apiAuth` from `session.auth_type` to
  // match the shape the wizard's `buildSecretsBundle()` submits.
  const [secretsPromptOpen, setSecretsPromptOpen] = useState(false);
  const [bearerToken, setBearerToken] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [basicUsername, setBasicUsername] = useState('');
  const [basicPassword, setBasicPassword] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  // Track polling interval handle so we can clear it on terminal status.
  const pollHandleRef = useRef<number | null>(null);

  // Spec Group 10: edge-detect terminal-status transitions so we dispatch
  // `LOAD_MODEL` for the active architecture exactly ONCE per run, not on
  // every poll. The ref records the last status we observed; the effect
  // below compares (prev, current) and fires only on a non-terminal ->
  // terminal transition.
  //
  // A naive "dispatch whenever status is terminal" would re-fire after every
  // poll once the run completes (since polling stops, the session object
  // can still change identity via initial-load / manual refresh), and -- more
  // pragmatically -- it would re-fire whenever the component is remounted
  // against an already-terminal session. The ref-based edge detector keeps
  // the dispatch tied to the actual transition event.
  const prevStatusRef = useRef<string | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const fresh = await getCaptureSession(projectId, architectureId, sessionId);
      setSession(fresh);
      setError(null);
      return fresh;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      return null;
    }
  }, [projectId, architectureId, sessionId]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const fresh = await getCaptureSession(projectId, architectureId, sessionId);
        if (!cancelled) {
          setSession(fresh);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load session');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, sessionId]);

  // Polling loop while status === 'running'. Stop on terminal status.
  useEffect(() => {
    if (!session) return;
    if (isTerminal(session.status) || session.status !== 'running') {
      if (pollHandleRef.current !== null) {
        window.clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }
      return;
    }

    // Start polling.
    if (pollHandleRef.current !== null) {
      window.clearInterval(pollHandleRef.current);
    }
    pollHandleRef.current = window.setInterval(() => {
      void fetchOnce();
    }, pollIntervalMs);

    return () => {
      if (pollHandleRef.current !== null) {
        window.clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }
    };
  }, [session, pollIntervalMs, fetchOnce]);

  // Spec Group 10: terminal-status EDGE detection -> AppShell model cache
  // refresh.
  //
  // Backend writes from the capture loop bypass the frontend dispatch
  // pipeline, so the active architecture's in-memory model is stale once a
  // run finishes. When we observe a non-terminal -> terminal transition we
  // fetch a fresh model and dispatch `LOAD_MODEL` so the user sees the new
  // entities in their current view immediately.
  //
  // This is a same-arch flow (the detail view is always scoped to the
  // currently-active architecture per the routing in App.tsx), so per the
  // cache contract we use `LOAD_MODEL` here rather than
  // `invalidateArchitectureModelCache`.
  //
  // The ref-based edge guard ensures we do not spam dispatches on every
  // poll once the session is terminal -- only the single transition is
  // load-bearing.
  useEffect(() => {
    if (!session) {
      prevStatusRef.current = null;
      return;
    }
    const current = (session.status ?? '').toLowerCase() || null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = current;

    // Only act on the EDGE: prev was non-terminal (or non-existent in the
    // case of the very first observation of an already-terminal session
    // mounted fresh; we deliberately do NOT fire on that case because the
    // model in memory would have been loaded already by AppShell's own
    // initial-load effect, and we have no signal that the row was modified
    // during this UI session). The transition must be:
    //   prev defined && prev was a known non-terminal value && current is terminal.
    if (!prev) return;
    if (TERMINAL_STATUSES.has(prev)) return;
    if (!current || !TERMINAL_STATUSES.has(current)) return;

    const fileName = activeProject?.name ?? 'architecture-model';
    void loadModelByProjectId(projectId, architectureId)
      .then((model) => {
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName });
      })
      .catch((err) => {
        // Cache-refresh failures are non-fatal for the detail view's
        // success path; the user can manually refresh later. We log so
        // the diagnostic shows up in the console for support.
        console.warn(
          '[CaptureSessionDetailView] Could not refresh active model after terminal status:',
          err,
        );
      });
  }, [session, projectId, architectureId, dispatch, activeProject?.name]);

  const isSecretsLost = useMemo(
    () =>
      session?.status === 'failed' && session.error_message === SECRETS_LOST_ERROR,
    [session],
  );

  // For idle sessions where the secrets-lost-during-run scenario does NOT
  // apply, show the inline re-entry prompt iff:
  //   - status is one of the idle states (configured/completed/failed/cancelled)
  //     OTHER than the secrets-lost-during-run case
  //   - the user hasn't submitted secrets in this UI session yet
  //   - the user explicitly opens the prompt OR is about to invoke a guarded action
  const showReenterSecretsPrompt = !!session && !isSecretsLost && !secretsLoadedLocal;
  const guardActionsBehindSecrets = showReenterSecretsPrompt;

  // Auth-type drives which API-secret field(s) the re-enter prompt renders.
  // Normalised lower-case so a backend-supplied capitalisation variant maps
  // cleanly to the wizard vocabulary.
  const authType = (session?.auth_type ?? 'none').toLowerCase();
  const headerName = redactedHeaderName(session);

  // The review panel surfaces once captures could exist (running or terminal).
  // While the session is still running the panel renders read-only to avoid
  // racing the loop.
  const showReviewPanel = useMemo(() => {
    if (!session) return false;
    const s = (session.status ?? '').toLowerCase();
    return s === 'running' || s === 'completed' || s === 'failed';
  }, [session]);
  const reviewPanelReadOnly = (session?.status ?? '').toLowerCase() === 'running';

  const handleSubmitSecrets = useCallback(async () => {
    if (!session) return;
    setActionInFlight('secrets');

    // Build the `apiAuth` object from the session's auth type + entered
    // value(s). Shape MUST match `StartCaptureSessionWizard.buildSecretsBundle()`
    // so the detail-view submit path and the wizard submit path are identical
    // on the wire (the gateway's `toSecretsWireBody` maps `header` ->
    // `custom_header` and reads `headerName` / `headerValue` verbatim).
    let apiAuth: SubmitSecretsRequest['apiAuth'];
    switch (authType) {
      case 'bearer':
        apiAuth = { type: 'bearer', token: bearerToken };
        break;
      case 'header':
        apiAuth = { type: 'header', headerName, headerValue };
        break;
      case 'basic':
        apiAuth = { type: 'basic', username: basicUsername, password: basicPassword };
        break;
      case 'none':
      default:
        apiAuth = { type: 'none' };
        break;
    }

    try {
      await submitSecrets(projectId, architectureId, sessionId, {
        apiAuth,
        dbPassword: dbPassword || null,
      });
      setSecretsLoadedLocal(true);
      setSecretsPromptOpen(false);
      setBearerToken('');
      setHeaderValue('');
      setBasicUsername('');
      setBasicPassword('');
      setDbPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit secrets');
    } finally {
      setActionInFlight(null);
    }
  }, [
    projectId,
    architectureId,
    sessionId,
    authType,
    headerName,
    bearerToken,
    headerValue,
    basicUsername,
    basicPassword,
    dbPassword,
    session,
  ]);

  const handleTestApi = useCallback(async () => {
    setActionInFlight('test-api');
    // Clear any stale result/error from a previous attempt so the inline
    // feedback always reflects THIS click.
    setApiTestResult(null);
    setError(null);
    try {
      const result = await testApiConnection(projectId, architectureId, sessionId);
      // Resolves on HTTP 200 even when the target rejected the probe
      // (`result.success === false`); rendering below treats that as a
      // visible FAILURE rather than silence.
      setApiTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test API');
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, architectureId, sessionId]);

  const handleTestDb = useCallback(async () => {
    setActionInFlight('test-db');
    setDbTestResult(null);
    setError(null);
    try {
      const result = await testDbConnection(projectId, architectureId, sessionId);
      setDbTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test DB');
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, architectureId, sessionId]);

  const handleStart = useCallback(async () => {
    setActionInFlight('start');
    try {
      const running = await startCaptureSession(projectId, architectureId, sessionId);
      setSession(running);
    } catch (err) {
      const msg = err instanceof ApiBehaviourApiError
        ? err.body.message ?? 'Failed to start session'
        : err instanceof Error ? err.message : 'Failed to start session';
      setError(msg);
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, architectureId, sessionId]);

  const handleCancel = useCallback(async () => {
    setActionInFlight('cancel');
    try {
      const cancelled = await cancelCaptureSession(projectId, architectureId, sessionId);
      setSession(cancelled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel session');
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, architectureId, sessionId]);

  // Spec Group 8 + 9: Clone configuration CTA. Creates a new draft session
  // pre-filled from the failed session's redacted config via the shared
  // helper, then navigates the reviewer to the clone's detail page (which
  // is the same surface they'd land on from the wizard finalisation -- the
  // generic re-enter-secrets prompt is already there to accept secrets).
  const handleCloneConfig = useCallback(async () => {
    if (!session) return;
    setActionInFlight('clone-config');
    try {
      const cloned = await cloneCaptureSession(
        projectId,
        architectureId,
        session,
      );
      navigate(
        `/projects/${projectId}/architectures/${architectureId}` +
          `/api-behaviour/sessions/${cloned.id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone configuration');
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, architectureId, session, navigate]);

  // Spec Group 9 (9.5 second bullet): "Re-enter secrets and start a new
  // run" -- same clone, but signal to the clone page to auto-open the
  // secrets prompt. We pass it via the URL hash so the destination page
  // can mount in the right state without needing a global store.
  const handleCloneAndReenter = useCallback(async () => {
    if (!session) return;
    setActionInFlight('clone-reenter');
    try {
      const cloned = await cloneCaptureSession(
        projectId,
        architectureId,
        session,
      );
      navigate(
        `/projects/${projectId}/architectures/${architectureId}` +
          `/api-behaviour/sessions/${cloned.id}#enter-secrets`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone configuration');
    } finally {
      setActionInFlight(null);
    }
  }, [projectId, architectureId, session, navigate]);

  // Auto-open the secrets prompt if the page was navigated to with the
  // `#enter-secrets` hash (from the "Re-enter secrets and start a new run"
  // CTA on the source session).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#enter-secrets' && session) {
      setSecretsPromptOpen(true);
    }
  }, [session]);

  // ---- Render -----------------------------------------------------------
  if (loading) {
    return (
      <div className={styles.detailContainer} data-testid="capture-session-detail-view">
        <div className={styles.emptyMessage}>Loading…</div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className={styles.detailContainer} data-testid="capture-session-detail-view">
        <div className={styles.errorBanner}>{error}</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={styles.detailContainer} data-testid="capture-session-detail-view">
        <div className={styles.emptyMessage}>Capture session not found.</div>
      </div>
    );
  }

  return (
    <div
      className={styles.detailContainer}
      data-testid="capture-session-detail-view"
      data-status={session.status}
    >
      <div className={styles.detailHeader}>
        <h2>
          Capture Session{' '}
          <span className={`${styles.statusBadge} ${statusClass(session.status)}`}>
            {session.status}
          </span>
          {/* Scenario outcome tally (misleading-COMPLETED fix): `completed`
              only means "no infrastructure error" — every scenario can have
              errored. Render the N-of-M tally whenever the runner recorded it
              so an all-failed run is visibly distinct from a successful one. */}
          {typeof session.scenarios_attempted === 'number' &&
            session.scenarios_attempted > 0 && (
              <span
                className={styles.rowDate}
                data-testid="capture-session-scenario-tally"
              >
                {' '}
                · {session.scenarios_completed ?? 0} of {session.scenarios_attempted}{' '}
                scenarios captured
              </span>
            )}
        </h2>
        {onClose && (
          <button
            type="button"
            className={styles.backButton}
            onClick={onClose}
            data-testid="capture-session-detail-back"
          >
            Back
          </button>
        )}
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Misleading-COMPLETED guard: a session is `completed` whenever there
          is no INFRASTRUCTURE error — if every scenario errored, no captures
          were recorded and there is nothing to review or baseline. Make that
          impossible to mistake for success. */}
      {session.status === 'completed' &&
        typeof session.scenarios_attempted === 'number' &&
        session.scenarios_attempted > 0 &&
        (session.scenarios_completed ?? 0) === 0 && (
          <div
            className={styles.secretsPrompt}
            data-testid="capture-session-zero-captures-banner"
            role="alert"
          >
            <strong>
              This run completed without capturing anything — all{' '}
              {session.scenarios_attempted} scenarios errored.
            </strong>
            <span>
              The session finished because there was no infrastructure
              failure, but every scenario request failed, so no captures were
              recorded and no baseline can be created from this run. Check the
              Diagnostics below for the per-scenario failure reasons (commonly
              an unreachable API base URL or rejected auth), then re-enter
              secrets, test the connection, and run a new capture.
            </span>
          </div>
        )}

      {/* Oracle coverage summary (Spec 2026-06-17 Oracle Coverage Scoring).
          Display-only readiness surfacing: overall + per-endpoint coverage
          with honest missed-dimension reasons, thin-coverage flags, and the
          project-level auth dimension. Rendered for COMPLETED runs beside the
          scenario tally. A null / absent / pre-fix summary renders gracefully
          as "coverage not recorded" -- never an error. Reuses the existing
          banner/badge styling (secretsPrompt + statusBadge) -- no charting
          widget. */}
      {session.status === 'completed' && (
        <CoverageSummaryPanel
          raw={session.coverage_summary_json}
          testId="capture-session-coverage-summary"
          classes={{
            banner: styles.secretsPrompt,
            badge: styles.statusBadge,
          }}
        />
      )}

      {/* Coverage-override banner (Model-Seeded Capture Inventory spec,
          2026-06-11). Rendered ONLY when the session's /start was overridden
          past the inventory-coverage gate -- legacy rows (all-null trio)
          render exactly as before. Shows the persisted justification, the
          unaccounted count at override time, and the timestamp. */}
      {typeof session.coverage_override_justification === 'string' &&
        session.coverage_override_justification.length > 0 && (
          <div
            className={styles.secretsPrompt}
            role="alert"
            data-testid="capture-session-coverage-override-banner"
          >
            <strong>Inventory coverage gate was overridden at start.</strong>
            <span>
              {typeof session.coverage_override_unaccounted_count === 'number'
                ? session.coverage_override_unaccounted_count
                : 'Some'}{' '}
              in-scope committed endpoint(s) had no operation row and no
              exclusion when this session was started
              {session.coverage_override_at
                ? ` (overridden at ${session.coverage_override_at})`
                : ''}
              . Justification: &ldquo;{session.coverage_override_justification}
              &rdquo;
            </span>
          </div>
        )}

      {/* Secret-loss branch (b): secrets-lost-during-run -- show two CTAs. */}
      {isSecretsLost && (
        <div
          className={styles.secretsPrompt}
          data-testid="capture-session-detail-secrets-lost-banner"
        >
          <strong>Secrets were lost during this run.</strong>
          <span>
            The capture service was restarted while this run was in flight, so
            the in-memory secrets are gone. You can clone this configuration
            into a new draft, or jump straight into the wizard with the
            config pre-filled.
          </span>
          <div className={styles.cta}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleCloneConfig}
              disabled={actionInFlight !== null}
              data-testid="capture-session-detail-clone-config-cta"
            >
              Clone configuration
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleCloneAndReenter}
              disabled={actionInFlight !== null}
              data-testid="capture-session-detail-reenter-and-restart-cta"
            >
              Re-enter secrets and start a new run
            </button>
          </div>
        </div>
      )}

      {/* Secret-loss branch (a): idle session, no in-memory secrets in this UI session.
          Inline prompt blocks execution actions until secrets are re-entered. */}
      {showReenterSecretsPrompt && (
        <div
          className={styles.secretsPrompt}
          data-testid="capture-session-detail-reenter-secrets-prompt"
        >
          <strong>Re-enter secrets to enable execution actions.</strong>
          <span data-testid="capture-session-detail-secrets-prompt-body">
            Secrets are held in process memory on the capture service only
            while a session is configured or running. After a process restart
            (or a fresh page load) you need to re-enter them before testing
            connections or starting a run. Secrets are never persisted.
            {authType === 'header' && headerName ? (
              <>
                {' '}
                This session authenticates with a custom header named{' '}
                <strong>{headerName}</strong>; supply its value below.
              </>
            ) : null}
          </span>
          {!secretsPromptOpen && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setSecretsPromptOpen(true)}
              disabled={actionInFlight !== null}
              data-testid="capture-session-detail-open-secrets-form"
            >
              Re-enter secrets
            </button>
          )}
          {secretsPromptOpen && (
            <>
              {/* API-secret field(s) -- conditional on the session's auth type
                  (Fix A). `none` renders no API-secret field at all. */}
              {authType === 'bearer' && (
                <input
                  type="password"
                  placeholder="Bearer token (optional)"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  data-testid="capture-session-detail-secrets-bearer"
                />
              )}
              {authType === 'header' && (
                <input
                  type="password"
                  placeholder={
                    headerName
                      ? `${headerName} value (optional)`
                      : 'Header value (optional)'
                  }
                  aria-label={
                    headerName ? `${headerName} header value` : 'Header value'
                  }
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  data-testid="capture-session-detail-secrets-header-value"
                />
              )}
              {authType === 'basic' && (
                <>
                  <input
                    type="text"
                    placeholder="Username"
                    value={basicUsername}
                    onChange={(e) => setBasicUsername(e.target.value)}
                    data-testid="capture-session-detail-secrets-basic-username"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={basicPassword}
                    onChange={(e) => setBasicPassword(e.target.value)}
                    data-testid="capture-session-detail-secrets-basic-password"
                  />
                </>
              )}
              {/* DB password field -- shown for every auth type. */}
              <input
                type="password"
                placeholder="DB password (optional)"
                value={dbPassword}
                onChange={(e) => setDbPassword(e.target.value)}
                data-testid="capture-session-detail-secrets-db-password"
              />
              <div className={styles.cta}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setSecretsPromptOpen(false)}
                  disabled={actionInFlight !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleSubmitSecrets}
                  disabled={actionInFlight !== null}
                  data-testid="capture-session-detail-submit-secrets"
                >
                  Submit
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className={styles.detailSection}>
        <h3>Configuration (redacted)</h3>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Environment:</span>
          {session.environment_name || '—'}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>API base URL:</span>
          {session.api_base_url || '—'}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Auth type:</span>
          {session.auth_type || '—'}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Mutating calls confirmed:</span>
          {session.mutating_calls_confirmed ? 'Yes' : 'No'}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Started at:</span>
          {session.started_at || '—'}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Completed at:</span>
          {session.completed_at || '—'}
        </div>
        {session.error_message && (
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Error message:</span>
            {session.error_message}
          </div>
        )}
      </div>

      {/* Action footer. Most actions are gated on having in-memory secrets
          loaded for this UI session. Cancel is allowed regardless because
          it only purges state; it never executes anything.

          Bug 3 fix: when `guardActionsBehindSecrets` is true the Test + Start
          buttons are disabled, but `.secondaryButton` had no `:disabled` rule
          so a guarded Test button was visually identical to a live one. We now
          attach `.secondaryButtonDisabled` (greyed + not-allowed cursor, the
          same affordance `.primaryButton:disabled` already gives Start) plus a
          native `title` tooltip explaining WHY, and render an inline hint that
          points at the always-reachable "Re-enter secrets" prompt above. The
          underlying guard logic is unchanged. */}
      {!isSecretsLost && (
        <>
          <div className={styles.cta}>
            <button
              type="button"
              className={
                guardActionsBehindSecrets
                  ? `${styles.secondaryButton} ${styles.secondaryButtonDisabled}`
                  : styles.secondaryButton
              }
              onClick={handleTestApi}
              disabled={guardActionsBehindSecrets || actionInFlight !== null}
              title={
                guardActionsBehindSecrets
                  ? 'Re-enter secrets to enable this action - use the "Re-enter secrets" prompt above.'
                  : 'Probe the configured API base URL using the in-memory secrets'
              }
              data-testid="capture-session-detail-test-api"
            >
              {actionInFlight === 'test-api'
                ? 'Testing API...'
                : 'Test API connection'}
            </button>
            <button
              type="button"
              className={
                guardActionsBehindSecrets
                  ? `${styles.secondaryButton} ${styles.secondaryButtonDisabled}`
                  : styles.secondaryButton
              }
              onClick={handleTestDb}
              disabled={guardActionsBehindSecrets || actionInFlight !== null}
              title={
                guardActionsBehindSecrets
                  ? 'Re-enter secrets to enable this action - use the "Re-enter secrets" prompt above.'
                  : 'Probe the configured database using the in-memory secrets'
              }
              data-testid="capture-session-detail-test-db"
            >
              {actionInFlight === 'test-db'
                ? 'Testing DB...'
                : 'Test DB connection'}
            </button>
            {session.status !== 'running' && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleStart}
                disabled={
                  guardActionsBehindSecrets ||
                  actionInFlight !== null ||
                  session.status === 'completed'
                }
                title={
                  guardActionsBehindSecrets
                    ? 'Re-enter secrets to enable this action - use the "Re-enter secrets" prompt above.'
                    : session.status === 'completed'
                      ? 'This session has already completed'
                      : 'Start the capture run'
                }
                data-testid="capture-session-detail-start"
              >
                {actionInFlight === 'start' ? 'Starting...' : 'Start'}
              </button>
            )}
            {session.status === 'running' && (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleCancel}
                disabled={actionInFlight !== null}
                data-testid="capture-session-detail-cancel"
              >
                {actionInFlight === 'cancel' ? 'Cancelling...' : 'Cancel run'}
              </button>
            )}
          </div>

          {/* Bug 3: explanatory affordance for the guarded/disabled buttons.
              Always points at the reachable "Re-enter secrets" prompt above so
              a disabled state is never a dead end. */}
          {guardActionsBehindSecrets && (
            <div
              className={styles.actionHint}
              data-testid="capture-session-detail-actions-disabled-hint"
            >
              Test and Start are disabled until secrets are loaded for this UI
              session. Use the &ldquo;Re-enter secrets&rdquo; prompt above to
              enable them.
            </div>
          )}

          {/* Bug 2: inline result feedback for the connection probes. A probe
              that RESOLVES with `success === false` (e.g. a 401 returned as
              HTTP 200 by the route) is rendered as a visible FAILURE here, not
              silence. The thrown-error path remains the error banner above. */}
          {apiTestResult && (
            <div
              className={
                // Check auth-rejection FIRST: a 401/403 also satisfies `success`
                // (<500), but the token was refused -- it must NOT read as OK.
                apiTestResult.authRejected
                  ? `${styles.testResult} ${styles.testResultWarn}`
                  : apiTestResult.success
                    ? `${styles.testResult} ${styles.testResultOk}`
                    : `${styles.testResult} ${styles.testResultFail}`
              }
              role="status"
              data-testid="capture-session-detail-test-api-result"
            >
              {apiTestResult.authRejected
                ? `API connection: reachable but auth REJECTED - HTTP ${apiTestResult.status} in ${apiTestResult.durationMs}ms (check the token is valid/not expired)`
                : apiTestResult.success
                  ? `API connection OK - ${apiTestResult.status} in ${apiTestResult.durationMs}ms`
                  : `API connection FAILED - ${apiTestResult.status} in ${apiTestResult.durationMs}ms`}
            </div>
          )}
          {dbTestResult && (
            <div
              className={
                dbTestResult.success
                  ? `${styles.testResult} ${styles.testResultOk}`
                  : `${styles.testResult} ${styles.testResultFail}`
              }
              role="status"
              data-testid="capture-session-detail-test-db-result"
            >
              {dbTestResult.success
                ? `DB connection OK${
                    dbTestResult.serverVersion
                      ? ` - ${dbTestResult.serverVersion}`
                      : ''
                  }`
                : 'DB connection FAILED'}
            </div>
          )}
        </>
      )}

      {/* Review panel -- mounts once captures could exist. Read-only while
          the loop is still running to avoid racing the new service. */}
      {/* Mode 2 append entry point (Spec 2026-06-23, R7/A6). Offered on
          reviewable, non-running sessions -- the append replays the imported
          collection live and lands captures into the review panel below. */}
      {showReviewPanel && !reviewPanelReadOnly && (
        <div className={styles.actionRow} data-testid="capture-session-append-row">
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setAppendModalOpen(true)}
            data-testid="capture-session-append-postman"
          >
            Append a Postman collection
          </button>
        </div>
      )}

      {/* Lazy-mount: only construct the modal (and its import-run hook) once
          the user opens it, so a closed modal never runs the staging hook. */}
      {appendModalOpen && (
        <PostmanImportAppendModal
          open={appendModalOpen}
          projectId={projectId}
          architectureId={architectureId}
          sessionId={sessionId}
          secretsLoaded={secretsLoadedLocal}
          mutatingCallsConfirmed={session.mutating_calls_confirmed ?? undefined}
          onRequestReenterSecrets={() => setSecretsPromptOpen(true)}
          onAppended={() => {
            void fetchOnce();
          }}
          onClose={() => setAppendModalOpen(false)}
        />
      )}

      {showReviewPanel && (
        <CaptureReviewPanel
          projectId={projectId}
          architectureId={architectureId}
          sessionId={sessionId}
          readOnly={reviewPanelReadOnly}
          coverageSummaryJson={session.coverage_summary_json}
          mutatingCallsConfirmed={session.mutating_calls_confirmed}
          secretsLoaded={secretsLoadedLocal}
          onRequestReenterSecrets={() => {
            // Reuse the EXISTING parent-owned re-enter-secrets prompt rather
            // than rebuilding secret entry. The prompt itself is already shown
            // whenever secrets are not loaded (showReenterSecretsPrompt); open
            // its form so the reviewer can submit immediately.
            setSecretsPromptOpen(true);
          }}
        />
      )}
    </div>
  );
};

export default CaptureSessionDetailView;
