/**
 * AddNewBehaviourModal Component
 *
 * Spec: 2026-06-20 Add New Behaviour -- Manual Capture (Task Group 5)
 *
 * Reviewer-facing modal mounted inside `CaptureReviewPanel` (review time only,
 * i.e. when the panel is NOT read-only). Lets a reviewer add ONE ad-hoc request
 * for an EXISTING, included operation in the session's scope, physically send
 * it to the current-state service via the amvs `manual-capture` action, and
 * have the result land as a normal `accepted=null` capture in the review table.
 *
 * Scope (fixed v1 constraints carried from the spec):
 *   - SELECT EXISTING method/path ONLY. The operation picker offers ONLY
 *     `included === true` operations; there is NO free-form endpoint entry and
 *     NO operation creation. The modal NEVER mutates current-state architecture.
 *   - Path params: one labelled input per `{param}` token in the selected path;
 *     the substituted concrete path becomes `request_path`. An unfilled param
 *     blocks Save with an inline error naming the missing param(s).
 *   - Query: a key/value rows widget serialising to a `request_query_json`
 *     object.
 *   - Body: a free-text JSON textbox. `JSON.parse` on Save; invalid JSON shows
 *     an inline "not valid JSON" error and blocks send. Empty body -> no body.
 *     There is NO raw-text escape hatch in v1.
 *   - Headers: an editable key/value editor PREFILLED from the UNION of redacted
 *     request-header keys across ALL the session's 2xx captures (regardless of
 *     accept/reject). Auth headers are already redacted out of stored captures,
 *     so their values are not shown/sent; the executor re-injects auth from the
 *     in-memory secret server-side.
 *   - Mutating verbs (POST/PUT/PATCH/DELETE): require an explicit
 *     "Yes, send this mutating request" checkbox before Save is enabled. When
 *     the session's `mutating_calls_confirmed === false` a STRONGER warning is
 *     shown but the send is NEVER hard-blocked (explicit user intent).
 *   - Secrets: this modal NEVER rebuilds secret inputs. If `secretsLoaded` is
 *     false, OR the send returns 409 `SECRETS_NOT_LOADED`, it routes the user to
 *     the existing parent-owned re-enter prompt via `onRequestReenterSecrets`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiBehaviourOperationDto,
  ManualCaptureRequest,
  isSecretsNotLoadedError,
  manualCapture,
} from '../../api/apiBehaviourClient';
import styles from './CaptureReviewPanel.module.css';

// ============================================================================
// Props
// ============================================================================

export interface AddNewBehaviourModalProps {
  projectId: string;
  architectureId: string;
  sessionId: string;
  /**
   * Operations already loaded by the host panel. The picker offers ONLY rows
   * where `included === true`; the modal never fetches/creates operations.
   */
  operations: ApiBehaviourOperationDto[];
  /**
   * The UNION of redacted request-header keys across ALL the session's 2xx
   * captures (regardless of accept/reject). Pre-computed by the host panel from
   * `listCaptures`; used to prefill the header editor. Auth headers are already
   * redacted out upstream so they never appear here.
   */
  headerKeyUnion: string[];
  /**
   * The session's `mutating_calls_confirmed` posture. When `false`, a STRONGER
   * warning is shown for mutating verbs -- but the send is never hard-blocked.
   */
  mutatingCallsConfirmed: boolean | null;
  /**
   * Whether the session's in-memory secret is loaded. When `false` the modal
   * routes the user to the parent re-enter prompt rather than sending.
   */
  secretsLoaded: boolean;
  /** Ask the parent to surface its existing re-enter-secrets prompt. */
  onRequestReenterSecrets: () => void;
  /** Close the modal without sending. */
  onClose: () => void;
  /** Invoked after a successful manual capture so the host can refresh. */
  onSaved: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function operationLabel(op: ApiBehaviourOperationDto): string {
  const method = (op.method ?? '').toUpperCase();
  const path = op.path ?? '(no path)';
  return method ? `${method} ${path}` : path;
}

/** Every distinct `{param}` token in a path, in declaration order. */
function detectPathParams(path: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

interface KvRow {
  key: string;
  value: string;
}

// ============================================================================
// Component
// ============================================================================

export const AddNewBehaviourModal: React.FC<AddNewBehaviourModalProps> = ({
  projectId,
  architectureId,
  sessionId,
  operations,
  headerKeyUnion,
  mutatingCallsConfirmed,
  secretsLoaded,
  onRequestReenterSecrets,
  onClose,
  onSaved,
}) => {
  // Only `included === true` operations are selectable.
  const includedOperations = useMemo(
    () => operations.filter((op) => op.included === true),
    [operations],
  );

  const [selectedOperationId, setSelectedOperationId] = useState<string>('');
  const selectedOperation = useMemo(
    () => includedOperations.find((op) => op.id === selectedOperationId) ?? null,
    [includedOperations, selectedOperationId],
  );

  const method = (selectedOperation?.method ?? '').toUpperCase();
  const pathTemplate = selectedOperation?.path ?? '';
  const isMutating = MUTATING_METHODS.has(method);

  // Path-param token -> value.
  const pathParams = useMemo(() => detectPathParams(pathTemplate), [pathTemplate]);
  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>({});

  // Query key/value rows.
  const [queryRows, setQueryRows] = useState<KvRow[]>([{ key: '', value: '' }]);

  // Header key/value rows, prefilled from the 2xx-capture header-key union.
  const [headerRows, setHeaderRows] = useState<KvRow[]>([{ key: '', value: '' }]);

  // JSON body free text.
  const [bodyText, setBodyText] = useState<string>('');

  // Explicit mutating-verb confirmation.
  const [mutatingConfirmed, setMutatingConfirmed] = useState(false);

  // Inline validation + submit state.
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when the send hit 409 SECRETS_NOT_LOADED (or secrets weren't loaded).
  const [secretsBlocked, setSecretsBlocked] = useState(false);

  // When the selected operation changes, reset the dependent inputs and seed
  // header rows from the union (one editable row per known key).
  useEffect(() => {
    setPathParamValues({});
    setQueryRows([{ key: '', value: '' }]);
    setBodyText('');
    setMutatingConfirmed(false);
    setValidationError(null);
    setSubmitError(null);
    setSecretsBlocked(false);
    const seeded: KvRow[] =
      headerKeyUnion.length > 0
        ? headerKeyUnion.map((key) => ({ key, value: '' }))
        : [{ key: '', value: '' }];
    setHeaderRows(seeded);
  }, [selectedOperationId, headerKeyUnion]);

  const secretsNotLoaded = !secretsLoaded || secretsBlocked;

  const handleRequestReenter = useCallback(() => {
    onRequestReenterSecrets();
    onClose();
  }, [onRequestReenterSecrets, onClose]);

  const updateRow = useCallback(
    (
      rows: KvRow[],
      setRows: React.Dispatch<React.SetStateAction<KvRow[]>>,
      index: number,
      field: keyof KvRow,
      value: string,
    ) => {
      const next = rows.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      // Keep a trailing blank row so there is always an empty slot to type into.
      const last = next[next.length - 1];
      if (last && (last.key !== '' || last.value !== '')) {
        next.push({ key: '', value: '' });
      }
      setRows(next);
    },
    [],
  );

  // Serialise key/value rows to an object, dropping rows whose key OR value is
  // blank. Header rows are PREFILLED from the redacted-key union (values blank
  // because the originals are redacted out); a row the reviewer never fills
  // must NOT be sent as an empty-valued header. The executor re-injects auth.
  const rowsToObject = useCallback((rows: KvRow[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k.length > 0 && r.value.length > 0) out[k] = r.value;
    }
    return out;
  }, []);

  const handleSave = useCallback(async () => {
    setValidationError(null);
    setSubmitError(null);

    if (!selectedOperation) {
      setValidationError('Select an operation to send.');
      return;
    }

    // Secrets gate (prop): never rebuild secret inputs here.
    if (!secretsLoaded) {
      setSecretsBlocked(true);
      return;
    }

    // Path-param substitution + unfilled-param block.
    const missing: string[] = [];
    let resolvedPath = pathTemplate;
    for (const p of pathParams) {
      const v = (pathParamValues[p] ?? '').trim();
      if (v.length === 0) {
        missing.push(p);
        continue;
      }
      resolvedPath = resolvedPath.replace(
        new RegExp(`\\{${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'),
        encodeURIComponent(v),
      );
    }
    if (missing.length > 0) {
      setValidationError(
        `Fill the required path parameter${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
      );
      return;
    }

    // Body: JSON-only; empty body -> no body.
    let parsedBody: unknown = undefined;
    const trimmedBody = bodyText.trim();
    if (trimmedBody.length > 0) {
      try {
        parsedBody = JSON.parse(trimmedBody);
      } catch {
        setValidationError('Request body is not valid JSON.');
        return;
      }
    }

    // Mutating-verb confirmation gate.
    if (isMutating && !mutatingConfirmed) {
      setValidationError('Confirm you want to send this mutating request.');
      return;
    }

    const query = rowsToObject(queryRows);
    const headers = rowsToObject(headerRows);

    const requestBody: ManualCaptureRequest = {
      operationId: selectedOperation.id,
      method,
      path: resolvedPath,
      query: Object.keys(query).length > 0 ? query : null,
      headers: Object.keys(headers).length > 0 ? headers : null,
      body: parsedBody,
      mutatingCallsConfirmed: isMutating ? mutatingConfirmed : false,
    };

    setSubmitting(true);
    try {
      await manualCapture(projectId, architectureId, sessionId, requestBody);
      onSaved();
      onClose();
    } catch (err) {
      if (isSecretsNotLoadedError(err)) {
        // Route to the existing parent prompt -- NOT a generic error.
        setSecretsBlocked(true);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Manual capture failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedOperation,
    secretsLoaded,
    pathTemplate,
    pathParams,
    pathParamValues,
    bodyText,
    isMutating,
    mutatingConfirmed,
    queryRows,
    headerRows,
    rowsToObject,
    method,
    projectId,
    architectureId,
    sessionId,
    onSaved,
    onClose,
  ]);

  const saveDisabled =
    submitting ||
    !selectedOperation ||
    secretsNotLoaded ||
    (isMutating && !mutatingConfirmed);

  return (
    <div
      className={styles.modalBackdrop}
      data-testid="add-new-behaviour-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.modal} data-testid="add-new-behaviour-modal">
        <h3>Add New Behaviour</h3>

        {secretsNotLoaded ? (
          <div
            className={styles.warningBanner}
            data-testid="add-new-behaviour-secrets-not-loaded"
          >
            <strong>Secrets are not loaded for this session.</strong>
            <div>
              Manual sends reuse the session's in-memory secret, which is never
              persisted. Use the existing re-enter-secrets prompt to supply it,
              then re-open this dialog.
            </div>
            <div className={styles.cta}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleRequestReenter}
                data-testid="add-new-behaviour-reenter-secrets"
              >
                Re-enter secrets
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
                data-testid="add-new-behaviour-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <label>
              Operation
              <select
                value={selectedOperationId}
                onChange={(e) => setSelectedOperationId(e.target.value)}
                disabled={submitting}
                data-testid="add-new-behaviour-operation-select"
              >
                <option value="">Select an operation…</option>
                {includedOperations.map((op) => (
                  <option key={op.id} value={op.id}>
                    {operationLabel(op)}
                  </option>
                ))}
              </select>
            </label>

            {selectedOperation && pathParams.length > 0 && (
              <div data-testid="add-new-behaviour-path-params">
                <strong>Path parameters</strong>
                {pathParams.map((p) => (
                  <label key={p}>
                    {p}
                    <input
                      type="text"
                      value={pathParamValues[p] ?? ''}
                      onChange={(e) =>
                        setPathParamValues((prev) => ({ ...prev, [p]: e.target.value }))
                      }
                      disabled={submitting}
                      data-testid={`add-new-behaviour-path-param-${p}`}
                    />
                  </label>
                ))}
              </div>
            )}

            {selectedOperation && (
              <div data-testid="add-new-behaviour-query">
                <strong>Query parameters</strong>
                {queryRows.map((row, i) => (
                  <div key={i} className={styles.cta}>
                    <input
                      type="text"
                      placeholder="key"
                      value={row.key}
                      onChange={(e) =>
                        updateRow(queryRows, setQueryRows, i, 'key', e.target.value)
                      }
                      disabled={submitting}
                      data-testid={`add-new-behaviour-query-key-${i}`}
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) =>
                        updateRow(queryRows, setQueryRows, i, 'value', e.target.value)
                      }
                      disabled={submitting}
                      data-testid={`add-new-behaviour-query-value-${i}`}
                    />
                  </div>
                ))}
              </div>
            )}

            {selectedOperation && (
              <div data-testid="add-new-behaviour-headers">
                <strong>Headers</strong>
                {headerRows.map((row, i) => (
                  <div key={i} className={styles.cta}>
                    <input
                      type="text"
                      placeholder="header"
                      value={row.key}
                      onChange={(e) =>
                        updateRow(headerRows, setHeaderRows, i, 'key', e.target.value)
                      }
                      disabled={submitting}
                      data-testid={`add-new-behaviour-header-key-${i}`}
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) =>
                        updateRow(headerRows, setHeaderRows, i, 'value', e.target.value)
                      }
                      disabled={submitting}
                      data-testid={`add-new-behaviour-header-value-${i}`}
                    />
                  </div>
                ))}
              </div>
            )}

            {selectedOperation && (
              <label>
                Request body (JSON)
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={6}
                  placeholder='{ "example": "value" }'
                  disabled={submitting}
                  data-testid="add-new-behaviour-body"
                />
              </label>
            )}

            {selectedOperation && isMutating && (
              <div data-testid="add-new-behaviour-mutating-block">
                {mutatingCallsConfirmed === false && (
                  <div
                    className={styles.warningBanner}
                    data-testid="add-new-behaviour-mutating-strong-warning"
                  >
                    <strong>
                      This session has NOT confirmed mutating calls.
                    </strong>
                    <div>
                      Sending this {method} request will mutate state on the
                      current-state service. Proceed only with explicit intent.
                    </div>
                  </div>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={mutatingConfirmed}
                    onChange={(e) => setMutatingConfirmed(e.target.checked)}
                    disabled={submitting}
                    data-testid="add-new-behaviour-mutating-confirm"
                  />
                  Yes, send this mutating request
                </label>
              </div>
            )}

            {validationError && (
              <div
                className={styles.errorBanner}
                data-testid="add-new-behaviour-validation-error"
              >
                {validationError}
              </div>
            )}
            {submitError && (
              <div
                className={styles.errorBanner}
                data-testid="add-new-behaviour-submit-error"
              >
                {submitError}
              </div>
            )}

            <div className={styles.cta}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onClose}
                disabled={submitting}
                data-testid="add-new-behaviour-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleSave()}
                disabled={saveDisabled}
                data-testid="add-new-behaviour-save"
              >
                {submitting ? 'Sending…' : 'Send & capture'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AddNewBehaviourModal;
