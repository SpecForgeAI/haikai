/**
 * StartTargetReplayWizard
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 5.
 *
 * Forked variant of `StartCaptureSessionWizard.tsx` for the target-side
 * replay flow. Per accepted Q3, this is a NEW component file rather than a
 * `mode='current'|'target'` flag carried through the 1,470-LOC current-state
 * wizard -- target replay has a fundamentally different Step 1 (pick source
 * baseline vs. pick OAS source) and skips Steps 3 + 4 entirely (no DB
 * sampling, no per-operation include toggle; the source baseline already
 * encodes the operation/scenario set).
 *
 * Three steps total:
 *   1. Source baseline picker -- lists `kind='current', status='active'`
 *      baselines for the bound project + architecture. Single-select.
 *   2. Target environment config -- target base URL, auth type, auth
 *      config, default headers, mutating-calls confirmation toggle. UX
 *      mirrors Step 2 of the current-state wizard (same field labels,
 *      placeholders, validation rules); the styling module is shared.
 *   3. Confirm & start -- read-only summary (source baseline name + item
 *      count + target URL + mutating-confirm state) with a single
 *      "Start replay" button. The click performs the create + secrets +
 *      start sequence, then closes the wizard and routes to the session
 *      detail page.
 *
 * Wire sequence on Start:
 *   POST createTargetCaptureSession (kind='target' server-stamped)
 *     -> capture returned session id
 *     -> POST setTargetSessionSecrets (in-memory only)
 *     -> POST startTargetCaptureSession (transitions to running, returns
 *        202 with `runId`)
 *
 * The wizard does NOT own the progress / review surface -- those live on
 * the existing `CaptureSessionDetailView` and `CaptureReviewPanel`. After
 * Start, the wizard closes and the caller navigates to the session
 * detail page.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiBehaviourApiError,
  ApiBehaviourBaselineDto,
  ApiBehaviourCaptureSessionDto,
  createTargetCaptureSession,
  listBaselineItems,
  listBaselines,
  setTargetSessionSecrets,
  startTargetCaptureSession,
} from '../../api/apiBehaviourClient';
import styles from './StartCaptureSessionWizard.module.css';

// ============================================================================
// Props
// ============================================================================

export interface StartTargetReplayWizardProps {
  open: boolean;
  /** Project the target session belongs to. Pre-bound by the launcher. */
  projectId: string;
  /** Architecture the target session is bound to. Pre-bound by the launcher. */
  architectureId: string;
  /** Display name for the architecture (header chip only). */
  architectureName?: string;
  onClose: () => void;
  /** Called once `/start` succeeds. Parent typically navigates to detail. */
  onStarted?: (session: ApiBehaviourCaptureSessionDto) => void;
}

// ============================================================================
// Internal types
// ============================================================================

type WizardStep = 1 | 2 | 3;

type AuthType = 'none' | 'bearer' | 'basic' | 'header';

interface Step2Config {
  targetBaseUrl: string;
  authType: AuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  headerName: string;
  headerValue: string;
  defaultHeadersText: string; // one "Name: Value" per line
  mutatingCallsConfirmed: boolean;
}

const DEFAULT_STEP2: Step2Config = {
  targetBaseUrl: '',
  authType: 'none',
  bearerToken: '',
  basicUsername: '',
  basicPassword: '',
  headerName: '',
  headerValue: '',
  defaultHeadersText: '',
  mutatingCallsConfirmed: false,
};

// ============================================================================
// Helpers
// ============================================================================

function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.substring(0, idx).trim();
    const value = line.substring(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/**
 * Basic URL validation -- accepts http(s) URLs with a host. Empty / null /
 * non-http schemes block Next. Mirrors the current-state wizard's relaxed
 * URL validation (the field is free-text, the runner catches malformed URLs
 * at request time).
 */
function isValidTargetUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Map the wizard's auth-type vocabulary to the backend's. Mirrors the helper
 * in `apiBehaviourClient.ts` -- the wizard uses short names while the
 * `secretsStore` expects the validation service's six-value enum.
 */
function mapAuthTypeToBackend(
  raw: AuthType,
): 'none' | 'bearer' | 'basic' | 'custom_header' {
  switch (raw) {
    case 'bearer':
      return 'bearer';
    case 'basic':
      return 'basic';
    case 'header':
      return 'custom_header';
    case 'none':
    default:
      return 'none';
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiBehaviourApiError) {
    return err.body.message || `Request failed (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

// ============================================================================
// Component
// ============================================================================

export function StartTargetReplayWizard({
  open,
  projectId,
  architectureId,
  architectureName,
  onClose,
  onStarted,
}: StartTargetReplayWizardProps) {
  // ---- Step state ------------------------------------------------------
  const [step, setStep] = useState<WizardStep>(1);

  // ---- Step 1: source baseline picker ---------------------------------
  const [baselines, setBaselines] = useState<ApiBehaviourBaselineDto[]>([]);
  const [baselinesLoading, setBaselinesLoading] = useState(false);
  const [baselinesError, setBaselinesError] = useState<string | null>(null);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null);
  // Item count is informational for Step 3's summary. Fetched on the
  // Step 1 -> Step 2 advance when a baseline is selected.
  const [sourceItemCount, setSourceItemCount] = useState<number | null>(null);

  // ---- Step 2: target environment config ------------------------------
  const [step2, setStep2] = useState<Step2Config>(DEFAULT_STEP2);

  // ---- In-flight + error ---------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Reset state on open --------------------------------------------
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setBaselines([]);
    setBaselinesError(null);
    setSelectedBaselineId(null);
    setSourceItemCount(null);
    setStep2(DEFAULT_STEP2);
    setSubmitting(false);
    setError(null);
  }, [open]);

  // ---- Step 1: load current-state, active baselines on open ---------
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBaselinesLoading(true);
    setBaselinesError(null);
    (async () => {
      try {
        // Pass a kind filter so legacy clients that listed all baselines
        // continue to work and the wizard only sees current-state baselines.
        // The backend will eventually honour the filter; for now the
        // frontend belt-and-braces filters too.
        const all = await listBaselines(projectId, architectureId, {
          kind: 'current',
        });
        if (cancelled) return;
        const eligible = all.filter(
          (b) =>
            (b.kind ?? 'current') === 'current' &&
            (b.status ?? '').toLowerCase() === 'active',
        );
        setBaselines(eligible);
      } catch (err) {
        if (cancelled) return;
        setBaselinesError(
          err instanceof Error ? err.message : 'Failed to load baselines',
        );
      } finally {
        if (!cancelled) setBaselinesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, architectureId]);

  // ---- Esc-to-close ---------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, submitting]);

  // ---- Resolve the picked baseline for downstream summary ------------
  const selectedBaseline = useMemo(
    () => baselines.find((b) => b.id === selectedBaselineId) ?? null,
    [baselines, selectedBaselineId],
  );

  // ---- Step transitions ----------------------------------------------
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !submitting) onClose();
    },
    [onClose, submitting],
  );

  const canAdvanceStep1 = selectedBaselineId !== null;
  const canAdvanceStep2 = isValidTargetUrl(step2.targetBaseUrl);

  /** Step 1 -> Step 2 advance. Fetches the source item count for the summary. */
  const handleAdvanceToStep2 = useCallback(async () => {
    if (!selectedBaselineId || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const items = await listBaselineItems(projectId, architectureId, selectedBaselineId);
      setSourceItemCount(items.length);
      setStep(2);
    } catch (err) {
      // Item count is informational; advance anyway so the user is not
      // blocked by a flake on the items endpoint.
      setSourceItemCount(null);
      setStep(2);
      // Surface the error softly in case the user wants to back out.
      setError(`Could not load item count: ${describeError(err)}`);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, projectId, architectureId, selectedBaselineId]);

  const buildAuthConfigRedacted = useCallback((): Record<string, unknown> => {
    switch (step2.authType) {
      case 'bearer':
        return { type: 'bearer', token: '[REDACTED]' };
      case 'basic':
        return { type: 'basic', username: step2.basicUsername, password: '[REDACTED]' };
      case 'header':
        return { type: 'header', headerName: step2.headerName, headerValue: '[REDACTED]' };
      case 'none':
      default:
        return { type: 'none' };
    }
  }, [step2]);

  const buildSecretsBundle = useCallback(() => {
    const backendType = mapAuthTypeToBackend(step2.authType);
    // The validation service's SecretsBundle shape: { api: { type, ... } }
    const api: Record<string, unknown> = { type: backendType };
    if (step2.authType === 'bearer') api.token = step2.bearerToken;
    if (step2.authType === 'basic') {
      api.username = step2.basicUsername;
      api.password = step2.basicPassword;
    }
    if (step2.authType === 'header') {
      api.headerName = step2.headerName;
      api.value = step2.headerValue;
    }
    return { api } as {
      api: {
        type: 'none' | 'bearer' | 'api_key_header' | 'api_key_query' | 'basic' | 'custom_header';
        token?: string;
        headerName?: string;
        paramName?: string;
        value?: string;
        username?: string;
        password?: string;
      };
    };
  }, [step2]);

  /** Step 3: create target session, load secrets, start replay. */
  const handleStart = useCallback(async () => {
    if (!selectedBaselineId || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const session = await createTargetCaptureSession({
        projectId,
        architectureId,
        sourceBaselineId: selectedBaselineId,
        targetApiBaseUrl: step2.targetBaseUrl.trim(),
        name: selectedBaseline?.name
          ? `Target replay of ${selectedBaseline.name}`
          : null,
        authType: step2.authType,
        authConfigRedactedJson: buildAuthConfigRedacted(),
        defaultHeadersRedactedJson: parseHeadersText(step2.defaultHeadersText),
        mutatingCallsConfirmed: step2.mutatingCallsConfirmed,
      });

      await setTargetSessionSecrets(session.id, buildSecretsBundle());

      // Item #6 restore gate (2026-08-27): a 409 naming the gate means no
      // post-capture S0 restore is recorded on the source session. Never a
      // dead button — the operator gets an explicit, scary, RECORDED
      // proceed-anyway (window.confirm keeps it modal and blocking).
      let running;
      try {
        running = await startTargetCaptureSession(session.id, projectId);
      } catch (startErr) {
        const message = describeError(startErr);
        if (message.includes('post_capture_restore_required') || message.includes('No post-capture S0 restore')) {
          const proceed = window.confirm(
            'NO POST-CAPTURE S0 RESTORE IS RECORDED for the source capture ' +
              'session.\n\nReconciling against a drifted source produces FALSE ' +
              'ID breaks across the whole run. The safe path: restore S0 from ' +
              'the source session screen first.\n\nProceed anyway? (The ' +
              'override is recorded on the replay session.)',
          );
          if (!proceed) {
            setError(
              'Start blocked: restore S0 on the source capture session first ' +
                '(the restore panel records the receipt this gate reads).',
            );
            return;
          }
          running = await startTargetCaptureSession(session.id, projectId, {
            confirmNoRestore: true,
          });
        } else {
          throw startErr;
        }
      }
      onStarted?.(running);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    projectId,
    architectureId,
    selectedBaselineId,
    selectedBaseline,
    step2,
    buildAuthConfigRedacted,
    buildSecretsBundle,
    onStarted,
    onClose,
  ]);

  // ---- Render guard ---------------------------------------------------
  if (!open) return null;

  // ---- Render ---------------------------------------------------------
  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="start-target-replay-wizard"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-target-replay-wizard-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="start-target-replay-wizard-title">
            Capture target API behaviour
            {architectureName ? ` — ${architectureName}` : ''}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="start-target-replay-wizard-close"
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Stepper */}
        <div className={styles.stepper} data-testid="start-target-replay-wizard-stepper">
          {([1, 2, 3] as WizardStep[]).map((n, idx) => (
            <React.Fragment key={n}>
              {idx > 0 && (
                <span className={styles.stepSeparator} aria-hidden="true">
                  &rsaquo;
                </span>
              )}
              <span
                className={`${styles.step} ${
                  n === step ? styles.stepActive : n < step ? styles.stepDone : ''
                }`}
                data-testid={`start-target-replay-wizard-step-${n}`}
              >
                {n}.{' '}
                {n === 1
                  ? 'Source baseline'
                  : n === 2
                  ? 'Target config'
                  : 'Start replay'}
              </span>
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className={styles.content}>
          {step === 1 && (
            <>
              <p className={styles.helperText}>
                Pick the current-state baseline whose accepted captures should
                be replayed against the target service.
              </p>
              {baselinesLoading && (
                <div
                  className={styles.helperText}
                  data-testid="start-target-replay-wizard-baselines-loading"
                >
                  Loading baselines…
                </div>
              )}
              {!baselinesLoading && baselinesError && (
                <div
                  className={styles.errorBanner}
                  data-testid="start-target-replay-wizard-baselines-error"
                  role="alert"
                >
                  {baselinesError}
                </div>
              )}
              {!baselinesLoading && !baselinesError && baselines.length === 0 && (
                <div
                  className={styles.helperText}
                  data-testid="start-target-replay-wizard-no-baselines"
                >
                  <em>
                    No active current-state baselines exist for this
                    architecture. Capture a current-state baseline first.
                  </em>
                </div>
              )}
              {!baselinesLoading && !baselinesError && baselines.length > 0 && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Source baseline</label>
                  <div
                    className={styles.interfaceList}
                    data-testid="start-target-replay-wizard-baseline-list"
                  >
                    {baselines.map((b) => (
                      <label
                        key={b.id}
                        className={styles.interfaceItem}
                        data-testid={`start-target-replay-wizard-baseline-${b.id}`}
                      >
                        <input
                          type="radio"
                          name="source-baseline"
                          checked={selectedBaselineId === b.id}
                          onChange={() => setSelectedBaselineId(b.id)}
                        />
                        <span>
                          {b.name || '(unnamed)'}
                          <span className={styles.helperText}>
                            {' '}
                            — {b.accepted_capture_count ?? 0} accepted
                            {b.operation_count != null
                              ? ` / ${b.operation_count} operations`
                              : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className={styles.helperText}>
                Configure the target service URL and the credentials the
                replay runner should use. Secrets stay in process memory on
                the validation service — AMS never sees plaintext.
              </p>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="strw-base-url">
                  Target API base URL
                </label>
                <input
                  id="strw-base-url"
                  className={styles.input}
                  value={step2.targetBaseUrl}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, targetBaseUrl: e.target.value }))
                  }
                  placeholder="https://api.uat.example.com"
                  data-testid="start-target-replay-wizard-base-url"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="strw-auth-type">
                  Auth type
                </label>
                <select
                  id="strw-auth-type"
                  className={styles.select}
                  value={step2.authType}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, authType: e.target.value as AuthType }))
                  }
                  data-testid="start-target-replay-wizard-auth-type"
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Basic</option>
                  <option value="header">Custom header</option>
                </select>
              </div>
              {step2.authType === 'bearer' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Bearer token</label>
                  <input
                    type="password"
                    className={styles.input}
                    value={step2.bearerToken}
                    onChange={(e) =>
                      setStep2((s) => ({ ...s, bearerToken: e.target.value }))
                    }
                    data-testid="start-target-replay-wizard-bearer-token"
                  />
                </div>
              )}
              {step2.authType === 'basic' && (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Username</label>
                    <input
                      className={styles.input}
                      value={step2.basicUsername}
                      onChange={(e) =>
                        setStep2((s) => ({ ...s, basicUsername: e.target.value }))
                      }
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Password</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={step2.basicPassword}
                      onChange={(e) =>
                        setStep2((s) => ({ ...s, basicPassword: e.target.value }))
                      }
                    />
                  </div>
                </>
              )}
              {step2.authType === 'header' && (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Header name</label>
                    <input
                      className={styles.input}
                      value={step2.headerName}
                      onChange={(e) =>
                        setStep2((s) => ({ ...s, headerName: e.target.value }))
                      }
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Header value</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={step2.headerValue}
                      onChange={(e) =>
                        setStep2((s) => ({ ...s, headerValue: e.target.value }))
                      }
                    />
                  </div>
                </>
              )}
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="strw-default-headers">
                  Default headers (one "Name: Value" per line)
                </label>
                <textarea
                  id="strw-default-headers"
                  className={styles.textarea}
                  value={step2.defaultHeadersText}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, defaultHeadersText: e.target.value }))
                  }
                  data-testid="start-target-replay-wizard-default-headers"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  <input
                    type="checkbox"
                    checked={step2.mutatingCallsConfirmed}
                    onChange={(e) =>
                      setStep2((s) => ({
                        ...s,
                        mutatingCallsConfirmed: e.target.checked,
                      }))
                    }
                    data-testid="start-target-replay-wizard-mutating-confirm"
                  />{' '}
                  I confirm this is a non-prod migration-test environment and
                  mutating API calls are allowed.
                </label>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className={styles.helperText}>
                Review the configuration below. "Start replay" creates the
                target session, loads secrets into the validation service's
                in-memory store, and fires the replay runner. The wizard
                closes once the runner is registered; watch progress on the
                session detail page.
              </p>
              <div className={styles.summarySection}>
                <div>
                  <span className={styles.summaryKey}>Source baseline:</span>
                  {selectedBaseline?.name || '(unnamed)'}
                </div>
                <div>
                  <span className={styles.summaryKey}>Items to replay:</span>
                  {sourceItemCount != null
                    ? sourceItemCount
                    : selectedBaseline?.accepted_capture_count ?? '—'}
                </div>
                <div>
                  <span className={styles.summaryKey}>Target API base URL:</span>
                  {step2.targetBaseUrl}
                </div>
                <div>
                  <span className={styles.summaryKey}>Auth type:</span>
                  {step2.authType}
                </div>
                <div>
                  <span className={styles.summaryKey}>Mutating calls confirmed:</span>
                  {step2.mutatingCallsConfirmed ? 'Yes' : 'No'}
                </div>
              </div>
            </>
          )}

          {error && (
            <div
              className={styles.errorBanner}
              role="alert"
              data-testid="start-target-replay-wizard-error"
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="start-target-replay-wizard-cancel"
          >
            Cancel
          </button>
          {step > 1 && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() =>
                setStep((s) => Math.max(1, (s - 1) as WizardStep) as WizardStep)
              }
              disabled={submitting}
              data-testid="start-target-replay-wizard-back"
            >
              Back
            </button>
          )}
          {step === 1 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleAdvanceToStep2}
              disabled={!canAdvanceStep1 || submitting}
              data-testid="start-target-replay-wizard-next"
            >
              {submitting ? 'Loading…' : 'Next'}
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setStep(3)}
              disabled={!canAdvanceStep2 || submitting}
              data-testid="start-target-replay-wizard-next"
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleStart}
              disabled={submitting}
              data-testid="start-target-replay-wizard-start"
            >
              {submitting ? 'Starting…' : 'Start replay'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default StartTargetReplayWizard;
